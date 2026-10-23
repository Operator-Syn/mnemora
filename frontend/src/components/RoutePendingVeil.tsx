import { useEffect, useRef, useState } from 'react'
import { useRouterState } from '@tanstack/react-router'
import RoutePending from './RoutePending'

const SHOW_AFTER_MS = 200
const MIN_VISIBLE_MS = 400

/**
 * Shows the skeleton while the router is loading.
 *
 * Why not `pendingComponent`: the router documents a pending match for exactly this, and it is
 * declared on both routes — but in this version the pending match never commits when the loader is
 * a server function under a view transition. Measured during a 1.2s navigation: `router.state
 * .isLoading` was true the whole time while no match was ever marked pending, so nothing rendered.
 * The loading state itself is reliable, so the veil is driven from that.
 *
 * The veil covers the page rather than replacing the outlet, so the route tree is untouched and the
 * view transition still snapshots the real page.
 */
export default function RoutePendingVeil() {
  const isLoading = useRouterState({ select: (state) => state.isLoading })
  const [visible, setVisible] = useState(false)
  const shownAt = useRef(0)

  useEffect(() => {
    if (isLoading) {
      const timer = window.setTimeout(() => {
        shownAt.current = Date.now()
        setVisible(true)
      }, SHOW_AFTER_MS)
      return () => window.clearTimeout(timer)
    }

    // Keep it on screen long enough that it reads as a state, not a flicker.
    const remaining = Math.max(0, MIN_VISIBLE_MS - (Date.now() - shownAt.current))
    const timer = window.setTimeout(() => setVisible(false), remaining)
    return () => window.clearTimeout(timer)
  }, [isLoading])

  if (!visible) return null

  return (
    <div className="pending-veil" role="status" aria-live="polite" aria-busy="true">
      <RoutePending />
    </div>
  )
}
