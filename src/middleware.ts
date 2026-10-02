// 访问密码的服务端拦截层。
// 注意：部分部署目标（Workers / 构建期注入 env 的平台）会把 process.env 在构建时固化，
// 因此这里只是第一道；各 route handler 内还会再校验一次，确保密码在运行时生效。
import { NextResponse, type NextRequest } from "next/server";
import { isRequestAuthorized, passwordRequired } from "@/lib/auth";

/** 换取 cookie 前必须可达的端点，以及页面外壳自身 */
const PUBLIC_PATHS = new Set(["/api/check-password", "/api/verify-password"]);

export async function middleware(req: NextRequest) {
  if (!passwordRequired()) return NextResponse.next();
  if (await isRequestAuthorized(req)) return NextResponse.next();

  const { pathname } = req.nextUrl;
  if (PUBLIC_PATHS.has(pathname)) return NextResponse.next();

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "需要访问密码", code: "unauthorized" }, { status: 401 });
  }

  // 页面外壳不含任何数据，放行让前端弹出密码框；真正的数据接口已在上面拦截
  return NextResponse.next();
}

export const config = {
  // 静态资源与语音列表无需鉴权，其余路径全部经过 middleware
  matcher: "/((?!_next/static|_next/image|image/|favicon.ico|site.webmanifest|speakers.json).*)",
};
