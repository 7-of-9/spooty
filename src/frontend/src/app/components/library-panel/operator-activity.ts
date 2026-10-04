import { YoutubePaceSnapshot } from '../../services/library.service';

export interface OperatorActivity {
  title: string;
  detail: string;
  tone: 'working' | 'waiting' | 'idle' | 'warning';
  busy: boolean;
  percent: number | null;
  progressText: string;
}

/** Single priority policy for the operator's attention. No optimistic running
 * state: Bull work before yt-dlp is preparation, not a YouTube search. */
export function operatorActivity(input: {
  pace: YoutubePaceSnapshot | null;
  tracks: Array<{
    artist: string;
    name: string;
    percent: number;
    status: number;
  }>;
  syncing: string;
  enqueueing: boolean;
  resuming: boolean;
  loading: boolean;
  known: boolean;
}): OperatorActivity {
  const { pace, tracks } = input;
  const state = (
    title: string,
    detail: string,
    tone: OperatorActivity['tone'],
    busy = false,
    percent: number | null = null,
    progressText = '',
  ) => ({ title, detail, tone, busy, percent, progressText });
  const admission = pace?.webAdmission;
  if (admission?.running) {
    const title = admission.phase === 'verifying' ? 'Checking an existing MP3'
      : admission.phase === 'copying' ? 'Adding an existing MP3'
      : 'Preparing playlist downloads';
    const detail = admission.name ? `${admission.artist} — ${admission.name}`
      : admission.playlist || 'Checking saved files before adding queue jobs.';
    const total = admission.total;
    return state(title, detail, 'working', true,
      total && total > 0 ? Math.min(100, admission.done * 100 / total) : null,
      total != null ? `${admission.done}/${total} playlist tracks checked` : 'Counting playlist tracks…');
  }
  if (input.resuming)
    return state(
      'Resuming downloads',
      'Opening the saved work queue…',
      'working',
      true,
    );
  if (input.enqueueing)
    return state(
      'Adding tracks to the queue',
      'Existing files and queued tracks will be skipped.',
      'working',
      true,
    );
  if (!pace || pace.acquisitionOwner?.state === 'unknown')
    return state(
      'Connecting to Spooty',
      'Checking the workers. Saved tracks remain playable.',
      'waiting',
    );
  const cli = pace.acquisition;
  if (cli)
    return state(
      cli.phase === 'draining'
        ? 'CLI is finishing active work'
        : cli.held
          ? 'CLI is waiting'
          : 'CLI is downloading',
      `${cli.verifiedNewMp3.toLocaleString()} new MP3s saved · ${cli.remainingUnique.toLocaleString()} songs remaining`,
      cli.held ? 'waiting' : 'working',
      !cli.held,
    );
  if (pace.acquisitionOwner?.state === 'owned')
    return state(
      'CLI is managing downloads',
      'Web downloads will wait until the CLI finishes.',
      'waiting',
    );
  if (pace.configurationError)
    return state(
      'Downloads need a settings fix',
      pace.configurationError,
      'warning',
    );
  if (pace.webQueues === null)
    return state(
      'Connecting to the work queue',
      'Worker status is unavailable. Saved tracks remain playable.',
      'waiting',
    );
  const activity = pace.webActivity;
  const current =
    activity?.active.find((t) => t.phase === 'downloading') ||
    activity?.active.find((t) => t.phase === 'searching') ||
    activity?.active.find((t) => t.phase !== 'waiting-shared') ||
    activity?.active[0];
  const queued =
    (pace.webQueues?.search.queued || 0) +
    (pace.webQueues?.download.queued || 0);
  const workerCount =
    (pace.webQueues?.search.active || 0) +
    (pace.webQueues?.download.active || 0);
  const preparing =
    current && !['searching', 'downloading'].includes(current.phase);
  if (current && preparing) {
    const waiting = current.phase.startsWith('waiting-');
    const labels: Record<string, string> = {
      preparing: 'Checking existing MP3s',
      metadata: 'Reading Spotify track details',
      verifying: 'Checking audio length',
      copying: 'Adding an existing MP3',
      'waiting-search': 'Waiting for a YouTube search slot',
      'waiting-download': 'Waiting for a download slot',
      'waiting-shared': 'Waiting for another copy of this track',
    };
    return state(
      labels[current.phase] || 'Preparing a track',
      `${current.artist} — ${current.name}`,
      waiting ? 'waiting' : 'working',
      !waiting,
      null,
      workerCount > 1 ? `${workerCount} queue jobs admitted` : '',
    );
  }
  const legacyTracks = !pace.webActivity && !pace.webQueues;
  if (
    pace.downloadActive ||
    pace.searchActive ||
    current ||
    (legacyTracks && tracks.length)
  ) {
    const down =
      current?.phase === 'downloading' ||
      (!current &&
        (pace.downloadActive > 0 ||
          (legacyTracks && tracks.some((t) => t.status === 3))));
    const track = current || tracks.find((t) => t.status === (down ? 3 : 1));
    const name = track
      ? `${track.artist} — ${track.name}`
      : 'Getting the current track name…';
    const percent =
      down && track && typeof track.percent === 'number' && track.percent > 0
        ? Math.min(100, track.percent)
        : null;
    return state(
      down ? 'Downloading audio' : 'Searching YouTube',
      name,
      'working',
      true,
      percent,
      `${percent == null ? '' : Math.round(percent) + '% · '}${legacyTracks ? tracks.filter((t) => t.status === 3).length : pace.downloadActive} downloading · ${legacyTracks ? tracks.filter((t) => t.status === 1).length : pace.searchActive} searching`,
    );
  }
  if (workerCount)
    return state(
      'Checking queued tracks',
      'Reusing saved MP3s and checking Spotify details before searching YouTube.',
      'working',
      true,
      null,
      `${workerCount} workers active · ${queued.toLocaleString()} queue entries left`,
    );
  if (pace.coolRemainingMs > 0)
    return state(
      'Waiting for YouTube cooldown',
      'Downloads will continue automatically. No action needed.',
      'waiting',
      false,
      null,
      `About ${Math.ceil(pace.coolRemainingMs / 60000)} min remaining`,
    );
  if (pace.webQueues?.search.paused || pace.webQueues?.download.paused)
    return state(
      'Downloads paused',
      'Your queue is preserved. Resume when you want it to continue.',
      'waiting',
    );
  if (input.syncing)
    return state('Updating from Spotify', input.syncing, 'working', true);
  if (queued) {
    if (activity?.nextRetryAt)
      return state(
        'Waiting for the next attempt',
        'Scheduled work will continue automatically. No action needed.',
        'waiting',
        false,
        null,
        `Next: ${new Date(activity.nextRetryAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`,
      );
    return state(
      'Waiting for a worker',
      'Work is queued; no search or download is running yet.',
      'waiting',
    );
  }
  if (input.loading || !input.known)
    return state(
      'Loading your saved library',
      'No downloads are being started.',
      'working',
      true,
    );
  return state(
    'No downloads running',
    'Saved tracks are ready to play. Choose a playlist to add more.',
    'idle',
  );
}
