import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import {
  mkdtempSync,
  rmSync,
  readdirSync,
  readFileSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Transport } from "./transport.mjs";
import {
  DurationCandidates,
  DURATION_NO_CANDIDATE,
} from "./duration-policy.mjs";
const require = createRequire(import.meta.url);
const {
  youtubeQueryVariants,
  candidateIdentity,
} = require("../../src/backend/src/shared/acquisition/search-discovery.ts");
const {
  SearchDiagnostics,
} = require("../../src/backend/src/shared/acquisition/search-diagnostics.ts");
const url = (id) => "https://www.youtube.com/watch?v=" + id;
const first = "abcdefghijk",
  second = "jAcDqjEo6Rw";
const song = () => ({
  key: "k scope - the setup",
  name: "The Setup",
  artist: "K Scope",
  album: "Earth, Vol. 4",
  durationMs: 250500,
});
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "spooty-discovery-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  let held = null;
  const admissions = [];
  const transport = Object.assign(Object.create(Transport.prototype), {
    paths: { temp: root, cookies: "/no-cookie" },
    opts: {},
    runtime: "/runtime",
    cookiesFirst: () => false,
    emit: () => {},
    pace: {
      run: async (kind, fn) => {
        assert.equal(held, null, "do not nest pace slots");
        held = kind;
        admissions.push(kind);
        try {
          return await fn();
        } finally {
          held = null;
        }
      },
    },
    process: async () => {
      throw new Error("Real YouTube forbidden");
    },
  });
  const ledger = new DurationCandidates(join(root, "duration-rejections.json"));
  const diagnostics = new SearchDiagnostics(join(root, "search-diagnostics"));
  return { transport, ledger, diagnostics, root, admissions };
}
const document = (query, entries) =>
  JSON.stringify({ original_url: query, entries });

test("bounded query plan retains original, adds album and simplifies long credits", () => {
  assert.deepEqual(youtubeQueryVariants(song()), [
    "K Scope The Setup",
    "K Scope The Setup Earth, Vol. 4",
    "K Scope The Setup official audio",
  ]);
  const queries = youtubeQueryVariants({
    artist: "Words 2B Heard Substance, Mark Holmes",
    name: "Stranded",
    album: "Earth, Vol. 6",
  });
  assert.equal(queries.length, 3);
  assert.equal(queries[1], "Words 2B Heard Substance Stranded Earth, Vol. 6");
});
test("identity guard rejects same-length unrelated songs and alternate performances", () => {
  for (const candidate of [
    { title: "K Scope Other Song" },
    { title: "The Setup", channel: "Other Artist - Topic" },
    { title: "K Scope The Setup (Live)" },
    { title: "K Scope The Setup karaoke" },
  ])
    assert.equal(candidateIdentity(song(), candidate).ok, false);
  assert.equal(
    candidateIdentity(song(), {
      title: "The Setup",
      channel: "K-Scope - Topic",
    }).ok,
    true,
  );
  assert.equal(
    candidateIdentity(
      { artist: "Vincent", name: "Scythe - Studio Mix" },
      { title: 'Scythe (12" Studio Mix)', channel: "Vincent - Topic" },
    ).ok,
    true,
  );
});
test("generic song names must be a title phrase, not scattered words in TV/news results", () => {
  const expected = { artist: "Vincent", name: "The Plan" };
  for (const title of [
    "The Originals 4x13 - Vincent explains his plan",
    "Byron (Vincent D'Onofrio) Reveals His Plan to Franny | The Beauty | FX",
    "Louis-Vincent Gave: Inside China's Plan",
  ])
    assert.equal(candidateIdentity(expected, { title }).ok, false, title);
  assert.equal(
    candidateIdentity(expected, {
      title: "The Plan",
      channel: "Vincent - Topic",
    }).ok,
    true,
  );
});
test("fallback finds audited compatible version, deduplicates IDs, and retains diagnostics", async (t) => {
  const f = fixture(t),
    s = song();
  let calls = 0;
  f.transport.process = async (args, kind, _timeout, line) => {
    assert.equal(kind, "search");
    calls++;
    const query = args.find((a) => a.startsWith("ytsearch"));
    line(
      document(
        query,
        calls === 1
          ? [{ id: first, title: "K Scope The Setup", duration: 338 }]
          : [
              { id: first, title: "K Scope The Setup", duration: 338 },
              {
                id: second,
                title: "The Setup",
                channel: "K-Scope - Topic",
                duration: 250.521,
              },
            ],
      ),
    );
    return { code: 0 };
  };
  let selected;
  assert.deepEqual(
    await f.transport.search(
      [s],
      (_song, value) => {
        selected = value;
      },
      f.ledger,
    ),
    [],
  );
  assert.equal(selected, url(second));
  assert.equal(calls, 2);
  assert.equal(s.durationCandidates.length, 2);
  const report = f.diagnostics.read(s.key);
  assert.equal(report.outcome, "selected");
  assert.equal(report.queries[1].candidates[0].duplicate, true);
  assert.equal(report.queries[0].candidates[0].reason, "mismatch");
  assert.equal(
    statSync(
      join(
        f.root,
        "search-diagnostics",
        readdirSync(join(f.root, "search-diagnostics"))[0],
      ),
    ).mode & 0o777,
    0o600,
  );
});
test("a good first result needs one search, with no fallback or inspection", async (t) => {
  const f = fixture(t);
  let calls = 0;
  f.transport.process = async (args, _kind, _timeout, line) => {
    calls++;
    line(
      document(args.at(-1), [
        { id: second, title: "K Scope The Setup", duration: 250.521 },
      ]),
    );
    return { code: 0 };
  };
  assert.deepEqual(await f.transport.search([song()], () => {}, f.ledger), []);
  assert.equal(calls, 1);
  assert.deepEqual(f.admissions, ["search"]);
});
test("missing duration on a credible candidate gets metered source inspection, outside search slot", async (t) => {
  const f = fixture(t),
    s = song();
  f.transport.process = async (args, kind, _timeout, line) => {
    if (kind === "search")
      line(
        document(args.at(-1), [
          { id: second, title: "The Setup", channel: "K Scope - Topic" },
        ]),
      );
    else {
      assert.ok(args.includes("--skip-download"));
      line(
        "SPOOTY_SOURCE:" +
          JSON.stringify({
            id: second,
            title: "The Setup",
            channel: "K Scope - Topic",
            duration: 250.521,
          }),
      );
    }
    return { code: 0 };
  };
  assert.deepEqual(await f.transport.search([s], () => {}, f.ledger), []);
  assert.deepEqual(f.admissions, ["search", "download"]);
  assert.equal(
    f.diagnostics.read(s.key).queries[0].candidates[0].inspectedDurationSeconds,
    250.521,
  );
});
test("duplicate missing-duration candidates are inspected only once and inspection count is bounded", async (t) => {
  const f = fixture(t),
    s = song();
  let inspections = 0;
  f.transport.process = async (args, kind, _timeout, line) => {
    if (kind === "search")
      line(
        document(
          args.at(-1),
          Array.from({ length: 5 }, (_, i) => ({
            id: "candidate0" + i,
            title: "K Scope The Setup",
          })),
        ),
      );
    else
      for (const video of args.slice(args.indexOf("--") + 1)) {
        inspections++;
        line(
          "SPOOTY_SOURCE:" +
            JSON.stringify({
              id: video.slice(-11),
              title: "K Scope The Setup",
            }),
        );
      }
    return { code: 0 };
  };
  const failures = await f.transport.search(
    [s],
    () => assert.fail("cannot select unknown duration"),
    f.ledger,
  );
  assert.equal(failures[0].error, DURATION_NO_CANDIDATE);
  assert.equal(inspections, 2);
  assert.equal(f.diagnostics.read(s.key).queries.length, 3);
});
test("wrong identity never becomes an alternative when selected candidate is rejected", async (t) => {
  const f = fixture(t),
    s = song();
  f.transport.process = async (args, _kind, _timeout, line) => {
    line(
      document(args.at(-1), [
        { id: first, title: "K Scope Other Song", duration: 250 },
        { id: second, title: "K Scope The Setup", duration: 250 },
      ]),
    );
    return { code: 0 };
  };
  await f.transport.search(
    [s],
    (_s, value) => {
      s.url = value;
    },
    f.ledger,
  );
  assert.equal(s.url, url(second));
  assert.equal(f.ledger.advance(s), null);
});
test("network failure stops fallback and stays a network outcome, not exhaustion", async (t) => {
  const f = fixture(t),
    s = song();
  let calls = 0;
  f.transport.process = async (args, _kind, _timeout, line) => {
    calls++;
    line(document(args.at(-1), []));
    return { code: 1, error: "YouTube rate limit or bot check" };
  };
  const failures = await f.transport.search(
    [s],
    () => assert.fail("not missing"),
    f.ledger,
  );
  assert.equal(calls, 1);
  assert.equal(failures[0].error, "YouTube rate limit or bot check");
  assert.equal(f.diagnostics.read(s.key).outcome, "error");
});
test("Missing requires successful empty results for every variant", async (t) => {
  const f = fixture(t),
    s = song();
  let calls = 0,
    value = "unset";
  f.transport.process = async (args, _kind, _timeout, line) => {
    calls++;
    line(document(args.at(-1), []));
    return { code: 0 };
  };
  assert.deepEqual(
    await f.transport.search(
      [s],
      (_s, v) => {
        value = v;
      },
      f.ledger,
    ),
    [],
  );
  assert.equal(calls, 3);
  assert.equal(value, null);
});
