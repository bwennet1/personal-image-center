"use client";

import { FormEvent, useEffect, useState } from "react";
import { api } from "../../../lib/api";
import { useSpace } from "../../../lib/space";

type Folder = { id: string; name: string; parentId: string | null };

export default function FoldersPage() {
  const { spaceId, ready } = useSpace();
  const [folders, setFolders] = useState<Folder[]>([]);
  const [name, setName] = useState("");

  async function load(id: string) {
    setFolders((await api.folders(id)) as Folder[]);
  }

  useEffect(() => {
    if (ready && spaceId) load(spaceId);
  }, [ready, spaceId]);

  async function create(e: FormEvent) {
    e.preventDefault();
    if (!spaceId) return;
    await fetch(`/backend/spaces/${spaceId}/folders`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    setName("");
    load(spaceId);
  }

  return (
    <div className="library">
      <form className="row" onSubmit={create} style={{ marginBottom: 20 }}>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="新文件夹" style={{ maxWidth: 280, margin: 0 }} />
        <button className="btn" style={{ width: "auto" }} type="submit">
          创建文件夹
        </button>
      </form>
      {folders.length === 0 ? (
        <div className="empty">
          <h3>还没有文件夹</h3>
          <p>文件夹是树形目录。一张图片默认只有一个主位置。</p>
        </div>
      ) : (
        <ul>
          {folders.map((f) => (
            <li key={f.id}>{f.name}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
