"use client";

import { FormEvent, useEffect, useState } from "react";
import { api } from "../../../lib/api";
import { useSpace } from "../../../lib/space";

type Pres = { id: string; title: string; preset: string | null; published: boolean; publishToken: string | null };

export default function PresentationsPage() {
  const { spaceId, ready } = useSpace();
  const [items, setItems] = useState<Pres[]>([]);
  const [preset, setPreset] = useState("family_memorial");

  async function load(id: string) {
    setItems((await api.presentations(id)) as Pres[]);
  }

  useEffect(() => {
    if (ready && spaceId) load(spaceId);
  }, [ready, spaceId]);

  async function create(e: FormEvent) {
    e.preventDefault();
    if (!spaceId) return;
    const media = await api.media(spaceId);
    const created = await fetch(`/backend/spaces/${spaceId}/presentations`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        preset,
        mediaAssetIds: media.items.filter((i) => i.status === "READY" || i.status === "PARTIAL_READY").map((i) => i.id),
      }),
    }).then((r) => r.json());
    await fetch(`/backend/spaces/${spaceId}/presentations/${created.id}/publish`, {
      method: "POST",
      credentials: "include",
    });
    load(spaceId);
  }

  return (
    <div className="library">
      <form className="row" onSubmit={create} style={{ marginBottom: 20 }}>
        <select value={preset} onChange={(e) => setPreset(e.target.value)} style={{ width: 200, margin: 0 }}>
          <option value="family_memorial">家庭纪念</option>
          <option value="travel">旅行记录</option>
          <option value="year_in_review">年度回忆</option>
          <option value="portfolio">摄影作品集</option>
        </select>
        <button className="btn" style={{ width: "auto" }} type="submit">
          创建并发布
        </button>
      </form>
      {items.length === 0 ? (
        <div className="empty">
          <h3>家庭纪念网页是 Presentation Engine 的预设</h3>
          <p>同一张图片可以被多个纪念页引用，不必复制对象存储文件。</p>
        </div>
      ) : (
        <ul className="plain-list">
          {items.map((p) => (
            <li key={p.id}>
              {p.title} · {p.preset}{" "}
              {p.publishToken ? (
                <a href={`/p/${p.publishToken}`} style={{ color: "var(--gold)" }}>
                  打开发布页
                </a>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
