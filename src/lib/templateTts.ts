// 通用请求模板引擎：把用户配置的 method / headers / body 模板渲染成真实请求。
// 全部为纯函数，便于单元测试，也不依赖浏览器之外的运行环境。

/** XML/SSML 转义（与 segmentation.escapeXml 行为一致，此处内联以避免跨模块依赖） */
function escapeXml(str: unknown): string {
  return String(str ?? "").replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[c] as string
  ));
}

/** 模板可用占位符变量 */
export interface TemplateVars {
  text?: string;
  voice?: string;
  model?: string;
  rate?: number;
  pitch?: number;
  /** 音频格式，如 mp3 */
  format?: string;
  instructions?: string;
  apiKey?: string;
  preview?: boolean;
}

const PLACEHOLDER_RE = /\{\{\s*([\w.]+)\s*\}\}/g;

function toPlaceholderMap(vars: TemplateVars): Record<string, string> {
  const text = vars.text ?? "";
  return {
    text,
    /** XML/SSML 场景下已转义的文本（如 Azure Speech） */
    textXml: escapeXml(text),
    voice: vars.voice ?? "",
    model: vars.model ?? vars.voice ?? "",
    rate: String(vars.rate ?? 0),
    pitch: String(vars.pitch ?? 0),
    format: vars.format ?? "mp3",
    instructions: vars.instructions ?? "",
    apiKey: vars.apiKey ?? "",
    preview: vars.preview ? "true" : "false",
  };
}

/** JSON 字符串转义（去掉 JSON.stringify 结果两端引号，便于嵌入模板） */
function jsonEscape(value: string): string {
  return JSON.stringify(value).slice(1, -1);
}

/**
 * 渲染模板字符串。
 * @param opts.json 为 true 时占位符按 JSON 字符串规则转义（用于拼接 JSON body）
 * @param opts.url  为 true 时占位符按 URL 组件编码（用于查询串，防止 & / # 注入额外参数）
 */
export function renderTemplate(
  tpl: string,
  vars: TemplateVars,
  opts: { json?: boolean; url?: boolean } = {}
): string {
  const map = toPlaceholderMap(vars);
  return tpl.replace(PLACEHOLDER_RE, (_match, name: string) => {
    const raw = map[name.trim()] ?? "";
    if (opts.url) return encodeURIComponent(raw);
    return opts.json ? jsonEscape(raw) : raw;
  });
}

/** 解析多行 "Key: Value" 请求头模板（支持 # 注释，值支持占位符） */
export function parseHeaderLines(lines: string | undefined, vars: TemplateVars): Record<string, string> {
  const headers: Record<string, string> = {};
  if (!lines) return headers;
  for (const rawLine of lines.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const idx = line.indexOf(":");
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim();
    headers[key] = renderTemplate(line.slice(idx + 1).trim(), vars);
  }
  return headers;
}

/** 按 "a.b.0.c" 路径取嵌套字段（数组用数字下标） */
export function getByPath(obj: unknown, path: string): unknown {
  if (!path) return obj;
  return path.split(".").reduce<unknown>((acc, key) => {
    if (acc == null) return undefined;
    if (Array.isArray(acc)) {
      const idx = Number(key);
      return Number.isInteger(idx) ? acc[idx] : undefined;
    }
    if (typeof acc === "object") return (acc as Record<string, unknown>)[key];
    return undefined;
  }, obj);
}

/** 渲染请求体：json 类型会做 JSON 语法校验，raw 类型（如 SSML）原样返回 */
export function renderBody(
  tpl: string | undefined,
  vars: TemplateVars,
  bodyType: "json" | "raw" = "json"
): string | undefined {
  if (!tpl) return undefined;
  const rendered = renderTemplate(tpl, vars, { json: bodyType === "json" });
  if (bodyType === "raw") return rendered;
  try {
    return JSON.stringify(JSON.parse(rendered));
  } catch (err) {
    throw new Error(`请求体模板不是合法 JSON: ${(err as Error).message}`);
  }
}

/** 把 JSON 响应里的音频字段解码为 ArrayBuffer */
export function decodeAudioPayload(payload: string, encoding: "base64" | "hex" = "base64"): ArrayBuffer {
  if (encoding === "hex") {
    const clean = payload.trim();
    const len = Math.floor(clean.length / 2);
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
    }
    return bytes.buffer as ArrayBuffer;
  }
  const binary = atob(payload.replace(/\s/g, ""));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer as ArrayBuffer;
}
