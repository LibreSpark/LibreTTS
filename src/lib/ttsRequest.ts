// 客户端 TTS 请求构造（自 script.js makeRequest 移植并扩展）
// 支持三种协议：
//  - openai  ：/v1/audio/speech 风格请求体（标准 OpenAI、Azure OpenAI、硅基流动等）
//  - edge    ：内置 /api/tts 的 { text, voice, rate, pitch, preview } 契约
//  - template：通用请求模板，用户自定义 method / headers / body / 响应解析
import { ensurePlayableAudio, PCM_SPEC_EDGE, PCM_SPEC_OPENAI } from "./audioBlob";
import { getTextLength, resolveApiLimits } from "./segmentation";
import {
  decodeAudioPayload,
  getByPath,
  parseHeaderLines,
  renderBody,
  renderTemplate,
  type TemplateVars,
} from "./templateTts";
import type { ApiFormat, TemplateConfig } from "./types";

export interface ApiContext {
  id: string;
  endpoint: string;
  format: ApiFormat;
  isCustom: boolean;
  apiKey?: string;
  maxLength?: number | null;
  /** 固定模型名；留空时 openai 格式沿用旧行为（把讲述人当 model） */
  model?: string;
  /** 额外请求体参数，会合并进请求体 */
  extraParams?: Record<string, unknown>;
  /** 通用模板配置 */
  template?: TemplateConfig;
}

export interface TtsRequestOptions {
  voice: string;
  text: string;
  rate: number;
  pitch: number;
  preview: boolean;
  instructions: string;
  audioFormat: string;
  /** Edge 高级参数 */
  style?: string;
  role?: string;
  volume?: number;
}

const BREAK_TAG_RE = /<break\s+time=["'](\d+(?:\.\d+)?[ms]s?)["']\s*\/>/g;
const XML_SPECIAL_RE = /[&<>"']/g;

/** Edge 内置 API 支持的音频格式 */
export const EDGE_AUDIO_FORMATS = ["mp3", "opus", "wav", "pcm"];
/** OpenAI 风格 API 支持的音频格式 */
export const OPENAI_AUDIO_FORMATS = ["mp3", "opus", "aac", "flac", "wav", "pcm"];

/** 客户端请求超时。此前出站 fetch 全无 timeout，第三方端点挂起会让"生成"按钮永远转圈 */
const REQUEST_TIMEOUT_MS = 120000;

/** 按 API 格式返回可选的音频格式列表 */
export function supportedAudioFormats(format: ApiFormat): string[] {
  return format === "edge" ? EDGE_AUDIO_FORMATS : OPENAI_AUDIO_FORMATS;
}

function escapeXmlProtectSsml(text: string): string {
  // 临时替换 SSML 标签，转义其他特殊字符后还原
  const ssmlTags: string[] = [];
  const tempText = text.replace(BREAK_TAG_RE, (match) => {
    ssmlTags.push(match);
    return `__SSML_TAG_${ssmlTags.length - 1}__`;
  });

  const escaped = tempText.replace(XML_SPECIAL_RE, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[c] as string
  ));

  return escaped.replace(/__SSML_TAG_(\d+)__/g, (_, index: string) => ssmlTags[parseInt(index)]);
}

/** 已配置鉴权类请求头（authorization / *-key / *token）时跳过 Bearer 兜底 */
function hasAuthHeader(headers: Record<string, string>): boolean {
  return Object.keys(headers).some((k) => {
    const key = k.toLowerCase();
    return key.includes("authorization") || key.includes("key") || key.includes("token");
  });
}

/** 响应体校验：拒绝 JSON/HTML 错误页，接受浏览器/服务端返回的音频 */
function toAudioBlob(blob: Blob, contentType: string | null): Blob {
  const type = (contentType || blob.type || "").toLowerCase();
  if (type.includes("json") || type.includes("html") || type.includes("text/plain")) {
    throw new Error("服务器返回的不是音频数据");
  }
  if (blob.size === 0) {
    throw new Error("无效的音频文件");
  }
  return blob;
}

async function readError(response: Response): Promise<never> {
  const errorText = await response.text().catch(() => "");
  throw new Error(`服务器响应错误: ${response.status} - ${errorText || response.statusText}`);
}

export async function makeTtsRequest(ctx: ApiContext, opts: TtsRequestOptions): Promise<Blob> {
  const headers: Record<string, string> = {
    Accept: "audio/mpeg",
  };
  // 裸 PCM 无容器头、浏览器无法播放，按来源推断规格后封装为 WAV
  const pcmSpec = ctx.format === "edge" && !ctx.isCustom ? PCM_SPEC_EDGE : PCM_SPEC_OPENAI;

  // ---------- 通用请求模板 ----------
  if (ctx.format === "template") {
    const tpl = ctx.template ?? {};
    const method = (tpl.method ?? "POST").toUpperCase();
    const vars: TemplateVars = {
      text: opts.text,
      voice: opts.voice,
      model: ctx.model,
      rate: opts.rate,
      pitch: opts.pitch,
      format: opts.audioFormat,
      instructions: opts.instructions,
      apiKey: ctx.apiKey,
      preview: opts.preview,
    };

    let url = renderTemplate(ctx.endpoint, vars);
    Object.assign(headers, parseHeaderLines(tpl.headers, vars));

    let body: string | undefined;
    if (method === "GET") {
      // url 模式：占位符按查询组件编码，界面对该字段的说明正是"会自动 URL 编码"
      const query = tpl.query
        ? renderTemplate(tpl.query, vars, { url: true })
        : `text=${encodeURIComponent(opts.text)}&voice=${encodeURIComponent(opts.voice)}`;
      url += (url.includes("?") ? "&" : "?") + query;
    } else {
      body = renderBody(tpl.body, vars, tpl.bodyType ?? "json");
      const hasContentType = Object.keys(headers).some((k) => k.toLowerCase() === "content-type");
      if (body !== undefined && !hasContentType) {
        headers["Content-Type"] = tpl.bodyType === "raw" ? "text/plain; charset=utf-8" : "application/json";
      }
    }

    // 密钥已出现在端点（如 Google 的 ?key=）、请求头或请求体中时，不再自动追加 Bearer，避免冲突
    const keyAlreadyUsed =
      !!ctx.apiKey &&
      (url.includes(ctx.apiKey) ||
        (body ?? "").includes(ctx.apiKey) ||
        Object.values(headers).some((v) => v.includes(ctx.apiKey as string)));
    if (ctx.apiKey && !keyAlreadyUsed && !hasAuthHeader(headers)) {
      headers["Authorization"] = `Bearer ${ctx.apiKey}`;
    }

    const response = await fetch(url, { method, headers, body, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    if (!response.ok) await readError(response);

    if (tpl.responseType === "json") {
      const data = await response.json();
      const value = getByPath(data, tpl.responsePath ?? "");
      if (typeof value !== "string" || !value) {
        throw new Error(`响应中未找到音频字段: ${tpl.responsePath || "(根)"}`);
      }
      if (tpl.responseEncoding === "url") {
        const audioRes = await fetch(value, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
        if (!audioRes.ok) await readError(audioRes);
        return ensurePlayableAudio(
          toAudioBlob(await audioRes.blob(), audioRes.headers.get("content-type")),
          opts.audioFormat,
          pcmSpec
        );
      }
      const bytes = decodeAudioPayload(value, tpl.responseEncoding === "hex" ? "hex" : "base64");
      return ensurePlayableAudio(new Blob([bytes], { type: "audio/mpeg" }), opts.audioFormat, pcmSpec);
    }

    return ensurePlayableAudio(
      toAudioBlob(await response.blob(), response.headers.get("content-type")),
      opts.audioFormat,
      pcmSpec
    );
  }

  headers["Content-Type"] = "application/json";

  let requestBody: Record<string, unknown>;

  if (ctx.format === "openai") {
    // OpenAI 格式不支持停顿标签，移除之
    const cleanText = opts.text.replace(BREAK_TAG_RE, "");
    const { maxTotal } = resolveApiLimits("openai", ctx.maxLength);
    const textLength = getTextLength(cleanText);
    if (textLength > maxTotal) {
      throw new Error(`OpenAI格式API文本总长度超限，最多支持${maxTotal}个单位，当前长度: ${textLength}`);
    }

    requestBody = {
      input: cleanText,
      response_format: opts.audioFormat,
      // 配置了固定 model 时，讲述人作为 voice；否则沿用旧行为：讲述人当 model、voice 固定 alloy
      ...(ctx.model
        ? { model: ctx.model, voice: opts.voice }
        : { model: opts.voice, voice: ctx.isCustom ? "alloy" : opts.voice }),
    };
    if (opts.instructions) {
      requestBody.instructions = opts.instructions;
    }
    if (ctx.extraParams) {
      Object.assign(requestBody, ctx.extraParams);
    }
    if (ctx.isCustom && ctx.apiKey) {
      headers["Authorization"] = `Bearer ${ctx.apiKey}`;
    }
  } else {
    // Edge 格式。内置 API 由服务端统一做 SSML 转义，客户端只保护停顿标签；
    // 自定义 Edge API 保持旧行为：客户端先转义（保护停顿标签）
    const payloadText = ctx.isCustom ? escapeXmlProtectSsml(opts.text) : opts.text;
    requestBody = {
      text: payloadText,
      voice: opts.voice,
      rate: Math.round(opts.rate),
      pitch: Math.round(opts.pitch),
      preview: opts.preview,
      format: opts.audioFormat,
    };
    if (opts.style) requestBody.style = opts.style;
    if (opts.role) requestBody.role = opts.role;
    if (typeof opts.volume === "number") requestBody.volume = opts.volume;
    if (ctx.extraParams) {
      Object.assign(requestBody, ctx.extraParams);
    }

    if (ctx.isCustom && ctx.apiKey) {
      if (ctx.apiKey.toLowerCase().startsWith("x-api-key:")) {
        headers["x-api-key"] = ctx.apiKey.substring("x-api-key:".length).trim();
      } else {
        headers["Authorization"] = `Bearer ${ctx.apiKey}`;
      }
    }
  }

  const response = await fetch(ctx.endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify(requestBody),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (!response.ok) await readError(response);

  return ensurePlayableAudio(
    toAudioBlob(await response.blob(), response.headers.get("content-type")),
    opts.audioFormat,
    pcmSpec
  );
}

/** 下载用的音频扩展名 */
export function audioExtension(ctx: ApiContext, audioFormat: string): string {
  // 裸 PCM 会被封装成 WAV，扩展名随之改为 .wav
  if (audioFormat === "pcm") return "wav";
  if (ctx.format === "edge") {
    return EDGE_AUDIO_FORMATS.includes(audioFormat) ? audioFormat : "mp3";
  }
  return audioFormat || "mp3";
}
