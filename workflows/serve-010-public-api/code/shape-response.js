// One place decides what a client sees: the status code, the response envelope, and whether the
// answer may be cached.
//
// Every SQL branch returns the same three columns — route, status, data — so this node is the only
// place that knows about HTTP. Keeping the envelope out of the SQL files means a change to how
// errors look is one file, and every route gets it at once.
//
// A branch that produced its own error envelope (a 400 naming which argument was wrong) is passed
// through untouched: the SQL knows the reason, and replacing it with a generic sentence would throw
// away the only part a caller can act on.
const item = $input.first().json ?? {};
const status = Number(item.status) || 200;
const route = item.route || 'unknown';
const data = item.data ?? null;

const sqlAlreadyExplained = data && typeof data === 'object' && typeof data.error === 'string';

const body =
  status >= 400
    ? sqlAlreadyExplained
      ? data
      : {
          error: status === 404 ? 'not_found' : 'bad_request',
          route,
          reason:
            status === 404
              ? 'no public repository at that address'
              : 'the request could not be served',
        }
    : data;

// The data behind this API moves once an hour — the collector's schedule — so a short shared cache
// is honest and takes load off an instance where every request is an execution. Errors are never
// cached: a 404 today may be a repository tomorrow.
return [
  {
    json: {
      responseCode: status,
      body,
      headers: {
        'Cache-Control': status === 200 ? 'public, max-age=60, stale-while-revalidate=300' : 'no-store',
        'Content-Type': 'application/json; charset=utf-8',
      },
      route,
    },
  },
];
