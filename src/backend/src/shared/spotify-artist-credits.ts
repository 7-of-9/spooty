// Some historical dumps contain a truncated ten-artist credit list. Only accept
// an exact ten-name prefix followed by additional full credits. Callers must
// still validate the exact Spotify track ID and normalized title separately.
export function spotifyArtistCreditsMatch(saved: string, current: string): boolean {
  const normalize = (value: string) => String(value || '').normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ');
  const expected = normalize(saved), actual = normalize(current);
  return !!expected && (actual === expected ||
    (expected.split(', ').length === 10 && actual.startsWith(expected + ', ')));
}
