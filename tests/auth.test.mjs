// 密码门契约测试：需要服务器以 PASSWORD 环境变量启动
// 用法: node tests/auth.test.mjs [baseURL]
const BASE = process.argv[2] || "http://localhost:3310";

let pass = 0;
let fail = 0;
const failures = [];

function check(name, cond, detail = "") {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    failures.push(`${name} ${detail}`);
    console.log(`  ✗ ${name} ${detail}`);
  }
}

const PASSWORD = process.env.TEST_PASSWORD || "correct horse";

async function json(res) {
  await res.arrayBuffer();
  return res;
}

/** 从 Set-Cookie 抽出指定 cookie 的值 */
function pickCookie(setCookie, name) {
  for (const line of setCookie.split(",")) {
    const [k, ...rest] = line.trim().split(";")[0].split("=");
    if (k.trim() === name) return rest.join("=").trim();
  }
  return null;
}

async function main() {
  console.log(`密码门测试目标: ${BASE}\n`);

  console.log("[未验证请求应被拒绝]");
  {
    const r1 = await json(await fetch(`${BASE}/api/tts?t=未授权`));
    check("GET /api/tts 无 cookie 返回 401", r1.status === 401, `status=${r1.status}`);
    check("401 响应为 JSON", (r1.headers.get("content-type") || "").includes("json"));

    const r2 = await json(
      await fetch(`${BASE}/api/tts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: "未授权" }),
      })
    );
    check("POST /api/tts 无 cookie 返回 401", r2.status === 401, `status=${r2.status}`);

    const r3 = await json(await fetch(`${BASE}/api/voices`));
    check("GET /api/voices 无 cookie 返回 401", r3.status === 401, `status=${r3.status}`);

    // 页面外壳不含数据，放行以避免弹窗无法渲染；数据端点才是防护边界
    const r4 = await fetch(`${BASE}/`);
    check("首页 HTML 仍可加载（密码弹窗由前端触发）", r4.status === 200);
    await r4.text();
  }

  console.log("\n[/api/check-password]");
  {
    const r1 = await fetch(`${BASE}/api/check-password`);
    const d1 = await r1.json();
    check("requirePassword 为 true", d1.requirePassword === true, JSON.stringify(d1));
    check("未验证时 authenticated 为 false", d1.authenticated === false);

    const r2 = await fetch(`${BASE}/api/check-password`, { headers: { Cookie: "libretts_auth=forged" } });
    const d2 = await r2.json();
    check("伪造 cookie 不被认作已验证", d2.authenticated === false);
  }

  console.log("\n[/api/verify-password]");
  {
    const rWrong = await fetch(`${BASE}/api/verify-password`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: "错的密码" }),
    });
    const dWrong = await rWrong.json();
    check("错误密码返回 401", rWrong.status === 401, `status=${rWrong.status}`);
    check("错误密码不发放 cookie", !rWrong.headers.get("set-cookie"));

    const rGood = await fetch(`${BASE}/api/verify-password`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: PASSWORD }),
    });
    const setCookie = rGood.headers.get("set-cookie") || "";
    await rGood.json();
    check("正确密码返回 200", rGood.status === 200, `status=${rGood.status}`);
    check("发放 libretts_auth cookie", setCookie.includes("libretts_auth="));
    check("cookie 为 HttpOnly（脚本无法改写访问状态）", /httponly/i.test(setCookie));
    check("cookie 为 SameSite=Lax", /samesite=lax/i.test(setCookie));

    const token = pickCookie(setCookie, "libretts_auth");
    const rTts = await fetch(`${BASE}/api/tts?t=已授权`, { headers: { Cookie: `libretts_auth=${token}` } });
    check("携带合法 cookie 可取音频", rTts.status === 200 && (rTts.headers.get("content-type") || "").includes("audio"));
    await rTts.arrayBuffer();

    // 篡改签名的同一个 cookie 必须被拒
    const tampered = `${token.slice(0, -1)}${token.endsWith("A") ? "B" : "A"}`;
    const rBad = await json(
      await fetch(`${BASE}/api/tts?t=篡改`, { headers: { Cookie: `libretts_auth=${tampered}` } })
    );
    check("篡改签名后返回 401", rBad.status === 401, `status=${rBad.status}`);

    const rNoDot = await json(await fetch(`${BASE}/api/tts?t=x`, { headers: { Cookie: "libretts_auth=garbage" } }));
    check("非法格式 cookie 返回 401", rNoDot.status === 401);
  }

  console.log("\n[撞库限速]");
  {
    // 成功校验已消耗 1 次，窗口内共 10 次，之后应 429
    let sawRateLimit = false;
    let lastStatus = 0;
    for (let i = 0; i < 12; i++) {
      const r = await fetch(`${BASE}/api/verify-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: `wrong-${i}` }),
      });
      lastStatus = r.status;
      await r.json();
      if (r.status === 429) {
        sawRateLimit = true;
        check("429 带 Retry-After", !!r.headers.get("retry-after"), `retry-after=${r.headers.get("retry-after")}`);
        break;
      }
    }
    check("连续错误密码触发限速", sawRateLimit, `最后状态=${lastStatus}`);
  }

  console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
  if (failures.length) {
    console.log("失败项:", failures.join(" | "));
    process.exit(1);
  }
}

main().catch((e) => {
  console.error("测试执行失败:", e.message);
  process.exit(1);
});
