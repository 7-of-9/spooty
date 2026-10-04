import {
  youtubeSearchQuery,
  YoutubeSearchCandidate,
} from '../youtube-search-batch';
import { durationMatch, DURATION_NO_CANDIDATE } from './duration-policy';
import { youtubeVideoId } from '../youtube-download-batch';

export const SEARCH_QUERY_LIMIT = 3;
export const SEARCH_INSPECTION_LIMIT = 2;
export const SEARCH_POLICY = 'identity-variants-v1';

const normalized = (value: unknown): string =>
  String(value || '')
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
const clean = (value: unknown) =>
  String(value || '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .trim()
    .slice(0, 500);
const primaryArtist = (artist: string) =>
  artist.split(/,|\s+(?:feat\.?|ft\.?)\s+/i)[0];
const baseTitle = (name: string) =>
  name
    .replace(/\s*[-(\[]\s*(?:\d{4}\s+)?remaster(?:ed)?[^)\]]*[)\]]?/gi, '')
    .trim();

/** At most three distinct queries; the original query is always tried first. */
export function youtubeQueryVariants(song: {
  artist: string;
  name: string;
  album?: string;
}): string[] {
  const artist = primaryArtist(song.artist);
  const title = baseTitle(song.name);
  const variants = [
    youtubeSearchQuery(song.artist, song.name),
    song.album
      ? youtubeSearchQuery(artist, `${title} ${song.album}`)
      : youtubeSearchQuery(artist, `${title} audio`),
    youtubeSearchQuery(artist, `${title} official audio`),
  ];
  return [
    ...new Set(
      variants.map((q) => clean(q).replace(/\s+/g, ' ')).filter(Boolean),
    ),
  ].slice(0, SEARCH_QUERY_LIMIT);
}

/** Conservative metadata check, not an audio fingerprint or identity certification. */
export function candidateIdentity(
  song,
  candidate,
): { ok: boolean; reason: string } {
  const title = normalized(candidate.title);
  const expectedTitle = normalized(baseTitle(song.name));
  if (!title) return { ok: false, reason: 'missing-title' };
  const modifiers =
    /\b(?:official|audio|video|lyrics?|hd|hq|remaster(?:ed)?|version|mix|original|studio|instrumental)\b/g;
  const wanted =
    normalized(expectedTitle.replace(modifiers, ' ')) || expectedTitle;
  const actual = normalized(title.replace(modifiers, ' '));
  // Keep the song phrase together: scattered words in a TV scene/news title
  // (e.g. "Vincent explains his plan in The Originals") are not a title match.
  if (!wanted || !` ${actual} `.includes(` ${wanted} `))
    return { ok: false, reason: 'title-mismatch' };
  const artist = normalized(primaryArtist(song.artist));
  const credits = [
    candidate.title,
    candidate.channel,
    candidate.uploader,
    candidate.artist,
  ].map((value) => ` ${normalized(value)} `);
  if (!artist || !credits.some((value) => value.includes(` ${artist} `)))
    return { ok: false, reason: 'artist-mismatch' };
  // Do not turn an original song into a cover/live/remix/instrumental because its length fits.
  for (const edition of [
    'cover',
    'karaoke',
    'live',
    'remix',
    'instrumental',
    'acoustic',
    'sped up',
    'slowed',
  ]) {
    const token = new RegExp(`\\b${edition}\\b`);
    if (token.test(title) !== token.test(expectedTitle))
      return { ok: false, reason: 'edition-mismatch' };
  }
  return { ok: true, reason: 'match' };
}

export type DiscoveryIO = {
  search: (
    queries: string[],
    timeoutMs: number,
  ) => Promise<{ documents: any[]; error?: string }>;
  inspect: (
    items: any[],
    timeoutMs: number,
  ) => Promise<{ evidence: Map<string, any>; error?: string }>;
  record: (song: any, report: any) => void;
  onResult: (song: any, url: string | null) => any;
};

/** Scheduler-neutral policy. Every network call is supplied by the paced Transport. */
export async function discoverYoutubeCandidates(
  songs: any[],
  limit: number,
  ledger: any,
  io: DiscoveryIO,
) {
  const deadline =
    Date.now() + Math.min(840000, Math.max(90000, songs.length * 90000));
  const contexts = songs.map((song) => ({
    song,
    queries: youtubeQueryVariants(song),
    candidates: new Map<string, any>(),
    inspected: new Set<string>(),
    inspections: 0,
    nonempty: false,
    done: false,
    error: null as string | null,
    report: {
      policy: SEARCH_POLICY,
      startedAt: new Date().toISOString(),
      expectedSeconds: song.durationMs / 1000,
      toleranceSeconds: durationMatch(song.durationMs, undefined)
        .toleranceSeconds,
      maxSearches: limit,
      maxQueries: SEARCH_QUERY_LIMIT,
      queries: [] as any[],
      outcome: 'searching',
      selectedUrl: null as string | null,
    },
  }));
  const finish = async (ctx, url: string | null) => {
    try {
      await io.onResult(ctx.song, url);
      ctx.done = true;
      ctx.report.selectedUrl = url;
      ctx.report.outcome = url ? 'selected' : 'missing';
    } catch (e) {
      ctx.error = e.message;
      ctx.report.outcome = 'error';
    }
  };
  for (let round = 0; round < SEARCH_QUERY_LIMIT; round++) {
    const pending = contexts.filter(
      (c) => !c.done && !c.error && c.queries[round],
    );
    if (!pending.length) break;
    if (Date.now() >= deadline) {
      for (const c of pending) c.error = 'YouTube operation timed out';
      break;
    }
    const response = await io.search(
      [...new Set(pending.map((c) => c.queries[round]))],
      deadline - Date.now(),
    );
    const documents = new Map(response.documents.map((d) => [d.query, d]));
    const inspections: any[] = [];
    for (const ctx of pending) {
      const doc = documents.get(ctx.queries[round]);
      if (!doc) {
        ctx.error = response.error || 'Search did not complete';
        continue;
      }
      ctx.song.searchLimit = limit;
      ctx.nonempty ||= !doc.emptyResults;
      const queryReport = {
        query: doc.query,
        candidates: [] as any[],
        empty: doc.emptyResults,
      };
      ctx.report.queries.push(queryReport);
      for (const [index, candidate] of (
        doc.candidates as YoutubeSearchCandidate[]
      ).entries()) {
        const previous = ctx.candidates.get(candidate.videoId);
        const merged = {
          ...previous,
          ...candidate,
          durationSeconds:
            candidate.durationSeconds ?? previous?.durationSeconds,
        };
        const identity = candidateIdentity(ctx.song, merged);
        const duration = durationMatch(
          ctx.song.durationMs,
          merged.durationSeconds,
        );
        const rejected = ledger
          .rejected(ctx.song)
          .some(
            (r) =>
              r.expectedMs === ctx.song.durationMs &&
              youtubeVideoId(r.url) === candidate.videoId,
          );
        const evidence = {
          rank: index + 1,
          videoId: candidate.videoId,
          url: candidate.url,
          title: clean(candidate.title),
          channel: clean(candidate.channel),
          uploader: clean(candidate.uploader),
          durationSeconds: merged.durationSeconds,
          duplicate: !!previous,
          identity: identity.reason,
          duration: duration.reason,
          reason: rejected
            ? 'previously-rejected'
            : !identity.ok
              ? identity.reason
              : duration.reason,
        };
        queryReport.candidates.push(evidence);
        merged.identityAccepted = identity.ok;
        ctx.candidates.set(candidate.videoId, merged);
        if (
          !response.error &&
          identity.ok &&
          !rejected &&
          duration.reason === 'missing-candidate' &&
          !ctx.inspected.has(candidate.videoId) &&
          ctx.inspections < SEARCH_INSPECTION_LIMIT
        ) {
          ctx.inspected.add(candidate.videoId);
          ctx.inspections++;
          inspections.push({
            key: `${contexts.indexOf(ctx)}:${candidate.videoId}`,
            url: candidate.url,
            ctx,
            candidate: merged,
            evidence,
          });
        }
      }
      ctx.song.durationCandidates = [...ctx.candidates.values()];
      const selected = ledger.choose(ctx.song, ctx.song.durationCandidates);
      if (selected) await finish(ctx, selected.url);
    }
    // Release the search pool before entering the separately paced metadata-extraction pool.
    const needed = inspections.filter(
      (item) => !item.ctx.done && !item.ctx.error,
    );
    if (needed.length && !response.error) {
      const inspected = await io.inspect(
        needed,
        Math.max(1, deadline - Date.now()),
      );
      for (const item of needed) {
        const source = inspected.evidence.get(item.key);
        if (!source) {
          item.evidence.inspection =
            inspected.error || 'Source inspection did not complete';
          item.ctx.error = item.evidence.inspection;
          continue;
        }
        Object.assign(item.candidate, {
          title: source.title || item.candidate.title,
          channel: source.channel || item.candidate.channel,
          uploader: source.uploader || item.candidate.uploader,
          artist: source.artist,
          durationSeconds: source.durationSeconds,
        });
        const identity = candidateIdentity(item.ctx.song, item.candidate);
        const duration = durationMatch(
          item.ctx.song.durationMs,
          source.durationSeconds,
        );
        item.candidate.identityAccepted = identity.ok;
        Object.assign(item.evidence, {
          inspectedDurationSeconds: source.durationSeconds,
          identity: identity.reason,
          duration: duration.reason,
          reason: identity.ok ? duration.reason : identity.reason,
        });
      }
      for (const ctx of pending.filter((c) => !c.done && !c.error)) {
        const selected = ledger.choose(ctx.song, [...ctx.candidates.values()]);
        if (selected) await finish(ctx, selected.url);
      }
    }
    // A transport failure is not search exhaustion; never hide it with another query.
    if (response.error) {
      for (const ctx of contexts.filter((c) => !c.done && !c.error))
        ctx.error = response.error;
      break;
    }
  }
  for (const ctx of contexts) {
    if (
      !ctx.done &&
      !ctx.error &&
      !ctx.nonempty &&
      !ledger.rejected(ctx.song).length
    )
      await finish(ctx, null);
    if (!ctx.done) {
      ctx.error ||= DURATION_NO_CANDIDATE;
      ctx.report.outcome =
        ctx.error === DURATION_NO_CANDIDATE ? 'no-candidate' : 'error';
    }
    ctx.song.searchDisqualified = [...ctx.candidates.values()].filter(
      (c) => !durationMatch(ctx.song.durationMs, c.durationSeconds).ok,
    ).length;
    Object.assign(ctx.report, {
      finishedAt: new Date().toISOString(),
      error: ctx.error,
      uniqueCandidates: ctx.candidates.size,
      inspections: ctx.inspections,
    });
    io.record(ctx.song, ctx.report);
  }
  return contexts
    .filter((c) => !c.done)
    .map((c) => ({ song: c.song, error: c.error }));
}
