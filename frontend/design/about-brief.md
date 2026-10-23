# /about — design brief

Mode: **Read.** The visitor is not deciding about a product; they are checking whether the person
and the work are credible, then leaving.

## Job and audience

A recruiter or hiring manager who arrived from the repository section and wants to know what they are
actually looking at. Their state of mind is "is this a generated portfolio or someone's real work?"
They arrive with a few minutes, on desktop or phone.

## Outcome and proof

They should leave knowing the repository data is produced by a pipeline the site's owner built and
operates, and be able to check that claim (the pipeline lives in a public repository). Success is one
of: they click through to the code, or they make contact.

Proof available, all real: the stack as deployed (n8n queue worker, Postgres, Redis, nginx,
Cloudflare Worker), the refresh time from the API, and the live counts on the home page. No
testimonials, no client logos, no employment claims — none exist and none may be invented.

## Selected direction

The Civic Poster world, already committed, in its **Read** register: the poster recedes into typeset
columns. Focal moment is the four-step pipeline — collect, store, serve, render — because that
sequence is the argument. The rotated refresh stamp stays, since freshness is part of the claim.
Numbered steps are earned here: the order is the information.

## Scope and boundaries

One page, server-rendered, no interactivity beyond links. Untouched: the home route, masthead, footer,
palette, type scale. Anti-goals: a résumé dump, a skills-wordwall, an "About me" essay, anything that
duplicates syn-forge.com rather than linking to it.

## States and ranges

Live counts come from the same server function as the home page. If the API fails, the page omits the
numbers entirely rather than showing zeros — a build page that says "0 commits" reads as broken.

## Constraints and open decisions

- Facts only: `PRODUCT.md`, the repository, and the public portfolio at syn-forge.com. Bio detail is
  linked out, not restated.
- AA contrast in both themes; text measured from computed styles, not assumed.
- Contact: email, GitHub, LinkedIn — all published values, no placeholders.
- Undecided and out of scope: a CV download, a writing section, analytics.
