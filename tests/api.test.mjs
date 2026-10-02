// API 端点契约测试：node tests/api.test.mjs [baseURL]
// 默认 http://localhost:3300（Next.js 生产服务器）
const BASE = process.argv[2] || "http://localhost:3300";

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

/** 解析 RIFF/WAVE 的 data 块，返回 16bit PCM 的 RMS；非 WAV 或缺 data 块返回 -1。
 *  状态码 200 且字节非空并不保证有声音，静音流的长度与正常音频完全一致。 */
function wavRms(buf) {
  const v = new DataView(buf);
  const tag = (o) => String.fromCharCode(v.getUint8(o), v.getUint8(o + 1), v.getUint8(o + 2), v.getUint8(o + 3));
  if (buf.byteLength < 12 || tag(0) !== "RIFF" || tag(8) !== "WAVE") return -1;
  let off = 12;
  while (off + 8 <= buf.byteLength) {
    const size = v.getUint32(off + 4, true);
    if (tag(off) === "data") {
      const n = Math.floor(Math.min(size, buf.byteLength - off - 8) / 2);
      let sum = 0;
      for (let i = 0; i < n; i++) {
        const s = v.getInt16(off + 8 + i * 2, true);
        sum += s * s;
      }
      return n ? Math.sqrt(sum / n) : 0;
    }
    off += 8 + size + (size % 2);
  }
  return -1;
}

async function main() {
  console.log(`测试目标: ${BASE}\n`);

  console.log("[/api/tts]");
  {
    // POST 正常生成
    const r1 = await fetch(`${BASE}/api/tts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "测试文本", voice: "zh-CN-XiaoxiaoNeural" }),
    });
    check("POST 正常返回 audio/mpeg", r1.status === 200 && r1.headers.get("content-type") === "audio/mpeg");
    const buf1 = await r1.arrayBuffer();
    check("POST 返回非空音频", buf1.byteLength > 1000);

    // 默认不开放跨域：未列入 CORS_ALLOWED_ORIGINS 的来源一律不给 ACAO 头
    const rCors = await fetch(`${BASE}/api/tts`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "https://evil.example" },
      body: JSON.stringify({ text: "跨域", voice: "zh-CN-XiaoxiaoNeural" }),
    });
    await rCors.arrayBuffer();
    check(
      "未白名单来源不返回 Access-Control-Allow-Origin",
      rCors.headers.get("access-control-allow-origin") === null
    );

    // GET 下载
    const r2 = await fetch(`${BASE}/api/tts?t=下载测试&d=true`);
    check("GET 下载带 Content-Disposition", (r2.headers.get("content-disposition") || "").includes("attachment"));
    check("GET 下载文件名按格式映射 .mp3", (r2.headers.get("content-disposition") || "").includes(".mp3"));
    await r2.arrayBuffer();

    // GET 缺省音量：曾因 Number(null)===0 把缺参当成音量 0，返回等长纯静音
    const r2w = await fetch(`${BASE}/api/tts?t=${encodeURIComponent("音量默认测试文本")}&o=wav`);
    const rmsDefault = wavRms(await r2w.arrayBuffer());
    check("GET 缺省音量返回非静音音频", rmsDefault > 100, `rms=${rmsDefault}`);

    // 显式 vol=0 仍是零音量，避免有人把缺省修复成"0 抬到默认值"
    const r2z = await fetch(`${BASE}/api/tts?t=${encodeURIComponent("音量默认测试文本")}&o=wav&vol=0`);
    const rmsZero = wavRms(await r2z.arrayBuffer());
    check("显式 vol=0 保持零音量", rmsZero >= 0 && rmsZero < 5, `rms=${rmsZero}`);

    // X-TTS-Text：原文不必进 URL（URL 会落进 nginx/CDN 日志与浏览器历史）。
    // HTTP 头只能带 latin1 字节，所以值必须像 query 一样先百分号编码。
    const r2h = await fetch(`${BASE}/api/tts?o=wav`, {
      headers: { "X-TTS-Text": encodeURIComponent("请求头文本测试") },
    });
    check("GET 可用 X-TTS-Text 请求头传文本", r2h.status === 200, `status=${r2h.status}`);
    const rmsHeader = wavRms(await r2h.arrayBuffer());
    check("请求头文本解码后正常合成（非静音）", rmsHeader > 100, `rms=${rmsHeader}`);

    const r2p = await fetch(`${BASE}/api/tts?t=${encodeURIComponent("应被忽略")}`, {
      headers: { "X-TTS-Text": encodeURIComponent("请求头优先") },
    });
    check("请求头文本优先于 query", r2p.status === 200);
    await r2p.arrayBuffer();

    // 裸 % 不是合法转义序列时按原文处理，不能整请求失败
    const r2raw = await fetch(`${BASE}/api/tts`, { headers: { "X-TTS-Text": "50% off deal" } });
    check("非法转义序列回落为原文", r2raw.status === 200, `status=${r2raw.status}`);
    await r2raw.arrayBuffer();

    // 超长投递直接拒绝，挡住把本站当免费 TTS 后端的批量调用。
    // GET 用 ASCII 填充：中文百分号编码后的 URL 会先撞上 Node 约 16KB 的请求行上限（431），那是另一层限制
    const rLong = await fetch(`${BASE}/api/tts?t=${"a".repeat(10001)}`);
    check("GET 超出文本上限返回 413", rLong.status === 413, `status=${rLong.status}`);
    check("413 响应不含音频", !(rLong.headers.get("content-type") || "").includes("audio"));
    await rLong.json().catch(() => ({}));

    const rLongPost = await fetch(`${BASE}/api/tts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "长".repeat(6000) }),
    });
    check("POST 超出文本上限返回 413 JSON", rLongPost.status === 413, `status=${rLongPost.status}`);
    await rLongPost.json().catch(() => ({}));

    // 输出格式与 Content-Type 必须一致，此前恒为 audio/mpeg
    const r2wav = await fetch(`${BASE}/api/tts?t=格式头测试&o=wav`);
    check("wav 输出声明 audio/wav", r2wav.headers.get("content-type") === "audio/wav");
    await r2wav.arrayBuffer();

    // 空文本本地拒绝（400），不再把空 SSML 抛给上游
    const r3 = await fetch(`${BASE}/api/tts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "" }),
    });
    check("空文本返回 4xx JSON 错误", r3.status >= 400 && r3.status < 500 && (r3.headers.get("content-type") || "").includes("json"));
    const e3 = await r3.json();
    check("错误响应含 error 字段", typeof e3.error === "string");

    // 非法方法
    const r4 = await fetch(`${BASE}/api/tts`, { method: "PUT" });
    check("PUT 返回 405", r4.status === 405);
    await r4.arrayBuffer();

    // OPTIONS 预检
    const r5 = await fetch(`${BASE}/api/tts`, {
      method: "OPTIONS",
      headers: { Origin: "https://evil.example" },
    });
    check("OPTIONS 返回 204", r5.status === 204);
    check("预检不授予未白名单来源", r5.headers.get("access-control-allow-origin") === null);
    await r5.arrayBuffer();
  }

  console.log("\n[/api/voices]");
  {
    const r1 = await fetch(`${BASE}/api/voices`);
    const voices = await r1.json();
    check("默认返回 JSON 数组", Array.isArray(voices) && voices.length > 200);
    check("数组项含 ShortName/Locale", voices[0].ShortName && voices[0].Locale);

    const r2 = await fetch(`${BASE}/api/voices?f=1&l=zh-CN`);
    const map = await r2.json();
    check("f=1 返回 ShortName→LocalName 映射", map["zh-CN-XiaoxiaoNeural"] === "晓晓");

    const r3 = await fetch(`${BASE}/api/voices?f=0&l=zh-CN`);
    const yaml = await r3.text();
    check("f=0 返回 MultiTTS YAML 格式", yaml.includes("org.nobody.multitts.tts.speaker.Speaker"));

    const r4 = await fetch(`${BASE}/api/voices`, { method: "POST" });
    check("POST 返回 405", r4.status === 405);
    await r4.arrayBuffer();
  }

  console.log("\n[/api/check-password]");
  {
    const r1 = await fetch(`${BASE}/api/check-password`);
    const d1 = await r1.json();
    check("返回 requirePassword 布尔值", typeof d1.requirePassword === "boolean");
  }

  console.log("\n[/api/verify-password]");
  {
    const r1 = await fetch(`${BASE}/api/verify-password`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: "wrong" }),
    });
    const d1 = await r1.json();
    check("未设密码时任意密码返回 200 valid", r1.status === 200 && d1.valid === true);

    const r2 = await fetch(`${BASE}/api/verify-password`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not-json",
    });
    check("未设密码时非法 JSON 也放行（优先判断密码未设置）", r2.status === 200);
    await r2.json();
  }

  console.log("\n[静态资源]");
  {
    const r1 = await fetch(`${BASE}/speakers.json`);
    const speakers = await r1.json();
    check("speakers.json 可访问且含 edge-api", r1.status === 200 && speakers["edge-api"].speakers);
    const r2 = await fetch(`${BASE}/image/TTS.png`);
    check("favicon 可访问", r2.status === 200);
    await r2.arrayBuffer();
    const r3 = await fetch(`${BASE}/`);
    const html = await r3.text();
    check("首页包含标题", html.includes("文本转语音"));
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
