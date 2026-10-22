import { createFileRoute } from '@tanstack/react-router'
import { getRepositoryIndex } from '../lib/mnemora'
import type { Repository, RepositoryIndex } from '../lib/mnemora'

export const Route = createFileRoute('/')({
  // Runs in the Worker on every request (and again on client navigations, where the server
  // function is an RPC). The key stays on the server either way.
  loader: () => getRepositoryIndex(),
  component: Home,
})

/**
 * Bar fills, in ranked order. The first four are tokens so they invert with the theme; a hard
 * #12100e swatch vanished against the dark panel. The rest are mid-tone hues that hold up on
 * both papers.
 */
const STACK_COLOURS = [
  'var(--tomato)',
  'var(--cobalt)',
  'var(--sun)',
  'var(--ink)',
  '#7a8b00',
  '#8a5cff',
  '#c9c2b0',
  '#0f6b5c',
]

function formatDate(value: string | null): string {
  if (!value) return 'never'
  const date = new Date(value)
  const minutes = Math.round((Date.now() - date.getTime()) / 60000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min ago`
  if (minutes < 60 * 24) return `${Math.round(minutes / 60)} h ago`
  return date.toISOString().slice(0, 10)
}

function topLanguage(repo: Repository): string {
  const entries = Object.entries(repo.languages_bytes ?? {})
  if (entries.length === 0) return 'no languages indexed'
  return entries.sort((a, b) => b[1] - a[1])[0][0]
}

function Home() {
  const data = Route.useLoaderData() as RepositoryIndex
  const isEmpty = data.ok && data.repositories.length === 0
  const byCommits = [...data.repositories].sort((a, b) => (b.commit_count ?? 0) - (a.commit_count ?? 0))
  const mostRecent = byCommits.reduce<Repository | null>(
    (best, repo) =>
      repo.pushed_at_utc && (!best || (best.pushed_at_utc ?? '') < repo.pushed_at_utc) ? repo : best,
    null,
  )

  return (
    <main className="page-wrap">
      <section className="poster">
        {data.ok && <div className="stamp">Refreshed {formatDate(data.refreshedAt)}</div>}

        <h1>
          {!data.ok && (
            <>
              <span className="hl">Repository</span> data is unavailable.
            </>
          )}
          {isEmpty && (
            <>
              <span className="hl">No</span> public repositories yet.
            </>
          )}
          {data.ok && !isEmpty && (
            <>
              <span className="hl">{data.repositories.length}</span> repositories,{' '}
              <span className="hl alt">{data.totalCommits.toLocaleString()}</span> commits.
            </>
          )}
        </h1>

        <p className="lede">
          Collected from GitHub by an hourly job, stored in Postgres, served by a read-only API.
          Every number here is a row, not an estimate.
        </p>

        {!data.ok && (
          <div className="state" role="status">
            <p>The feed isn&rsquo;t answering this minute.</p>
            <p>
              The collector runs hourly on its own, so this fills in without anyone touching it.
              Reload in a minute or two.
            </p>
            {import.meta.env.DEV && (
              <p className="diag">
                dev only &middot; {data.kind ?? 'unknown'} &middot; {data.reason}
              </p>
            )}
          </div>
        )}

        {isEmpty && (
          <div className="state">
            <p>The collector runs hourly.</p>
            <p>The first pass that finds public repositories will fill this in.</p>
          </div>
        )}

        {data.ok && !isEmpty && (
          <>
            <div className="poster-grid">
              <div className="panel">
                <h2>By the numbers</h2>
                <div className="kv">
                  <span>Public repositories</span>
                  <b>{data.repositories.length}</b>
                </div>
                <div className="kv">
                  <span>Commits recorded</span>
                  <b>{data.totalCommits.toLocaleString()}</b>
                </div>
                <div className="kv">
                  <span>Languages</span>
                  <b>{data.languages.length}</b>
                </div>
                <div className="kv">
                  <span>Last refresh</span>
                  <b>{formatDate(data.refreshedAt)}</b>
                </div>
                <div className="kv">
                  <span>Most recent push</span>
                  <b>
                    {mostRecent
                      ? `${mostRecent.full_name.split('/')[1]} · ${formatDate(mostRecent.pushed_at_utc)}`
                      : '—'}
                  </b>
                </div>
              </div>

              <div className="panel">
                <h2>Language mix / bytes</h2>
                <div className="stack">
                  {data.languages.map((language, index) => (
                    <i
                      key={language.name}
                      style={{
                        width: `${Math.max(language.share * 100, 0.5)}%`,
                        background: STACK_COLOURS[index % STACK_COLOURS.length],
                      }}
                    />
                  ))}
                </div>
                <div className="legend">
                  {data.languages.map((language, index) => (
                    <span key={language.name}>
                      <i
                        className="sw"
                        style={{ background: STACK_COLOURS[index % STACK_COLOURS.length] }}
                      />
                      {language.name} {(language.share * 100).toFixed(0)}%
                    </span>
                  ))}
                </div>
              </div>
            </div>

            <section className="repos">
              <div className="repos-head">
                <h2>Public repositories</h2>
                <span className="repos-note">{byCommits.length} shown · most commits first</span>
              </div>
              <div className="cards">
                {byCommits.map((repo) => (
                  <article key={repo.repository_id} className="card">
                    <span className="card-tag">{repo.commit_count ?? 0}</span>
                    <h3>
                      <a href={repo.html_url} target="_blank" rel="noopener noreferrer">
                        {repo.full_name.split('/')[1]}
                      </a>
                    </h3>
                    <p>{repo.description ?? 'No description on GitHub.'}</p>
                    <div className="card-foot">
                      <span>{formatDate(repo.pushed_at_utc)}</span>
                      <span>{repo.archived ? 'archived' : topLanguage(repo)}</span>
                    </div>
                  </article>
                ))}
              </div>
            </section>
          </>
        )}
      </section>
    </main>
  )
}
