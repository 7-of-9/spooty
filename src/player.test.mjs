import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

test('chapter zero seeks to the beginning while a normal play action resumes', () => {
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) elements.set(id, { dataset: {}, setAttribute() {}, addEventListener() {} });
    return elements.get(id);
  };
  Object.assign(element('audio'), { currentTime: 125, paused: true, play: () => Promise.resolve() });
  const context = vm.createContext({ URLSearchParams,
    document: { getElementById: element, querySelectorAll: () => [] },
    fetch: () => new Promise(() => {}),
  });
  const html = readFileSync(new URL('./index.html', import.meta.url), 'utf8');
  vm.runInContext(html.match(/<script>([\s\S]*?)<\/script>/)[1], context);
  context.play('mixes/example.mp3', 'Example', 'A mix');
  assert.equal(element('audio').currentTime, 125);
  context.play('mixes/example.mp3', 'Example', 'First chapter', 0);
  assert.equal(element('audio').currentTime, 0);
  context.play('mixes/example.mp3', 'Example', 'Later chapter', 240);
  assert.equal(element('audio').currentTime, 240);
});

test('completed mix metadata links bypass an early visitor’s cached draft', () => {
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) elements.set(id, { dataset: {}, setAttribute() {}, addEventListener() {}, querySelectorAll: () => [] });
    return elements.get(id);
  };
  const context = vm.createContext({ URLSearchParams, document: { getElementById: element }, fetch: () => new Promise(() => {}) });
  const html = readFileSync(new URL('./index.html', import.meta.url), 'utf8');
  vm.runInContext(html.match(/<script>([\s\S]*?)<\/script>/)[1], context);
  vm.runInContext(`mixCatalog = { updatedAt: '2026-10-06T03:00:00Z', mixes: [{
    name: 'Example', version: 2, status: 'ready', audioPath: 'mixes/a.mp3',
    cuePath: 'mixes/a.cue', detailsPath: 'mixes/a.json', orderCsvPath: 'mixes/a-order.csv',
    transitionsCsvPath: 'mixes/a-transitions.csv', order: []
  }] }; renderMixes();`, context);
  for (const path of ['a.cue', 'a.json', 'a-order.csv', 'a-transitions.csv']) {
    assert.ok(element('mix-grid').innerHTML.includes(`mixes%2F${path}?download=1&v=2026-10-06T03%3A00%3A00Z`));
  }
  assert.ok(element('mix-grid').innerHTML.includes('mixes%2Fa.mp3?download=1"'));
});

test('collection links load isolated catalogs and omit absent Spotify identities', async () => {
  const html = readFileSync(new URL('./index.html', import.meta.url), 'utf8');
  for (const [query, prefix, expectedCount] of [['?playlist=50', '/', 100], ['?playlist=unknown', '/', 100]]) {
    const elements = new Map(), calls = [];
    const element = id => {
      if (!elements.has(id)) elements.set(id, { dataset: {}, value: '', setAttribute() {}, addEventListener() {}, querySelectorAll: () => [] });
      return elements.get(id);
    };
    const tracks = Array.from({length: expectedCount}, (_, i) => ({position:i+1,title:'Song '+(i+1),artist:'Artist',durationSeconds:200,audio:{path:`audio/${prefix==='/'?'50':'life-timeline'}/${i}.mp3`,bytes:100,sha256:'hash'}}));
    const context = vm.createContext({URLSearchParams, location:{search:query},document:{getElementById:element,querySelectorAll:()=>[]},fetch:async path=>{
      calls.push(path);return {ok:true,json:async()=>path.endsWith('manifest.json')?{tracks,createdAt:'2026-10-09',downloads:{csv:'exports/tracks.csv',m3u:'exports/playlist.m3u8'}}:{mixes:[]}};
    }});
    vm.runInContext(html.match(/<script>([\s\S]*?)<\/script>/)[1], context);
    await new Promise(resolve=>setImmediate(resolve));
    assert.deepEqual(calls,[prefix+'manifest.json',prefix+'mixes.json']);
    assert.equal((element('track-rows').innerHTML.match(/<tr>/g)||[]).length,expectedCount);
    assert.doesNotMatch(element('track-rows').innerHTML,/open\.spotify\.com\/track\/(undefined|null)/);
    assert.match(element('track-rows').innerHTML, /<dd>Not available<\/dd>/);
    if(prefix!=='/')assert.match(element('snapshot').textContent,/Collection prepared/);
    element('search').value='Song 55';context.renderTracks();
    assert.match(element('count').textContent,/1 of/);
  }
});

test('public page does not advertise or fetch withdrawn collection', () => {
  const html=readFileSync(new URL('./index.html', import.meta.url),'utf8');
  assert.doesNotMatch(html,/life-timeline|Life timeline/);
});
