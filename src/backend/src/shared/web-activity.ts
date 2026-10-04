export type ActivityPhase = 'preparing' | 'metadata' | 'verifying' | 'copying' | 'waiting-search' | 'searching' | 'waiting-download' | 'downloading';
type WorkTrack = { id?: number; artist: string; name: string; playlist?: { name?: string } };
type ActiveWork = { id: number; artist: string; name: string; playlistName?: string; phase: ActivityPhase; startedAt: number; percent?: number; result?: string };

/** Observability only. Never schedules, cancels, or changes acquisition policy. */
export class WebActivity {
  private active = new Map<number, ActiveWork>();
  private recent: Array<{ at: number; artist: string; name: string; result: string }> = [];
  private totals = { downloaded: 0, reused: 0, checked: 0 };
  private since = Date.now();

  async run<T>(track: WorkTrack, work: () => Promise<T>): Promise<T> {
    if (track.id == null) return work();
    this.active.set(track.id, { id: track.id, artist: track.artist, name: track.name, playlistName: track.playlist?.name, phase: 'preparing', startedAt: Date.now() });
    try { return await work(); }
    catch (error) { this.result(track.id, 'failed'); throw error; }
    finally {
      const item = this.active.get(track.id);
      if (item) {
        const result = item.result || 'checked';
        if (result === 'downloaded' || result === 'reused') this.totals[result]++;
        else this.totals.checked++;
        this.recent.unshift({ at: Date.now(), artist: item.artist, name: item.name, result });
        this.recent = this.recent.slice(0, 20);
        this.active.delete(track.id);
      }
    }
  }

  phase(track: WorkTrack, phase: ActivityPhase, percent?: number): void {
    if (track.id == null) return;
    const item = this.active.get(track.id);
    if (!item) return;
    Object.assign(item, { artist: track.artist, name: track.name, phase });
    if (track.playlist?.name) item.playlistName = track.playlist.name;
    if (typeof percent === 'number' && Number.isFinite(percent)) item.percent = Math.max(0, Math.min(100, percent));
    else delete item.percent;
  }

  result(id: number, result: string): void {
    const item = this.active.get(id);
    if (item) item.result = result;
  }

  snapshot(queue: { active: WorkTrack[]; nextRetryAt: number | null }) {
    return {
      since: this.since,
      active: queue.active.map(track => {
        const item = this.active.get(track.id);
        return item ? { ...item } : { id: track.id, artist: track.artist, name: track.name, playlistName: track.playlist?.name, phase: 'waiting-shared', startedAt: 0 };
      }),
      recent: this.recent.map(item => ({ ...item })),
      totals: { ...this.totals },
      nextRetryAt: queue.nextRetryAt,
    };
  }
}

export const webActivity = new WebActivity();
