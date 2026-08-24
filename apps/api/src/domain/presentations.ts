export const PRESENTATION_BLOCK_TYPES = [
  "cover",
  "text",
  "image",
  "gallery",
  "slideshow",
  "timeline",
  "ending",
] as const;

export type PresentationBlockType = (typeof PRESENTATION_BLOCK_TYPES)[number];

export const PRESENTATION_PRESETS = {
  family_memorial: {
    preset: "family_memorial",
    title: "家庭纪念",
    theme: "memorial",
    blocks: [
      { type: "cover", data: { heading: "家庭纪念", subtitle: "把共同的日子留下来" } },
      { type: "text", data: { heading: "我们的故事", body: "从一张张照片里，重新走一遍一起走过的路。" } },
      { type: "image", data: { mediaAssetId: null as string | null } },
      { type: "gallery", data: { mediaAssetIds: [] as string[] } },
      { type: "slideshow", data: { slideshowId: null as string | null } },
      { type: "timeline", data: { mediaAssetIds: [] as string[] } },
      { type: "ending", data: { heading: "愿这些画面被好好保存", body: "" } },
    ],
  },
  travel: {
    preset: "travel",
    title: "旅行记录",
    theme: "travel",
    blocks: [
      { type: "cover", data: { heading: "旅行记录", subtitle: "路途与风景" } },
      { type: "text", data: { heading: "出发", body: "把每一次停留写成一页。" } },
      { type: "gallery", data: { mediaAssetIds: [] as string[] } },
      { type: "timeline", data: { mediaAssetIds: [] as string[] } },
      { type: "ending", data: { heading: "下一站见", body: "" } },
    ],
  },
  year_in_review: {
    preset: "year_in_review",
    title: "年度回忆",
    theme: "year",
    blocks: [
      { type: "cover", data: { heading: "年度回忆", subtitle: "这一年的光" } },
      { type: "gallery", data: { mediaAssetIds: [] as string[] } },
      { type: "timeline", data: { mediaAssetIds: [] as string[] } },
      { type: "ending", data: { heading: "明年继续记录", body: "" } },
    ],
  },
  portfolio: {
    preset: "portfolio",
    title: "摄影作品集",
    theme: "portfolio",
    blocks: [
      { type: "cover", data: { heading: "摄影作品集", subtitle: "" } },
      { type: "gallery", data: { mediaAssetIds: [] as string[] } },
      { type: "image", data: { mediaAssetId: null as string | null } },
      { type: "ending", data: { heading: "谢谢观看", body: "" } },
    ],
  },
} as const;

export type PresentationPresetKey = keyof typeof PRESENTATION_PRESETS;

export function isBlockType(value: string): value is PresentationBlockType {
  return (PRESENTATION_BLOCK_TYPES as readonly string[]).includes(value);
}

export function collectMediaAssetIdsFromBlocks(blocks: { type: string; data: unknown }[]): string[] {
  const ids = new Set<string>();
  for (const block of blocks) {
    const data = (block.data || {}) as Record<string, unknown>;
    if (typeof data.mediaAssetId === "string") ids.add(data.mediaAssetId);
    if (Array.isArray(data.mediaAssetIds)) {
      for (const id of data.mediaAssetIds) if (typeof id === "string") ids.add(id);
    }
  }
  return [...ids];
}
