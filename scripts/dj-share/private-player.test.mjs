import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

class Element {
  constructor(tag) { this.tag = tag; this.children = []; this.listeners = {}; this.textContent = ''; }
  append(...nodes) { this.children.push(...nodes); }
  addEventListener(name, callback) { this.listeners[name] = callback; }
}

async function player(data) {
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) elements.set(id, new Element(id));
    return elements.get(id);
  };
  const audio = element('#audio');
  Object.assign(audio, { currentTime: 125, readyState: 0, play: () => Promise.resolve() });
  let source = '';
  Object.defineProperty(audio, 'src', {
    get: () => source,
    set: value => { source = new URL(value, 'http://127.0.0.1:4301').href; audio.readyState = 0; },
  });
  const requests = [];
  const document = { querySelector: element, createElement: tag => new Element(tag),
    createTextNode: text => Object.assign(new Element('text'), { textContent: text }) };
  const context = vm.createContext({ Node: Element, URL, document,
    location: { origin: 'http://127.0.0.1:4301' },
    fetch: async (path, options) => { requests.push({ path, options }); return { ok: true, json: async () => data }; },
  });
  vm.runInContext(readFileSync(new URL('./private-player.js', import.meta.url), 'utf8'), context);
  await new Promise(resolve => setImmediate(resolve));
  return { elements, audio, context, requests };
}

function descendants(node) { return [node, ...node.children.flatMap(descendants)]; }

const fixture = () => ({ name: 'Selected collection',
  sources: Array.from({ length: 16 }, (_, i) => ({ position: i + 1, title: `Song ${i + 1}`,
    artist: 'Artist', era: '', audio: `/files/source-${String(i + 1).padStart(2, '0')}.mp3` })),
  mixes: ['60s', '90s', '180s', 'full'].map(id => ({ id, name: id, seconds: 1000,
    trackCount: 16, bytes: 123456, audio: `/files/${id}.mp3`,
    checks: { pass: 14, warn: 1, fail: 0 },
    downloads: { CUE: `/files/${id}.cue` },
    order: [{ position: 1, artist: 'Artist', title: 'First song', era: '', startSeconds: 0,
      sourceStart: 0, sourceEnd: 60, selectionReason: 'Measured section' }],
    transitions: [{ position: 1, startSeconds: 55, from: 'First song', to: 'Second song',
      style: 'fade', overlapSeconds: 5, checkStatus: 'warn', reason: 'Native fade', warnings: 'Energy dip' }],
  })),
});

test('private page wires all versions, source playback, chapters and downloads', async () => {
  const { elements, audio, requests } = await player(fixture());
  assert.equal(requests.length, 1);
  assert.equal(requests[0].path, '/manifest.json');
  assert.equal(requests[0].options.cache, 'no-store');
  assert.equal(elements.get('#mixes').children.length, 4);
  assert.equal(elements.get('#source-rows').children.length, 16);
  const nodes = descendants(elements.get('#mixes'));
  assert.equal(nodes.filter(n => n.tag === 'a' && n.textContent === 'Download MP3').length, 4);
  assert.ok(nodes.some(n => n.tag === 'a' && n.href === '/files/90s.cue?download=1'));
  assert.ok(nodes.some(n => n.textContent.includes('Energy dip')));
  const firstSource = descendants(elements.get('#source-rows').children[0]);
  firstSource.find(n => n.tag === 'button' && n.textContent === 'Play').listeners.click();
  assert.equal(audio.src, 'http://127.0.0.1:4301/files/source-01.mp3');
  const card = descendants(elements.get('#mixes').children[1]);
  card.find(n => n.tag === 'button' && n.textContent === '00:00').listeners.click();
  assert.equal(audio.src, 'http://127.0.0.1:4301/files/90s.mp3');
  audio.listeners.loadedmetadata();
  assert.equal(audio.currentTime, 0);
});

test('seeking keeps zero, waits for metadata and normal play resumes', async () => {
  const { audio, context } = await player(fixture());
  context.play('/files/90s.mp3', 'Mix', 240);
  assert.equal(audio.currentTime, 125);
  audio.listeners.loadedmetadata();
  audio.readyState = 1;
  assert.equal(audio.currentTime, 240);
  context.play('/files/90s.mp3', 'Mix');
  assert.equal(audio.currentTime, 240);
  context.play('/files/90s.mp3', 'First chapter', 0);
  assert.equal(audio.currentTime, 0);
  context.play('/files/full.mp3', 'Full', 360);
  context.play('/files/full.mp3', 'First chapter', 0);
  audio.listeners.loadedmetadata();
  assert.equal(audio.currentTime, 0);
});
