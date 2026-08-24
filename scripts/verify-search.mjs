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

async function jpeg(w, h, r, g, b) {
  return sharp({ create: { width: w, height: h, channels: 3, background: { r, g, b } } })
    .jpeg({ quality: 85 })
    .toBuffer();
}

async function main() {
  const sunset = resolve(scratch, "sunset-beach.jpg");
  const kitchen = resolve(scratch, "kitchen.jpg");
  writeFileSync(sunset, await jpeg(640, 400, 210, 90, 40));
  writeFileSync(kitchen, await jpeg(400, 640, 40, 90, 160));

  const { chromium } = require("playwright-core");
  const browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH || "/usr/bin/google-chrome",
    headless: true,
    args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const web = process.env.WEB_URL || "http://127.0.0.1:3000";
  await page.goto(web + "/register", { waitUntil: "networkidle" });
  await page.fill("#displayName", "搜索用户");
  await page.fill("#email", `searchui-${Date.now()}@pic.test`);
  await page.fill("#password", "password12");
  await page.click("button[type=submit]");
  await page.waitForURL(/\/app/, { timeout: 20000 });
  await page.waitForSelector(".library", { timeout: 15000 });

  const file = page.locator('input[type=file]');
  await file.setInputFiles(sunset);
  await page.waitForSelector(".tile img", { timeout: 25000 });
  await file.setInputFiles(kitchen);
  await page.waitForFunction(() => document.querySelectorAll(".tile img").length >= 2, null, { timeout: 25000 });
  log("uploaded " + (await page.locator(".tile img").count()));

  await page.fill('input[aria-label="搜索"]', "sunset");
  await page.locator('input[aria-label="搜索"]').press("Enter");
  await page.waitForURL(/q=sunset/, { timeout: 10000 });
  await page.waitForTimeout(800);
  const after = await page.locator(".tile img").count();
  log("search tiles " + after + " url=" + page.url());
  if (after !== 1) throw new Error("expected 1 search result, got " + after);
  await page.screenshot({ path: resolve(scratch, "opt-search.png"), fullPage: true });

  await page.getByRole("link", { name: "清除搜索" }).click();
  await page.waitForFunction(() => document.querySelectorAll(".tile img").length >= 2, null, { timeout: 10000 });
  await page.getByRole("button", { name: "多选" }).click();
  await page.locator(".tile").first().click();
  await page.waitForSelector(".batch-bar", { timeout: 5000 });
  log("batch bar visible");
  await page.screenshot({ path: resolve(scratch, "opt-select.png"), fullPage: true });

  await browser.close();
  log("OK");
  writeFileSync(resolve(scratch, "opt-search.log"), lines.join("\n") + "\n");
}

main().catch((e) => {
  lines.push("FAILED " + (e.stack || e));
  writeFileSync(resolve(scratch, "opt-search.log"), lines.join("\n") + "\n");
  console.error(e);
  process.exit(1);
});
