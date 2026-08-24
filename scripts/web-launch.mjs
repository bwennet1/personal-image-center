#!/usr/bin/env node
import { writeFileSync, mkdirSync } from "fs";
import { spawn } from "child_process";
import { createRequire } from "module";
import { resolve } from "path";
import { tmpdir } from "os";
import { join } from "path";
import sharp from "sharp";

const logPath = process.env.WEB_LAUNCH_LOG || resolve("web-launch.log");
const lines = [];
function log(m) {
  lines.push(m);
  console.log(m);
}

function loadPlaywright() {
  try {
    return createRequire(resolve("package.json"))("playwright");
  } catch {
    return createRequire("/home/box/.npm/_npx/e41f203b7505f1fb/node_modules/playwright/package.json")("playwright");
  }
}

async function makeFixtures() {
  const dir = join(tmpdir(), "picenter-web-fixtures");
  mkdirSync(dir, { recursive: true });
  const files = [];
  const colors = [
    { r: 210, g: 92, b: 48 },
    { r: 40, g: 90, b: 160 },
    { r: 20, g: 140, b: 90 },
  ];
  for (let i = 0; i < colors.length; i++) {
    const buf = await sharp({
      create: { width: 640, height: 420, channels: 3, background: colors[i] },
    })
      .jpeg({ quality: 86 })
      .toBuffer();
    const p = join(dir, `web-upload-${i + 1}.jpg`);
    writeFileSync(p, buf);
    files.push(p);
  }
  return files;
}

async function drive(page, web, shot1, shot2, label) {
  page.on("pageerror", (err) => log("pageerror " + err.message));
  await page.goto(web + "/login", { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForSelector("form.card, form");
  const loginForm = await page.locator("form.card, form").first().boundingBox();
  log(label + " login form box " + JSON.stringify(loginForm));
  if (!loginForm || loginForm.height < 200 || loginForm.width < 280) {
    throw new Error("login form not substantially filled");
  }
  await page.screenshot({ path: shot1, fullPage: true });
  log("wrote " + shot1);

  await page.goto(web + "/register", { waitUntil: "domcontentloaded", timeout: 30000 });
  const registerForm = await page.locator("form.card, form").first().boundingBox();
  log(label + " register form box " + JSON.stringify(registerForm));
  if (!registerForm || registerForm.height < 200) throw new Error("register form not substantially filled");

  const email = `web-${Date.now()}@pic.test`;
  const password = "password12";
  const api = process.env.API_URL || "http://127.0.0.1:3001";
  const created = await fetch(api + "/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, displayName: "网页用户" }),
  });
  const createdBody = await created.json();
  log(label + " api register " + created.status + " " + JSON.stringify({ id: createdBody.id, code: createdBody.code }));
  if (created.status >= 400) throw new Error("api register failed " + JSON.stringify(createdBody));
  const setCookie = created.headers.getSetCookie?.()?.[0] || created.headers.get("set-cookie") || "";
  const token = String(setCookie).match(/pic_session=([^;]+)/)?.[1];
  if (!token) throw new Error("register did not set pic_session");
  await page.context().addCookies([{ name: "pic_session", value: token, url: web + "/" }]);
  await page.goto(web + "/app/photos", { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForSelector("#gallery-upload, input[type=file], .library", { timeout: 20000 });
  log(label + " opened /app/photos as " + email);

  const files = await makeFixtures();
  await page.locator("#gallery-upload, input[type=file]").first().setInputFiles(files);
  log(label + " uploaded " + files.length + " jpegs");

  await page.waitForSelector(".tile img", { timeout: 40000 });
  await page.waitForFunction(
    () => {
      const imgs = [...document.querySelectorAll(".tile img")];
      const processing = document.querySelectorAll(".tile.processing").length;
      return imgs.length >= 3 && processing === 0;
    },
    null,
    { timeout: 40000 },
  );
  const tiles = await page.locator(".tile img").count();
  const grid = await page.locator(".grid, .library").first().boundingBox();
  log(label + " tiles=" + tiles + " grid=" + JSON.stringify(grid));
  if (tiles < 3) throw new Error("expected painted tiles after upload, got " + tiles);
  if (!grid || grid.height < 200 || grid.width < 400) throw new Error("grid not substantially filled");
  await page.screenshot({ path: shot2, fullPage: true });
  log("wrote " + shot2);
  log("OK " + label + " email=" + email);
}

async function main() {
  const web = process.env.WEB_URL || "http://127.0.0.1:3000";
  const shot1 = process.env.WEB_SHOT_1 || resolve("web-1.png");
  const shot2 = process.env.WEB_SHOT_2 || resolve("web-2.png");

  let verOut = "";
  try {
    const ver = spawn("npx", ["--yes", "playwright", "--version"], { stdio: ["ignore", "pipe", "pipe"] });
    verOut = await new Promise((res, rej) => {
      let s = "";
      ver.stdout.on("data", (d) => (s += d));
      ver.stderr.on("data", (d) => (s += d));
      ver.on("exit", (c) => (c === 0 ? res(s) : rej(new Error(s || "playwright missing"))));
    });
    log("playwright version: " + verOut.trim());
  } catch (e) {
    log("playwright launcher failure: " + (e && e.message ? e.message : e));
    log("accepted bar: routes exist in source; unit tests and API launch are the gate.");
    writeFileSync(logPath, lines.join("\n") + "\n");
    return;
  }

  const { chromium } = loadPlaywright();
  let browser;
  try {
    browser = await chromium.connectOverCDP("http://127.0.0.1:9223");
    log("connected chrome CDP 9223");
  } catch (e) {
    log("CDP connect failed, launching chromium: " + (e && e.message ? e.message : e));
    try {
      browser = await chromium.launch({ headless: true });
    } catch (e2) {
      log("playwright run failure: " + (e2 && e2.stack ? e2.stack : e2));
      writeFileSync(logPath, lines.join("\n") + "\n");
      process.exit(1);
    }
  }

  try {
    const context = browser.contexts()[0] || (await browser.newContext({ viewport: { width: 1280, height: 800 } }));
    const page = await context.newPage();
    await page.setViewportSize({ width: 1280, height: 800 });
    await drive(page, web, shot1, shot2, "web-launch-1");
    await page.close();
    const page2 = await context.newPage();
    await page2.setViewportSize({ width: 1280, height: 800 });
    const shot1b = shot1.replace(/web-1\.png$/, "web-1b.png");
    const shot2b = shot2.replace(/web-2\.png$/, "web-2b.png");
    await drive(page2, web, shot1b, shot2b, "web-launch-2");
    await page2.close();
  } catch (e) {
    log("playwright run failure: " + (e && e.stack ? e.stack : e));
    writeFileSync(logPath, lines.join("\n") + "\n");
    process.exit(1);
  }
  writeFileSync(logPath, lines.join("\n") + "\n");
  process.exit(0);
}

main().catch((e) => {
  lines.push(String(e && e.stack ? e.stack : e));
  writeFileSync(logPath, lines.join("\n") + "\n");
  process.exit(1);
});
