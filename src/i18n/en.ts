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
    /** The practice entry (#367): a private race already seated with bots, under CREATE PRIVATE RACE. */
    entries: {
      practise: "PRACTISE VS BOTS",
      practising: "OPENING YOUR DESK…",
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
    /** The kicker names the lobby's type (`Lobby.type`, #105). */
    kicker: { private: "WAITING ROOM · PRIVATE RACE", public: "WAITING ROOM · PUBLIC RACE" },
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
    /** The ink tag on a bot's roll row (#105, as the Dawn report's). */
    bot: "BOT",
    /** The seat ring diagram (#731, bible 14.3): its accessible name, the centre tag, a bot desk's tag. */
    ring: {
      name: "Seat ring: {n} of {max} desks taken",
      major: "THE MAJOR",
      bot: "B",
    },
    /** A non-host's 7.4 notice row at the top of the roll (#105). */
    waitingForHost: "WAITING FOR THE HOST",
    /** A late joiner's 7.4 notice row while the race runs (#732): held, seated at `ended`. */
    raceInProgress: "RACE IN PROGRESS · YOU ARE SEATED WHEN IT ENDS",
    players: { one: "{n} player in the room", other: "{n} players in the room" },
    reconnecting: "CONNECTION LOST, RETRYING",
    /** The host's START (#214, bible 7.1 primary; its layout moves with #498) and its 7.4 lines. */
    start: {
      button: "START",
      pending: "STARTING…",
      needTwo: "TWO TYPISTS NEEDED",
      errors: {
        "too-few": "Two typists are needed to start the race.",
        "not-waiting": "This race has already started.",
        "start-failed": "The race could not start. Try again.",
        timeout: "The room did not answer. Try again.",
      },
    },
    /**
     * The read-only `FORM 5-L` race settings docket (#498, bible 7.4, spec 8): one row label and the
     * value words per `RaceSettings` field; the host's controls (#110) reuse the labels.
     */
    settings: {
      name: "FORM 5-L",
      tag: "RACE SETTINGS",
      loading: "Reading the race settings…",
      on: "ON",
      off: "OFF",
      noLetters: "NONE",
      noBots: "NONE",
      labels: {
        language: "LANGUAGE",
        textType: "TEXT TYPE",
        wordCount: "WORDS",
        accentEveryWord: "ACCENTS",
        difficulty: "DIFFICULTY",
        practiceLetters: "PRACTICE LETTERS",
        includeNumbers: "NUMBERS",
        includeSymbols: "SYMBOLS",
        includePunctuation: "PUNCTUATION",
        timerS: "TIMER",
        errorMode: "ERROR MODE",
        backspace: "BACKSPACE",
        bonuses: "BONUSES",
        bots: "BOTS",
        lobbyType: "LOBBY",
      },
      language: { fr: "FRENCH", en: "ENGLISH" },
      textType: {
        sentences: "REAL SENTENCES",
        words: "RANDOM WORDS",
        "special-characters": "SPECIAL CHARACTERS",
      },
      wordCount: "{n} WORDS",
      accentEveryWord: "EVERY WORD",
      difficulty: { easy: "EASY", normal: "NORMAL", hard: "HARD", custom: "CUSTOM" },
      wordLength: { short: "SHORT WORDS", medium: "MEDIUM WORDS", long: "LONG WORDS" },
      rareLetters: { on: "RARE LETTERS", off: "COMMON LETTERS" },
      punctuationDensity: {
        none: "NO PUNCTUATION",
        light: "LIGHT PUNCTUATION",
        heavy: "HEAVY PUNCTUATION",
      },
      timer: { none: "NO TIMER", minutes: "{m} MIN", minutesSeconds: "{m} MIN {s} S" },
      errorMode: { continue: "CONTINUE", block: "BLOCK" },
      bots: { one: "1 BOT · {levels}", other: "{n} BOTS · {levels}" },
      botLevel: {
        recruit: "RECRUIT",
        clerk: "CLERK",
        officer: "OFFICER",
        commissar: "COMMISSAR",
        major: "MAJOR",
      },
      lobbyType: { public: "PUBLIC", private: "PRIVATE" },
      /**
       * The host's controls in the rows (#110, bible 14.3): the custom recipe's own rows, short segment
       * words, the timer unit and the refusals (inline error lines after `RETURNED ·`; never the typed
       * text). `{min}`/`{max}` are filled from the protocol schema.
       */
      form: {
        labels: {
          wordLength: "WORD LENGTH",
          rareLetters: "RARE LETTERS",
          punctuationDensity: "PUNCTUATION DENSITY",
        },
        wordLength: { short: "SHORT", medium: "MEDIUM", long: "LONG" },
        punctuationDensity: { none: "NONE", light: "LIGHT", heavy: "HEAVY" },
        minutes: "MIN",
        /** The BOTS row (#114): one sub-row per bot, its level's speed, the secondary buttons. */
        bot: "BOT {n}",
        wpm: "{n} WPM",
        addBot: "ADD A BOT",
        remove: "REMOVE",
        errors: {
          words: "Words take a whole number from {min} to {max}.",
          timer: "The timer takes a whole number of minutes from {min} to {max}.",
          "too-many-letters": "Practice letters take {max} letters at most.",
          letters: "Practice letters take letters only, each one once.",
          invalid: "The room refused that setting.",
          "not-waiting": "This race has already started.",
          "no-room": "The room is no longer open.",
          timeout: "The room did not answer. Try again.",
        },
      },
    },
    /** The invite rows of the room docket (#498, bible 7.1 ink button); #121 adds the link row. */
    invite: {
      label: "INVITE",
      copy: "COPY",
      copied: "COPIED",
      /** Read out when the code is copied (polite live region). */
      copiedStatus: "Room code copied",
      /** Read out when the clipboard is unavailable and the code is selected instead. */
      selectedStatus: "Room code selected: copy it with your keyboard",
    },
  },
  race: {
    kicker: { seat: "SEAT VIEW", desk: "SEAT VIEW · DESK {n}" },
    telex: { strip: "Text to type" },
    /** The 3-2-1 countdown and the Major's dual stamp `НАЧАЛИ · GO` (#214, bible 2, 7.3). */
    countdown: { major: "НАЧАЛИ", go: "GO" },
    /** The overtake stamps (#232, bible 2, 7.3): the dual in-world headline, Russian then this language. */
    stamps: {
      overtake: { ru: "ОБГОН!", text: "OVERTAKE +1" },
      passed: { ru: "ОБОГНАЛИ", text: "PASSED −1" },
      /** Your finish (#240, bible 2, 7.7): zero errors, otherwise the error count (singular for one). */
      accepted: "ACCEPTED · {wpm} WPM",
      returned: "RETURNED · {n} ERRORS",
      returnedOne: "RETURNED · 1 ERROR",
    },
    /** The race announcer (#232 C4, #242; bible 14.3): one polite status region, never the race text. */
    announce: {
      overtake: "You passed desk {desk}",
      passed: "Desk {desk} passed you",
      place: "Place {place} of {total}",
      finished: "Finished. Place {place} of {total}",
      over: "Race over. Place {place} of {total}",
      overUnranked: "Race over.",
    },
    loading: "Taking your seat…",
    /** The 3D scene's loading card (#563, bible 7.4 extension): the stamp, the frame's name, the tip tag. */
    scene: {
      loading: "LOADING THE RING ROOM",
      title: "The ring room, from your desk",
      didYouKnow: "DID YOU KNOW?",
    },
    /** "Did you know?" lines under the loading stamp; filled by #383 (an empty list hides the row). */
    didYouKnow: [] as string[],
    notice: {
      "waiting-for-host": "WAITING FOR THE HOST",
      reconnecting: "LINE CUT · RECONNECTING",
      "idle-warning": "THE MAJOR IS LOOKING AT YOU. TYPE.",
      "no-scene": "NO PICTURE FROM THE ROOM · KEEP TYPING",
      phones: "PHONES WATCH FROM THE BACK OF THE ROOM",
    },
    /** Presence (#235, bible 7.4 notice row): the room went away under a seated page (#204). */
    presence: {
      roomLost: "THE ROOM WAS LOST",
      backToLobby: "BACK TO THE LOBBY",
    },
    errors: {
      prefix: "RETURNED ·",
      closed: "This race is closed.",
      noRoom: "This room is no longer open.",
      inProgress: "This race started without you.",
      notFound: "This race is not on file.",
      generic: "Something jammed. Try again.",
      back: "BACK TO THE WAITING ROOM →",
    },
    abandon: { abandon: "ABANDON", confirm: "CONFIRM · REASSIGN ME" },
    /** The exit dockets (#233, bible 7.3, 7.4): Reassigned after ABANDON, Asleep at desk after the idle kick. */
    exit: {
      stamp: { abandoned: "REASSIGNED", asleep: "ASLEEP AT DESK" },
      wpm: "WPM",
      accuracy: "ACCURACY",
      place: "PLACE",
      last: "LAST",
      percent: "{n}\u00a0%",
      keepWatching: "KEEP WATCHING",
      back: "BACK TO THE WAITING ROOM →",
      leave: "LEAVE →",
    },
    counters: {
      wpm: "WPM",
      place: "PLACE",
      aria: "Words per minute {wpm}, place {place} of {total}",
      ariaNoPlace: "Words per minute {wpm}, {total} typists, no place yet",
      /** The timer tube (#240): its tag, and the words added to the bezel's name (`{time}` = mm:ss). */
      time: "TIME",
      ariaTime: ", {time} left",
    },
    /** The finished view (#240, bible 2, 7.4, 14.4): the docket after your finish and at RACE OVER. */
    finish: {
      filed: "FILED",
      over: "RACE OVER",
      reason: { "all-finished": "ALL FINISHED", timer: "TIME'S UP" },
      standings: "Standings",
      desk: "DESK {n}",
      you: "YOU",
      progress: "{n}\u00a0%",
      wpm: "{n} WPM",
      status: {
        typing: "TIMED OUT",
        finished: "FILED",
        abandoned: "REASSIGNED",
        asleep: "ASLEEP AT DESK",
        "line-cut": "LINE CUT",
        expired: "EXPIRED",
      },
      report: "DAWN REPORT →",
    },
    raceCard: {
      title: "RACE CARD",
      typists: "{n} TYPISTS",
      field: "{n} typists on the line, you at {you}%",
      lanes: "Lanes",
      desk: "DESK {n}",
      you: "YOU",
      lane: "Place {rank}, {name}{you}, desk {desk}, {progress}% typed{status}",
      status: {
        "line-cut": "LINE CUT",
        expired: "EXPIRED",
        asleep: "ASLEEP AT DESK",
        abandoned: "REASSIGNED",
        finished: "FILED",
      },
    },
    sabotageTray: {
      title: "SABOTAGE TRAY",
      empty: { title: "NO CARD", body: "Cards go to the typists behind the leader." },
      cards: {
        "extra-paperwork": {
          name: "EXTRA PAPERWORK",
          effect: "Adds words to the leader's text.",
        },
        exemption: { name: "EXEMPTION", effect: "Removes words from your remaining text." },
        "smoke-break": {
          name: "SMOKE BREAK",
          effect: "Blurs the text of the typists ahead of you for a few seconds.",
        },
      },
      play: "PLAY",
      cooldown: "COOLDOWN",
      seconds: "{n} S",
      hint: "ENTER TO PLAY",
      playButton: "PLAY CARD",
      immune: "IMMUNE",
    },
  },
  /** The Dawn report (#300, bible 14.4): kicker, heading, the filing notice and the podium. */
  results: {
    kicker: "DAWN REPORT · FORM 5-R",
    heading: "RACE OVER",
    filing: {
      notice: "FILING THE REPORT · ONE MOMENT",
      prefix: "RETURNED ·",
      late: "The report did not reach the office.",
      lobby: "BACK TO THE WAITING ROOM →",
      home: "BACK TO THE FRONT DESK →",
    },
    /** The action row under the ranking (#143, bible 14.4): the same lobby races again. */
    actions: {
      again: "RACE AGAIN",
    },
    podium: {
      title: "Podium",
      place: "№ {n}",
      desk: "DESK {n}",
      bot: "BOT",
      you: "YOU",
      wpm: "WPM",
      accuracy: "ACCURACY",
      unfilled: "UNFILLED",
      tied: "TIED",
      underReview: "UNDER REVIEW",
      medal: "HERO OF PAPERWORK",
      medalTitle: {
        gold: "A clerk, in 3D, wearing the gold medal",
        silver: "A clerk, in 3D, wearing the silver medal",
        bronze: "A clerk, in 3D, wearing the bronze medal",
      },
    },
    ranking: {
      caption: "FORM 5-R · RANKING",
      place: "№",
      typist: "TYPIST",
      desk: "DESK",
      wpm: "WPM",
      accuracy: "ACCURACY",
      status: "STATUS",
      bot: "BOT",
      you: "YOU",
      underReview: "UNDER REVIEW",
    },
    status: {
      FINISHED: "FILED",
      TIMED_OUT: "TIMED OUT",
      REASSIGNED: "REASSIGNED",
      ASLEEP: "ASLEEP AT DESK",
      LINE_CUT: "LINE CUT",
      EXPIRED: "EXPIRED",
    },
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
