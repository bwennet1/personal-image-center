"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { api } from "../../../lib/api";
import { useSpace } from "../../../lib/space";

type Show = { id: string; title: string; transition: string };

export default function SlideshowsPage() {
  const { spaceId, ready } = useSpace();
  const [items, setItems] = useState<Show[]>([]);
  const [title, setTitle] = useState("周末幻灯片");
  const [transition, setTransition] = useState("cross_fade");

  async function load(id: string) {
    const rows = (await api.slideshows(id)) as Show[];
    setItems(rows);
  }

  useEffect(() => {
    if (ready && spaceId) load(spaceId);
  }, [ready, spaceId]);

  async function create(e: FormEvent) {
    e.preventDefault();
    if (!spaceId) return;
    const media = await api.media(spaceId);
    await fetch(`/backend/spaces/${spaceId}/slideshows`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title,
        transition,
        mediaAssetIds: media.items.filter((i) => i.status === "READY" || i.status === "PARTIAL_READY").map((i) => i.id),
      }),
    });
    load(spaceId);
  }

  return (
    <div className="library">
      <form onSubmit={create} className="row" style={{ marginBottom: 20, flexWrap: "wrap" }}>
        <input value={title} onChange={(e) => setTitle(e.target.value)} style={{ maxWidth: 220, margin: 0 }} />
        <select value={transition} onChange={(e) => setTransition(e.target.value)} style={{ width: 180, margin: 0 }}>
          <option value="cross_fade">Cross Fade</option>
          <option value="fade_to_black">Fade to Black</option>
          <option value="slide">Slide</option>
          <option value="zoom">Zoom</option>
          <option value="ken_burns">Ken Burns</option>
          <option value="none">None</option>
        </select>
        <button className="btn" style={{ width: "auto" }} type="submit">
          从图库创建
        </button>
      </form>
      {items.length === 0 ? (
        <div className="empty">
          <h3>幻灯片是一等公民</h3>
          <p>相册决定有哪些图片，幻灯片决定如何播放。</p>
        </div>
      ) : (
        <ul className="plain-list">
          {items.map((s) => (
            <li key={s.id}>
              {s.title} · {s.transition}{" "}
              <Link href={`/app/slideshows/${s.id}/play`} style={{ color: "var(--gold)" }}>
                播放
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
