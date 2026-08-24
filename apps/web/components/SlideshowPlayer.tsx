"use client";

import { useEffect, useMemo, useState } from "react";
import { fileSrc } from "../lib/api";
import {
  applySlideLoadFailure,
  nextPlayableIndex,
  playableItems,
  type SlideshowPlayItem,
} from "../../api/src/domain/slideshow-player";

export type SlideItem = { url: string; failed?: boolean; assetId?: string };

function toPlayItems(items: SlideItem[], broken: Record<string, boolean>): SlideshowPlayItem[] {
  return items.map((it, i) => ({
    assetId: it.assetId || it.url || String(i),
    failed: Boolean(it.failed || (it.url && broken[it.url])),
  }));
}

export function SlideshowPlayer({
  items,
  transition = "cross_fade",
  stayMs = 6000,
  musicUrl,
  compact = false,
}: {
  items: SlideItem[];
  transition?: string;
  stayMs?: number;
  musicUrl?: string | null;
  compact?: boolean;
}) {
  const [broken, setBroken] = useState<Record<string, boolean>>({});
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [musicHint, setMusicHint] = useState("");
  const playItems = useMemo(() => toPlayItems(items, broken), [items, broken]);
  const live = playableItems(playItems);
  const playlistKey = items.map((it) => it.assetId || it.url).join("|");

  useEffect(() => {
    setIndex(0);
    setBroken({});
  }, [playlistKey]);

  useEffect(() => {
    if (paused || live.length === 0) return;
    const t = setInterval(() => {
      setIndex((from) => nextPlayableIndex(playItems, from, 1).index);
    }, stayMs || 6000);
    return () => clearInterval(t);
  }, [paused, stayMs, playItems, live.length]);

  const showing = items[index];
  const current = showing && !playItems[index]?.failed ? showing : null;
  const cls = `player ${compact ? "compact" : ""} t-${transition || "cross_fade"}`;

  function skip(dir: 1 | -1) {
    setIndex((from) => nextPlayableIndex(playItems, from, dir).index);
  }

  function onImgError() {
    const url = showing?.url;
    if (!url) return;
    const next = applySlideLoadFailure(playItems, index);
    setBroken((b) => ({ ...b, [url]: true }));
    setIndex(next.index);
  }

  return (
    <div className={cls} data-slideshow-player data-player-index={index}>
      <div className="player-stage">
        {current ? (
          <img
            key={current.url + index}
            src={fileSrc(current.url)}
            alt=""
            onError={onImgError}
          />
        ) : (
          <p>没有可播放的图片</p>
        )}
      </div>
      <div className="player-bar">
        <button type="button" className="btn ghost" style={{ width: "auto" }} onClick={() => setPaused((p) => !p)}>
          {paused ? "播放" : "暂停"}
        </button>
        <button type="button" className="btn ghost" style={{ width: "auto" }} onClick={() => skip(-1)}>
          上一张
        </button>
        <button type="button" className="btn ghost" style={{ width: "auto" }} onClick={() => skip(1)}>
          下一张
        </button>
        <span className="player-count">
          {live.length ? `${Math.max(1, live.findIndex((it) => it.assetId === playItems[index]?.assetId) + 1)} / ${live.length}` : "0 / 0"}
        </span>
        <button
          type="button"
          className="btn ghost"
          style={{ width: "auto" }}
          onClick={() => document.documentElement.requestFullscreen?.()}
        >
          全屏
        </button>
      </div>
      {musicUrl ? (
        <audio src={musicUrl} autoPlay loop onError={() => setMusicHint("音乐加载失败，幻灯片继续播放")} />
      ) : null}
      {musicHint ? <div className="notice">{musicHint}</div> : null}
    </div>
  );
}
