import { HeadContent, Link, Scripts, createRootRoute } from '@tanstack/react-router'
import { useEffect } from 'react'
import { TanStackRouterDevtoolsPanel } from '@tanstack/react-router-devtools'
import { TanStackDevtools } from '@tanstack/react-devtools'
import Footer from '../components/Footer'
import Header from '../components/Header'
import RoutePendingVeil from '../components/RoutePendingVeil'
import BrandTooltip from '../components/BrandTooltip'
import { installPointerShape } from '../lib/pointer-shape'

import appCss from '../styles.css?url'

const MOTION_INIT_SCRIPT = `(function(){try{var stored=window.localStorage.getItem('motion');var mode=(stored==='on'||stored==='off')?stored:'system';var reduce=window.matchMedia('(prefers-reduced-motion: reduce)').matches;var resolved=mode==='on'?'on':mode==='off'?'off':(reduce?'off':'on');var root=document.documentElement;root.dataset.motion=resolved;root.dataset.motionMode=mode;}catch(e){}})();`

const THEME_INIT_SCRIPT = `(function(){try{var stored=window.localStorage.getItem('theme');var mode=(stored==='light'||stored==='dark'||stored==='auto')?stored:'auto';var prefersDark=window.matchMedia('(prefers-color-scheme: dark)').matches;var resolved=mode==='auto'?(prefersDark?'dark':'light'):mode;var root=document.documentElement;root.classList.remove('light','dark');root.classList.add(resolved);if(mode==='auto'){root.removeAttribute('data-theme')}else{root.setAttribute('data-theme',mode)}root.dataset.themeMode=mode;root.style.colorScheme=resolved;}catch(e){}})();`

/* The pointer cursor is stepped from real frames (see the Pointer block in styles.css), so its
   images are fetched rather than painted from a single file. The link pair is preloaded because a
   visitor reaches a link long before a navigation: without it the first hover falls back to the
   system arrow for one round trip. The busy rings are only needed when the router starts waiting,
   which is after load, so they are prefetched at low priority and fill in quietly. */
const LINK_CURSOR_FRAMES = [
  '/cursors/animated/pointer/frame_00.png',
  '/cursors/animated/pointer/frame_01.png',
]

const BUSY_CURSOR_FRAMES = ['wait', 'progress'].flatMap((set) =>
  Array.from({ length: 8 }, (_, frame) => `/cursors/animated/${set}/frame_0${frame}.png`),
)

export const Route = createRootRoute({
  head: () => ({
    meta: [
      {
        charSet: 'utf-8',
      },
      {
        name: 'viewport',
        content: 'width=device-width, initial-scale=1',
      },
      {
        title: 'Mnemora',
      },
    ],
    links: [
      {
        rel: 'stylesheet',
        href: appCss,
      },
      {
        rel: 'icon',
        href: '/favicon.svg',
        type: 'image/svg+xml',
      },
      ...LINK_CURSOR_FRAMES.map((href) => ({ rel: 'preload', as: 'image', href })),
      ...BUSY_CURSOR_FRAMES.map((href) => ({ rel: 'prefetch', as: 'image', href })),
    ],
  }),
  shellComponent: RootDocument,
  notFoundComponent: NotFound,
})

/**
 * Without this, TanStack Router falls back to `<p>Not Found</p>` on the bare page — no header, no
 * paper, nothing that belongs to this world. Every unmatched route now lands in the poster.
 */
function NotFound() {
  return (
    <main>
      <div className="page-wrap">
        <section className="poster notfound">
          <div className="stamp">Filed under: missing</div>
          <h1>
            <span className="hl alt">404</span> Nothing filed at this address.
          </h1>
          <p className="lede">
            The page you asked for was never collected, or it has been renamed since. Nothing was
            deleted from the index to make room for it.
          </p>
          <Link to="/" className="cta">
            Open the ledger
          </Link>
        </section>
      </div>
    </main>
  )
}

function RootDocument({ children }: { children: React.ReactNode }) {
  // Keeps the drawn pointer shape through a route transition; see the module for the measurement.
  useEffect(() => installPointerShape(), [])

  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* biome-ignore lint/security/noDangerouslySetInnerHtml: runs before first paint so the stored theme applies without a flash; a module script would paint the wrong theme first. */}
      <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
        {/* biome-ignore lint/security/noDangerouslySetInnerHtml: the motion mode has to be on <html> before first paint, or the page moves once and then stops. */}
        <script dangerouslySetInnerHTML={{ __html: MOTION_INIT_SCRIPT }} />
        <HeadContent />
      </head>
      <body className="font-sans antialiased [overflow-wrap:anywhere] selection:bg-[rgba(79,184,178,0.24)]">
        <Header />
        {children}
        <RoutePendingVeil />
        <Footer />
        <BrandTooltip />
        <TanStackDevtools
          config={{
            position: 'bottom-right',
          }}
          plugins={[
            {
              name: 'Tanstack Router',
              render: <TanStackRouterDevtoolsPanel />,
            },
          ]}
        />
        <Scripts />
      </body>
    </html>
  )
}
