import { normalizeTypeable } from "../../text/normalize";

/**
 * 200-word race texts for the bot property tests (#361, C2-C5): office prose in the game's voice,
 * accents, punctuation, short common words, long words and rare letters. No real data.
 */
export const FIXTURE_FR = normalizeTypeable(
  "Le commis range les dossiers du bureau avant l'aube. Chaque formulaire porte un tampon, " +
    "une date et une signature lisible. Le directeur attend le rapport complet sur son bureau; " +
    "personne ne quitte la salle avant la fin du quart. Les machines à écrire claquent, le café " +
    "refroidit, la pile baisse. Au troisième étage, une archiviste classe les fiches par ordre " +
    "alphabétique et vérifie chaque numéro. Le kiosque du hall vend des journaux, des " +
    "crayons et des gommes; le gardien note les visiteurs dans un registre. Vers midi, le " +
    "service du courrier livre trois sacs de lettres, et tout le monde se remet au travail sans " +
    "un mot. Un dossier égaré coûte une semaine : il faut le retrouver, le copier, le signer et " +
    "le remettre au bon guichet. La secrétaire tape vite, mais elle relit toujours sa page avant " +
    "de la tendre au chef. Demain, il y aura de nouveaux formulaires, une autre " +
    "pile, le même tampon. Personne ne se plaint : le travail est bien fait, la copie est propre, " +
    "et le dossier part enfin vers le ministère, où quelqu'un, quelque part, le lira peut-être " +
    "en entier. Le zèle du bureau reste exemplaire, et chacun rentre chez soi fatigué mais fier.",
);

export const FIXTURE_EN = normalizeTypeable(
  "The clerk sorts the files on the desk before dawn. Each form has a stamp, a date and a clear " +
    "signature. The director waits for the full report on his desk; nobody leaves the room before " +
    "the end of the shift. The typewriters clatter, the coffee cools, the pile goes down. On the " +
    "third floor, an archivist files the cards in alphabetical order and checks every number " +
    "twice. The kiosk in the hall sells papers, pencils and erasers; the guard writes each visitor " +
    "into a thick register. Around noon, the mail service brings three bags of letters, and " +
    "everyone goes back to work at once. A lost file costs a week: it must be found, " +
    "copied, signed and handed to the right window. The secretary types fast, but she always " +
    "reads her page again before she gives it to the chief. Tomorrow there " +
    "will be new forms, another pile, the same stamp. Nobody complains: the job is well done, the " +
    "copy is clean, and the file finally leaves for the ministry, where someone, somewhere, will " +
    "perhaps read it with quiet attention. The zeal of the office is exemplary, and the staff " +
    "go home tired but proud of the jazz quiz.",
);
