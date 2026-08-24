#!/usr/bin/env node
import { writeFileSync } from "fs";
import { createRequire } from "module";
import { resolve } from "path";
import sharp from "sharp";

const require = createRequire(import.meta.url);
const scratch = process.env.SCRATCH || resolve(".");
const lines = [];
const log = (m) => {
  lines.push(m);
  console.log(m);
};

async function main() {
  const jpegPath = resolve(scratch, "upload-sample.jpg");
  await sharp({
    create: { width: 800, height: 520, channels: 3, background: { r: 210, g: 96, b: 48 } },
  })
    .jpeg({ quality: 88 })
    .toFile(jpegPath);

  const { chromium } = require("playwright-core");
  const browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH || "/usr/bin/google-chrome",
    headless: true,
    args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const web = process.env.WEB_URL || "http://127.0.0.1:3000";

  await page.goto(web + "/register", { waitUntil: "networkidle" });
  const email = `opt-${Date.now()}@pic.test`;
  await page.fill("#displayName", "优化用户");
  await page.fill("#email", email);
  await page.fill("#password", "password12");
  await page.click("button[type=submit]");
  await page.waitForURL(/\/app/, { timeout: 20000 });
  await page.waitForSelector(".library", { timeout: 15000 });
  log("landed " + page.url());

  const input = page.locator('input[type=file]');
  await input.setInputFiles(jpegPath);
  await page.waitForSelector(".tile img", { timeout: 25000 });
  const tiles = await page.locator(".tile img").count();
  log("grid images " + tiles);
  if (tiles < 1) throw new Error("grid did not show uploaded image");
  await page.screenshot({ path: resolve(scratch, "opt-grid.png"), fullPage: true });

  await page.locator(".tile img").first().click();
  await page.waitForSelector(".viewer img", { timeout: 8000 });
  log("viewer opened");
  await page.screenshot({ path: resolve(scratch, "opt-viewer.png") });
  await page.keyboard.press("Escape");

  await page.click("a[href='/app/albums']");
  await page.waitForURL(/\/app\/albums/, { timeout: 10000 });
  await page.fill("input[placeholder='新相册名称']", "周末");
  await page.click("button[type=submit]");
  await page.waitForSelector("a.album-tile, a.tile", { timeout: 10000 });
  await page.locator("a.tile, a.album-tile").first().click();
  await page.waitForURL(/\/app\/albums\//, { timeout: 10000 });
  await page.getByRole("button", { name: "添加图片" }).click();
  await page.waitForSelector(".modal .tile", { timeout: 8000 });
  await page.locator(".modal .tile").first().click();
  await page.waitForSelector(".modal .tile.picked", { timeout: 5000 });
  await page.getByRole("button", { name: "加入相册" }).click();
  await page.waitForSelector(".modal", { state: "detached", timeout: 10000 });
  await page.waitForSelector(".library .grid .tile img", { timeout: 10000 });
  log("album has photos " + (await page.locator(".library .grid .tile img").count()));
  await page.screenshot({ path: resolve(scratch, "opt-album.png"), fullPage: true });

  await browser.close();
  if (errors.length) throw new Error(errors.join("; "));
  log("OK");
  writeFileSync(resolve(scratch, "opt-verify.log"), lines.join("\n") + "\n");
}

main().catch((e) => {
  lines.push("FAILED " + (e.stack || e));
  writeFileSync(resolve(scratch, "opt-verify.log"), lines.join("\n") + "\n");
  console.error(e);
  process.exit(1);
});
