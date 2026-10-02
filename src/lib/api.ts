// 共享的 API 响应工具：CORS 头、JSON 响应、OPTIONS 预检。
// 全部使用 Web 标准 API，保证 Vercel / Docker / Cloudflare 三种部署目标通用。
//
// CORS 默认只放行同源。此前恒为 `Access-Control-Allow-Origin: *`，叠加没有服务端校验的
// 访问密码，等于把 /api/tts 开放给任意网页静默调用（烧上游配额 / 当跳板）。
// 确需跨域时用 CORS_ALLOWED_ORIGINS 显式列出来源（逗号分隔），或设为 * 恢复旧行为。

const CORS_METHODS = "GET, POST, OPTIONS";
const CORS_MAX_AGE = "86400";
const CORS_ALLOW_HEADERS = "Content-Type";

export const CORS_WILDCARD = "*";

function allowedOrigins(): string[] | typeof CORS_WILDCARD {
  const raw = (process.env.CORS_ALLOWED_ORIGINS || "").trim();
  if (!raw) return [];
  if (raw === CORS_WILDCARD) return CORS_WILDCARD;
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}

/** 按请求 Origin 计算 CORS 头；未获准的跨域请求返回空对象，由浏览器拦截读取 */
export function corsHeaders(req: Request): Record<string, string> {
  const allow = allowedOrigins();
  const origin = req.headers.get("origin");

  if (allow === CORS_WILDCARD) {
    return {
      "Access-Control-Allow-Origin": CORS_WILDCARD,
      "Access-Control-Allow-Methods": CORS_METHODS,
      "Access-Control-Allow-Headers": CORS_ALLOW_HEADERS,
      "Access-Control-Max-Age": CORS_MAX_AGE,
    };
  }
  if (!origin || !allow.includes(origin)) return {};

  return {
    "Access-Control-Allow-Origin": origin,
    // 按来源回显时必须声明 Vary，否则共享缓存会把 A 的响应喂给 B
    "Vary": "Origin",
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Allow-Methods": CORS_METHODS,
    "Access-Control-Allow-Headers": CORS_ALLOW_HEADERS,
    "Access-Control-Max-Age": CORS_MAX_AGE,
  };
}

export function jsonResponse(req: Request, data: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: { "Content-Type": "application/json; charset=utf-8", ...corsHeaders(req), ...init.headers },
  });
}

export function errorResponse(req: Request, message: string, status = 500): Response {
  return jsonResponse(req, { error: message }, { status });
}

/** OPTIONS 预检统一处理 */
export function preflightResponse(req: Request): Response {
  return new Response(null, { status: 204, headers: corsHeaders(req) });
}
