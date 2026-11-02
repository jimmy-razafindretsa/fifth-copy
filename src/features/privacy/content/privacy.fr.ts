import type { PrivacySection } from "./types";

/**
 * Page de confidentialité, français (carte #76). French first on `/privacy` (Québec, Law 25), for players aged
 * 12 to 17: Québec French, "tu" form (bible 2), short sentences. Keep in step with `privacy.en.ts` (same ids,
 * same number of paragraphs and list items; `content.test.ts` checks parity, plain language and the facts).
 * Every fact comes from `docs/privacy/*` and the ADRs (0009, 0014, 0019). What is not delivered yet (#36
 * accounts, #38 session cookie, #49 GitHub and Discord, #81 self-service deletion, #86 and #315 purges) is
 * written in the future tense ("bientôt"), never as a present fact (owner decision, 2026-11-02).
 * Not reviewed by a lawyer (#438).
 */
export const privacyFr: readonly PrivacySection[] = [
  {
    id: "collect",
    heading: "Ce qu'on recueille",
    paragraphs: [
      "Fifth Copy ne te demande jamais ton courriel, ton vrai nom, ta date de naissance ni ton école.",
      "La plupart des élèves jouent comme invités. Voici ce que le jeu garde sur toi.",
    ],
    list: [
      "Un numéro d'invité, gardé dans un témoin de ton navigateur.",
      "Ton nom de dactylo. Pour les invités, il est créé au hasard, comme Moineau-482.",
      "Tes résultats de course : vitesse, précision, rang et temps.",
      "Les touches que tu tapes pendant une course, avec leur rythme.",
      "L'allure de ton commis en 3D et tes réglages, comme la langue et le thème.",
      "L'adresse de ton appareil sur Internet (IP), quand il parle à nos serveurs.",
      "Ta photo de profil, seulement si tu en ajoutes une.",
      "Bientôt, si tu crées un compte : ton nom d'utilisateur et ton mot de passe brouillé, jamais le mot de passe lui-même.",
    ],
  },
  {
    id: "why",
    heading: "Pourquoi on le recueille",
    paragraphs: [
      "On garde seulement ce dont le jeu a besoin pour fonctionner.",
      "On ne vend rien. On ne montre pas de publicité. On n'envoie rien à un service qui mesure les visites.",
    ],
    list: [
      "Ton numéro d'invité relie tes résultats et tes réglages à toi, sans mot de passe.",
      "Ton nom de dactylo aide les joueurs à se reconnaître dans un salon.",
      "Tes résultats servent à ton historique, à tes statistiques et au classement.",
      "Tes touches servent aux statistiques par touche et à repérer la triche.",
      "Ton adresse IP sert à trouver les erreurs et les abus.",
      "Ton commis et tes réglages servent seulement à afficher ce que tu as choisi.",
    ],
  },
  {
    id: "retention",
    heading: "Combien de temps on le garde",
    paragraphs: [
      "On ne garde rien plus longtemps que nécessaire. Voici la durée pour chaque chose.",
      "Les effacements automatiques des invités et des touches arrivent bientôt.",
    ],
    list: [
      "Compte d'invité inactif : il sera effacé après 12 mois sans course, connexion ni changement de réglage.",
      "Compte avec nom d'utilisateur, bientôt : gardé jusqu'à ce que tu le supprimes, ou que ton école le demande.",
      "Touches tapées pendant une course : elles seront effacées 30 jours après la course.",
      "Journaux des serveurs et adresses IP : 30 jours.",
      "Salons : 24 heures après leur fermeture.",
      "Salles de course en direct : 1 heure après la dernière activité.",
      "Copies de sauvegarde : 14 jours, puis elles sont remplacées.",
      "Témoins dans ton navigateur : 1 an au plus.",
    ],
  },
  {
    id: "avatars",
    heading: "Qui voit ta photo",
    paragraphs: [
      "La photo de profil est optionnelle. Si tu en ajoutes une, seuls les joueurs de ton salon la voient.",
      "Un filtre vérifie chaque nouvelle photo sur notre serveur. Ta photo n'est jamais envoyée ailleurs pour être vérifiée.",
      "La personne responsable regarde ta photo seulement si elle est mise en attente ou signalée. Elle la regarde pour décider, sans la copier.",
      "Une photo refusée est effacée tout de suite.",
    ],
  },
  {
    id: "delete",
    heading: "Effacer mes données",
    paragraphs: [
      "Tu peux demander qu'on efface toutes tes données. Demande à ton enseignant ou au secrétariat de ton école. Ils transmettent ta demande à la personne responsable.",
      "Tu n'as pas à donner de courriel ni d'autre information. Tu reçois une réponse dans les 30 jours.",
      "Bientôt, tu pourras aussi effacer tes données toi-même dans tes réglages.",
      "Après l'effacement, une copie reste dans les sauvegardes pendant 14 jours au plus. Ensuite, elle disparaît.",
    ],
  },
  {
    id: "responsible",
    heading: "Qui est responsable",
    paragraphs: [
      "La personne responsable de tes renseignements personnels est Jimmy Razafindretsa. Il est étudiant au Cégep de Sorel-Tracy et il crée et gère Fifth Copy.",
      "Tu as une question ou une plainte ? Demande à ton enseignant ou au secrétariat de ton école. Ils la transmettent à la personne responsable.",
      "Chaque demande reçoit une réponse dans les 30 jours.",
    ],
  },
  {
    id: "cookies",
    heading: "Témoins (cookies)",
    paragraphs: [
      "Un témoin est un petit fichier que ton navigateur garde pour notre site. Fifth Copy utilise seulement ses propres témoins, jamais de témoins de publicité.",
      "Aucun script de la page ne peut lire ces témoins.",
    ],
    list: [
      "fc_guest : ton numéro d'invité signé, pour te reconnaître sans mot de passe. Il dure 1 an au plus.",
      "locale : la langue que tu choisis. Il dure 1 an.",
      "theme : le thème clair ou le quart de nuit. Il dure 1 an.",
      "Témoin de session : bientôt, il te gardera connecté à ton compte jusqu'à ta déconnexion.",
    ],
  },
  {
    id: "third-parties",
    heading: "Autres services utilisés",
    paragraphs: [
      "Fifth Copy fonctionne sur les serveurs de Railway, une entreprise d'hébergement. Tes données sont gardées aux États-Unis, dans la région de San Francisco, donc hors du Québec.",
      "Bientôt, tu pourras te connecter avec GitHub ou Discord. Ils recevront seulement ce que ta connexion leur envoie. On lira seulement ton numéro de compte, ton nom et ta photo.",
      "On ne partage rien avec d'autres entreprises pour de la publicité.",
    ],
  },
  {
    id: "rules",
    heading: "Règles (conditions d'utilisation)",
    paragraphs: [
      "Ces règles disent comment bien jouer avec les autres. Elles s'appliquent à toi, avec ou sans compte.",
    ],
  },
];
