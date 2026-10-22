// Configuration for the whole run.
const env = (k, dflt) => (typeof $env !== 'undefined' && $env[k] !== undefined && $env[k] !== '' ? $env[k] : dflt);
const flag = (k, dflt) => {
  const v = env(k, null);
  if (v === null) return dflt;
  return /^(1|true|yes|on)$/i.test(String(v));
};

const owners = String(env('COLLECT_010_OWNERS', 'Operator-Syn'))
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
if (!owners.length) throw new Error('COLLECT_010_OWNERS is empty');

// 0 means the whole history of every repository: no `since` is sent and the commit
// endpoint is paginated to its end. A positive value keeps a rolling window.
const windowDays = Number(env('COLLECT_010_WINDOW_DAYS', 0));
const maxCommitPages = Number(env('COLLECT_010_MAX_COMMIT_PAGES', 50));
// Force a full re-fetch of every repository, ignoring the cached copy. Use after
// changing what is collected, or to rebuild a cache you do not trust.
const forceFull = flag('COLLECT_010_FORCE_FULL_RESYNC', false);
// Stop collecting when this few API calls remain, so a run never dies mid-way with
// every remaining repository erroring. Cached data is preserved for the rest.
const rateReserve = Number(env('COLLECT_010_RATE_RESERVE', 25));
// Cold start: how many repositories a single run may collect for the first time. A first run
// against an empty database would otherwise fetch all of them in one burst — ~95 calls and four
// minutes here, more on an account with more history, and any interruption leaves no record of
// what is still outstanding.
const maxNewPerRun = Number(env('COLLECT_010_MAX_NEW_PER_RUN', 12));
// Ceiling on commit pages for the whole run, not per repository: it bounds how long one execution
// can take, so a timeout cannot swallow a long crawl. Leftovers resume from their cursors.
const maxPagesPerRun = Number(env('COLLECT_010_MAX_PAGES_PER_RUN', 50));
// Presence only: this node decides whether the run is authenticated, it never handles the value.
// The token itself is read by the Collect node at request time. Copying it into this node's output
// would put it in every downstream item — and n8n persists failed executions, headers included.
const hasToken = env('COLLECT_010_GITHUB_TOKEN', '') !== '';


const now = new Date();
const until = now.toISOString();
const since =
  windowDays > 0 ? new Date(now.getTime() - windowDays * 24 * 3600 * 1000).toISOString() : null;

return [
  {
    json: {
      owners,
      since,
      until,
      history: since ? `last ${windowDays} days` : 'full history',
      maxCommitPages,
      forceFull,
      rateReserve,
  maxNewPerRun,
      github_token_present: hasToken,
      includeForks: flag('COLLECT_010_INCLUDE_FORKS', true),
      includeArchived: flag('COLLECT_010_INCLUDE_ARCHIVED', true),
      maxPagesPerRun,
    },
  },
];
