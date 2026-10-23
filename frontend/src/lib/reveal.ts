import { useEffect } from 'react'

const SELECTOR = '[data-reveal], [data-deal]'

/**
 * Reveals marked blocks as they enter the viewport.
 *
 * This lives at the root because the pre-paint script adds `motion-ready`, which hides every
 * `[data-reveal]` node from the first frame. That is what stops the visible → hidden → animate
 * blink, but it also means a route that forgets to run the observer would render a blank page.
 * Owning it here makes that mistake impossible.
 *
 * `[data-deal]` marks a container whose children should animate on arrival (the card grid);
 * watching the container plays the stagger when the reader reaches it instead of off-screen.
 */
export function useScrollReveal(): void {
  useEffect(() => {
    const root = document.documentElement
    if (!document.querySelector(SELECTOR)) return

    if (!('IntersectionObserver' in window)) {
      for (const node of document.querySelectorAll<HTMLElement>(SELECTOR)) node.dataset.in = ''
      return
    }

    root.classList.add('motion-ready')

    const seen = new WeakSet<Element>()
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

    const observe = (node: Element) => {
      if (seen.has(node)) return
      seen.add(node)
      observer.observe(node)
    }

    const scan = () => {
      for (const node of document.querySelectorAll(SELECTOR)) observe(node)
    }

    scan()

    // Routes mount after this effect on client navigation, so new nodes have to be picked up.
    const mutations = new MutationObserver(scan)
    mutations.observe(document.body, { childList: true, subtree: true })

    // Belt and braces: anything on screen after a moment but still unmarked gets revealed, so a
    // missed observation can never leave the page blank.
    const safety = window.setTimeout(() => {
      for (const node of document.querySelectorAll<HTMLElement>(SELECTOR)) {
        if (node.hasAttribute('data-in')) continue
        const rect = node.getBoundingClientRect()
        if (rect.top < window.innerHeight && rect.bottom > 0) node.dataset.in = ''
      }
    }, 1200)

    return () => {
      observer.disconnect()
      mutations.disconnect()
      window.clearTimeout(safety)
    }
  }, [])
}
