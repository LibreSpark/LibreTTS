// 简单的内存级暴力破解防护：记录每个IP在时间窗口内的失败次数
const loginAttempts = new Map();
const MAX_ATTEMPTS = 5;
const WINDOW_MS = 15 * 60 * 1000; // 15分钟

export async function onRequest(context) {
  const { request, env } = context;
  
  // 处理CORS预检请求
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type"
      }
    });
  }
  
  // 只允许POST请求
  if (request.method !== "POST") {
    return new Response(JSON.stringify({
      error: "Method not allowed"
    }), {
      status: 405,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*"
      }
    });
  }
  
  try {
    // 读取环境变量密码
    const correctPassword = env.PASSWORD;
    
    // 如果未设置密码，则直接验证通过
    if (!correctPassword) {
      return new Response(JSON.stringify({
        valid: true,
        message: "No password required"
      }), {
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*"
        }
      });
    }
    
    // 基于客户端IP的暴力破解防护
    const clientIP = request.headers.get("CF-Connecting-IP") || "unknown";
    const now = Date.now();
    const attempt = loginAttempts.get(clientIP);

    if (attempt && now - attempt.firstAttempt < WINDOW_MS && attempt.count >= MAX_ATTEMPTS) {
      return new Response(JSON.stringify({
        valid: false,
        message: "Too many attempts. Please try again later."
      }), {
        status: 429,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*"
        }
      });
    }

    // 解析请求体获取用户提交的密码
    const { password } = await request.json();
    
    // 验证密码
    if (password === correctPassword) {
      loginAttempts.delete(clientIP);
      return new Response(JSON.stringify({
        valid: true,
        message: "Password verified successfully"
      }), {
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*"
        }
      });
    } else {
      if (!attempt || now - attempt.firstAttempt >= WINDOW_MS) {
        loginAttempts.set(clientIP, { count: 1, firstAttempt: now });
      } else {
        attempt.count += 1;
      }
      return new Response(JSON.stringify({
        valid: false,
        message: "Incorrect password"
      }), {
        status: 401,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*"
        }
      });
    }
  } catch (error) {
    return new Response(JSON.stringify({
      error: "Bad request"
    }), {
      status: 400,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*"
      }
    });
  }
}
