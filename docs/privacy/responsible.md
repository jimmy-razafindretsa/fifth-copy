# Person in charge of the protection of personal information

Québec Law 25 (Act respecting the protection of personal information in the private sector, s. 3.1): the person
with the highest authority in the enterprise is in charge of protecting personal information by default, may
delegate that function in writing, and the enterprise publishes that person's title and contact information on
its website. This file is the source for what the privacy page (#80, epic #29) publishes. Requirement: R165.

## Person in charge

| Field | Value |
|---|---|
| Name | Jimmy Razafindretsa |
| Role | Student at Cégep de Sorel-Tracy, developer and operator of Fifth Copy |
| Function | Person in charge of the protection of personal information for Fifth Copy |

## Delegation

None. Fifth Copy is run by Jimmy Razafindretsa as its operator, who holds the highest authority over it and is
in charge by default under s. 3.1. If the project is later run by an organisation (for example the cégep), the
person with the highest authority there is in charge unless they delegate in writing, and this file changes.

## Contact channel

Fifth Copy collects no email address (ADR 0009) and its users are minors. Contact never requires a student to
give the app an email or any other new personal information.

- **Students**: the in-app `/privacy` section tells them to go through their teacher or their school office.
  The teacher or school forwards the request (access, correction, deletion, complaint) to the person in charge.
- **Teachers, schools and parents**: the `/privacy` page publishes the person in charge's name, role and a
  contact address for the person in charge (`<contact address, to fill before launch>`). Publishing the
  operator's own address collects nothing from users and is what s. 3.1 asks for.
- Requests are answered within 30 days (Law 25, s. 32); the deletion procedure itself is #81.

## Publication

- Where: the privacy page `/privacy` (#76 / #80), French first then English, in a "Person in charge" section
  showing the name, role, the student route (teacher or school office) and the contact address.
- The page reads its values from this file's table; when this file changes, the page changes in the same PR.

## Before launch (open items)

1. Contact address filled in above.
2. Before the classroom pilot (#432), check with Cégep de Sorel-Tracy whether the pilot falls under the cégep's own
   privacy officer (public-sector access act), and have a qualified person review the Law 25 file (#71) and the
   privacy page (#76). This file applies s. 3.1 as written; it is not legal advice.
