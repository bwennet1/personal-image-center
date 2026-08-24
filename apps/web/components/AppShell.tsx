"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ReactNode, useEffect, useMemo, useState } from "react";
import { api, Me, SPACE_KEY, Space } from "../lib/api";
import { zh } from "../lib/i18n";
import { SpaceContext } from "../lib/space";

const NAV = [
  { href: "/app/photos", label: zh.photos },
  { href: "/app/albums", label: zh.albums },
  { href: "/app/folders", label: zh.folders },
  { href: "/app/favorites", label: zh.favorites },
  { href: "/app/timeline", label: zh.timeline },
  { href: "/app/slideshows", label: zh.slideshows },
  { href: "/app/presentations", label: zh.presentations },
  { href: "/app/shared", label: zh.shared },
  { href: "/app/trash", label: zh.trash },
  { href: "/app/settings", label: zh.settings },
];

function titleOf(pathname: string): string {
  if (pathname.startsWith("/app/photos")) return zh.photos;
  if (pathname.startsWith("/app/albums")) return zh.albums;
  if (pathname.startsWith("/app/folders")) return zh.folders;
  if (pathname.startsWith("/app/favorites")) return zh.favorites;
  if (pathname.startsWith("/app/timeline")) return zh.timeline;
  if (pathname.includes("/slideshows/") && pathname.endsWith("/play")) return "播放幻灯片";
  if (pathname.startsWith("/app/slideshows")) return zh.slideshows;
  if (pathname.startsWith("/app/presentations")) return zh.presentations;
  if (pathname.startsWith("/app/shared")) return zh.shared;
  if (pathname.startsWith("/app/trash")) return zh.trash;
  if (pathname.startsWith("/app/settings")) return zh.settings;
  if (pathname.startsWith("/app/media")) return "图片";
  return zh.appName;
}

export function AppShell({ children, title }: { children: ReactNode; title?: string }) {
  const pathname = usePathname();
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [spaceId, setSpaceId] = useState("");
  const [role, setRole] = useState("");
  const [ready, setReady] = useState(false);
  const [query, setQuery] = useState("");
  const heading = title || titleOf(pathname);
  const playMode = pathname.includes("/play");

  async function applyUser(u: Me, preferId?: string) {
    setMe(u);
    const saved = preferId || localStorage.getItem(SPACE_KEY);
    const pick = u.spaces.find((s) => s.id === saved) || u.spaces[0];
    if (pick) {
      setSpaceId(pick.id);
      setRole(pick.role);
      localStorage.setItem(SPACE_KEY, pick.id);
      window.dispatchEvent(new CustomEvent("pic-space", { detail: pick.id }));
    }
    setReady(true);
  }

  async function refresh(preferId?: string) {
    const u = await api.me();
    await applyUser(u, preferId);
  }

  useEffect(() => {
    api.me().then((u) => applyUser(u)).catch(() => router.push("/login"));
  }, [router]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    setQuery(new URLSearchParams(window.location.search).get("q") || "");
  }, [pathname]);

  function switchSpace(id: string) {
    const space = me?.spaces.find((s) => s.id === id);
    setSpaceId(id);
    setRole(space?.role || "");
    localStorage.setItem(SPACE_KEY, id);
    window.dispatchEvent(new CustomEvent("pic-space", { detail: id }));
  }

  const spaces: Space[] = me?.spaces || [];
  const ctx = useMemo(
    () => ({ spaceId, role, ready, refresh: () => refresh() }),
    [spaceId, role, ready],
  );

  return (
    <SpaceContext.Provider value={ctx}>
      <div className={`app ${playMode ? "play-mode" : ""}`}>
        <aside className="sidebar">
          <div className="brand">
            <i />
            {zh.appName}
          </div>
          <nav className="nav">
            {NAV.map((n) => (
              <Link
                key={n.href}
                href={n.href}
                className={
                  n.href === "/app/photos"
                    ? pathname === "/app/photos" || pathname === "/app"
                      ? "active"
                      : ""
                    : pathname === n.href || pathname.startsWith(n.href + "/")
                      ? "active"
                      : ""
                }
              >
                {n.label}
              </Link>
            ))}
          </nav>
        </aside>
        <div className="main">
          <header className="topbar">
            <h2>{heading}</h2>
            <div className="row">
              <form
                className="search-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  const next = query.trim();
                  router.push(next ? `/app/photos?q=${encodeURIComponent(next)}` : "/app/photos");
                }}
              >
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="搜索文件名或标签"
                  aria-label="搜索"
                />
              </form>
              <select value={spaceId} onChange={(e) => switchSpace(e.target.value)} aria-label={zh.space}>
                {spaces.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} · {s.role}
                  </option>
                ))}
              </select>
              <span style={{ color: "var(--muted)", fontSize: 13 }}>{me?.email}</span>
              <button
                className="btn ghost"
                style={{ width: "auto" }}
                onClick={() => api.logout().then(() => router.push("/login"))}
              >
                {zh.logout}
              </button>
            </div>
          </header>
          {ready ? children : <div className="library"><p className="sub">加载空间…</p></div>}
          <nav className="mobile-nav">
            <Link href="/app/photos">图片</Link>
            <Link href="/app/albums">相册</Link>
            <Link href="/app/photos">上传</Link>
            <Link href="/app/shared">分享</Link>
            <Link href="/app/settings">我的</Link>
          </nav>
        </div>
      </div>
    </SpaceContext.Provider>
  );
}
