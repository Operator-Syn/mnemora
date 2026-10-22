import { createServerFn } from '@tanstack/react-start'

/**
 * The read API lives in the n8n stack (`workflows/serve-010-public-api`).
 *
 * These calls must stay on the SERVER. The API key is a secret held by the Worker's runtime —
 * in `.dev.vars` locally, `wrangler secret put` in production — and it must never reach the
 * browser bundle. A `createServerFn` handler runs in the Worker, so the key is used where it is
 * available and the response is all that ships to the client.
 *
 * That is also why CORS never enters the picture here: this is server-to-server, not a browser
 * request, and the API's permissive CORS setting is irrelevant to it.
 */

const DEFAULT_API_URL = 'http://127.0.0.1:5680/webhook/api'

export interface Repository {
  repository_id: number
  full_name: string
  description: string | null
  html_url: string
  default_branch: string
  languages_bytes: Record<string, number>
  commit_count: number | null
  pushed_at_utc: string | null
  refreshed_at_utc: string | null
  source_state: string | null
  archived: boolean
}

export interface RepositoriesResponse {
  count: number
  repositories: Repository[]
}

export interface RepositoryIndex {
  ok: boolean
  /** Present when `ok` is false: the API answered with an error envelope, or was unreachable. */
  reason?: string
  repositories: Repository[]
  totalCommits: number
  languages: Array<{ name: string; bytes: number; share: number }>
  refreshedAt: string | null
}

function apiUrl(): string {
  return process.env.MNEMORA_API_URL || DEFAULT_API_URL
}

function readKey(): string {
  const key = process.env.MNEMORA_READ_KEY
  if (!key) {
    throw new Error(
      'MNEMORA_READ_KEY is not set. Locally: copy .dev.vars.example to .dev.vars. In production: wrangler secret put MNEMORA_READ_KEY',
    )
  }
  return key
}

/** Words are ~5 bytes of source in a mixed-language portfolio; used only to rank languages. */
function rankLanguages(repositories: Repository[]) {
  const totals = new Map<string, number>()
  for (const repo of repositories) {
    for (const [name, bytes] of Object.entries(repo.languages_bytes ?? {})) {
      totals.set(name, (totals.get(name) ?? 0) + bytes)
    }
  }
  const sum = [...totals.values()].reduce((a, b) => a + b, 0)
  return [...totals.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([name, bytes]) => ({ name, bytes, share: sum === 0 ? 0 : bytes / sum }))
}

export const getRepositoryIndex = createServerFn({ method: 'GET' }).handler(
  async (): Promise<RepositoryIndex> => {
    const empty: RepositoryIndex = {
      ok: false,
      repositories: [],
      totalCommits: 0,
      languages: [],
      refreshedAt: null,
    }

    let res: Response
    try {
      res = await fetch(`${apiUrl()}/repos`, {
        headers: { 'X-Mnemora-Read-Key': readKey() },
      })
    } catch (error) {
      // A network failure is reported to the page, not thrown at it: the dashboard should say
      // "the collector is unreachable" rather than render an error boundary.
      return { ...empty, reason: `API unreachable: ${(error as Error).message}` }
    }

    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as
        | { error?: string; reason?: string }
        | null
      return { ...empty, reason: body?.reason ?? `API answered ${res.status}` }
    }

    const data = (await res.json()) as RepositoriesResponse
    const repositories = [...data.repositories].sort((a, b) =>
      a.full_name.localeCompare(b.full_name),
    )

    return {
      ok: true,
      repositories,
      totalCommits: repositories.reduce((total, repo) => total + (repo.commit_count ?? 0), 0),
      languages: rankLanguages(repositories).slice(0, 8),
      refreshedAt:
        repositories
          .map((repo) => repo.refreshed_at_utc)
          .filter((value): value is string => Boolean(value))
          .sort()
          .at(-1) ?? null,
    }
  },
)
