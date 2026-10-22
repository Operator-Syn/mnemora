import { createFileRoute } from '@tanstack/react-router'
import { getRepositoryIndex } from '../lib/mnemora'
import type { RepositoryIndex } from '../lib/mnemora'

export const Route = createFileRoute('/')({
  // Runs in the Worker on every request (and again on client navigations, where the server
  // function is an RPC). The key stays on the server either way.
  loader: () => getRepositoryIndex(),
  component: Home,
})

function formatDate(value: string | null): string {
  if (!value) return 'never'
  const date = new Date(value)
  const minutes = Math.round((Date.now() - date.getTime()) / 60000)
  if (minutes < 60) return `${minutes} min ago`
  if (minutes < 60 * 24) return `${Math.round(minutes / 60)} h ago`
  return date.toISOString().slice(0, 10)
}

function Home() {
  const data = Route.useLoaderData() as RepositoryIndex

  return (
    <main className="page-wrap px-4 pb-8 pt-14">
      <section className="island-shell rise-in relative overflow-hidden rounded-[2rem] px-6 py-10 sm:px-10 sm:py-14">
        <div className="pointer-events-none absolute -left-20 -top-24 h-56 w-56 rounded-full bg-[radial-gradient(circle,rgba(79,184,178,0.32),transparent_66%)]" />
        <p className="island-kicker mb-3">Public repositories</p>
        <h1 className="display-title mb-4 max-w-3xl text-4xl leading-[1.02] font-bold tracking-tight text-[var(--sea-ink)] sm:text-6xl">
          {data.repositories.length} repositories, {data.totalCommits.toLocaleString()} commits.
        </h1>
        <p className="mb-2 max-w-2xl text-base text-[var(--sea-ink-soft)] sm:text-lg">
          Collected from GitHub by an hourly job, stored in Postgres, served by a read-only API.
          Every number here is a row, not an estimate.
        </p>
        <p className="m-0 text-sm text-[var(--sea-ink-soft)]">
          Data refreshed {formatDate(data.refreshedAt)}.
        </p>
        {!data.ok && (
          <p className="mt-4 rounded-xl border border-amber-400/40 bg-amber-400/10 px-4 py-3 text-sm text-amber-900">
            Showing nothing because {data.reason}. Check that the stack is running and that{' '}
            <code>MNEMORA_READ_KEY</code> matches the n8n credential.
          </p>
        )}
      </section>

      {data.languages.length > 0 && (
        <section className="island-shell mt-8 rounded-2xl p-6">
          <p className="island-kicker mb-4">Language mix by bytes</p>
          <ul className="m-0 grid list-none gap-2 p-0 sm:grid-cols-2">
            {data.languages.map((language) => (
              <li key={language.name} className="flex items-center gap-3 text-sm">
                <span className="w-28 shrink-0 text-[var(--sea-ink)]">{language.name}</span>
                <span className="h-2 flex-1 overflow-hidden rounded-full bg-[rgba(23,58,64,0.12)]">
                  <span
                    className="block h-full rounded-full bg-[var(--lagoon-deep)]"
                    style={{ width: `${Math.max(language.share * 100, 1)}%` }}
                  />
                </span>
                <span className="w-12 shrink-0 text-right text-[var(--sea-ink-soft)]">
                  {(language.share * 100).toFixed(0)}%
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="mt-8 grid gap-4 sm:grid-cols-2">
        {data.repositories.map((repo) => (
          <article key={repo.repository_id} className="island-shell feature-card rounded-2xl p-5">
            <h2 className="mb-1 text-base font-semibold text-[var(--sea-ink)]">
              <a
                href={repo.html_url}
                target="_blank"
                rel="noopener noreferrer"
                className="no-underline hover:underline"
              >
                {repo.full_name}
              </a>
            </h2>
            <p className="m-0 mb-3 text-sm text-[var(--sea-ink-soft)]">
              {repo.description ?? 'No description on GitHub.'}
            </p>
            <p className="m-0 text-xs text-[var(--sea-ink-soft)]">
              {repo.commit_count ?? 0} commits · {repo.source_state ?? 'unknown'} · pushed{' '}
              {formatDate(repo.pushed_at_utc)}
              {repo.archived && ' · archived'}
            </p>
          </article>
        ))}
      </section>
    </main>
  )
}
