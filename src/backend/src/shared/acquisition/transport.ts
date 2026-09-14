import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdtempSync,
  rmSync,
  mkdirSync,
  statSync,
  readFileSync,
  copyFileSync,
  chmodSync,
} from 'node:fs';
import { join } from 'node:path';
import {
  candidateResultsFromLine,
  sourceEvidenceFromLine,
  sourceInspectionTemplate,
  withSourceEvidence,
} from './source';
import {
  assertClientCompatibility,
  youtubePlayerClient,
} from './client-policy';
import {
  assertDuration,
  durationMatch,
  DURATION_REJECTED,
  DURATION_NO_CANDIDATE,
  DURATION_SOURCE_MISSING,
  youtubeDurationFilterArgs,
  youtubeDurationEvidenceArgs,
  parseYoutubeDurationEvidence,
} from './duration-policy';

import { YoutubePace, isYoutubeRateLimit } from '../youtube-pace';
import {
  buildYoutubeSearchBatchArgs,
  parseYoutubeSearchBatch,
  youtubeSearchQuery,
} from '../youtube-search-batch';
import {
  buildYoutubeDownloadBatchArgs,
  parseYoutubeDownloadBatchResults,
  parseYoutubeDownloadProgressLine,
  verifiedYoutubeBatchFile,
  youtubeVideoId,
} from '../youtube-download-batch';

export function classify(raw) {
  const text = String(raw || '');
  // Adapters may receive an already-sanitized transport result. Classification
  // is idempotent so a network outcome cannot become an operational failure.
  if (
    [
      'Local network unavailable',
      'YouTube operation timed out',
      'YouTube rate limit or bot check',
      'YouTube age verification requires cookies',
      'Output failed MP3 codec/duration verification',
      'MP3 tags could not be written',
      'Local disk is full',
      'Local database temporarily busy',
      'Requested audio format unavailable',
      'Media URL rejected (403)',
      'Selected YouTube video unavailable',
      'Recovery cookies file unavailable',
      'YouTube attempt did not produce a verified result',
    ].includes(text)
  )
    return text;
  if (
    /^Acquisition configuration requires (FORMAT=mp3 and QUALITY=0|batch size8; remove legacy web batch overrides)$/.test(
      text,
    )
  )
    return text;
  if (text === DURATION_REJECTED || text === DURATION_NO_CANDIDATE) return text;
  if (/Spotify source duration/.test(text)) return DURATION_SOURCE_MISSING;
  if (
    /CLI stopping|YouTube admission cancelled|CLI admission cancelled/i.test(
      text,
    )
  )
    return 'CLI admission cancelled';
  if (isYoutubeRateLimit(text)) return 'YouTube rate limit or bot check';
  if (
    /no route to host|network is unreachable|nodename nor servname|errno (?:51|65)/i.test(
      text,
    )
  )
    return 'Local network unavailable';
  if (/timed out|timeout/i.test(text)) return 'YouTube operation timed out';
  if (/sign in.*age|age.restricted|confirm your age|use --cookies/i.test(text))
    return 'YouTube age verification requires cookies';
  if (/MP3 codec\/duration verification|ffprobe unavailable/i.test(text))
    return 'Output failed MP3 codec/duration verification';
  if (/MP3 tags could not be written/i.test(text))
    return 'MP3 tags could not be written';
  if (/ENOSPC|SQLITE_FULL|no space left/i.test(text))
    return 'Local disk is full';
  if (/SQLITE_BUSY|database is locked/i.test(text))
    return 'Local database temporarily busy';
  if (/requested format is not available/i.test(text))
    return 'Requested audio format unavailable';
  if (/403|forbidden/i.test(text)) return 'Media URL rejected (403)';
  if (
    /private video|video unavailable|removed|not available in your country/i.test(
      text,
    )
  )
    return 'Selected YouTube video unavailable';
  if (/cookies file/i.test(text)) return 'Recovery cookies file unavailable';
  return 'YouTube attempt did not produce a verified result';
}

export function recoveryCookiesAvailable(path) {
  // Metadata check only: do not inspect or log cookie/session contents.
  try {
    const info = statSync(path);
    return info.isFile() && info.size > 0;
  } catch {
    return false;
  }
}

export function isolateCookieFile(args, temporaryRoot) {
  const index = args.indexOf('--cookies');
  if (index < 0) return { args, cleanup: () => {} };
  if (!recoveryCookiesAvailable(args[index + 1]))
    throw new Error('Recovery cookies file unavailable');
  mkdirSync(temporaryRoot, { recursive: true });
  const directory = mkdtempSync(join(temporaryRoot, 'cookies-'));
  const cleanup = () => rmSync(directory, { recursive: true, force: true });
  try {
    const file = join(directory, 'cookies.txt');
    copyFileSync(args[index + 1], file);
    chmodSync(file, 0o600);
    const isolated = [...args];
    isolated[index + 1] = file;
    return { args: isolated, cleanup };
  } catch (error) {
    cleanup();
    throw error;
  }
}

export function canLaunchYoutubeWork(pace, active, kind) {
  const floor =
    pace.maxPerWindow <= 8 && pace.downloadConc <= 1 && pace.searchConc <= 1;
  return (
    active[kind] < (kind === 'search' ? pace.searchConc : pace.downloadConc) &&
    (!floor || active.search + active.download === 0)
  );
}

export type TransportHooks = {
  pace?: YoutubePace;
  beforeProcess?: () => Promise<void>;
  onProgress?: (id: string, percentage: number) => void;
};

export class Transport {
  paths: {
    root: string;
    temp: string;
    cookies: string;
    pace?: string;
    paceEvents?: string;
  };
  opts: Record<string, any>;
  emit: (event: string, details: any) => void;
  hooks: TransportHooks;
  spawn: typeof spawn;
  children: Map<number, ReturnType<typeof spawn>>;
  sleepers: Set<{ cancel: () => void }>;
  blocked: boolean;
  stopping: boolean;
  pace: YoutubePace;
  bin: string;
  runtime: string;
  potProvider?: { pluginDir: string; baseUrl: string };
  constructor(paths, opts, emit, hooks: TransportHooks = {}) {
    this.paths = paths;
    this.opts = opts;
    this.emit = emit;
    this.hooks = hooks;
    this.spawn = spawn;
    this.children = new Map<any, any>();
    this.sleepers = new Set<any>();
    this.blocked = false;
    this.stopping = false;
    this.pace =
      hooks.pace ||
      new YoutubePace({
        statePath: paths.pace,
        eventsPath: paths.paceEvents,
        autoStep: false,
        sleep: (ms) =>
          new Promise<any>((yes, no) => {
            const entry = {
              cancel: () => {
                clearTimeout(timer);
                this.sleepers.delete(entry);
                no(new Error('YouTube admission cancelled'));
              },
            };
            const timer = setTimeout(() => {
              this.sleepers.delete(entry);
              yes(undefined);
            }, ms);
            this.sleepers.add(entry);
          }),
      });
    this.bin = join(paths.root, 'node_modules/ytdlp-nodejs/bin/yt-dlp_macos');
    this.runtime =
      process.env.YT_JS_RUNTIME_PATH ||
      '/Users/dom/.nvm/versions/node/v22.13.0/bin/node';
    if (!existsSync(this.bin) || !existsSync(this.runtime))
      throw new Error('Required yt-dlp or JavaScript runtime is missing');
    assertClientCompatibility(this.bin);
    assertClientCompatibility(
      this.bin,
      youtubePlayerClient(true, !!opts['pot-recovery']),
    );
    if (opts['pot-recovery']) {
      const pluginDir = join(paths.root, 'data/yt-dlp-plugins');
      const digest = createHash('sha256')
        .update(readFileSync(join(pluginDir, 'bgutil-ytdlp-pot-provider.zip')))
        .digest('hex');
      if (
        digest !==
        'bce874dfa25896c2798e0f4f8147b7b22e785479eb1e459ab232bf2506c95016'
      )
        throw new Error(
          'POT recovery plugin does not match the reviewed release',
        );
      this.potProvider = { pluginDir, baseUrl: 'http://127.0.0.1:4416' };
    }
  }
  killChildren() {
    for (const sleeper of this.sleepers) sleeper.cancel();
    for (const child of this.children.values()) {
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch {
        try {
          child.kill('SIGKILL');
        } catch {}
      }
    }
  }
  stopAdmissions() {
    this.stopping = true;
    // Cancel gate waiters without terminating already-running yt-dlp work.
    for (const sleeper of this.sleepers) sleeper.cancel();
  }
  trip(kind) {
    if (!this.blocked) {
      this.blocked = true;
      this.pace.tripRateLimit(
        'CLI observed YouTube rate limit or bot check',
        undefined,
        kind === 'search' ? 'searchConc' : 'downloadConc',
      );
      this.emit('block', { kind, pace: this.pace.snapshot() });
    }
    this.killChildren();
  }
  cookiesFirst() {
    if (this.opts?.authenticated) return true;
    const last = this.pace.snapshot().lastBotAt;
    return last && Date.now() - last < 3600000;
  }
  recoveryCookiesAvailable() {
    return recoveryCookiesAvailable(this.paths.cookies);
  }
  recoveryWaitMs(now = Date.now()) {
    if (this.recoveryCookiesAvailable()) return 0;
    if (this.opts?.authenticated) return 60000;
    const last = this.pace.snapshot().lastBotAt;
    return last ? Math.max(0, last + 3600000 - now) : 0;
  }
  async process(
    args,
    kind,
    timeout,
    onLine: (line: string) => void = () => {},
  ) {
    await this.hooks?.beforeProcess?.();
    if (this.stopping) throw new Error('CLI stopping');
    if (this.pace.snapshot().coolRemainingMs > 0)
      throw new Error('YouTube cooldown');
    this.blocked = false;
    // Surface only allowlisted diagnostics; never raw stderr, cookies or URLs.
    args = args.filter((arg) => arg !== '--no-warnings');
    // yt-dlp rewrites its cookie jar on exit. Give each process a private copy
    // so concurrent exits or a killed writer cannot truncate the master export.
    const cookieFile = isolateCookieFile(args, this.paths?.temp);
    args = cookieFile.args;
    const requestedPlayerClient =
      args
        .map((arg) => /youtube:player_client=([a-z_]+)/.exec(arg)?.[1])
        .find(Boolean) || null;
    const useCookies = args.includes('--cookies');
    const diagnostics = new Set<any>();
    this.emit('process_start', {
      kind,
      requestedPlayerClient,
      useCookies,
      potRecovery: args.includes('--plugin-dirs'),
    });
    const started = Date.now();
    return new Promise<any>((yes, no) => {
      let child: ReturnType<typeof spawn>;
      try {
        child = this.spawn(this.bin, ['--ignore-config', ...args], {
          detached: true,
          stdio: ['ignore', 'pipe', 'pipe'],
          env: {
            ...process.env,
            PATH: `/opt/homebrew/bin:${process.env.PATH || ''}`,
          },
        });
      } catch {
        cookieFile.cleanup();
        no(new Error('Unable to start yt-dlp'));
        return;
      }
      this.children.set(child.pid, child);
      let out = '',
        err = '',
        tail = '',
        firstOutput = null,
        timedOut = false;
      let progressTail = '';
      const consume = (chunk, source) => {
        firstOutput ??= Date.now();
        const value = String(chunk);
        if (source === 'out') {
          out = (out + value).slice(-8 * 1024 * 1024);
          tail += value;
          const lines = tail.split('\n');
          tail = lines.pop();
          for (const line of lines) onLine(line);
        } else err = (err + value).slice(-128 * 1024);
        if (source === 'err') {
          progressTail += value;
          const progressLines = progressTail.split(/\r?\n/);
          progressTail = progressLines.pop();
          for (const line of progressLines) {
            const progress = parseYoutubeDownloadProgressLine(line);
            if (progress)
              this.hooks?.onProgress?.(progress.id, progress.percentage);
          }
          for (const [name, pattern] of [
            ['unsupported-client', /Skipping unsupported client/i],
            ['client-cannot-use-cookies', /does not support cookies/i],
            [
              'javascript-challenge-failed',
              /challenge solving failed|No supported JavaScript runtime/i,
            ],
            ['missing-pot', /require.*PO Token|PO Token.*not provided/i],
          ] as Array<[string, RegExp]>)
            if (pattern.test(err)) diagnostics.add(name);
        }
        // yt-dlp diagnostics are on stderr; stdout is our structured result
        // channel. A duration of 429 seconds, a title containing "not a bot",
        // or metadata split across chunks is data, not an HTTP failure.
        if (
          source === 'err' &&
          (isYoutubeRateLimit(value) || isYoutubeRateLimit(err))
        ) {
          const firstSignal = !this.blocked;
          this.trip(kind);
          if (firstSignal)
            this.emit('block_signal', {
              kind,
              source: 'stderr',
              requestedPlayerClient,
              category: 'YouTube rate limit or bot check',
            });
        }
      };
      child.stdout.on('data', (c) => consume(c, 'out'));
      child.stderr.on('data', (c) => consume(c, 'err'));
      const timer = setTimeout(() => {
        timedOut = true;
        try {
          process.kill(-child.pid, 'SIGKILL');
        } catch {}
      }, timeout);
      child.once('error', () => {
        clearTimeout(timer);
        this.children.delete(child.pid);
        cookieFile.cleanup();
        no(new Error('Unable to start yt-dlp'));
      });
      child.once('close', (code) => {
        clearTimeout(timer);
        this.children.delete(child.pid);
        cookieFile.cleanup();
        if (tail) onLine(tail);
        this.emit('process', {
          kind,
          seconds: (Date.now() - started) / 1000,
          firstOutputSeconds: firstOutput
            ? (firstOutput - started) / 1000
            : null,
          code,
          timedOut,
          requestedPlayerClient,
          useCookies,
          diagnostics: [...diagnostics],
        });
        yes({
          out,
          error: timedOut ? 'YouTube operation timed out' : classify(err),
          code,
        });
      });
    });
  }
  async search(
    songs,
    onResult,
    durationCandidates,
    onAdmitted: (songs: any[]) => any = () => {},
    maxSearches?: number,
  ) {
    const candidateLimit = durationCandidates
      ? Number(maxSearches ?? this.opts?.['max-searches'] ?? 10)
      : 1;
    const cookies = this.cookiesFirst();
    if (cookies && !recoveryCookiesAvailable(this.paths.cookies))
      throw new Error('Recovery cookies file unavailable');
    const queries = songs.map((s) => youtubeSearchQuery(s.artist, s.name));
    const byQuery = new Map<any, any>();
    songs.forEach((s, i) =>
      byQuery.set(queries[i], [...(byQuery.get(queries[i]) || []), s]),
    );
    const completed = new Set<any>(),
      tasks = [];
    let result;
    const selectionErrors = new Map<any, any>();
    await this.pace.run(
      'search',
      async () => {
        await onAdmitted(songs);
        result = await this.process(
          buildYoutubeSearchBatchArgs({
            queries: [...byQuery.keys()],
            cookiesPath: this.paths.cookies,
            useCookies: !!cookies,
            client: youtubePlayerClient(!!cookies),
            candidateLimit,
          }),
          'search',
          Math.min(840000, songs.length * 90000),
          (line) => {
            for (const doc of parseYoutubeSearchBatch(line).documents) {
              for (const s of byQuery.get(doc.query) || []) {
                if (completed.has(s.key)) continue;
                completed.add(s.key);
                tasks.push(
                  Promise.resolve()
                    .then(() => {
                      if (!durationCandidates) return onResult(s, doc.url);
                      s.durationCandidates = doc.candidates;
                      s.searchLimit = candidateLimit;
                      s.searchDisqualified = doc.candidates.filter(
                        (item) =>
                          !durationMatch(s.durationMs, item.durationSeconds).ok,
                      ).length;
                      const candidate = durationCandidates.choose(
                        s,
                        doc.candidates,
                      );
                      this.emit?.('candidate_selection', {
                        key: s.key,
                        maxSearches: candidateLimit,
                        resultsExamined: doc.candidates.length,
                        disqualifiedByDuration: s.searchDisqualified,
                        selectedRank: candidate
                          ? doc.candidates.indexOf(candidate) + 1
                          : null,
                        selectedUrl: candidate?.url || null,
                      });
                      if (
                        !candidate &&
                        doc.emptyResults &&
                        !durationCandidates.rejected(s).length
                      )
                        return onResult(s, null);
                      if (!candidate) throw new Error(DURATION_NO_CANDIDATE);
                      return onResult(s, candidate.url);
                    })
                    .catch((e) => {
                      selectionErrors.set(s.key, classify(e.message));
                      return { error: e, song: s };
                    }),
                );
              }
            }
          },
        );
        const outcomes = await Promise.all(tasks);
        for (const outcome of outcomes)
          if (outcome?.error) {
            completed.delete(outcome.song.key);
          }
      },
      () => completed.size,
    );
    return songs
      .filter((s) => !completed.has(s.key))
      .map((song) => ({
        song,
        error:
          selectionErrors.get(song.key) ||
          result?.error ||
          'Search did not complete',
      }));
  }
  async inspectSources(
    songs,
    onResult,
    onAdmitted: (songs: any[]) => void = () => {},
  ) {
    // Source review is owned YouTube extraction work, not an unmetered probe.
    // Charge one download admission per unique video and use the same process
    // pool, cooldown and immediate first-block termination as real downloads.
    const byId = new Map<any, any>();
    for (const song of songs) {
      const id = youtubeVideoId(song.url);
      if (!id) throw new Error('Invalid saved YouTube URL');
      byId.set(id, [...(byId.get(id) || []), song]);
    }
    const cookies = this.cookiesFirst();
    if (cookies && !this.recoveryCookiesAvailable())
      return songs.map((song) => ({
        song,
        error: 'Recovery cookies file unavailable',
      }));
    const completed = new Set<any>();
    const tasks = [];
    let result;
    await this.pace.run(
      'download',
      async () => {
        await onAdmitted(songs);
        result = await this.process(
          [
            '--js-runtimes',
            `node:${this.runtime}`,
            '--extractor-args',
            `youtube:player_client=${youtubePlayerClient(!!cookies)}`,
            '--skip-download',
            '--print',
            sourceInspectionTemplate,
            '--no-abort-on-error',
            '--no-playlist',
            '--no-warnings',
            '--socket-timeout',
            '20',
            ...(cookies ? ['--cookies', this.paths.cookies] : []),
            '--',
            ...[...byId.values()].map((group) => group[0].url),
          ],
          'download',
          Math.min(840000, songs.length * 90000),
          (line) => {
            const evidence = sourceEvidenceFromLine(line);
            if (!evidence || !byId.has(evidence.videoId)) return;
            for (const song of byId.get(evidence.videoId)) {
              if (completed.has(song.key)) continue;
              completed.add(song.key);
              tasks.push(
                Promise.resolve()
                  .then(() => onResult(song, evidence))
                  .catch(() => {
                    completed.delete(song.key);
                  }),
              );
            }
          },
        );
        await Promise.all(tasks);
      },
      () => 0,
      byId.size,
    ); // Evidence extraction is never an MP3 success.
    return songs
      .filter((song) => !completed.has(song.key))
      .map((song) => ({
        song,
        error: result?.error || 'Source inspection did not complete',
      }));
  }
  async searchCandidates(songs, onResult) {
    const cookies = this.cookiesFirst();
    if (cookies && !this.recoveryCookiesAvailable())
      return songs.map((song) => ({
        song,
        error: 'Recovery cookies file unavailable',
      }));
    const queries = new Map<any, any>();
    for (const song of songs) {
      const query =
        song.reviewQuery || youtubeSearchQuery(song.artist, song.name);
      queries.set(query, [...(queries.get(query) || []), song]);
    }
    const completed = new Set<any>(),
      tasks = [];
    let result;
    await this.pace.run(
      'search',
      async () => {
        const args = buildYoutubeSearchBatchArgs({
          queries: [...queries.keys()],
          cookiesPath: this.paths.cookies,
          useCookies: !!cookies,
          client: youtubePlayerClient(!!cookies),
          candidateLimit: Number(this.opts?.['max-searches'] ?? 10),
        });
        result = await this.process(
          args,
          'search',
          Math.min(840000, songs.length * 90000),
          (line) => {
            const result = candidateResultsFromLine(line);
            if (!result || !queries.has(result.query)) return;
            for (const song of queries.get(result.query)) {
              if (completed.has(song.key)) continue;
              completed.add(song.key);
              tasks.push(
                Promise.resolve()
                  .then(() => onResult(song, result.candidates))
                  .catch(() => {
                    completed.delete(song.key);
                  }),
              );
            }
          },
        );
        await Promise.all(tasks);
      },
      () => 0,
    );
    return songs
      .filter((song) => !completed.has(song.key))
      .map((song) => ({
        song,
        error: result?.error || 'Candidate search did not complete',
      }));
  }
  async download(
    songs,
    onResult,
    onAdmitted: (songs: any[]) => void = () => {},
    durationGuard = false,
  ) {
    // A track-specific authenticated retry must not pull fresh anonymous
    // work into its cookie-bearing invocation. Global bot recovery is already
    // handled separately by cookiesFirst().
    const anonymous = songs.filter((s) => !s.cookiesNext);
    const authenticated = songs.filter((s) => s.cookiesNext);
    if (anonymous.length && authenticated.length) {
      return [
        ...(await this.download(
          anonymous,
          onResult,
          onAdmitted,
          durationGuard,
        )),
        ...(await this.download(
          authenticated,
          onResult,
          onAdmitted,
          durationGuard,
        )),
      ];
    }
    const cookies = this.cookiesFirst() || songs.some((s) => s.cookiesNext);
    if (cookies && !recoveryCookiesAvailable(this.paths.cookies))
      return songs.map((song) => ({
        song,
        error: 'Recovery cookies file unavailable',
      }));
    if (cookies && this.potProvider) {
      const response = await fetch(`${this.potProvider.baseUrl}/ping`, {
        signal: AbortSignal.timeout(3000),
      });
      if (!response.ok || (await response.json()).version !== '2.0.0')
        throw new Error('POT recovery provider is unavailable or incompatible');
    }
    const byId = new Map<any, any>();
    if (durationGuard)
      for (const song of songs)
        assertDuration(song.durationMs, song.durationMs / 1000);
    for (const s of songs) {
      const id = youtubeVideoId(s.url);
      if (!id) throw new Error('Invalid saved YouTube URL');
      byId.set(id, [...(byId.get(id) || []), s]);
    }
    const completed = new Set<any>(),
      seen = new Set<any>(),
      tasks = [];
    const publicationErrors = new Map<any, any>();
    const extractedDurations = new Map<any, any>();
    mkdirSync(this.paths.temp, { recursive: true });
    const temp = mkdtempSync(join(this.paths.temp, 'batch-'));
    let result;
    try {
      await this.pace.run(
        'download',
        async () => {
          await onAdmitted(songs);
          const args = buildYoutubeDownloadBatchArgs({
            urls: [...byId.values()].map((group) => group[0].url),
            outputDirectory: temp,
            audioFormat: 'mp3',
            quality: '0',
            ffmpegPath: '/opt/homebrew/bin/ffmpeg',
            jsRuntime: `node:${this.runtime}`,
            cookiesPath: this.paths.cookies,
            attempt: {
              label: `${cookies ? 'cookies+' : ''}${youtubePlayerClient(!!cookies, !!this.potProvider)}`,
              useCookies: !!cookies,
              client: youtubePlayerClient(!!cookies, !!this.potProvider),
              ...(cookies && this.potProvider
                ? { potProvider: this.potProvider }
                : {}),
              format: 'ba/bestaudio/18/best',
            },
          });
          if (durationGuard) {
            const filters = youtubeDurationFilterArgs(
              songs.map((s) => ({
                videoId: youtubeVideoId(s.url),
                expectedMs: s.durationMs,
              })),
            );
            args.splice(
              args.indexOf('--'),
              0,
              ...youtubeDurationEvidenceArgs(),
              ...filters,
            );
          }
          result = await this.process(
            withSourceEvidence(args),
            'download',
            Math.min(840000, songs.length * 90000),
            (line) => {
              if (durationGuard)
                for (const candidate of parseYoutubeDurationEvidence(line)) {
                  if (byId.has(candidate.videoId))
                    extractedDurations.set(
                      candidate.videoId,
                      candidate.durationSeconds,
                    );
                }
              const evidence = sourceEvidenceFromLine(line);
              for (const item of parseYoutubeDownloadBatchResults(line)
                .results) {
                if (seen.has(item.id) || !byId.has(item.id)) continue;
                const source = verifiedYoutubeBatchFile(
                  temp,
                  item.id,
                  'mp3',
                  item.filepath,
                );
                if (!source) continue;
                seen.add(item.id);
                tasks.push(
                  (async () => {
                    for (const song of byId.get(item.id)) {
                      try {
                        if (durationGuard)
                          assertDuration(
                            song.durationMs,
                            evidence?.videoId === item.id
                              ? evidence.durationSeconds
                              : undefined,
                          );
                        await onResult(
                          song,
                          source,
                          evidence?.videoId === item.id ? evidence : null,
                        );
                        completed.add(song.key);
                      } catch (e) {
                        publicationErrors.set(song.key, classify(e.message));
                      }
                    }
                  })(),
                );
              }
            },
          );
          await Promise.all(tasks);
        },
        () =>
          [...byId.values()].filter((group) =>
            group.some((s) => completed.has(s.key)),
          ).length,
        byId.size,
      );
      return songs
        .filter((s) => !completed.has(s.key))
        .map((song) => ({
          song,
          error:
            publicationErrors.get(song.key) ||
            (durationGuard &&
            extractedDurations.has(youtubeVideoId(song.url)) &&
            !durationMatch(
              song.durationMs,
              extractedDurations.get(youtubeVideoId(song.url)),
            ).ok
              ? DURATION_REJECTED
              : null) ||
            (durationGuard && result?.code === 0 ? DURATION_REJECTED : null) ||
            result?.error ||
            'Download did not complete',
        }));
    } finally {
      await Promise.all(tasks);
      rmSync(temp, { recursive: true, force: true });
    }
  }
}

export async function verifyMp3(path) {
  return new Promise<any>((yes, no) => {
    const child = spawn(
      '/opt/homebrew/bin/ffprobe',
      [
        '-v',
        'error',
        '-show_entries',
        'stream=codec_name:format=duration',
        '-of',
        'json',
        path,
      ],
      { stdio: ['ignore', 'pipe', 'ignore'] },
    );
    let data = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), 10000);
    child.stdout.on('data', (chunk) => (data += chunk));
    child.once('error', () => {
      clearTimeout(timer);
      no(new Error('ffprobe unavailable'));
    });
    child.once('close', (code) => {
      clearTimeout(timer);
      try {
        const value = JSON.parse(data);
        if (
          code !== 0 ||
          !value.streams?.some((s) => s.codec_name === 'mp3') ||
          !Number.isFinite(Number(value.format?.duration)) ||
          !(Number(value.format?.duration) > 0)
        )
          throw new Error();
        yes(Number(value.format.duration));
      } catch {
        no(new Error('Output failed MP3 codec/duration verification'));
      }
    });
  });
}
