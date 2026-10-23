/**
 * The drawn pointer has to survive a route change.
 *
 * A view transition replaces the page with snapshots of itself, and for as long as it runs the
 * document root is what the pointer hits: measured mid-navigation, `elementFromPoint` over the
 * masthead link returned `HTML` for about 400ms and the link stopped matching `:hover`. The hand
 * therefore fell back to the default arrow, stopped stepping, and only picked itself up once the new
 * page settled — which reads as the page reloading underneath the pointer.
 *
 * So the shape is tracked on `<html>` from real pointer events, and frozen while a transition runs:
 * the pointer keeps the shape it had over the control that started the navigation, then re-reads the
 * truth from the settled page.
 */

const INTERACTIVE = 'a, button, summary'

let installed = false

export function installPointerShape(): () => void {
  if (installed || typeof document === 'undefined') return () => undefined
  installed = true

  const root = document.documentElement
  let overInteractive = false
  let transitioning = false
  let x = 0
  let y = 0

  const sync = () => {
    if (overInteractive) root.dataset.pointer = 'link'
    else delete root.dataset.pointer
  }

  const onPointerOver = (event: PointerEvent) => {
    x = event.clientX
    y = event.clientY
    // Mid-transition these events describe the snapshot, not the page: keep the last real reading.
    if (transitioning) return
    const target = event.target
    overInteractive = target instanceof Element && target.closest(INTERACTIVE) !== null
    sync()
  }

  document.addEventListener('pointerover', onPointerOver, { passive: true })

  const startViewTransition = document.startViewTransition?.bind(document)
  if (startViewTransition) {
    document.startViewTransition = (callback: ViewTransitionUpdateCallback) => {
      transitioning = true
      const transition = startViewTransition(callback)
      void transition.finished.finally(() => {
        transitioning = false
        const under = document.elementFromPoint(x, y)
        overInteractive = under instanceof Element && under.closest(INTERACTIVE) !== null
        sync()
      })
      return transition
    }
  }

  return () => {
    installed = false
    document.removeEventListener('pointerover', onPointerOver)
    delete root.dataset.pointer
  }
}
