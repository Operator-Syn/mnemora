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
| Headline | 24px, 1.08 | Anton | section titles (`Public repositories`) |
| Step title | 21px, 1.08 | Anton | the four pipeline cards on /about |
| Title | 19px, 1.08 | Anton | panel titles (`By the numbers`) |
| Card title | 17px, 1.08 | Anton | repository name |
| Body | 18px, 1.5, 56ch max | Public Sans | the lede |
| Body small | 15px, 1.5 | Public Sans | the "who runs it" lines |
| Data | 14px, 1.4 | Plex Mono | key/value rows, tabular numerals |
| Card body | 13.5px, 1.55 | Public Sans | descriptions, limit list items |
| Note | 12.5px, 1.5 | Plex Mono | status row, legend, `n of m shown` |
| Label | 11.5px, 0.12em | Plex Mono | chips, brows, ticker, timestamps, card feet |

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

## Shapes

Square. `border-radius` is 0 everywhere except the browser's own form controls. Borders are ink at
2px (small elements) or 3px (panels, masthead, section rules). The only non-orthogonal shapes are the
stamp, rotated -2.5deg, and the bar segments in the language stack, which are rectangles by design.

## Components

### Cards

- **Shape:** square (0 radius), 3px ink border.
- **Background:** paper.
- **Shadow Strategy:** 6px offset at rest, cobalt at 9px on hover with a -2px translate.
- **Internal Padding:** 14px 15px 12px.
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

### Ticker

A full-bleed ink strip under the masthead carrying facts that change: the leading language shares,
`collected hourly`, the pipeline order, and minutes to the next pass. It scrolls on a 48-second loop
and pauses on hover or focus. Hidden entirely when reduced motion is requested — the same facts are
in the panels below, so nothing is lost.

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

The page must look like it is running. Motion here is evidence, not decoration: something is always
either moving, counting, or counting down, and every one of those signals a real fact.

- **Entrance:** cards rise 10px and fade over 460ms, staggered 45ms each, first 12 only. Runs once.
- **Count-up:** the two headline figures count from zero over 900ms on first paint.
- **Bars:** language segments grow from their left edge, staggered 90ms.
- **Ticker:** 48s linear loop, paused on hover/focus.
- **Pulse:** the collector dot breathes on a 2.4s cycle.
- **Hover:** cards lift 2px-left/-2px-up with the shadow turning cobalt; the card's language bar
  goes from 50% to full opacity; chips lift 1px.

**The Living Rule.** At least one element on the page must be visibly changing, and it must be
reporting something true — a timestamp, a countdown, a count. Motion that reports nothing is noise.

**The Quiet Fallback Rule.** `prefers-reduced-motion: reduce` removes every animation and transition
on these elements, and the counts land on their final value immediately. The information survives;
only the movement goes.

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
