#!/usr/bin/env node
import { writeFileSync } from "fs";
import sharp from "sharp";

const base = process.env.API_URL || "http://127.0.0.1:3001";
const out = process.env.SHARE_LOG || "share-flow.log";
const lines = [];
const log = (m, extra) => {
  const row = extra !== undefined ? `${m} ${JSON.stringify(extra)}` : m;
  lines.push(row);
  console.log(row);
};

function cookieJar(res, prev = "") {
  const raw = res.headers.getSetCookie?.() || res.headers.get("set-cookie");
  if (!raw) return prev;
  const list = Array.isArray(raw) ? raw : [raw];
  return [...(prev ? prev.split("; ") : []), ...list.map((c) => c.split(";")[0])].join("; ");
}

async function req(path, opts = {}, cookie = "") {
  const headers = { ...(opts.headers || {}) };
  if (cookie) headers.Cookie = cookie;
  const res = await fetch(base + path, { ...opts, headers });
  const ct = res.headers.get("content-type") || "";
  const body = ct.includes("json") ? await res.json() : Buffer.from(await res.arrayBuffer());
  return { res, body, cookie: cookieJar(res, cookie), status: res.status };
}

async function main() {
  const email = `shareflow-${Date.now()}@pic.test`;
  const password = "password12";
  const reg = await req("/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  let cookie = reg.cookie;
  const spaceId = reg.body.spaces[0].id;
  const jpeg = await sharp({
    create: { width: 400, height: 300, channels: 3, background: { r: 90, g: 40, b: 20 } },
  })
    .jpeg()
    .toBuffer();
  const session = await req(
    "/uploads/session",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ spaceId, filename: "s.jpg", mimeType: "image/jpeg", bytes: jpeg.length }),
    },
    cookie,
  );
  await req(`/uploads/${session.body.sessionId}/object`, { method: "PUT", headers: { "Content-Type": "image/jpeg" }, body: jpeg }, cookie);
  const complete = await req(`/uploads/${session.body.sessionId}/complete`, { method: "POST" }, cookie);
  const assetId = complete.body.asset.id;
  for (let i = 0; i < 20; i++) {
    const d = await req(`/spaces/${spaceId}/media/${assetId}`, {}, cookie);
    if (d.body.status === "READY") break;
    await new Promise((r) => setTimeout(r, 400));
  }
  const show = await req(
    `/spaces/${spaceId}/slideshows`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "密码幻灯片", transition: "cross_fade", mediaAssetIds: [assetId] }),
    },
    cookie,
  );
  const share = await req(
    `/spaces/${spaceId}/shares`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        targetType: "SLIDESHOW",
        targetId: show.body.id,
        accessMode: "PASSWORD",
        password: "family-secret",
      }),
    },
    cookie,
  );
  log("shareCreated", { token: share.body.token, path: share.body.path, passwordInBody: JSON.stringify(share.body).includes("family-secret") });
  const denied = await req(`/public/shares/${share.body.token}`);
  log("deniedBeforePassword", { status: denied.status, code: denied.body.code });
  const verify = await req(`/public/shares/${share.body.token}/password`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: "family-secret" }),
  });
  log("passwordVerify", { status: verify.status, body: verify.body });
  const allowed = await req(`/public/shares/${share.body.token}`, {}, verify.cookie);
  log("allowedAfterSession", {
    status: allowed.status,
    ok: allowed.body.access?.ok,
    title: allowed.body.slideshow?.title,
    transition: allowed.body.slideshow?.transition,
  });
  if (denied.body.code !== "SHARE_PASSWORD_REQUIRED") throw new Error("expected password required");
  if (!allowed.body.access?.ok) throw new Error("expected access after password");
  log("OK");
  writeFileSync(out, lines.join("\n") + "\n");
}

main().catch((e) => {
  lines.push("FAILED " + (e.stack || e));
  writeFileSync(out, lines.join("\n") + "\n");
  console.error(e);
  process.exit(1);
});
