#!/usr/bin/env node
/**
 * Create album + presentation shares via the real API, then open /s/:token
 * in the browser and assert items/blocks render (not a blank page).
 */
import { writeFileSync } from "fs";
import { createRequire } from "module";
import { resolve } from "path";
import sharp from "sharp";

const require = createRequire(import.meta.url);
const scratch = process.env.SCRATCH || resolve(".");
const logPath = process.env.SHARE_PAGES_LOG || resolve(scratch, "share-pages.log");
const lines = [];
const log = (m, extra) => {
  const row = extra !== undefined ? `${m} ${JSON.stringify(extra)}` : m;
  lines.push(row);
  console.log(row);
};

const api = process.env.API_URL || "http://127.0.0.1:3001";
const web = process.env.WEB_URL || "http://127.0.0.1:3000";

function cookieJar(res, prev = "") {
  const raw = res.headers.getSetCookie?.() || res.headers.get("set-cookie");
  if (!raw) return prev;
  const list = Array.isArray(raw) ? raw : [raw];
  return [...(prev ? prev.split("; ") : []), ...list.map((c) => c.split(";")[0])].join("; ");
}

async function req(path, opts = {}, cookie = "") {
  const headers = { ...(opts.headers || {}) };
  if (cookie) headers.Cookie = cookie;
  const res = await fetch(api + path, { ...opts, headers });
  const ct = res.headers.get("content-type") || "";
  const body = ct.includes("json") ? await res.json() : Buffer.from(await res.arrayBuffer());
  return { res, body, cookie: cookieJar(res, cookie), status: res.status };
}

async function waitReady(cookie, spaceId, assetId) {
  for (let i = 0; i < 20; i++) {
    const d = await req(`/spaces/${spaceId}/media/${assetId}`, {}, cookie);
    if (d.body.status === "READY" || d.body.status === "PARTIAL_READY") return d.body;
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error("asset not ready " + assetId);
}

async function upload(cookie, spaceId, filename) {
  const jpeg = await sharp({
    create: { width: 480, height: 320, channels: 3, background: { r: 180, g: 90, b: 40 } },
  })
    .jpeg({ quality: 85 })
    .toBuffer();
  const session = await req(
    "/uploads/session",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ spaceId, filename, mimeType: "image/jpeg", bytes: jpeg.length }),
    },
    cookie,
  );
  await req(
    `/uploads/${session.body.sessionId}/object`,
    { method: "PUT", headers: { "Content-Type": "image/jpeg" }, body: jpeg },
    cookie,
  );
  const complete = await req(`/uploads/${session.body.sessionId}/complete`, { method: "POST" }, cookie);
  const id = complete.body.asset.id;
  await waitReady(cookie, spaceId, id);
  return id;
}

async function main() {
  const email = `sharepage-${Date.now()}@pic.test`;
  const password = "password12";
  const reg = await req("/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, displayName: "分享页" }),
  });
  if (reg.status >= 400) throw new Error("register " + JSON.stringify(reg.body));
  const cookie = reg.cookie;
  const spaceId = reg.body.spaces[0].id;
  const assetA = await upload(cookie, spaceId, "a.jpg");
  const assetB = await upload(cookie, spaceId, "b.jpg");

  const album = await req(
    `/spaces/${spaceId}/albums`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "家庭相册分享" }),
    },
    cookie,
  );
  await req(
    `/spaces/${spaceId}/albums/${album.body.id}/items`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mediaAssetIds: [assetA] }),
    },
    cookie,
  );
  const albumShare = await req(
    `/spaces/${spaceId}/shares`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ targetType: "ALBUM", targetId: album.body.id, accessMode: "PUBLIC" }),
    },
    cookie,
  );
  const albumLeak = await req(`/public/shares/${albumShare.body.token}/file/${assetB}?v=thumbnail`);
  log("albumShareIdor", { status: albumLeak.status, code: albumLeak.body.code });
  if (albumLeak.status !== 404 || albumLeak.body.code !== "MEDIA_NOT_FOUND") {
    throw new Error("album share leaked asset B");
  }

  const pres = await req(
    `/spaces/${spaceId}/presentations`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "家庭纪念分享",
        preset: "family_memorial",
        mediaAssetIds: [assetA],
      }),
    },
    cookie,
  );
  const presShare = await req(
    `/spaces/${spaceId}/shares`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        targetType: "PRESENTATION",
        targetId: pres.body.id,
        accessMode: "PUBLIC",
      }),
    },
    cookie,
  );
  const presLeak = await req(`/public/shares/${presShare.body.token}/file/${assetB}?v=thumbnail`);
  log("presentationShareIdor", { status: presLeak.status, code: presLeak.body.code });
  if (presLeak.status !== 404 || presLeak.body.code !== "MEDIA_NOT_FOUND") {
    throw new Error("presentation share leaked asset B");
  }

  const { chromium } = require("playwright-core");
  const browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH || "/usr/bin/google-chrome",
    headless: true,
    args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"],
  });
  const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
  const errors = [];
  page.on("pageerror", (err) => errors.push(err.message));

  await page.goto(`${web}/s/${albumShare.body.token}`, { waitUntil: "networkidle" });
  await page.waitForSelector('[data-share-kind="album"]', { timeout: 15000 });
  const albumTitle = await page.locator('[data-share-kind="album"] h1').innerText();
  const albumImgs = await page.locator('[data-share-kind="album"] img').count();
  log("albumPage", { title: albumTitle, images: albumImgs, url: page.url() });
  if (albumTitle !== "家庭相册分享") throw new Error("album title missing");
  if (albumImgs < 1) throw new Error("album items did not render");
  await page.screenshot({ path: resolve(scratch, "share-album.png"), fullPage: true });

  await page.goto(`${web}/s/${presShare.body.token}`, { waitUntil: "networkidle" });
  await page.waitForSelector('[data-share-kind="presentation"]', { timeout: 15000 });
  const cover = await page.locator('[data-share-kind="presentation"] .cover h1').innerText();
  const blockCount = await page.locator('[data-share-kind="presentation"] section, [data-share-kind="presentation"] img').count();
  log("presentationPage", { cover, blockCount, url: page.url() });
  if (!cover.includes("家庭纪念")) throw new Error("presentation cover missing");
  if (blockCount < 2) throw new Error("presentation blocks did not render");
  await page.screenshot({ path: resolve(scratch, "share-presentation.png"), fullPage: true });

  await browser.close();
  if (errors.length) throw new Error("page errors: " + errors.join("; "));
  log("OK");
  writeFileSync(logPath, lines.join("\n") + "\n");
}

main().catch((e) => {
  lines.push("FAILED " + (e.stack || e));
  writeFileSync(logPath, lines.join("\n") + "\n");
  console.error(e);
  process.exit(1);
});
