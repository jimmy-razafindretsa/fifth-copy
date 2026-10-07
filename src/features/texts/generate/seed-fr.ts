import type { SeedSentence } from "./generate";

/**
 * French seed sentences of the stub text provider (#199), replaced by the licence-checked corpus of
 * #346/#351. Every sentence is public domain (published before 1900 by authors who died before 1950;
 * texts available from Project Gutenberg, BAnQ or Gallica) and attributed on its own line below.
 * Rules (checked by generate.test.ts): typeable as written (straight apostrophes, plain spaces),
 * at most 12 words, and an accented letter within the first 10 words, so even the shortest race
 * (10 words) carries French accents.
 */
export const SEED_FR: readonly SeedSentence[] = [
  {
    text: "Maître Corbeau, sur un arbre perché, tenait en son bec un fromage.",
    source: "Jean de La Fontaine, Fables (1668), Le Corbeau et le Renard",
  },
  {
    text: "Maître Renard, par l'odeur alléché, lui tint à peu près ce langage.",
    source: "Jean de La Fontaine, Fables (1668), Le Corbeau et le Renard",
  },
  {
    text: "Apprenez que tout flatteur vit aux dépens de celui qui l'écoute.",
    source: "Jean de La Fontaine, Fables (1668), Le Corbeau et le Renard",
  },
  {
    text: "La Cigale, ayant chanté tout l'été, se trouva fort dépourvue.",
    source: "Jean de La Fontaine, Fables (1668), La Cigale et la Fourmi",
  },
  {
    text: "La Fourmi n'est pas prêteuse : c'est là son moindre défaut.",
    source: "Jean de La Fontaine, Fables (1668), La Cigale et la Fourmi",
  },
  {
    text: "Le Chêne un jour dit au Roseau.",
    source: "Jean de La Fontaine, Fables (1668), Le Chêne et le Roseau",
  },
  {
    text: "Rien ne sert de courir ; il faut partir à point.",
    source: "Jean de La Fontaine, Fables (1668), Le Lièvre et la Tortue",
  },
  {
    text: "Un Lièvre en son gîte songeait.",
    source: "Jean de La Fontaine, Fables (1668), Le Lièvre et les Grenouilles",
  },
  {
    text: "Ils ne mouraient pas tous, mais tous étaient frappés.",
    source: "Jean de La Fontaine, Fables (1678), Les Animaux malades de la peste",
  },
  {
    text: "Que diable allait-il faire dans cette galère ?",
    source: "Molière, Les Fourberies de Scapin (1671), acte II",
  },
  {
    text: "À vaincre sans péril, on triomphe sans gloire.",
    source: "Pierre Corneille, Le Cid (1637), acte II",
  },
  {
    text: "Aux âmes bien nées, la valeur n'attend point le nombre des années.",
    source: "Pierre Corneille, Le Cid (1637), acte II",
  },
  {
    text: "Ô rage ! ô désespoir ! ô vieillesse ennemie !",
    source: "Pierre Corneille, Le Cid (1637), acte I",
  },
  {
    text: "Pour qui sont ces serpents qui sifflent sur vos têtes ?",
    source: "Jean Racine, Andromaque (1667), acte V",
  },
  {
    text: "Le cœur a ses raisons que la raison ne connaît point.",
    source: "Blaise Pascal, Pensées (1670)",
  },
  {
    text: "Cela est bien dit, répondit Candide, mais il faut cultiver notre jardin.",
    source: "Voltaire, Candide ou l'Optimisme (1759), chapitre XXX",
  },
  {
    text: "Demain, dès l'aube, à l'heure où blanchit la campagne, je partirai.",
    source: "Victor Hugo, Les Contemplations (1856), Demain, dès l'aube",
  },
  {
    text: "J'irai par la forêt, j'irai par la montagne.",
    source: "Victor Hugo, Les Contemplations (1856), Demain, dès l'aube",
  },
  {
    text: "Là, tout n'est qu'ordre et beauté, luxe, calme et volupté.",
    source: "Charles Baudelaire, Les Fleurs du mal (1857), L'Invitation au voyage",
  },
  {
    text: "Mon enfant, ma sœur, songe à la douceur d'aller là-bas vivre ensemble !",
    source: "Charles Baudelaire, Les Fleurs du mal (1857), L'Invitation au voyage",
  },
  {
    text: "Il pleure dans mon cœur comme il pleut sur la ville.",
    source: "Paul Verlaine, Romances sans paroles (1874), Ariettes oubliées III",
  },
  {
    text: "Je m'en allais, les poings dans mes poches crevées.",
    source: "Arthur Rimbaud, Poésies (1870), Ma Bohème",
  },
  {
    text: "On n'est pas sérieux, quand on a dix-sept ans.",
    source: "Arthur Rimbaud, Poésies (1870), Roman",
  },
  {
    text: "Ô temps ! suspends ton vol, et vous, heures propices, suspendez votre cours !",
    source: "Alphonse de Lamartine, Méditations poétiques (1820), Le Lac",
  },
  {
    text: "Un seul être vous manque, et tout est dépeuplé.",
    source: "Alphonse de Lamartine, Méditations poétiques (1820), L'Isolement",
  },
  {
    text: "Phileas Fogg avait gagné son pari.",
    source: "Jules Verne, Le Tour du monde en quatre-vingts jours (1872), chapitre XXXVII",
  },
  {
    text: "Ce que l'on conçoit bien s'énonce clairement.",
    source: "Nicolas Boileau, L'Art poétique (1674), chant I",
  },
  {
    text: "Hâtez-vous lentement, et sans perdre courage.",
    source: "Nicolas Boileau, L'Art poétique (1674), chant I",
  },
  {
    text: "L'hypocrisie est un hommage que le vice rend à la vertu.",
    source: "François de La Rochefoucauld, Maximes (1665), maxime 218",
  },
  {
    text: "Parce que c'était lui, parce que c'était moi.",
    source: "Michel de Montaigne, Essais (1580), livre I, chapitre XXVIII",
  },
  {
    text: "L'homme est né libre, et partout il est dans les fers.",
    source: "Jean-Jacques Rousseau, Du contrat social (1762), livre I, chapitre I",
  },
  {
    text: "Je suis le ténébreux, le veuf, l'inconsolé.",
    source: "Gérard de Nerval, Les Chimères (1854), El Desdichado",
  },
];
