#!/usr/bin/env node
import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const WebSocket = require('ws');
const PORT_FILE = process.env.HOME + '/Library/Application Support/Google/Chrome/DevToolsActivePort';
function readEndpoint() {
  const [port, pth] = fs.readFileSync(PORT_FILE, 'utf8').split('\n').map((l) => l.trim()).filter(Boolean);
  return `ws://127.0.0.1:${port}${pth}`;
}
class Cdp {
  constructor(url) { this.url = url; this.id = 0; this.pending = new Map(); }
  connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.url, { perMessageDeflate: false });
      this.ws.on('open', resolve);
      this.ws.on('error', reject);
      this.ws.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.id != null && this.pending.has(msg.id)) {
          const { resolve: res, reject: rej } = this.pending.get(msg.id);
          this.pending.delete(msg.id);
          if (msg.error) rej(new Error(JSON.stringify(msg.error)));
          else res(msg.result);
        }
      });
    });
  }
  send(method, params = {}, sessionId) {
    const id = ++this.id;
    const payload = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify(payload));
    });
  }
}
const cdp = new Cdp(readEndpoint());
await cdp.connect();
const { targetInfos } = await cdp.send('Target.getTargets');
const page = targetInfos.find((t) => (t.url || '').includes('17FjOthbHvvqRlL9FbBrtP'));
const { sessionId } = await cdp.send('Target.attachToTarget', { targetId: page.targetId, flatten: true });
await cdp.send('Runtime.enable', {}, sessionId);
const info = await cdp.send('Runtime.evaluate', {
  expression: `(() => {
    const row = document.querySelector('[data-testid="tracklist-row"]');
    const chain = [];
    let el = row;
    while (el && el !== document.body) {
      const s = getComputedStyle(el);
      chain.push({
        tag: el.tagName,
        id: el.id,
        testid: el.getAttribute('data-testid'),
        className: String(el.className).slice(0, 80),
        overflow: s.overflow + '/' + s.overflowY,
        scrollH: el.scrollHeight,
        clientH: el.clientHeight,
        scrollTop: el.scrollTop,
      });
      el = el.parentElement;
    }
    return chain;
  })()`,
  returnByValue: true,
}, sessionId);
console.log(JSON.stringify(info.result.value, null, 2));
cdp.ws.close();
