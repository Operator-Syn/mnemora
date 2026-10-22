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
    fontSize: "clamp(40px, 7.4vw, 104px)"
    fontWeight: 400
    lineHeight: 1.04
    letterSpacing: "-0.015em"
  body:
    fontFamily: "Public Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "18px"
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

- **Display** (400, clamp(40px, 7.4vw, 104px), 1.04): the headline only. Uppercase, tracking -0.015em.
- **Headline** (400, 19–24px, 1.08): panel and section titles. Same face, small.
- **Body** (400/600, 18px, 1.5, max 56ch): the lede and any explanation.
- **Card body** (400, 12.5px, 1.45): repository descriptions.
- **Label** (400, 11.5px, 0.12em, uppercase): masthead chips, legends, timestamps, card feet.

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

### Navigation

Masthead: wordmark set in Anton, split across ink and a tomato block ("Mne" ink, "mora" on tomato), a sunflower chip
dating the collection, then uppercase links with a 3px ink underline on hover and sunflower highlight
on the active route. Hidden below 900px.

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
