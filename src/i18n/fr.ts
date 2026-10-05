import type { Messages } from "./en";

/**
 * French catalog (ADR 0010), Québec-friendly and in the "tu" form (bible 2). Same keys as `en.ts`
 * (type-checked). Strings are the bible's canonical copy and the reference `Fifth Copy Landing.dc.html`.
 */
export const fr = {
  brand: {
    name: "FIFTH COPY",
    wordmarkAlt: "Fifth Copy",
    tagline: "TYPE FAST · TYPE FIRST",
  },
  meta: {
    title: "FIFTH COPY · TYPE FAST · TYPE FIRST",
    description:
      "Une course de dactylo en classe, en français et en anglais. Trente bureaux, un seul message : la copie la plus rapide et sans faute remporte la médaille.",
  },
  header: {
    navLabel: "Site",
    guide: "TAPER É Ç « »",
    languageLabel: "Langue",
    nightShift: "QUART DE NUIT",
    honorific: "Camarade {name}",
    guestTag: "INVITÉ",
    signIn: "CONNEXION",
  },
  landing: {
    kicker: "MINISTÈRE DE LA DACTYLO · BUREAU 05 · 1978",
    tagline: "TYPE FAST · TYPE FIRST",
    pitch:
      "Trente bureaux. Un seul message. Tout le monde tape la même copie, et la plus rapide et la plus propre remporte la médaille.",
    tape: {
      hint: "ESSAIE LES TOUCHES · CLIQUE ET TAPE",
      again: "↺ ENCORE",
      sentence: "Écris vite. Écris le premier.",
      inputLabel: "Exercice de frappe",
      accepted: "ACCEPTÉ · {wpm} MPM",
      returned: "RETOURNÉ · {n} FAUTES",
    },
    quick: {
      cta: "COURSE RAPIDE",
      searching: "RECHERCHE…",
      note: "D'abord de vrais joueurs. Les bots prennent les places vides : la salle n'est jamais vide.",
    },
    actions: {
      createPrivateRace: "CRÉER UNE COURSE PRIVÉE",
      creating: "CRÉATION…",
      joinFormName: "Rejoindre avec un code",
      joinWithCode: "CODE",
      codePlaceholder: "KGB-4821",
      join: "ENTRER →",
      joining: "ENTRÉE…",
    },
    errors: {
      prefix: "RETOURNÉ ·",
      invalidFormat: "Entre un code comme KGB-4821",
      notFound: "Aucune course avec ce code",
      closed: "Cette course a déjà commencé ou est fermée",
      unavailable: "Les salles en anneau ne répondent pas. Réessaie dans une minute.",
      generic: "Quelque chose a coincé. Réessaie.",
    },
    feed: {
      frameTitle: "Rendu en direct de la salle en anneau",
      live: "EN DIRECT",
      room: "SALLE {n} · {time}",
      cam: "CAM 02 · 30/30",
      caption: "EN CONTINU · Salle {n}, une des salles en anneau. En ce moment.",
      viewLabel: "Caméra",
      views: { over: "VUE LIBRE", pov: "VUE SUBJECTIVE", auto: "AUTO" },
      stampRoom: "SALLE {n}",
      stampSeats: "30 PLACES",
    },
    ticker: ["ÉCRIS VITE", "ÉCRIS LE PREMIER", "SANS FAUTE", "TRENTE BUREAUX", "UN SEUL MESSAGE"],
    story: {
      kicker: "DOSSIER · LE RÉCIT",
      title: "LES SALLES EN ANNEAU NE S'ARRÊTENT JAMAIS DE TAPER.",
      quote: "LA VITESSE, C'EST BIEN. LA PRÉCISION, C'EST MIEUX. LES DEUX, C'EST UNE MÉDAILLE.",
      lead: "Moscou, 1978.",
      p1: "Au fond d'un ministère dont personne ne connaît le nom, il y a des salles en anneau. Personne ne les a jamais comptées. Chacune aligne trente bureaux en cercle parfait, une machine à écrire sur chaque bureau, et un Major au centre.",
      p2: "Chaque matin, le Major monte sur sa plateforme avec un seul message. Trente commis le recopient en même temps. La copie la plus rapide et sans faute est classée. Les autres retournent sur la pile.",
      p3: "Personne ne sait ce que veulent dire les messages, ni combien il y a de salles. Le Major fume, l'ampoule clignote, la plateforme tourne. Quelque part, en ce moment, une salle est en train de taper.",
    },
    clerk: {
      stageTitle: "Ton commis, un personnage 3D attribué au hasard",
      stageHint: "IL SUIT TON CURSEUR · CLIQUE POUR UN NOUVEL UNIFORME",
      kicker: "DOSSIER DU PERSONNEL",
      title: "VOICI TON COMMIS.",
      unassigned: "NON ASSIGNÉ",
      deskRank: "BUREAU 05 · GRADE : RECRUE",
      pending: "…",
      reissue: "NOUVEL UNIFORME",
      locker: "OUVRIR LE VESTIAIRE →",
      ladderLabel: "ÉCHELLE DES GRADES · SELON TA MOYENNE",
      ranks: ["RECRUE", "COMMIS", "OFFICIER", "COMMISSAIRE", "HÉROS DE LA PAPERASSE"],
      categories: {
        hair: "CHEVEUX",
        glasses: "LUNETTES",
        hat: "CHAPEAU",
        clothes: "VÊTEMENTS",
        face: "VISAGE",
      },
      items: {
        hair: {
          side: "Raie de côté",
          buzz: "Coupe rase",
          quiff: "Banane",
          bowl: "Coupe au bol",
          bald: "Chauve",
        },
        glasses: {
          round: "Rondes en laiton",
          dark: "Verres fumés",
          square: "Monture carrée",
          monocle: "Monocle",
          none: "Aucunes",
        },
        hat: {
          none: "Aucun",
          ushanka: "Chapka",
          kepka: "Casquette plate",
          eyeshade: "Visière",
          beret: "Béret",
        },
        clothes: {
          vest: "Gilet tricoté",
          cardigan: "Cardigan",
          jacket: "Veste de travail",
          sweater: "Chandail",
          braces: "Chemise et bretelles",
        },
        face: { stache: "Moustache", clean: "Rasé de près", beard: "Barbe pleine" },
      },
    },
    history: {
      kicker: "ARCHIVES · DÉCLASSIFIÉ",
      title: "UN PEU D'HISTOIRE",
      intro:
        "Le jeu est un dessin animé, mais la machine à écrire faisait vraiment tourner le bureau soviétique.",
      cards: [
        {
          title: "LE POOL DE DACTYLOS",
          body: "Les bureaux avaient des salles entières de dactylos qui recopiaient ordres, rapports et formulaires toute la journée.",
        },
        {
          title: "MACHINES FICHÉES",
          body: "Les machines à écrire étaient surveillées. Un échantillon de leurs lettres pouvait être archivé, pour retrouver la machine qui avait tapé une page.",
        },
        {
          title: "PAPIER CARBONE",
          body: "Avec du papier carbone, on faisait plusieurs copies d'un coup. Chaque feuille plus bas sortait plus pâle. À la cinquième copie, il fallait plisser les yeux.",
        },
        {
          title: "SAMIZDAT",
          body: "Les livres qu'on ne pouvait pas imprimer étaient retapés à la main et passaient de lecteur en lecteur. Chaque copie sortait des doigts de quelqu'un.",
        },
      ],
      bridge:
        "Aujourd'hui, l'enjeu est moindre. Le talent reste le même : taper vite et proprement, en français et en anglais, accents compris.",
    },
    how: {
      kicker: "ORDRES PERMANENTS",
      title: "DÉROULEMENT D'UNE COURSE",
      steps: [
        {
          title: "L'HÔTE OUVRE UNE SALLE",
          body: "Ton enseignant choisit le texte, la langue et les règles, puis partage un code de salle.",
        },
        {
          title: "TOUT LE MONDE TAPE LA MÊME COPIE",
          body: "Les positions bougent en direct pendant que tu tapes. Chaque dépassement est tamponné.",
        },
        {
          title: "LE MAJOR ÉPINGLE LES MÉDAILLES",
          body: "Le top 3 monte sur le podium. Chacun reçoit un rapport sur quoi pratiquer ensuite.",
        },
      ],
    },
    final: {
      kicker: "LE MAJOR T'ATTEND",
      title: "PRÉSENTE-TOI À TON BUREAU.",
    },
    medal: {
      frameTitle: "Médaille 3D à gagner, fais-la tourner",
      kicker: "DÉCORATION · FAIS-LA TOURNER",
      title: "HÉROS DE LA PAPERASSE",
      body: "Le Major l'épingle sur la copie la plus rapide et sans faute de la salle. Collectionne-les dans ton dossier.",
    },
    footer: {
      about:
        "Une course de dactylo en classe, en français et en anglais. Pour les élèves de 12 à 17 ans et les enseignants qui les animent.",
      play: "JOUER",
      learn: "APPRENDRE",
      aegis: "AEGIS CORP.",
      links: {
        quickRace: "Course rapide",
        createPrivateRace: "Créer une course privée",
        joinWithCode: "Rejoindre avec un code",
        locker: "Le vestiaire",
        guide: "Taper é ç « »",
        teachers: "Pour les enseignants",
        profile: "Dossier et statistiques",
        about: "À propos",
        privacy: "Confidentialité · Loi 25",
        terms: "Conditions d'utilisation",
        contact: "Nous joindre",
      },
      social: { github: "GITHUB", linkedin: "LINKEDIN", discord: "DISCORD", youtube: "YOUTUBE" },
      builtBy: "CONÇU PAR",
      builtByName: "AEGIS CORP.",
      copyright: "© 2026 Fifth Copy · Conçu par Aegis Corp. · Fait au Québec",
      privacyLine: "Pas de courriel. Pas de clavardage. Ta frappe t'appartient.",
    },
  },
  lobby: {
    kicker: "SALLE D'ATTENTE · COURSE PRIVÉE",
    heading: "PRÉSENTE-TOI À TON BUREAU",
    codeName: "Code de salle",
    codeTag: "CODE DE SALLE",
    typists: "DACTYLOS",
    typistsValue: "{n} / {max}",
    status: "STATUT",
    waiting: "EN ATTENTE",
    listName: "Dactylos dans la salle",
    loading: "Appel des présences…",
    desk: "BUREAU {n}",
    host: "HÔTE",
    you: "TOI",
    players: { one: "{n} joueur dans la salle", other: "{n} joueurs dans la salle" },
    reconnecting: "CONNEXION PERDUE, NOUVEL ESSAI",
  },
} satisfies Messages;
