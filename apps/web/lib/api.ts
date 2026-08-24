import { drainCursorPages } from "../../api/src/domain/cursor";

export type Space = { id: string; name: string; type: string; role: string; capabilities?: string[] };

export type Me = {
  id: string;
  email: string;
  displayName: string | null;
  spaces: Space[];
};

export type MediaItem = {
  id: string;
  width: number | null;
  height: number | null;
  capturedAt: string | null;
  uploadedAt?: string | null;
  status: string;
  favorite: boolean;
  thumbnailUrl: string;
};

async function parse(res: Response) {
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const err = new Error(data?.message || data?.code || res.statusText) as Error & { code?: string };
    err.code = data?.code;
    throw err;
  }
  return data;
}

function putWithProgress(url: string, file: File, onProgress?: (pct: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.withCredentials = true;
    xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
    xhr.upload.onprogress = (ev) => {
      if (ev.lengthComputable && onProgress) onProgress(Math.round((ev.loaded / ev.total) * 100));
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error("上传失败"));
    };
    xhr.onerror = () => reject(new Error("上传失败"));
    xhr.send(file);
  });
}

export const api = {
  me: () => fetch("/backend/auth/me", { credentials: "include" }).then(parse) as Promise<Me>,
  login: (email: string, password: string) =>
    fetch("/backend/auth/login", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    }).then(parse) as Promise<Me>,
  register: (email: string, password: string, displayName?: string) =>
    fetch("/backend/auth/register", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, displayName }),
    }).then(parse) as Promise<Me>,
  logout: () => fetch("/backend/auth/logout", { method: "POST", credentials: "include" }).then(parse),
  spaces: () => fetch("/backend/spaces", { credentials: "include" }).then(parse) as Promise<Space[]>,
  async media(spaceId: string, view?: string, q?: string) {
    const items = await drainCursorPages<MediaItem>(async (cursor) => {
      const sp = new URLSearchParams();
      if (view) sp.set("view", view);
      if (q) sp.set("q", q);
      if (cursor) sp.set("cursor", cursor);
      sp.set("limit", "40");
      return (await fetch(`/backend/spaces/${spaceId}/media?${sp.toString()}`, { credentials: "include" }).then(
        parse,
      )) as { items: MediaItem[]; hasMore: boolean; nextCursor?: string | null };
    });
    return { items, hasMore: false, nextCursor: null as string | null };
  },
  mediaDetail: (spaceId: string, id: string) =>
    fetch(`/backend/spaces/${spaceId}/media/${id}`, { credentials: "include" }).then(parse),
  trash: (spaceId: string, id: string) =>
    fetch(`/backend/spaces/${spaceId}/media/${id}`, { method: "DELETE", credentials: "include" }).then(parse),
  restore: (spaceId: string, id: string) =>
    fetch(`/backend/spaces/${spaceId}/media/${id}/restore`, { method: "POST", credentials: "include" }).then(parse),
  favorite: (spaceId: string, id: string, on: boolean) =>
    fetch(`/backend/spaces/${spaceId}/media/${id}/favorite`, {
      method: on ? "POST" : "DELETE",
      credentials: "include",
    }).then(parse),
  albums: (spaceId: string) => fetch(`/backend/spaces/${spaceId}/albums`, { credentials: "include" }).then(parse),
  album: (spaceId: string, albumId: string) =>
    fetch(`/backend/spaces/${spaceId}/albums/${albumId}`, { credentials: "include" }).then(parse),
  addAlbumItems: (spaceId: string, albumId: string, mediaAssetIds: string[]) =>
    fetch(`/backend/spaces/${spaceId}/albums/${albumId}/items`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mediaAssetIds }),
    }).then(parse),
  folders: (spaceId: string) => fetch(`/backend/spaces/${spaceId}/folders`, { credentials: "include" }).then(parse),
  slideshows: (spaceId: string) =>
    fetch(`/backend/spaces/${spaceId}/slideshows`, { credentials: "include" }).then(parse),
  presentations: (spaceId: string) =>
    fetch(`/backend/spaces/${spaceId}/presentations`, { credentials: "include" }).then(parse),
  shares: (spaceId: string) => fetch(`/backend/spaces/${spaceId}/shares`, { credentials: "include" }).then(parse),
  createShare: (spaceId: string, body: Record<string, unknown>) =>
    fetch(`/backend/spaces/${spaceId}/shares`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then(parse) as Promise<{ token: string; path: string }>,
  createSpace: (name: string, type: string) =>
    fetch("/backend/spaces", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, type }),
    }).then(parse),
  async uploadFiles(
    spaceId: string,
    files: FileList | File[],
    onFile?: (info: { name: string; index: number; total: number; pct: number }) => void,
  ) {
    const list = Array.from(files);
    const results = [];
    for (let i = 0; i < list.length; i++) {
      const file = list[i];
      onFile?.({ name: file.name, index: i, total: list.length, pct: 0 });
      const session = await fetch("/backend/uploads/session", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          spaceId,
          filename: file.name,
          mimeType: file.type,
          bytes: file.size,
        }),
      }).then(parse);
      const putUrl = String(session.uploadUrl || "");
      const url =
        putUrl.includes("/uploads/") && session.sessionId
          ? `/backend/uploads/${session.sessionId}/object`
          : putUrl;
      await putWithProgress(url, file, (pct) =>
        onFile?.({ name: file.name, index: i, total: list.length, pct }),
      );
      const done = await fetch(`/backend/uploads/${session.sessionId}/complete`, {
        method: "POST",
        credentials: "include",
      }).then(parse);
      results.push(done);
    }
    return results;
  },
};

export function fileSrc(path: string): string {
  if (path.startsWith("http")) return path;
  if (path.startsWith("/backend")) return path;
  return `/backend${path}`;
}

export const SPACE_KEY = "pic.currentSpace";
