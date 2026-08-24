"use client";

import { FormEvent, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { fileSrc } from "../../../lib/api";
import { SlideshowPlayer } from "../../../components/SlideshowPlayer";

type AlbumPayload = {
  id: string;
  name: string;
  items: { id: string; thumbnailUrl: string }[];
};

type SlideshowPayload = {
  title?: string;
  items?: { url: string; assetId?: string; failed?: boolean }[];
  transition?: string;
  stayDurationMs?: number;
  musicUrl?: string | null;
};

type PresentationBlock = { id: string; type: string; data: Record<string, unknown> };

type PresentationPayload = {
  id: string;
  title: string;
  theme?: string;
  coverAssetId?: string | null;
  blocks: PresentationBlock[];
  referencedMediaAssetIds?: string[];
};

export default function SharePage() {
  const { shareToken } = useParams<{ shareToken: string }>();
  const [data, setData] = useState<Record<string, unknown> | null>(null);
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(true);

  async function load() {
    const res = await fetch(`/backend/public/shares/${shareToken}`, { credentials: "include" });
    const body = await res.json();
    setLoading(false);
    if (!res.ok) {
      setCode(body.code || "SHARE_NOT_FOUND");
      setData(null);
      return;
    }
    setCode("");
    setData(body);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shareToken]);

  async function verify(e: FormEvent) {
    e.preventDefault();
    setErr("");
    const res = await fetch(`/backend/public/shares/${shareToken}/password`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    const body = await res.json();
    if (!res.ok) {
      setErr(body.message || body.code);
      return;
    }
    load();
  }

  if (code === "SHARE_PASSWORD_REQUIRED") {
    return (
      <div className="auth-panel" style={{ minHeight: "100vh" }}>
        <form className="card" onSubmit={verify}>
          <h2>分享受密码保护</h2>
          <p className="sub">密码不会出现在链接里。</p>
          <label>密码</label>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
          <p className="err">{err}</p>
          <button className="btn" type="submit">
            进入
          </button>
        </form>
      </div>
    );
  }

  if (code) {
    const map: Record<string, string> = {
      SHARE_EXPIRED: "分享已过期",
      SHARE_REVOKED: "分享已撤销",
      SHARE_NOT_FOUND: "分享不存在",
      SHARE_TARGET_GONE: "内容已不可用",
      SHARE_MAX_VIEWS: "已达到查看次数上限",
      SHARE_LOGIN_REQUIRED: "需要登录后查看",
    };
    return (
      <div className="auth-panel" style={{ minHeight: "100vh" }}>
        <div className="card">
          <h2>{map[code] || code}</h2>
        </div>
      </div>
    );
  }

  if (loading || !data) {
    return (
      <div className="pres">
        <p>加载分享…</p>
      </div>
    );
  }

  const media = data.media as { optimizedUrl?: string; id?: string } | undefined;
  const slideshow = data.slideshow as SlideshowPayload | undefined;
  const album = data.album as AlbumPayload | undefined;
  const presentation = data.presentation as PresentationPayload | undefined;

  function shareFile(id?: unknown, variant = "optimized") {
    if (typeof id !== "string") return null;
    return `/backend/public/shares/${shareToken}/file/${id}?v=${variant}`;
  }

  return (
    <div className="pres">
      {media?.optimizedUrl ? (
        <div data-share-kind="media">
          <img src={fileSrc(media.optimizedUrl)} alt="" style={{ width: "100%", borderRadius: 16 }} />
        </div>
      ) : null}
      {slideshow ? (
        <div data-share-kind="slideshow">
          <h1>{slideshow.title}</h1>
          <SlideshowPlayer
            items={(slideshow.items || []).map((it) => ({ url: it.url, failed: it.failed }))}
            transition={slideshow.transition || "cross_fade"}
            stayMs={slideshow.stayDurationMs || 6000}
            musicUrl={slideshow.musicUrl}
            compact
          />
        </div>
      ) : null}
      {album ? (
        <div data-share-kind="album">
          <h1>{album.name}</h1>
          <section className="gallery-row">
            {album.items.map((it) => (
              <img key={it.id} src={fileSrc(it.thumbnailUrl)} alt="" />
            ))}
          </section>
        </div>
      ) : null}
      {presentation ? (
        <main data-share-kind="presentation">
          {presentation.blocks.map((b) => {
            if (b.type === "cover") {
              return (
                <section key={b.id} className="cover">
                  <h1>{String(b.data.heading || presentation.title)}</h1>
                  <p>{String(b.data.subtitle || "")}</p>
                </section>
              );
            }
            if (b.type === "text") {
              return (
                <section key={b.id}>
                  <h2>{String(b.data.heading || "")}</h2>
                  <p>{String(b.data.body || "")}</p>
                </section>
              );
            }
            if (b.type === "gallery" || b.type === "timeline") {
              const ids = (b.data.mediaAssetIds as string[]) || presentation.referencedMediaAssetIds || [];
              return (
                <section key={b.id} className="gallery-row">
                  {ids.map((id) => {
                    const src = shareFile(id);
                    return src ? <img key={id} src={src} alt="" /> : null;
                  })}
                </section>
              );
            }
            if (b.type === "image") {
              const src = shareFile(b.data.mediaAssetId);
              return src ? <img key={b.id} src={src} alt="" style={{ width: "100%", borderRadius: 16 }} /> : null;
            }
            if (b.type === "slideshow") {
              const ids = presentation.referencedMediaAssetIds || [];
              return (
                <section key={b.id}>
                  <SlideshowPlayer
                    items={ids.map((id) => ({ url: shareFile(id) || "" })).filter((it) => it.url)}
                    transition="cross_fade"
                    stayMs={6000}
                    compact
                  />
                </section>
              );
            }
            if (b.type === "ending") {
              return (
                <section key={b.id} style={{ padding: "48px 0", textAlign: "center" }}>
                  <h2>{String(b.data.heading || "谢谢")}</h2>
                </section>
              );
            }
            return (
              <section key={b.id}>
                <p style={{ color: "var(--muted)" }}>{b.type}</p>
              </section>
            );
          })}
        </main>
      ) : null}
    </div>
  );
}
