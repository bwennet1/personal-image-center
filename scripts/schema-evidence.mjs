#!/usr/bin/env node
import { readFileSync, writeFileSync } from "fs";
import { resolve } from "path";

const schema = readFileSync(resolve("apps/api/prisma/schema.prisma"), "utf8");
const required = [
  "model User",
  "model Space",
  "model SpaceMember",
  "model MediaAsset",
  "model MediaVersion",
  "model UploadSession",
  "model Album",
  "model Slideshow",
  "model Presentation",
  "model ShareLink",
  "spaceId",
];
const lines = ["Prisma schema evidence", ""];
for (const name of required) {
  const ok = schema.includes(name);
  lines.push(`${ok ? "OK" : "MISSING"} ${name}`);
  if (!ok) {
    writeFileSync(process.env.EVIDENCE_OUT || "schema-evidence.txt", lines.join("\n"));
    process.exit(1);
  }
}
const tenant = ["MediaAsset", "Album", "Slideshow", "Presentation", "ShareLink", "UploadSession", "Folder", "Tag"];
for (const model of tenant) {
  const re = new RegExp(`model ${model} {[\\s\\S]*?spaceId`, "m");
  const ok = re.test(schema);
  lines.push(`${ok ? "OK" : "MISSING"} ${model}.spaceId`);
  if (!ok) process.exit(1);
}
lines.push("", "--- schema excerpt ---", schema);
writeFileSync(process.env.EVIDENCE_OUT || "schema-evidence.txt", lines.join("\n"));
console.log(lines.filter((l) => l.startsWith("OK") || l.startsWith("MISSING")).join("\n"));
