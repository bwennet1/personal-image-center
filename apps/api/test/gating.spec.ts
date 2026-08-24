import { execSync } from "child_process";
import { INestApplication } from "@nestjs/common";
import request from "supertest";
import sharp from "sharp";
import { createApp } from "../src/main";
import { PrismaService } from "../src/prisma.service";
import { StorageService } from "../src/storage/storage.service";
import { processImageJob } from "../src/media/media-processor";
import { hasCapability } from "../src/domain/capabilities";
import { decideShareAccess } from "../src/domain/share-access";
import {
  applySlideLoadFailure,
  nextPlayableIndex,
  shouldAbortSlideshowOnImageFailure,
} from "../src/domain/slideshow-player";
import { drainCursorPages } from "../src/domain/cursor";
import { collectMediaAssetIdsFromBlocks } from "../src/domain/presentations";
import { detectImageMime } from "../src/domain/mime";

function cookieFrom(res: request.Response): string {
  const raw = res.headers["set-cookie"];
  const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
  return list.map((c) => String(c).split(";")[0]).join("; ");
}

async function jpegFixture(width = 1600, height = 1000, quality = 92): Promise<Buffer> {
  return sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 210, g: 92, b: 48 },
    },
  })
    .jpeg({ quality })
    .toBuffer();
}

async function pngFixture(): Promise<Buffer> {
  return sharp({
    create: { width: 64, height: 48, channels: 3, background: { r: 20, g: 90, b: 160 } },
  })
    .png()
    .toBuffer();
}

describe("个人图片中心 gating", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let storage: StorageService;
  let server: ReturnType<INestApplication["getHttpServer"]>;
  const stamp = Date.now();

  beforeAll(async () => {
    execSync("npx prisma db push --accept-data-loss --skip-generate", {
      cwd: __dirname + "/..",
      env: process.env,
      stdio: "inherit",
    });
    app = await createApp();
    await app.init();
    server = app.getHttpServer();
    prisma = app.get(PrismaService);
    storage = app.get(StorageService);
  });

  afterAll(async () => {
    await app.close();
  });

  it("capability matrix matches baseline roles", () => {
    expect(hasCapability("VIEWER", "upload_media")).toBe(false);
    expect(hasCapability("VIEWER", "edit_media")).toBe(false);
    expect(hasCapability("VIEWER", "delete_media")).toBe(false);
    expect(hasCapability("VIEWER", "create_share")).toBe(false);
    expect(hasCapability("VIEWER", "create_album")).toBe(false);
    expect(hasCapability("EDITOR", "manage_members")).toBe(false);
    expect(hasCapability("EDITOR", "delete_space")).toBe(false);
    expect(hasCapability("ADMIN", "delete_space")).toBe(false);
    expect(hasCapability("ADMIN", "transfer_ownership")).toBe(false);
    expect(hasCapability("OWNER", "delete_space")).toBe(true);
    expect(hasCapability("OWNER", "transfer_ownership")).toBe(true);
    expect(hasCapability("EDITOR", "upload_media")).toBe(true);
  });

  it("share decision order: exists → revoked → target → expiry → max views → login → password", () => {
    const base = {
      revokedAt: null as Date | null,
      expiresAt: null as Date | null,
      maxViews: null as number | null,
      viewCount: 0,
      accessMode: "PASSWORD" as const,
      passwordHash: "hash",
      allowDownloadOptimized: true,
      allowDownloadOriginal: false,
      showExif: false,
      showGps: false,
    };
    expect(decideShareAccess({ share: null, targetAlive: true, now: new Date(), viewer: { passwordVerified: false } }).code).toBe(
      "SHARE_NOT_FOUND",
    );
    expect(
      decideShareAccess({
        share: { ...base, revokedAt: new Date() },
        targetAlive: true,
        now: new Date(),
        viewer: { passwordVerified: false },
      }).code,
    ).toBe("SHARE_REVOKED");
    expect(
      decideShareAccess({
        share: base,
        targetAlive: false,
        now: new Date(),
        viewer: { passwordVerified: false },
      }).code,
    ).toBe("SHARE_TARGET_GONE");
    expect(
      decideShareAccess({
        share: { ...base, expiresAt: new Date(Date.now() - 1000) },
        targetAlive: true,
        now: new Date(),
        viewer: { passwordVerified: false },
      }).code,
    ).toBe("SHARE_EXPIRED");
    expect(
      decideShareAccess({
        share: { ...base, maxViews: 1, viewCount: 1 },
        targetAlive: true,
        now: new Date(),
        viewer: { passwordVerified: false },
      }).code,
    ).toBe("SHARE_MAX_VIEWS");
    expect(
      decideShareAccess({
        share: { ...base, accessMode: "LOGIN_REQUIRED" },
        targetAlive: true,
        now: new Date(),
        viewer: { passwordVerified: false },
      }).code,
    ).toBe("SHARE_LOGIN_REQUIRED");
    expect(
      decideShareAccess({
        share: base,
        targetAlive: true,
        now: new Date(),
        viewer: { passwordVerified: false },
      }).code,
    ).toBe("SHARE_PASSWORD_REQUIRED");
    const ok = decideShareAccess({
      share: base,
      targetAlive: true,
      now: new Date(),
      viewer: { passwordVerified: true },
    });
    expect(ok.ok).toBe(true);
    expect(ok.flags.view).toBe(true);
    expect(ok.flags.downloadOriginal).toBe(false);
  });

  it("slideshow skip-failed does not abort the sequence", () => {
    expect(shouldAbortSlideshowOnImageFailure()).toBe(false);
    const items = [
      { assetId: "a", failed: false },
      { assetId: "b", failed: true },
      { assetId: "c", failed: false },
    ];
    const next = nextPlayableIndex(items, 0, 1);
    expect(next.index).toBe(2);
    expect(next.skipped).toBe(1);
  });

  it("player-path mid-show load failure skips to the next playable, not index 0", () => {
    const items = [
      { assetId: "first", failed: false },
      { assetId: "middle", failed: false },
      { assetId: "last", failed: false },
    ];
    const after = applySlideLoadFailure(items, 1);
    expect(after.items[1].failed).toBe(true);
    expect(after.index).toBe(2);
    expect(after.items[after.index].assetId).toBe("last");
    expect(after.index).not.toBe(0);
    const fromStart = applySlideLoadFailure(items, 0);
    expect(fromStart.index).toBe(1);
    expect(fromStart.items[fromStart.index].assetId).toBe("middle");
  });

  it("email+password register+login returns a session user with spaces", async () => {
    const email = `owner-${stamp}@pic.test`;
    const password = "password12";
    const reg = await request(server).post("/auth/register").send({ email, password, displayName: "园主" });
    expect(reg.status).toBe(201);
    expect(reg.body.email).toBe(email);
    expect(reg.body.spaces.length).toBeGreaterThan(0);
    expect(cookieFrom(reg)).toContain("pic_session=");
    const login = await request(server).post("/auth/login").send({ email, password });
    expect(login.status).toBe(201);
    expect(login.body.id).toBe(reg.body.id);
    expect(cookieFrom(login)).toContain("pic_session=");
  });

  it("Viewer upload and Editor member-admin are rejected with SPACE_ACCESS_DENIED", async () => {
    const ownerEmail = `rbac-owner-${stamp}@pic.test`;
    const viewerEmail = `rbac-viewer-${stamp}@pic.test`;
    const editorEmail = `rbac-editor-${stamp}@pic.test`;
    const password = "password12";
    const ownerReg = await request(server).post("/auth/register").send({ email: ownerEmail, password });
    const viewerReg = await request(server).post("/auth/register").send({ email: viewerEmail, password });
    const editorReg = await request(server).post("/auth/register").send({ email: editorEmail, password });
    const ownerCookie = cookieFrom(ownerReg);
    const space = await request(server)
      .post("/spaces")
      .set("Cookie", ownerCookie)
      .send({ name: "家庭协作", type: "FAMILY" });
    expect(space.status).toBe(201);
    const spaceId = space.body.id as string;
    const addViewer = await request(server)
      .post(`/spaces/${spaceId}/members`)
      .set("Cookie", ownerCookie)
      .send({ email: viewerEmail, role: "VIEWER" });
    expect(addViewer.status).toBe(201);
    const addEditor = await request(server)
      .post(`/spaces/${spaceId}/members`)
      .set("Cookie", ownerCookie)
      .send({ email: editorEmail, role: "EDITOR" });
    expect(addEditor.status).toBe(201);

    const viewerCookie = cookieFrom(await request(server).post("/auth/login").send({ email: viewerEmail, password }));
    const editorCookie = cookieFrom(await request(server).post("/auth/login").send({ email: editorEmail, password }));

    const upload = await request(server)
      .post("/uploads/session")
      .set("Cookie", viewerCookie)
      .send({ spaceId, filename: "x.jpg", mimeType: "image/jpeg", bytes: 1000 });
    expect(upload.status).toBe(403);
    expect(upload.body.code).toBe("SPACE_ACCESS_DENIED");

    const adminCall = await request(server)
      .post(`/spaces/${spaceId}/members`)
      .set("Cookie", editorCookie)
      .send({ email: viewerReg.body.email, role: "ADMIN" });
    expect(adminCall.status).toBe(403);
    expect(adminCall.body.code).toBe("SPACE_ACCESS_DENIED");

    const deleteSpace = await request(server).delete(`/spaces/${spaceId}`).set("Cookie", editorCookie);
    expect(deleteSpace.status).toBe(403);
    expect(deleteSpace.body.code).toBe("SPACE_ACCESS_DENIED");

    const viewerShare = await request(server)
      .post(`/spaces/${spaceId}/shares`)
      .set("Cookie", viewerCookie)
      .send({ targetType: "MEDIA", targetId: "x", accessMode: "PUBLIC" });
    expect(viewerShare.status).toBe(403);
    expect(viewerShare.body.code).toBe("SPACE_ACCESS_DENIED");

    const viewerAlbum = await request(server)
      .post(`/spaces/${spaceId}/albums`)
      .set("Cookie", viewerCookie)
      .send({ name: "不行" });
    expect(viewerAlbum.status).toBe(403);
    expect(viewerAlbum.body.code).toBe("SPACE_ACCESS_DENIED");

    expect(ownerReg.body.spaces[0].capabilities).toContain("upload_media");
    expect(ownerReg.body.id).toBeTruthy();
    expect(editorReg.body.id).toBeTruthy();
  });

  it("real JPEG/PNG upload commits original object and worker derivatives are idempotent", async () => {
    const email = `up-${stamp}@pic.test`;
    const password = "password12";
    const reg = await request(server).post("/auth/register").send({ email, password });
    const cookie = cookieFrom(reg);
    const spaceId = reg.body.spaces[0].id as string;
    const jpeg = await jpegFixture();
    expect(detectImageMime(jpeg)).toBe("image/jpeg");

    const session = await request(server)
      .post("/uploads/session")
      .set("Cookie", cookie)
      .send({ spaceId, filename: "sunset.jpg", mimeType: "image/jpeg", bytes: jpeg.length });
    expect(session.status).toBe(201);
    expect(session.body.provider).toBe(storage.providerName);
    expect(session.body.uploadUrl).toBeTruthy();
    expect(session.body.objectKey).toBeTruthy();

    const put = await request(server)
      .put(`/uploads/${session.body.sessionId}/object`)
      .set("Cookie", cookie)
      .set("Content-Type", "image/jpeg")
      .send(jpeg);
    expect(put.status).toBe(200);
    expect(put.body.ok).toBe(true);

    const complete = await request(server)
      .post(`/uploads/${session.body.sessionId}/complete`)
      .set("Cookie", cookie);
    expect(complete.status).toBe(201);
    const assetId = complete.body.asset.id as string;
    expect(assetId).toBeTruthy();
    const inflight = await request(server).get(`/spaces/${spaceId}/media`).set("Cookie", cookie);
    const inflightItem = inflight.body.items.find((i: { id: string }) => i.id === assetId);
    expect(inflightItem).toBeTruthy();
    expect(["PROCESSING", "UPLOADED", "READY", "PARTIAL_READY"]).toContain(inflightItem.status);
    const original = complete.body.asset.versions.find((v: { versionType: string }) => v.versionType === "ORIGINAL");
    expect(original).toBeTruthy();
    const head = await storage.headObject(original.objectKey);
    expect(head.exists).toBe(true);
    expect(head.size).toBe(jpeg.length);

    await processImageJob({ prisma, storage }, assetId);
    const ready = await prisma.mediaAsset.findUnique({ where: { id: assetId }, include: { versions: true } });
    expect(ready?.status).toBe("READY");
    const types = ready!.versions.map((v) => v.versionType).sort();
    expect(types).toEqual(["OPTIMIZED_1280", "OPTIMIZED_2560", "ORIGINAL", "THUMBNAIL"].sort());

    const spaceAfterFirst = await prisma.space.findUnique({ where: { id: spaceId } });
    const optAfterFirst = spaceAfterFirst!.usedOptimizedBytes;

    await processImageJob({ prisma, storage }, assetId);
    const again = await prisma.mediaAsset.findUnique({ where: { id: assetId }, include: { versions: true } });
    expect(again!.versions).toHaveLength(4);
    const spaceAfterSecond = await prisma.space.findUnique({ where: { id: spaceId } });
    expect(spaceAfterSecond!.usedOptimizedBytes).toBe(optAfterFirst);

    const retried = await request(server)
      .post(`/spaces/${spaceId}/media/${assetId}/retry`)
      .set("Cookie", cookie);
    expect(retried.status).toBe(201);
    expect(retried.body.versions).toHaveLength(4);

    const png = await pngFixture();
    const s2 = await request(server)
      .post("/uploads/session")
      .set("Cookie", cookie)
      .send({ spaceId, filename: "blue.png", mimeType: "image/png", bytes: png.length });
    await request(server)
      .put(`/uploads/${s2.body.sessionId}/object`)
      .set("Cookie", cookie)
      .set("Content-Type", "image/png")
      .send(png);
    const c2 = await request(server).post(`/uploads/${s2.body.sessionId}/complete`).set("Cookie", cookie);
    await processImageJob({ prisma, storage }, c2.body.asset.id);
    const pngAsset = await prisma.mediaAsset.findUnique({
      where: { id: c2.body.asset.id },
      include: { versions: true },
    });
    expect(pngAsset?.status).toBe("READY");
    expect(pngAsset?.versions.some((v) => v.versionType === "ORIGINAL")).toBe(true);

    const list = await request(server).get(`/spaces/${spaceId}/media`).set("Cookie", cookie);
    expect(list.status).toBe(200);
    expect(list.body.items.length).toBeGreaterThanOrEqual(2);
    const item = list.body.items[0];
    expect(item.thumbnailUrl).toBeTruthy();
    expect(item.thumbnailUrl).toContain("thumbnail");
    expect(item.thumbnailUrl).not.toContain("original");
    expect(item).not.toHaveProperty("versions");
    expect(item).not.toHaveProperty("exifSummary");
    expect(item).not.toHaveProperty("originalUrl");

    const detail = await request(server).get(`/spaces/${spaceId}/media/${assetId}`).set("Cookie", cookie);
    expect(detail.status).toBe(200);
    expect(detail.body.versions.length).toBe(4);

    const dl = await request(server)
      .get(`/spaces/${spaceId}/media/${assetId}/download?variant=optimized`)
      .set("Cookie", cookie);
    expect(dl.status).toBe(200);
    expect(Buffer.isBuffer(dl.body) ? dl.body[0] : Buffer.from(dl.body)[0]).toBe(0xff);
    const optBuf: Buffer = Buffer.isBuffer(dl.body) ? dl.body : Buffer.from(dl.body);
    expect(optBuf.length).toBeGreaterThan(100);
    expect(optBuf.length).toBeLessThan(jpeg.length);

    const trash = await request(server).delete(`/spaces/${spaceId}/media/${assetId}`).set("Cookie", cookie);
    expect(trash.status).toBe(200);
    const listedTrashed = await request(server).get(`/spaces/${spaceId}/media`).set("Cookie", cookie);
    expect(listedTrashed.body.items.find((i: { id: string }) => i.id === assetId)).toBeFalsy();
    const trashView = await request(server).get(`/spaces/${spaceId}/media?view=trash`).set("Cookie", cookie);
    expect(trashView.body.items.find((i: { id: string }) => i.id === assetId)).toBeTruthy();
    const restore = await request(server)
      .post(`/spaces/${spaceId}/media/${assetId}/restore`)
      .set("Cookie", cookie);
    expect(restore.status).toBe(201);
    const listedBack = await request(server).get(`/spaces/${spaceId}/media`).set("Cookie", cookie);
    expect(listedBack.body.items.find((i: { id: string }) => i.id === assetId)).toBeTruthy();
  });

  it("truncated and non-image files never become ready library media", async () => {
    const email = `bad-${stamp}@pic.test`;
    const password = "password12";
    const reg = await request(server).post("/auth/register").send({ email, password });
    const cookie = cookieFrom(reg);
    const spaceId = reg.body.spaces[0].id as string;
    const jpeg = await jpegFixture(400, 300);
    const truncated = jpeg.subarray(0, 40);

    const s1 = await request(server)
      .post("/uploads/session")
      .set("Cookie", cookie)
      .send({ spaceId, filename: "broken.jpg", mimeType: "image/jpeg", bytes: truncated.length });
    await request(server)
      .put(`/uploads/${s1.body.sessionId}/object`)
      .set("Cookie", cookie)
      .set("Content-Type", "image/jpeg")
      .send(truncated);
    const c1 = await request(server).post(`/uploads/${s1.body.sessionId}/complete`).set("Cookie", cookie);
    const badId = c1.body.asset.id as string;
    await processImageJob({ prisma, storage }, badId);
    const bad = await prisma.mediaAsset.findUnique({ where: { id: badId } });
    expect(bad?.status).toBe("PROCESSING_FAILED");
    expect(bad?.failureReason).toBeTruthy();

    const junk = Buffer.from("this is not an image file at all");
    const s2 = await request(server)
      .post("/uploads/session")
      .set("Cookie", cookie)
      .send({ spaceId, filename: "photo.jpg", mimeType: "image/jpeg", bytes: junk.length });
    await request(server)
      .put(`/uploads/${s2.body.sessionId}/object`)
      .set("Cookie", cookie)
      .set("Content-Type", "image/jpeg")
      .send(junk);
    const c2 = await request(server).post(`/uploads/${s2.body.sessionId}/complete`).set("Cookie", cookie);
    const junkId = c2.body.asset.id as string;
    await processImageJob({ prisma, storage }, junkId);
    const junkAsset = await prisma.mediaAsset.findUnique({ where: { id: junkId } });
    expect(junkAsset?.status).toBe("PROCESSING_FAILED");

    const list = await request(server).get(`/spaces/${spaceId}/media`).set("Cookie", cookie);
    const ids = list.body.items.map((i: { id: string }) => i.id);
    expect(ids).not.toContain(badId);
    expect(ids).not.toContain(junkId);
  });

  it("password share denies before verify and allows after share session", async () => {
    const email = `share-${stamp}@pic.test`;
    const password = "password12";
    const reg = await request(server).post("/auth/register").send({ email, password });
    const cookie = cookieFrom(reg);
    const spaceId = reg.body.spaces[0].id as string;
    const jpeg = await jpegFixture(320, 240, 80);
    const s = await request(server)
      .post("/uploads/session")
      .set("Cookie", cookie)
      .send({ spaceId, filename: "share.jpg", mimeType: "image/jpeg", bytes: jpeg.length });
    await request(server).put(`/uploads/${s.body.sessionId}/object`).set("Cookie", cookie).send(jpeg);
    const c = await request(server).post(`/uploads/${s.body.sessionId}/complete`).set("Cookie", cookie);
    await processImageJob({ prisma, storage }, c.body.asset.id);

    const share = await request(server)
      .post(`/spaces/${spaceId}/shares`)
      .set("Cookie", cookie)
      .send({
        targetType: "MEDIA",
        targetId: c.body.asset.id,
        accessMode: "PASSWORD",
        password: "secret99",
      });
    expect(share.status).toBe(201);
    expect(share.body.token).toBeTruthy();
    expect(JSON.stringify(share.body)).not.toContain("secret99");

    const denied = await request(server).get(`/public/shares/${share.body.token}`);
    expect(denied.status).toBe(401);
    expect(denied.body.code).toBe("SHARE_PASSWORD_REQUIRED");

    const wrong = await request(server)
      .post(`/public/shares/${share.body.token}/password`)
      .send({ password: "nope" });
    expect(wrong.status).toBe(400);
    expect(wrong.body.code).toBe("SHARE_PASSWORD_INVALID");

    const verify = await request(server)
      .post(`/public/shares/${share.body.token}/password`)
      .send({ password: "secret99" });
    expect(verify.status).toBe(201);
    const shareCookie = cookieFrom(verify);
    const allowed = await request(server).get(`/public/shares/${share.body.token}`).set("Cookie", shareCookie);
    expect(allowed.status).toBe(200);
    expect(allowed.body.access.ok).toBe(true);
    expect(allowed.body.media.id).toBe(c.body.asset.id);
  });

  it("slideshow persists named transitions and presentation publish reuses MediaAsset id", async () => {
    const email = `create-${stamp}@pic.test`;
    const password = "password12";
    const reg = await request(server).post("/auth/register").send({ email, password });
    const cookie = cookieFrom(reg);
    const spaceId = reg.body.spaces[0].id as string;
    const jpeg = await jpegFixture(400, 300, 80);
    const s = await request(server)
      .post("/uploads/session")
      .set("Cookie", cookie)
      .send({ spaceId, filename: "slide.jpg", mimeType: "image/jpeg", bytes: jpeg.length });
    await request(server).put(`/uploads/${s.body.sessionId}/object`).set("Cookie", cookie).send(jpeg);
    const c = await request(server).post(`/uploads/${s.body.sessionId}/complete`).set("Cookie", cookie);
    await processImageJob({ prisma, storage }, c.body.asset.id);
    const assetId = c.body.asset.id as string;

    const album = await request(server)
      .post(`/spaces/${spaceId}/albums`)
      .set("Cookie", cookie)
      .send({ name: "家庭相册" });
    await request(server)
      .post(`/spaces/${spaceId}/albums/${album.body.id}/items`)
      .set("Cookie", cookie)
      .send({ mediaAssetIds: [assetId] });

    const show = await request(server)
      .post(`/spaces/${spaceId}/slideshows`)
      .set("Cookie", cookie)
      .send({
        title: "周末",
        albumId: album.body.id,
        transition: "ken_burns",
        stayDurationMs: 6000,
        background: "blur",
        loop: true,
      });
    expect(show.status).toBe(201);
    expect(show.body.transition).toBe("ken_burns");
    expect(show.body.stayDurationMs).toBe(6000);
    const got = await request(server)
      .get(`/spaces/${spaceId}/slideshows/${show.body.id}`)
      .set("Cookie", cookie);
    expect(got.body.transition).toBe("ken_burns");

    const originalsBefore = await prisma.mediaVersion.count({
      where: { mediaAssetId: assetId, versionType: "ORIGINAL" },
    });

    const pres = await request(server)
      .post(`/spaces/${spaceId}/presentations`)
      .set("Cookie", cookie)
      .send({ title: "家庭纪念网页", preset: "family_memorial", mediaAssetIds: [assetId] });
    expect(pres.status).toBe(201);
    expect(pres.body.preset).toBe("family_memorial");
    expect(pres.body.blocks.map((b: { type: string }) => b.type)).toEqual(
      expect.arrayContaining(["cover", "text", "image", "gallery", "slideshow", "timeline", "ending"]),
    );
    expect(pres.body.referencedMediaAssetIds).toContain(assetId);

    const pub = await request(server)
      .post(`/spaces/${spaceId}/presentations/${pres.body.id}/publish`)
      .set("Cookie", cookie);
    expect(pub.status).toBe(201);
    expect(pub.body.publishToken).toBeTruthy();
    const publicGet = await request(server).get(`/public/presentations/${pub.body.publishToken}`);
    expect(publicGet.status).toBe(200);
    expect(publicGet.body.referencedMediaAssetIds).toContain(assetId);
    expect(collectMediaAssetIdsFromBlocks(publicGet.body.blocks)).toContain(assetId);

    const originalsAfter = await prisma.mediaVersion.count({
      where: { mediaAssetId: assetId, versionType: "ORIGINAL" },
    });
    expect(originalsAfter).toBe(originalsBefore);
    expect(originalsAfter).toBe(1);
  });

  async function uploadReady(cookie: string, spaceId: string, filename: string): Promise<string> {
    const jpeg = await jpegFixture(320, 240, 80);
    const s = await request(server)
      .post("/uploads/session")
      .set("Cookie", cookie)
      .send({ spaceId, filename, mimeType: "image/jpeg", bytes: jpeg.length });
    await request(server).put(`/uploads/${s.body.sessionId}/object`).set("Cookie", cookie).send(jpeg);
    const c = await request(server).post(`/uploads/${s.body.sessionId}/complete`).set("Cookie", cookie);
    const id = c.body.asset.id as string;
    await processImageJob({ prisma, storage }, id);
    return id;
  }

  it("share file cannot serve a different space asset than the share target", async () => {
    const email = `idor-${stamp}@pic.test`;
    const password = "password12";
    const reg = await request(server).post("/auth/register").send({ email, password });
    const cookie = cookieFrom(reg);
    const spaceId = reg.body.spaces[0].id as string;
    const assetA = await uploadReady(cookie, spaceId, "a.jpg");
    const assetB = await uploadReady(cookie, spaceId, "b.jpg");

    const shareA = await request(server)
      .post(`/spaces/${spaceId}/shares`)
      .set("Cookie", cookie)
      .send({ targetType: "MEDIA", targetId: assetA, accessMode: "PUBLIC" });
    expect(shareA.status).toBe(201);

    const allowed = await request(server).get(`/public/shares/${shareA.body.token}/file/${assetA}?v=thumbnail`);
    expect(allowed.status).toBe(200);
    expect(allowed.headers["content-type"]).toMatch(/image\//);

    const leaked = await request(server).get(`/public/shares/${shareA.body.token}/file/${assetB}?v=thumbnail`);
    expect(leaked.status).toBe(404);
    expect(leaked.body.code).toBe("MEDIA_NOT_FOUND");

    const album = await request(server)
      .post(`/spaces/${spaceId}/albums`)
      .set("Cookie", cookie)
      .send({ name: "只含A" });
    await request(server)
      .post(`/spaces/${spaceId}/albums/${album.body.id}/items`)
      .set("Cookie", cookie)
      .send({ mediaAssetIds: [assetA] });
    const albumShare = await request(server)
      .post(`/spaces/${spaceId}/shares`)
      .set("Cookie", cookie)
      .send({ targetType: "ALBUM", targetId: album.body.id, accessMode: "PUBLIC" });
    const albumPayload = await request(server).get(`/public/shares/${albumShare.body.token}`);
    expect(albumPayload.status).toBe(200);
    expect(albumPayload.body.album.items.map((i: { id: string }) => i.id)).toEqual([assetA]);
    const albumLeak = await request(server).get(
      `/public/shares/${albumShare.body.token}/file/${assetB}?v=thumbnail`,
    );
    expect(albumLeak.status).toBe(404);
    expect(albumLeak.body.code).toBe("MEDIA_NOT_FOUND");
  });

  it("Viewer cannot load original bytes via file?v=original", async () => {
    const ownerEmail = `orig-owner-${stamp}@pic.test`;
    const viewerEmail = `orig-viewer-${stamp}@pic.test`;
    const password = "password12";
    const ownerReg = await request(server).post("/auth/register").send({ email: ownerEmail, password });
    const viewerReg = await request(server).post("/auth/register").send({ email: viewerEmail, password });
    expect(viewerReg.status).toBe(201);
    const ownerCookie = cookieFrom(ownerReg);
    const viewerCookie = cookieFrom(viewerReg);
    const space = await request(server)
      .post("/spaces")
      .set("Cookie", ownerCookie)
      .send({ name: "原图权限", type: "FAMILY" });
    const spaceId = space.body.id as string;
    await request(server)
      .post(`/spaces/${spaceId}/members`)
      .set("Cookie", ownerCookie)
      .send({ email: viewerEmail, role: "VIEWER" });
    const assetId = await uploadReady(ownerCookie, spaceId, "secret-original.jpg");

    const thumb = await request(server)
      .get(`/spaces/${spaceId}/media/${assetId}/file?v=thumbnail`)
      .set("Cookie", viewerCookie);
    expect(thumb.status).toBe(200);

    const originalAsViewer = await request(server)
      .get(`/spaces/${spaceId}/media/${assetId}/file?v=original`)
      .set("Cookie", viewerCookie);
    expect(originalAsViewer.status).toBe(403);
    expect(originalAsViewer.body.code).toBe("SPACE_ACCESS_DENIED");

    const downloadOriginal = await request(server)
      .get(`/spaces/${spaceId}/media/${assetId}/download?variant=original`)
      .set("Cookie", viewerCookie);
    expect(downloadOriginal.status).toBe(403);
    expect(downloadOriginal.body.code).toBe("SPACE_ACCESS_DENIED");

    const originalAsOwner = await request(server)
      .get(`/spaces/${spaceId}/media/${assetId}/file?v=original`)
      .set("Cookie", ownerCookie);
    expect(originalAsOwner.status).toBe(200);
    expect(originalAsOwner.headers["content-type"]).toMatch(/image\//);
  });

  it("search by filename returns only matching assets", async () => {
    const email = `search-${stamp}@pic.test`;
    const password = "password12";
    const reg = await request(server).post("/auth/register").send({ email, password });
    const cookie = cookieFrom(reg);
    const spaceId = reg.body.spaces[0].id as string;
    const sunset = await uploadReady(cookie, spaceId, "sunset-beach.jpg");
    const other = await uploadReady(cookie, spaceId, "kitchen.png");
    const found = await request(server).get(`/spaces/${spaceId}/media?q=sunset`).set("Cookie", cookie);
    expect(found.status).toBe(200);
    const ids = found.body.items.map((i: { id: string }) => i.id);
    expect(ids).toContain(sunset);
    expect(ids).not.toContain(other);
    const empty = await request(server).get(`/spaces/${spaceId}/media?q=no-such-photo`).set("Cookie", cookie);
    expect(empty.body.items).toEqual([]);
  });

  it("cross-space access is denied and content MIME is required for webp/gif/avif", async () => {
    const password = "password12";
    const a = await request(server).post("/auth/register").send({ email: `xa-${stamp}@pic.test`, password });
    const b = await request(server).post("/auth/register").send({ email: `xb-${stamp}@pic.test`, password });
    const cookieA = cookieFrom(a);
    const cookieB = cookieFrom(b);
    const spaceA = a.body.spaces[0].id as string;
    const spaceB = b.body.spaces[0].id as string;
    const assetA = await uploadReady(cookieA, spaceA, "only-a.jpg");

    const leakDetail = await request(server).get(`/spaces/${spaceB}/media/${assetA}`).set("Cookie", cookieB);
    expect(leakDetail.status).toBe(404);
    expect(leakDetail.body.code).toBe("MEDIA_NOT_FOUND");
    const leakList = await request(server).get(`/spaces/${spaceA}/media`).set("Cookie", cookieB);
    expect(leakList.status).toBe(403);
    expect(leakList.body.code).toBe("SPACE_ACCESS_DENIED");
    const leakFile = await request(server)
      .get(`/spaces/${spaceA}/media/${assetA}/file?v=thumbnail`)
      .set("Cookie", cookieB);
    expect(leakFile.status).toBe(403);

    const webp = await sharp({
      create: { width: 48, height: 36, channels: 3, background: { r: 10, g: 180, b: 90 } },
    })
      .webp()
      .toBuffer();
    expect(detectImageMime(webp)).toBe("image/webp");
    const sWebp = await request(server)
      .post("/uploads/session")
      .set("Cookie", cookieA)
      .send({ spaceId: spaceA, filename: "leaf.webp", mimeType: "image/webp", bytes: webp.length });
    await request(server).put(`/uploads/${sWebp.body.sessionId}/object`).set("Cookie", cookieA).send(webp);
    const cWebp = await request(server).post(`/uploads/${sWebp.body.sessionId}/complete`).set("Cookie", cookieA);
    await processImageJob({ prisma, storage }, cWebp.body.asset.id);
    const webpAsset = await prisma.mediaAsset.findUnique({ where: { id: cWebp.body.asset.id } });
    expect(webpAsset?.status).toBe("READY");
    expect(webpAsset?.mimeType).toBe("image/webp");

    const gif = await sharp({
      create: { width: 32, height: 24, channels: 3, background: { r: 200, g: 20, b: 20 } },
    })
      .gif()
      .toBuffer();
    expect(detectImageMime(gif)).toBe("image/gif");
    const sGif = await request(server)
      .post("/uploads/session")
      .set("Cookie", cookieA)
      .send({ spaceId: spaceA, filename: "dot.gif", mimeType: "image/gif", bytes: gif.length });
    await request(server).put(`/uploads/${sGif.body.sessionId}/object`).set("Cookie", cookieA).send(gif);
    const cGif = await request(server).post(`/uploads/${sGif.body.sessionId}/complete`).set("Cookie", cookieA);
    await processImageJob({ prisma, storage }, cGif.body.asset.id);
    const gifAsset = await prisma.mediaAsset.findUnique({ where: { id: cGif.body.asset.id } });
    expect(gifAsset?.status).toBe("READY");

    const avif = await sharp({
      create: { width: 32, height: 24, channels: 3, background: { r: 20, g: 20, b: 200 } },
    })
      .avif()
      .toBuffer();
    expect(detectImageMime(avif)).toBe("image/avif");
    const sAvif = await request(server)
      .post("/uploads/session")
      .set("Cookie", cookieA)
      .send({ spaceId: spaceA, filename: "sky.avif", mimeType: "image/avif", bytes: avif.length });
    await request(server).put(`/uploads/${sAvif.body.sessionId}/object`).set("Cookie", cookieA).send(avif);
    const cAvif = await request(server).post(`/uploads/${sAvif.body.sessionId}/complete`).set("Cookie", cookieA);
    await processImageJob({ prisma, storage }, cAvif.body.asset.id);
    const avifAsset = await prisma.mediaAsset.findUnique({ where: { id: cAvif.body.asset.id } });
    expect(avifAsset?.status).toBe("READY");

    const lying = Buffer.from("not-a-jpeg-at-all");
    expect(detectImageMime(lying)).toBeNull();
    const sLie = await request(server)
      .post("/uploads/session")
      .set("Cookie", cookieA)
      .send({ spaceId: spaceA, filename: "fake.jpg", mimeType: "image/jpeg", bytes: lying.length });
    await request(server).put(`/uploads/${sLie.body.sessionId}/object`).set("Cookie", cookieA).send(lying);
    const cLie = await request(server).post(`/uploads/${sLie.body.sessionId}/complete`).set("Cookie", cookieA);
    await processImageJob({ prisma, storage }, cLie.body.asset.id);
    const lieAsset = await prisma.mediaAsset.findUnique({ where: { id: cLie.body.asset.id } });
    expect(lieAsset?.status).toBe("PROCESSING_FAILED");
    const lib = await request(server).get(`/spaces/${spaceA}/media`).set("Cookie", cookieA);
    expect(lib.body.items.map((i: { id: string }) => i.id)).not.toContain(cLie.body.asset.id);
  });

  it("list cursor pages plus drainCursorPages return every READY asset", async () => {
    const email = `cursor-${stamp}@pic.test`;
    const password = "password12";
    const reg = await request(server).post("/auth/register").send({ email, password });
    const cookie = cookieFrom(reg);
    const spaceId = reg.body.spaces[0].id as string;
    const ids: string[] = [];
    for (const name of ["c1.jpg", "c2.jpg", "c3.jpg", "c4.jpg", "c5.jpg"]) {
      ids.push(await uploadReady(cookie, spaceId, name));
    }

    const page1 = await request(server).get(`/spaces/${spaceId}/media?limit=2`).set("Cookie", cookie);
    expect(page1.status).toBe(200);
    expect(page1.body.items).toHaveLength(2);
    expect(page1.body.hasMore).toBe(true);
    expect(page1.body.nextCursor).toBeTruthy();

    const page2 = await request(server)
      .get(`/spaces/${spaceId}/media?limit=2&cursor=${encodeURIComponent(page1.body.nextCursor)}`)
      .set("Cookie", cookie);
    expect(page2.body.items).toHaveLength(2);
    expect(page2.body.hasMore).toBe(true);

    const drained = await drainCursorPages<{ id: string }>(async (cursor) => {
      const qs = cursor
        ? `/spaces/${spaceId}/media?limit=2&cursor=${encodeURIComponent(cursor)}`
        : `/spaces/${spaceId}/media?limit=2`;
      const res = await request(server).get(qs).set("Cookie", cookie);
      expect(res.status).toBe(200);
      return res.body;
    });
    const drainedIds = drained.map((i) => i.id);
    expect(drainedIds).toHaveLength(5);
    expect(new Set(drainedIds).size).toBe(5);
    for (const id of ids) expect(drainedIds).toContain(id);
  });
});

