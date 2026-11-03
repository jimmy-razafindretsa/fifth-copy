# Race text sources and licences

What Fifth Copy may use as race text ("intercepted cables"), where it may come from, and how each content file records it. Format and guard: `src/features/texts/corpus/schema.ts` (#351). Corpus: `src/features/texts/corpus/content/{en,fr}/`, one JSON file per work. Teacher texts: `docs/texts/teacher-texts.md`.

This note records the project's working position for a classroom tool used in Québec. It is not legal advice; a doubtful work stays out.

## Rule for v1
1. Only two kinds of text: **public-domain** literature (`authorType: "public-domain"`) and **teacher-written** texts (`authorType: "teacher"`).
2. **Film quotes are out of v1** (spec section 8, open question 3; R121). No source licenses short film or TV quotes for this use, and a quote "short enough" is not a licence. They come back only with a written licence and a new card.
3. A passage is the exact text of the cited edition, never retyped from memory or paraphrased. The only changes allowed are the ones `normalizeTypeable` makes (curly quotes to straight, dashes to `-`, whitespace collapsed) and dropping italics markers (`_word_` in Gutenberg plain text).
4. Readers are 12 to 17: no violence against children, no slurs, no sexual content, no mockery of a group. `isClean` catches words; the curator's read catches the rest and sets `reviewed`.

## Public domain in Québec (Canada)
Canadian copyright lasts the author's life plus 70 years since 30 December 2022; the extension did not revive expired rights. So a work is usable when **its author died in 1971 or earlier** (and, for a translation, **its translator too**: a translation has its own copyright). The same date test applies whatever site the text comes from: the site never makes a protected work free, and a free site's own notes, prefaces or modern translations can still be protected. Use the original text only, never a site's editorial additions.

## Sources

| Source | Licence position for use in Québec | Attribution pattern in `source` | v1 use |
|---|---|---|---|
| **Project Gutenberg** (gutenberg.org) | The texts are public domain in the United States; check the Canadian date test above per author and translator. Gutenberg's licence and trademark cover redistributing its ebook files under its name; quoting the public-domain text of a work, without Gutenberg's header, footer or branding, is not a redistribution of the ebook. We name the ebook only to record provenance. | `<Author>, <Title> (<year of first publication>), Project Gutenberg eBook #<n>`; a translation adds `translated by <translator> (<year>)` | **all 30 files** (see below) |
| **BAnQ numérique** (numerique.banq.qc.ca) | Bibliothèque et Archives nationales du Québec publishes scans and transcriptions; each record shows its rights status. Use only records marked public domain, and keep the underlying work's date test. BAnQ asks that it be named as the source. | `<Author>, <Title> (<year>), BAnQ numérique` | none yet (best source for Québec authors in a later pass) |
| **Gallica** (gallica.bnf.fr, Bibliothèque nationale de France) | The works are public domain, but BnF's reuse conditions cover its digital reproductions: non-commercial reuse is free with the mention "Source gallica.bnf.fr / BnF"; commercial reuse needs a BnF licence. Fifth Copy uses Gallica only to check a text against a first edition, never as a bulk source, unless a later card settles the commercial question. | `<Author>, <Title> (<year>), Source gallica.bnf.fr / BnF` | none (check only) |
| **Wikisource FR / EN** (fr.wikisource.org, en.wikisource.org) | Transcriptions of public-domain works stay public domain; the site's own contributions (notes, introductions, user translations) are CC BY-SA 4.0 and are never copied into the corpus. | `<Author>, <Title> (<year>), Wikisource` | none yet (second check for a doubtful Gutenberg edition) |
| **Teacher-written** | The teacher keeps the rights and grants Fifth Copy the use of the text in races; rules in `docs/texts/teacher-texts.md`. | a school name or `teacher-written`, never a person | none in the file corpus (teacher texts come with #346) |
| **Film and TV quotes** | No licence: out of v1. | n/a | none |

Every content file also states `licence`: `public domain` for the works above, `teacher-written` for teacher texts (or a named CC licence when a teacher releases one).

## How the v1 passages were verified
For each content file, the Project Gutenberg plain text named in its `source` (`https://www.gutenberg.org/cache/epub/<n>/pg<n>.txt`) was fetched, its title and author lines checked against the file, and every passage checked as a verbatim substring of that text in comparison form (`normalizeTypeable`, `_` dropped, `--` read as `-`). All 184 passages matched (card #342). Authors and translators all died before 1972: the most recent is Alain-Fournier (died 1914) and, for translations, Constance Garnett (died 1946).

| Language | Files (works) | Passages |
|---|---|---|
| English | 18 | 96 |
| French | 12 | 88 |

## Frequency lists (random-word races)
`src/features/texts/corpus/words/{en,fr}.json` hold about 5,000 words each, ranked by mean relative frequency. They were counted for Fifth Copy (#351) over the public-domain Project Gutenberg novels each file's `source` names: word counts of public-domain texts carry no third-party right, so their `licence` is `public domain (counts derived from public-domain works)`. No external frequency list (Lexique, SUBTLEX, Google Books Ngram) is copied; any later import must state its own named licence in `licence`. Reviewed for 12 to 17 by #342: explicit sexual words, profanity, self-harm words, insults and a word used against Roma people were removed (the list is in the PR of #342); ordinary literary vocabulary stays.
