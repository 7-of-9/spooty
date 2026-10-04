import { createHash, randomUUID } from 'node:crypto';
import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  renameSync,
  rmSync,
} from 'node:fs';
import { join } from 'node:path';

/** Only bounded, public candidate metadata; never raw extractor/session output. */
export class SearchDiagnostics {
  constructor(private readonly directory: string) {}
  private file(key: string) {
    return join(
      this.directory,
      createHash('sha256').update(key).digest('hex') + '.json',
    );
  }
  save(key: string, report: any) {
    mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    const file = this.file(key),
      temp = `${file}.${process.pid}.${randomUUID()}.tmp`;
    try {
      writeFileSync(temp, JSON.stringify({ ...report, key }) + '\n', {
        mode: 0o600,
        flag: 'wx',
      });
      renameSync(temp, file);
    } finally {
      rmSync(temp, { force: true });
    }
  }
  read(key: string) {
    try {
      const report = JSON.parse(readFileSync(this.file(key), 'utf8'));
      return report.key === key ? report : null;
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      throw error;
    }
  }
}
