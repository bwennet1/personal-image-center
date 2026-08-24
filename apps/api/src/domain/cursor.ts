export type CursorPage<T> = {
  items: T[];
  nextCursor?: string | null;
  hasMore?: boolean;
};

/** Follow nextCursor until the list endpoint is exhausted. */
export async function drainCursorPages<T>(
  fetchPage: (cursor?: string) => Promise<CursorPage<T>>,
  maxPages = 100,
): Promise<T[]> {
  const items: T[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < maxPages; page++) {
    const data = await fetchPage(cursor);
    items.push(...(data.items || []));
    if (!data.hasMore || !data.nextCursor) return items;
    cursor = data.nextCursor;
  }
  return items;
}
