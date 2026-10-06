# Person in charge of the protection of personal information

Québec Law 25 (Act respecting the protection of personal information in the private sector, s. 3.1): the person
with the highest authority in the enterprise is in charge of protecting personal information by default, may
delegate that function in writing, and the enterprise publishes that person's title and contact information on
its website. This file is the source for what the privacy page (#80, epic #29) publishes. Requirement: R165.

## Person in charge

| Field | Value |
|---|---|
| Name | Jimmy Razafindretsa |
| Role | Developer, Aegis Corp |
| Function | Person in charge of the protection of personal information for Fifth Copy |

## Delegation

Jimmy Razafindretsa is a developer at Aegis Corp, not (as far as this file records) the person with the highest
authority there. Under s. 3.1 the function stays with that person unless it is **delegated in writing**.

- Status: **delegation letter pending**. Before launch (classroom pilot, #432), Aegis Corp's highest authority
  signs a short written delegation naming Jimmy Razafindretsa as person in charge for Fifth Copy.
- The signed letter is kept outside the repository (it is a corporate record); this file records only that it
  exists and its date: `Delegation signed: <date, to fill when signed>`.
- If the delegation is not signed, the privacy page names Aegis Corp's highest authority instead.

## Contact channel

Fifth Copy collects no email address (ADR 0009) and its users are minors. Contact never requires a student to
give the app an email or any other new personal information.

- **Students**: the in-app `/privacy` section tells them to go through their teacher or their school office.
  The teacher or school forwards the request (access, correction, deletion, complaint) to the person in charge.
- **Teachers, schools and parents**: the `/privacy` page publishes the person in charge's name, role and a
  professional contact address of Aegis Corp (`<Aegis Corp contact address, to fill before launch>`). Publishing
  the enterprise's own address collects nothing from users and is what s. 3.1 asks for.
- Requests are answered within 30 days (Law 25, s. 32); the deletion procedure itself is #81.

## Publication

- Where: the privacy page `/privacy` (#76 / #80), French first then English, in a "Person in charge" section
  showing the name, role, the student route (teacher or school office) and the Aegis Corp contact address.
- The page reads its values from this file's table; when this file changes, the page changes in the same PR.

## Before launch (open items)

1. Signed written delegation from Aegis Corp's highest authority (see Delegation).
2. Aegis Corp contact address filled in above.
3. A lawyer or Aegis Corp's legal contact reviews the Law 25 file (#71) and the privacy page (#76) before the
   pilot. This file applies s. 3.1 as written; it is not legal advice.
