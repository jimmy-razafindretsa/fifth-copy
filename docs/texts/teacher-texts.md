# Teacher-written texts

How a teacher submits race texts of their own. In v1 there is no upload screen: a teacher sends the text to the Fifth Copy team, who adds it as a content file and loads it into the database corpus with `scripts/import-texts.ts` (`docs/ops/runbook.md` "Import texts", #346). Licence background: `docs/texts/sources.md`.

## What a teacher may submit
- **Their own writing**, in English or French, which they agree to let Fifth Copy use in races.
- **A public-domain text** they chose (author, and translator if any, died in 1971 or earlier), with the edition it comes from.
- Never: a text written by a student, a text still under copyright (a recent novel, a textbook, song lyrics), a film or TV quote, or anything copied from a website without its source.

## Length
One passage is **12 to 80 words** (`PASSAGE_WORDS` in `src/features/texts/corpus/schema.ts`). A longer text is cut into passages at sentence ends. Use only characters a keyboard can type: letters (French accents included), digits, ordinary punctuation, « » and €; curly quotes and long dashes are converted automatically.

## The 12-17 rules
The players are 12 to 17. A passage must contain:
- no violence against children, and no graphic violence;
- no slurs, insults or profanity (`isClean` refuses them automatically);
- no sexual content;
- no mockery of a group (origin, religion, gender, disability, appearance);
- **never** a real student's name, a classmate's name, a nickname, or anything that identifies a person.

The team reads every submitted text before it is used and records the date in `reviewed`.

## How licence and authorship are recorded
| Field | Teacher text |
|---|---|
| `authorType` | `"teacher"` |
| `source` | the school's name, or `"teacher-written"`; **never** the teacher's or any person's name |
| `licence` | `"teacher-written"` (use granted to Fifth Copy), or a named licence such as `"CC BY 4.0"` if the teacher chooses one |
| `reviewed` | the ISO date of the team's read |

A public-domain text a teacher submits is recorded like any other public-domain work (`authorType: "public-domain"`, the author and edition in `source`). Keeping persons out of `source` keeps the `Text` model non-personal (`docs/privacy/inventory.md`).
