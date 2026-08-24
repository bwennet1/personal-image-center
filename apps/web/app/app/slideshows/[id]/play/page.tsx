"use client";

import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { SlideshowPlayer } from "../../../../../components/SlideshowPlayer";
import { useSpace } from "../../../../../lib/space";

type Item = { assetId: string; failed?: boolean; url: string };

export default function PlayPage() {
  const params = useParams<{ id: string }>();
  const { spaceId, ready } = useSpace();
  const [show, setShow] = useState<{
    title: string;
    transition: string;
    stayDurationMs: number;
    musicUrl?: string | null;
    items: Item[];
  } | null>(null);

  useEffect(() => {
    if (!ready || !spaceId) return;
    fetch(`/backend/spaces/${spaceId}/slideshows/${params.id}`, { credentials: "include" })
      .then((r) => r.json())
      .then(setShow);
  }, [params.id, spaceId, ready]);

  if (!show) {
    return (
      <div className="library">
        <p>加载幻灯片…</p>
      </div>
    );
  }

  return (
    <div className="library" style={{ paddingTop: 0 }}>
      <SlideshowPlayer
        items={show.items.map((it) => ({ url: it.url, failed: it.failed }))}
        transition={show.transition}
        stayMs={show.stayDurationMs}
        musicUrl={show.musicUrl}
      />
    </div>
  );
}
