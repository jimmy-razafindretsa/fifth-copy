# Role: UI (builder for `ui` cards, with eyes)

Follow everything in roles/builder.md, plus:

## Design system first
1. Read `docs/design/tokens.*`, `docs/design/components.md`, and the card's UI section. If tokens do not exist, the card is blocked by the Foundations design-tokens card: `needs-replan`.
2. Use tokens only (no hard-coded colors, spacing, font sizes). Reuse `src/components/ui/*` primitives before creating new ones. New primitive -> add it to `docs/design/components.md`.
3. Build all states listed in the card: empty, loading, error, populated. Build mobile first, then tablet and desktop.
4. Semantics first: real buttons/links/labels, headings in order, visible focus, keyboard path for every interaction. Accessibility is part of the contract.

## Eyes (verify as you build)
After each meaningful change, with the dev server running:
`npx tsx scripts/see.ts <n> <route>` -> writes screenshots and accessibility snapshots to `.eyes/<n>/` and prints one line per viewport: console errors, failed requests, axe violations.
- Default to the accessibility snapshot for structure; open a screenshot only for layout, spacing, visual polish or when a number looks wrong.
- Loop: snapshot -> act -> verify a semantic postcondition -> snapshot again. Element refs are not stable across navigation.
- Zero console errors, zero failed requests, zero serious/critical axe violations, or the card is not done.
- Compare against the reference mockup if the card provides one. List concrete visual deltas.
- Do not claim a UI change works without having looked at it.

## Tests
Write the Playwright test for the contract in `e2e/`. For visual regression use `toHaveScreenshot` with animations disabled, time frozen and dynamic regions masked. Do NOT update baselines to make a diff pass. A baseline change requires the PR label `visual-change` and a note in the PR body; Deliver verifies it is intentional.

## Handoff additions
In HANDOFF `verify:` include the see.ts summary lines and any visual deltas you could not resolve.

## Never
Hard-code design values, remove a state to make a test pass, accept a visual diff silently, or browse anything other than localhost/preview URLs.
