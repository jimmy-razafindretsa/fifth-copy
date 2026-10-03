---
id: "0010"
title: UI language from a cookie (no URL prefix), typed message catalogs in src/i18n, race language independent
status: proposed
category: ui
scope: ["src/i18n/**", "src/app/**", "src/proxy.ts", "src/components/**"]
supersedes: []
rule: UI strings come from typed catalogs in src/i18n (fr, en) through t() on the server and useT() on the client; the locale is a cookie chosen in the header and remembered per user, never a URL segment; race texts carry their own language and are never translated.
---

# 0010. UI language from a cookie (no URL prefix), typed message catalogs in `src/i18n`, race language independent

## Context
Full UI in French and English with a header toggle remembered per user (R188, R189); race language independent from UI language (R190); every in-world label exists in both languages (R191). Room codes and invite links must work regardless of language. Card #371.

## Decision
- **No locale in the URL.** `/lobby/KGB-4821` is the same link for everyone. The locale is the cookie `locale` (`fr` | `en`), set by the header toggle (server action), defaulted by `proxy.ts` from `Accept-Language` on the first visit, and copied to `User.preferences` when signed in so it follows the user across devices.
- **Catalogs:** `src/i18n/messages/fr.ts` and `en.ts` are `as const` objects with identical keys (type-checked: `en` must satisfy `typeof fr`). Namespaced by screen (`landing.quickRace`), with a tiny ICU-like helper for plurals and interpolation. No i18n library.
- **Server:** `const t = await getT()` reads the cookie once per request (`cookies()` is dynamic, so pages that use it render per request; cache data below the component, not the page). **Client:** `useT()` from a provider that receives only the current locale's catalog. Leaf components get strings as props when possible so most of the tree stays server-rendered.
- **In-world bilingual labels** (`ОБГОН! · OVERTAKE / DÉPASSEMENT`) are catalog entries too; the Cyrillic part is shared.
- **Race texts** are data (`Text.language`) and are shown verbatim; the host setting chooses the race language (R108), the UI language stays as is.
- `<html lang>` follows the cookie; dates and numbers format with `Intl` and the same locale.

## Consequences
- Static prerendering of pages that read the cookie is not possible; this app is per-user anyway (viewer, theme), so nothing is lost.
- Copy decks (cards #375-#381) land as catalog entries; missing keys fail type-check, not at runtime.

## Alternatives considered
- **`/fr/...` and `/en/...` routes with `next-intl`:** better for SEO and static pages, but this app has no public content to index and prefixed links would complicate room codes and invites. Rejected.
- **`next-intl` without routing:** solid library, but it adds a dependency and a message-loading layer for two locales and a few hundred strings. Revisit if pluralisation rules grow.
