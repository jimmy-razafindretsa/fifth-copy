// French and Quebec French banned entries for names (card #42).
// Source: LDNOOBW "List of Dirty, Naughty, Obscene and Otherwise Bad Words" (fr,
// CC-BY-4.0), trimmed to what can appear in a short name, plus the Quebec sacres
// (and their usual spellings), Quebec vulgar terms and common French slurs.
// Reviewer: Deliver of #42 (the card's QA pass is the review evidence).
// Rule: short or ambiguous words stay whole-token; only long, unambiguous words
// are embedded (see entry.ts). Data only: never copy these words into issues or PRs.
import { embedded, type Entry, whole } from "./entry";

export const FR: readonly Entry[] = [
  ...whole(`
    con conne connes cul culs bite bites zob zobs teub chibre
    couille couilles couillon couillons chatte chattes foutre
    pute putes pouffe radasse catin garce garces
    salope salopes salaud salauds salopard salopards
    nique niquer ntm fdp
    merdes merdeux merdique chier chieur chieuse chiasse
    pd pédé pédés tapette tapettes fif fiotte fiottes lopette gouine gouines
    tarlouze tarlouzes tafiole tantouze
    nègre nègres négresse négro négros bicot bicots youpin youpins youtre
    niakoué bamboula gogol triso
    abruti abrutie débile crétin crétine imbécile enflure raclure
    bâtard bâtards baiseur baiseuse suceur suceuse
    violer violeur pédo inceste zoophile sodomite sodomie sodomiser
    clito vagin pénis anus anal sperme porno nichons nibards
    christ criss crisse calvaire sacrament sacrement viarge
    ostie osti hostie esti estie astie sti
    marde plotte plottes noune nounes guidoune guidounes crosseur crosseuse crosser
  `),
  ...embedded(`
    putain putains putassier putasse
    connard connards connasse connasses conasse
    encule enculer enculeur enfoire enfoires
    merde emmerdeur emmerdeuse
    branleur branleuse branlette
    pétasse pouffiasse grognasse partouze fellation queutard braquemart
    pédophile éjaculer
    trouduc trou_du_cul fils_de_pute nique_ta_mère ta_gueule suce_ma_bite
    mange_de_la_marde enfant_de_chienne
    bougnoule bougnoules chinetoque chinetoques sale_arabe sale_noir sale_juif nazillon
    tabarnak tabarnac tabarnaque tabarnack tabernak
    câlisse câlice kâlisse caliss ciboire cibouère
  `),
];
