---
name: Mnemora
description: A personal site where public repository data is one section among several, read by recruiters.
colors:
  ground: "#ffc400"
  paper: "#fffdf5"
  ink: "#12100e"
  ink-soft: "#3b372f"
  tomato: "#ff3b1f"
  cobalt: "#1b3bff"
  sun: "#ffc400"
  on-accent: "#12100e"
typography:
  display:
    fontFamily: "Anton, Arial Narrow, sans-serif"
    fontSize: "clamp(38px, 6.6vw, 92px)"
    fontWeight: 400
    lineHeight: 1.1
    letterSpacing: "-0.015em"
  mark:
    fontFamily: "Anton, Arial Narrow, sans-serif"
    fontSize: "30px"
    fontWeight: 400
    lineHeight: 1
  headline:
    fontFamily: "Anton, Arial Narrow, sans-serif"
    fontSize: "24px"
    fontWeight: 400
    lineHeight: 1.08
  step-title:
    fontFamily: "Anton, Arial Narrow, sans-serif"
    fontSize: "21px"
    fontWeight: 400
    lineHeight: 1.08
  title:
    fontFamily: "Anton, Arial Narrow, sans-serif"
    fontSize: "19px"
    fontWeight: 400
    lineHeight: 1.08
  card-title:
    fontFamily: "Anton, Arial Narrow, sans-serif"
    fontSize: "17px"
    fontWeight: 400
    lineHeight: 1.08
  body:
    fontFamily: "Public Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "18px"
    fontWeight: 400
    lineHeight: 1.5
  body-small:
    fontFamily: "Public Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.5
  data:
    fontFamily: "IBM Plex Mono, ui-monospace, monospace"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.4
  card-body:
    fontFamily: "Public Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "13.5px"
    fontWeight: 400
    lineHeight: 1.55
  note:
    fontFamily: "IBM Plex Mono, ui-monospace, monospace"
    fontSize: "12.5px"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "IBM Plex Mono, ui-monospace, monospace"
    fontSize: "11.5px"
    fontWeight: 400
    letterSpacing: "0.12em"
rounded:
  square: "0"
spacing:
  tight: "8px"
  card-gap: "18px"
  panel-pad: "18px 20px"
  block-gap: "22px"
  section-gap: "34px"
components:
  card:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.square}"
    padding: "14px 15px 12px"
  theme-toggle:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.square}"
    padding: "5px 9px"
---

# Design System: Mnemora

## Overview

**Creative North Star: "The Printed Notice"**

The site is a printed civic notice: a sheet of paper pasted on a bright board, with rules drawn by
hand, blocks of flat colour where a number matters, and everything set in a condensed headline face
that assumes you will read it from across the street. It is loud in colour and disciplined in
information — the poster earns the shout, the numbers do the talking.

Three consequences follow, and they govern everything below. First, **structure is visible**: borders
are 2–3px of solid ink, corners are square, and depth is a hard offset shadow rather than a blur.
Second, **colour is applied in blocks, never in gradients**: blue and yellow mark the numbers, red
marks the stamp, cobalt carries the footer. Third, **type does the hierarchy**, not decoration: one
display face at full volume, one text face for reading, one mono face for anything measured.

The dark theme is the same notice printed on dark stock, not a different design. Sun and tomato stay
bright in both themes, so the text on them stays near-black in both; cobalt flips its text with the
paper.

**Key Characteristics:**

- Square corners, 2–3px ink rules, offset shadows with no blur radius.
- Sunflower ground with paper panels; colour arrives in solid rectangles.
- Anton for display, Public Sans for reading, IBM Plex Mono for data.
- The refresh time is a stamp, not a subtitle.
- Light and dark are the same system with the paper swapped.

## Colors

A high-chroma print palette: sunflower, tomato and cobalt on paper, with ink doing all the work of
hierarchy.

### Primary

- **Sunflower Ground** (#ffc400): the board behind every panel. It is the page background in light
  mode and the fill under the commit-count highlight.
- **Cobalt Block** (#1b3bff): the repository-count highlight, the footer, focus rings, and card-hover
  shadows. The only colour used for emphasis at display size.

### Secondary

- **Tomato Stamp** (#ff3b1f): reserved for the refresh stamp and the per-card commit badges. It marks
  a number that came from a specific moment.

### Neutral

- **Paper** (#fffdf5): panels, cards, the masthead. Light mode only.
- **Ink** (#12100e): all text, all borders, all shadows. Not a grey — pure near-black.
- **Ink Soft** (#3b372f): body copy that is not a heading, and secondary metadata.
- **On Accent** (#12100e): the text colour on sunflower and tomato. Fixed in both themes because those
  two colours stay bright in both.

**The Two Papers Rule.** Panels are never white-on-white: they are `paper` on `ground`, so every block
has an edge before a border is drawn.

**The On-Accent Rule.** Text on sunflower or tomato is always `#12100e`. Cream on sunflower measured
1.57:1 — a real bug caught in a screenshot review, not a preference.

## Typography

**Display Font:** Anton (with Arial Narrow, sans-serif)
**Body Font:** Public Sans (with system-ui)
**Label/Mono Font:** IBM Plex Mono

**Character:** A single-width poster face shouting the numbers, a neutral grotesque for the arguments,
and a typewriter face for anything that is measured. The contrast between the three is the hierarchy.

### Hierarchy

Every step below is a real value in `src/styles.css`; the audit flags any size that is not on this
list, so add a row here before adding one there.

| step | size | face | use |
|---|---|---|---|
| Display | clamp(38px, 6.6vw, 92px), 1.1 | Anton | the page headline, one per page |
| Mark | 30px, 1 | Anton | masthead wordmark |
| Mark (compact) | 22px ≤760px, 19px ≤420px, 1 | Anton | the same wordmark once the masthead must stay one line |
| Headline | 24px, 1.08 | Anton | section titles (`Public repositories`) |
| Step title | 21px, 1.08 | Anton | the four pipeline cards on /about |
| Title | 19px, 1.08 | Anton | panel titles (`By the numbers`) |
| Card title | 17px, 1.08 | Anton | repository name |
| Body | 18px, 1.5, 56ch max | Public Sans | the lede |
| Body small | 15px, 1.5 | Public Sans | the "who runs it" lines |
| Data | 14px, 1.4 | Plex Mono | key/value rows, tabular numerals |
| Card body | 13.5px, 1.55 | Public Sans | descriptions, limit list items |
| Note | 12.5px, 1.5 | Plex Mono | status row, legend, cycle label, `n of m shown` |
| Label | 11.5px, 0.12em | Plex Mono | chips, brows, timestamps, card feet |

**The Numbers Rule.** Every number that a reader might compare is set in IBM Plex Mono with
`font-variant-numeric: tabular-nums`. Proportional digits are a bug in a data surface.

## Layout

A single 1180px measure centred on the ground, with 2.5rem gutters that never collapse. The hero is a
two-column grid (numbers panel, languages panel) above a three-column card grid; both drop to one
column at 900px. Section rhythm is 34px between blocks and 40px above the footer.

The headline is explicitly unclipped: no fixed measure, `text-wrap: balance`, `overflow-wrap:
break-word`, and highlight blocks that carry their own inline padding so a glyph never touches a
colour edge.

## Elevation & Depth

Flat by default, lifted by hard offset shadows with **zero blur**. The shadow is ink and sits 6–10px
down and right, which reads as a second sheet of paper behind the first. There is no ambient shadow
anywhere, and no blur is used for depth.

### Shadow Vocabulary

- **Panel lift** (`10px 10px 0 var(--ink)`): the two hero panels and any island-shell.
- **Card lift** (`6px 6px 0 var(--ink)`): repository cards at rest.
- **Card hover** (`9px 9px 0 var(--cobalt)`): the card shifts 2px up-left and its shadow turns cobalt.
- **Stamp lift** (`5px 5px 0 var(--ink)`): the rotated refresh stamp.

**The No-Blur Rule.** If a shadow has a blur radius, it belongs to another design system.

**The Shadow-Not-Border Rule.** Offsets come from `--shadow-solid`, which is dark in *both* themes
(`#12100e` light, `#000` dark). Using the ink token made the dark-theme shadow cream, so every card
read as a double border instead of a lifted sheet. In dark mode the card paper is also lighter than
the ground (`#241f16` on `#12100a`), so panels sit above the page rather than below it.

## Shapes

Square. `border-radius` is 0 everywhere except the browser's own form controls. Borders are ink at
2px (small elements) or 3px (panels, masthead, section rules). The only non-orthogonal shapes are the
stamp, rotated -2.5deg, and the bar segments in the language stack, which are rectangles by design.

## Components

### Cards

- **Shape:** square (0 radius), 3px ink border, a flex column so the bar and footer align across a row.
- **Background:** paper.
- **Shadow Strategy:** 6px offset at rest, cobalt at 9px on hover with a -2px translate.
- **Internal Padding:** 16px 15px 12px.
- **Title:** a fixed two-line slot (`height: calc(2.4em + 3px)`), with the full name in `title`. The
  text block is *centred* in that slot and the rule is drawn under the anchor, so the rule tracks the
  last line of whatever the name turns out to be: no gap between a short name and its rule, and the
  slot absorbs the difference as space above the words instead. The card keeps one height.
- **The rule belongs to the card, not to the text.** A per-name underline changes length with the
  name and vanishes where the clamp cuts a line, which is the inconsistency this replaced; a rule on
  the anchor is the same length on every card and still sits under the words.
- **Date:** always `YYYY-MM-DD` on the card. Relative time is reserved for the panel's "most recent
  push" row, so one surface never mixes two date languages.
- **Description:** three lines maximum, 13.5px, clamped.
- **Language bar:** 8px, 1px ink track border, pushed down with `margin-top: auto`.
- **Commit badge:** tomato, `on-accent` text, 2px ink border, 11.5px mono uppercase, offset -10px above
  the top edge.

### Panels

- **Shape:** square, 3px ink border, `10px 10px 0` ink shadow.
- **Content:** a mono key/value list with 2px rules between rows, or a stacked bar with a two-column
  legend.

### Theme Toggle

- **Shape:** square, 2px ink border, paper background, mono uppercase 11.5px.
- **States:** hover inverts to cobalt with cream text; focus draws a 3px cobalt ring offset 2px.
- **Behaviour:** cycles Auto → Light → Dark, writes `data-theme` on `<html>` and persists to
  `localStorage.theme`; Auto follows `prefers-color-scheme`.

### Ticker (removed)

A full-bleed ink strip used to sit under the masthead carrying the leading language shares,
`collected hourly`, the pipeline order and minutes to the next pass, scrolling on a 48-second loop.
It is gone: it repeated numbers the panels already state, competed with the hero for the first
glance, and its scroll was the one piece of continuous motion in a world whose continuous motion
should be the cycle gauge. Every fact it carried still has a home — the shares in the language
panel, the schedule in the status row, the freshness in the ticking stamp.

### Status row

`● Collector active — next pass in 52 min — 25 repos · 20 languages tracked` in 12.5px mono. The dot
pulses on a 2.4s cycle. Minutes are computed on the server so the HTML and the hydrated client agree.

### Chips

Filter the repository index by leading language. Square, 2px ink border, mono 11.5px, count in
brackets. Hover fills sunflower; the active chip inverts to ink. The count beside `n of m shown` is
`aria-live="polite"`, so filtering announces itself.

### Brows

`01 ▸ THE LEDGER` above each band: a mono label with the number reversed out of an ink block and a
hairline running to the right margin. Used on `/about` as well (store, pipeline, limits).

### Navigation

Masthead: wordmark set in Anton, split across ink and a tomato block ("Mne" ink, "mora" on tomato), a sunflower chip
dating the collection, then uppercase links with a 3px ink underline on hover and sunflower highlight
on the active route. Hidden below 900px.

## Motion & Cadence

**Thesis: the press run.** The world is printed, so the motion is printing. Nothing fades softly or
bounces; things are pressed, registered, and counted, and every one of them reports a real fact.

**Focal moment — the stamp press.** On load the refresh stamp arrives from -9° and 1.22 scale with a
16px shadow, and settles to -2.5° with a 5px shadow over 540ms. It is the one authored entrance; the
rest of the page is quiet by comparison.

**Supporting motion, each with a job:**

- **Ink registration** — the highlight blocks wipe in left to right (`clip-path: inset(0 100% 0 0)` →
  `inset(0)`), 520ms, offset 40ms and 150ms, like ink laid on a sheet.
- **The cycle gauge** — a printed rule under the status row whose fill is the fraction of the hour
  elapsed. It advances every 15s and is a progress bar to assistive tech. This is the page's
  continuous movement, and it is measuring the actual collection cycle.
- **Live countdown** — `NEXT PASS IN n MIN` decrements locally from the server-rendered value.
- **Section rules** — brows draw their hairline across on first view (460ms, 100ms delay).
- **Card entrance** — 10px rise with 45ms stagger, first 12 only, once per load.
- **Bars** — language segments grow from the left edge, 90ms stagger.
- **Feedback** — chips compress to 0.97 on :active; cards lift 2px with the shadow turning cobalt;
  the card language bar goes from 50% to full opacity.
- **Title rule** — redraws under the name on hover and on `focus-within` (280ms, from 0.24 scale).
- **Commit badge** — tilts 4° and fills sunflower on hover; the card's own state, not a new fact.
- **Legend cross-highlight** — hovering a language row dims every other slice of the mix, so the
  number and its colour read as one object.
- **Filter re-deal** — the card list remounts on a filter change, so the stagger runs again and the
  index visibly answers the click.
- **Ticking stamp** — `Refreshed n min ago` re-renders every 30s. This is the replacement for the
  removed fact ticker: one element that keeps counting, and it counts something true.

**The Fill Rule.** Entrance animations use `backwards`, never `both`. A forwards-filling animation
keeps applying its final transform, and an active animation outranks a transition on the same
property — which silently disables every hover transform on the element for the life of the page.

**The Living Rule.** At least one element must be visibly changing, and it must be reporting something
true — the cycle gauge, the countdown, the pulse. Motion that reports nothing is noise.

**The Quiet Fallback Rule.** `prefers-reduced-motion: reduce` removes every animation (measured: 47
animations at rest, 0 under reduce) while the counts, the gauge, and the countdown keep their values.
Content is never hidden behind motion: reveal targets start visible and only animate once JavaScript
adds `motion-ready`.

**The One Line Rule.** The masthead is one row at every width. The `collected hourly` chip is the first
thing to drop (≤760px), then the nav (≤900px); the wordmark steps down to 22px and 19px. No header
control may wrap to a second line.

**The One Rule Rule.** A decorative rule belongs to the container it separates, never to a run of
text: container rules are the same length on every card, text underlines are not.

**The Printed Gauge Rule.** Never animate `width` for the cycle; it is a `transform: scaleX()` on an
inner element so the paint stays cheap.

## Do's and Don'ts

### Do:

- **Do** keep the panel ground `paper` and the page `ground`; the contrast between them is the layout.
- **Do** use `--on-accent` on sunflower and tomato in both themes.
- **Do** set every comparable figure in mono with tabular numerals.
- **Do** let one element per screen shout (the headline), and keep the rest at 11.5–18px.
- **Do** state the refresh time. The stamp exists because the data is up to an hour old.

### Don't:

- **Don't** add border-radius, blur, or gradient fills; the world is printed, not glassy.
- **Don't** put cream text on sunflower or tomato — measure it if you doubt.
- **Don't** introduce a decorative element that carries no information. The comp's orange tape became
  the refresh stamp for exactly this reason.
- **Don't** truncate a number, a repository name, or a date; wrap instead.
- **Don't** let the headline rely on a fixed width; it must wrap, not clip, at any viewport.
- **Don't** repeat the same number in the ticker, the hero and the table; each surface says it once.
- **Don't** animate anything that is not true — no fake activity, no skeleton shimmer over loaded data.
- **Don't** let a percentage row stop short of 100; group the remainder as Other.
