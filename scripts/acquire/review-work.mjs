import { createHash, randomUUID } from "node:crypto";
import { chmodSync, copyFileSync, existsSync, linkSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { canLaunchYoutubeWork, classify, verifyMp3 } from "./transport.mjs";

export function reviewRequests(document, songs) {
  if (!Array.isArray(document?.requests) || document.requests.length > 32)
    throw new Error("Review work must contain at most 32 explicit requests");
  const ids = new Set();
  return document.requests.map((raw) => {
    if (!/^[a-z0-9][a-z0-9._-]{0,79}$/.test(raw?.id) ||
      ["constructor", "prototype"].includes(raw.id) || ids.has(raw.id))
      throw new Error("Review request IDs must be unique safe identifiers");
    ids.add(raw.id);
    if (!songs.has(raw.key) || !["search", "inspect", "download"].includes(raw.action))
      throw new Error("Review work must refer to a saved catalog song and supported action");
    if (raw.action !== "search" && !/^[A-Za-z0-9_-]{11}$/.test(raw.videoId || ""))
      throw new Error("Review extraction requires an explicit YouTube video ID");
    if (raw.query !== undefined && (raw.action !== "search" || typeof raw.query !== "string" ||
      !raw.query.trim() || raw.query.length > 1000)) throw new Error("Invalid review query");
    const item = { id: raw.id, key: raw.key, action: raw.action,
      ...(raw.action === "search" ? { query: raw.query || null } : { videoId: raw.videoId }) };
    return { ...item, fingerprint: createHash("sha256").update(JSON.stringify(item)).digest("hex") };
  });
}

// Explicit repair/candidate work shares the running acquisition owner's pools
// and pace. Candidate MP3s remain staged outside the library until an explicit,
// verified local replacement; neither metadata nor staging is MP3 throughput.
export class ReviewWork {
  constructor(state, songs, transport, emit, onFatal = () => {}) {
    Object.assign(this, { state, songs, transport, emit, onFatal });
    this.path = join(state, "review-work-results.json");
    this.results = existsSync(this.path) ? JSON.parse(readFileSync(this.path, "utf8")) : { version: 1, entries: {} };
    if (!this.results.entries || typeof this.results.entries !== "object" || Array.isArray(this.results.entries))
      throw new Error("Invalid review work result ledger");
    this.pending = [];
    this.inFlight = new Map();
    this.completed = 0;
    this.errors = 0;
  }
  save() {
    const temp = this.path + `.${process.pid}.tmp`;
    writeFileSync(temp, JSON.stringify(this.results, null, 2) + "\n", { mode: 0o600 });
    renameSync(temp, this.path);
  }
  enqueue(document) {
    const items = reviewRequests(document, this.songs);
    const busy = new Set([...this.pending, ...[...this.inFlight.values()].flatMap((b) => b.items)].map((i) => i.id));
    for (const item of items) {
      const old = this.results.entries[item.id];
      if (old && old.fingerprint !== item.fingerprint) throw new Error("Review request ID was reused for different work");
    }
    for (const item of items) {
      const old = this.results.entries[item.id];
      if (busy.has(item.id) || old?.finishedAt) continue;
      this.pending.push(item);
      this.results.entries[item.id] = { ...item, state: "queued" };
    }
    this.save();
  }
  get reservedDownloads() {
    return [...this.inFlight.values()].filter((b) => b.kind === "download" && !b.admitted)
      .reduce((n, b) => n + new Set(b.items.map((i) => i.videoId)).size, 0);
  }
  snapshot() { return { pending: this.pending.length, activeBatches: this.inFlight.size,
    completed: this.completed, errors: this.errors }; }
  tryLaunch({ pace, slots, active, tasks, batchSize }) {
    const first = this.pending.find((item) => {
      const kind = item.action === "search" ? "search" : "download";
      return canLaunchYoutubeWork(pace, active, kind) && (kind === "search" || slots > 0);
    });
    if (!first) return false;
    const kind = first.action === "search" ? "search" : "download";
    const items = this.pending.filter((i) => i.action === first.action).slice(0, Math.min(batchSize, kind === "search" ? batchSize : slots));
    const ids = new Set(items.map((i) => i.id));
    this.pending = this.pending.filter((i) => !ids.has(i.id));
    const batch = { items, kind, admitted: false };
    this.inFlight.set(first.id, batch);
    active[kind]++;
    const subjects = items.map((item) => ({ ...this.songs.get(item.key), key: item.id,
      reviewQuery: item.query, url: item.videoId ? `https://www.youtube.com/watch?v=${item.videoId}` : null,
      cookiesNext: false }));
    const finish = (song, detail) => {
      const item = items.find((i) => i.id === song.key);
      this.results.entries[item.id] = { ...item, ...detail, finishedAt: new Date().toISOString() };
      this.save();
      this.emit("review_work_result", { id: item.id, key: item.key, action: item.action, state: detail.state });
    };
    let task;
    task = (async () => {
      let failures;
      try {
        if (first.action === "search") failures = await this.transport.searchCandidates(subjects, (song, candidates) => {
          finish(song, { state: "candidate-results", candidates });
          this.completed++;
        });
        else if (first.action === "inspect") failures = await this.transport.inspectSources(subjects, (song, evidence) => {
          finish(song, { state: "inspected", evidence });
          this.completed++;
        }, () => { batch.admitted = true; });
        else failures = await this.transport.download(subjects, async (song, source, evidence) => {
          const duration = await verifyMp3(source);
          const dir = join(this.state, "review-downloads");
          mkdirSync(dir, { recursive: true, mode: 0o700 });
          const file = join(dir, `${song.key}.mp3`);
          const temporary = join(dir, `.stage-${randomUUID()}`);
          try {
            copyFileSync(source, temporary);
            chmodSync(temporary, 0o600);
            linkSync(temporary, file); // Exclusive publication; preserve existing candidates.
          } finally { try { unlinkSync(temporary); } catch {} }
          finish(song, { state: "downloaded", evidence, duration, file });
          this.completed++;
        }, () => { batch.admitted = true; });
      } catch (error) {
        failures = subjects.map((song) => ({ song, error: classify(error.message) }));
      }
      for (const failure of failures) {
        if (failure.error === "CLI admission cancelled") continue;
        finish(failure.song, { state: "error", error: failure.error });
        this.errors++;
      }
    })().catch((error) => this.onFatal(error)).finally(() => {
      this.inFlight.delete(first.id);
      active[kind]--;
      tasks.delete(task);
    });
    // The main runner owns this handle too, so graceful stopping drains it.
    tasks.add(task);
    return true;
  }
}
