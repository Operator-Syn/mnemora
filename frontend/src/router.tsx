import { createRouter as createTanStackRouter } from '@tanstack/react-router'
import { routeTree } from './routeTree.gen'

export function getRouter() {
  const router = createTanStackRouter({
    routeTree,
    scrollRestoration: true,
    defaultPreload: 'intent',
    defaultPreloadStaleTime: 0,
    // Continuity between pages, using the platform View Transitions API rather than a motion
    // library. The animation itself is gated on html[data-motion='on'] in styles.css, so a visitor
    // who stopped motion gets an instant swap.
    defaultViewTransition: true,
    // `defaultPendingComponent` is deliberately not used: it is declared correctly here and still
    // never commits in this version (see RoutePendingVeil), so the skeleton is driven by the
    // router's isLoading state instead.
  })

  return router
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof getRouter>
  }
}
