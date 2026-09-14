#!/usr/bin/env node
/**
 * Watch YouTube pace events + sqlite errors.
 * On the FIRST 429/bot-check/API block: drop to 1×8/10 min and 1 yt-dlp.
 * Does not auto-raise while autoStep is false.
 * Prints FAILED on backoff (so a grok monitor wakes). Otherwise quiet.
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { execFileSync } from "node:child_process";

const STATE =
  process.env.YT_PACE_STATE_PATH ||
  "/Users/dom/src/spooty/src/backend/config/yt-pace.json";
const EVENTS =
  process.env.YT_PACE_EVENTS_PATH ||
  "/Users/dom/src/spooty/src/backend/config/yt-events.jsonl";
const API = process.env.YT_PACE_API || "http://127.0.0.1:3000/api/youtube/pace";
const DB = process.env.YT_PACE_DB || "/Users/dom/src/spooty/data/spooty.sqlite";
const POLL_MS = Math.max(5_000, Number(process.env.YT_PACE_POLL_MS || 8_000));

const RATE_SQL = `SELECT COUNT(*) FROM track_entity WHERE status=5 AND (
  error LIKE '%bot%' OR error LIKE '%429%' OR error LIKE '%Too Many%'
  OR error LIKE '%Sign in to confirm%'
  OR (error LIKE '%Unable to download API page%' AND error NOT LIKE '%No route to host%' AND error NOT LIKE '%Errno 65%')
);`;

const defaults = {
  maxPerWindow: 16,
  conc: 2,
  floorPerWindow: 8,
  capPerWindow: 32,
  capConc: 3,
  step: 4,
  cleanMsToStep: 15 * 60_000,
  lastBotAt: null,
  lastStepAt: null,
  reason: null,
  autoStep: false,
};

function loadState() {
  let s = { ...defaults };
  try {
    if (existsSync(STATE))
      s = { ...defaults, ...JSON.parse(readFileSync(STATE, "utf8")) };
  } catch {
    s = { ...defaults };
  }
  if (!s.lastStepAt) s.lastStepAt = Date.now();
  return s;
}

function saveState(s) {
  mkdirSync(dirname(STATE), { recursive: true });
  writeFileSync(STATE, JSON.stringify(s, null, 2) + "\n");
}

function readEventsSince(since) {
  if (!existsSync(EVENTS)) return [];
  const text = readFileSync(EVENTS, "utf8");
  const out = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      const ev = JSON.parse(line);
      if (typeof ev.t === "number" && ev.t >= since) out.push(ev);
    } catch {
      /* skip */
    }
  }
  return out;
}

function sqliteRateErrors() {
  if (!existsSync(DB)) return 0;
  try {
    const n = execFileSync("sqlite3", [DB, RATE_SQL], {
      encoding: "utf8",
    }).trim();
    return Number(n) || 0;
  } catch {
    return 0;
  }
}

async function pushLive(s) {
  try {
    const response = await fetch(API, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        maxPerWindow: s.maxPerWindow,
        conc: s.downloadConc || s.conc,
        downloadConc: s.downloadConc || s.conc,
        searchConc: s.searchConc,
        floorPerWindow: s.floorPerWindow,
        lastBotAt: s.lastBotAt,
        lastStepAt: s.lastStepAt,
        lastGood: s.lastGood,
        lastFail: s.lastFail,
        reason: s.reason,
        tripLever: s.tripLever,
      }),
    });
    return response.ok;
  } catch {
    /* nest may be restarting */
    return false;
  }
}

async function persistControlState(s) {
  // The backend is the sole writer of runtime fields such as downloadStarts,
  // coolUntil, and botTimes. Rewriting the whole JSON document here while it
  // is live can clobber an admission that happened between loadState() and
  // saveState(). Only fall back to a file write while Nest is unavailable.
  if (!(await pushLive(s))) saveState(s);
}

async function liveSnapshot() {
  try {
    const res = await fetch(API);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

let lastErrorCount = sqliteRateErrors();
let lastBotEventT = 0;
let tripped = false;

function tripLeverFromLive(live) {
  const r = String(live?.reason || "");
  if (/\bsearchConc\b/.test(r)) return "searchConc";
  if (/\bmaxPerWindow\b/.test(r)) return "maxPerWindow";
  if (/\bdownloadConc\b/.test(r)) return "downloadConc";
  return null;
}

async function backoff(s, why, alreadyLive = false, lever = null) {
  if (tripped) return;
  tripped = true;
  console.log("FAILED");
  // Nest already froze the attributed lever. Never guess downloadConc
  // for a search trip (live.reason TRIP searchConc).
  if (alreadyLive || !lever) return;
  s.tripLever = lever;
  s.reason = `TRIP ${why}`;
  s.lastBotAt = Date.now();
  s.lastStepAt = Date.now();
  await persistControlState(s);
}

async function tick() {
  const now = Date.now();
  const s = loadState();
  const events = readEventsSince(now - 15 * 60_000);
  const bots = events.filter(
    (e) =>
      e.type === "bot" &&
      !/unable to download video data:\s*http error 403/i.test(
        String(e.detail || ""),
      ),
  );
  const newestBot = bots.reduce((m, e) => Math.max(m, e.t), 0);
  const errors = sqliteRateErrors();
  const errorSpike = errors > lastErrorCount;
  lastErrorCount = errors;
  const live = await liveSnapshot();
  const liveTrip =
    live &&
    ((live.botsInWindow || 0) > 0 ||
      (live.coolRemainingMs || 0) > 0 ||
      (typeof live.reason === "string" && live.reason.startsWith("TRIP")));
  const liveLever = tripLeverFromLive(live);

  if (liveTrip) {
    if (newestBot > lastBotEventT) lastBotEventT = newestBot;
    await backoff(s, live.reason || "live pace trip", true, liveLever);
    return;
  }
  if (newestBot > lastBotEventT) {
    lastBotEventT = newestBot;
    // Unknown lever: notify only. Do not retarget as downloadConc.
    await backoff(s, "bot-check/429 event", true, null);
    return;
  }
  if (errorSpike) {
    await backoff(s, `sqlite rate-limit errors=${errors}`, true, null);
    return;
  }

  // Allow a later, distinct rate-limit incident to wake the monitor again
  // after the previous live cooldown has genuinely cleared.
  tripped = false;

  if (s.autoStep === false) return;

  const downloads = events.filter((e) => e.type === "download_ok");
  const lastBot = s.lastBotAt || 0;
  const lastStep = s.lastStepAt || 0;
  const cleanLongEnough =
    now - lastBot >= s.cleanMsToStep && now - lastStep >= s.cleanMsToStep;
  const enoughWork = downloads.length >= 6;
  if (!cleanLongEnough || !enoughWork) return;

  if (s.maxPerWindow < s.capPerWindow) {
    s.maxPerWindow = Math.min(s.capPerWindow, s.maxPerWindow + s.step);
    s.lastStepAt = now;
    s.reason = `step-up window → ${s.conc}×${s.maxPerWindow}/10m`;
    await persistControlState(s);
    return;
  }
  if (s.conc < s.capConc) {
    s.conc += 1;
    s.lastStepAt = now;
    s.reason = `step-up conc → ${s.conc}×${s.maxPerWindow}/10m`;
    await persistControlState(s);
  }
}

await tick();
setInterval(() => {
  tick().catch(() => undefined);
}, POLL_MS);
