# Privacy file (Law 25)

Fifth Copy is a typing race game used by students aged 12 to 17, often in class. This folder is its privacy file under
Québec's Law 25 (Act respecting the protection of personal information in the private sector, as amended). Each
document has one job; read them in this order. Epic #29, card #71.

The project wrote these documents itself to protect its users. They state how the system is designed and where the
project sees risk. They do not say the project is compliant, and they are not legal advice.

## Documents

| Document | What it answers | Owner card |
|---|---|---|
| [inventory.md](inventory.md) | What personal information exists, why, where it lives and what deletes it | #71 |
| [retention.md](retention.md) | How long each kind of information is kept (the only place with periods) | #71 |
| [consent.md](consent.md) | Who agrees to what, the school's role, the parent letter (the only place with the consent position) | #71 |
| [pia.md](pia.md) | Privacy impact assessment: data flows, risks for minors, mitigations, residual risk | #71 |
| [responsible.md](responsible.md) | Who is in charge of personal information and how to reach them | #75 |
| [deletion-procedure.md](deletion-procedure.md) | How an account and its data are deleted, on request or by the student | #81 |
| [backup-retention.md](backup-retention.md) | What backups hold, where, and when deleted data leaves them | #81 |
| [moderation.md](moderation.md) | How usernames, avatars and flagged races are handled, and appeals | #91 |

The privacy page that students and parents read is `/privacy` (#76); it takes its facts from these documents.

## Keeping it true

- A new Prisma model needs a row in [inventory.md](inventory.md), or a place in its "Non-personal models" list, in
  the same PR. `npx tsx scripts/privacy-inventory-check.ts` (step `privacy` of `scripts/check.sh`) fails otherwise.
- A new kind of personal information, a new third party or a new place where data is stored also updates
  [pia.md](pia.md) in the same PR.
- A changed period is changed in [retention.md](retention.md) only, then in the code that enforces it and on the
  privacy page.

## Review

The whole file is reviewed every year, before each school year starts (by the end of August), and before the classroom
pilot (#432). A review rereads every document against the code and the schema, updates the PIA's risk table, and
changes the date below in the same PR.

Last review: 2026-10-06

## Needs qualified review

Each document that applies the law ends with a numbered "Needs qualified review" list: [consent.md](consent.md),
[pia.md](pia.md) and [moderation.md](moderation.md); [responsible.md](responsible.md) lists its open items under "Before
launch". A qualified person (a lawyer, the school's or the cégep's privacy officer, or both) goes through those lists
before the classroom pilot (#432).
