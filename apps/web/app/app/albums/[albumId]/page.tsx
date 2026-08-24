"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api, fileSrc, MediaItem } from "../../../../lib/api";
import { useSpace } from "../../../../lib/space";

type Album = { id: string; name: string; items: { id: string; thumbnailUrl: string; status: string }[] };

export default function AlbumDetailPage() {
  const { albumId } = useParams<{ albumId: string }>();
  const { spaceId, ready } = useSpace();
  const router = useRouter();
  const [album, setAlbum] = useState<Album | null>(null);
  const [picker, setPicker] = useState(false);
  const [library, setLibrary] = useState<MediaItem[]>([]);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [msg, setMsg] = useState("");

  async function load() {
    if (!spaceId) return;
    setAlbum((await api.album(spaceId, albumId)) as Album);
  }

  useEffect(() => {
    if (ready && spaceId) load();
  }, [ready, spaceId, albumId]);

  async function openPicker() {
    if (!spaceId) return;
    const data = await api.media(spaceId);
    setLibrary(data.items);
    setPicker(true);
  }

  async function addSelected() {
    if (!spaceId) return;
    const ids = Object.keys(selected).filter((k) => selected[k]);
    if (!ids.length) {
      setMsg("请先点选要加入的图片");
      return;
    }
    const updated = (await api.addAlbumItems(spaceId, albumId, ids)) as Album;
    setAlbum(updated);
    setPicker(false);
    setSelected({});
  }

  async function shareAlbum() {
    if (!spaceId) return;
    const share = await api.createShare(spaceId, {
      targetType: "ALBUM",
      targetId: albumId,
      accessMode: "PUBLIC",
    });
    const url = `${window.location.origin}${share.path}`;
    await navigator.clipboard?.writeText(url).catch(() => undefined);
    setMsg("分享链接已复制：" + url);
  }

  async function makeSlideshow() {
    if (!spaceId || !album) return;
    const res = await fetch(`/backend/spaces/${spaceId}/slideshows`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: album.name + " 幻灯片",
        albumId: album.id,
        transition: "cross_fade",
      }),
    });
    const body = await res.json();
    router.push(`/app/slideshows/${body.id}/play`);
  }

  if (!album) {
    return (
      <div className="library">
        <p>加载相册…</p>
      </div>
    );
  }

  return (
    <div className="library">
      <div className="row" style={{ marginBottom: 16, flexWrap: "wrap" }}>
        <h3 className="date-h" style={{ margin: 0, flex: 1 }}>
          {album.name}
        </h3>
        <button className="btn ghost" style={{ width: "auto" }} onClick={openPicker}>
          添加图片
        </button>
        <button className="btn ghost" style={{ width: "auto" }} onClick={makeSlideshow}>
          播放幻灯片
        </button>
        <button className="btn" style={{ width: "auto" }} onClick={shareAlbum}>
          分享相册
        </button>
      </div>
      {msg ? <p className="sub">{msg}</p> : null}
      {album.items.length === 0 ? (
        <div className="empty">
          <h3>空 Album</h3>
          <p>添加图片，不会复制存储文件。</p>
        </div>
      ) : (
        <div className="grid">
          {album.items.map((it) => (
            <div key={it.id} className="tile">
              <img src={fileSrc(it.thumbnailUrl)} alt="" />
            </div>
          ))}
        </div>
      )}
      {picker ? (
        <div className="modal" onClick={() => setPicker(false)}>
          <div className="card" style={{ width: "min(720px, 92vw)", maxHeight: "80vh", overflow: "auto" }} onClick={(e) => e.stopPropagation()}>
            <h2>选择图片</h2>
            <p className="sub">同一张图片可以加入多个相册。</p>
            <div className="grid compact">
              {library.map((it) => (
                <button
                  key={it.id}
                  className={`tile ${selected[it.id] ? "picked" : ""}`}
                  onClick={() => setSelected((s) => ({ ...s, [it.id]: !s[it.id] }))}
                >
                  <img src={fileSrc(it.thumbnailUrl)} alt="" />
                </button>
              ))}
            </div>
            <div className="row" style={{ marginTop: 16 }}>
              <button className="btn" style={{ width: "auto" }} onClick={addSelected}>
                加入相册
              </button>
              <button className="btn ghost" style={{ width: "auto" }} onClick={() => setPicker(false)}>
                取消
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
