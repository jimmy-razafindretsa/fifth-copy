/**
 * The host left for good (#137, bible 14.3): the stamp with the new host's name (upper case) and its one
 * polite announcement. One source for the lobby (`lobby.newHost`) and the seat view (`race.stamps.newHost`,
 * #868).
 */
const NEW_HOST = {
  stamp: "NEW HOST: {name}",
  announce: "{name} is the new host.",
};

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
    /** #932: the header's Personnel file item (viewers only) and the docket link's spoken prefix. */
    myFileName: "My file",
    /** #969: the docket link's spoken grade after the name ("My file, <name>, grade: Officer"). */
    gradeName: ", grade: {rank}",
    /** #951: back to the Home menu, on every page under this header for a viewer. */
    backToMenu: "MENU",
    backToMenuLabel: "Back to the menu",
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
    /**
     * The phone landing's watch entry (#999 C15, bible 14.3 "Phone spectator"): phones watch, so at
     * 480px and under it replaces QUICK RACE and the private-race entries.
     */
    watch: {
      formName: "Watch a race",
      label: "WATCH WITH CODE OR LINK",
      placeholder: "KGB-4821",
      submit: "WATCH →",
      pending: "OPENING…",
      note: "Phones watch from the back of the room. Type at a desk.",
      invalid: "Enter a code like KGB-4821 or paste a watch link",
    },
    /** The open-rooms docket under the code join (#807, bible 14.1): public rooms joinable right now. */
    rooms: {
      title: "OPEN ROOMS",
      live: "LIVE",
      listName: "Open rooms",
      loading: "Looking for open rooms…",
      typists: { zero: "0 TYPISTS", one: "1 TYPIST", other: "{n} TYPISTS" },
      bots: { zero: "0 BOTS", one: "1 BOT", other: "{n} BOTS" },
      count: "{typists} · {bots}",
      join: "JOIN →",
      joinName: "Join room {code}",
      empty: "NO OPEN ROOM · PRESS QUICK RACE",
      /** #999 C15: a phone has no QUICK RACE; its empty row points at the watch entry above. */
      emptyPhone: "NO OPEN ROOM · WATCH WITH A CODE OR LINK",
    },
    errors: {
      prefix: "RETURNED ·",
      invalidFormat: "Enter a code like KGB-4821",
      notFound: "No race with that code",
      closed: "That race has already started or closed",
      roomFull: "All 30 desks in this room are taken.",
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
      privacyLine: "No chat. Your typing stays yours.",
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
  privacy: {
    title: "PRIVACY",
    kicker: "MINISTRY OF TYPING · PRIVACY FILE",
    heading: "WHAT WE KEEP ON FILE",
    intro:
      "This page tells you what Fifth Copy knows about you, why, and for how long. It also tells you how to have it deleted.",
    rows: [
      ["FORM", "LAW 25"],
      ["UPDATED", "{date}"],
      ["QUESTIONS", "ASK YOUR TEACHER"],
    ],
    tocLabel: "On this page",
    tocTag: "CONTENTS",
    deleteLink: "MY SETTINGS →",
    rulesUpdated: "RULES UPDATED · {date}",
    backToTop: "BACK TO THE TOP ↑",
  },
  /** `/invite/[token]` (#809, bible 14.3): the invitation screen and the refusal screen. */
  guide: {
    title: "HOW TO TYPE IT",
    kicker: "MINISTRY OF TYPING · TYPING GUIDE",
    heading: "HOW TO TYPE IT",
    intro: "Every accent and sign a race asks for, key by key. Pick your keyboard and your system.",
    deskTag: "YOUR DESK",
    layout: "KEYBOARD",
    os: "SYSTEM",
    osNames: { windows: "WINDOWS", mac: "MACOS", chromeos: "CHROMEOS" },
    detected: "DETECTED ON THIS DEVICE",
    chosen: "CHOSEN BY YOU",
    unknown: "SYSTEM NOT DETECTED · PICK YOURS",
    indexLabel: "Characters",
    indexTag: "CHARACTERS",
    undocumentedTag: "NOT IN THE PUBLISHED LAYOUT DATA",
    undocumentedPair:
      "Neither the vendor nor Unicode CLDR publishes key data for a {layout} keyboard under {os}. The Ministry files only what is published.",
    undocumentedLayout:
      "Neither the vendor nor Unicode CLDR publishes key data for a {layout} keyboard. The Ministry files only what is published.",
    sourceLabel: "SOURCE",
    sourceNote:
      "FROM THE VENDOR'S OR UNICODE CLDR'S PUBLISHED LAYOUT DATA · NOT YET TRIED ON A REAL MACHINE",
    sourceNames: {
      windowsCsa: "Microsoft · Canadian Multilingual Standard layout",
      windowsFrCa: "Microsoft · Canadian French layout",
      windowsAzerty: "Microsoft · French (Legacy, AZERTY) layout",
      windowsAltCodes: "Microsoft · Alt codes on the numeric keypad",
      macUs: "Unicode CLDR · macOS U.S. layout",
      macCsa: "Unicode CLDR · macOS Canadian - CSA layout",
      macAzerty: "Unicode CLDR · macOS French layout",
      macAccents: "Apple · Enter characters with accent marks on Mac",
      macCharacterViewer: "Apple · Use emoji and symbols on Mac",
      chromeosCsa: "xkeyboard-config · Canadian (CSA) layout, ChromeOS's Canadian Multilingual",
      chromeosFrCa: "Unicode CLDR · ChromeOS Canada layout",
      chromeosAzerty: "Unicode CLDR · ChromeOS France layout",
      chromebookAccents: "Google · Accent marks (turn on Show accent marks and special characters)",
    },
    then: "then",
    or: "or",
    keys: {
      shift: "Shift",
      alt: "Alt",
      altgr: "AltGr",
      option: "Option",
      ctrl: "Ctrl",
      rctrl: "Right Ctrl",
      cmd: "Cmd",
      fn: "Fn/Globe",
      space: "Space",
      hold: "hold",
      numpad: "keypad",
    },
    chars: {
      "e-acute": "e acute",
      "e-grave": "e grave",
      "e-circumflex": "e circumflex",
      "e-diaeresis": "e diaeresis",
      "a-grave": "a grave",
      "a-circumflex": "a circumflex",
      "c-cedilla": "c cedilla",
      "u-grave": "u grave",
      "u-circumflex": "u circumflex",
      "o-circumflex": "o circumflex",
      "i-circumflex": "i circumflex",
      "i-diaeresis": "i diaeresis",
      "oe-ligature": "o-e ligature",
      "ae-ligature": "a-e ligature",
      "guillemet-open": "opening guillemet",
      "guillemet-close": "closing guillemet",
      euro: "euro sign",
    },
    backToTop: "BACK TO THE TOP ↑",
  },
  invite: {
    kicker: "MINISTRY OF TYPING · INVITATION",
    title: "YOU ARE EXPECTED",
    rows: [
      ["FORM", "INVITE"],
      ["SEATS", "ONE"],
    ],
    take: "TAKE YOUR DESK",
    refused: {
      stamp: "REFUSED",
      stamp2: "LINK USED OR EXPIRED",
      body: "Ask the host for a new link, or join with the room code.",
      home: "REPORT TO YOUR DESK",
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
    /** The 7.4 notice row at the top of the roll while the host follows the race without a desk (#876). */
    /** #999 C9: the still notice row of a phone watching the lobby on a spectator token (bible 14.3). */
    phonesWatch: "PHONES WATCH FROM THE BACK OF THE ROOM",
    hostWatching: "THE HOST IS WATCHING",
    /**
     * A public room's automatic start (#814, bible 14.3): the room docket's `STATUS` value with the
     * seconds left, a non-host's still notice row, and the two polite announcements.
     */
    autoStart: {
      status: "STARTS IN {n} S",
      notice: "AUTOMATIC START",
      armed: "The race starts by itself in {n} seconds.",
      dropped: "The race waits for the host.",
    },
    /** A late joiner's 7.4 notice row while the race runs (#732): held, seated at `ended`. */
    raceInProgress: "RACE IN PROGRESS · YOU ARE SEATED WHEN IT ENDS",
    /**
     * The host left for good (#137, bible 14.3): the red 7.3 stamp over the roll with the new host's
     * name (upper case), and its one polite announcement.
     */
    newHost: NEW_HOST,
    players: { one: "{n} player in the room", other: "{n} players in the room" },
    reconnecting: "CONNECTION LOST, RETRYING",
    /**
     * The host removes a typist (#133, bible 14.3): the row's 7.1 secondary REMOVE, its in-place CONFIRM,
     * the roll's 7.4 error line on a refusal, and the removed viewer's docket.
     */
    remove: {
      button: "REMOVE",
      confirm: "CONFIRM",
      /** Accessible names: idle, then while CONFIRM holds. */
      name: "REMOVE {name}",
      confirmName: "CONFIRM · REMOVE {name}",
      errors: {
        "not-host": "Only the host can remove a typist.",
        "not-waiting": "Typists can only be removed between races.",
        "no-such-desk": "This typist has already left the room.",
        "is-bot": "A bot leaves through the race settings.",
        self: "The host cannot remove themselves.",
        timeout: "The room did not answer. Try again.",
      },
      docket: {
        stamp: "REMOVED",
        sentence: "The host removed you from this room's roll. Your file is intact.",
        back: "BACK TO THE FRONT DESK →",
      },
    },
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
      /** #951: the form's sections. */
      sections: { room: "THE ROOM", text: "THE TEXT", rules: "THE RULES", bots: "THE BOTS" },
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
        hostWatches: "HOST",
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
      /** Whether the host holds a desk (#876): `TYPES` (the default) or `WATCHES`. */
      hostWatches: { types: "TYPES", watches: "WATCHES" },
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
          "room-full": "All 30 desks in this room are taken.",
          timeout: "The room did not answer. Try again.",
        },
      },
    },
    /**
     * The host's PASSWORD RESET docket (#790, bible 14.3, 7.4): a teacher host issues a student's
     * single-use reset code (#788). Errors never echo the typed username.
     */
    reset: {
      name: "FORM 5-R",
      tag: "PASSWORD RESET",
      student: "STUDENT",
      issue: "ISSUE A CODE",
      pending: "ISSUING…",
      issued: "CODE ISSUED",
      expires: "EXPIRES IN {m} MIN",
      handOver: "HAND IT OVER IN PRIVATE",
      errors: {
        invalid: "Type the student's username.",
        "not-eligible": "That username is not one of your students.",
        "not-host": "Only the teacher hosting this room can issue a code.",
        "rate-limited": "Too many codes issued. Try again in {m} min.",
        generic: "Something jammed. Try again.",
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
    /** The host's single-use link row (#809, bible 14.3), right after INVITE in the room docket. */
    links: {
      label: "LINK",
      newLink: "NEW LINK",
      issuing: "ISSUING…",
      /** The shown link's accessible name (the URL itself is the visible value). */
      urlName: "Invite link",
      copy: "COPY",
      copied: "COPIED",
      copiedStatus: "Invite link copied",
      selectedStatus: "Invite link selected: copy it with your keyboard",
      /** createInvite answered `not-host` (the row only shows to the host; the action decides). */
      notHost: "Only the host can issue a link.",
    },
    /**
     * The host's reusable spectator link row (#999 C12, bible 14.3 "the watch row"): the link row's
     * recipe; a projector or a phone opens it and watches, never seated, never told the room code.
     */
    watchLinks: {
      label: "WATCH",
      newLink: "NEW WATCH LINK",
      issuing: "ISSUING…",
      urlName: "Spectator link",
      copy: "COPY",
      copied: "COPIED",
      copiedStatus: "Spectator link copied",
      selectedStatus: "Spectator link selected: copy it with your keyboard",
      notHost: "Only the host can issue a link.",
    },
  },
  race: {
    /**
     * The race page's room code entry (#999 C13, bible 14.3 "Room code entry"): `/race/<id>` served no
     * code (not the host, no proof on file), so it asks for it first.
     */
    codeGate: {
      kicker: "MINISTRY OF TYPING · ROOM CODE",
      title: "CODE, PLEASE",
      body: "This room opens with its code. Type it to take your desk or to watch the race.",
      formName: "Room code",
    },
    kicker: { seat: "SEAT VIEW", desk: "SEAT VIEW · DESK {n}" },
    telex: {
      strip: "Text to type",
      /**
       * The intercepted-cable headers (#999 C40, R26, bible 4): Special Elite, above the tape, framing
       * the race text and never part of it; `cableHeader` picks one per race and fills the cable `{n}`.
       */
      cables: [
        "INTERCEPTED CABLE · № {n} · COPY AS RECEIVED",
        "INTERCEPTED CABLE · № {n} · PRIORITY: URGENT",
        "INTERCEPTED CABLE · № {n} · FOR THE FIFTH COPY",
        "INTERCEPTED CABLE · № {n} · ORIGIN UNKNOWN",
        "INTERCEPTED CABLE · № {n} · FILE BEFORE DAWN",
        "INTERCEPTED CABLE · № {n} · DO NOT FOLD",
      ],
    },
    /** The 3-2-1 countdown and the Major's dual stamp `НАЧАЛИ · GO` (#214, bible 2, 7.3). */
    countdown: { major: "НАЧАЛИ", go: "GO" },
    /** The overtake stamps (#232, bible 2, 7.3): the dual in-world headline, Russian then this language. */
    stamps: {
      overtake: { ru: "ОБГОН!", text: "OVERTAKE +1" },
      passed: { ru: "ОБОГНАЛИ", text: "PASSED −1" },
      /** #951: the plain line that replaced the dual overtake stamp on the seat view. */
      overtakeLine: {
        overtake: "You overtook {name}",
        passed: "{name} overtook you",
        someone: "A typist",
      },
      /** Your finish (#240, bible 2, 7.7): zero errors, otherwise the error count (singular for one). */
      accepted: "ACCEPTED · {wpm} WPM",
      returned: "RETURNED · {n} ERRORS",
      returnedOne: "RETURNED · 1 ERROR",
      /** The host left for good during a race (#868, bible 14.3): the lobby's strings, the ink stamp. */
      newHost: NEW_HOST,
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
    /** The waiting room while the room loads (#937, bible 7.4 "Waiting room"): replaces the #926 card. */
    waiting: {
      kicker: "SUMMONS · ROOM {code}",
      heading: "LOADING.",
      form: "MISSION ORDER",
      tag: "FORM 7-D",
      rows: { room: "ROOM", text: "TEXT", language: "LANGUAGE", desk: "DESK", ready: "READY" },
      textType: {
        sentences: "Real sentences",
        words: "Random words",
        "special-characters": "Special characters",
      },
      language: { fr: "French", en: "English" },
      steps: { papers: "PAPERS", desk: "DESK", machines: "MACHINES", copy: "COPY", major: "MAJOR" },
      phrases: {
        papers: "Sorting the papers…",
        desk: "Dusting the desk…",
        machines: "Oiling the machines…",
        copy: "Filing your copy…",
        major: "Waiting for the Major…",
      },
      progress: "LOADING PROGRESS",
      arrivals: "ARRIVALS",
      desk: "desk {n}",
      majorSays: "THE MAJOR SAYS:",
      /** #951: the briefing beside the mission order: the rules and the sabotage cards. */
      briefing: {
        form: "BRIEFING",
        tag: "FORM 7-B",
        rulesTitle: "THE RULES",
        rules: [
          "Everyone types the same text. The fastest clean copy wins.",
          "Speed counts correct characters only: 5 characters = 1 word, per minute.",
          "Accuracy is your correct keystrokes out of all keystrokes.",
          "Errors: depending on the room, a wrong key is struck through, or it jams the machine until you press the right one.",
          "The race ends when everyone has finished, or when the timer runs out.",
          "No key for 60 seconds and you are sent home: asleep at your desk.",
        ],
        sabotageTitle: "SABOTAGES",
        sabotageIntro:
          "The further behind you are, the more cards you get. The leader never gets one. To play, press the shortcut the alert shows: Option or Alt plus a letter that changes with every card.",
        unlocks: {
          "extra-paperwork": "bottom half",
          exemption: "bottom third",
          "smoke-break": "bottom quarter",
        },
      },
    },
    /** "Did you know?" lines under the loading stamp; filled by #383 (an empty list hides the row). */
    didYouKnow: [
      "Accuracy beats speed: every error costs you the time to notice it.",
      "Keep your eyes on the text, not on your fingers.",
      "Rest your fingers on the home row: A S D F and J K L ;.",
      "A smoke break blurs the text: keep typing from memory, it lifts in a few seconds.",
      "Save Exemption for a long word ahead: it removes words from your own text.",
      "Extra Paperwork always hits the leader. Use it when the top desk pulls away.",
      "Type in a steady rhythm. Bursts followed by stops are slower than they feel.",
      "On a French keyboard, learn where É, È, À and Ç live before the race.",
      "Your best and average speeds are filed in your Personnel file after each race.",
      "Sixty seconds without a key and the Major sends you home.",
    ] as string[],
    /** #951: why the 3D room went away (under the no-scene notice); `{fps}` = frames a second measured. */
    /** The projector view (#999, bible 14.3 "Projector view"): a spectator page, no desk. */
    /** #999 C10: the phone spectator screen (bible 14.3 "Phone spectator"): its one heading. */
    phone: {
      kicker: "SPECTATOR VIEW",
    },
    projector: {
      kicker: "PROJECTOR VIEW",
      connecting: "Tuning in to the room…",
      top: "TOP 10",
      typists: "{n} TYPISTS",
      standings: "Top 10 standings",
      noPlace: "··",
      scene: "The ring room, from above",
      plaqueDesk: "DESK {n}",
    },
    sceneDrop: {
      "no-webgl2": "This browser has no WebGL2, so the 3D room cannot run here.",
      "benchmark-low":
        "Your computer drew {fps} images a second in the room test, too few even at the lowest quality.",
      "benchmark-low-unknown":
        "Your computer was too slow in the room test, even at the lowest quality.",
      "context-lost":
        "The graphics card stopped drawing the room (WebGL context lost): memory or the driver gave up.",
      "frame-budget":
        "The room fell to {fps} images a second at the lowest quality during the race (18 needed), so it was turned off to keep your typing smooth.",
      "late-load": "The room was not ready when the race started (30 s), so you race on paper.",
    },
    notice: {
      "waiting-for-host": "WAITING FOR THE HOST",
      reconnecting: "LINE CUT · RECONNECTING",
      "idle-warning": "THE MAJOR IS LOOKING AT YOU. TYPE.",
      "no-scene": "NO PICTURE FROM THE ROOM · KEEP TYPING",
      phones: "PHONES WATCH FROM THE BACK OF THE ROOM",
    },
    /** The stuck hint (#999 C31, bible 7.4 notice row): `{char}` is the character the typist keeps missing. */
    stuckHint: { stuck: "STUCK ON {char}?", how: "HERE'S HOW →" },
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
      roomFull: "This room has reached its spectator limit.",
      generic: "Something jammed. Try again.",
      back: "BACK TO THE WAITING ROOM →",
    },
    abandon: { abandon: "ABANDON", confirm: "CONFIRM · REASSIGN ME" },
    sound: {
      label: "SOUND",
      off: "OFF",
      on: "ON",
      pending: "FILING…",
      errorPrefix: "RETURNED ·",
      error: "That change was not filed. Try again.",
    },
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
      /** #951: the card's own shortcut, a new letter per card (`{key}`: `⌥ K` / `Alt+K`). */
      hint: "{key} TO PLAY",
      alert: "SABOTAGE AVAILABLE · {key}",
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
    /**
     * The action row under the ranking (#143, bible 14.4): the same lobby races again; the way home is
     * `filing.home`. A guest who raced also gets the prompt to open a file (#863), its link to /sign-up.
     */
    actions: {
      again: "RACE AGAIN",
      prompt: "Open a file and these results stay in your name.",
      signup: "OPEN A FILE →",
    },
    /**
     * The personal stats card (#864, bible 14.4): the viewer's own copy. Place, figures, the review row
     * and the status read the podium's strings; bonus names are `race.sabotageTray.cards`.
     */
    personal: {
      tag: "FORM 5-R · YOUR COPY",
      sent: "SENT",
      received: "RECEIVED",
      none: "NONE",
      count: "× {n}",
      graph: {
        title: "WPM THROUGH THE RACE",
        summary: {
          zero: "Peak {peak} WPM, final {final} WPM, 0 bonuses received.",
          one: "Peak {peak} WPM, final {final} WPM, {n} bonus received.",
          other: "Peak {peak} WPM, final {final} WPM, {n} bonuses received.",
        },
        noTrace: "NO TRACE ON FILE",
        lines: "LINES ON THE GRAPH",
        you: "YOU",
        line: "№ {place} · {name} · {wpm} WPM",
        simulated: "SIMULATED",
        others: {
          one: "WPM through the race, {n} line shown.",
          other: "WPM through the race, {n} lines shown.",
        },
      },
      heatmap: {
        title: "KEYBOARD HEATMAP",
        board: "Keyboard heatmap, {layout}: {keys}.",
        key: "{key} × {n}",
        clean: "Keyboard heatmap, {layout}: no error on the keyboard.",
        legendClean: "paper: no error",
        legendHeat: "gold to red: fewer to more errors",
      },
      keys: {
        title: "ERRORS BY KEY",
        none: "NONE",
        space: "SPACE",
      },
      tip: {
        tag: "ORDER OF THE DAY",
        clean: "Not one error on file: keep this rhythm and the speed will follow.",
        special: "The {key} key slipped {n} times: the guide shows how to type it.",
        key: "The {key} key slipped {n} times: slow down on it next race and the rest will follow.",
        space:
          "The space bar slipped {n} times: leave one clean space after each word, never two, never none.",
        capital:
          "The capital {key} slipped {n} times: hold Shift with your other hand first, then strike the letter.",
        punctuation:
          "The {key} key slipped {n} times: punctuation counts too, so spot it before you reach the end of the word.",
        digit:
          "The {key} key slipped {n} times: numbers live on the top row, so reach up for them without looking down.",
        spread:
          "Your slips were spread over {n} different keys: a steadier, slightly slower rhythm fixes most of them.",
        accuracy: "Speed is good, accuracy is better: slow down a little and make every key count.",
        steady: "A steady copy: next race, push the pace a little on the words you know.",
      },
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
      loading: "SUMMONING THE CLERK…",
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
  /**
   * The settings screen (#66, bible 14.3 "Settings"): the form-screen family head, one docket of five
   * sections, the save states and the account section's placeholders.
   */
  settings: {
    kicker: "MINISTRY OF TYPING · FORM 1-F",
    title: "SETTINGS",
    lede: "Your desk, your way. Each change is filed the moment you make it.",
    form: "FORM 1-F",
    tag: "DESK SETTINGS",
    sections: {
      layout: "KEYBOARD LAYOUT",
      theme: "THEME",
      language: "LANGUAGE",
      sound: "SOUND",
      account: "ACCOUNT",
    },
    layout: {
      hint: "Pick the keyboard on your desk. Its accent keys are marked in ink.",
      names: {
        CSA: "CANADIAN FRENCH (CSA)",
        FR_CA: "FRENCH CANADA",
        US_QWERTY: "US QWERTY",
        AZERTY: "AZERTY",
      },
    },
    theme: { LIGHT: "LIGHT", DARK: "DARK", SYSTEM: "SYSTEM" },
    language: { en: "ENGLISH", fr: "FRANÇAIS" },
    sound: { on: "ON", off: "OFF", hint: "Key clacks and the carriage bell during a race." },
    /** The seat-view machine (#638, bible 7.7a): one name per registered skin of `machineSkinIds`. */
    machine: {
      title: "MACHINE",
      hint: "The machine on your desk during a race.",
      skin: { teleprinter: "TELEPRINTER" },
    },
    /** The daily goal (#968, bible 14.3): the minutes the attendance register shades each day against. */
    goal: {
      title: "DAILY GOAL",
      value: "{n} MIN / DAY",
      valueText: "{n} minutes a day",
      hint: "Used by the attendance register. The Major does not forgive absences, but he notes them politely.",
    },
    status: {
      pending: "FILING…",
      saved: "FILED",
      errorPrefix: "RETURNED ·",
      error: "That change was not filed. Try again.",
    },
    account: {
      typist: "TYPIST",
      username: "USERNAME",
      guestTag: "GUEST",
      keep: "Create an account to keep your file",
      signUp: "OPEN A FILE →",
      picture: "CHANGE PICTURE",
      deleteData: "DELETE MY DATA",
      soon: "Coming soon.",
    },
    /** The first-race keyboard prompt (#70): a docket dialog in the lobby while no layout is on file. */
    layoutPrompt: {
      form: "FORM 1-K",
      tag: "FIRST RACE",
      title: "WHICH KEYBOARD IS ON YOUR DESK?",
      body: "Pick the one you type on, so your heatmap marks the right keys. You can change it later in Settings.",
      later: "ASK ME LATER",
    },
    avatar: {
      /** The picture dialog (#60): choose, frame, preview, file. Errors map `AvatarErrorCode`. */
      dialog: {
        form: "FORM 1-P",
        tag: "ID PICTURE",
        title: "CHANGE PICTURE",
        body: "Choose a picture, then frame your face in the square. Drag it, zoom with the slider or the wheel, nudge it with the arrow keys.",
        rules: "JPEG, PNG, WebP or GIF, up to 5 MB, at least 64 × 64 pixels.",
        choose: "CHOOSE A PICTURE",
        chooseAnother: "CHOOSE ANOTHER",
        crop: "Picture frame: drag or use the arrow keys to move the picture",
        zoom: "ZOOM",
        current: "ON FILE",
        preview: "PREVIEW",
        save: "SIGN & FILE",
        saving: "FILING…",
        cancel: "CANCEL",
        close: "CLOSE",
        saved: "FILED",
        reviewTitle: "UNDER REVIEW",
      },
      errors: {
        TooLarge: "That file is over 5 MB. Choose a smaller picture.",
        WrongType: "That file is not a picture we take. Use JPEG, PNG, WebP or GIF.",
        TooSmall: "That picture is too small. It needs at least 64 × 64 pixels.",
        Undecodable: "That picture could not be read. Try another file.",
        BadCrop: "That frame did not fit the picture. Move it and try again.",
        Rejected: "That picture was refused.",
        failed: "That picture was not filed. Try again.",
      },
      moderation: {
        pending:
          "Your picture is being reviewed. Until a person checks it, everyone sees the default portrait, you too.",
        rejected: "Your picture was refused. It breaks the picture rules, so it was not filed.",
        appeal:
          "Think this is a mistake? Ask your teacher or your school office to contact the person in charge.",
      },
    },
  },
  /**
   * Accounts: the sign-in and sign-up screens, their actions' errors and the header account control
   * (#36, bible 14.3 extension); the merge stamp after a guest merge (#57, bible 7.3 ink tone).
   */
  auth: {
    account: {
      guestTag: "GUEST",
      signIn: "SIGN IN",
      signOut: "SIGN OUT",
    },
    signIn: {
      kicker: "MINISTRY OF TYPING · FORM 1-A",
      title: "SIGN IN",
      lede: "Show your papers and get back to your desk.",
      form: "FORM 1-A",
      tag: "RETURNING TYPIST",
      submit: "SIGN IN",
      pending: "CHECKING PAPERS…",
      switchPrompt: "No file yet?",
      switchLink: "OPEN A FILE →",
      /** The link to `/recover` (#46, owner decision 2026-11-09). */
      recoverPrompt: "Lost your password?",
      recoverLink: "USE YOUR RECOVERY CODE →",
    },
    signUp: {
      kicker: "MINISTRY OF TYPING · FORM 1-B",
      title: "OPEN A FILE",
      lede: "Pick a username and a password. The ministry opens your file.",
      form: "FORM 1-B",
      tag: "NEW TYPIST",
      submit: "OPEN MY FILE",
      pending: "FILING…",
      switchPrompt: "Already on file?",
      switchLink: "SIGN IN →",
    },
    fields: {
      username: "USERNAME",
      password: "PASSWORD",
      usernameHint: "3 to 20 characters: letters, numbers and _.",
      passwordHint: "At least 8 characters.",
    },
    providers: {
      or: "OR",
      github: "CONTINUE WITH GITHUB",
      discord: "CONTINUE WITH DISCORD",
      google: "CONTINUE WITH GOOGLE",
      age: "GitHub, Discord and Google are for ages 13 and up. Under 13? Use a username, or play as a guest.",
    },
    guest: {
      title: "NO PAPERS?",
      body: "Race right away. Your races stay with this browser until you open a file.",
      cta: "PLAY AS GUEST →",
    },
    privacy: "Privacy: what we keep and why",
    oauthError: {
      title: "RETURNED",
      body: "That sign-in did not go through. Try again, use your username, or play as a guest.",
      denied: "That sign-in was not allowed. Use your username, or play as a guest.",
      notLinked: "That account is already on another file. Sign in the way you did before.",
      unavailable:
        "That sign-in is not available right now. Use your username, or play as a guest.",
    },
    errors: {
      prefix: "RETURNED ·",
      usernameRequired: "Enter a username.",
      usernameLength: "Use 3 to 20 characters.",
      usernameChars: "Use only letters, numbers and _.",
      usernameTaken: "That username is already on file. Pick another one.",
      usernameRefused: "That username is not allowed. Pick another one.",
      passwordRequired: "Enter a password.",
      passwordLength: "Use 8 to 128 characters.",
      fields: "Only a username and a password can be filed.",
      credentials: "Wrong username or password.",
      alreadySignedIn: "You are already signed in. Sign out to open another file.",
      generic: "Something jammed. Try again.",
    },
    /**
     * `/reset` (#789, bible 14.3 "Password reset screen"): a student redeems the code a teacher
     * issued (#788, #790). No email and no recovery code anywhere; errors never echo the input.
     */
    reset: {
      kicker: "MINISTRY OF TYPING · FORM 1-C",
      title: "NEW PASSWORD",
      lede: "Your teacher gave you a reset code. Type it with your username and pick a new password.",
      form: "FORM 1-C",
      tag: "PASSWORD RESET",
      fields: {
        username: "USERNAME",
        code: "RESET CODE",
        codeHint: "The 8 letters and numbers your teacher gave you.",
        password: "NEW PASSWORD",
        passwordHint: "At least 8 characters.",
      },
      submit: "SET MY PASSWORD",
      pending: "FILING…",
      switchPrompt: "Remembered it?",
      switchLink: "SIGN IN →",
      done: {
        title: "PASSWORD SET",
        body: "Your new password is on file and your other sessions are signed out. Sign in with it.",
        link: "SIGN IN →",
      },
      errors: {
        prefix: "RETURNED ·",
        usernameRequired: "Enter your username.",
        usernameLength: "Use 3 to 20 characters.",
        usernameChars: "Use only letters, numbers and _.",
        codeRequired: "Enter the reset code.",
        codeFormat: "Use the 8 letters and numbers your teacher gave you.",
        passwordRequired: "Enter a new password.",
        passwordLength: "Use 8 to 128 characters.",
        fields: "Only a username, a code and a new password can be filed.",
        invalid:
          "Wrong username or code, or the code is used or expired. Ask your teacher for a new one.",
        "rate-limited": "Too many tries. Try again in {m} min.",
        generic: "Something jammed. Try again.",
      },
    },
    /** The one-time recovery code (#46, ADR 0009): the reveal after sign-up and `/recover`. */
    recovery: {
      reveal: {
        kicker: "MINISTRY OF TYPING · FORM 1-D",
        title: "RECOVERY CODE",
        lede: "Write these 10 words on paper and keep them somewhere safe. They are the only way back into your file if you forget your password.",
        form: "FORM 1-D",
        tag: "SHOWN ONCE",
        listName: "Your recovery code, 10 words",
        stamp: "ISSUED",
        warning: {
          title: "LOST CODE, LOST FILE",
          primary:
            "There is no email and no other way back: if you lose your password and this code, your file is gone.",
          other:
            "Il n'y a ni courriel ni autre moyen : si tu perds ton mot de passe et ce code, ton dossier est perdu.",
          otherLang: "fr",
        },
        copy: "COPY",
        copied: "COPIED",
        copiedStatus: "Recovery code copied",
        selectedStatus: "Recovery code selected: copy it with your keyboard",
        ack: "I wrote it down",
        continue: "CONTINUE →",
        gone: {
          title: "ALREADY SHOWN",
          body: "A recovery code is shown only once. If you did not write it down, keep your password safe: it is now your only key.",
          link: "BACK TO THE MINISTRY →",
        },
      },
      kicker: "MINISTRY OF TYPING · FORM 1-E",
      title: "RECOVER MY FILE",
      lede: "Lost your password? Type your username and the 10 words of your recovery code, then pick a new password.",
      form: "FORM 1-E",
      tag: "RECOVERY",
      fields: {
        username: "USERNAME",
        code: "RECOVERY CODE",
        codeHint: "The 10 words you wrote down, in any order.",
        password: "NEW PASSWORD",
        passwordHint: "At least 8 characters.",
      },
      submit: "RECOVER MY FILE",
      pending: "FILING…",
      switchPrompt: "Remembered it?",
      switchLink: "SIGN IN →",
      done: {
        title: "PASSWORD SET",
        body: "Your new password is on file and your other sessions are signed out. Your old code no longer works: write down the new one below, then sign in.",
        link: "SIGN IN →",
      },
      errors: {
        prefix: "RETURNED ·",
        usernameRequired: "Enter your username.",
        usernameLength: "Use 3 to 20 characters.",
        usernameChars: "Use only letters, numbers and _.",
        codeRequired: "Enter your recovery code.",
        codeFormat: "Type the 10 words of your recovery code.",
        passwordRequired: "Enter a new password.",
        passwordLength: "Use 8 to 128 characters.",
        fields: "Only a username, a code and a new password can be filed.",
        invalid: "Wrong username or recovery code.",
        "rate-limited": "Too many tries. Try again in {m} min.",
        generic: "Something jammed. Try again.",
      },
    },
    merge: {
      stamp: "FILED",
      carried: { zero: "0 RACES CARRIED", one: "1 RACE CARRIED", other: "{n} RACES CARRIED" },
      sentence: {
        zero: "0 races and your stats were carried into your Personnel file.",
        one: "1 race and your stats were carried into your Personnel file.",
        other: "{n} races and your stats were carried into your Personnel file.",
      },
      dismiss: "DISMISS",
    },
  },
  /** The Personnel file at /profile (#932, bible 14.3 "Personnel file", reference Profil.dc.html). */
  profile: {
    /**
     * The enamel pins (#999 C36, C40; spec 13.4, bible 13, 7.6, 14.3 "Medals"): the section and each
     * pin's in-world name and description, keyed by the stable achievement ids (`ACHIEVEMENT_IDS`).
     */
    medals: {
      kicker: "DECORATIONS · ENAMEL PINS",
      title: "Medals",
      intro:
        "Pinned to your file for good. A locked pin shows what the Ministry still expects of you.",
      count: "{n} / {total} PINNED",
      none: "No pin on your file yet. Win a race, or finish one without a single error, and the Ministry pins your first.",
      list: "Enamel pins",
      awarded: "PINNED {date}",
      locked: "LOCKED",
      new: "NEW",
      pins: {
        "first-win": {
          name: "Order of the First Copy",
          description: "Win a race against at least one other desk.",
        },
        "wpm-50-club": {
          name: "Fifty Club",
          description: "Finish a race at 50 clean words per minute or more.",
        },
        "accuracy-100": {
          name: "Spotless Copy",
          description: "Finish a race without a single error.",
        },
        "accent-master": {
          name: "Master of Accents",
          description: "Finish an accent text at 95% accuracy or more.",
        },
        "streak-7-days": {
          name: "Seven-Day Shift",
          description: "Race on seven days in a row.",
        },
      },
    },
    /**
     * The improvement callout templates (#999 C40, consumed by the callouts of C48): week over week,
     * per key, from the daily character stats. `{key}` the character, `{pct}` a whole percentage.
     */
    callouts: {
      kicker: "WEEKLY BULLETIN",
      title: "This week at your desk",
      faster: "Your {key} is {pct}% faster than last week.",
      slower: "Your {key} is {pct}% slower than last week: a short practice brings it back.",
      cleaner: "You missed {key} {pct}% less often than last week.",
      messier:
        "You missed {key} {pct}% more often than last week: slow down on it and it will settle.",
      steady: "Your {key} held its speed this week. Steady work.",
      intro: "Week over week, key by key, from your counted races.",
      list: "This week's callouts",
    },
    accents: {
      kicker: "ACCENTS & SPECIAL CHARACTERS",
      title: "Accents row",
      intro:
        "The French accents and special characters, one key each. Pick one to see how to type it.",
      row: "Accents row",
      legendSize: "circle size: how often you strike it, next to the rest of the row",
    },
    ladder: {
      label: "GRADE LADDER · BY YOUR AVERAGE",
      next: "{wpm} / {next} WPM → {rank}",
      top: "TOP GRADE",
      current: "{rank}, current grade",
      progressName: "Progress to {rank}",
      progressTop: "Top grade reached",
    },
    stage: {
      label: "ID PICTURE",
      clerkTitle: "Your clerk in uniform",
    },
    kicker: "PERSONNEL FILE",
    kickerNumbered: "PERSONNEL FILE · № {number}",
    since: "In service since {date}.",
    languages: {
      both: "Types in French and English, accents included.",
      FR: "Types in French, accents included.",
      EN: "Types in English.",
    },
    verified: ["FILE", "VERIFIED"],
    tubes: {
      label: "Your figures",
      avgWpm: "AVG WPM",
      best: "BEST",
      accuracy: "ACCURACY",
      medals: "MEDALS",
      none: "none",
    },
    band: {
      confidential: "CONFIDENTIAL",
      file: "FILE",
      fileNumbered: "FILE № {number}",
      filed: "EVERY KEYSTROKE IS FILED",
      notes: "THE MAJOR TOOK NOTES",
    },
    tabs: {
      label: "File sections",
      stats: "01 · STATISTICS",
      settings: "02 · FILE SETTINGS",
    },
    service: {
      kicker: "GENERAL REPORT · ALL TIME",
      title: "Service record",
      intro:
        "The official figures. Speed in words per minute (WPM), accuracy as the share of correct keystrokes.",
      totalTime: "TOTAL TIME",
      races: "RACES",
      bestSpeed: "BEST SPEED",
      averageSpeed: "AVERAGE SPEED",
      bestAccuracy: "BEST ACCURACY",
      averageAccuracy: "AVERAGE ACCURACY",
      wins: "WINS",
      podiums: "PODIUMS",
      keystrokes: "CORRECT KEYSTROKES",
      errors: "TYPOS",
      sabotagesSent: "SABOTAGES SENT",
      sabotagesReceived: "SABOTAGES TAKEN",
      wpm: "WPM",
      firstPlace: "1ST PLACE",
      top3: "TOP 3",
    },
    bests: {
      kicker: "PERSONAL BESTS · BY CATEGORY",
      title: "Personal bests",
      intro:
        "Your best clean speed per language, text type and length. Only a counted race can set one.",
      none: "No best on file yet. Finish a race and the Ministry files your fastest one here, per language, text type and length.",
      languages: { FR: "FRENCH", EN: "ENGLISH" },
      compare: {
        title: "FRENCH VERSUS ENGLISH",
        tag: "CLEAN SPEED",
        caption: "French versus English: races, best and average clean speed per language",
        language: "LANGUAGE",
        races: "RACES",
        best: "BEST",
        mean: "AVERAGE",
        faster: "In French you type {diff} WPM faster than in English, on average.",
        slower: "In French you type {diff} WPM slower than in English, on average.",
        even: "Same average speed in French and in English.",
        only: {
          FR: "Only French on file so far. Race in English to compare.",
          EN: "Only English on file so far. Race in French to compare.",
        },
      },
      table: {
        title: "BY TEXT TYPE AND LENGTH",
        tag: "CLEAN WPM",
        caption: "Personal bests per language, text type and length",
        region: "Personal bests, scrolls sideways",
        language: "LANGUAGE",
        text: "TEXT",
        best: "BEST",
        accuracy: "ACCURACY",
        date: "SET ON",
        types: { SENTENCES: "SENTENCES", WORDS: "WORDS", SPECIAL_CHARACTERS: "SPECIAL CHARACTERS" },
        lengths: { SHORT: "SHORT", MEDIUM: "MEDIUM", LONG: "LONG" },
      },
    },
    curve: {
      kicker: "OUTPUT CURVE",
      title: "Speed race after race",
      intro: "Your last {count} races.",
      introTrend: "The dashed line shows the overall trend.",
      smoothing: "SMOOTHING",
      legend: {
        speed: "speed (WPM, left)",
        accuracy: "accuracy (%, right)",
        trend: "trend",
        week: "7-day average",
      },
      units: { speed: "WPM", accuracy: "%" },
      summary:
        "{count} races: speed from {speedFrom} to {speedTo} WPM, accuracy from {accuracyFrom} to {accuracyTo}%{trend}{week}.",
      week: ", 7-day average {wpm} WPM",
      gain: "{gain} WPM",
      gainSince: "since you started",
      gainSoon: "Your gain since you started shows from {count} races.",
      trend: { up: ", trending up", down: ", trending down", flat: ", holding steady" },
    },
    /** #967, bible 14.3: the typist census section, `Ta place au Ministère` (ADR 0023: no head count). */
    census: {
      kicker: "TYPIST CENSUS",
      title: "Your place at the Ministry",
      modesLabel: "Measure",
      modes: { speed: "SPEED", accuracy: "ACCURACY" },
      metricsLabel: "Your figure",
      metrics: { average: "AVERAGE", best: "BEST" },
      subjects: {
        averageSpeed: "average speed",
        bestSpeed: "best speed",
        averageAccuracy: "average accuracy",
        bestAccuracy: "best accuracy",
      },
      sentence: "Your {subject} beats that of {percentile} of the Ministry's comrades.",
      you: "YOU · {value}",
      plot: "{sentence} You: {value}.",
      units: { speed: "WPM", accuracy: "%" },
      legend: {
        beaten: "comrades you beat",
        ahead: "those ahead of you",
        cumulative: "cumulative share",
      },
    },
    streaks: {
      title: "CLEAN STREAKS",
      tag: "RACES IN A ROW",
      caption: "Clean streaks: races in a row at or above each accuracy threshold",
      threshold: "THRESHOLD",
      best: "BEST",
      wpmDuring: "WPM DURING",
      current: "CURRENT",
      row: "≥ {threshold} %",
      foot: "Your longest run of finished races above each accuracy threshold. The longer the run, the happier the Major.",
    },
    suspectPairs: {
      title: "SUSPECT COMBINATIONS",
      tag: "UNDER WATCH",
      row: "{pair}: {rate} errors, {speed}",
      wpm: "WPM",
      noSpeed: "speed not measured",
      foot: "The sequences where your fingers trip most often: error rate and speed on the pair.",
    },
    keyProgress: {
      kicker: "LEARNING REPORT",
      title: "Progress by key",
      intro: "One row per key, one cell per day of typing. Keys you never met stay empty.",
      region: "Progress by key, scrolls sideways",
      key: "KEY",
      days: "DAY 1 → {count}",
      dayOne: "DAY 1",
      average: "AVG WPM",
      row: "{key}: average {average} WPM, from {low} to {high} over {count} days",
      rowOne: "{key}: average {average} WPM, over 1 day",
      rowAverage: "{key}: average {average} WPM",
      never: "{key}: never met",
      slow: "SLOW",
      fast: "FAST",
    },
    keySheet: {
      kicker: "INDIVIDUAL QUESTIONING",
      title: "Key sheet",
      intro: "Pick a key. Navy: {goal} WPM goal reached. Red: needs work.",
      chips: "Keys",
      chip: {
        good: "{key}, goal reached",
        weak: "{key}, needs work",
        none: "{key}, never met",
      },
      cells: {
        latest: "LATEST SPEED",
        best: "BEST",
        average: "AVERAGE",
        rate: "LEARNING RATE",
        errors: "ERROR RATE",
      },
      wpm: "WPM",
      perDay: "{rate} / DAY",
      uncertain: "UNCERTAIN",
      plot: "Key {key}: from {from} to {to} WPM over {count} days, {goal}.",
      plotOne: "Key {key}: {to} WPM over 1 day, {goal}.",
      plotNone: "Key {key}: no day measured yet.",
      reached: "{goal} WPM goal reached",
      notReached: "{goal} WPM goal not reached yet",
      legendSpeed: "speed on key {key}",
      legendGoal: "{goal} WPM goal",
      practise: "PRACTISE THIS LETTER · {key}",
      practising: "OPENING YOUR DESK…",
      practiseFailed: "The practice room did not open. Try again.",
      returned: "RETURNED ·",
    },
    keyInventory: {
      kicker: "KEY INVENTORY",
      title: "Speed, strokes and errors",
      intro:
        "Average speed per key, then how many times you struck it, missed it, and the share of misses.",
      region: "Speed, strokes and errors, scrolls sideways",
      rows: {
        speed: "AVG SPEED",
        strokes: "STROKES",
        errors: "ERRORS",
        ratio: "ERROR RATIO",
      },
      legendGoal: "{goal} WPM goal",
      table: {
        caption: "Speed, strokes and errors by key",
        key: "Key",
        speed: "Average speed",
        strokes: "Strokes",
        errors: "Errors",
        ratio: "Error ratio",
      },
      wpm: "WPM",
      reached: "goal reached",
      under: "under the goal",
    },
    keyboardMap: {
      kicker: "MACHINE PLAN · {layout}",
      title: "Keyboard map",
      layouts: "Keyboard layout",
      board: "Keyboard map, {layout}",
      pads: { top: "TAB", home: "CAPS", bottom: "SHIFT" },
      rows: {
        number: "NUMBER ROW",
        top: "TOP ROW",
        home: "HOME ROW",
        bottom: "BOTTOM ROW",
      },
      key: "{key}: {strokes} of strokes, {errors} errors",
      untyped: "{key}: never struck",
      guide: "{name} · how to type it",
      legendSize: "circle size: how often you strike it",
      legendCore: "red core: share of errors",
    },
    attendance: {
      kicker: "TIME SHEET",
      title: "Attendance register",
      figures: "Attendance",
      current: "CURRENT STREAK",
      best: "BEST",
      active: "ACTIVE DAYS",
      days: "{count} DAYS",
      dayOne: "{count} DAY",
      goal: "DAILY GOAL ({goal} MIN)",
      legend: "Legend: share of the daily goal",
      cell: "{date}: {minutes} min, {percent} % of the goal",
      cellNone: "{date}: no race",
      cellFuture: "{date}: still to come",
      today: "{date} (today)",
    },
    archive: {
      kicker: "ARCHIVES · LAST {count} ENTRIES",
      kickerOne: "ARCHIVES · LAST ENTRY",
      title: "Race archives",
      caption: "Your {count} latest races, newest first",
      captionOne: "Your latest race",
      region: "Race archives, scrolls sideways",
      date: "DATE",
      room: "ROOM",
      mode: "MODE",
      place: "PLACE",
      wpm: "WPM",
      accuracy: "ACCURACY",
      award: "Award",
      modes: { RACE: "RACE", PRIVATE: "PRIVATE", BOTS: "BOTS" },
      awards: { medal: "MEDAL", podium: "PODIUM" },
      none: "—",
    },
    blank: {
      stamp: ["NOT ENOUGH", "DATA"],
      kicker: "BLANK FILE",
      nothing: "The Ministry has nothing on you.",
      almostNothing: "The Ministry has almost nothing on you.",
      body: "Finish three races and the graphs will appear here: speed, accuracy, weak keys, attendance register.",
      cta: "QUICK RACE",
    },
  },
  /** The Home menu (#943, #945, #946; bible "Home menu (extension, #943)"): `/` for a viewer. */
  home: {
    band: "MINISTRY OF TYPING · 1978",
    menuLabel: "Main menu",
    entries: {
      play: { label: "PLAY", description: "A quick race against the typists of the ring rooms." },
      practice: {
        label: "PRACTICE",
        description: "A private room against the bots, at your own pace.",
      },
      rooms: { label: "OPEN ROOMS", description: "The public rooms you can join right now." },
      file: {
        label: "MY FILE",
        description: "Your Personnel file: speed, accuracy and service record.",
      },
      clerk: { label: "MY CLERK", description: "Open your locker and dress your clerk." },
      settings: { label: "SETTINGS", description: "Keyboard, language, theme and sound." },
    },
    pending: { play: "FINDING A ROOM…", practice: "OPENING YOUR DESK…" },
    tag: { one: "{n} NEW", other: "{n} NEW" },
    keys: {
      label: "Keys",
      arrows: "↑↓",
      navigate: "NAVIGATE",
      enter: "ENTER",
      select: "SELECT",
      esc: "ESC",
      signOut: "SIGN OUT",
      signIn: "SIGN IN",
    },
    version: "v{version}",
    online: "{n} ONLINE",
    onlineSpoken: { one: "{n} player online", other: "{n} players online" },
    mission: {
      title: "MISSION OF THE DAY",
      lines: {
        "accuracy-95": "3 races at 95 % accuracy",
        "finish-3": "Finish 3 races",
        "accuracy-98": "1 race at 98 % accuracy",
      },
      progressName: "Mission of the day progress",
      done: "DONE",
      plus: "+1",
    },
    docket: {
      guest: "GUEST",
      line: "{wpm} / {next} WPM → {rank}",
      progressName: "Progress to {rank}",
      fileName: "My file, {name}",
      stars: { one: "{n} star", other: "{n} stars" },
    },
    stageTitle: "Your clerk in your saved uniform",
  },
  /** The locker (#943 part D, bible 14.2 and "Locker in the app (extension, #943)"): `/locker`. */
  locker: {
    signedOut: {
      title: "NO LOCKER ON FILE",
      body: "Sign in, or race once as a guest, to get a locker.",
      cta: "SIGN IN",
    },
    title: "DRESS YOUR CLERK",
    kicker: "FORM 5-C · UNIFORM ISSUE",
    crumb: "THE LOCKER",
    back: "← BACK TO THE MENU",
    lockerNo: "LOCKER № 0457",
    unassigned: "UNASSIGNED",
    stageTitle: "Your clerk in the selected uniform",
    stageHint: "CLICK HIM TO WAVE · HE FOLLOWS YOUR CURSOR",
    tabsLabel: "Uniform categories",
    random: "RANDOM ISSUE",
    undo: "UNDO CHANGES",
    sign: "SIGN & FILE",
    filing: "FILING…",
    onFile: "ON FILE",
    filed: "FILED",
    issued: "ISSUED",
    new: "NEW",
    dirty: "UNSIGNED CHANGES · SIGN THE FORM TO KEEP THEM",
    colourLabel: "HAIR COLOUR · ALSO FOR BEARD & MOUSTACHE",
    colours: ["Chestnut", "Ink", "Copper", "Wheat", "Ash"],
    keysHint: "← → TABS",
    errorPrefix: "RETURNED ·",
    refused: "That uniform was not filed. Try again.",
    subs: {
      hair: {
        side: "CLERK STANDARD",
        buzz: "BARRACKS",
        quiff: "DANCE HALL",
        bowl: "HOME-MADE",
        bald: "POLISHED",
      },
      glasses: {
        round: "BRASS FRAME",
        dark: "NIGHT SHIFT",
        square: "ACCOUNTANT",
        monocle: "OLD MONEY",
        none: "20/20 VISION",
      },
      hat: {
        none: "INDOORS",
        ushanka: "WINTER ISSUE",
        kepka: "FACTORY FLOOR",
        eyeshade: "NIGHT SHIFT",
        beret: "ARTIST UNION",
      },
      clothes: {
        vest: "OLIVE WOOL",
        cardigan: "GRANDMA KNIT",
        jacket: "NAVY CANVAS",
        sweater: "GREY RIB",
        braces: "SUMMER",
      },
      face: { stache: "REGULATION", clean: "FRESH RAZOR", beard: "PHILOSOPHER" },
    },
  },
};

export type Messages = typeof en;
