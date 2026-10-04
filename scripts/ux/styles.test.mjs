// Compile and compare the local styles without starting a browser. This is
// cascade/dependency coverage, not layout or colour-contrast acceptance.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as sass from 'sass';
import postcss from 'postcss';
import selectorParser from 'postcss-selector-parser';

const root = fileURLToPath(new URL('../../', import.meta.url));
const app = join(root, 'src/frontend/src/app');
const source = readFileSync(join(root, 'src/frontend/src/styles.scss'), 'utf8');
const options = { loadPaths: [join(root, 'node_modules')], logger: sass.Logger.silent };
const compile = text => sass.compileString(text, options).css;
// The previous whole-framework build, with exactly the same application rules.
const baseline = compile('@use "bulma/bulma";\n' + source.replace(
  /^@(use|import) "bulma\/[^"\n]+";\s*$/gm, ''));
const current = compile(source);
const files = readdirSync(app, { recursive: true }).filter(name => /\.(html|ts)$/.test(name) && !name.endsWith('.spec.ts'));
const classes = new Set();
const tags = new Set(['html', 'body', 'app-root']);
for (const file of files) {
  const content = readFileSync(join(app, file), 'utf8');
  if (file.endsWith('.html')) {
    for (const match of content.matchAll(/\bclass="([^"]*)"/g)) {
      for (const name of match[1].split(/\s+/).filter(Boolean)) classes.add(name);
    }
    for (const match of content.matchAll(/\[class\.([\w-]+)\]/g)) classes.add(match[1]);
    for (const match of content.matchAll(/<([a-z][\w-]*)\b/g)) tags.add(match[1]);
  }
  // Existing ngClass maps/ternaries in the legacy components also stay covered.
  for (const match of content.matchAll(/['"]((?:is-|has-text-|fa-)[\w-]+)['"]/g)) classes.add(match[1]);
}

function possible(node) {
  if (node.type === 'class') return classes.has(node.value);
  if (node.type === 'tag') return tags.has(node.value);
  // Negation does not require its class to exist. Alternatives are unions.
  if (node.type === 'pseudo') {
    if (node.value === ':not') return true;
    if ([':is', ':where', ':has'].includes(node.value)) return node.nodes.some(possible);
  }
  return !node.nodes || node.nodes.every(possible);
}

function relevantRules(css) {
  const rules = [];
  postcss.parse(css).walkRules(rule => {
    const context = [];
    for (let parent = rule.parent; parent?.type !== 'root'; parent = parent?.parent) {
      if (parent.type === 'atrule') context.unshift(`@${parent.name} ${parent.params}`);
    }
    // Keyframes aren't DOM selectors; the retained base module owns these.
    if (context.some(value => value.includes('keyframes'))) return;
    selectorParser(selectors => selectors.each(selector => {
      if (possible(selector)) rules.push({
        key: [...context, selector.toString().trim()].join(' | '),
        declarations: rule.nodes.filter(node => node.type === 'decl').map(node =>
          [node.prop, node.value, !!node.important]),
      });
    })).processSync(rule.selector);
  });
  return rules;
}

test('global styles use selected Sass modules instead of shipping the entire framework', () => {
  assert.doesNotMatch(source, /@(import|use)\s+["']bulma\/bulma/);
  assert.match(source, /@use "bulma\/sass\/base"/);
  const compact = css => Buffer.byteLength(postcss.parse(css).toString().replace(/\s+/g, ' '));
  assert.ok(compact(current) < compact(baseline) * 0.65, 'Keep at least 35% below the old complete Bulma stylesheet');
  assert.match(source, /@import "@fortawesome\/fontawesome-free\/css\/all\.css"/, 'Preserve the existing icon family in this styling-only change');
});

test('retains the relevant global cascade for current and legacy templates in all media/theme contexts', () => {
  const actual = relevantRules(current);
  const retainedVariables = new Set(actual.flatMap(rule => rule.declarations.map(([prop]) => prop)).filter(prop => prop.startsWith('--')));
  const normalize = rules => rules.map(rule => ({ ...rule, declarations: rule.declarations.filter(([prop]) =>
    !prop.startsWith('--') || retainedVariables.has(prop)) })).filter(rule => rule.declarations.length);
  const received = normalize(actual); const expected = normalize(relevantRules(baseline));
  const missing = expected.filter(rule => !received.some(other => other.key === rule.key)).map(rule => rule.key);
  assert.equal(received.length, expected.length, `Global rule coverage changed; missing: ${missing.slice(0, 5).join(', ')}`);
  for (let index = 0; index < expected.length; index++) {
    assert.equal(received[index].key, expected[index].key, 'Relevant global cascade order changed');
    const a = received[index].declarations; const b = expected[index].declarations;
    assert.equal(a.length, b.length, `Declarations changed for ${expected[index].key}`);
    for (let declaration = 0; declaration < b.length; declaration++) {
      assert.deepEqual(a[declaration], b[declaration], `Changed style in ${expected[index].key}`);
    }
  }
  for (const required of ['tag', 'panel', 'is-dark', 'is-size-7', 'has-text-primary', 'is-clickable', 'is-flex']) {
    assert.ok(classes.has(required), `Missing template coverage for ${required}`);
  }
});

test('omitted framework variables do not leave new unresolved references in global or component CSS', () => {
  const components = readdirSync(app, { recursive: true }).filter(name => name.endsWith('.scss'))
    .map(name => sass.compile(join(app, name), options).css).join('\n');
  const unresolved = css => {
    const definitions = new Set(); const references = new Set();
    postcss.parse(css).walkDecls(declaration => {
      if (declaration.prop.startsWith('--')) definitions.add(declaration.prop);
      for (const match of declaration.value.matchAll(/var\(\s*(--[\w-]+)/g)) references.add(match[1]);
    });
    return new Set([...references].filter(name => !definitions.has(name)));
  };
  const before = unresolved(baseline + components);
  assert.deepEqual([...unresolved(current + components)].filter(name => !before.has(name)), []);
});

const libraryStyles = sass.compile(join(app, 'components/library-panel/library-panel.component.scss'), options).css;
const activityStyles = sass.compile(join(app, 'components/library-panel/operator-activity.scss'), options).css;

test('retired sidebar counters and bottom queue overlays no longer ship component styles', () => {
  const retired = ['sidebar-live', 'sidebar-running', 'sidebar-now', 'sidebar-activity',
    'sidebar-activity-text', 'sidebar-pace', 'sidebar-pace-note', 'sidebar-attention',
    'is-skipped', 'dump-note', 'swatch', 'avail', 'is-missing',
    'rip-banner', 'rip-title', 'rip-counts', 'rip-name', 'rip-pl', 'rip-bar', 'rip-fill',
    'live-queue', 'queue-toggle', 'queue-meta', 'caret', 'queue-body', 'queue-pl-name',
    'queue-pl-meta', 'status-msg', 'error-msg'];
  for (const name of retired) {
    assert.ok(!classes.has(name), `${name} is rendered again: reassess the retired UI before removing styles`);
    assert.doesNotMatch(libraryStyles, new RegExp(`\\.${name}(?![\\w-])`), `Remove unused ${name} styles`);
  }
});

function declarations(selector) {
  const values = {};
  postcss.parse(libraryStyles + activityStyles).walkRules(rule => {
    if (rule.selectors.includes(selector)) for (const node of rule.nodes) {
      if (node.type === 'decl') values[node.prop] = node.value;
    }
  });
  return values;
}

function contrast(first, second) {
  const luminance = hex => {
    assert.match(hex, /^#[0-9a-f]{3}(?:[0-9a-f]{3})?$/i, 'Contrast fixture requires concrete CSS colours');
    if (hex.length === 4) hex = '#' + [...hex.slice(1)].map(c => c + c).join('');
    const channels = hex.slice(1).match(/../g).map(c => parseInt(c, 16) / 255)
      .map(c => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
    return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
  };
  const a = luminance(first); const b = luminance(second);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

test('fallback activity rows remain readable when hovered or keyboard focused on the white activity surface', () => {
  const panel = declarations('.operator-status');
  const row = declarations('.rip-row');
  const foreground = row.color === 'inherit' ? panel.color : row.color;
  const meta = declarations('.rip-meta').color;
  assert.ok(contrast(foreground, panel.background) >= 4.5, 'Idle row text contrast is too low');
  assert.ok(contrast(meta, panel.background) >= 4.5, 'Idle progress contrast is too low');
  for (const state of ['.rip-row:hover', '.rip-row:focus-visible']) {
    const background = declarations(state).background;
    assert.ok(contrast(foreground, background) >= 4.5, `${state} text contrast is too low`);
    assert.ok(contrast(meta, background) >= 4.5, `${state} progress contrast is too low`);
  }
  assert.notEqual(declarations('.rip-row:focus-visible').outline, 'none');
});

test('activity emphasis inherits the light-panel text instead of the system dark-theme strong colour', () => {
  assert.equal(declarations('.operator-status strong').color, 'inherit');
});
