import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

test('chapter zero seeks to the beginning while a normal play action resumes', () => {
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) elements.set(id, { dataset: {}, addEventListener() {} });
    return elements.get(id);
  };
  Object.assign(element('audio'), { currentTime: 125, paused: true, play: () => Promise.resolve() });
  const context = vm.createContext({
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
    if (!elements.has(id)) elements.set(id, { dataset: {}, addEventListener() {}, querySelectorAll: () => [] });
    return elements.get(id);
  };
  const context = vm.createContext({ document: { getElementById: element }, fetch: () => new Promise(() => {}) });
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
