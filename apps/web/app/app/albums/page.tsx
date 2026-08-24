"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { api, fileSrc } from "../../../lib/api";
import { useSpace } from "../../../lib/space";

type Album = { id: string; name: string; itemCount: number; coverUrl?: string | null };

export default function AlbumsPage() {
  const { spaceId, ready } = useSpace();
  const [albums, setAlbums] = useState<Album[]>([]);
  const [name, setName] = useState("");

  async function load(id: string) {
    setAlbums((await api.albums(id)) as Album[]);
  }

  useEffect(() => {
    if (ready && spaceId) load(spaceId);
  }, [ready, spaceId]);

  async function create(e: FormEvent) {
    e.preventDefault();
    if (!spaceId) return;
    await fetch(`/backend/spaces/${spaceId}/albums`, {
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
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="新相册名称" style={{ maxWidth: 280, margin: 0 }} />
        <button className="btn" style={{ width: "auto" }} type="submit">
          创建相册
        </button>
      </form>
      {albums.length === 0 ? (
        <div className="empty">
          <h3>还没有相册</h3>
          <p>相册是逻辑集合，加入图片不会复制文件。</p>
        </div>
      ) : (
        <div className="grid">
          {albums.map((a) => (
            <Link key={a.id} href={`/app/albums/${a.id}`} className="tile album-tile">
              {a.coverUrl ? <img src={fileSrc(a.coverUrl)} alt="" /> : <span className="tile-status">空相册</span>}
              <span className="tile-caption">
                <strong>{a.name}</strong>
                <em>{a.itemCount} 张</em>
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
