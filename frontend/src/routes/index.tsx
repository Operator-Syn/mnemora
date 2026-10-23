import { useEffect, useMemo, useState } from 'react'
import type { CSSProperties } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { getRepositoryIndex } from '../lib/mnemora'
import type { Repository } from '../lib/mnemora'

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

function dominantLanguage(repo: Repository): string | null {
  const entries = Object.entries(repo.languages_bytes ?? {})
  if (entries.length === 0) return null
  return entries.sort((a, b) => b[1] - a[1])[0][0]
}

/** Counts a figure up on first paint. Reduced motion lands on the value immediately. */
function useCountUp(target: number, duration = 900): number {
  const [value, setValue] = useState(target)

  useEffect(() => {
    if (typeof window === 'undefined') return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setValue(target)
      return
    }

    let frame = 0
    const start = performance.now()
    const tick = (now: number) => {
      const progress = Math.min(1, (now - start) / duration)
      const eased = 1 - (1 - progress) ** 3
      setValue(Math.round(target * eased))
      if (progress < 1) frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [target, duration])

  return value
}

/** Counts the minutes down locally after the server-rendered value, so the page keeps moving. */
function useCycleCountdown(initialMinutes: number): { minutesLeft: number; progress: number } {
  const [minutesLeft, setMinutesLeft] = useState(initialMinutes)

  useEffect(() => {
    const startedAt = Date.now()
    const update = () => {
      const elapsed = Math.floor((Date.now() - startedAt) / 60000)
      setMinutesLeft(Math.max(0, initialMinutes - elapsed))
    }
    update()
    const timer = window.setInterval(update, 15000)
    return () => window.clearInterval(timer)
  }, [initialMinutes])

  return { minutesLeft, progress: Math.min(1, Math.max(0, (60 - minutesLeft) / 60)) }
}

/**
 * Reveals marked blocks as they enter the viewport. The `motion-ready` class is added by this
 * effect, so a page that never runs JavaScript keeps every element visible.
 */
function useScrollReveal(): void {
  useEffect(() => {
    const root = document.documentElement
    const nodes = Array.from(document.querySelectorAll<HTMLElement>('[data-reveal]'))
    if (nodes.length === 0) return

    if (!('IntersectionObserver' in window)) {
      for (const node of nodes) node.dataset.in = ''
      return
    }

    root.classList.add('motion-ready')
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue
          ;(entry.target as HTMLElement).dataset.in = ''
          observer.unobserve(entry.target)
        }
      },
      { rootMargin: '0px 0px -10% 0px', threshold: 0.12 },
    )
    for (const node of nodes) observer.observe(node)
    return () => {
      observer.disconnect()
      root.classList.remove('motion-ready')
    }
  }, [])
}

/** A newsstand strip: the facts that change, scrolling past. Decorative duplicate of text below. */
function Ticker({ facts }: { facts: string[] }) {
  return (
    <div className="ticker" aria-hidden="true">
      <div className="ticker-track">
        {[0, 1].map((copy) => (
          <span className="ticker-run" key={copy}>
            {facts.map((fact) => (
              <span className="ticker-item" key={fact}>
                {fact}
                <i className="ticker-sep" />
              </span>
            ))}
          </span>
        ))}
      </div>
    </div>
  )
}

function Home() {
  const data = Route.useLoaderData()
  const isEmpty = data.ok && data.repositories.length === 0
  const byCommits = useMemo(
    () => [...data.repositories].sort((a, b) => (b.commit_count ?? 0) - (a.commit_count ?? 0)),
    [data.repositories],
  )
  const mostRecent = byCommits.reduce<Repository | null>(
    (best, repo) =>
      repo.pushed_at_utc && (!best || (best.pushed_at_utc ?? '') < repo.pushed_at_utc) ? repo : best,
    null,
  )

  const [language, setLanguage] = useState<string | null>(null)
  const languages = useMemo(() => {
    const counts = new Map<string, number>()
    for (const repo of byCommits) {
      const name = dominantLanguage(repo)
      if (name) counts.set(name, (counts.get(name) ?? 0) + 1)
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1])
  }, [byCommits])

  const visible = language
    ? byCommits.filter((repo) => dominantLanguage(repo) === language)
    : byCommits

  const repoCount = useCountUp(data.repositories.length)
  const commitCount = useCountUp(data.totalCommits)
  const cycle = useCycleCountdown(data.nextPassInMinutes)
  useScrollReveal()

  // The hero already states the totals, so the strip carries only what the hero does not.
  const tickerFacts = [
    ...data.languages.slice(0, 5).map((entry) => `${entry.name} ${(entry.share * 100).toFixed(0)}%`),
    'collected hourly',
    'postgres → read-only api → cloudflare worker',
  ]

  return (
    <main>
      {data.ok && !isEmpty && <Ticker facts={tickerFacts} />}

      <div className="page-wrap">
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
                <span className="hl" style={{ animationDelay: '40ms' }}>
                  {repoCount}
                </span>{' '}
                repositories,{' '}
                <span className="hl alt" style={{ animationDelay: '150ms' }}>
                  {commitCount.toLocaleString()}
                </span>{' '}
                commits.
              </>
            )}
          </h1>

          <p className="lede">
            Collected from GitHub by an hourly job, stored in Postgres, served by a read-only API.
            Every number here is a row, not an estimate.
          </p>

          {data.ok && !isEmpty && (
            <>
              <div className="status-row">
                <span className="pulse">
                  <i className="dot" /> Collector active
                </span>
                <span className="status-sep" />
                <span>Next pass in {cycle.minutesLeft} min</span>
                <span className="status-sep" />
                <span>
                  {data.repositories.length} repos · {data.languageCount} languages tracked
                </span>
              </div>
              <div className="cycle-label" aria-hidden="true">
                <span>Cycle</span>
                <span>{Math.round(cycle.progress * 100)}% through this hour</span>
              </div>
              <div
                className="cycle"
                role="progressbar"
                aria-label="Progress through the current collection hour"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(cycle.progress * 100)}
              >
                <i style={{ '--progress': cycle.progress } as CSSProperties} />
              </div>
            </>
          )}

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
              <div className="brow" data-reveal>
                <span>01</span> The ledger
              </div>

              <div className="poster-grid" data-reveal>
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
                    <span>Languages tracked</span>
                    <b>{data.languageCount}</b>
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
                  <div className="stack stack-live">
                    {data.languages.map((entry, index) => (
                      <i
                        key={entry.name}
                        style={{
                          width: `${Math.max(entry.share * 100, 0.5)}%`,
                          background: STACK_COLOURS[index % STACK_COLOURS.length],
                          animationDelay: `${index * 90}ms`,
                        }}
                      />
                    ))}
                    {data.otherShare > 0.005 && (
                      <i
                        style={{
                          width: `${data.otherShare * 100}%`,
                          background: STACK_COLOURS[6],
                          animationDelay: '720ms',
                        }}
                      />
                    )}
                  </div>
                  <div className="legend">
                    {data.languages.map((entry, index) => (
                      <span key={entry.name}>
                        <i
                          className="sw"
                          style={{ background: STACK_COLOURS[index % STACK_COLOURS.length] }}
                        />
                        {entry.name} {(entry.share * 100).toFixed(0)}%
                      </span>
                    ))}
                    {data.otherShare > 0.005 && (
                      <span>
                        <i className="sw" style={{ background: STACK_COLOURS[6] }} />
                        Other {(data.otherShare * 100).toFixed(0)}%
                      </span>
                    )}
                  </div>
                  <p className="panel-note">
                    Top eight of {data.languageCount} languages by bytes; the remainder is Other. The
                    chips below count repositories by leading language instead, so they can name more
                    than eight.
                  </p>
                </div>
              </div>

              <div className="brow" data-reveal>
                <span>02</span> Public repositories
              </div>

              <fieldset className="filters">
                <legend className="visually-hidden">Filter repositories by leading language</legend>
                <button
                  type="button"
                  className="chip"
                  data-active={language === null}
                  onClick={() => setLanguage(null)}
                >
                  All <b>{byCommits.length}</b>
                </button>
                {languages.map(([name, count]) => (
                  <button
                    key={name}
                    type="button"
                    className="chip"
                    data-active={language === name}
                    onClick={() => setLanguage(language === name ? null : name)}
                  >
                    {name} <b>{count}</b>
                  </button>
                ))}
              </fieldset>

              <section className="repos">
                <div className="repos-head">
                  <h2>{language ? `${language} repositories` : 'Public repositories'}</h2>
                  <span className="repos-note" aria-live="polite">
                    {visible.length} of {byCommits.length} shown · most commits first
                  </span>
                </div>
                <div className="cards">
                  {visible.map((repo, index) => {
                    const langs = Object.entries(repo.languages_bytes ?? {})
                      .sort((a, b) => b[1] - a[1])
                      .slice(0, 4)
                    const totalBytes = langs.reduce((sum, [, bytes]) => sum + bytes, 0) || 1

                    return (
                      <article
                        key={repo.repository_id}
                        className="card rise"
                        style={{ animationDelay: `${Math.min(index, 11) * 45}ms` }}
                      >
                        <span className="card-tag">{repo.commit_count ?? 0}</span>
                        <h3>
                          <a
                            href={repo.html_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            title={repo.full_name}
                          >
                            {repo.full_name.split('/')[1]}
                          </a>
                        </h3>
                        <p>{repo.description ?? 'No description on GitHub.'}</p>
                        <div className="card-bar">
                          {langs.map(([name, bytes]) => (
                            <i
                              key={name}
                              style={{
                                width: `${(bytes / totalBytes) * 100}%`,
                                background:
                                  STACK_COLOURS[
                                    Math.max(
                                      0,
                                      data.languages.findIndex((entry) => entry.name === name),
                                    ) % STACK_COLOURS.length
                                  ],
                              }}
                            />
                          ))}
                        </div>
                        <div className="card-foot">
                          <span>{formatDate(repo.pushed_at_utc)}</span>
                          <span>{repo.archived ? 'archived' : (dominantLanguage(repo) ?? 'no index')}</span>
                        </div>
                      </article>
                    )
                  })}
                </div>
                {visible.length === 0 && (
                  <p className="repos-empty">
                    No repositories are led by {language} in this index.{' '}
                    <button type="button" className="linkish" onClick={() => setLanguage(null)}>
                      Show all
                    </button>
                  </p>
                )}
              </section>
            </>
          )}
        </section>
      </div>
    </main>
  )
}
