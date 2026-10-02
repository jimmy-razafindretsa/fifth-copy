# Component inventory (`src/components/ui`)

Status: starter set. Visual direction needs human approval (Foundations design-tokens card is `ui` + `autonomy:hitl`).
Living page: `/design` (`src/app/design/page.tsx`); tests: `e2e/design.spec.ts` (visual baselines tagged `@visual`).

## Rules
- Tokens only: `docs/design/tokens.css` is the single source. Tailwind's default palette is removed, so `bg-zinc-50` does not exist; use semantic utilities (`bg-surface`, `text-fg`, `text-fg-muted`, `border-border`, `bg-primary`, `text-danger`, ...). Spacing uses the Tailwind scale (`p-4`), radius `rounded-{sm,md,lg,full}`, type `text-{xs..3xl}`.
- Themes: light by default, dark via `prefers-color-scheme` or `<html data-theme="dark">`. Never use `dark:` color overrides; the tokens switch.
- Breakpoints, mobile first: base = mobile (375), `md:` = tablet (768), `xl:` = desktop (1280).
- Primitives import nothing from features, server or env (boundary-enforced). Import from `@/components/ui`.
- Every interactive primitive is a real element (`button`, `input`, `a`), keyboard reachable, with visible focus (global `:focus-visible` outline).
- New primitive: add it here and on `/design` in the same PR.

## Primitives
| Component | File | Props / variants | States | A11y notes |
|---|---|---|---|---|
| `Button` | `button.tsx` | `variant` primary, secondary, ghost, danger; `size` sm, md, lg; `loading`; native button props | default, hover, focus, disabled, loading | `type="button"` by default; `loading` sets `aria-busy` and disables |
| `Field` | `field.tsx` | `label` (required), `hint`, `error`, native input props | default, focus, invalid, required | visible `<label>`; `aria-invalid` + `aria-describedby` link hint/error |
| `Card` | `card.tsx` | div props | n/a | container only; put a heading inside |
| `Alert` | `alert.tsx` | `tone` info, success, error; `title`; children | n/a | error = `role="alert"`, others `role="status"` |
| `Spinner` | `spinner.tsx` | `size` sm, md, lg; `label` (default "Loading", `""` = decorative) | n/a | `role="status"` when labelled |
| `Skeleton` | `skeleton.tsx` | `className` for size | n/a | `aria-hidden`; wrap groups in `aria-busy` container with a label |
| `EmptyState` | `empty-state.tsx` | `title`, `description`, `action` | n/a | give it a clear next step via `action` |

## Screen states checklist (every `ui` card)
empty (`EmptyState`), loading (`Skeleton`/`Spinner` inside an `aria-busy` region), error (`Alert tone="error"`), populated. Mobile, tablet, desktop. Light and dark.

## Utilities
`cn(...)` in `src/lib/cn.ts` joins class names.
