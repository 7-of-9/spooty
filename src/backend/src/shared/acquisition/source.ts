// Retain only public recording evidence from the download already being made.
// Never retain a full yt-dlp info document: it contains signed media URLs and
// other session-bearing fields that do not belong in acquisition reports.
export const sourceResultTemplate =
  'after_move:SPOOTY_RESULT:%(.{id,filepath,title,duration,artist,track,album,channel,uploader,chapters})j';
export const sourceInspectionTemplate =
  'SPOOTY_SOURCE:%(.{id,title,duration,artist,track,album,channel,uploader,chapters,description})j';

const publicText = (value, limit = 500) =>
  typeof value === 'string' && value.trim()
    ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, limit)
    : null;

export function sourceEvidenceFromLine(line) {
  const prefix = line.trim().startsWith('SPOOTY_SOURCE:')
    ? 'SPOOTY_SOURCE:'
    : 'SPOOTY_RESULT:';
  if (!line.trim().startsWith(prefix)) return null;
  try {
    const raw = JSON.parse(line.trim().slice(prefix.length));
    if (!/^[A-Za-z0-9_-]{11}$/.test(raw?.id)) return null;
    const duration = Number(raw.duration);
    const result = {
      videoId: raw.id,
      title: publicText(raw.title),
      durationSeconds:
        Number.isFinite(duration) && duration > 0 ? duration : null,
      artist: publicText(raw.artist),
      track: publicText(raw.track),
      album: publicText(raw.album),
      channel: publicText(raw.channel),
      uploader: publicText(raw.uploader),
      description: publicText(raw.description, 8000),
      chapters: [],
    };
    for (const chapter of (Array.isArray(raw.chapters)
      ? raw.chapters
      : []
    ).slice(0, 200)) {
      const start = chapter?.start_time;
      const end = chapter?.end_time;
      if (
        typeof start !== 'number' ||
        typeof end !== 'number' ||
        !Number.isFinite(start) ||
        !Number.isFinite(end) ||
        start < 0 ||
        end <= start ||
        (result.durationSeconds !== null && end > result.durationSeconds + 1)
      )
        continue;
      result.chapters.push({
        title: publicText(chapter.title),
        startSeconds: start,
        endSeconds: end,
      });
    }
    return result;
  } catch {
    return null;
  }
}

export function withSourceEvidence(args) {
  return args.map((arg) =>
    arg.startsWith('after_move:SPOOTY_RESULT:') ? sourceResultTemplate : arg,
  );
}

export function candidateResultsFromLine(line) {
  try {
    const raw = JSON.parse(line);
    const match = /^ytsearch([1-9]|[1-4][0-9]|50):(.+)$/.exec(
      raw.original_url || '',
    );
    if (!match || !Array.isArray(raw.entries)) return null;
    return {
      query: match[2],
      candidates: raw.entries
        .slice(0, Number(match[1]))
        .map((entry) =>
          sourceEvidenceFromLine('SPOOTY_SOURCE:' + JSON.stringify(entry)),
        )
        .filter(Boolean),
    };
  } catch {
    return null;
  }
}
