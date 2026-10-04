// Render and exercise the existing Angular/Jasmine suite in a local DOM.
// No Chrome, CDP, real browser, external resources or live backend is used.
// CSS layout and real audio playback still require authorized browser QA.
import { JSDOM } from 'jsdom';
import { createRequire } from 'node:module';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import ts from 'typescript';
import { compile as compileSass } from 'sass';
import 'reflect-metadata';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL('../../', import.meta.url));
const generated = mkdtempSync(join(root, 'node_modules/.spooty-dom-test-'));
// Also clean up if bootstrap fails before Angular's test environment exists.
// This path is solely the temporary directory created by this invocation.
const cleanGenerated = () => rmSync(generated, { recursive: true, force: true });
process.once('exit', cleanGenerated);
let completed = false;
process.on('beforeExit', () => {
  if (!completed) {
    console.error('DOM test runner exited without completing the suite');
    process.exitCode = 1;
  }
});
process.on('uncaughtException', error => { console.error(error); process.exitCode = 1; });
process.on('unhandledRejection', error => { console.error(error); process.exitCode = 1; });
const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'http://spooty.test/', pretendToBeVisual: true,
  // Do not enable external resources or inline-script execution.
});
const sassOptions = { loadPaths: [join(root, 'node_modules')], quietDeps: true, silenceDeprecations: ['import', 'global-builtin', 'color-functions'] };
const globalStyles = dom.window.document.createElement('style');
globalStyles.textContent = compileSass(join(root, 'src/frontend/src/styles.scss'), sassOptions).css;
dom.window.document.head.appendChild(globalStyles);
for (const name of ['window', 'document', 'navigator', 'Node', 'Element', 'HTMLElement',
  'HTMLAudioElement', 'HTMLMediaElement', 'Event', 'MouseEvent', 'KeyboardEvent',
  'FocusEvent', 'CustomEvent', 'MutationObserver', 'getComputedStyle', 'localStorage']) {
  Object.defineProperty(globalThis, name, { configurable: true, value: dom.window[name] });
}
// jsdom deliberately has no real media engine. Tests explicitly stub/assert
// media calls and events; these no-ops must never be described as playback QA.
dom.window.HTMLMediaElement.prototype.pause = function () {};
dom.window.HTMLMediaElement.prototype.load = function () {};
dom.window.HTMLMediaElement.prototype.play = function () { return Promise.resolve(); };
dom.window.HTMLElement.prototype.scrollIntoView = function () {};

// Fail closed if a mock is missing; there is no reason for UI tests to contact
// Spotify, the local backend, a browser bridge or another network endpoint.
globalThis.fetch = dom.window.fetch = () => { throw new Error('Network disabled in DOM tests'); };
dom.window.XMLHttpRequest.prototype.open = function () { throw new Error('Network disabled in DOM tests'); };
globalThis.XMLHttpRequest = dom.window.XMLHttpRequest;
globalThis.WebSocket = dom.window.WebSocket = class {
  constructor() { throw new Error('Network disabled in DOM tests'); }
};
for (const realm of [globalThis, dom.window]) {
  assert.throws(() => realm.fetch('/fixture'), /Network disabled/);
  assert.throws(() => new realm.XMLHttpRequest().open('GET', '/fixture'), /Network disabled/);
  assert.throws(() => Reflect.construct(realm.WebSocket, ['ws://test.invalid']), /Network disabled/);
}

const jasmineCore = require('jasmine-core');
const jasmine = jasmineCore.core(jasmineCore);
const env = jasmine.getEnv();
globalThis.jasmine = jasmine;
Object.assign(globalThis, jasmineCore.interface(jasmine, env));
env.configure({ random: false });
// Zone's fake clock must wrap Node's timers, not jsdom's separate timer realm.
delete globalThis.window;
require('zone.js/node');
try { require('zone.js/testing'); } catch (error) { console.error('Test-zone bootstrap failed', error); throw error; }
Object.defineProperty(globalThis, 'window', { configurable: true, value: dom.window });
await import('@angular/compiler');
const { TestBed } = await import('@angular/core/testing');
const { BrowserDynamicTestingModule, platformBrowserDynamicTesting } = await import('@angular/platform-browser-dynamic/testing');
TestBed.initTestEnvironment(BrowserDynamicTestingModule, platformBrowserDynamicTesting(), {
  teardown: { destroyAfterEach: true },
});

let passed = 0;
let failed = 0;
let skipped = 0;
env.addReporter({
  specDone(result) {
    if (result.status === 'passed') passed++;
    else if (result.status === 'failed') {
      failed++;
      console.error(`FAIL ${result.fullName}`);
      for (const error of result.failedExpectations) console.error(error.message, error.stack || '');
    } else skipped++;
  },
  jasmineDone(result) {
    completed = true;
    for (const error of result.failedExpectations) console.error(error.message, error.stack || '');
    console.log(JSON.stringify({ suite: 'Angular DOM (not browser/layout/media)', passed, failed, skipped, status: result.overallStatus }));
    if (result.overallStatus !== 'passed' || skipped || !passed) process.exitCode = 1;
  },
});

try {
  console.log('DOM runner: compiling the real template and suite');
  await build({
    stdin: { contents: [
      './src/frontend/src/app/app.component.spec.ts',
      './src/frontend/src/app/components/library-panel/library-panel.component.spec.ts',
      './src/frontend/src/app/services/track.service.spec.ts',
      './src/frontend/src/app/services/library.service.spec.ts',
    ].map(path => `import ${JSON.stringify(path)};`).join('\n'), resolveDir: root, loader: 'js' },
    outfile: join(generated, 'suite.mjs'), bundle: true, platform: 'node', format: 'esm', packages: 'external',
    logLevel: 'silent',
    plugins: [{ name: 'angular-jit-resources', setup(builder) {
      builder.onLoad({ filter: /\.ts$/ }, args => {
        let source = readFileSync(args.path, 'utf8');
        source = source.replace(/templateUrl:\s*['"]([^'"]+)['"]/g,
          (_match, path) => `template: ${JSON.stringify(readFileSync(join(dirname(args.path), path), 'utf8'))}`);
        // Compile real component styles as well; jsdom can check the CSS
        // cascade, but it still does not calculate layout or paint pixels.
        source = source.replace(/styleUrl:\s*['"]([^'"]+)['"]/g, (_match, path) =>
          `styles: ${JSON.stringify([compileSass(join(dirname(args.path), path), sassOptions).css])}`);
        source = source.replace(/styleUrls:\s*\[([\s\S]*?)\]/g, (_match, paths) => {
          const styles = [...paths.matchAll(/['"]([^'"]+)['"]/g)]
            .map(match => compileSass(join(dirname(args.path), match[1]), sassOptions).css);
          return `styles: ${JSON.stringify(styles)}`;
        });
        const compiled = ts.transpileModule(source, { fileName: args.path, compilerOptions: {
          target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext,
          experimentalDecorators: true, emitDecoratorMetadata: true, useDefineForClassFields: false,
        } });
        return { contents: compiled.outputText, loader: 'js', resolveDir: dirname(args.path) };
      });
    } }],
  });
  await import(pathToFileURL(join(generated, 'suite.mjs')).href);
  console.log('DOM runner: executing suite');
  await env.execute();
} finally {
  TestBed.resetTestingModule();
  dom.window.close();
  cleanGenerated();
}
