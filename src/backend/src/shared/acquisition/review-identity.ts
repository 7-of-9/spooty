import { sourceKey } from './identity';
import { spotifySourceId, trackSourceId } from './source-id';

export interface SourceReview {
  key: string;
  status: 'needs-review' | 'needs-repair' | 'resolved';
  catalogTrackId?: string;
  reference?: string;
  durationAudit?: { files?: Array<{ spotifyId?: string; [key: string]: any }> };
  [key: string]: any;
}

/** Explicit public source evidence, never a guess from an artist/title alias. */
export function reviewSourceIds(entry: SourceReview): string[] {
  const keyedId = entry.key.match(/^spotify:([A-Za-z0-9]{22})$/)?.[1];
  const ids = [...new Set([entry.catalogTrackId, entry.reference,
    ...(entry.durationAudit?.files || []).map(file => file.spotifyId)]
    .map(spotifySourceId).filter((id): id is string => !!id))];
  if (keyedId && ids.some(id => id !== keyedId)) throw new Error('Conflicting Spotify identities in review evidence');
  return keyedId ? [keyedId] : ids;
}

/** Read-only compatibility for older review ledgers. Keep the latest record
 * for each historical key; do not rewrite keys, resolve reviews or queue work.
 * Group reviews can inform inspection of each explicitly named source, but
 * cannot certify that replacing one source fixes the whole group. */
export class SourceReviewIndex {
  readonly entries: SourceReview[];
  readonly unbound: SourceReview[];
  private byKey: Map<string, SourceReview>;
  private bySource = new Map<string, SourceReview[]>();

  constructor(entries: SourceReview[]) {
    if (!Array.isArray(entries)) throw new Error('Invalid source review ledger');
    for (const entry of entries) {
      const files = entry?.durationAudit?.files;
      if (!entry || typeof entry.key !== 'string' || !entry.key ||
          !['needs-review', 'needs-repair', 'resolved'].includes(entry.status) ||
          (files !== undefined && (!Array.isArray(files) || files.some(file => !file || typeof file !== 'object')))) {
        throw new Error('Invalid source review ledger');
      }
    }
    this.byKey = new Map(entries.map(entry => [entry.key, entry]));
    this.entries = [...this.byKey.values()];
    this.unbound = [];
    for (const entry of this.entries) {
      const ids = reviewSourceIds(entry);
      if (!ids.length) this.unbound.push(entry);
      for (const id of ids) this.bySource.set(id, [...(this.bySource.get(id) || []), entry]);
    }
  }

  forTrack(track: any): SourceReview[] {
    const key = track.key || sourceKey(track);
    const keyedId = key.match(/^spotify:([A-Za-z0-9]{22})$/)?.[1];
    const directId = trackSourceId(track);
    if (keyedId && directId && keyedId !== directId) throw new Error('Conflicting Spotify identities in review target');
    const id = directId || keyedId;
    const exact = this.byKey.get(key);
    const bound = id ? this.bySource.get(id) || [] : [];
    if (!id && exact) return [exact]; // Historical grouped-key observations.
    // An old caller can still observe its exact legacy key. New source-keyed
    // callers must not borrow a name-only review, even for a unique current name.
    if (!keyedId && exact && !reviewSourceIds(exact).length) return [exact, ...bound];
    return bound;
  }

  statusFor(track: any): SourceReview['status'] | null {
    const entries = this.forTrack(track);
    return entries.some(e => e.status === 'needs-repair') ? 'needs-repair'
      : entries.some(e => e.status === 'needs-review') ? 'needs-review'
      : entries.length ? 'resolved' : null;
  }

  inspectionPlan(songs: any[]) {
    const unique = [...new Map(songs.map(song => [song.key || sourceKey(song), song])).values()];
    const mapped = unique.filter(song => this.forTrack(song).some(entry => entry.status !== 'resolved'));
    const available = mapped.filter(song => song.url && song.source);
    return { songs: available, mappedSources: mapped.length,
      unavailableSources: mapped.length - available.length,
      unboundLegacyReviews: this.unbound.filter(entry => entry.status !== 'resolved').length };
  }
}
