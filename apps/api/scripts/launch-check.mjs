#!/usr/bin/env node
/**
 * Real API launch path: register → personal space → upload session →
 * list → detail → optimized download → trash → restore.
 */
import { writeFileSync } from "fs";
import { resolve } from "path";
import sharp from "sharp";

const base = process.env.API_URL || "http://127.0.0.1:3001";
const out = process.env.LAUNCH_LOG || resolve("launch.log");
const lines = [];
function log(msg, extra) {
  const row = extra ? `${msg} ${JSON.stringify(extra)}` : msg;
  lines.push(row);
  console.log(row);
}

function cookieJar(res) {
  const raw = res.headers.getSetCookie?.() || res.headers.get("set-cookie");
  if (!raw) return "";
  const list = Array.isArray(raw) ? raw : [raw];
  return list.map((c) => c.split(";")[0]).join("; ");
}

async function req(path, opts = {}, cookie = "") {
  const headers = { ...(opts.headers || {}) };
  if (cookie) headers.Cookie = cookie;
  const res = await fetch(base + path, { ...opts, headers });
  const ct = res.headers.get("content-type") || "";
  let body;
  if (ct.includes("application/json")) body = await res.json();
  else body = Buffer.from(await res.arrayBuffer());
  return { res, body, cookie: cookieJar(res) || cookie };
}

async function main() {
  const health = await req("/health");
  log("health", health.body);
  if (!health.body?.ok) throw new Error("health failed");
  log("storageProvider", { provider: health.body.storageProvider });

  const email = `launch-${Date.now()}@pic.test`;
  const password = "password12";
  const reg = await req("/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, displayName: "启动检查" }),
  });
  if (reg.res.status >= 400) throw new Error("register failed " + JSON.stringify(reg.body));
  let cookie = reg.cookie;
  log("register", { id: reg.body.id, email: reg.body.email, spaces: reg.body.spaces });

  const space = await req(
    "/spaces",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "验证个人空间", type: "PERSONAL" }),
    },
    cookie,
  );
  if (space.res.status >= 400) throw new Error("create space failed " + JSON.stringify(space.body));
  const spaceId = space.body.id;
  log("createSpace", space.body);

  const jpeg = await sharp({
    create: { width: 1200, height: 800, channels: 3, background: { r: 40, g: 90, b: 160 } },
  })
    .jpeg({ quality: 90 })
    .toBuffer();

  const session = await req(
    "/uploads/session",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ spaceId, filename: "sea.jpg", mimeType: "image/jpeg", bytes: jpeg.length }),
    },
    cookie,
  );
  log("uploadSession", session.body);
  if (!session.body.sessionId) throw new Error("no session");

  const putUrl = session.body.uploadUrl.includes("/uploads/")
    ? session.body.uploadUrl.replace(/^https?:\/\/[^/]+/, "")
    : `/uploads/${session.body.sessionId}/object`;
  const put = await req(
    putUrl.startsWith("http") ? putUrl.replace(base, "") : putUrl,
    { method: "PUT", headers: { "Content-Type": "image/jpeg" }, body: jpeg },
    cookie,
  );
  log("putObject", { status: put.res.status, body: Buffer.isBuffer(put.body) ? { bytes: put.body.length } : put.body });

  const complete = await req(`/uploads/${session.body.sessionId}/complete`, { method: "POST" }, cookie);
  log("complete", {
    assetId: complete.body.asset?.id,
    status: complete.body.asset?.status,
    versions: complete.body.asset?.versions?.map((v) => v.versionType),
    provider: complete.body.provider,
  });
  const assetId = complete.body.asset.id;

  let ready = null;
  for (let i = 0; i < 40; i++) {
    const detail = await req(`/spaces/${spaceId}/media/${assetId}`, {}, cookie);
    ready = detail.body;
    log("poll", { i, status: ready.status, versions: ready.versions?.length });
    if (ready.status === "READY" || ready.status === "PARTIAL_READY" || ready.status === "PROCESSING_FAILED") break;
    await new Promise((r) => setTimeout(r, 500));
  }
  if (ready.status !== "READY" && ready.status !== "PARTIAL_READY") {
    throw new Error("asset not ready: " + JSON.stringify(ready));
  }

  const list = await req(`/spaces/${spaceId}/media`, {}, cookie);
  log("list", { count: list.body.items?.length, first: list.body.items?.[0] });
  if (!list.body.items?.find((i) => i.id === assetId)) throw new Error("asset missing from list");
  if (list.body.items[0].versions) throw new Error("list leaked versions");

  const detail = await req(`/spaces/${spaceId}/media/${assetId}`, {}, cookie);
  log("detail", { id: detail.body.id, width: detail.body.width, versions: detail.body.versions });

  const dl = await req(`/spaces/${spaceId}/media/${assetId}/download?variant=optimized`, {}, cookie);
  const opt = Buffer.isBuffer(dl.body) ? dl.body : Buffer.from(dl.body);
  log("downloadOptimized", {
    status: dl.res.status,
    contentType: dl.res.headers.get("content-type"),
    bytes: opt.length,
    magic: opt.subarray(0, 3).toString("hex"),
    originalBytes: jpeg.length,
  });
  if (opt[0] !== 0xff || opt[1] !== 0xd8) throw new Error("optimized download is not jpeg");
  if (opt.length >= jpeg.length) throw new Error("optimized should not be original-sized");

  const trashed = await req(`/spaces/${spaceId}/media/${assetId}`, { method: "DELETE" }, cookie);
  log("trash", trashed.body);
  const listed = await req(`/spaces/${spaceId}/media`, {}, cookie);
  if (listed.body.items.find((i) => i.id === assetId)) throw new Error("trashed asset still in library");
  const restored = await req(`/spaces/${spaceId}/media/${assetId}/restore`, { method: "POST" }, cookie);
  log("restore", restored.body);
  const listed2 = await req(`/spaces/${spaceId}/media`, {}, cookie);
  if (!listed2.body.items.find((i) => i.id === assetId)) throw new Error("restore did not return to library");

  log("OK");
  writeFileSync(out, lines.join("\n") + "\n");
}

main().catch((err) => {
  lines.push("FAILED " + (err && err.stack ? err.stack : String(err)));
  writeFileSync(out, lines.join("\n") + "\n");
  console.error(err);
  process.exit(1);
});
