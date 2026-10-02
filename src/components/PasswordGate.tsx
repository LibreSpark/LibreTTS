"use client";

// 密码验证弹窗：页面加载时询问服务端是否需要密码，验证通过后由浏览器持有 HttpOnly 会话 cookie。
// 授权状态一律以服务端为准——localStorage 标记可被访问者自行改写，不能当作访问控制。
import { useEffect, useState } from "react";
import { useToast } from "./ToastProvider";

export default function PasswordGate({ children }: { children: React.ReactNode }) {
  const [showModal, setShowModal] = useState(false);
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const { show } = useToast();

  useEffect(() => {
    fetch("/api/check-password")
      .then((res) => res.json())
      .then((data: { requirePassword?: boolean; authenticated?: boolean }) => {
        if (data.requirePassword && !data.authenticated) setShowModal(true);
      })
      .catch((err) => console.error("检查密码需求失败", err));
  }, []);

  async function submit() {
    try {
      const res = await fetch("/api/verify-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const result = await res.json();
      if (res.status === 200 && result.valid) {
        setShowModal(false);
        setError("");
        show("验证通过", "success");
      } else {
        setError(result.message || result.error || "密码错误");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "验证失败");
    }
  }

  return (
    <>
      {children}
      {showModal && (
        <div className="fixed inset-0 z-[1000] flex items-start justify-center bg-black/50">
          <div className="mt-[15vh] w-[90%] max-w-sm rounded-xl bg-white shadow-xl">
            <div className="px-6 pt-5 pb-2">
              <h5 className="text-base font-medium text-slate-800">请输入访问密码</h5>
            </div>
            <div className="px-6 pb-2">
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && submit()}
                placeholder="密码"
                className="w-full rounded-[10px] border border-primary/15 px-3 py-2 text-sm outline-none transition-all focus:border-primary-light focus:ring-[3px] focus:ring-primary-soft"
                autoFocus
              />
              {error && <div className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</div>}
            </div>
            <div className="flex justify-end px-6 py-4">
              <button
                type="button"
                onClick={submit}
                className="rounded-[10px] bg-primary px-4 py-2 text-sm font-medium text-white transition-all hover:bg-primary-dark active:scale-[0.98]"
              >
                提交
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
