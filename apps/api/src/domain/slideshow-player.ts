export const SLIDESHOW_TRANSITIONS = [
  "cross_fade",
  "fade_to_black",
  "slide",
  "zoom",
  "ken_burns",
  "none",
] as const;

export type SlideshowTransition = (typeof SLIDESHOW_TRANSITIONS)[number];

export function isSlideshowTransition(value: string): value is SlideshowTransition {
  return (SLIDESHOW_TRANSITIONS as readonly string[]).includes(value);
}

export interface SlideshowPlayItem {
  assetId: string;
  failed?: boolean;
}

export function playableItems<T extends SlideshowPlayItem>(items: T[]): T[] {
  return items.filter((item) => !item.failed);
}

/**
 * Advance to the next/previous playable item. A failed image is skipped;
 * the sequence is never aborted because of a single failure.
 */
export function nextPlayableIndex(
  items: SlideshowPlayItem[],
  from: number,
  direction: 1 | -1,
): { index: number; skipped: number } {
  const n = items.length;
  if (n === 0) return { index: 0, skipped: 0 };
  let skipped = 0;
  let i = from;
  for (let step = 0; step < n; step++) {
    i = (i + direction + n) % n;
    if (!items[i].failed) return { index: i, skipped };
    skipped += 1;
  }
  return { index: from, skipped };
}

export function shouldAbortSlideshowOnImageFailure(): false {
  return false;
}

export function shouldBlockSlideshowOnMusicFailure(): false {
  return false;
}

export const DEFAULT_SLIDESHOW = {
  stayDurationMs: 6000,
  transition: "cross_fade" as SlideshowTransition,
  transitionMs: 900,
  background: "blur",
  loop: true,
  random: false,
  captions: false,
  showDate: false,
  showLocation: false,
};
