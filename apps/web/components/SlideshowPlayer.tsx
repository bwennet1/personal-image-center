"use client";

import { useEffect, useMemo, useState } from "react";
import { fileSrc } from "../lib/api";

export type SlideItem = { url: string; failed?: boolean };

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
  const playable = useMemo(() => items.filter((it) => it.url && !it.failed), [items]);
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [musicHint, setMusicHint] = useState("");

  useEffect(() => {
    setIndex(0);
  }, [playable.length]);

  useEffect(() => {
    if (paused || playable.length === 0) return;
    const t = setInterval(() => {
      setIndex((x) => (x + 1) % playable.length);
    }, stayMs || 6000);
    return () => clearInterval(t);
  }, [paused, playable.length, stayMs]);

  const current = playable[index];
  const cls = `player ${compact ? "compact" : ""} ${transition === "ken_burns" ? "ken" : ""} ${transition === "fade_to_black" ? "fade-black" : ""}`;

  function skip(dir: 1 | -1) {
    if (!playable.length) return;
    setIndex((x) => (x + dir + playable.length) % playable.length);
  }

  return (
    <div className={cls} data-slideshow-player>
      <div className="player-stage">
        {current ? (
          <img
            key={current.url + index}
            src={fileSrc(current.url)}
            alt=""
            onError={() => skip(1)}
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
          {playable.length ? `${index + 1} / ${playable.length}` : "0 / 0"}
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
