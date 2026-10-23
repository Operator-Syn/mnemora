# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Recruiters and hiring managers evaluating Yash ("Operator-Syn") as a candidate. They usually arrive
from a CV, a message, or a shared link, with a few minutes and a specific question: is this person's
work real, current, and theirs? They are not necessarily developers, so the page has to be legible
without GitHub literacy.

## Product Purpose

A personal site where the repository data collected by Mnemora is **one section among several**, not
the whole site. Success means a visitor leaves with credible, current evidence of engineering work —
and knows what else the person does, not only what they have committed.

## Positioning

The repository section is served by a pipeline its owner built and operates: an hourly collector, a
Postgres store, and a read-only API. Every number on the page is a stored row rather than a hand-typed
claim. A static portfolio site cannot truthfully copy that, which is what makes the section worth
trusting.

## Operating Context

Visitors read on desktop and phone, often in one pass. The data refreshes on the collector's hourly
schedule, so the page can legitimately be up to an hour stale and must say so honestly rather than
imply live data. The site is reached directly by URL; there is no app install, no login, and no
account.

## Capabilities and Constraints

- **Available data:** public repositories only, with per-repository commit counts, language bytes,
  description, last push time, and per-repository activity. Roughly 25 repositories and ~7,200
  commits at the time of writing.
- **Only public data:** private repositories and private aggregate statistics are not served by the
  API and must not be implied.
- **`commit_count` semantics:** commits returned by the GitHub API for the default branch, including
  merges and bot commits. It is not "authored contributions" and must not be presented as such.
- **Server-held key:** the read API requires a key that lives in the Worker runtime; the browser never
  calls the API directly. That is why the site is server-rendered.
- **Explicitly undecided:** which other sections exist (about, writing, projects, contact), whether a
  contact method is offered, and the production domain.

## Brand Commitments

- **Name:** Mnemora.
- **GitHub identity:** Operator-Syn. The wordmark is the site name; the GitHub handle is attribution,
  not branding.
- No claims about employers, clients, or credentials have been confirmed, so none may be asserted.

## Reference study

The visual and cadence reference for "alive but cohesive" is chriscent.is-a-dev (source:
github.com/KishonShrill/website-portfolio), studied at runtime rather than by eye: 18 concurrent
animations (`blink`, `spin`, `marquee`, `roll-up/down`, `expand-retract`) and 74 elements with
transitions, all inside one terminal/dossier world. What transfers is the *method* — many small,
true signals in one consistent language — not its palette, type, or sci-fi framing.

## Evidence on Hand

- Live API responses from the Mnemora stack (25 repositories, 7,224 commits, collected 2026-10-22).
- The repository itself, which is public and linked.
- **Absences that must not be fabricated:** testimonials, client logos, press mentions, case
  studies, employment history, and performance benchmarks.

## Product Principles

1. **Evidence over assertion.** Prefer a stored number with a clear definition over an adjective. When
   a number needs a caveat, the caveat travels with it. **The page must also show that the evidence is
   live:** a visible refresh time, a running countdown to the next collection, and counts that come
   from the store rather than from prose. A still page of correct numbers still reads as a screenshot
   of a claim; a page that is visibly running reads as a service.
2. **The repository section is a section.** It must not swallow the site; the rest of the person has
   to have somewhere to live.
3. **Recruiter time is the budget.** The most credible thing must be visible in the first screen, and
   nothing may require reading a README to interpret.
4. **A visitor never sees operator instructions.** Failure states speak to the person reading them;
   diagnostics belong in logs or in local development only.
5. **Staleness is stated, not hidden.** The page says when the data was refreshed instead of implying
   it is live.

## Accessibility & Inclusion

No product-specific requirement has been established. WCAG 2.2 AA is the working floor: readable
contrast in both themes, visible keyboard focus, and no information carried by colour alone.
