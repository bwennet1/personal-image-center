"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { SlideshowPlayer } from "../../../components/SlideshowPlayer";

type Block = { id: string; type: string; data: Record<string, unknown> };

export default function PublishPage() {
  const { publishToken } = useParams<{ publishToken: string }>();
  const [doc, setDoc] = useState<{
    title: string;
    theme: string;
    musicUrl?: string | null;
    spaceId: string;
    blocks: Block[];
    referencedMediaAssetIds: string[];
  } | null>(null);

  useEffect(() => {
    fetch(`/backend/public/presentations/${publishToken}`, { credentials: "include" })
      .then((r) => r.json())
      .then(setDoc);
  }, [publishToken]);

  if (!doc) {
    return (
      <div className="pres">
        <p>加载纪念页…</p>
      </div>
    );
  }

  function img(id?: unknown) {
    if (typeof id !== "string") return null;
    return `/backend/public/presentations/${publishToken}/file/${id}`;
  }

  return (
    <main className="pres">
      {doc.blocks.map((b) => {
        if (b.type === "cover") {
          return (
            <section key={b.id} className="cover">
              <h1>{String(b.data.heading || doc.title)}</h1>
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
          const ids = (b.data.mediaAssetIds as string[]) || doc.referencedMediaAssetIds;
          return (
            <section key={b.id} className="gallery-row">
              {ids.slice(0, 8).map((id) => (
                <img key={id} src={img(id) || ""} alt="" />
              ))}
            </section>
          );
        }
        if (b.type === "image") {
          const src = img(b.data.mediaAssetId);
          return src ? <img key={b.id} src={src} alt="" style={{ width: "100%", borderRadius: 16 }} /> : null;
        }
        if (b.type === "slideshow") {
          const ids = doc.referencedMediaAssetIds || [];
          return (
            <section key={b.id}>
              <SlideshowPlayer
                items={ids.map((id) => ({ url: img(id) || "" })).filter((it) => it.url)}
                transition="cross_fade"
                stayMs={6000}
                musicUrl={doc.musicUrl}
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
  );
}
