import { useRef, useState } from 'react'
import { useRouter } from '@tanstack/react-router'
import type { ReadApiFailure } from '../lib/mnemora'
import { markBackgroundRefreshEnd, markBackgroundRefreshStart } from './RoutePendingVeil'

export type FeedFailureKind = Exclude<ReadApiFailure, 'not-found'>

export function normalizeFeedFailureKind(kind: ReadApiFailure): FeedFailureKind {
  return kind === 'not-found' ? 'api' : kind
}

export function feedFailureCopy(kind: FeedFailureKind | undefined) {
  switch (kind) {
    case 'config':
      return {
        code: 'NOT CONNECTED',
        summary: 'This deployment is not connected to the repository feed.',
        detail: 'No repository data is shown until the feed is available.',
      }
    case 'network':
      return {
        code: 'NO RESPONSE',
        summary: 'We could not reach the service that supplies these records.',
        detail: 'Repository data is withheld until the feed responds.',
      }
    default:
      return {
        code: 'FEED ERROR',
        summary: 'The repository service did not return usable data.',
        detail: 'No totals or repository records are presented as current.',
      }
  }
}

export function FeedSignalMark() {
  return (
    <svg className="feed-signal-mark" aria-hidden="true" viewBox="0 0 40 40" fill="none">
      <path d="M4 12V4h8M28 4h8v8M36 28v8h-8M12 36H4v-8" />
      <path d="M7 21h6l4-8 6 14 4-7h6" />
    </svg>
  )
}

export function FeedComponentFailure({
  code,
  headline,
  detail,
}: {
  code: string
  headline: string
  detail: string
}) {
  return (
    <div className="feed-component-failure" role="status" aria-live="polite">
      <FeedSignalMark />
      <div>
        <p className="feed-component-code">{code}</p>
        <h3>{headline}</h3>
        <p className="feed-component-detail">{detail}</p>
      </div>
    </div>
  )
}

export function FeedRetryButton() {
  const router = useRouter()
  const inFlight = useRef(false)
  const [retrying, setRetrying] = useState(false)

  function retryFeed() {
    if (inFlight.current) return
    inFlight.current = true
    setRetrying(true)
    markBackgroundRefreshStart()
    void router
      .invalidate()
      .catch(() => undefined)
      .finally(() => {
        markBackgroundRefreshEnd()
        inFlight.current = false
        setRetrying(false)
      })
  }

  return (
    <button
      type="button"
      className="feed-retry-button"
      disabled={retrying}
      aria-busy={retrying}
      onClick={retryFeed}
    >
      <span>{retrying ? 'Checking feed…' : 'Retry feed'}</span>
      <svg aria-hidden="true" viewBox="0 0 16 16" fill="none">
        <path d="M13.25 7.25A5.25 5.25 0 0 0 4.2 3.6L2.75 5" />
        <path d="M2.75 2.75V5h2.5M2.75 8.75a5.25 5.25 0 0 0 9.05 3.65L13.25 11" />
        <path d="M13.25 13.25V11h-2.5" />
      </svg>
    </button>
  )
}
