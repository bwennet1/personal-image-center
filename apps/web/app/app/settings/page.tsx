"use client";

import { FormEvent, useState } from "react";
import { api } from "../../../lib/api";
import { useSpace } from "../../../lib/space";

export default function SettingsPage() {
  const { refresh } = useSpace();
  const [name, setName] = useState("我的家庭");
  const [type, setType] = useState("FAMILY");
  const [msg, setMsg] = useState("");

  async function create(e: FormEvent) {
    e.preventDefault();
    const space = await api.createSpace(name, type);
    await refresh();
    setMsg(`已创建 ${space.name}，可在顶栏切换，无需退出登录。`);
  }

  return (
    <div className="library">
      <div className="card" style={{ minHeight: 280 }}>
        <h2>创建空间</h2>
        <p className="sub">一个账号可以加入多个 Personal / Family / Team 空间。</p>
        <form onSubmit={create}>
          <label>名称</label>
          <input value={name} onChange={(e) => setName(e.target.value)} />
          <label>类型</label>
          <select value={type} onChange={(e) => setType(e.target.value)}>
            <option value="PERSONAL">Personal</option>
            <option value="FAMILY">Family</option>
            <option value="TEAM">Team</option>
          </select>
          <button className="btn" type="submit">
            创建
          </button>
        </form>
        <p className="sub">{msg}</p>
      </div>
    </div>
  );
}
