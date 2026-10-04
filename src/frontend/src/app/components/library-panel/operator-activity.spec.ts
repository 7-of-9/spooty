import { operatorActivity } from './operator-activity';
import { YoutubePaceSnapshot } from '../../services/library.service';

describe('single operator activity policy', () => {
  const queues = () => ({
    search: { paused: false, active: 0, queued: 0 },
    download: { paused: false, active: 0, queued: 0 },
  });
  const base = () => ({
    pace: {
      searchActive: 0,
      downloadActive: 0,
      coolRemainingMs: 0,
      webQueues: queues(),
      acquisitionOwner: { state: 'available' },
      webActivity: {
        active: [],
        recent: [],
        totals: { downloaded: 0, reused: 0, checked: 0 },
        since: 1,
        nextRetryAt: null,
      },
    } as unknown as YoutubePaceSnapshot,
    tracks: [],
    syncing: '',
    enqueueing: false,
    resuming: false,
    loading: false,
    known: true,
  });
  it('says nothing is running when both real queues are idle', () => {
    expect(operatorActivity(base()).title).toBe('No downloads running');
    expect(operatorActivity(base()).busy).toBeFalse();
  });
  it('does not infer a process from stale track rows', () => {
    const input = base();
    expect(
      operatorActivity({
        ...input,
        tracks: [{ name: 'Old', artist: 'Artist', percent: 88, status: 3 }],
      }).busy,
    ).toBeFalse();
  });
  it('shows a scheduled wake-up without implying a running download', () => {
    const input = base();
    input.pace.webQueues!.search.queued = 5;
    input.pace.webActivity!.nextRetryAt = Date.now() + 60000;
    const result = operatorActivity(input);
    expect(result.title).toBe('Waiting for the next attempt');
    expect(result.progressText).toContain('Next:');
    expect(result.busy).toBeFalse();
    expect(result.percent).toBeNull();
  });
  it('shows a queue pause rather than a scheduled countdown', () => {
    const input = base();
    input.pace.webQueues!.search.paused = true;
    expect(operatorActivity(input).title).toBe('Downloads paused');
  });
  it('does not conceal a real configuration blocker behind automatic wait copy', () => {
    const input = base();
    input.pace.configurationError = 'Invalid setting';
    const result = operatorActivity(input);
    expect(result.tone).toBe('warning');
    expect(result.detail).toBe('Invalid setting');
    expect(result.busy).toBeFalse();
  });
  it('reports unavailable queue telemetry honestly', () => {
    const input = base();
    input.pace.webQueues = null;
    expect(operatorActivity(input).title).toBe('Connecting to the work queue');
  });
  it('shows Spotify activity even with no YouTube process', () => {
    const result = operatorActivity({
      ...base(),
      syncing: 'LTJ Bukem’s EARTH Series',
    });
    expect(result.title).toBe('Updating from Spotify');
    expect(result.detail).toContain('EARTH');
    expect(result.percent).toBeNull();
  });
  for (const [phase, title] of Object.entries({
    metadata: 'Reading Spotify track details',
    verifying: 'Checking audio length',
    copying: 'Adding an existing MP3',
    searching: 'Searching YouTube',
    downloading: 'Downloading audio',
    preparing: 'Checking existing MP3s',
    'waiting-search': 'Waiting for a YouTube search slot',
  })) {
    it(`names the real ${phase} stage and track`, () => {
      const input = base();
      input.pace.webActivity!.active = [
        { id: 1, artist: 'Artist', name: 'Track', phase, startedAt: 1 },
      ];
      const result = operatorActivity(input);
      expect(result.title).toBe(title);
      expect(result.detail).toBe('Artist — Track');
      expect(result.busy).toBe(!phase.startsWith('waiting-'));
      expect(result.percent).toBeNull();
    });
  }
  it('prioritizes an actual download over other preparation jobs and clamps percent', () => {
    const input = base();
    input.pace.webActivity!.active = [
      {
        id: 1,
        artist: 'A',
        name: 'Preparation',
        phase: 'metadata',
        startedAt: 1,
      },
      {
        id: 2,
        artist: 'B',
        name: 'Audio',
        phase: 'downloading',
        startedAt: 1,
        percent: 150,
      },
    ];
    expect(operatorActivity(input).detail).toBe('B — Audio');
    expect(operatorActivity(input).percent).toBe(100);
  });
  it('does not present a duplicate playlist lock as the current search', () => {
    const input = base();
    input.pace.webActivity!.active = [
      {
        id: 1,
        artist: 'A',
        name: 'Other copy',
        phase: 'waiting-shared',
        startedAt: 0,
      },
      { id: 2, artist: 'B', name: 'Source', phase: 'metadata', startedAt: 1 },
    ];
    expect(operatorActivity(input).detail).toBe('B — Source');
  });
  it('shows active work draining through a pause before saying paused', () => {
    const input = base();
    input.pace.webQueues!.search.paused = true;
    input.pace.webActivity!.active = [
      { id: 1, artist: 'A', name: 'B', phase: 'searching', startedAt: 1 },
    ];
    expect(operatorActivity(input).title).toBe('Searching YouTube');
  });
  it('shows cooldown as a wait, without a fabricated percentage', () => {
    const input = base();
    input.pace.coolRemainingMs = 120000;
    const result = operatorActivity(input);
    expect(result.title).toContain('cooldown');
    expect(result.progressText).toContain('2 min');
    expect(result.percent).toBeNull();
    expect(result.busy).toBeFalse();
  });
  it('reports the resume action immediately', () => {
    expect(operatorActivity({ ...base(), resuming: true }).title).toBe(
      'Resuming downloads',
    );
  });
});
