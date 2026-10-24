import { useRef, useState } from 'react'
import { createFileRoute, Link, notFound } from '@tanstack/react-router'
import { useServerFn } from '@tanstack/react-start'
import {
  FeedRetryButton,
  FeedSignalMark,
  feedFailureCopy,
  normalizeFeedFailureKind,
} from '../components/FeedFailure'
import {
  COMMIT_PAGE_SIZE,
  getRepositoryCommitPage,
  getRepositoryDetails,
} from '../lib/mnemora'
import type { Commit, CommitPage, ReadApiFailure, Repository } from '../lib/mnemora'

const REPOSITORY_NAME_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/

export const Route = createFileRoute('/repositories/$owner/$repo')({
  loader: async ({ params }) => {
    const fullName = `${params.owner}/${params.repo}`
    if (!REPOSITORY_NAME_PATTERN.test(fullName)) throw notFound()

    const repositoryResult = await getRepositoryDetails({ data: { fullName } })
    if (!repositoryResult.ok) {
      if (repositoryResult.kind === 'not-found') throw notFound()
      return { ok: false as const, kind: repositoryResult.kind }
    }

    const commitPageResult = await getRepositoryCommitPage({ data: { fullName } })
    if (!commitPageResult.ok) {
      return {
        ok: false as const,
        kind: normalizeFeedFailureKind(commitPageResult.kind),
      }
    }

    return {
      ok: true as const,
      repository: repositoryResult.data,
      initialPage: commitPageResult.data,
    }
  },
  component: RepositoryDetail,
  notFoundComponent: RepositoryNotFound,
  errorComponent: () => <ProjectLoadError kind="api" />,
})

function RepositoryDetail() {
  const data = Route.useLoaderData()
  if (!data.ok) return <ProjectLoadError kind={data.kind} />
  return <LoadedRepository repository={data.repository} initialPage={data.initialPage} />
}

function LoadedRepository({ repository, initialPage }: { repository: Repository; initialPage: CommitPage }) {
  const [owner = '', ...repositoryParts] = repository.full_name.split('/')
  const repositoryName = repositoryParts.join('/') || repository.full_name

  return (
    <main className="page-wrap repo-page">
      <Link to="/" className="repo-back">
        All repositories
      </Link>
      <header className="repo-heading">
        <h1 className="repo-title" data-long-name={repositoryName.length > 35 ? 'true' : undefined}>
          {owner && <span className="repo-title-owner">{owner}/</span>}
          <span className="repo-title-name">{repositoryName}</span>
        </h1>
        <p className="repo-description">
          {repository.description ?? 'No description on GitHub.'}
        </p>
        <p className="repo-history-status">
          {repository.commit_count !== null &&
            `${repository.commit_count.toLocaleString('en-US')} commits indexed · `}
          {collectionMessage(repository.source_state)}
        </p>
        {repository.default_branch && (
          <p className="repo-branch">Commit history from the {repository.default_branch} branch.</p>
        )}
      </header>

      <section className="commit-section" aria-labelledby="commit-heading">
        <div className="commit-heading">
          <h2 id="commit-heading">Recent commits</h2>
          <p>Newest first · {COMMIT_PAGE_SIZE} per load</p>
        </div>
        <CommitHistory
          key={repository.repository_id}
          fullName={repository.full_name}
          repository={repository}
          initialPage={initialPage}
        />
      </section>
    </main>
  )
}

function collectionMessage(state: string | null): string {
  if (state === 'complete') return 'History collection is complete.'
  if (state === 'partial' || state === 'pending') {
    return 'History collection is incomplete; older commits may not be indexed yet.'
  }
  if (state === 'stale' || state === 'error') {
    return 'The latest collection is not current; this page shows the stored commits.'
  }
  if (state === 'empty') return 'No commits are currently indexed.'
  return 'Collection status is unknown; this page shows the stored commits.'
}

function ProjectLoadError({ kind }: { kind: ReadApiFailure }) {
  const copy = feedFailureCopy(normalizeFeedFailureKind(kind))

  return (
    <main className="page-wrap repo-page">
      <section className="repo-state repo-state--unavailable" role="status" aria-live="polite">
        <div className="feed-offline-stamp" aria-hidden="true">
          <span>FEED</span>
          <span>UNAVAILABLE</span>
        </div>
        <h1>Project unavailable</h1>
        <div className="feed-offline-copy">
          <p className="feed-offline-code">{copy.code}</p>
          <p>{copy.summary} {copy.detail}</p>
        </div>
        <div className="repo-state-actions">
          <FeedRetryButton />
          <Link to="/" className="repo-back">
            All repositories
          </Link>
        </div>
      </section>
    </main>
  )
}

function RepositoryNotFound() {
  return (
    <main className="page-wrap repo-page">
      <section className="repo-state">
        <h1>Repository not found</h1>
        <p>This public repository is not available in the index.</p>
        <Link to="/" className="repo-back">
          All repositories
        </Link>
      </section>
    </main>
  )
}

function CommitHistory({
  fullName,
  repository,
  initialPage,
}: {
  fullName: string
  repository: Repository
  initialPage: CommitPage
}) {
  const fetchPage = useServerFn(getRepositoryCommitPage)
  const [commits, setCommits] = useState(initialPage.commits)
  const [nextBeforeMs, setNextBeforeMs] = useState(
    initialPage.returned === COMMIT_PAGE_SIZE ? initialPage.next_before_ms : null,
  )
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState(false)
  const loadingRef = useRef(false)
  const indexedCount = repository.commit_count ?? Number.POSITIVE_INFINITY
  const hasMore = nextBeforeMs !== null && commits.length < indexedCount
  const nextStart = commits.length + 1
  const nextEnd = Math.min(commits.length + COMMIT_PAGE_SIZE, indexedCount)

  async function loadOlderCommits() {
    if (loadingRef.current || nextBeforeMs === null || !hasMore) return
    loadingRef.current = true
    setLoading(true)
    setLoadError(false)

    try {
      const result = await fetchPage({ data: { fullName, beforeMs: nextBeforeMs } })
      if (!result.ok) {
        setLoadError(true)
        return
      }
      setCommits((current) => [...current, ...result.data.commits])
      setNextBeforeMs(
        result.data.returned === COMMIT_PAGE_SIZE ? result.data.next_before_ms : null,
      )
    } catch {
      setLoadError(true)
    } finally {
      loadingRef.current = false
      setLoading(false)
    }
  }

  if (commits.length === 0) {
    return <p className="commit-empty">No commits are currently available in the index.</p>
  }

  return (
    <>
      <p className="commit-progress" aria-live="polite">
        {commits.length.toLocaleString('en-US')} commits shown
      </p>
      <ol className="commit-list" id="project-commit-list" aria-busy={loading}>
        {commits.map((commit) => (
          <CommitEntry key={commit.sha} commit={commit} />
        ))}
      </ol>
      {loadError && (
        <div className="commit-load-error" role="alert">
          <FeedSignalMark />
          <p>Older commits could not be loaded. The rows shown above are unchanged.</p>
        </div>
      )}
      {hasMore ? (
        <div className="commit-pagination">
          <button
            type="button"
            className="commit-load-button"
            aria-controls="project-commit-list"
            disabled={loading}
            onClick={loadOlderCommits}
          >
            {loading
              ? 'Loading older commits…'
              : `${loadError ? 'Retry' : 'Load'} commits ${nextStart}–${nextEnd}`}
          </button>
        </div>
      ) : (
        <p className="commit-end">
          {repository.source_state === 'complete'
            ? 'End of indexed history.'
            : 'No older commits are currently available in the index.'}
        </p>
      )}
    </>
  )
}

function CommitEntry({ commit }: { commit: Commit }) {
  const message = commit.message ?? ''
  const [subjectLine = '', ...bodyLines] = message.split(/\r?\n/)
  const body = bodyLines.join('\n').trim()
  const subject = subjectLine.trim() || 'No commit message provided.'
  const author = commit.author_login?.trim()
    ? `@${commit.author_login}`
    : commit.author_name?.trim() || 'Unknown author'
  const timestamp = commit.committed_at_utc ?? commit.authored_at_utc

  return (
    <li className="commit-row">
      <div className="commit-copy">
        <p className="commit-subject">{subject}</p>
        {body && (
          <details className="commit-message-details">
            <summary>Full commit message</summary>
            <pre>{body}</pre>
          </details>
        )}
      </div>
      <div className="commit-meta">
        <span>{author}</span>
        {timestamp ? (
          <time dateTime={timestamp}>{formatUtc(timestamp)}</time>
        ) : (
          <span>Date unavailable</span>
        )}
        <a
          className="commit-sha"
          href={commit.html_url}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`Open commit ${commit.sha} on GitHub`}
        >
          {commit.sha.slice(0, 7)}
          <svg aria-hidden="true" viewBox="0 0 16 16" fill="none">
            <path d="M9 2h5v5M14 2 7 9" />
            <path d="M12 9v4H2V3h4" />
          </svg>
        </a>
      </div>
    </li>
  )
}

function formatUtc(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Date unavailable'
  const iso = date.toISOString()
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`
}
