// 访问密码的服务端会话。
// 校验令牌是 HMAC 签名的过期时间戳，放在 HttpOnly cookie 里，由 middleware 与
// 各 route handler 共同校验——localStorage 标记可被访问者自行改写，不能作为访问控制。
// 仅使用 Web 标准 API（crypto.subtle），Node / Edge / Workers 运行时通用。

export const AUTH_COOKIE = "libretts_auth";
export const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;

const encoder = new TextEncoder();

/** 未显式配置 SESSION_SECRET 时，从 PASSWORD 派生签名密钥（换密码即令旧会话失效） */
function signingSecret(): string {
  return process.env.SESSION_SECRET || process.env.PASSWORD || "";
}

export function passwordRequired(): boolean {
  return !!process.env.PASSWORD;
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

async function hmacKey(): Promise<CryptoKey> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(`libretts-session-v1:${signingSecret()}`));
  return crypto.subtle.importKey("raw", digest, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function sign(payload: string): Promise<string> {
  const mac = await crypto.subtle.sign("HMAC", await hmacKey(), encoder.encode(payload));
  return toBase64Url(new Uint8Array(mac));
}

/** 等长字符串的定长比较，避免用响应时间反推内容 */
function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** 比较用户输入的密码：两侧先哈希，长度与内容都不参与短路判断 */
export async function passwordMatches(input: string): Promise<boolean> {
  const expected = process.env.PASSWORD || "";
  if (!expected) return false;
  const [given, want] = await Promise.all([sha256Hex(input), sha256Hex(expected)]);
  return constantTimeEqual(given, want);
}

export async function createSessionToken(): Promise<string> {
  const exp = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS;
  return `${exp}.${await sign(String(exp))}`;
}

export async function verifySessionToken(token: string | undefined | null): Promise<boolean> {
  if (!passwordRequired() || !token) return false;
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return false;
  const expText = token.slice(0, dot);
  const exp = Number(expText);
  if (!Number.isFinite(exp) || exp * 1000 <= Date.now()) return false;
  return constantTimeEqual(await sign(expText), token.slice(dot + 1));
}

function readCookie(req: Request, name: string): string | undefined {
  for (const part of (req.headers.get("cookie") || "").split(";")) {
    const idx = part.indexOf("=");
    if (idx < 0) continue;
    if (part.slice(0, idx).trim() === name) return decodeURIComponent(part.slice(idx + 1).trim());
  }
  return undefined;
}

/** 从请求 cookie 判断是否已授权；未启用密码时直接放行 */
export async function isRequestAuthorized(req: Request): Promise<boolean> {
  if (!passwordRequired()) return true;
  return verifySessionToken(readCookie(req, AUTH_COOKIE));
}

export function sessionCookieHeader(token: string): string {
  const parts = [
    `${AUTH_COOKIE}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${SESSION_TTL_SECONDS}`,
  ];
  if (process.env.COOKIE_SECURE === "true") parts.push("Secure");
  return parts.join("; ");
}

// ---------- 撞库限速 ----------

const WINDOW_MS = 5 * 60 * 1000;
const MAX_ATTEMPTS = 10;
const attempts = new Map<string, { count: number; resetAt: number }>();

/** 同一来源在窗口期内最多 MAX_ATTEMPTS 次密码校验；返回 null 表示允许，否则为建议等待秒数 */
export function consumeAttempt(key: string): number | null {
  const now = Date.now();
  if (attempts.size > 1000) {
    for (const [k, v] of attempts) if (v.resetAt <= now) attempts.delete(k);
  }
  const bucket = attempts.get(key);
  if (!bucket || bucket.resetAt <= now) {
    attempts.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return null;
  }
  bucket.count += 1;
  return bucket.count > MAX_ATTEMPTS ? Math.ceil((bucket.resetAt - now) / 1000) : null;
}
