import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import * as express from 'express';
import * as request from 'supertest';
import { LibraryController } from './library.controller';
import { LibraryService } from './library.service';

describe('library audio byte ranges', () => {
  let directory: string;
  let app: express.Express;
  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'spooty-audio-range-'));
    const path = join(directory, 'track.mp3');
    writeFileSync(path, Buffer.alloc(2048, 42));
    const service = { resolveAudioPath: () => ({ path, filename: 'Artist - Track.mp3' }) };
    const controller = new LibraryController(service as unknown as LibraryService);
    app = express();
    app.get('/audio', (_req, res) => controller.audio(res, 'playlist', '1'));
  });
  afterEach(() => rmSync(directory, { recursive: true, force: true }));

  it('serves an exact partial response for browser seeking', async () => {
    await request(app).get('/audio').set('Range', 'bytes=100-199')
      .expect(206).expect('Content-Type', 'audio/mpeg')
      .expect('Content-Range', 'bytes 100-199/2048').expect('Content-Length', '100');
  });
  it('serves full length and suffix ranges consistently', async () => {
    await request(app).head('/audio').expect(200).expect('Content-Length', '2048');
    await request(app).get('/audio').set('Range', 'bytes=-16')
      .expect(206).expect('Content-Range', 'bytes 2032-2047/2048').expect('Content-Length', '16');
  });
});
