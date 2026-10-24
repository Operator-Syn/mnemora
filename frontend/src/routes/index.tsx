import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { createFileRoute, Link, useRouter } from '@tanstack/react-router'
import { getRepositoryIndex } from '../lib/mnemora'
import type { Repository } from '../lib/mnemora'
import { markBackgroundRefreshEnd, markBackgroundRefreshStart } from '../components/RoutePendingVeil'

const HOUR_MS = 3_600_000

/** The tail crosses the span the head reached before the sheet leaves. */
const DRAIN_MS = 520
/** The printed sheet wipes out to the right; the head leaves with it. */
const EXIT_MS = 420
/** The next sheet prints in from the left with the stripe already running. */
const ENTER_MS = 520
/** Two registration plates finish at 1.5s; the overlay gets a short 100ms settling tail. */
const STAMP_OVERPRINT_MS = 1_600
const STAMP_OVERPRINT_MIN_DELAY_MS = 8_000
const STAMP_OVERPRINT_MAX_DELAY_MS = 18_000

type CyclePhase = 'run' | 'draining' | 'exiting' | 'entering'

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
  '#8f1d3f',
  '#0f6b5c',
]

/**
 * The neutral swatch is reserved for "Other". It used to double as the seventh ranked colour, so
 * Java and Other rendered in the same pale grey and the tail of the bar read as one unnamed block.
 */
const OTHER_COLOUR = '#c9c2b0'

function languageColour(name: string, ranked: ReadonlyArray<{ name: string }>): string {
  const index = ranked.findIndex((entry) => entry.name === name)
  if (index === -1) return OTHER_COLOUR
  return STACK_COLOURS[index % STACK_COLOURS.length]
}

function agoFrom(value: string | null, now: number): string {
  if (!value) return 'never'
  const date = new Date(value)
  const minutes = Math.round((now - date.getTime()) / 60000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min ago`
  if (minutes < 60 * 24) return `${Math.round(minutes / 60)} h ago`
  return date.toISOString().slice(0, 10)
}

function formatDate(value: string | null): string {
  return agoFrom(value, Date.now())
}

/**
 * Re-renders the age of a timestamp every half minute, so the stamp keeps counting instead of
 * freezing at whatever the server rendered. The first paint uses the same value the server sent,
 * so hydration matches; the clock only starts after mount.
 */
function useTickingAgo(value: string | null): string {
  const [now, setNow] = useState<number | null>(null)

  useEffect(() => {
    setNow(Date.now())
    const timer = window.setInterval(() => setNow(Date.now()), 30000)
    return () => window.clearInterval(timer)
  }, [])

  if (now === null) return formatDate(value)
  return agoFrom(value, now)
}

/** Cards always print a calendar date; relative time is the panel's job. */
function formatIsoDate(value: string | null): string {
  if (!value) return 'never'
  return new Date(value).toISOString().slice(0, 10)
}

function dominantLanguage(repo: Repository): string | null {
  const entries = Object.entries(repo.languages_bytes ?? {})
  if (entries.length === 0) return null
  return entries.sort((a, b) => b[1] - a[1])[0][0]
}

/**
 * A figure that counts up inside a box sized to its final value. Without the fixed box the digits
 * grow the inline element by 150px over the animation, the word after it slides sideways and the
 * line rewraps — once per count, in view, on the largest text on the page.
 */
function Tally({ value, final }: { value: number; final: number }) {
  // The settled text is carried in a data attribute and painted by a hidden pseudo-element, so it
  // reserves the width without existing twice in the DOM: selecting or copying the headline still
  // reads "25 repositories, 7,224 commits."
  return (
    <span className="tally" data-final={final.toLocaleString()}>
      <span className="tally-live">{value.toLocaleString()}</span>
    </span>
  )
}

/** The figures this document has already put on screen, by label. */
const figuresShown = new Map<string, number>()

/**
 * Counts a figure up, but only when the figure moved.
 *
 * A served page arrives with the number already in the HTML, so it must never rewind. The old rule
 * counted on every mount after the first, which meant clicking a nav link and coming back replayed
 * "12 repositories … 20 … 25" over figures the reader had just read — the loudest "this page
 * reloaded" signal on the page, and untrue, because nothing had changed. Now the climb only runs
 * when the new figure differs from the one this document last showed, and it runs from that previous
 * value to the new one, which is the actual change.
 */
function useCountUp(key: string, target: number, duration = 900): number {
  const [value, setValue] = useState(target)

  useEffect(() => {
    if (typeof window === 'undefined') return

    const previous = figuresShown.get(key)
    figuresShown.set(key, target)

    // First sight of this figure in this document, or it has not moved: print it.
    if (previous === undefined || previous === target) {
      setValue(target)
      return
    }
    // The page's motion switch, not the raw media query: a visitor who allowed motion gets the
    // count even if their desktop asks for reduced motion, and one who stopped it never sees it.
    if (document.documentElement.dataset.motion !== 'on') {
      setValue(target)
      return
    }

    let frame = 0
    const start = performance.now()
    const tick = (now: number) => {
      const progress = Math.min(1, (now - start) / duration)
      const eased = 1 - (1 - progress) ** 3
      setValue(Math.round(previous + (target - previous) * eased))
      if (progress < 1) frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [key, target, duration])

  return value
}

/**
 * The collector runs on the UTC hour, so both readings are a function of the wall clock and never of
 * how long this tab has been open.
 *
 * It used to count elapsed time from mount and clamp at zero, which meant a page left alone for an
 * hour ended up parked at "Next pass in 0 min" and "100% through this hour" — permanently, because
 * nothing ever moved the hour on. Mount is not a clock: at the hour boundary the countdown has to
 * return to 60 and the gauge has to start again.
 */
function useCollectorClock(initialMinutes: number): {
  minutesLeft: number
  progress: number
  hour: number | null
  visible: boolean
  phase: CyclePhase
  drainFrom: number
} {
  const [now, setNow] = useState<number | null>(null)
  const [visible, setVisible] = useState(true)
  const [phase, setPhase] = useState<CyclePhase>('run')
  const [drainFrom, setDrainFrom] = useState(1)
  const hourRef = useRef<number | null>(null)
  const lastProgressRef = useRef(1)

  useEffect(() => {
    let timer = 0

    const tick = () => setNow(Date.now())
    const start = () => {
      window.clearInterval(timer)
      tick()
      timer = window.setInterval(tick, 1000)
    }
    const stop = () => {
      window.clearInterval(timer)
      timer = 0
    }
    // A hidden tab throttles or suspends its interval, so it is not left running to drift: it stops,
    // and recomputes from the wall clock the moment the reader comes back.
    const onVisibility = () => {
      const next = document.visibilityState === 'visible'
      setVisible(next)
      if (next) start()
      else stop()
    }

    start()
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      stop()
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [])

  const date = now === null ? null : new Date(now)
  const hour = now === null ? null : Math.floor(now / HOUR_MS)
  const progress =
    date === null
      ? (60 - initialMinutes) / 60
      : (date.getUTCMinutes() * 60_000 +
          date.getUTCSeconds() * 1000 +
          date.getUTCMilliseconds()) /
        HOUR_MS
  const motionOn =
    typeof document !== 'undefined' && document.documentElement.dataset.motion === 'on'
  const hourChanged = hour !== null && hourRef.current !== null && hour !== hourRef.current
  /**
   * The first render of a new hour must already show the old fill at its end: the effect below runs
   * after paint, so without this the bar would put one frame of the new near-zero progress on
   * screen and the head would visibly travel back before the tail catch-up started.
   */
  const canDrain = hourChanged && motionOn && lastProgressRef.current >= 0.9 && progress < 0.02

  /**
   * The hour turning over is the one moment the gauge must not rewind. The fill is already at the
   * right edge, so the tail sweeps up to it, the whole sheet wipes out, and the next sheet prints
   * in from the left. `drainFrom` is the value the head actually reached, not an assumed 100%, so a
   * tab that was hidden through the boundary does not fake a full hour.
   */
  useEffect(() => {
    if (hour === null) return

    if (hourRef.current === null) {
      hourRef.current = hour
      lastProgressRef.current = progress
      return
    }

    if (hour === hourRef.current) {
      if (phase === 'run') lastProgressRef.current = progress
      return
    }

    hourRef.current = hour

    if (!canDrain) {
      lastProgressRef.current = progress
      setPhase('run')
      return
    }

    setDrainFrom(lastProgressRef.current)
    setPhase('draining')
  }, [canDrain, hour, phase, progress])

  useEffect(() => {
    if (phase === 'draining') {
      const timer = window.setTimeout(() => setPhase('exiting'), DRAIN_MS)
      return () => window.clearTimeout(timer)
    }
    if (phase === 'exiting') {
      const timer = window.setTimeout(() => setPhase('entering'), EXIT_MS)
      return () => window.clearTimeout(timer)
    }
    if (phase === 'entering') {
      const timer = window.setTimeout(() => setPhase('run'), ENTER_MS)
      return () => window.clearTimeout(timer)
    }
    return undefined
  }, [phase])

  // Server render and first paint use the snapshot the loader took, so the markup matches it.
  const minutesLeft = date === null ? initialMinutes : 60 - date.getUTCMinutes()
  const visualProgress =
    phase === 'draining' || phase === 'exiting'
      ? drainFrom
      : phase === 'entering' || !canDrain
        ? progress
        : lastProgressRef.current

  return { minutesLeft, progress: visualProgress, hour, visible, phase, drainFrom }
}

/**
 * A route loader is a snapshot: it ran once, for whatever hour this document was requested in, so an
 * untouched tab kept last hour's rows while the stamp aged. When the loaded data belongs to an hour
 * that has ended, ask again.
 *
 * The collector needs a minute or two to write the new hour, so the re-read is tried a handful of
 * times early in the hour and then left alone — a dead collector must not turn an open tab into a
 * poller. The first attempt that comes back with this hour's rows retires the rest.
 */
function useHourlyRefresh(refreshedAt: string | null, hour: number | null, visible: boolean) {
  const router = useRouter()
  const refreshedHour =
    refreshedAt === null ? null : Math.floor(new Date(refreshedAt).getTime() / HOUR_MS)

  useEffect(() => {
    if (refreshedHour === null || hour === null) return
    if (hour <= refreshedHour) return
    if (!visible) return

    const attempts = [0, 60_000, 120_000, 180_000, 240_000]
    const timers = attempts.map((delay) =>
      window.setTimeout(() => {
        markBackgroundRefreshStart()
        void router
          .invalidate()
          .catch(() => undefined)
          .finally(markBackgroundRefreshEnd)
      }, delay),
    )

    return () => {
      for (const timer of timers) window.clearTimeout(timer)
    }
  }, [hour, refreshedHour, router, visible])
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
  /** Which slice of the language mix the pointer is on; drives the cross-highlight. */
  const [focusedLanguage, setFocusedLanguage] = useState<string | null>(null)
  const refreshedAgo = useTickingAgo(data.refreshedAt)
  const stampRef = useRef<HTMLDivElement | null>(null)
  const nextStampOverprintId = useRef(0)
  const [stampInView, setStampInView] = useState(false)
  const [stampOverprintId, setStampOverprintId] = useState<number | null>(null)
  useEffect(() => {
    if (!data.ok) {
      setStampInView(false)
      return
    }
    const stamp = stampRef.current
    if (!stamp) return
    const observer = new IntersectionObserver(([entry]) => {
      setStampInView(entry.isIntersecting)
      if (!entry.isIntersecting) setStampOverprintId(null)
    })
    observer.observe(stamp)
    return () => observer.disconnect()
  }, [data.ok])
  const stampEligible = data.ok && stampInView
  useEffect(() => {
    if (!stampEligible) return
    let timer: number | undefined
    let stopped = false
    const schedule = () => {
      if (stopped || document.visibilityState !== 'visible') return
      const delay =
        STAMP_OVERPRINT_MIN_DELAY_MS +
        Math.random() * (STAMP_OVERPRINT_MAX_DELAY_MS - STAMP_OVERPRINT_MIN_DELAY_MS)
      timer = window.setTimeout(() => {
        timer = undefined
        if (stopped) return
        if (
          document.visibilityState !== 'visible' ||
          document.documentElement.dataset.motion !== 'on'
        ) {
          schedule()
          return
        }
        nextStampOverprintId.current += 1
        setStampOverprintId(nextStampOverprintId.current)
        timer = window.setTimeout(() => {
          setStampOverprintId(null)
          schedule()
        }, STAMP_OVERPRINT_MS)
      }, delay)
    }
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        if (timer !== undefined) window.clearTimeout(timer)
        timer = undefined
        setStampOverprintId(null)
      } else {
        schedule()
      }
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    schedule()
    return () => {
      stopped = true
      document.removeEventListener('visibilitychange', onVisibilityChange)
      if (timer !== undefined) window.clearTimeout(timer)
    }
  }, [stampEligible])
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

  /**
   * The bar has to close. Rounded shares can leave a percent unaccounted for, and an unaccounted
   * percent renders as empty track — which reads as data the page forgot to label. Fold every
   * remainder into Other so the last segment always reaches the right edge.
   */
  const accountedShare =
    data.languages.reduce((sum, entry) => sum + entry.share, 0) + data.otherShare
  const otherTotal = data.otherShare + Math.max(0, 1 - accountedShare)

  const repoCount = useCountUp('repositories', data.repositories.length)
  const commitCount = useCountUp('commits', data.totalCommits)
  const cycle = useCollectorClock(data.nextPassInMinutes)
  useHourlyRefresh(data.refreshedAt, cycle.hour, cycle.visible)

  return (
    <main>
      <div className="page-wrap">
        <section className="poster">
          {data.ok && (
            <div className="stamp" ref={stampRef}>
              Refreshed{' '}
              <time dateTime={data.refreshedAt ?? undefined}>{refreshedAgo}</time>
              {stampOverprintId !== null && (
                <span key={stampOverprintId} className="stamp-overprint" aria-hidden="true" />
              )}
            </div>
          )}

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
                <span className="hl" style={{ animationDelay: '340ms' }}>
                  <Tally value={repoCount} final={data.repositories.length} />
                </span>{' '}
                repositories,{' '}
                <span className="hl alt" style={{ animationDelay: '450ms' }}>
                  <Tally value={commitCount} final={data.totalCommits} />
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
                data-phase={cycle.phase}
                style={
                  {
                    '--progress': cycle.progress,
                    '--drain-from': cycle.drainFrom,
                  } as CSSProperties
                }
                role="progressbar"
                aria-label="Progress through the current collection hour"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(cycle.progress * 100)}
              >
                <i />
                <b aria-hidden="true" />
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
                  <div className="stack stack-live" data-focus={focusedLanguage ? '' : undefined}>
                    <span className="stack-scan" aria-hidden="true" />
                    {data.languages.map((entry, index) => (
                      // biome-ignore lint/a11y/noStaticElementInteractions: pointer-only cross-highlight; the share is written in the legend and in the title.
                      <i
                        key={entry.name}
                        data-on={focusedLanguage === entry.name ? '' : undefined}
                        data-tip={`${entry.name} · ${(entry.share * 100).toFixed(0)}%`}
                        onMouseEnter={() => setFocusedLanguage(entry.name)}
                        onMouseLeave={() => setFocusedLanguage(null)}
                        style={{
                          width: `${entry.share * 100}%`,
                          background: STACK_COLOURS[index % STACK_COLOURS.length],
                        }}
                      />
                    ))}
                    {otherTotal > 0.005 && (
                      // biome-ignore lint/a11y/noStaticElementInteractions: pointer-only cross-highlight; the share is written in the legend and in the title.
                      <i
                        data-on={focusedLanguage === 'Other' ? '' : undefined}
                        data-tip={`Other · ${(otherTotal * 100).toFixed(0)}%`}
                        onMouseEnter={() => setFocusedLanguage('Other')}
                        onMouseLeave={() => setFocusedLanguage(null)}
                        style={{
                          width: `${otherTotal * 100}%`,
                          background: OTHER_COLOUR,
                        }}
                      />
                    )}
                  </div>
                  <div className="legend" data-focus={focusedLanguage ? '' : undefined}>
                    {data.languages.map((entry, index) => (
                      // biome-ignore lint/a11y/noStaticElementInteractions: pointer-only cross-highlight; every number is already written in the row, so nothing is lost without a pointer.
                      <span
                        key={entry.name}
                        data-on={focusedLanguage === entry.name ? '' : undefined}
                        onMouseEnter={() => setFocusedLanguage(entry.name)}
                        onMouseLeave={() => setFocusedLanguage(null)}
                      >
                        <i
                          className="sw"
                          style={{ background: STACK_COLOURS[index % STACK_COLOURS.length] }}
                        />
                        {entry.name} {(entry.share * 100).toFixed(0)}%
                      </span>
                    ))}
                    {otherTotal > 0.005 && (
                      // biome-ignore lint/a11y/noStaticElementInteractions: pointer-only cross-highlight; the row already states the share.
                      <span
                        data-on={focusedLanguage === 'Other' ? '' : undefined}
                        onMouseEnter={() => setFocusedLanguage('Other')}
                        onMouseLeave={() => setFocusedLanguage(null)}
                      >
                        <i className="sw" style={{ background: OTHER_COLOUR }} />
                        Other {(otherTotal * 100).toFixed(0)}%
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
                    const leadingLanguage = langs[0]
                    const languageMixTip = leadingLanguage
                      ? `Top share · ${leadingLanguage[0]} ${Math.round((leadingLanguage[1] / totalBytes) * 100)}%`
                      : 'No indexed language data'
                    const [owner = '', repositoryName = repo.full_name] = repo.full_name.split('/')

                    return (
                      <article
                        key={`${language ?? 'all'}:${repo.repository_id}`}
                        className="card rise"
                        style={{
                          animationDelay: `${300 + Math.min(index, 11) * 45}ms`,
                          '--card-wave-delay': `${index * 150}ms`,
                          '--card-register-phase': `${-((index % 9) * 600)}ms`,
                          '--card-tab-phase': `${-((index % 9) * 300)}ms`,
                          '--card-reprint-phase': `${-((index % 7) * 240)}ms`,
                        } as CSSProperties}
                      >
                        <svg className="card-register" aria-hidden="true" viewBox="0 0 100 100" preserveAspectRatio="none">
                          <path d="M0 7V0H4 M96 0H100V7 M100 93V100H96 M4 100H0V93" />
                        </svg>
                        <h3>
                          <a
                            className="card-title-link"
                            href={repo.html_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            aria-label={`Open ${repo.full_name} on GitHub`}
                          >
                            <span className="card-title-wrap">
                              <span className="card-title">{repositoryName}</span>
                            </span>
                            <svg className="card-link-mark" aria-hidden="true" viewBox="0 0 16 16" fill="none">
                              <path d="M9 2h5v5M14 2 7 9" />
                              <path d="M12 9v4H2V3h4" />
                            </svg>
                          </a>
                        </h3>
                        <Link
                          className="card-detail-link"
                          to="/repositories/$owner/$repo"
                          params={{ owner, repo: repositoryName }}
                          aria-label={`View ${repo.full_name} project details and recent commits`}
                        >
                          <span className="card-tag" data-tip={`${repo.commit_count ?? 0} commits`}>
                            {repo.commit_count ?? 0}
                          </span>
                          <p>{repo.description ?? 'No description on GitHub.'}</p>
                          <div className="card-bar" data-tip={languageMixTip}>
                            {langs.map(([name, bytes]) => (
                              <i
                                key={name}
                                data-tip={`${name} · ${Math.round((bytes / totalBytes) * 100)}%`}
                                style={{
                                  width: `${(bytes / totalBytes) * 100}%`,
                                  background: languageColour(name, data.languages),
                                }}
                              />
                            ))}
                          </div>
                          <div className="card-foot">
                            <span>{formatIsoDate(repo.pushed_at_utc)}</span>
                            <span>{repo.archived ? 'archived' : (dominantLanguage(repo) ?? 'no index')}</span>
                          </div>
                        </Link>
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
