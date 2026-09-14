import { existsSync, mkdirSync } from 'fs';
import { dirname } from 'path';
const sqlite = require('sqlite3');

/** Persistence adapter for the existing CLI journal. No database opens at boot.
 * Both entry points use identical filename keys and columns under exclusive
 * ownership, so a handback does not forget exhausted selections or retries. */
export class WebWorkStore {
  private schemaReady: Promise<void> | null = null;
  constructor(private readonly path: string) {}
  private async database<T>(
    write: boolean,
    action: (db: any) => Promise<T>,
  ): Promise<T> {
    if (write) mkdirSync(dirname(this.path), { recursive: true });
    const db: any = await new Promise((yes, no) => {
      const connection = new sqlite.Database(
        this.path,
        write
          ? sqlite.OPEN_READWRITE | sqlite.OPEN_CREATE
          : sqlite.OPEN_READONLY,
        (error) => (error ? no(error) : yes(connection)),
      );
    });
    db.configure('busyTimeout', 10000);
    const query = (sql: string, values: any[] = []) =>
      new Promise<any[]>((yes, no) =>
        db.all(sql, values, (error, rows) => (error ? no(error) : yes(rows))),
      );
    try {
      return await action(query);
    } finally {
      await new Promise<void>((yes, no) =>
        db.close((error) => (error ? no(error) : yes())),
      );
    }
  }
  async get(key: string): Promise<any | null> {
    if (!existsSync(this.path)) return null;
    return this.database(
      false,
      async (query) =>
        (await query('SELECT * FROM work WHERE key=?', [key]))[0] || null,
    );
  }
  async all(): Promise<any[]> {
    if (!existsSync(this.path)) return [];
    return this.database(false, (query) => query('SELECT * FROM work'));
  }
  async save(song: any): Promise<void> {
    this.schemaReady ||= this.database(true, async (query) => {
      await query(
        'CREATE TABLE IF NOT EXISTS work(key TEXT PRIMARY KEY,url TEXT,state TEXT,attempts INTEGER DEFAULT 0,retry_at INTEGER DEFAULT 0,error TEXT,network_attempts INTEGER DEFAULT 0,search_limit INTEGER DEFAULT 0)',
      );
      const columns = new Set(
        (await query('PRAGMA table_info(work)')).map((row) => row.name),
      );
      for (const name of ['network_attempts', 'search_limit']) {
        if (!columns.has(name)) {
          try {
            await query(
              'ALTER TABLE work ADD COLUMN ' + name + ' INTEGER DEFAULT 0',
            );
          } catch (error) {
            // A simultaneous initializer may have added it while we waited.
            if (
              !(await query('PRAGMA table_info(work)')).some(
                (column) => column.name === name,
              )
            )
              throw error;
          }
        }
      }
    }).catch((error) => {
      this.schemaReady = null;
      throw error;
    });
    await this.schemaReady;
    await this.database(true, async (query) => {
      await query(
        'INSERT INTO work(key,url,state,attempts,retry_at,error,network_attempts,search_limit) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(key) DO UPDATE SET url=excluded.url,state=excluded.state,attempts=excluded.attempts,retry_at=excluded.retry_at,error=excluded.error,network_attempts=excluded.network_attempts,search_limit=excluded.search_limit',
        [
          song.key,
          song.url || null,
          song.state,
          song.attempts || 0,
          song.retryAt || 0,
          song.error || null,
          song.networkAttempts || 0,
          song.searchLimit || 0,
        ],
      );
    });
  }
}
