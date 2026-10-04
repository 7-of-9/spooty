export type PlaylistV2Item = { uri?: string };

export type PlaylistV2Page = {
  length?: number;
  attributes?: { name?: string };
  contents?: {
    items?: PlaylistV2Item[];
    truncated?: boolean;
    pos?: number;
  };
};

export function trackIdFromUri(uri: string | undefined): string | null {
  if (!uri || !uri.startsWith('spotify:track:')) return null;
  return uri.slice('spotify:track:'.length) || null;
}

/** Merge playlist/v2 pages in order, preserving repeated playlist entries. */
export function mergePlaylistV2Pages(pages: PlaylistV2Page[]): {
  length: number;
  trackIds: string[];
  name?: string;
  truncated: boolean;
} {
  const trackIds: string[] = [];
  let length = 0;
  let name: string | undefined;
  let truncated = false;
  for (const page of pages) {
    if (typeof page.length === 'number') length = page.length;
    if (page.attributes?.name) name = page.attributes.name;
    truncated = !!page.contents?.truncated;
    for (const it of page.contents?.items || []) {
      const id = trackIdFromUri(it?.uri);
      if (!id) continue;
      trackIds.push(id);
    }
  }
  return { length, trackIds, name, truncated };
}

/**
 * Next `from` offset for playlist/v2. Null means stop.
 * `collectedItems` is the count of all content rows seen (tracks + other),
 * not unique track ids — playlist `length` includes episodes/locals.
 */
export function nextPlaylistOffset(
  page: PlaylistV2Page,
  collectedItems: number,
  length: number,
): number | null {
  if (length > 0 && collectedItems >= length) return null;
  if (!page.contents?.truncated) return null;
  const items = page.contents?.items || [];
  if (!items.length) return null;
  return collectedItems;
}

/**
 * Drive paging via `fetchPage(from)` until the source is no longer truncated
 * (or collected rows reach `length`). Used by SpotifySessionService and tests.
 */
export async function collectPlaylistV2TrackIds(
  fetchPage: (from: number) => Promise<PlaylistV2Page>,
): Promise<{
  length: number;
  trackIds: string[];
  name?: string;
  truncated: boolean;
}> {
  const pages: PlaylistV2Page[] = [];
  let from = 0;
  let collectedItems = 0;
  let declaredLength: number | null = null;
  for (let i = 0; i < 80; i++) {
    const page = await fetchPage(from);
    const invalidLength = typeof page.length === 'number' &&
      (!Number.isSafeInteger(page.length) || page.length < 0 ||
       (declaredLength !== null && page.length !== declaredLength));
    if (
      invalidLength ||
      !Array.isArray(page.contents?.items) ||
      // Only understood exclusions are safe. A malformed track row must not
      // silently disappear and be mistaken for an intentional removal.
      (page.contents?.items || []).some(item =>
        !/^spotify:track:[A-Za-z0-9]{22}$/.test(item?.uri || '') &&
        !/^spotify:episode:[A-Za-z0-9]{22}$/.test(item?.uri || '') &&
        !/^spotify:local:.+/.test(item?.uri || '')) ||
      (from === 0 && typeof page.length !== 'number') ||
      (typeof page.contents?.pos === 'number' && page.contents.pos !== from)
    ) {
      const merged = mergePlaylistV2Pages(pages);
      return {
        length: merged.length,
        trackIds: merged.trackIds,
        name: merged.name,
        truncated: true,
      };
    }
    if (typeof page.length === 'number') declaredLength = page.length;
    const items = page.contents?.items || [];
    pages.push(page);
    collectedItems += items.length;
    const merged = mergePlaylistV2Pages(pages);
    const next = nextPlaylistOffset(page, collectedItems, merged.length);
    if (next == null) {
      return {
        length: merged.length,
        trackIds: merged.trackIds,
        name: merged.name,
        // A false/omitted truncated flag cannot overrule an incomplete count.
        // Non-track rows are counted too, before extracting track ids.
        truncated: collectedItems !== merged.length || !!page.contents?.truncated,
      };
    }
    if (next <= from) {
      return {
        length: merged.length,
        trackIds: merged.trackIds,
        name: merged.name,
        truncated: true,
      };
    }
    from = next;
  }
  const merged = mergePlaylistV2Pages(pages);
  return {
    length: merged.length,
    trackIds: merged.trackIds,
    name: merged.name,
    truncated: true,
  };
}
