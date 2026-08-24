"use client";

import { useEffect, useState } from "react";
import { api } from "../../../lib/api";
import { useSpace } from "../../../lib/space";

type Share = { id: string; token: string; targetType: string; accessMode: string };

export default function SharedPage() {
  const { spaceId, ready } = useSpace();
  const [items, setItems] = useState<Share[]>([]);

  useEffect(() => {
    if (ready && spaceId) api.shares(spaceId).then((rows) => setItems(rows as Share[]));
  }, [ready, spaceId]);

  return (
    <div className="library">
      {items.length === 0 ? (
        <div className="empty">
          <h3>还没有分享链接</h3>
          <p>分享是授权视图，不会把存储桶设为公开。</p>
        </div>
      ) : (
        <ul className="plain-list">
          {items.map((s) => (
            <li key={s.id}>
              {s.targetType} · {s.accessMode} · <a href={`/s/${s.token}`}>{s.token}</a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
