import { createFileRoute } from '@tanstack/react-router'
import { getRepositoryIndex } from '../lib/mnemora'
import type { RepositoryIndex } from '../lib/mnemora'

export const Route = createFileRoute('/about')({
  // Same server function as the home page: the numbers here are read, not typed.
  loader: () => getRepositoryIndex(),
  component: About,
})

const CONTACT = [
  { label: 'Email', href: 'mailto:johnronanbeira100404@gmail.com' },
  { label: 'GitHub', href: 'https://github.com/Operator-Syn' },
  { label: 'LinkedIn', href: 'https://www.linkedin.com/in/one-young-blue-existing-entity/' },
]

const STEPS = [
  {
    title: 'Collect',
    body: 'An n8n queue-worker calls the public GitHub API hourly, once per repository. A repository whose last push has not changed is skipped rather than re-fetched, and a run lock makes a second tick stand down instead of duplicating work.',
  },
  {
    title: 'Store',
    body: 'Postgres keeps repositories, commits and one row per run. Commits are keyed by SHA, so re-crawling the same history adds nothing twice. Every figure on the home page is a COUNT over those rows.',
  },
  {
    title: 'Serve',
    body: 'A read-only database role answers four GET routes: repository index, one repository, commit feed, activity histogram. They sit behind nginx, which checks the key, caches responses for 60 seconds and rate-limits the edge. Readers cannot reach the write path.',
  },
  {
    title: 'Render',
    body: 'This page is server-rendered by TanStack Start inside a Cloudflare Worker. The Worker holds the read key and calls the API server-to-server, so the key never reaches the browser bundle.',
  },
]

const LIMITS = [
  'Commit counts come from the GitHub API for each default branch — merges and bot commits are included. They are not "authored contributions".',
  'Public repositories only. Private work is not counted, summarised or implied.',
  'The collector runs hourly, so this data can legitimately be up to an hour old. The stamp on the home page says when it last ran.',
  'There are no testimonials, client logos or benchmarks on this site, because none exist.',
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

function About() {
  const data = Route.useLoaderData() as RepositoryIndex
  const hasNumbers = data.ok && data.repositories.length > 0

  return (
    <main className="page-wrap">
      <section className="poster">
        <h1>
          How this <span className="hl">page</span> is built.
        </h1>

        <p className="lede">
          This is not a static portfolio. An hourly job collects public repository data from GitHub,
          stores it in Postgres, and serves it through a read-only API to the page you are reading.
          The numbers on the other page are rows in that database.
        </p>

        <div className="brow">
          <span>01</span> What is in the store
        </div>

        <div className="about-top">
          {hasNumbers && (
            <div className="panel about-counts">
              <h2>What is in the store right now</h2>
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
                <b>{data.languages.length}</b>
              </div>
              <div className="kv">
                <span>Last successful run</span>
                <b>{formatDate(data.refreshedAt)}</b>
              </div>
            </div>
          )}

          <div className="panel who">
            <h2>Who runs it</h2>
            <p className="who-line">
              <strong>John-Ronan S. Beira</strong> — BS Computer Science, fourth year. Building with
              intent.
            </p>
            <p className="who-line">
              The rest of the portfolio — projects, certificates, archive — lives at{' '}
              <a href="https://syn-forge.com/" target="_blank" rel="noreferrer">
                syn-forge.com
              </a>
              .
            </p>
            <div className="contact-row">
              {CONTACT.map((item) => (
                <a
                  key={item.label}
                  href={item.href}
                  className="contact-link"
                  {...(item.href.startsWith('mailto:')
                    ? {}
                    : { target: '_blank', rel: 'noreferrer' })}
                >
                  {item.label}
                </a>
              ))}
            </div>
          </div>
        </div>

        <div className="brow">
          <span>02</span> The pipeline
        </div>

        <div className="pipeline-rail" aria-hidden="true">
          Collect <i /> Store <i /> Serve <i /> Render
        </div>

        <section className="steps" aria-label="The pipeline">
          {STEPS.map((step, index) => (
            <article className="step" key={step.title}>
              <span className="step-num">{String(index + 1).padStart(2, '0')}</span>
              <h2>{step.title}</h2>
              <p>{step.body}</p>
            </article>
          ))}
        </section>

        <div className="brow">
          <span>03</span> Limits
        </div>

        <div className="panel limits">
          <h2>What it will not claim</h2>
          <ul>
            {LIMITS.map((limit) => (
              <li key={limit}>{limit}</li>
            ))}
          </ul>
        </div>
      </section>
    </main>
  )
}
