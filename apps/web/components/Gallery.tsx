"use client";

import { ChangeEvent, DragEvent, useCallback, useEffect, useMemo, useState } from "react";
import { api, fileSrc, MediaItem } from "../lib/api";
import { zh } from "../lib/i18n";
import { useSpace } from "../lib/space";

function monthLabel(iso: string | null): string {
  if (!iso) return "未分组";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "未分组";
  return `${d.getFullYear()}年${d.getMonth() + 1}月`;
}

export function Gallery({ view, q }: { view?: string; q?: string }) {
  const { spaceId, ready, capabilities } = useSpace();
  const [items, setItems] = useState<MediaItem[]>([]);
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  const [busy, setBusy] = useState("");
  const [drag, setDrag] = useState(false);
  const [err, setErr] = useState("");
  const [layout, setLayout] = useState<"grid" | "masonry">("grid");
  const [selecting, setSelecting] = useState(false);
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const [albums, setAlbums] = useState<{ id: string; name: string }[]>([]);
  const [albumPick, setAlbumPick] = useState(false);
  const [toast, setToast] = useState("");

  const load = useCallback(
    async (id: string) => {
      if (!id) return;
      const data = await api.media(id, view, q);
      setItems(data.items);
    },
    [view, q],
  );

  useEffect(() => {
    if (!ready || !spaceId) return;
    load(spaceId).catch(() => setItems([]));
  }, [ready, spaceId, load]);

  useEffect(() => {
    if (!spaceId || view === "trash") return;
    const inflight = items.some((i) => i.status === "PROCESSING" || i.status === "UPLOADED");
    if (!inflight) return;
    const t = setInterval(() => load(spaceId).catch(() => undefined), 1200);
    return () => clearInterval(t);
  }, [items, spaceId, view, load]);

  const groups = useMemo(() => {
    const map = new Map<string, MediaItem[]>();
    for (const it of items) {
      const key = monthLabel(it.capturedAt || it.uploadedAt || null);
      const arr = map.get(key) || [];
      arr.push(it);
      map.set(key, arr);
    }
    return Array.from(map.entries());
  }, [items]);

  const selectedIds = useMemo(() => Object.keys(picked).filter((id) => picked[id]), [picked]);

  async function uploadList(files: FileList | File[]) {
    if (!files?.length || !spaceId) return;
    setErr("");
    setBusy("准备上传…");
    try {
      await api.uploadFiles(spaceId, files, (info) => {
        setBusy(`上传 ${info.index + 1}/${info.total} · ${info.name} ${info.pct}%`);
      });
      setBusy("处理图片…");
      await load(spaceId);
      for (let i = 0; i < 12; i++) {
        const data = await api.media(spaceId, view, q);
        setItems(data.items);
        if (!data.items.some((it) => it.status === "PROCESSING" || it.status === "UPLOADED")) break;
        await new Promise((r) => setTimeout(r, 700));
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : "上传失败");
    } finally {
      setBusy("");
    }
  }

  function onFiles(e: ChangeEvent<HTMLInputElement>) {
    if (e.target.files?.length) uploadList(e.target.files);
    e.target.value = "";
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    setDrag(false);
    if (e.dataTransfer.files?.length) uploadList(e.dataTransfer.files);
  }

  const readyItems = items.filter((i) => i.status === "READY" || i.status === "PARTIAL_READY" || view === "trash");
  const viewer = viewerIndex != null ? readyItems[viewerIndex] : null;
  const canOriginal = capabilities.includes("download_original");
  const canShare = capabilities.includes("create_share");
  const canDelete = capabilities.includes("delete_media");

  useEffect(() => {
    if (viewerIndex == null) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setViewerIndex(null);
      if (e.key === "ArrowRight") setViewerIndex((i) => (i == null ? i : Math.min(readyItems.length - 1, i + 1)));
      if (e.key === "ArrowLeft") setViewerIndex((i) => (i == null ? i : Math.max(0, i - 1)));
      if (e.key === "f" || e.key === "F") document.documentElement.requestFullscreen?.();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [viewerIndex, readyItems.length]);

  function togglePick(id: string) {
    setPicked((p) => ({ ...p, [id]: !p[id] }));
  }

  async function trashCurrent() {
    if (!viewer || !spaceId) return;
    await api.trash(spaceId, viewer.id);
    setViewerIndex(null);
    await load(spaceId);
  }

  async function restoreCurrent() {
    if (!viewer || !spaceId) return;
    await api.restore(spaceId, viewer.id);
    setViewerIndex(null);
    await load(spaceId);
  }

  async function toggleFav(id: string, on: boolean) {
    if (!spaceId) return;
    await api.favorite(spaceId, id, on);
    await load(spaceId);
  }

  async function shareCurrent() {
    if (!viewer || !spaceId) return;
    const share = await api.createShare(spaceId, {
      targetType: "MEDIA",
      targetId: viewer.id,
      accessMode: "PUBLIC",
    });
    const url = `${window.location.origin}${share.path}`;
    await navigator.clipboard?.writeText(url).catch(() => undefined);
    setToast("已复制分享链接");
  }

  async function batchTrash() {
    if (!spaceId) return;
    for (const id of selectedIds) await api.trash(spaceId, id);
    setPicked({});
    setSelecting(false);
    await load(spaceId);
  }

  async function batchFav() {
    if (!spaceId) return;
    for (const id of selectedIds) await api.favorite(spaceId, id, true);
    setPicked({});
    await load(spaceId);
  }

  async function openAlbumPick() {
    if (!spaceId) return;
    setAlbums((await api.albums(spaceId)) as { id: string; name: string }[]);
    setAlbumPick(true);
  }

  async function addToAlbum(albumId: string) {
    if (!spaceId) return;
    await api.addAlbumItems(spaceId, albumId, selectedIds);
    setAlbumPick(false);
    setPicked({});
    setSelecting(false);
    setToast("已加入相册");
  }

  async function batchSlideshow() {
    if (!spaceId || !selectedIds.length) return;
    const res = await fetch(`/backend/spaces/${spaceId}/slideshows`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "所选图片", transition: "cross_fade", mediaAssetIds: selectedIds }),
    });
    const body = await res.json();
    window.location.href = `/app/slideshows/${body.id}/play`;
  }

  return (
    <div
      className={`library ${drag ? "dropping" : ""}`}
      onDragOver={(e) => {
        e.preventDefault();
        setDrag(true);
      }}
      onDragLeave={() => setDrag(false)}
      onDrop={onDrop}
    >
      {view !== "trash" ? (
        <div className="row" style={{ marginBottom: 16, flexWrap: "wrap" }}>
          <label className="btn" style={{ width: "auto", cursor: "pointer" }}>
            {busy || zh.upload}
            <input
              id="gallery-upload"
              className="hidden"
              type="file"
              accept="image/jpeg,image/png,image/webp,image/avif,image/gif"
              multiple
              onChange={onFiles}
            />
          </label>
          <button className="btn ghost" style={{ width: "auto" }} onClick={() => setLayout(layout === "grid" ? "masonry" : "grid")}>
            {layout === "grid" ? "瀑布流" : "网格"}
          </button>
          <button
            className="btn ghost"
            style={{ width: "auto" }}
            onClick={() => {
              setSelecting((s) => !s);
              setPicked({});
            }}
          >
            {selecting ? "取消选择" : "多选"}
          </button>
          {q ? (
            <a className="btn ghost" style={{ width: "auto" }} href="/app/photos">
              清除搜索
            </a>
          ) : null}
          {busy ? <span className="sub" style={{ margin: 0 }}>{busy}</span> : null}
        </div>
      ) : null}
      {selecting && selectedIds.length > 0 ? (
        <div className="batch-bar">
          已选 {selectedIds.length}
          <button className="btn ghost" style={{ width: "auto" }} onClick={openAlbumPick}>
            加入相册
          </button>
          <button className="btn ghost" style={{ width: "auto" }} onClick={batchFav}>
            收藏
          </button>
          <button className="btn ghost" style={{ width: "auto" }} onClick={batchSlideshow}>
            幻灯片
          </button>
          <button className="btn ghost" style={{ width: "auto" }} onClick={batchTrash}>
            删除
          </button>
        </div>
      ) : null}
      {err ? <p className="err">{err}</p> : null}
      {items.length === 0 ? (
        <div className="empty">
          <h3>{q ? "没有匹配的图片" : view === "trash" ? "回收站是空的" : "还没有图片"}</h3>
          <p>
            {q
              ? "试试其他文件名或标签，或清除搜索。"
              : view === "trash"
                ? "删除的图片会在这里保留 30 天。"
                : zh.empty}
          </p>
        </div>
      ) : (
        groups.map(([label, group]) => (
          <section key={label}>
            <h3 className="date-h">{label}</h3>
            <div className={`grid compact ${layout === "masonry" ? "masonry" : ""}`}>
              {group.map((it) => {
                const processing = it.status === "PROCESSING" || it.status === "UPLOADED";
                const idx = readyItems.findIndex((r) => r.id === it.id);
                const ratio =
                  layout === "masonry" && it.width && it.height ? `${it.width} / ${it.height}` : "1 / 1";
                return (
                  <div
                    key={it.id}
                    className={`tile ${processing ? "processing" : ""} ${picked[it.id] ? "picked" : ""}`}
                    style={{ aspectRatio: ratio }}
                    onClick={() => {
                      if (processing) return;
                      if (selecting) togglePick(it.id);
                      else if (idx >= 0) setViewerIndex(idx);
                    }}
                  >
                    {processing ? (
                      <span className="tile-status">处理中</span>
                    ) : (
                      <img src={fileSrc(it.thumbnailUrl)} alt="" width={it.width || 400} height={it.height || 400} />
                    )}
                    {!processing && !selecting ? (
                      <button
                        type="button"
                        className="tile-heart"
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleFav(it.id, !it.favorite);
                        }}
                      >
                        {it.favorite ? "已收藏" : "收藏"}
                      </button>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </section>
        ))
      )}
      {viewer && spaceId && viewerIndex != null ? (
        <div className="viewer" onClick={() => setViewerIndex(null)}>
          <img
            src={fileSrc(`/spaces/${spaceId}/media/${viewer.id}/file?v=optimized_2560`)}
            alt=""
            onClick={(e) => e.stopPropagation()}
          />
          <div className="viewer-bar" onClick={(e) => e.stopPropagation()}>
            <button className="btn ghost" style={{ width: "auto" }} onClick={() => setViewerIndex(Math.max(0, viewerIndex - 1))}>
              上一张
            </button>
            <button
              className="btn ghost"
              style={{ width: "auto" }}
              onClick={() => setViewerIndex(Math.min(readyItems.length - 1, viewerIndex + 1))}
            >
              下一张
            </button>
            {view === "trash" ? (
              <button className="btn" style={{ width: "auto" }} onClick={restoreCurrent}>
                恢复
              </button>
            ) : (
              <>
                <a
                  className="btn ghost"
                  style={{ width: "auto" }}
                  href={fileSrc(`/spaces/${spaceId}/media/${viewer.id}/download?variant=optimized`)}
                >
                  下载优化图
                </a>
                {canOriginal ? (
                  <a
                    className="btn ghost"
                    style={{ width: "auto" }}
                    href={fileSrc(`/spaces/${spaceId}/media/${viewer.id}/download?variant=original`)}
                  >
                    下载原图
                  </a>
                ) : null}
                <button className="btn ghost" style={{ width: "auto" }} onClick={() => toggleFav(viewer.id, !viewer.favorite)}>
                  {viewer.favorite ? "已收藏" : "收藏"}
                </button>
                {canShare ? (
                  <button className="btn ghost" style={{ width: "auto" }} onClick={shareCurrent}>
                    分享
                  </button>
                ) : null}
                {canDelete ? (
                  <button className="btn ghost" style={{ width: "auto" }} onClick={trashCurrent}>
                    删除
                  </button>
                ) : null}
              </>
            )}
            <button className="btn ghost" style={{ width: "auto" }} onClick={() => setViewerIndex(null)}>
              关闭
            </button>
          </div>
        </div>
      ) : null}
      {albumPick ? (
        <div className="modal" onClick={() => setAlbumPick(false)}>
          <div className="card" onClick={(e) => e.stopPropagation()}>
            <h2>加入相册</h2>
            {albums.length === 0 ? <p className="sub">还没有相册，先去创建一个。</p> : null}
            <ul className="plain-list">
              {albums.map((a) => (
                <li key={a.id}>
                  <button className="btn ghost" style={{ width: "auto" }} onClick={() => addToAlbum(a.id)}>
                    {a.name}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}
      {toast ? <div className="notice">{toast}</div> : null}
    </div>
  );
}
