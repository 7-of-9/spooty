import { parseArgs } from 'node:util';

// One registry drives parsing, validation, help and the documented option table.
// Reject options on commands that do not consume them: a silent no-op is unsafe.
export const commands = {
  doctor: 'Check local prerequisites; no network, queue or library writes.',
  plan: 'Preview the exact resume decision using saved metadata, journal and files (default).',
  run: 'Acquire missing audio, with exclusive YouTube ownership and durable checkpoints.',
  status: 'Show the latest snapshot and verify whether its owner is still running.',
  benchmark: 'Report measured output and complete fixed-profile windows.',
  pace: 'Request a pace change from the verified live CLI owner.',
  stop: 'Stop new admissions and drain the verified live CLI owner.',
  'inspect-review': 'Ask the live owner to inspect unresolved saved-source reviews.',
  'review-work': 'Ask the live owner to load explicit review-work.json actions.',
};

const run = ['run'];
const pace = ['run', 'pace'];
export const optionDefinitions = {
  takeover: { type: 'boolean', commands: run, description: 'Pause new web admissions, drain active jobs, then acquire ownership; preserve queued jobs.' },
  limit: { type: 'string', commands: run, default: '0', min: 0, max: 1000000, description: 'Maximum NEW MP3s (successful searches with --search-only); 0 means unlimited. Local reuse is excluded.' },
  minutes: { type: 'string', commands: run, default: '0', min: 0, max: 1000000, description: 'Stop admissions after N whole minutes of acquisition, then drain; 0 means unlimited.' },
  'download-conc': { type: 'string', commands: pace, min: 1, max: 12, description: 'Concurrent download batches. Omitted: inherit persisted pace.' },
  'search-conc': { type: 'string', commands: pace, min: 1, max: 6, description: 'Concurrent search batches. Omitted: inherit persisted pace.' },
  window: { type: 'string', commands: pace, min: 8, max: 240, description: 'Download/video admissions per TEN MINUTES, not per second. Omitted: inherit persisted pace.' },
  'batch-size': { type: 'string', commands: run, default: '8', min: 1, max: 8, description: 'Maximum tracks per yt-dlp process.' },
  'search-buffer': { type: 'string', commands: run, default: '192', min: 1, max: 1000000, description: 'Pause fresh searches when this many validated candidates await download; in-flight batches may finish.' },
  'max-searches': { type: 'string', commands: ['run', 'plan'], default: '10', min: 1, max: 50, description: 'Ranked results per query; up to 3 automatic query variants. Not network retries. Larger depth reopens exhausted selection.' },
  'network-retries': { type: 'string', commands: run, default: '5', min: 0, max: 20, description: 'Additional workflow attempts after network failure; candidate disqualifications consume none.' },
  'search-only': { type: 'boolean', commands: run, description: 'Save selected URLs without downloading audio. Does not combine with review actions.' },
  'retry-errors': { type: 'boolean', commands: ['run', 'plan'], description: 'Reopen exhausted network/operation failures; NOT Missing or same-depth no-candidate outcomes.' },
  'inspect-review': { type: 'boolean', commands: run, description: 'Also inspect unresolved saved-source reviews through this owner; no extra MP3s.' },
  'review-work': { type: 'boolean', commands: run, description: 'Also load catalog-scoped actions from ACQUIRE_STATE_PATH/review-work.json.' },
  authenticated: { type: 'boolean', commands: ['run', 'doctor'], description: 'Start with private copies of the existing cookies export; never prints session contents.' },
  'pot-recovery': { type: 'boolean', commands: ['run', 'doctor'], description: 'Enable the pinned loopback POT provider for authenticated downloads (including automatic post-block recovery).' },
  help: { type: 'boolean', short: 'h', description: 'Show global help or help for the selected command.' },
  version: { type: 'boolean', short: 'v', description: 'Print the package version and exit.' },
};

export class UsageError extends Error {
  constructor(message) { super(message); this.exitCode = 2; }
}

export function parseCommandLine(args) {
  let parsed;
  try {
    parsed = parseArgs({ args, allowPositionals: true, tokens: true,
      options: Object.fromEntries(Object.entries(optionDefinitions).map(([name, rule]) =>
        [name, { type: rule.type, ...(rule.short ? { short: rule.short } : {}) }])) });
  } catch (error) { throw new UsageError(error.message); }
  const { positionals, values, tokens } = parsed;
  if (positionals.length > 1) throw new UsageError('Expected one command, not additional positional arguments. Use --help.');
  const command = positionals[0] || 'plan';
  if (!commands[command]) throw new UsageError(`Unknown command "${command}". Use --help.`);
  const supplied = new Set();
  for (const token of tokens.filter(token => token.kind === 'option')) {
    if (supplied.has(token.name)) throw new UsageError(`--${token.name} was supplied more than once.`);
    supplied.add(token.name);
    const rule = optionDefinitions[token.name];
    if (rule.commands && !rule.commands.includes(command)) throw new UsageError(`--${token.name} is not used by ${command}; supported commands: ${rule.commands.join(', ')}.`);
    if (rule.min !== undefined && (!/^\d+$/.test(String(token.value)) ||
      !Number.isSafeInteger(Number(token.value)) || Number(token.value) < rule.min || Number(token.value) > rule.max)) {
      throw new UsageError(`Invalid --${token.name}; use a whole number from ${rule.min} to ${rule.max}.`);
    }
  }
  if (values.version && (positionals.length || supplied.size > 1)) throw new UsageError('Use --version on its own.');
  if (command === 'pace' && !values.help && !['download-conc', 'search-conc', 'window'].some(name => supplied.has(name))) {
    throw new UsageError('pace needs --download-conc, --search-conc or --window; use status to read current pace.');
  }
  if (values['search-only'] && (values['inspect-review'] || values['review-work'])) throw new UsageError('--search-only cannot combine with review actions that may inspect or download media.');
  if (values['search-only'] && values['pot-recovery']) throw new UsageError('--pot-recovery configures downloads and is not used with --search-only.');
  const options = Object.fromEntries(Object.entries(optionDefinitions)
    .filter(([, rule]) => !rule.commands || rule.commands.includes(command))
    .filter(([, rule]) => rule.default !== undefined || rule.type === 'boolean')
    .map(([name, rule]) => [name, rule.default ?? false]));
  return { command, options: { ...options, ...values }, supplied, explicitCommand: positionals.length > 0 };
}

export function helpText(command) {
  const selected = command && commands[command] ? command : null;
  const lines = ['Spooty — CLI and website, one acquisition stack (Node 20.19.4)',
    'Usage: spooty [command] [options]   |   npm run acquire -- [command] [options]', ''];
  if (selected) lines.push(`${selected}: ${commands[selected]}`);
  else lines.push('Commands (no command defaults to the read-only plan):', ...Object.entries(commands).map(([name, description]) => `  ${name.padEnd(15)} ${description}`));
  lines.push('', selected ? 'Options:' : 'Options (accepted commands in brackets):');
  for (const [name, rule] of Object.entries(optionDefinitions)) {
    if (selected && rule.commands && !rule.commands.includes(selected)) continue;
    if (selected && name === 'version') continue;
    const bounds = rule.min === undefined ? '' : ` ${rule.min}..${rule.max}`;
    const fallback = rule.default === undefined ? '' : `; default ${rule.default}`;
    lines.push(`  --${name}${rule.short ? `, -${rule.short}` : ''}${bounds}${fallback}${!selected && rule.commands ? ` [${rule.commands.join(', ')}]` : ''}`,
      `      ${rule.description}`);
  }
  lines.push('', 'Examples:', '  npm run acquire -- doctor', '  npm run acquire -- plan',
    '  npm run acquire -- run --limit 8', '  npm run acquire -- run --takeover --authenticated --pot-recovery',
    '  npm run acquire -- status', '', 'Saved files and same-depth exhausted searches are fast-skipped. No agent is in the per-track path.',
    'A genuine YouTube block immediately stops owned processes and preserves the safety floor/cooldown.',
    'Full command, environment and pipeline reference: scripts/acquire/README.md');
  return lines.join('\n');
}
