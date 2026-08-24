"use client";

import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { fileSrc } from "../../../../lib/api";
import { useSpace } from "../../../../lib/space";

export default function MediaPage() {
  const { mediaId } = useParams<{ mediaId: string }>();
  const { spaceId, ready } = useSpace();
  const [detail, setDetail] = useState<Record<string, unknown> | null>(null);

  useEffect(() => {
    if (!ready || !spaceId) return;
    fetch(`/backend/spaces/${spaceId}/media/${mediaId}`, { credentials: "include" })
      .then((r) => r.json())
      .then(setDetail);
  }, [mediaId, spaceId, ready]);

  const urls = (detail?.fileUrls || {}) as Record<string, string>;

  return (
    <div className="library">
      {urls.optimized_2560 ? (
        <img src={fileSrc(urls.optimized_2560)} alt="" style={{ maxWidth: "100%", borderRadius: 16 }} />
      ) : (
        <p>加载中…</p>
      )}
    </div>
  );
}
