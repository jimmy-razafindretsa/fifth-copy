import { describe, expect, it } from "vitest";
import { isClean } from "./is-clean";

// Corpus of usernames (card #42, C3). Whitespace-separated; `_`, `-`, `.` and
// other separators inside a name are part of the name. Ambiguous first names
// (the kind that double as slang) are kept out of both columns on purpose.
const words = (s: string): string[] => s.split(/\s+/).filter(Boolean);

const EN_BLOCKED = words(`
  fuck FUCK f.u.c.k f_u_c_k fuuuuck Fuck_You FuckYou fuckface MotherFucker xXfuckerXx
  phuck fcuk fuk fuq sh1t $hit shiiit ShitLord shitbag Sh1tHead BullSh1t horseshit dipshit
  a$$ a55 @ss Ass_Man dumb_ass asshole a$$hole Ass.Hole assh0le jackass smartass asshat arse
  arsehole b1tch biiitch Bitch99 xXbitchXx SonOfABitch bastard B4st4rd cunt c.u.n.t
  dick D1ck dickhead DickFace dickwad prick cock c0ck CockHead cocksucker pussy pu$$y puuussy
  twat tw@t wanker w4nk3r wank tosser bellend bollocks knobhead whore wh0re Wh0r3 slut s1ut
  Slutty skank Hoe thot tits t1ts titties boobs b00bs Booobies dildo d1ld0 jizz Cumshot cum
  blowjob Blow_Job handjob rimjob porn p0rn porno PornHub XXX nude sex s3x horny orgasm milf
  MILF_hunter rape r4pe rapist pedo p3d0 pedophile paedophile molester incest nigger n1gg3r
  N.i.g.g.e.r nigga n1gga niggas faggot f4gg0t fag dyke tranny coon spic chink gook kike
  beaner wetback raghead towelhead paki retard r3tard Retarded spaz moron kys KillYourself
  nazi n4zi Hitler H1tler SiegHeil Heil_Hitler kkk WhitePower damn GodDamn crap piss P1ss
  douche douchebag scumbag turd bugger numbnuts ballsack nutsack testicle vagina penis p3nis
  clitoris anal anus scrotum smegma deepthroat gangbang bukkake jerkoff jackoff masturbate
  shemale upskirt ejaculate bestiality
`);

const EN_ALLOWED = words(`
  James Mary Robert Patricia John Jennifer Michael Linda David Elizabeth William Barbara
  Richard Susan Joseph Jessica Thomas Sarah Charles Karen Christopher Nancy Daniel Lisa
  Matthew Betty Anthony Margaret Mark Sandra Donald Ashley Steven Kimberly Paul Emily Andrew
  Donna Joshua Michelle Kenneth Carol Kevin Amanda Brian Melissa George Deborah Timothy
  Stephanie Ronald Rebecca Jason Sharon Edward Laura Jeffrey Cynthia Ryan Kathleen Jacob Amy
  Gary Angela Nicholas Shirley Eric Anna Jonathan Brenda Hannah Cassandra Bianca Massimo
  Scunthorpe Penistone Cockburn Hancock Peacock Hitchcock Woodcock Babcock Middlesex Essex
  Sussex Wessex Assassin Bassist Classic Compass Embassy Grassland Passion Massachusetts
  Analyst Analysis Therapist Cumberland Cucumber Circumstance Document Arsenal Arsene
  Matsushita Shiitake Titanic Titus Constitution Appetite Button Buttercup Butterfly
  Scrapbook Skyscraper Pissarro Dickens Dickinson Sextant Cocktail Cockpit Shuttlecock
  Nigeria Niger Pakistan Spice Spicy Raccoon Cocoon Tycoon Shoe Phoebe Homer Grape Drape
  Tardis Retardant Swank Wankel Prickly Bassoon Cassette Glass Grasshopper Hassle Sassafras
  Assets Harass Brass Bob Bobby Milford Whittier Hello Shell Computer Sparrow-123
  xX_Shadow_Xx Night.Owl Blue_Heron Otter99 Lynx-42 Typist_Comrade
`);

const FR_BLOCKED = words(`
  putain PUTAIN p.u.t.a.i.n Put4in pute Sale_Pute putes putassier salope s4lope sal0pe
  Saloooope salaud salopard connard c0nnard Gros_Connard connasse conasse con Le_Con conne
  enculé encule Encul3 enculer enfoiré enf0ire merde m3rde MerdeAlors merdeux emmerdeur
  chier chieur chiasse cul Trou_Du_Cul trouduc couille couilles Couillon bite b1te
  Suce_Ma_Bite zob teub chatte foutre branleur branlette pétasse petasse pouffiasse
  grognasse garce catin radasse nique niquer Nique_Ta_Mère NTM fdp Fils_De_Pute filsdepute
  ta_gueule TaGueule pd pédé PeDe tapette tarlouze tafiole fiotte lopette gouine fif nègre
  negre négresse négro bougnoule bicot youpin youtre chinetoque niakoué bamboula Sale_Arabe
  gogol triso abruti débile crétin imbécile enflure raclure bâtard b4tard baiseur suceuse
  violeur pédophile inceste zoophile sodomite partouze fellation queutard braquemart nichons
  sperme éjaculer clito vagin pénis tabarnak TABARNAK t@b@rn4k Tabarnaque tabarnac tabernak
  câlisse calisse c@lisse kâlisse câlice caliss ciboire cibouère crisse criss Christ calvaire
  sacrament sacrement viarge ostie osti hostie esti estie astie sti marde Mange_De_La_Marde
  plotte noune guidoune crosseur crosser Enfant_De_Chienne nazillon
`);

const FR_ALLOWED = words(`
  Jean Marie Luc Pierre Sylvie Mathieu Geneviève Étienne François Josée Nathalie Chantal
  Benoît Gaétan Réjean Ghislain Lucie Denis Martine Hélène Julien Gabriel Léa Chloé Zoé
  Émile Jacques Simone Claude Normand Mélanie Isabelle Stéphane Sébastien Frédéric Jérôme
  Maxime Olivier Félix Raphaël Rosalie Florence Camille Justine Noémie Océane Gilles Yvon
  Guylaine Josiane Marc-André Jean-François Marie-Ève Anne-Sophie Thérèse Lise Diane Ginette
  Monique Véronique Dominique Angélique Christophe Christian Christine Conrad Coralie
  Constance Bernadette Pascal Laurent Vincent Thierry Sandrine
  Montréal Québec Laval Gatineau Longueuil Sherbrooke Saguenay Lévis Trois-Rivières
  Terrebonne Saint-Hyacinthe Rimouski Chicoutimi Sorel-Tracy Shawinigan Lac-Mégantic
  Baie-Comeau Sept-Îles Matane Gaspé Rivière-du-Loup Saint-Jérôme Magog Drummondville
  Victoriaville Joliette Blainville Boucherville Repentigny Mascouche Alma Roberval Kamouraska
  Tadoussac Charlevoix Baie-Saint-Paul La_Malbaie Mont-Tremblant Rouyn-Noranda Val-d'Or Amos
  Chibougamau Natashquan Percé Bonaventure Montmagny Thetford-Mines Coaticook Granby Bromont
  Chambly Beloeil Varennes Contrecoeur Berthierville Nicolet Bécancour Plessisville Lachute
  Mirabel Saint-Eustache Pointe-Claire Dorval Lachine Verdun Châteauguay Valleyfield
  Sacré-Cœur Saint-Tite Cap-Chat Grand-Mère Pohénégamook Saint-Louis-du-Ha!Ha! Anticosti
  Salopette Députée Réputation Disputer Imputer Connaissance Concombre Bitume Culture
  Calculer Ostiguy Technique Unique Panique Pédestre Putois Culotte Pétanque Calisson
  Stimuler Estival Ciboulette Chatterton Calvados Nichoir Hérisson Moineau
`);

describe.each([
  ["EN", EN_BLOCKED, EN_ALLOWED],
  ["FR", FR_BLOCKED, FR_ALLOWED],
] as const)("corpus %s (C3)", (_lang, blocked, allowed) => {
  it("has >= 100 unique blocked and >= 100 unique allowed usernames", () => {
    expect(new Set(blocked).size).toBe(blocked.length);
    expect(new Set(allowed).size).toBe(allowed.length);
    expect(blocked.length).toBeGreaterThanOrEqual(100);
    expect(allowed.length).toBeGreaterThanOrEqual(100);
  });

  it("blocks every blocked username", () => {
    expect(blocked.filter((name) => isClean(name))).toEqual([]);
  });

  it("allows every allowed username", () => {
    expect(allowed.filter((name) => !isClean(name))).toEqual([]);
  });
});
