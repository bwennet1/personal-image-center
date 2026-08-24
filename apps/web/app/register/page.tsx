"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { api, SPACE_KEY } from "../../lib/api";
import { zh } from "../../lib/i18n";

export default function RegisterPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [err, setErr] = useState("");

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setErr("");
    try {
      const me = await api.register(email, password, displayName);
      if (me.spaces[0]) localStorage.setItem(SPACE_KEY, me.spaces[0].id);
      router.push("/app/photos");
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : "注册失败");
    }
  }

  return (
    <div className="auth-shell">
      <section className="auth-brand">
        <div>
          <div className="mark" />
          <h1>{zh.appName}</h1>
          <p>注册后会自动拥有一个个人空间，随后可以再创建家庭或团队空间。</p>
        </div>
        <p>多空间切换无需退出登录。</p>
      </section>
      <section className="auth-panel">
        <form className="card" onSubmit={onSubmit}>
          <h2>{zh.register}</h2>
          <p className="sub">使用邮箱和密码创建账号。</p>
          <label htmlFor="displayName">{zh.displayName}</label>
          <input id="displayName" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
          <label htmlFor="email">{zh.email}</label>
          <input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          <label htmlFor="password">{zh.password}</label>
          <input
            id="password"
            type="password"
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
          <p className="err">{err}</p>
          <button className="btn" type="submit">
            {zh.register}
          </button>
          <p className="switch">
            已有账号？ <Link href="/login">{zh.login}</Link>
          </p>
        </form>
      </section>
    </div>
  );
}
