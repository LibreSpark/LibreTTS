import { corsHeaders, errorResponse, preflightResponse } from "@/lib/api";
import { isRequestAuthorized } from "@/lib/auth";
import {
  formatToExtension,
  formatToMime,
  normalizeOutputFormat,
  synthesize,
  type SsmlOptions,
} from "@/lib/edgeTts";
import { getTextLength } from "@/lib/segmentation";
import type { NextRequest } from "next/server";

export const dynamic = "force-dynamic";

const DEFAULT_VOICE = "zh-CN-XiaoxiaoMultilingualNeural";

/** 单次请求的文本上限（单位数，中文算 2）。前端分段上限是 5000，这里留一倍余量，
 *  只为挡住拿本服务当免费 TTS 后端的超长投递。 */
const MAX_TEXT_UNITS = 10000;

/** 承载文本的请求头：避免必须把原文放进 URL（会进 nginx / CDN 访问日志与浏览器历史） */
const TEXT_HEADER = "x-tts-text";

/** HTTP 头只能是 latin1 字节序列，原文必须先按 URL 同样的约定做百分号编码；
 *  含裸 % 的非编码值会解析失败，此时按原文使用。 */
function headerText(req: NextRequest): string | undefined {
  const raw = req.headers.get(TEXT_HEADER);
  if (raw == null) return undefined;
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

function parseVolume(value: unknown): number | undefined {
  // GET 缺参时 searchParams 给 null，而 Number(null) === 0 会被当成"音量 0"导致整段静音；
  // 只有真正未提供时才返回 undefined 交给 SSML 默认值，显式的 0 仍保留。
  if (value == null || (typeof value === "string" && !value.trim())) return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(100, Math.max(0, n)) : undefined;
}

/** 语速/语调百分比，与界面滑杆同域 [-100,100]，非法值回落到 0 */
function parsePercent(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(100, Math.max(-100, Math.round(n))) : 0;
}

interface TtsParams {
  text: string;
  voiceName: string;
  rate: number;
  pitch: number;
  outputFormat: string;
  download: boolean;
  ssml: SsmlOptions;
}

export async function OPTIONS(req: NextRequest) {
  return preflightResponse(req);
}

export async function POST(req: NextRequest) {
  try {
    if (!(await isRequestAuthorized(req))) {
      return errorResponse(req, "需要访问密码", 401);
    }
    const body = await req.json();
    // 请求头优先：长文本走 header 才不会污染 URL，query/body 仍保留以兼容既有调用
    const fromHeader = headerText(req);
    return handleTTS(req, {
      text: (fromHeader || String(body.text ?? "")) as string,
      voiceName: String(body.voice || DEFAULT_VOICE),
      rate: parsePercent(body.rate),
      pitch: parsePercent(body.pitch),
      outputFormat: String(body.format || ""),
      download: body.preview === false,
      ssml: {
        style: body.style ? String(body.style) : undefined,
        role: body.role ? String(body.role) : undefined,
        volume: parseVolume(body.volume),
      },
    });
  } catch (error) {
    console.error("API Error:", error);
    return errorResponse(req, error instanceof Error ? error.message : "Internal Server Error");
  }
}

export async function GET(req: NextRequest) {
  try {
    if (!(await isRequestAuthorized(req))) {
      return errorResponse(req, "需要访问密码", 401);
    }
    const q = req.nextUrl.searchParams;
    return handleTTS(req, {
      text: headerText(req) || q.get("t") || "",
      voiceName: q.get("v") || DEFAULT_VOICE,
      rate: parsePercent(q.get("r")),
      pitch: parsePercent(q.get("p")),
      // GET 的格式参数是 o（?format= 是 POST 体字段名，历史上并不被 GET 识别）
      outputFormat: q.get("o") || "",
      download: q.get("d") === "true",
      ssml: {
        style: q.get("style") || undefined,
        role: q.get("role") || undefined,
        volume: parseVolume(q.get("vol")),
      },
    });
  } catch (error) {
    console.error("API Error:", error);
    return errorResponse(req, error instanceof Error ? error.message : "Internal Server Error");
  }
}

async function handleTTS(req: NextRequest, params: TtsParams): Promise<Response> {
  const { text, voiceName, rate, pitch, outputFormat, download, ssml } = params;

  if (!text.trim()) {
    return errorResponse(req, "文本不能为空", 400);
  }
  if (getTextLength(text) > MAX_TEXT_UNITS) {
    return errorResponse(req, `文本超出单次请求上限 ${MAX_TEXT_UNITS} 单位，请分段发送`, 413);
  }

  try {
    // 兼容 UI 简写（mp3/opus/wav/pcm）与完整 Microsoft 格式
    const normalizedFormat = normalizeOutputFormat(outputFormat);
    const audio = await synthesize(text, voiceName, rate, pitch, normalizedFormat, ssml);

    const headers: Record<string, string> = {
      ...corsHeaders(req),
      // 按实际输出格式声明，此前恒为 audio/mpeg 导致 wav/opus 响应类型与内容不符
      "Content-Type": formatToMime(normalizedFormat),
      "Cache-Control": "no-store",
    };
    if (download) {
      headers["Content-Disposition"] =
        `attachment; filename="${encodeURIComponent(voiceName)}.${formatToExtension(normalizedFormat)}"`;
    }
    return new Response(audio, { headers });
  } catch (error) {
    console.error("TTS Error:", error);
    return errorResponse(req, error instanceof Error ? error.message : "TTS 请求失败");
  }
}
