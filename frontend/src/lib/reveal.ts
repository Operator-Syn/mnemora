import { useEffect, useRef, useState } from 'react'

const OBSERVER_OPTIONS: IntersectionObserverInit = {
  rootMargin: '0px 0px -10% 0px',
  threshold: 0.12,
}

/**
 * Marks an element once it enters the viewport, so the CSS can reveal it.
 *
 * This returns state rather than writing `data-in` onto the DOM. An imperative write is a hydration
 * mismatch: the previous version observed from the root, whose effect runs before TanStack's lazily
 * loaded route component hydrates. It marked server-rendered nodes, React then compared them against
 * HTML that never carried the attribute, and warned that the attributes did not match — the reveal
 * still worked, but every load logged an error. React owns the attribute now, so the write is an
 * ordinary state update after hydration.
 */
export function useInView<T extends HTMLElement = HTMLDivElement>() {
  const ref = useRef<T | null>(null)
  const [inView, setInView] = useState(false)

  useEffect(() => {
    const node = ref.current
    if (!node) return

    if (!('IntersectionObserver' in window)) {
      setInView(true)
      return
    }

    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue
        setInView(true)
        observer.unobserve(entry.target)
      }
    }, OBSERVER_OPTIONS)

    observer.observe(node)

    // Belt and braces: if an observation is ever missed, anything already on screen still reveals,
    // so a page can never stay blank behind the pre-paint hidden state.
    const safety = window.setTimeout(() => {
      const rect = node.getBoundingClientRect()
      if (rect.top < window.innerHeight && rect.bottom > 0) setInView(true)
    }, 600)

    return () => {
      observer.disconnect()
      window.clearTimeout(safety)
    }
  }, [])

  return { ref, inView }
}
