import type { PrivacySection } from "./types";

/**
 * Règles de conduite et conditions d'utilisation, français (carte #91). French first on `/privacy#rules` (#80).
 * Québec French, "tu" form (bible 2). Keep in step with `terms.en.ts` (same ids, same number of paragraphs and
 * list items; `terms.test.ts` checks parity and plain language). Not reviewed by a lawyer: see "Needs qualified
 * review" in `docs/privacy/moderation.md`.
 */
export const termsFr: readonly PrivacySection[] = [
  {
    id: "about",
    heading: "À quoi servent ces règles",
    paragraphs: [
      "Fifth Copy est un jeu gratuit de course de dactylo pour la classe. C'est un projet étudiant mené par Jimmy Razafindretsa, étudiant au Cégep de Sorel-Tracy.",
      "Ces règles s'appliquent à toute personne qui joue, avec ou sans compte. L'enseignant ou l'enseignante qui anime une course aide à les appliquer dans sa salle.",
      "Le code de vie de ton école s'applique aussi quand tu joues en classe. Il n'y a pas de clavardage dans Fifth Copy : les autres voient ton nom, ton image et ta façon de courir.",
    ],
  },
  {
    id: "usernames",
    heading: "Noms d'utilisateur",
    paragraphs: [
      "Choisis un nom que tu serais à l'aise de voir projeté devant la classe. Un filtre vérifie les noms en français et en anglais, mais il ne bloque pas tout.",
    ],
    list: [
      "Pas d'insultes, d'injures, de haine, de menaces ni de mots sexuels, peu importe la langue ou l'orthographe.",
      "Pas de références à la drogue, à l'alcool ou à la violence.",
      "Ne te fais pas passer pour un enseignant, un camarade ou quelqu'un d'autre.",
      "N'utilise pas ton vrai nom complet ni celui de quelqu'un d'autre.",
      "Aucune info personnelle : pas d'adresse, de téléphone, de courriel, de numéro d'élève ni de compte de réseau social.",
    ],
  },
  {
    id: "avatars",
    heading: "Photos de profil",
    paragraphs: [
      "Ton image est montrée seulement aux joueurs de ton salon. Elle doit convenir à une classe.",
      "Un filtre vérifie chaque nouvelle image. Certaines images sont mises en attente, et tout le monde voit le portrait par défaut jusqu'à ce qu'une personne les vérifie.",
      "Une image refusée est supprimée et ton image précédente reste. Tu verras pourquoi, et comment demander qu'on la revoie.",
    ],
    list: [
      "Pas de nudité, de contenu sexuel, de violence, d'armes, de drogue ni de symboles haineux.",
      "Pas de photo d'une autre personne sans sa permission.",
      "Aucune info personnelle visible, comme un nom, une adresse ou un numéro d'élève.",
      "Encore mieux : évite une photo de ton visage. Un dessin ou un objet, c'est parfait.",
    ],
  },
  {
    id: "fair-play",
    heading: "Franc-jeu",
    paragraphs: [
      "Tape chaque touche toi-même. Le serveur vérifie la vitesse et le rythme, et une course qui semble automatisée est mise en révision.",
      "Une course en révision ne compte pas dans les statistiques ni les classements. Être signalé ne prouve pas que tu as triché, et tu peux demander une révision.",
    ],
    list: [
      "Pas de scripts, de robots, de macros, de logiciels de frappe automatique ni de trucs pour coller du texte.",
      "Ne joue pas sur le compte de quelqu'un d'autre et ne prête pas le tien.",
      "N'essaie pas de briser, de ralentir ou de surcharger le jeu.",
      "Si tu trouves un bogue, dis-le à ton enseignant au lieu de t'en servir.",
    ],
  },
  {
    id: "consequences",
    heading: "Si une règle n'est pas respectée",
    paragraphs: [
      "La réponse dépend de ce qui s'est passé. Une première petite erreur mène d'habitude à un changement, pas à une punition.",
      "Les problèmes graves, comme des menaces ou du contenu sexuel, sont retirés tout de suite. Ton enseignant ou ton école peut en être informé pour pouvoir aider.",
    ],
    list: [
      "L'enseignant peut te retirer de son salon.",
      "Un nom inacceptable est remplacé par un nom de dactylo au hasard.",
      "Une image inacceptable est supprimée.",
      "Une course trichée reste hors des statistiques et des classements.",
      "Des problèmes répétés ou graves peuvent mener à la suppression de ton compte.",
    ],
  },
  {
    id: "appeals",
    heading: "Si tu crois qu'une décision est injuste",
    paragraphs: [
      "Demande à ton enseignant ou au secrétariat de ton école de contacter la personne responsable. Fifth Copy ne te demande jamais ton courriel pour ça.",
      "Indique quel nom, quelle course ou quelle image, et pourquoi tu crois que la décision est injuste. Tu reçois une réponse par la même personne dans un délai de 30 jours.",
    ],
  },
  {
    id: "service",
    heading: "Le jeu tel qu'il est",
    paragraphs: [
      "Fifth Copy est un projet étudiant gratuit. Il peut avoir des bogues, être indisponible par moments, changer ou s'arrêter.",
      "Garde ton code de récupération en lieu sûr. Sans lui, un mot de passe perdu veut dire un compte perdu, parce qu'il n'y a pas de courriel pour le réinitialiser.",
      "Dans la mesure permise par la loi, le projet n'est pas responsable des statistiques perdues, des comptes perdus ou d'un jeu en panne. Rien ici ne t'enlève les droits que la loi te donne.",
    ],
  },
  {
    id: "changes",
    heading: "Changements à ces règles",
    paragraphs: [
      "Ces règles peuvent changer. La date du dernier changement est affichée sur cette page, et les changements importants sont annoncés dans le jeu.",
      "La façon dont tes renseignements personnels sont traités est expliquée dans les autres sections de cette page.",
    ],
  },
];
