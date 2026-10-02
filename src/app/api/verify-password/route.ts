import { errorResponse, jsonResponse, preflightResponse } from "@/lib/api";
import {
  consumeAttempt,
  createSessionToken,
  passwordMatches,
  passwordRequired,
  sessionCookieHeader,
} from "@/lib/auth";
import type { NextRequest } from "next/server";

export const dynamic = "force-dynamic";

/** 取来源标识用于限速：优先反向代理链的第一个地址 */
function clientKey(req: NextRequest): string {
  const forwarded = req.headers.get("x-forwarded-for");
  return (forwarded?.split(",")[0].trim() || req.headers.get("x-real-ip") || "unknown");
}

export async function OPTIONS(req: NextRequest) {
  return preflightResponse(req);
}

export async function POST(req: NextRequest) {
  // 密码未设置时不需要验证
  if (!passwordRequired()) {
    return jsonResponse(req, { valid: true, message: "No password required" });
  }

  const retryAfter = consumeAttempt(clientKey(req));
  if (retryAfter !== null) {
    return jsonResponse(
      req,
      { valid: false, message: "尝试过于频繁，请稍后再试", retryAfter },
      { status: 429, headers: { "Retry-After": String(retryAfter) } }
    );
  }

  let password: unknown;
  try {
    const body = await req.json();
    password = body.password;
  } catch {
    return errorResponse(req, "Bad request", 400);
  }

  if (typeof password === "string" && (await passwordMatches(password))) {
    return jsonResponse(req, { valid: true }, { headers: { "Set-Cookie": sessionCookieHeader(await createSessionToken()) } });
  }
  return jsonResponse(req, { valid: false, message: "密码错误" }, { status: 401 });
}
