#!/usr/bin/env node
// Read public track metadata through the existing Spotify session and request gate.
// Run the CDP configuration preflight and check the existing proxy before use.
import { readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { getTrackDurationMetadata } from '../spotify-session.mjs';

const [input, output] = process.argv.slice(2);
if (!input || !output) throw new Error('usage: enrich-metadata.mjs verified-playlist.json metadata.json');
const source = JSON.parse(readFileSync(input, 'utf8'));
const ids = source.tracks.map((track) => track.sourceKey?.replace(/^spotify:/, ''));
if (!ids.length || ids.some((id) => !/^[A-Za-z0-9]{22}$/.test(id))) throw new Error('Invalid source IDs');
let cached = {};
try { cached = JSON.parse(readFileSync(output, 'utf8')).tracks || {}; } catch { /* First export. */ }
const result = { fetchedAt: new Date().toISOString(), tracks: cached, failed: [] };
let next = 0;
async function worker() {
  while (next < ids.length) {
    const id = ids[next++];
    if (cached[id]?.isrc && Date.now() - Date.parse(cached[id].fetchedAt) < 86400000) continue;
    try { result.tracks[id] = await getTrackDurationMetadata(id); }
    catch { result.failed.push(id); } // Never log raw browser/HTTP errors or session material.
  }
}
await Promise.all([worker(), worker()]);
mkdirSync(dirname(output), { recursive: true });
const temporary = `${output}.${process.pid}.tmp`;
writeFileSync(temporary, JSON.stringify(result, null, 2) + '\n', { mode: 0o600 });
renameSync(temporary, output);
console.log(JSON.stringify({ requested: ids.length, fetched: ids.filter((id) => result.tracks[id]).length,
  withIsrc: ids.filter((id) => result.tracks[id]?.isrc).length, failed: result.failed.length }));
