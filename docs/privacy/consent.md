# Consent position for students under 14

Who agrees to what when a student uses Fifth Copy, and why the app has no in-app consent screen. Card #71 (epic #29),
replacing the spike #73. Requirements: R1, R165. Index: [README](README.md).

This is the project's reading of the law, written by the project and not by a lawyer. It is not legal advice and must
not be presented as such. The points a qualified person must check are listed in
[Needs qualified review](#needs-qualified-review).

## Decision

Decision: none (2026-10-04)

There is no in-app consent flow. Classroom use of Fifth Copy runs under the school's mandate: the teacher decides to
use it in class, and before the first class the school or teacher sends parents the information letter below. The app
itself never asks a student for consent, a parent's contact or an age. Card #94 (in-app consent flow for students under
14) was canceled (closed as not planned) on that decision.

Why: an in-app consent flow would need a parent's email or phone number, which means collecting more personal
information about more people, from minors, in an app that is built to collect none (ADR 0009). The project judged that
minimal data plus school-mandated use with parent information protects students better than a form a 12-year-old can
fill in alone. The limits of that choice are stated below, not hidden.

## The law the decision applies

Act respecting the protection of personal information in the private sector, CQLR c. P-39.1, as amended by Law 25
([LégisQuébec, c. P-39.1](https://www.legisquebec.gouv.qc.ca/en/document/cs/P-39.1)):

- **s. 4.1**: personal information about a minor under 14 may not be collected from them without the consent of the
  person having parental authority or the tutor, unless collecting it is clearly for the minor's benefit (the
  "benefit exception"). From 14, a minor may consent alone (s. 14).
- **s. 5**: collect only the information needed for the purpose stated.
- **s. 8**: tell people, when collecting, why, how, who sees it and what their rights are. The privacy page `/privacy`
  (#76) and the letter below do this.
- **s. 3.3**: a privacy impact assessment for any project involving personal information: [pia.md](pia.md).

Schools act under their own mandate (Education Act) and their own privacy rules as public bodies. When a teacher uses a
tool in class, the school decides whether the tool is part of its teaching and informs parents its own way.

## Account types

| Account type | What the student gives | What the app records | Who can use it | Consent position |
|---|---|---|---|---|
| Guest (default) | Nothing | A generated typist name, races, typing stats, under a cookie id ([inventory](inventory.md)) | Anyone | Under the school's mandate in class; outside class see [Residual risk](#residual-risk) |
| Username account | A username and a password, no email, no real name | Same as guest, plus the username, a password hash and a recovery code hash | Anyone; the conduct rules ask students not to use their full real name | Same as guest. The account is the student's choice, never required by a teacher |
| GitHub or Discord sign-in (OAuth) | Signs in with an account they already have | Provider name, provider account id and login, optionally the provider's picture | Students 13 or older: GitHub and Discord both require users to be at least 13 under their own terms | The sign-in buttons carry an under-13 notice (#49): students under 13 use a guest or username account. Fifth Copy does not check ages |

No account type collects an email address, a phone number, a birth date, a school name or a real name.

## What the school and the teacher do

1. **Decide.** The teacher (with the school's agreement where the school requires it) decides to use Fifth Copy in
   class. A student is never required to create an account: a guest is enough for every classroom activity.
2. **Inform parents first.** Before the first class, send the letter below (French, English, or both), filled in. The
   school may use its own channel (portal, agenda, email).
3. **Offer a way out.** A parent who does not want their child to use the app tells the teacher; the student does an
   equivalent typing activity without it. The teacher does not have to give the operator a reason or a name.
4. **Run class safely.** Host private lobbies (room code, single-use invites), remind students not to use their full real name, and
   remove a player from a lobby when needed ([moderation.md](moderation.md)).
5. **Pass on requests.** Students and parents send access, correction or deletion requests through the teacher or the
   school office, who forwards them to the person in charge ([responsible.md](responsible.md)). Answer within 30 days.

## Residual risk

Fifth Copy is also open outside class: a student can play a public Quick race at home. No school mandate covers that
use, and the app collects no consent. The project accepts this risk because the app collects so little (guest by
default, generated names, no contact details, avatars only in lobbies) and because inactive guests are deleted after
the period in [retention.md](retention.md). The [PIA](pia.md) records it as a residual risk. If a qualified review says
this is not enough, the fix is a new card, not a change to this file alone.

## Parent information letter

**When to send it.** Send the letter only once the deletion in settings (#81), the 12-month guest deletion (#86) and
the 30-day keystroke deletion (#315) are delivered, or once the privacy page `/privacy` (#76) says they are live. The
letter describes them as facts; until then, it would promise something the app does not do yet.

The teacher copies the letter, fills in the brackets and removes this line.

### Lettre aux parents (français)

> Objet : utilisation de Fifth Copy en classe
>
> Bonjour,
>
> Dans le cours de [matière], votre enfant utilisera Fifth Copy, un jeu de course de dactylographie, à partir du
> [date]. Les élèves tapent un texte en même temps et voient leur vitesse et leur précision.
>
> **Ce que l'application garde.** Un nom de joueur généré au hasard (par exemple « Loutre-482 »), les résultats des
> courses et des statistiques de frappe (vitesse, erreurs par touche). Les touches tapées une à une sont effacées après
> 30 jours. Si votre enfant crée un compte, il choisit un nom d'utilisateur et un mot de passe.
>
> **Ce que l'application ne demande jamais.** Ni courriel, ni téléphone, ni date de naissance, ni nom réel, ni nom de
> l'école. Il n'y a pas de clavardage. Une photo de profil est facultative. Seuls les joueurs de la même partie la
> voient, ainsi que la personne responsable, uniquement pour vérifier qu'elle respecte les règles quand elle est
> retenue pour vérification ou signalée.
>
> **Combien de temps.** Un profil invité qui n'est plus utilisé pendant 12 mois est effacé. Votre enfant peut effacer
> son compte en tout temps dans les paramètres. Le détail est sur la page `/privacy` de l'application.
>
> **Vos droits.** Vous pouvez demander à voir, corriger ou effacer les renseignements de votre enfant. Passez par moi
> ou par le secrétariat de l'école : nous transmettons la demande à la personne responsable, qui répond dans les 30
> jours.
>
> **Si vous préférez que votre enfant n'utilise pas Fifth Copy**, dites-le-moi avant le [date]. Votre enfant fera une
> activité de dactylographie équivalente sans l'application. Vous n'avez pas à vous justifier.
>
> Fifth Copy est un projet étudiant exploité par [nom de la personne responsable]. Responsable de la protection des
> renseignements personnels : [nom], [adresse de contact].
>
> Merci,
> [nom de l'enseignant ou de l'enseignante], [école], [moyen de me joindre]

### Letter to parents (English)

> Subject: using Fifth Copy in class
>
> Hello,
>
> In [subject] class, your child will use Fifth Copy, a typing race game, starting [date]. Students type the same text
> at the same time and see their speed and accuracy.
>
> **What the app keeps.** A randomly generated player name (for example "Otter-482"), race results and typing
> statistics (speed, errors per key). The individual keys typed are deleted after 30 days. If your child creates an
> account, they choose a username and a password.
>
> **What the app never asks for.** No email, phone number, birth date, real name or school name. There is no chat. A
> profile picture is optional. Only the players in the same game can see it, and the person in charge, only to check
> it against the rules when it is held for review or reported.
>
> **How long.** A guest profile that is not used for 12 months is deleted. Your child can delete their account at any
> time in the settings. The details are on the app's `/privacy` page.
>
> **Your rights.** You can ask to see, correct or delete your child's information. Go through me or the school office:
> we forward the request to the person in charge, who answers within 30 days.
>
> **If you would rather your child did not use Fifth Copy**, tell me before [date]. Your child will do an equivalent
> typing activity without the app. You do not need to give a reason.
>
> Fifth Copy is a student project run by [name of the person in charge]. Person in charge of the protection of
> personal information: [name], [contact address].
>
> Thank you,
> [teacher's name], [school], [how to reach me]

The periods in the letter (30 days, 12 months) come from [retention.md](retention.md). When a period changes there,
change both letters in the same PR.

## Needs qualified review

Open items for a qualified person (a lawyer, the school's or the cégep's privacy officer, or both) before the classroom
pilot (#432):

1. **School mandate and a third-party operator.** Whether a school's teaching mandate covers collection by Fifth
   Copy, a tool run by a student who is not the school, or whether the school must sign an agreement with the operator
   (and whether the public-sector access act then applies instead of, or as well as, the private-sector act).
2. **Is a letter enough under s. 4.1?** Whether an information letter with an opt-out is enough for students under 14
   in class, or whether written parental consent is required, or whether the benefit exception applies to a typing
   activity chosen by the teacher.
3. **Use outside class.** Students under 14 can use the app at home or in a public Quick race, where no mandate applies
   and no consent is collected ([Residual risk](#residual-risk)). Whether minimal data and the guest default are enough.
4. **Is Fifth Copy an "enterprise"?** Whether a free, non-commercial student project falls under the private-sector act
   at all, and which obligations apply if it does not.
5. **Servers outside Québec (s. 17).** The hosting provider and backup location are not decided yet (#445,
   ARCHITECTURE 13). If either is outside Québec, an assessment under s. 17 is needed before launch.
6. **Wording of the letter.** Whether the letter gives everything s. 8 requires, in words parents and students
   understand.
7. **Person in charge.** Whether the pilot falls under the cégep's own privacy officer ([responsible.md](responsible.md)).
