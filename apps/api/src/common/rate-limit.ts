import { fail } from "../domain/errors";

const buckets = new Map<string, number[]>();

export function rateLimit(key: string, limit: number, windowMs: number): void {
  if (process.env.NODE_ENV === "test" || process.env.JEST_WORKER_ID) return;
  const now = Date.now();
  const arr = (buckets.get(key) || []).filter((t) => now - t < windowMs);
  if (arr.length >= limit) fail("AUTH_RATE_LIMITED");
  arr.push(now);
  buckets.set(key, arr);
}
