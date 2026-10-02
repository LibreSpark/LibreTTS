import { jsonResponse, preflightResponse } from "@/lib/api";
import { isRequestAuthorized, passwordRequired } from "@/lib/auth";
import type { NextRequest } from "next/server";

export const dynamic = "force-dynamic";

export async function OPTIONS(req: NextRequest) {
  return preflightResponse(req);
}

export async function GET(req: NextRequest) {
  // authenticated 让已持有效 cookie 的老访客直接跳过密码弹窗
  return jsonResponse(req, {
    requirePassword: passwordRequired(),
    authenticated: await isRequestAuthorized(req),
  });
}
