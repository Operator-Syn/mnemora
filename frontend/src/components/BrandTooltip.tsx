import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

interface Shown {
  label: string
  /** Centre of the trigger, in viewport coordinates. */
  x: number
  y: number
  side: 'above' | 'below'
}

const SHOW_DELAY_MS = 120
const TOOLTIP_ID = 'mnemora-tooltip'

/**
 * One branded tooltip for the whole page, driven by `data-tip` attributes.
 *
 * The native `title` tooltip cannot be styled — it arrives in the system font with a rounded corner
 * and a shadow from another design system, which is exactly the seam this world cannot afford. This
 * replaces it: any element with `data-tip="…"` gets a tooltip in the poster's own language.
 *
 * Delegation rather than a wrapper component, for two reasons: the triggers are things like `<i>`
 * flex children whose width is a percentage (wrapping them would change the layout), and several sit
 * inside `overflow: hidden` parents, so the tooltip must render in a portal or it would be clipped.
 */
export default function BrandTooltip() {
  const [shown, setShown] = useState<Shown | null>(null)
  const [mounted, setMounted] = useState(false)
  const tipRef = useRef<HTMLDivElement | null>(null)
  const timer = useRef<number | undefined>(undefined)

  useEffect(() => {
    setMounted(true)
    return () => window.clearTimeout(timer.current)
  }, [])

  useEffect(() => {
    if (!mounted) return

    const triggerOf = (node: EventTarget | null): HTMLElement | null =>
      node instanceof Element ? node.closest<HTMLElement>('[data-tip]') : null

    let currentTrigger: HTMLElement | null = null

    const place = (element: HTMLElement) => {
      const rect = element.getBoundingClientRect()
      const above = rect.top > 56
      element.setAttribute('aria-describedby', TOOLTIP_ID)
      currentTrigger = element
      setShown({
        label: element.dataset.tip ?? '',
        x: rect.left + rect.width / 2,
        y: above ? rect.top - 10 : rect.bottom + 10,
        side: above ? 'above' : 'below',
      })
    }

    const onPointerOver = (event: PointerEvent) => {
      const element = triggerOf(event.target)
      if (!element) return
      const previous = triggerOf(event.relatedTarget)
      if (previous && previous !== element) previous.removeAttribute('aria-describedby')
      window.clearTimeout(timer.current)
      timer.current = window.setTimeout(() => place(element), SHOW_DELAY_MS)
    }

    const onPointerOut = (event: PointerEvent) => {
      const element = triggerOf(event.target)
      if (!element || triggerOf(event.relatedTarget) === element) return
      hide(element)
    }

    const onFocusIn = (event: FocusEvent) => {
      const element = triggerOf(event.target)
      if (element) place(element)
    }

    const hide = (element: HTMLElement | null = currentTrigger) => {
      window.clearTimeout(timer.current)
      element?.removeAttribute('aria-describedby')
      if (element === currentTrigger) currentTrigger = null
      setShown(null)
    }

    const onFocusOut = (event: FocusEvent) => {
      const element = triggerOf(event.target)
      if (element && triggerOf(event.relatedTarget) !== element) hide(element)
    }

    const onScroll = () => hide()
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') hide()
    }

    document.addEventListener('pointerover', onPointerOver)
    document.addEventListener('pointerout', onPointerOut)
    document.addEventListener('focusin', onFocusIn)
    document.addEventListener('focusout', onFocusOut)
    document.addEventListener('keydown', onKeyDown)
    // Toggle labels can change while the pointer stays over the button; keep its note current.
    const observer = new MutationObserver((records) => {
      if (currentTrigger && records.some((record) => record.target === currentTrigger)) {
        place(currentTrigger)
      }
    })
    observer.observe(document.body, { attributes: true, attributeFilter: ['data-tip'], subtree: true })
    // The trigger moves under the pointer when the page scrolls; following it would be noise.
    window.addEventListener('scroll', onScroll, true)

    return () => {
      observer.disconnect()
      window.clearTimeout(timer.current)
      document.removeEventListener('pointerover', onPointerOver)
      document.removeEventListener('pointerout', onPointerOut)
      document.removeEventListener('focusin', onFocusIn)
      document.removeEventListener('focusout', onFocusOut)
      document.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('scroll', onScroll, true)
    }
  }, [mounted])

  // Keep the label inside the viewport: its width is only known once it has been laid out.
  useLayoutEffect(() => {
    const tip = tipRef.current
    if (!tip || !shown) return
    const half = tip.offsetWidth / 2
    const clamped = Math.min(Math.max(shown.x, half + 8), window.innerWidth - half - 8)
    tip.style.left = `${clamped}px`
  }, [shown])

  if (!mounted || !shown) return null

  return createPortal(
    <div id={TOOLTIP_ID} ref={tipRef} role="tooltip" className="tip" data-side={shown.side} style={{ left: shown.x, top: shown.y }}>
      {shown.label}
    </div>,
    document.body,
  )
}
