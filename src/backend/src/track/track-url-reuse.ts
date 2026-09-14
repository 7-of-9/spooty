export type UrlReuseTrack = {
  id?: number;
  artist: string;
  name: string;
  youtubeUrl?: string | null;
};

export function pickReusedYoutubeUrl(
  track: UrlReuseTrack,
  rows: UrlReuseTrack[],
): string | null {
  const artist = (track.artist || '').trim();
  const name = (track.name || '').trim();
  if (!artist || !name) return null;
  for (const row of rows) {
    if (track.id != null && row.id === track.id) continue;
    if ((row.artist || '').trim() !== artist) continue;
    if ((row.name || '').trim() !== name) continue;
    const url = (row.youtubeUrl || '').trim();
    if (/^https?:\/\//i.test(url)) return url;
  }
  return null;
}

export async function resolveYoutubeUrlForTrack(
  track: UrlReuseTrack,
  siblings: UrlReuseTrack[],
  search: (artist: string, name: string) => Promise<string>,
): Promise<{ youtubeUrl: string; reused: boolean }> {
  const reused = pickReusedYoutubeUrl(track, siblings);
  if (reused) return { youtubeUrl: reused, reused: true };
  return { youtubeUrl: await search(track.artist, track.name), reused: false };
}
