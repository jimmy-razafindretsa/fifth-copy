/**
 * English catalog (ADR 0010). Its shape is the `Messages` type every catalog follows; `fr.ts` must
 * satisfy it, so a missing key fails type-check. Strings are the bible's canonical copy (section 2) and the
 * reference `Fifth Copy Landing.dc.html`; `{name}` placeholders are filled with `fill()`.
 */
export const en = {
  brand: {
    name: "FIFTH COPY",
    wordmarkAlt: "Fifth Copy",
    tagline: "TYPE FAST · TYPE FIRST",
  },
  meta: {
    title: "FIFTH COPY · TYPE FAST · TYPE FIRST",
    description:
      "A classroom typing race in English and French. Thirty desks, one message: the fastest clean copy wins the medal.",
  },
  header: {
    navLabel: "Site",
    guide: "HOW TO TYPE É Ç « »",
    languageLabel: "Language",
    nightShift: "NIGHT SHIFT",
    honorific: "Comrade {name}",
    guestTag: "GUEST",
    signIn: "SIGN IN",
  },
  landing: {
    kicker: "MINISTRY OF TYPING · DESK 05 · 1978",
    tagline: "TYPE FAST · TYPE FIRST",
    pitch:
      "Thirty desks. One message. Everyone types the same copy, and the fastest clean copy gets the medal.",
    tape: {
      hint: "TRY THE KEYS · CLICK AND START TYPING",
      again: "↺ AGAIN",
      sentence: "Type fast. Type first.",
      inputLabel: "Typing practice",
      accepted: "ACCEPTED · {wpm} WPM",
      returned: "RETURNED · {n} ERRORS",
    },
    quick: {
      cta: "QUICK RACE",
      searching: "FINDING A ROOM…",
      note: "Real typists first. Bots take the empty seats, so the room is never empty.",
    },
    actions: {
      createPrivateRace: "CREATE PRIVATE RACE",
      creating: "CREATING…",
      joinFormName: "Join with code",
      joinWithCode: "JOIN WITH CODE",
      codePlaceholder: "KGB-4821",
      join: "JOIN →",
      joining: "JOINING…",
    },
    errors: {
      prefix: "RETURNED ·",
      invalidFormat: "Enter a code like KGB-4821",
      notFound: "No race with that code",
      closed: "That race has already started or closed",
      unavailable: "The ring rooms are not answering. Try again in a minute.",
      generic: "Something jammed. Try again.",
    },
    feed: {
      frameTitle: "Live render of the ring room",
      live: "LIVE",
      room: "ROOM {n} · {time}",
      cam: "CAM 02 · 30/30",
      caption: "STREAMING · Room {n}, one of the ring rooms. Right now.",
      viewLabel: "Camera",
      views: { over: "FREE VIEW", pov: "FIRST PERSON", auto: "AUTO" },
      stampRoom: "ROOM {n}",
      stampSeats: "30 SEATS",
    },
    ticker: ["TYPE FAST", "TYPE FIRST", "NO TYPOS", "THIRTY DESKS", "ONE MESSAGE"],
    story: {
      kicker: "CASE FILE · THE STORY",
      title: "THE RING ROOMS NEVER STOP TYPING.",
      quote: "SPEED IS GOOD. ACCURACY IS BETTER. BOTH EARN A MEDAL.",
      lead: "Moscow, 1978.",
      p1: "Deep inside a ministry nobody can name, there are ring rooms. Nobody has ever counted them. Each one holds thirty desks in a perfect ring, a typewriter on every desk, and a Major in the middle.",
      p2: "Every morning the Major steps onto his platform with a single message. Thirty clerks copy it at the same time. The fastest clean copy is filed. The rest go back on the pile.",
      p3: "Nobody knows what the messages mean, or how many rooms there are. The Major smokes, the bulb flickers, the platform turns. Somewhere, right now, a room is typing.",
    },
    clerk: {
      stageTitle: "Your clerk, a randomly issued 3D character",
      stageHint: "HE'S WATCHING YOUR CURSOR · CLICK FOR A NEW UNIFORM",
      kicker: "PERSONNEL FILE",
      title: "THIS IS YOUR CLERK.",
      unassigned: "UNASSIGNED",
      deskRank: "DESK 05 · RANK: RECRUIT",
      pending: "…",
      reissue: "REISSUE UNIFORM",
      locker: "OPEN THE LOCKER →",
      ladderLabel: "PROMOTION LADDER · BY AVERAGE WPM",
      ranks: ["RECRUIT", "CLERK", "OFFICER", "COMMISSAR", "HERO OF PAPERWORK"],
      categories: {
        hair: "HAIR",
        glasses: "GLASSES",
        hat: "HAT",
        clothes: "CLOTHES",
        face: "FACE",
      },
      items: {
        hair: {
          side: "Side part",
          buzz: "Buzz cut",
          quiff: "Quiff",
          bowl: "Bowl cut",
          bald: "Bald",
        },
        glasses: {
          round: "Round wire",
          dark: "Dark lenses",
          square: "Square frames",
          monocle: "Monocle",
          none: "None",
        },
        hat: {
          none: "None",
          ushanka: "Ushanka",
          kepka: "Flat cap",
          eyeshade: "Eyeshade",
          beret: "Beret",
        },
        clothes: {
          vest: "Knit vest",
          cardigan: "Cardigan",
          jacket: "Work jacket",
          sweater: "Sweater",
          braces: "Shirt & braces",
        },
        face: { stache: "Moustache", clean: "Clean shave", beard: "Full beard" },
      },
    },
    history: {
      kicker: "ARCHIVE · DECLASSIFIED",
      title: "A LITTLE HISTORY",
      intro: "The game is a cartoon, but the typewriter really did run the Soviet office.",
      cards: [
        {
          title: "THE TYPING POOL",
          body: "Offices had whole rooms of typists, copying orders, reports and forms all day.",
        },
        {
          title: "MACHINES ON FILE",
          body: "Typewriters were closely watched. Samples of a machine's letters could be kept on file, so a page could be traced back to the machine that typed it.",
        },
        {
          title: "CARBON COPIES",
          body: "With carbon paper, one typist made several copies at once. Each sheet lower in the stack came out fainter. By the fifth copy, you had to squint.",
        },
        {
          title: "SAMIZDAT",
          body: "Books that couldn't be printed were retyped by hand and passed from reader to reader. Every copy came from someone's fingers.",
        },
      ],
      bridge:
        "Today the stakes are lower. The skill is the same: fast, clean typing in English and French, accents included.",
    },
    how: {
      kicker: "STANDING ORDERS",
      title: "HOW A RACE RUNS",
      steps: [
        {
          title: "THE HOST OPENS A ROOM",
          body: "Your teacher picks the text, the language and the rules, then shares a room code.",
        },
        {
          title: "EVERYONE TYPES THE SAME COPY",
          body: "Positions update live as you type. Every overtake gets stamped.",
        },
        {
          title: "THE MAJOR PINS THE MEDALS",
          body: "The top three take the podium. Everyone gets a report on what to practise next.",
        },
      ],
    },
    final: {
      kicker: "THE MAJOR IS WAITING",
      title: "REPORT TO YOUR DESK.",
    },
    medal: {
      frameTitle: "3D medal you can earn, drag to spin",
      kicker: "DECORATION · DRAG TO SPIN",
      title: "HERO OF PAPERWORK",
      body: "The Major pins this one on the fastest clean copy in the room. Collect them in your personnel file.",
    },
    footer: {
      about:
        "A classroom typing race in English and French. Built for students aged 12 to 17 and the teachers who host them.",
      play: "PLAY",
      learn: "LEARN",
      aegis: "AEGIS CORP.",
      links: {
        quickRace: "Quick race",
        createPrivateRace: "Create private race",
        joinWithCode: "Join with code",
        locker: "The locker",
        guide: "How to type é ç « »",
        teachers: "For teachers",
        profile: "Personnel file & stats",
        about: "About us",
        privacy: "Privacy · Law 25",
        terms: "Terms of use",
        contact: "Contact",
      },
      social: { github: "GITHUB", linkedin: "LINKEDIN", discord: "DISCORD", youtube: "YOUTUBE" },
      builtBy: "BUILT BY",
      builtByName: "AEGIS CORP.",
      copyright: "© 2026 Fifth Copy · Built by Aegis Corp. · Made in Québec",
      privacyLine: "No email. No chat. Your typing stays yours.",
    },
  },
  system: {
    notFound: {
      kicker: "MINISTRY OF TYPING · FORM 404",
      title: "ARE YOU LOST, KID?",
      stamp: "FILE NOT FOUND",
      body: "This desk does not exist. The file you asked for was never issued, or it went through the shredder. The Major has noticed.",
      body2: "Report back to your desk. The ring rooms are still typing.",
      rows: [
        ["FORM", "404"],
        ["STATUS", "NOT ON FILE"],
        ["DESK", "UNASSIGNED"],
      ],
      home: "REPORT TO YOUR DESK",
      join: "JOIN WITH CODE →",
      stageTitle: "The Major, watching, in 3D",
      stageHint: "THE MAJOR · HE'S WATCHING YOUR CURSOR",
    },
  },
  lobby: {
    kicker: "WAITING ROOM · PRIVATE RACE",
    heading: "REPORT TO YOUR DESK",
    codeName: "Room code",
    codeTag: "ROOM CODE",
    typists: "TYPISTS",
    typistsValue: "{n} / {max}",
    status: "STATUS",
    waiting: "WAITING",
    listName: "Typists in the room",
    loading: "Calling the roll…",
    desk: "DESK {n}",
    host: "HOST",
    you: "YOU",
    players: { one: "{n} player in the room", other: "{n} players in the room" },
    reconnecting: "CONNECTION LOST, RETRYING",
  },
  settings: {
    avatar: {
      moderation: {
        pending:
          "Your picture is being reviewed. Until a person checks it, everyone sees the default portrait, you too.",
        rejected: "Your picture was refused. It breaks the picture rules, so it was not filed.",
        appeal:
          "Think this is a mistake? Ask your teacher or your school office to contact the person in charge.",
      },
    },
  },
};

export type Messages = typeof en;
