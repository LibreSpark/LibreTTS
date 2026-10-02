// 端到端契约测试编排：拉起两台生产服务器（开放实例 + 密码门实例），跑完立即回收进程。
// 用法：npm run build && node tests/run-api.mjs
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";

const OPEN_PORT = 3300;
const GATED_PORT = 3310;
const TEST_PASSWORD = "correct horse";
const NEXT_BIN = "node_modules/next/dist/bin/next";

function startServer(port, env) {
  const child = spawn(process.execPath, [NEXT_BIN, "start", "-p", String(port), "-H", "127.0.0.1"], {
    env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1", ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (d) => process.stdout.write(`[:${port}] ${d}`));
  child.stderr.on("data", (d) => process.stderr.write(`[:${port}] ${d}`));
  return child;
}

async function stop(child, port) {
  if (!child || child.exitCode !== null) return;
  await new Promise((resolve) => {
    child.once("exit", resolve);
    child.kill();
    setTimeout(() => {
      child.kill(9);
      resolve();
    }, 8000);
  });
  console.log(`[:${port}] 已停止`);
}

/** 端口上已有服务：可能是上一轮遗留进程，继续跑会测到旧构建，直接失败 */
async function probe(port) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/check-password`, { signal: AbortSignal.timeout(1500) });
    return res.status < 500;
  } catch {
    return false;
  }
}

async function waitForReady(port, child, timeoutMs = 90000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`端口 ${port} 的服务器提前退出（code=${child.exitCode}）`);
    if (await probe(port)) return;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`端口 ${port} 的服务器启动超时`);
}

function runSuite(file, port, env) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [file, `http://127.0.0.1:${port}`], {
      env: { ...process.env, ...env },
      stdio: "inherit",
    });
    child.on("exit", (code) => resolve(code ?? 1));
  });
}

if (!existsSync(".next/BUILD_ID")) {
  console.error("缺少构建产物（.next/BUILD_ID），请先运行 npm run build");
  process.exit(1);
}

for (const port of [OPEN_PORT, GATED_PORT]) {
  if (await probe(port)) {
    console.error(`端口 ${port} 已有服务在跑，可能是上一轮遗留的旧构建；请先结束后重试`);
    process.exit(1);
  }
}

const open = startServer(OPEN_PORT, {});
const gated = startServer(GATED_PORT, { PASSWORD: TEST_PASSWORD });
let failed = 0;

try {
  await Promise.all([waitForReady(OPEN_PORT, open), waitForReady(GATED_PORT, gated)]);
  failed += await runSuite("tests/api.test.mjs", OPEN_PORT, {});
  failed += await runSuite("tests/auth.test.mjs", GATED_PORT, { TEST_PASSWORD });
} catch (err) {
  console.error("编排失败:", err.message);
  failed += 1;
} finally {
  await Promise.all([stop(open, OPEN_PORT), stop(gated, GATED_PORT)]);
}

console.log(failed ? "\n端到端测试未通过" : "\n端到端测试全部通过");
process.exit(failed ? 1 : 0);
