"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { api, SPACE_KEY } from "../../lib/api";
import { zh } from "../../lib/i18n";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setErr("");
    try {
      const me = await api.login(email, password);
      if (me.spaces[0]) localStorage.setItem(SPACE_KEY, me.spaces[0].id);
      router.push("/app/photos");
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : "登录失败");
    }
  }

  return (
    <div className="auth-shell">
      <section className="auth-brand">
        <div>
          <div className="mark" />
          <h1>{zh.appName}</h1>
          <p>{zh.tagline}</p>
        </div>
        <p>邮箱 + 密码始终可用，无需配置 OAuth。</p>
      </section>
      <section className="auth-panel">
        <form className="card" onSubmit={onSubmit}>
          <h2>{zh.login}</h2>
          <p className="sub">欢迎回来，继续整理你的图片。</p>
          <label htmlFor="email">{zh.email}</label>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          <label htmlFor="password">{zh.password}</label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
          <p className="err">{err}</p>
          <button className="btn" type="submit">
            {zh.login}
          </button>
          <p className="switch">
            还没有账号？ <Link href="/register">{zh.register}</Link>
          </p>
        </form>
      </section>
    </div>
  );
}
