// English banned entries for names (card #42).
// Source: LDNOOBW "List of Dirty, Naughty, Obscene and Otherwise Bad Words" (en,
// CC-BY-4.0), trimmed to what can appear in a short name, plus common slurs and
// leetspeak-free spellings of their variants (leet is handled by normalize.ts).
// Reviewer: Deliver of #42 (the card's QA pass is the review evidence).
// Rule: short or ambiguous words stay whole-token; only long, unambiguous words
// are embedded (see entry.ts). Data only: never copy these words into issues or PRs.
import { embedded, type Entry, whole } from "./entry";

export const EN: readonly Entry[] = [
  ...whole(`
    fuk fuq fck fcuk phuck fuckin
    shit shits shitty shite shitlord shitbag shitface dipshit
    ass asses arse arsehole jackass dumbass fatass smartass asshat asswipe
    cunt cunts dick dicks dickface dickwad prick pricks cock cocks cockhead
    pussy pussies twat twats wank wanking tosser bellend
    slut sluts slutty skank hoe hoes thot hooker pimp
    tit tits titty titties boob boobs boobies
    penis erection boner cum semen sperm anal anus porn porno nude nudes sex xxx
    horny orgy fap dilf queef felch fisting rimming
    rape raped raping rapist rapey pedo paedo
    nazi hitler heil milf kkk fag fags homo dyke tranny coon spic spick chink gook kike kyke
    beaner paki retard retarded tard spaz moron kys
    damn goddamn crap crappy piss pissed pisser douche turd bugger minge numbnuts
  `),
  ...embedded(`
    fuck motherfucker cocksucker
    bullshit horseshit shithead
    asshole butthole dickhead knobhead
    bitch sonofabitch bastard whore wanker bollocks
    dildo jizz cumshot cumslut blowjob handjob rimjob deepthroat gangbang bukkake
    masturbate masturbation jerkoff jackoff nutsack ballsack smegma upskirt
    vagina clitoris scrotum testicle orgasm ejaculate pornhub shemale
    pedophile paedophile molester incest bestiality necrophilia
    nigger nigga niggas sandnigger faggot wetback raghead towelhead
    siegheil whitepower killyourself douchebag scumbag
  `),
];
