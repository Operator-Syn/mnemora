// Geometric collision probe for the page currently loaded in a browser session.
//
//   browser-act --session qa navigate http://127.0.0.1:8787/
//   browser-act --session qa eval --stdin < scripts/overlap-probe.js
//
// Answers what a design detector cannot, and what an overflow check misses: is anything painted on
// top of text? A negative margin can drag an opaque bar across a label while every element still
// sits inside the viewport and scrollWidth stays equal to clientWidth.
//
// Two passes:
//   1. text against text
//   2. any opaque painted box that comes later in document order against text — the case that
//      actually bit this page, where the cycle bar covered the word above it
//
// Prints { scope, textNodes, paintedBoxes, collisions: [...] }. Every collision is a defect unless
// a stacked composition is deliberate; say so explicitly rather than ignoring it.
(() => {
  const scopeSelector = window.__OVERLAP_SCOPE || 'main'
  const scope = document.querySelector(scopeSelector)
  if (!scope) return JSON.stringify({ error: `scope not found: ${scopeSelector}` })

  const TEXT_SELECTOR = 'p, span, h1, h2, h3, h4, b, strong, a, button, li, td, th, label, time'
  const OVERLAP_PX = 2

  const visible = (el) => {
    const style = getComputedStyle(el)
    if (style.visibility === 'hidden' || style.display === 'none' || style.opacity === '0') return false
    const rect = el.getBoundingClientRect()
    return rect.width > 0 && rect.height > 0
  }

  const textNodes = [...scope.querySelectorAll(TEXT_SELECTOR)].filter(
    (el) => el.textContent.trim() && visible(el),
  )

  const paintedBoxes = [...scope.querySelectorAll('*')].filter((el) => {
    if (!visible(el)) return false
    const bg = getComputedStyle(el).backgroundColor
    const alpha = bg.startsWith('rgba(') ? Number(bg.slice(bg.lastIndexOf(',') + 1, -1)) : 1
    return alpha > 0.1
  })

  const overlaps = (a, b) => {
    const ra = a.getBoundingClientRect()
    const rb = b.getBoundingClientRect()
    const x = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left)
    const y = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top)
    return x > OVERLAP_PX && y > OVERLAP_PX ? [Math.round(x), Math.round(y)] : null
  }

  const label = (el) => el.textContent.trim().replace(/\s+/g, ' ').slice(0, 40)
  const paired = (a, b) => a.contains(b) || b.contains(a)
  const collisions = []

  for (let i = 0; i < textNodes.length; i += 1) {
    for (let j = i + 1; j < textNodes.length; j += 1) {
      if (paired(textNodes[i], textNodes[j])) continue
      const box = overlaps(textNodes[i], textNodes[j])
      if (box) collisions.push({ kind: 'text-over-text', a: label(textNodes[i]), b: label(textNodes[j]), overlap: box })
    }
  }

  for (const text of textNodes) {
    for (const painted of paintedBoxes) {
      if (paired(text, painted)) continue
      // Only boxes painted after the text can cover it.
      const order = text.compareDocumentPosition(painted)
      if (!(order & Node.DOCUMENT_POSITION_FOLLOWING)) continue
      if (painted.contains(text)) continue
      const box = overlaps(text, painted)
      if (box) {
        collisions.push({
          kind: 'box-over-text',
          a: label(text),
          b: `${painted.tagName.toLowerCase()}.${String(painted.className || '').split(' ')[0] || ''}`.slice(0, 40),
          overlap: box,
        })
      }
    }
  }

  return JSON.stringify(
    { scope: scopeSelector, textNodes: textNodes.length, paintedBoxes: paintedBoxes.length, collisions },
    null,
    2,
  )
})()
