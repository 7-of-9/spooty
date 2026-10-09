'use strict';

const audio = document.querySelector('#audio');
const nowPlaying = document.querySelector('#now-playing');
const note = document.querySelector('#player-note');
let pendingSeek = null;
audio.addEventListener('loadedmetadata', () => {
  if (pendingSeek !== null) {
    audio.currentTime = pendingSeek;
    pendingSeek = null;
  }
});

function el(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}
function time(value) {
  const seconds = Math.floor(value || 0);
  const h = Math.floor(seconds / 3600);
  return (h ? h + ':' : '') + String(Math.floor(seconds / 60) % 60).padStart(2, '0') + ':' + String(seconds % 60).padStart(2, '0');
}
function play(url, title, at = null) {
  const absolute = new URL(url, location.origin).href;
  if (audio.src !== absolute) {
    pendingSeek = at;
    audio.src = url;
  } else if (at !== null) {
    if (audio.readyState >= 1) audio.currentTime = at;
    else pendingSeek = at;
  }
  nowPlaying.textContent = title;
  note.textContent = 'Private playback on this Mac';
  audio.play().catch(() => { note.textContent = 'Press the audio player’s play button to start.'; });
}
function button(text, callback, className) {
  const node = el('button', text, className);
  node.type = 'button';
  node.addEventListener('click', callback);
  return node;
}
function download(label, url) {
  const a = el('a', label);
  a.href = url + '?download=1';
  a.download = '';
  return a;
}
function table(headings, rows) {
  const wrap = el('div', undefined, 'table-wrap');
  const t = el('table');
  const thead = el('thead');
  const tr = el('tr');
  headings.forEach(h => { const th = el('th', h); th.scope = 'col'; tr.append(th); });
  thead.append(tr);
  const body = el('tbody');
  rows.forEach(row => { const r = el('tr'); row.forEach(value => { const cell = el('td'); cell.append(value instanceof Node ? value : document.createTextNode(String(value ?? ''))); r.append(cell); }); body.append(r); });
  t.append(thead, body);
  wrap.append(t);
  return wrap;
}
function details(summary, content) {
  const d = el('details');
  d.append(el('summary', summary), content);
  return d;
}
function sourceWarningText(warnings) {
  if (!warnings) return '';
  if (!Array.isArray(warnings)) return String(warnings);
  return warnings.map(warning => {
    if (typeof warning === 'string') return warning;
    if (!warning || typeof warning !== 'object') return '';
    return (warning.position ? `Track ${warning.position}: ` : '') + (warning.note || warning.warning || 'Source audio needs auditioning.');
  }).filter(Boolean).join(' · ');
}

async function load() {
  const response = await fetch('/manifest.json', {cache: 'no-store'});
  if (!response.ok) throw new Error('The private collection could not be loaded.');
  const data = await response.json();
  document.title = data.name + ' · Private';
  document.querySelector('#title').textContent = data.name;
  document.querySelector('#intro').textContent = `${data.sources.length} tracks · ${data.mixes.length} versions · Chronological order preserved. Compact mixes use selected highlights; the full mix keeps complete tracks. Nothing here is uploaded.`;
  for (const mix of data.mixes) {
    const card = el('article', undefined, 'mix-card');
    card.append(el('h2', mix.displayTitle || mix.name));
    card.append(el('p', `${time(mix.seconds)} · ${mix.trackCount} tracks · ${(mix.bytes / 1e6).toFixed(1)} MB`, 'stats'));
    const actions = el('div', undefined, 'actions');
    actions.append(button('Play mix', () => play(mix.audio, mix.name), 'primary'), download('Download MP3', mix.audio));
    Object.entries(mix.downloads).forEach(([label, url]) => actions.append(download(label, url)));
    card.append(actions);
    const checks = mix.checks;
    card.append(el('p', `Transition checks: ${checks.pass} passed · ${checks.warn} warnings · ${checks.fail} failed.`, checks.warn || checks.fail ? 'warning' : 'checks'));
    const sourceNotes = sourceWarningText(mix.sourceWarnings);
    if (sourceNotes) card.append(el('p', sourceNotes, 'warning'));
    const chapters = mix.order.map(row => [row.position, button(time(row.startSeconds), () => play(mix.audio, mix.name, row.startSeconds), 'time'), row.artist + ' — ' + row.title, row.era, `${time(row.sourceStart)}–${time(row.sourceEnd)}`, row.selectionReason]);
    card.append(details('Chapters & selected sections', table(['#', 'Jump to', 'Track', 'Era', 'Source section', 'Selection'], chapters)));
    const transitions = mix.transitions.map(row => [row.position, button(time(row.startSeconds), () => play(mix.audio, mix.name, Math.max(0, row.startSeconds - 5)), 'time'), row.from + ' → ' + row.to, `${row.style} · ${Number(row.overlapSeconds).toFixed(1)}s`, row.checkStatus, [row.reason, row.warnings].filter(Boolean).join(' · ')]);
    card.append(details('Transitions & audition notes', table(['#', 'Audition', 'Join', 'Blend', 'Check', 'Notes'], transitions)));
    if (mix.verificationScope) card.append(el('p', mix.verificationScope, 'scope'));
    document.querySelector('#mixes').append(card);
  }
  for (const track of data.sources) {
    const row = el('tr');
    const position = el('td', track.position);
    const identity = el('td');
    identity.append(el('strong', track.title), el('div', track.artist));
    const era = el('td', track.era);
    const controls = el('td', undefined, 'actions');
    controls.append(button('Play', () => play(track.audio, track.artist + ' — ' + track.title)), download('MP3', track.audio));
    row.append(position, identity, era, controls);
    document.querySelector('#source-rows').append(row);
  }
}
load().catch(error => { document.querySelector('#intro').textContent = error.message; });
