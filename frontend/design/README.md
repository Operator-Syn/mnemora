# Design notes

The site uses one visual world, recorded in `../DESIGN.md`. That file and
`../src/styles.css` are the authority; anything here is history.

## How the world was chosen

Three neo-brutalist directions were built as static comps with the real numbers and reviewed side by
side:

- **A — Paper Ledger.** Newspaper accounting: dot-grid paper, black rules, a real table.
- **B — Night Signal.** Terminal after hours: black ground, lime/cyan/magenta, monospace ticker.
- **C — Civic Poster.** Campaign print: sunflower ground, paper panels, Anton at full volume.

**C was chosen** and is now implemented in `src/` — the comp is gone, because a comp that drifts from
the shipped design is worse than no comp. `A` and `B` are kept as the record of what was rejected.

## What the comp did not survive contact with

- The headline was set with `line-height: .86` and a fixed measure; the shipped version uses
  `line-height: 1.04`, `text-wrap: balance`, and no fixed measure, so it wraps rather than clips.
- The orange tape was decoration floating in empty space. It is now the **refresh stamp** and carries
  the collection time — same device, with a job.
- Cream text on sunflower measured **1.57:1**. The shipped system uses an `--on-accent` token
  (`#12100e`) on sunflower and tomato in both themes.
- A hard `#12100e` swatch in the language stack vanished against the dark panel; the first four
  swatches are now theme tokens.
