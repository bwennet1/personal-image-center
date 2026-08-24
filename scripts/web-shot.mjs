#!/usr/bin/env node
import { writeFileSync } from "fs";
import { createRequire } from "module";
import { resolve } from "path";

const require = createRequire(import.meta.url);
const scratch = process.env.SCRATCH || resolve(".");
const logPath = process.env.WEB_LAUNCH_LOG || resolve(scratch, "web-launch.log");
const lines = [];
const log = (m) => {
  lines.push(m);
  console.log(m);
};

async function main() {
  let chromium;
  try {
    ({ chromium } = require("playwright-core"));
    log("playwright-core loaded");
  } catch (e) {
    log("playwright-core missing: " + e.message);
    writeFileSync(logPath, lines.join("\n") + "\n");
    process.exit(1);
  }
  const web = process.env.WEB_URL || "http://127.0.0.1:3000";
  const browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH || "/usr/bin/google-chrome",
    headless: true,
    args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const pageErrors = [];
  page.on("pageerror", (err) => {
    pageErrors.push(err.message);
    log("pageerror " + err.message);
  });

  await page.goto(web + "/login", { waitUntil: "networkidle" });
  const loginBox = await page.locator("form.card").boundingBox();
  log("login form box " + JSON.stringify(loginBox));
  if (!loginBox || loginBox.height < 280 || loginBox.width < 280) {
    throw new Error("login form not substantially filled");
  }
  const emailVisible = await page.locator("#email").isVisible();
  const passVisible = await page.locator("#password").isVisible();
  log("login fields email=" + emailVisible + " password=" + passVisible);
  await page.screenshot({ path: resolve(scratch, "web-1.png"), fullPage: true });
  log("wrote web-1.png");

  await page.goto(web + "/register", { waitUntil: "networkidle" });
  const email = `webshot-${Date.now()}@pic.test`;
  await page.fill("#displayName", "网页用户");
  await page.fill("#email", email);
  await page.fill("#password", "password12");
  await page.click("button[type=submit]");
  await page.waitForURL(/\/app/, { timeout: 25000 });
  await page.waitForSelector(".empty, .library, .grid", { timeout: 15000 });
  const surface = await page.locator(".empty, .library").first().boundingBox();
  log("app surface " + JSON.stringify(surface));
  if (!surface || surface.height < 240) throw new Error("app surface not filled");
  const before = page.url();
  await page.click("a[href='/app/albums']");
  await page.waitForURL(/\/app\/albums/, { timeout: 10000 });
  log("navigated " + before + " -> " + page.url());
  await page.screenshot({ path: resolve(scratch, "web-2.png"), fullPage: true });
  log("wrote web-2.png");
  await browser.close();
  if (pageErrors.length) throw new Error("page errors: " + pageErrors.join("; "));
  log("OK");
  writeFileSync(logPath, lines.join("\n") + "\n");
}

main().catch((e) => {
  lines.push("FAILED " + (e.stack || e));
  writeFileSync(logPath, lines.join("\n") + "\n");
  console.error(e);
  process.exit(1);
});
