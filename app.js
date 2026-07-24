"use strict";

const OWNER = "Jurgenvdlecq";
const REPO = "Picnic-besteller";
const API = `https://api.github.com/repos/${OWNER}/${REPO}`;
const BESTEL_WORKFLOW = "bestel.yml";
const ZOEKEN_WORKFLOW = "zoek_producten.yml";
const LEEG_MANDJE_WORKFLOW = "leeg_mandje.yml";

// SHA-256 van de pincode, zodat de code zelf niet in platte tekst in de
// paginabron staat. Dit is geen sterke beveiliging (view-source + brute
// force op 4 cijfers is triviaal) — het is alleen bedoeld om toevallige
// bezoekers buiten de deur te houden.
const PIN_HASH = "88cf986449b61aeba90a4baedfaeba95cc12e8d04dedfebe53b78dd29fc0a4ac";

const UNLOCKED_KEY = "picnic_unlocked";
const TOKEN_KEY = "picnic_gh_token";

// Volgorde + weergavenaam voor de vlees-filterknoppen. "overig" vangt
// gerechten op zonder (herkend) Vlees:-label.
const VLEES_VOLGORDE = ["kip", "rund", "varken", "ei-vega", "overig"];
const VLEES_LABELS = { kip: "Kip", rund: "Rund", varken: "Varken", "ei-vega": "Ei / vega", overig: "Overig" };

// Bepaalt welk label een handmatig toegevoegd gerecht krijgt in
// receptenboek.txt, per dag-categorie waarvoor dat mogelijk is.
const LABEL_VOOR_CATEGORIE = {
  maandag: "makkelijk",
  woensdag: null,
  donderdag: null,
  vrijdag_veel: "vrijdag_veel",
  zaterdag_veel: "vrijdag_veel",
};
const POOL_VOOR_CATEGORIE = {
  maandag: (pools) => pools.makkelijk,
  woensdag: (pools) => pools.algemeen,
  donderdag: (pools) => pools.algemeen,
  vrijdag_veel: (pools) => pools.vrijdag_veel,
  zaterdag_veel: (pools) => pools.vrijdag_veel,
};

// Vrije tag-vocabulaire (naast de vlees-afgeleide chips kip/rund/varken/
// ei-vega, die al via Vlees: lopen). "nieuw"/"probeerrecept" worden
// automatisch gezet bij het toevoegen van een gerecht via de website;
// "niet-meer-tonen" automatisch bij een "niet meer"-beoordeling.
const TAG_VOCABULAIRE = [
  "snel", "maandag", "airfryer", "rijst", "pasta", "wraps", "bowl",
  "aardappel-vlees-groente", "favoriet", "nieuw", "probeerrecept",
];

// Vast weekrooster: personen per dag-categorie. Vrijdag/zaterdag hangen af
// van even/oneven weeknummer (spiegelt personen_voor() in weekmenu.py).
const WEEKROOSTER_VAST = { maandag: 4, dinsdag: 4, woensdag: 2, donderdag: 2, zondag: 4 };

function personenVoor(categorie, evenWeek) {
  if (categorie in WEEKROOSTER_VAST) return WEEKROOSTER_VAST[categorie];
  if (categorie === "vrijdag" || categorie === "zaterdag") return evenWeek ? 2 : 4;
  return 2;
}

// Schaalt "N x product"-regels van basisPersonen naar doelPersonen. Rondt
// naar boven af (liever iets te ruim dan te weinig); bij factor 1 (het
// huidige geval voor bijna alle dagen onder het vaste weekrooster)
// verandert er niets.
function schaalIngredienten(ingredienten, basisPersonen, doelPersonen) {
  const basis = basisPersonen && basisPersonen > 0 ? basisPersonen : 2;
  const factor = doelPersonen / basis;
  if (factor === 1) return [...ingredienten];
  return ingredienten.map((regel) => {
    const item = parseAantalNaam(regel);
    const nieuwAantal = Math.max(1, Math.ceil(item.aantal * factor));
    return `${nieuwAantal} x ${item.naam}`;
  });
}

// ---------------------------------------------------------------------------
// Kleine hulpfuncties
// ---------------------------------------------------------------------------

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function sha256Hex(tekst) {
  const buffer = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(tekst));
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function base64EncodeUnicode(str) {
  return btoa(unescape(encodeURIComponent(str)));
}

function pickRandom(lijst) {
  if (!lijst || lijst.length === 0) return null;
  return lijst[Math.floor(Math.random() * lijst.length)];
}

function escapeHtml(tekst) {
  return String(tekst).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function maakEl(tag, className, tekst) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (tekst != null) e.textContent = tekst;
  return e;
}

function maakKnop(className, tekst, onClick) {
  const knop = document.createElement("button");
  knop.type = "button";
  if (className) knop.className = className;
  knop.textContent = tekst;
  knop.onclick = onClick;
  return knop;
}

// Kleine, consistente set lichtgewicht SVG-iconen (stroke-based, in de
// geest van Lucide) voor de overzicht-pagina en onderste navigatie — puur
// inline, geen externe iconenset-dependency nodig.
const ICOON_SVG = {
  home: '<path d="M3 11.5 12 4l9 7.5"/><path d="M5.5 10v9a1 1 0 0 0 1 1H9v-6h6v6h2.5a1 1 0 0 0 1-1v-9"/>',
  utensils: '<path d="M7 3v7a1.5 1.5 0 0 0 3 0V3"/><path d="M8.5 3v18"/><path d="M8.5 10v0"/><path d="M16 3c-1.2 0-2 1.5-2 4s.8 4 2 4v10"/>',
  basket: '<path d="M4 10h16l-1.5 9a1.5 1.5 0 0 1-1.5 1.3H7A1.5 1.5 0 0 1 5.5 19L4 10Z"/><path d="M8 10 9.5 4h5L16 10"/><path d="M9 14v3"/><path d="M15 14v3"/>',
  check: '<circle cx="12" cy="12" r="9"/><path d="M8 12.5l2.5 2.5L16 9.5"/>',
  meer: '<circle cx="5" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="19" cy="12" r="1.4"/>',
  plusCircle: '<circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/>',
  clipboardList: '<rect x="6" y="4" width="12" height="17" rx="2"/><path d="M9 4V3a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v1"/><path d="M9 10h6M9 14h6M9 18h3"/>',
  package: '<path d="M3.5 8 12 3.5 20.5 8 12 12.5 3.5 8Z"/><path d="M3.5 8v9L12 21.5 20.5 17V8"/><path d="M12 12.5V21.5"/>',
  refresh: '<path d="M4 12a8 8 0 0 1 14-5.3L20 9"/><path d="M20 4v5h-5"/><path d="M20 12a8 8 0 0 1-14 5.3L4 15"/><path d="M4 20v-5h5"/>',
  calendar: '<rect x="4" y="5.5" width="16" height="15" rx="2"/><path d="M8 3.5v4M16 3.5v4M4 10h16"/>',
  bell: '<path d="M7 9a5 5 0 0 1 10 0c0 4 1.5 5.5 1.5 5.5H5.5S7 13 7 9Z"/><path d="M10.3 18a1.7 1.7 0 0 0 3.4 0"/>',
  truck: '<rect x="2.5" y="7" width="12" height="10" rx="1"/><path d="M14.5 10.5H18l3 3V17h-2"/><circle cx="7" cy="18.5" r="1.6"/><circle cx="17" cy="18.5" r="1.6"/>',
  chevronRight: '<path d="M9 5l7 7-7 7"/>',
  alertTriangle: '<path d="M12 4 3 20h18L12 4Z"/><path d="M12 10v4"/><circle cx="12" cy="17" r="0.7" fill="currentColor" stroke="none"/>',
};

function icoonSvg(naam, extraClass) {
  const inhoud = ICOON_SVG[naam] || ICOON_SVG.meer;
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"${extraClass ? ` class="${extraClass}"` : ""}>${inhoud}</svg>`;
}

// ---------------------------------------------------------------------------
// Inlezen en parsen (spiegelt weekmenu.py exact)
// ---------------------------------------------------------------------------

function parseAantalNaam(regel) {
  const match = regel.match(/^\s*(\d+)\s*[xX]\s*(.+)$/);
  if (match) return { naam: match[2].trim(), aantal: parseInt(match[1], 10) };
  return { naam: regel.trim(), aantal: 1 };
}

function laadReceptenboek(tekst) {
  const gerechten = [];
  let huidig = null;

  for (let regel of tekst.split("\n")) {
    regel = regel.trim();
    if (!regel || regel.startsWith("#")) continue;
    const laag = regel.toLowerCase();

    if (laag.startsWith("gerecht:")) {
      if (huidig) gerechten.push(huidig);
      huidig = {
        naam: regel.slice(regel.indexOf(":") + 1).trim(),
        label: null,
        vlees: null,
        basisPersonen: 2,
        tags: [],
        actief: true,
        ingredienten: [],
      };
    } else if (laag.startsWith("vlees:") && huidig) {
      huidig.vlees = regel.slice(regel.indexOf(":") + 1).trim().toLowerCase();
    } else if (laag.startsWith("label:") && huidig) {
      huidig.label = regel.slice(regel.indexOf(":") + 1).trim().toLowerCase();
    } else if (laag.startsWith("basispersonen:") && huidig) {
      const waarde = parseInt(regel.slice(regel.indexOf(":") + 1).trim(), 10);
      if (!Number.isNaN(waarde)) huidig.basisPersonen = waarde;
    } else if (laag.startsWith("tags:") && huidig) {
      huidig.tags = regel
        .slice(regel.indexOf(":") + 1)
        .split(",")
        .map((t) => t.trim().toLowerCase())
        .filter(Boolean);
    } else if (laag.startsWith("actief:") && huidig) {
      const waarde = regel.slice(regel.indexOf(":") + 1).trim().toLowerCase();
      huidig.actief = ["ja", "yes", "true", "1"].includes(waarde);
    } else if (huidig) {
      huidig.ingredienten.push(regel);
    }
  }
  if (huidig) gerechten.push(huidig);
  return gerechten;
}

function laadDagOpties(tekst) {
  const secties = {};
  let huidigeSectie = null;

  for (let regel of tekst.split("\n")) {
    regel = regel.trim();
    if (!regel || regel.startsWith("#")) continue;

    const match = regel.match(/^==\s*(.+?)\s*==$/);
    if (match) {
      huidigeSectie = match[1].trim().toLowerCase();
      secties[huidigeSectie] = [];
    } else if (huidigeSectie) {
      secties[huidigeSectie].push(parseAantalNaam(regel));
    }
  }
  return secties;
}

function laadStandaardlijst(tekst) {
  return tekst
    .split("\n")
    .map((r) => r.trim())
    .filter((r) => r && !r.startsWith("#") && !/^==\s*.+?\s*==$/.test(r))
    .map(parseAantalNaam);
}

// Zelfde bestand, maar dan met categorie-indeling bewaard (voor de
// weergave op de website). Items vóór de eerste "== categorie =="-regel
// vallen onder "overig", zodat een oud plat bestand ook prima werkt.
function laadStandaardlijstPerCategorie(tekst) {
  const categorieen = [];
  let huidige = { naam: "overig", items: [] };
  let heeftSecties = false;

  for (let regel of tekst.split("\n")) {
    regel = regel.trim();
    if (!regel || regel.startsWith("#")) continue;

    const match = regel.match(/^==\s*(.+?)\s*==$/);
    if (match) {
      if (huidige.items.length > 0 || heeftSecties) categorieen.push(huidige);
      huidige = { naam: match[1].trim(), items: [] };
      heeftSecties = true;
      continue;
    }
    huidige.items.push(parseAantalNaam(regel));
  }
  if (huidige.items.length > 0) categorieen.push(huidige);
  return categorieen;
}

// Zelfde sectie-syntax als dag_opties.txt/standaardlijst.txt — hergebruikt
// voor de voorraadcheck (voorraad.txt).
function laadVoorraadCategorieen(tekst) {
  const categorieen = [];
  let huidige = null;

  for (let regel of tekst.split("\n")) {
    regel = regel.trim();
    if (!regel || regel.startsWith("#")) continue;

    const match = regel.match(/^==\s*(.+?)\s*==$/);
    if (match) {
      if (huidige) categorieen.push(huidige);
      huidige = { naam: match[1].trim(), items: [] };
      continue;
    }
    if (huidige) huidige.items.push(regel);
  }
  if (huidige) categorieen.push(huidige);
  return categorieen;
}

function laadGeschiedenis(tekst) {
  const geschiedenis = {};
  if (!tekst) return geschiedenis;
  for (const regel of tekst.split("\n")) {
    const idx = regel.indexOf("|");
    if (idx === -1) continue;
    const categorie = regel.slice(0, idx).trim();
    const naam = regel.slice(idx + 1).trim();
    if (!geschiedenis[categorie]) geschiedenis[categorie] = [];
    geschiedenis[categorie].push(naam);
  }
  return geschiedenis;
}

function slaGeschiedenisOp(geschiedenis) {
  const regels = [];
  for (const categorie in geschiedenis) {
    const namen = geschiedenis[categorie].slice(-15);
    for (const naam of namen) regels.push(`${categorie}|${naam}`);
  }
  return regels.join("\n") + "\n";
}

function werkGeschiedenisBij(geschiedenis, weekmenu) {
  const bijgewerkt = {};
  for (const key in geschiedenis) bijgewerkt[key] = [...geschiedenis[key]];
  for (const dag of weekmenu) {
    if (!bijgewerkt[dag.categorie]) bijgewerkt[dag.categorie] = [];
    bijgewerkt[dag.categorie].push(dag.naam);
  }
  return bijgewerkt;
}

// ---------------------------------------------------------------------------
// Weekbepaling (spiegelt is_even_week uit weekmenu.py)
// ---------------------------------------------------------------------------

function getISOWeekNumber(datum) {
  const d = new Date(Date.UTC(datum.getFullYear(), datum.getMonth(), datum.getDate()));
  const dagNummer = d.getUTCDay() || 7; // zondag=0 -> 7
  d.setUTCDate(d.getUTCDate() + 4 - dagNummer);
  const jaarStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d - jaarStart) / 86400000 + 1) / 7);
}

function isEvenWeek() {
  const vandaag = new Date();
  const jsWeekdag = vandaag.getDay(); // zondag=0..zaterdag=6
  const pyWeekdag = (jsWeekdag + 6) % 7; // maandag=0..zondag=6
  const dagenTotMaandag = (7 - pyWeekdag) % 7;
  const komendeMaandag = new Date(vandaag);
  komendeMaandag.setDate(vandaag.getDate() + dagenTotMaandag);
  return getISOWeekNumber(komendeMaandag) % 2 === 0;
}

// ---------------------------------------------------------------------------
// Dagmenu samenstellen (spiegelt weekmenu.py, uitgebreid met vlees-tags en
// losse "onderdelen" voor dinsdag/vrijdag(2p)/zondag zodat je in de website
// per ingrediënt kunt kiezen i.p.v. het hele dagmenu opnieuw te loten)
// ---------------------------------------------------------------------------

function combineerIngredienten(...groepen) {
  const ingredienten = [];
  for (const item of groepen) {
    if (item == null) continue;
    ingredienten.push(`${item.aantal} x ${item.naam}`);
  }
  return ingredienten;
}

function bepaalPools(receptenboek) {
  const actieveRecepten = receptenboek.filter((g) => g.actief && !(g.tags || []).includes("niet-meer-tonen"));
  return {
    makkelijk: actieveRecepten.filter((g) => g.label === "makkelijk"),
    // Vrijdag én zaterdag putten (bij 4 personen) allebei uit deze pool.
    vrijdag_veel: actieveRecepten.filter((g) => g.label === "vrijdag_veel"),
    // Woensdag en donderdag putten allebei uit deze pool (zie kiesUitPool's
    // uitgeslotenNaam: zo krijgen ze niet toevallig hetzelfde gerecht).
    algemeen: actieveRecepten.filter((g) => g.label === null),
  };
}

function kiesUitPool(pool, categorie, geschiedenis, uitgeslotenNaam) {
  if (!pool || pool.length === 0) return null;

  let kandidatenPool = pool;
  if (uitgeslotenNaam) {
    const gefilterd = pool.filter((g) => g.naam !== uitgeslotenNaam);
    if (gefilterd.length > 0) kandidatenPool = gefilterd;
  }

  const eerdereKeuzes = geschiedenis[categorie] || [];
  function recentheid(gerecht) {
    return eerdereKeuzes.lastIndexOf(gerecht.naam); // -1 als nooit eerder gekozen
  }

  const gesorteerd = [...kandidatenPool].sort((a, b) => recentheid(a) - recentheid(b));
  const aantalKandidaten = Math.max(2, Math.floor(gesorteerd.length / 2));
  return pickRandom(gesorteerd.slice(0, aantalKandidaten));
}

function samenstellenDinsdag(onderdelen) {
  const { aardappel, vlees, groente } = onderdelen;
  const naam = [aardappel, vlees, groente].filter(Boolean).map((x) => x.naam).join(" + ");
  return { dag: "Dinsdag", naam, ingredienten: combineerIngredienten(aardappel, vlees, groente), categorie: "dinsdag", personen: 4, onderdelen };
}

function kiesDinsdag(dagOpties) {
  return samenstellenDinsdag({
    aardappel: pickRandom(dagOpties.dinsdag_aardappel),
    vlees: pickRandom(dagOpties.dinsdag_vlees),
    groente: pickRandom(dagOpties.groente),
  });
}

function samenstellenKlein(dagLabel, categorie, onderdelen) {
  const { vlees, groente } = onderdelen;
  const naam = [vlees, groente].filter(Boolean).map((x) => x.naam).join(" + ");
  return { dag: `${dagLabel} (2p)`, naam, ingredienten: combineerIngredienten(vlees, groente), categorie, personen: 2, onderdelen };
}

function samenstellenVrijdagKlein(onderdelen) {
  return samenstellenKlein("Vrijdag", "vrijdag_klein", onderdelen);
}

function samenstellenZaterdagKlein(onderdelen) {
  return samenstellenKlein("Zaterdag", "zaterdag_klein", onderdelen);
}

function samenstellenZondag(onderdelen) {
  const snacks = onderdelen.snacks || [];
  const patat = { naam: "Patat (airfryer)", aantal: 1 };
  const naam = snacks.length ? `Patat + ${snacks.map((s) => s.naam).join(" + ")}` : "Patat (airfryer)";
  return { dag: "Zondag", naam, ingredienten: combineerIngredienten(patat, ...snacks), categorie: "zondag", personen: 4, onderdelen };
}

function kiesZondag(dagOpties) {
  const snack = pickRandom(dagOpties.zondag_snack);
  return samenstellenZondag({ snacks: snack ? [snack] : [] });
}

// Gedeeld door vrijdag en zaterdag: bij 4 personen een "vrijdag_veel"-
// gerecht uit het receptenboek, bij 2 personen een vlees+groente-combi uit
// dag_opties.txt. uitgeslotenNaam voorkomt dat vrijdag en zaterdag in
// dezelfde (4p-)week toevallig hetzelfde kiezen.
function kiesVrijdagOfZaterdag(dagLabel, veelCategorie, kleinCategorie, dagOpties, pools, personen, geschiedenis, uitgeslotenNaam) {
  if (personen === 4) {
    const gerecht = kiesUitPool(pools.vrijdag_veel, veelCategorie, geschiedenis, uitgeslotenNaam);
    return {
      dag: `${dagLabel} (4p)`,
      naam: gerecht ? gerecht.naam : "(geen 'vrijdag_veel'-gerecht gevonden)",
      ingredienten: gerecht ? schaalIngredienten(gerecht.ingredienten, gerecht.basisPersonen, 4) : [],
      categorie: veelCategorie,
      personen: 4,
      vlees: gerecht ? gerecht.vlees : null,
    };
  }
  const onderdelen = {
    vlees: pickRandom(dagOpties.vrijdag_vlees_klein),
    groente: pickRandom(dagOpties.groente),
  };
  return samenstellenKlein(dagLabel, kleinCategorie, onderdelen);
}

function gerechtDagEntry(dagLabel, categorie, gerecht, personen) {
  return {
    dag: dagLabel,
    naam: gerecht ? gerecht.naam : "(pool leeg)",
    ingredienten: gerecht ? schaalIngredienten(gerecht.ingredienten, gerecht.basisPersonen, personen) : [],
    categorie,
    personen,
    vlees: gerecht ? gerecht.vlees : null,
  };
}

function stelWeekmenuSamen(pools, dagOpties, evenWeek, geschiedenis) {
  const weekmenu = [];

  const maPersonen = personenVoor("maandag", evenWeek);
  const ma = kiesUitPool(pools.makkelijk, "maandag", geschiedenis);
  weekmenu.push(gerechtDagEntry("Maandag", "maandag", ma, maPersonen));

  weekmenu.push(kiesDinsdag(dagOpties));

  const woePersonen = personenVoor("woensdag", evenWeek);
  const doPersonen = personenVoor("donderdag", evenWeek);
  const doo = kiesUitPool(pools.algemeen, "donderdag", geschiedenis);
  const woe = kiesUitPool(pools.algemeen, "woensdag", geschiedenis, doo ? doo.naam : null);
  weekmenu.push(gerechtDagEntry("Woensdag", "woensdag", woe, woePersonen));
  weekmenu.push(gerechtDagEntry("Donderdag", "donderdag", doo, doPersonen));

  const vrijdagPersonen = personenVoor("vrijdag", evenWeek);
  const vrijdag = kiesVrijdagOfZaterdag("Vrijdag", "vrijdag_veel", "vrijdag_klein", dagOpties, pools, vrijdagPersonen, geschiedenis);
  weekmenu.push(vrijdag);

  const zaterdagPersonen = personenVoor("zaterdag", evenWeek);
  const zaterdag = kiesVrijdagOfZaterdag("Zaterdag", "zaterdag_veel", "zaterdag_klein", dagOpties, pools, zaterdagPersonen, geschiedenis, vrijdag.naam);
  weekmenu.push(zaterdag);

  weekmenu.push(kiesZondag(dagOpties));

  return weekmenu;
}

function herkiesDag(weekmenu, index, pools, dagOpties, evenWeek, geschiedenis) {
  const categorie = weekmenu[index].categorie;
  const vorigeNaam = weekmenu[index].naam;
  const personen = weekmenu[index].personen || 2;

  function anderDagNaam(catNaam) {
    const d = weekmenu.find((d) => d.categorie === catNaam);
    return d ? d.naam : null;
  }

  const herkiesFuncties = {
    maandag: () => gerechtDagEntry("Maandag", "maandag", kiesUitPool(pools.makkelijk, "maandag", geschiedenis), personen),
    dinsdag: () => kiesDinsdag(dagOpties),
    woensdag: () => gerechtDagEntry(
      "Woensdag", "woensdag",
      kiesUitPool(pools.algemeen, "woensdag", geschiedenis, anderDagNaam("donderdag")),
      personen
    ),
    donderdag: () => gerechtDagEntry(
      "Donderdag", "donderdag",
      kiesUitPool(pools.algemeen, "donderdag", geschiedenis, anderDagNaam("woensdag")),
      personen
    ),
    vrijdag_veel: () => kiesVrijdagOfZaterdag("Vrijdag", "vrijdag_veel", "vrijdag_klein", dagOpties, pools, personen, geschiedenis, anderDagNaam("zaterdag_veel")),
    vrijdag_klein: () => kiesVrijdagOfZaterdag("Vrijdag", "vrijdag_veel", "vrijdag_klein", dagOpties, pools, personen, geschiedenis),
    zaterdag_veel: () => kiesVrijdagOfZaterdag("Zaterdag", "zaterdag_veel", "zaterdag_klein", dagOpties, pools, personen, geschiedenis, anderDagNaam("vrijdag_veel")),
    zaterdag_klein: () => kiesVrijdagOfZaterdag("Zaterdag", "zaterdag_veel", "zaterdag_klein", dagOpties, pools, personen, geschiedenis),
    zondag: () => kiesZondag(dagOpties),
  };

  if (!herkiesFuncties[categorie]) return false;

  for (let i = 0; i < 10; i++) {
    const nieuw = herkiesFuncties[categorie]();
    if (nieuw.naam !== vorigeNaam) {
      weekmenu[index] = nieuw;
      return true;
    }
  }
  return false;
}

// Past het aantal personen voor één dag aan (handmatige override) en
// herschaalt de ingrediënten van het huidige gerecht naar het nieuwe
// aantal — het gerecht zelf blijft hetzelfde, alleen de hoeveelheden
// veranderen. Voor combi-dagen (dinsdag/klein-varianten/zondag) heeft dit
// geen effect op de hoeveelheden (die zijn niet aan een receptenboek-
// Basispersonen gekoppeld), maar de badge/weergave wordt wel bijgewerkt.
function pasPersonenAan(dag, gerecht, nieuwePersonen) {
  dag.personen = Math.max(1, nieuwePersonen);
  if (gerecht && gerecht.basisPersonen) {
    dag.ingredienten = schaalIngredienten(gerecht.ingredienten, gerecht.basisPersonen, dag.personen);
  }
}

function zoekReceptenOpNaam(receptenboek, zoekterm) {
  const z = zoekterm.trim().toLowerCase();
  if (!z) return [];
  return receptenboek.filter((g) => g.naam.toLowerCase().includes(z));
}

// Voorraadartikelen (rijst, pasta, koffie, wc-papier, ...) gaan over veel
// gerechten heen (een zak rijst van 1 kilo doe je misschien wel 10 gerechten
// mee) — "dit gerecht gebruikt rijst" zegt dus niks over of je deze week
// rijst nodig hebt. Een normale hoeveelheid voor zo'n artikel telt daarom
// NIET automatisch mee in de boodschappenlijst; die komt er alleen bij via
// de voorraadcheck (zie voorraadTeBestellen). Uitzondering: een ongewoon
// grote hoeveelheid voor één gerecht (bv. 10 eieren voor een bakrecept) is
// duidelijk gerecht-specifieke vraag, geen algemene voorraad-aanvulling —
// die telt gewoon mee.
const VOORRAAD_DREMPEL = 4;

function voorraadArtikelNamen(voorraadCategorieen) {
  const namen = new Set();
  for (const categorie of voorraadCategorieen || []) {
    for (const naam of categorie.items) namen.add(naam.toLowerCase());
  }
  return namen;
}

function isOnderdrukbaarVoorraadArtikel(naam, aantal, voorraadNamen) {
  return voorraadNamen.has(naam.toLowerCase()) && aantal <= VOORRAAD_DREMPEL;
}

function berekenTotalen(weekmenu, producten, voorraadNamen) {
  const namen = voorraadNamen || new Set();
  const totalen = new Map();
  function voegToe(naam, aantal) {
    const sleutel = naam.toLowerCase();
    if (totalen.has(sleutel)) {
      totalen.get(sleutel).aantal += aantal;
    } else {
      totalen.set(sleutel, { naam, aantal });
    }
  }

  for (const dag of weekmenu) {
    for (const regel of dag.ingredienten) {
      const item = parseAantalNaam(regel);
      if (isOnderdrukbaarVoorraadArtikel(item.naam, item.aantal, namen)) continue;
      voegToe(item.naam, item.aantal);
    }
  }
  for (const item of producten) voegToe(item.naam, item.aantal);

  return [...totalen.values()];
}

// Voor het controlescherm: per ingrediëntnaam (dezelfde sleutel als
// berekenTotalen/schrijfBoodschappenlijst gebruikt) bijhouden welke dag(en)
// van het weekmenu dit nodig hebben en met welk aantal — zodat het
// controlescherm producten per dag kan groeperen en "verwijder [dag]" kan
// aanbieden. Puur client-side afgeleid van staat.weekmenu; niet opgeslagen.
function berekenIngredientHerkomst(weekmenu) {
  const herkomst = new Map();
  for (const dag of weekmenu) {
    for (const regel of dag.ingredienten) {
      const item = parseAantalNaam(regel);
      const sleutel = item.naam.toLowerCase();
      if (!herkomst.has(sleutel)) herkomst.set(sleutel, { naam: item.naam, dagen: new Map() });
      const entry = herkomst.get(sleutel);
      entry.dagen.set(dag.dag, (entry.dagen.get(dag.dag) || 0) + item.aantal);
    }
  }
  return herkomst;
}

// Herkent of Picnic's eigen verpakkingsomschrijving (het "subtitle"-veld,
// bv. "4 stuks", "8 x 250 ml", "Voor 10 stuks") een meerstuksverpakking
// beschrijft — en zo ja, hoeveel stuks daar in zitten. Geeft null terug bij
// een gewone maat/inhoud zonder stuksaantal (bv. "500 gram", "1 kilo"),
// want dat is geen verpakking van meerdere stuks maar gewoon de grootte van
// één stuk. Gebaseerd op de daadwerkelijk bij Picnic voorkomende patronen
// (nagekeken in eerdere bestellingen).
function verpakkingsGrootte(subtitle) {
  if (!subtitle) return null;
  const tekst = subtitle.trim();

  // "Voor 10 stuks" / "Voor 11-13 stuks" — yield-omschrijving; bij een
  // bereik de ondergrens gebruiken (liever iets te veel dan te weinig).
  let m = tekst.match(/^Voor\s+(\d+)(?:-(\d+))?\s*stuks?\b/i);
  if (m) return parseInt(m[1], 10);

  // "8 x 250 ml", "4 x 100 gram" — meerstuksverpakking met maat per stuk.
  m = tekst.match(/^(\d+)\s*x\s*[\d.,]+\s*(ml|gram|liter|g|l|kg)\b/i);
  if (m) return parseInt(m[1], 10);

  // "6 of 7 stuks" — bereik, ondergrens gebruiken.
  m = tekst.match(/^(\d+)\s*of\s*\d+\s*stuks?\b/i);
  if (m) return parseInt(m[1], 10);

  // "3 stuks", "8 stuks M/L", "10 stuks M" — simpel stuksaantal.
  m = tekst.match(/^(\d+)\s*stuks?\b/i);
  if (m) return parseInt(m[1], 10);

  // "4 rollen", "6 rollen" — vergelijkbaar patroon voor rolproducten.
  m = tekst.match(/^(\d+)\s*rollen\b/i);
  if (m) return parseInt(m[1], 10);

  return null;
}

// Hoeveel verpakkingen van het gekozen product moeten er besteld worden om
// aan "aantalNodig" stuks te komen? Alleen van toepassing op ingrediënten
// die uit een gerecht komen (daar betekent "aantal" echt "stuks nodig voor
// dit gerecht") — bij vaste boodschappen/voorraad betekent "aantal" al
// "aantal verpakkingen" (bv. "3 x Alpro yoghurt" = gewoon 3 bakjes), dus
// daar zou deze correctie het juist fout maken.
function bepaalTeBestellenAantal(aantalNodig, gekozen, isWeekmenuIngredient) {
  if (!isWeekmenuIngredient || !gekozen) return aantalNodig;
  const grootte = verpakkingsGrootte(gekozen.subtitle);
  if (!grootte || grootte <= 1) return aantalNodig;
  return Math.max(1, Math.ceil(aantalNodig / grootte));
}

function schrijfBoodschappenlijst(weekmenu, producten, voorraadNamen) {
  const totalen = berekenTotalen(weekmenu, producten, voorraadNamen);

  const regels = ["# Weekmenu:"];
  for (const dag of weekmenu) regels.push(`#   ${dag.dag}: ${dag.naam}`);
  regels.push("#");
  for (const { naam, aantal } of totalen) regels.push(`${aantal} x ${naam}`);

  return regels.join("\n") + "\n";
}

function bouwReceptenboekBlok(gerecht) {
  const regels = [`Gerecht: ${gerecht.naam}`];
  if (gerecht.vlees) regels.push(`Vlees: ${gerecht.vlees}`);
  if (gerecht.label) regels.push(`Label: ${gerecht.label}`);
  if (gerecht.basisPersonen && gerecht.basisPersonen !== 2) regels.push(`Basispersonen: ${gerecht.basisPersonen}`);
  if (gerecht.tags && gerecht.tags.length > 0) regels.push(`Tags: ${gerecht.tags.join(", ")}`);
  if (gerecht.actief === false) regels.push(`Actief: nee`);
  for (const ingredient of gerecht.ingredienten) regels.push(ingredient);
  return regels.join("\n");
}

// Herbouwt het volledige receptenboek.txt-bestand uit staat.receptenboek
// (behoudt de oorspronkelijke uitleg-comments bovenaan het bestand).
function herbouwReceptenboekTekst() {
  const blokken = staat.receptenboek.map(bouwReceptenboekBlok);
  const header = staat.receptenboekHeader || "";
  return header + blokken.join("\n\n") + "\n";
}

// Herbouwt standaardlijst.txt uit staat.standaardCategorieen (behoudt de
// categorie-indeling). Gebruikt als een naam daar handmatig aangepast is
// (bv. omdat Picnic het product niet vond onder de oude naam).
function herbouwStandaardlijstTekst() {
  const regels = [
    "# Standaardlijst",
    "# ================",
    "# Deze producten worden ELKE week automatisch toegevoegd aan de",
    "# boodschappenlijst, los van het gekozen weekmenu. Pas hoeveelheden of",
    "# producten hier aan naar wens, of voeg een nieuwe regel toe onder de",
    "# categorie waar het bij hoort.",
    "",
  ];
  for (const categorie of staat.standaardCategorieen) {
    regels.push(`== ${categorie.naam} ==`);
    for (const item of categorie.items) regels.push(`${item.aantal} x ${item.naam}`);
    regels.push("");
  }
  return regels.join("\n").trimEnd() + "\n";
}

function receptenboekHeaderUitRuweTekst(ruweTekst) {
  const match = ruweTekst.match(/^Gerecht:/m);
  return match ? ruweTekst.slice(0, match.index) : "";
}

function relatieveTijd(iso) {
  const toen = new Date(iso);
  if (Number.isNaN(toen.getTime())) return "onbekend";
  const sec = Math.floor((new Date() - toen) / 1000);
  if (sec < 90) return "zojuist";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} ${min === 1 ? "minuut" : "minuten"} geleden`;
  const uur = Math.floor(min / 60);
  if (uur < 24) return `${uur} ${uur === 1 ? "uur" : "uur"} geleden`;
  const dag = Math.floor(uur / 24);
  return `${dag} ${dag === 1 ? "dag" : "dagen"} geleden`;
}

// ---------------------------------------------------------------------------
// GitHub API
// ---------------------------------------------------------------------------

function ghHeaders(extra) {
  return {
    Authorization: `token ${localStorage.getItem(TOKEN_KEY)}`,
    Accept: "application/vnd.github+json",
    ...extra,
  };
}

async function githubGetFileSha(path) {
  // cache: "no-store" voorkomt dat een verouderde sha wordt hergebruikt, wat
  // een 409-conflict zou geven zodra het bestand ondertussen elders (bv. een
  // GitHub Action) is bijgewerkt.
  const res = await fetch(`${API}/contents/${encodeURIComponent(path)}?ref=main`, {
    headers: ghHeaders(),
    cache: "no-store",
  });
  if (!res.ok) return undefined; // bestand bestaat nog niet
  const data = await res.json();
  return data.sha;
}

async function githubPutFile(path, inhoud, boodschap) {
  const sha = await githubGetFileSha(path);
  const res = await fetch(`${API}/contents/${encodeURIComponent(path)}`, {
    method: "PUT",
    headers: ghHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ message: boodschap, content: base64EncodeUnicode(inhoud), sha, branch: "main" }),
  });
  if (!res.ok) throw new Error(`Kon ${path} niet opslaan (${res.status})`);
}

async function dispatchWorkflow(workflowFile, inputs) {
  const res = await fetch(`${API}/actions/workflows/${workflowFile}/dispatches`, {
    method: "POST",
    headers: ghHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ ref: "main", inputs: inputs || {} }),
  });
  if (!res.ok) throw new Error(`Kon de actie niet starten (${res.status})`);
}

async function vindLaatsteRun(workflowFile, naDatum) {
  // cache: "no-store" is essential hier — zonder dit kan Safari een oud
  // ("nog bezig") antwoord op deze exacte URL blijven hergebruiken, waardoor
  // het lijkt alsof de actie nooit klaar is terwijl hij allang is afgerond.
  const res = await fetch(`${API}/actions/workflows/${workflowFile}/runs?per_page=5`, {
    headers: ghHeaders(),
    cache: "no-store",
  });
  if (!res.ok) return null;
  const data = await res.json();
  return (data.workflow_runs || []).find((r) => new Date(r.created_at) >= naDatum) || null;
}

async function volgWorkflow(workflowFile, startTijd, statusEl, wachtBoodschap) {
  let run = null;
  for (let poging = 0; poging < 20 && !run; poging++) {
    await sleep(3000);
    run = await vindLaatsteRun(workflowFile, startTijd);
  }
  if (!run) return null;

  statusEl.innerHTML = `${wachtBoodschap} <a href="${run.html_url}" target="_blank" rel="noopener">bekijk voortgang</a>`;

  // Maximaal 10 minuten pollen; zonder deze grens zou een hapering in het
  // netwerk (of herhaaldelijk falende verzoeken) de pagina voor onbepaalde
  // tijd op "bezig" laten staan zonder enige terugkoppeling.
  for (let poging = 0; poging < 150 && run.status !== "completed"; poging++) {
    await sleep(4000);
    const res = await fetch(run.url, { headers: ghHeaders(), cache: "no-store" });
    if (res.ok) run = await res.json();
  }
  if (run.status !== "completed") {
    statusEl.innerHTML = `Dit duurt ongewoon lang. <a href="${run.html_url}" target="_blank" rel="noopener">Bekijk de status</a> — mogelijk is de pagina niet automatisch bijgewerkt.`;
    return null;
  }
  return run;
}

async function volgBestelling(startTijd, statusEl) {
  const run = await volgWorkflow(BESTEL_WORKFLOW, startTijd, statusEl, "Bestelling wordt verwerkt...");
  if (!run) {
    statusEl.textContent = "Kon de status niet vinden — check over een minuutje de Picnic-app.";
    return;
  }

  if (run.conclusion === "success") {
    statusEl.textContent = "Klaar! De producten staan in je Picnic-mandje. Open de Picnic-app om af te ronden.";
    wisControleStaat();
    // De net bestelde producten horen niet meer als "nog te controleren"
    // mee te tellen — zonder dit bleef de badge/statuskaart op Overzicht
    // het oude aantal tonen, ook al was de bestelling al geplaatst.
    staat.productVoorstellen = null;
    staat.productKeuzeIndex = {};
    await verversLaatsteBestelling();
    renderKopInfo();
    renderOverzicht();
    if (staat.tab === "controle") renderControleScherm();
    toonWaarschuwingenNaBestelling();
  } else {
    statusEl.innerHTML = `Er ging iets mis. <a href="${run.html_url}" target="_blank" rel="noopener">Bekijk het logboek</a>.`;
  }
}

// ---------------------------------------------------------------------------
// Data ophalen
// ---------------------------------------------------------------------------

async function haalTekstBestandOp(pad) {
  const res = await fetch(`${pad}?t=${Date.now()}`, { cache: "no-store" });
  if (!res.ok) return "";
  return res.text();
}

function base64DecodeUnicode(str) {
  return decodeURIComponent(escape(atob(str.replace(/\n/g, ""))));
}

// Leest een bestand direct via de GitHub Contents API i.p.v. de gehoste
// website (GitHub Pages). Belangrijk verschil: de website wordt pas na een
// aparte, soms trage build/deploy bijgewerkt (kan tientallen seconden tot
// een paar minuten duren) — de Contents API geeft altijd exact wat er nu in
// de repo staat, zónder die vertraging. Voor bestanden die een zojuist
// afgeronde actie heeft weggeschreven (product_voorstellen.json na "Zoek
// producten op", losse_zoekresultaten.json na "Ander product zoeken") is dit
// het verschil tussen verse en (soms een paar zoekopdrachten oude!) data.
async function haalTekstBestandViaApi(pad) {
  const res = await fetch(`${API}/contents/${encodeURIComponent(pad)}?ref=main`, {
    headers: ghHeaders(),
    cache: "no-store",
  });
  if (!res.ok) return "";
  const data = await res.json();
  if (!data.content) return "";
  return base64DecodeUnicode(data.content);
}

async function verversLaatsteBestelling() {
  // Direct via de GitHub API i.p.v. de gehoste site — dit wordt aangeroepen
  // vlak nadat de bestel-actie is voltooid, en de site kan dan nog een
  // oudere (nog niet herbouwde) versie van dit bestand serveren. Zie
  // haalTekstBestandViaApi voor waarom dat verschil uitmaakt.
  const tekst = await haalTekstBestandViaApi("laatste_bestelling.json");
  try {
    staat.laatsteBestelling = tekst ? JSON.parse(tekst) : null;
  } catch (e) {
    staat.laatsteBestelling = null;
  }
}

// ---------------------------------------------------------------------------
// UI
// ---------------------------------------------------------------------------

const schermPin = document.getElementById("scherm-pin");
const schermToken = document.getElementById("scherm-token");
const schermLaden = document.getElementById("scherm-laden");
const appEl = document.getElementById("app");
const headerTopEl = document.getElementById("header-top");
const dagenEl = document.getElementById("dagen");
const weekInfoEl = document.getElementById("week-info");
const laatstBesteldEl = document.getElementById("laatst-besteld");
const standaardLijstEl = document.getElementById("standaard-lijst");
const standaardSamenvattingEl = document.getElementById("standaard-samenvatting");
const standaardToggleKnop = document.getElementById("standaard-toggle-knop");
const standaardDetailEl = document.getElementById("standaard-detail");
const standaardOpslaanKnop = document.getElementById("standaard-opslaan-knop");
const standaardOpslaanStatusEl = document.getElementById("standaard-opslaan-status");
const toastWrapEl = document.getElementById("toast-wrap");
const voorraadLijstEl = document.getElementById("voorraad-lijst");
const beoordelingBlokEl = document.getElementById("beoordeling-blok");
const receptenbeheerEl = document.getElementById("receptenbeheer");
const aanvullenLijstSamenvattingEl = document.getElementById("aanvullen-lijst-samenvatting");
const aanvullenLijstKnop = document.getElementById("aanvullen-lijst-knop");
const lijstModalEl = document.getElementById("lijst-modal");
const lijstModalInhoudEl = document.getElementById("lijst-modal-inhoud");
const lijstModalSluitKnop = document.getElementById("lijst-modal-sluit-knop");
const waarschuwingenEl = document.getElementById("waarschuwingen");
const statusEl = document.getElementById("status");
const losseLijstEl = document.getElementById("losse-lijst");
const losNaamEl = document.getElementById("los-naam");
const losAantalEl = document.getElementById("los-aantal");
const overzichtSchermEl = document.getElementById("overzicht-scherm");
const weekmenuSchermEl = document.getElementById("weekmenu-scherm");
const voorraadSchermEl = document.getElementById("voorraad-scherm");
const controleSchermEl = document.getElementById("controle-scherm");
const meerSchermEl = document.getElementById("meer-scherm");
const controleLijstEl = document.getElementById("controle-lijst");
const controleLosNaamEl = document.getElementById("controle-los-naam");
const controleLosAantalEl = document.getElementById("controle-los-aantal");
const actieKnopWrapEl = document.getElementById("bestel-knop-wrap");
const actieKnopUitlegEl = document.getElementById("actie-knop-uitleg");
const actieKnop = document.getElementById("actie-knop");
const onderNavEl = document.getElementById("onder-nav");
const ovGroetEl = document.getElementById("ov-groet");
const ovTitelEl = document.getElementById("ov-titel");
const ovSubtitelEl = document.getElementById("ov-subtitel");
const ovBelKnopEl = document.getElementById("ov-bel-knop");
const ovBelIcoonEl = document.getElementById("ov-bel-icoon");
const ovBelBadgeEl = document.getElementById("ov-bel-badge");
const ovStatskaartenEl = document.getElementById("ov-statskaarten");
const ovVoortgangEl = document.getElementById("ov-voortgang");
const ovPrimaireActiesEl = document.getElementById("ov-primaire-acties");
const ovSnelleActiesEl = document.getElementById("ov-snelle-acties");
const ovVolgendeWrapEl = document.getElementById("ov-volgende-wrap");
const meerTokenStatusEl = document.getElementById("meer-token-status");
const meerTokenWijzigKnop = document.getElementById("meer-token-wijzig-knop");
const meerVoorkeurenDetailEl = document.getElementById("meer-voorkeuren-detail");
const meerLaatsteBestellingEl = document.getElementById("meer-laatste-bestelling");
const meerMandjeStatusEl = document.getElementById("meer-mandje-status");
const meerLeegMandjeKnop = document.getElementById("meer-leeg-mandje-knop");
const controleMandjeStatusEl = document.getElementById("controle-mandje-status");
const controleLeegMandjeKnop = document.getElementById("controle-leeg-mandje-knop");
const controleToevoegenKnop = document.getElementById("controle-toevoegen-knop");

const TABS = ["overzicht", "gerechten", "aanvullen", "controle", "meer"];

let staat = {
  pools: null,
  dagOpties: null,
  standaardlijst: null,
  standaardCategorieen: [],
  standaardUitgevinkt: new Set(),
  standaardlijstGewijzigd: false,
  standaardOpen: false,
  voorraadCategorieen: [],
  voorraadStatus: {},
  voorraadOpen: false,
  receptenboek: null,
  receptenboekHeader: "",
  receptenboekGewijzigd: false,
  geschiedenis: null,
  evenWeek: false,
  weekmenu: [],
  losseProducten: [],
  filters: {},
  ingredientenOpen: new Set(),
  receptenbeheerOpen: false,
  laatsteBestelling: null,
  laatsteWeekmenu: null,
  beoordelingen: {},
  productVoorkeuren: { ingredient: {}, gerecht_ingredient: {} },
  tab: "overzicht",
  productVoorstellen: null,
  productKeuzeIndex: {},
  zoekenBezig: false,
  bestellenBezig: false,
  mandjeLegenBezig: false,
};

function toonScherm(scherm) {
  for (const el of [schermPin, schermToken, schermLaden, appEl]) el.classList.add("verborgen");
  scherm.classList.remove("verborgen");
}

// Kort, zichtbaar bevestigingsbericht na een actie (toevoegen/verwijderen/
// opslaan), zodat duidelijk is dat een wijziging echt is doorgevoerd i.p.v.
// alleen stil de lijst te verversen.
function toonToast(bericht, type) {
  const toast = maakEl("div", "toast" + (type ? ` toast-${type}` : ""), bericht);
  toastWrapEl.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add("zichtbaar"));
  setTimeout(() => {
    toast.classList.remove("zichtbaar");
    setTimeout(() => toast.remove(), 300);
  }, 2800);
}

function ververs() {
  renderKopInfo();
  renderStandaardlijst();
  renderVoorraad();
  renderWeekmenu();
  renderBeoordelingBlok();
  renderReceptenbeheer();
  renderBoodschappenlijstSamenvatting();
  renderStandaardTegel();
  renderOverzicht();
  renderMeer();
}

// Navigatie: 5 vaste tabs (onderin) i.p.v. de vorige lineaire 3-stappen-
// wizard met Terug/Volgende. Elke tab toont zijn eigen scherm; de
// contextuele actieknop-balk (zoeken/bestellen) verschijnt alleen op de
// tabs waar dat een zinnige, eenduidige actie is.
function gaNaarTab(tab) {
  staat.tab = tab;
  overzichtSchermEl.classList.toggle("verborgen", tab !== "overzicht");
  weekmenuSchermEl.classList.toggle("verborgen", tab !== "gerechten");
  voorraadSchermEl.classList.toggle("verborgen", tab !== "aanvullen");
  controleSchermEl.classList.toggle("verborgen", tab !== "controle");
  meerSchermEl.classList.toggle("verborgen", tab !== "meer");
  if (headerTopEl) headerTopEl.classList.toggle("verborgen", tab === "overzicht");

  onderNavEl.querySelectorAll(".nav-item").forEach((el) => {
    el.classList.toggle("actief", el.dataset.tab === tab);
  });

  // statusEl (en de disabled-state van actieKnop) blijven bewust ongemoeid
  // wanneer er nog een zoek-/bestelactie loopt: dit is één gedeeld DOM-
  // element dat door de achtergrond-polling van startZoeken/bevestigBestelling
  // wordt bijgewerkt, ook terwijl de gebruiker op een ander tabblad zit. Het
  // hier blind leegmaken zorgde ervoor dat de knop na terugwisselen van
  // tabblad "dood" leek: nog uitgeschakeld, maar zonder enige statustekst.
  if (actieKnopUitlegEl) actieKnopUitlegEl.classList.add("verborgen");

  if (tab === "gerechten") {
    actieKnopWrapEl.classList.remove("verborgen");
    actieKnop.textContent = "Verder naar aanvullen";
    actieKnop.onclick = () => gaNaarTab("aanvullen");
    renderGerechtenSamenvatting();
  } else if (tab === "aanvullen") {
    actieKnopWrapEl.classList.remove("verborgen");
    actieKnop.textContent = "Picnic-producten zoeken";
    actieKnop.onclick = startZoeken;
    if (actieKnopUitlegEl) {
      actieKnopUitlegEl.textContent = "We zoeken voor alle geselecteerde boodschappen het best passende Picnic-product.";
      actieKnopUitlegEl.classList.remove("verborgen");
    }
    if (!staat.zoekenBezig) {
      const aantalProducten = huidigeBoodschappenTotalen().length;
      actieKnop.disabled = aantalProducten === 0;
      statusEl.textContent = aantalProducten === 0 ? "Selecteer eerst minstens één boodschap om te zoeken." : "";
    } else {
      actieKnop.disabled = true;
    }
  } else if (tab === "controle") {
    actieKnopWrapEl.classList.remove("verborgen");
    renderControleScherm();
    actieKnop.textContent = "Definitief bestellen bij Picnic";
    actieKnop.onclick = bevestigBestelling;
    actieKnop.disabled = staat.bestellenBezig;
    if (controleToevoegenKnop) controleToevoegenKnop.disabled = staat.bestellenBezig;
    if (!staat.bestellenBezig) statusEl.textContent = "";
  } else {
    actieKnopWrapEl.classList.add("verborgen");
  }

  if (tab === "overzicht") renderOverzicht();
  if (tab === "meer") renderMeer();
}

onderNavEl.querySelectorAll(".nav-item").forEach((el) => {
  el.onclick = () => gaNaarTab(el.dataset.tab);
});

// --- Kop: week-info + laatst besteld ---

function renderKopInfo() {
  weekInfoEl.textContent = `Weekplan voor deze week · vrijdag & zaterdag voor ${staat.evenWeek ? "2" : "4"} personen`;

  if (staat.laatsteBestelling && staat.laatsteBestelling.datum) {
    laatstBesteldEl.textContent = `Laatst besteld: ${relatieveTijd(staat.laatsteBestelling.datum)}`;
  } else {
    laatstBesteldEl.textContent = "Nog niet eerder besteld";
  }
}

// --- Overzicht (hoofdpagina) ---

function overzichtOpenstaandeBeoordelingen() {
  if (!staat.laatsteWeekmenu || !staat.laatsteWeekmenu.gerechten) return [];
  return staat.laatsteWeekmenu.gerechten.filter((naam) => {
    const b = staat.beoordelingen[naam];
    if (!b || !b.laatst) return true;
    return new Date(b.laatst) < new Date(staat.laatsteWeekmenu.datum);
  });
}

function bouwOvActieKnop(a) {
  const knop = document.createElement("button");
  knop.type = "button";
  knop.className = "ov-actie";
  const icoon = maakEl("div", `ov-actie-icoon ov-tint-${a.kleur}`);
  icoon.innerHTML = icoonSvg(a.icoon);
  knop.appendChild(icoon);
  const tekst = maakEl("div", "ov-actie-tekst");
  const titelRij = maakEl("div", "ov-actie-titel-rij");
  titelRij.appendChild(maakEl("span", "ov-actie-titel", a.titel));
  if (a.badge) titelRij.appendChild(maakEl("span", "ov-actie-badge", a.badge));
  tekst.appendChild(titelRij);
  tekst.appendChild(maakEl("div", "ov-actie-sub", a.sub));
  knop.appendChild(tekst);
  const chevron = maakEl("div", "ov-actie-chevron");
  chevron.innerHTML = icoonSvg("chevronRight");
  knop.appendChild(chevron);
  knop.onclick = a.onClick;
  return knop;
}

function bouwOvSnelKnop(a) {
  const knop = document.createElement("button");
  knop.type = "button";
  knop.className = "ov-snel-knop";
  const icoon = maakEl("div", `ov-snel-icoon ov-tint-${a.kleur}`);
  icoon.innerHTML = icoonSvg(a.icoon);
  knop.appendChild(icoon);
  knop.appendChild(maakEl("div", "ov-snel-label", a.label));
  knop.onclick = a.onClick;
  return knop;
}

function renderOverzicht() {
  if (!ovTitelEl) return;

  const uur = new Date().getHours();
  ovGroetEl.textContent = uur < 12 ? "Goedemorgen!" : uur < 18 ? "Goedemiddag!" : "Goedenavond!";
  ovTitelEl.textContent = "Jouw boodschappen";
  ovSubtitelEl.textContent =
    staat.laatsteBestelling && staat.laatsteBestelling.datum
      ? `Laatst besteld: ${relatieveTijd(staat.laatsteBestelling.datum)}`
      : "Nog niet eerder besteld";

  // Notificatiebel: alleen tonen bij een echte, actionable waarschuwing.
  const belAantal =
    (staat.laatsteBestelling && staat.laatsteBestelling.status === "mislukt" ? 1 : 0) +
    (staat.laatsteBestelling && staat.laatsteBestelling.niet_gevonden ? staat.laatsteBestelling.niet_gevonden.length : 0);
  if (!ovBelIcoonEl.innerHTML) ovBelIcoonEl.innerHTML = icoonSvg("bell");
  ovBelKnopEl.classList.toggle("verborgen", belAantal === 0);
  if (belAantal > 0) {
    ovBelBadgeEl.textContent = String(belAantal);
    ovBelKnopEl.onclick = () => {
      gaNaarTab("overzicht");
      waarschuwingenEl.scrollIntoView({ behavior: "smooth", block: "start" });
    };
  }

  // Samenvattingskaarten — echte data; bedrag/controleren pas na "Zoek
  // producten op" (daarvoor is er simpelweg nog geen betrouwbaar cijfer).
  const gerechtenAantal = staat.weekmenu.length;
  let productenAantal;
  let controlerenAantal = null;
  let bedragTekst = null;

  if (staat.productVoorstellen) {
    const namen = Object.keys(staat.productVoorstellen).filter((n) => {
      const info = staat.productVoorstellen[n];
      return !info.verwijderd && !info.geparkeerd;
    });
    productenAantal = namen.length;
    const herkomst = berekenIngredientHerkomst(staat.weekmenu);
    let aandacht = 0;
    let totaalCent = 0;
    let onbekend = false;
    for (const naam of namen) {
      const info = staat.productVoorstellen[naam];
      const kandidaten = info.kandidaten || [];
      const idx = staat.productKeuzeIndex[naam] ?? 0;
      const gekozen = kandidaten[idx];
      if (!gekozen || info.nieuw || heeftVoorkeurMismatch(naam, gekozen)) aandacht++;
      if (gekozen && typeof gekozen.prijs_cent === "number") {
        totaalCent += gekozen.prijs_cent * bepaalTeBestellenAantal(info.aantal, gekozen, herkomst.has(naam.toLowerCase()));
      } else {
        onbekend = true;
      }
    }
    controlerenAantal = aandacht;
    bedragTekst = onbekend ? null : `± €${(totaalCent / 100).toFixed(2).replace(".", ",")}`;
  } else {
    const alleProducten = [...gekozenStandaardProducten(), ...voorraadTeBestellen(), ...staat.losseProducten];
    productenAantal = berekenTotalen(staat.weekmenu, alleProducten, voorraadArtikelNamen(staat.voorraadCategorieen)).length;
  }

  const kaarten = [
    { icoon: "utensils", kleur: "green", waarde: String(gerechtenAantal), label: "gerechten" },
    { icoon: "basket", kleur: "blue", waarde: String(productenAantal), label: "producten" },
  ];
  if (controlerenAantal !== null) {
    kaarten.push({ icoon: "alertTriangle", kleur: "orange", waarde: String(controlerenAantal), label: "controleren" });
  }
  if (bedragTekst) {
    kaarten.push({ icoon: null, kleur: "purple", waarde: bedragTekst, label: "totaalbedrag" });
  }

  ovStatskaartenEl.innerHTML = "";
  for (const k of kaarten) {
    const kaart = maakEl("div", "ov-statkaart");
    const icoon = maakEl("div", `ov-statkaart-icoon ov-tint-${k.kleur}`);
    icoon.innerHTML = k.icoon ? icoonSvg(k.icoon) : `<span style="font-weight:800;">€</span>`;
    kaart.appendChild(icoon);
    kaart.appendChild(maakEl("div", "ov-statkaart-waarde", k.waarde));
    kaart.appendChild(maakEl("div", "ov-statkaart-label", k.label));
    ovStatskaartenEl.appendChild(kaart);
  }

  // Eén contextuele hoofdactie (i.p.v. drie gelijkwaardige knoppen) + een
  // compacte 4-stappen-voortgang, allebei afgeleid uit dezelfde, al
  // bestaande state hierboven (gerechtenAantal/controlerenAantal) — geen
  // aparte "voortgang"-vlag die uit de pas kan gaan lopen met de echte data.
  const heeftGezocht = !!staat.productVoorstellen;
  const boodschappenAantal = huidigeBoodschappenTotalen().length;

  let fase;
  let hoofdactie;
  if (gerechtenAantal === 0) {
    fase = 1;
    hoofdactie = {
      icoon: "utensils",
      kleur: "green",
      titel: "Kies gerechten",
      sub: "Kies de gerechten voor deze week om te beginnen",
      onClick: () => gaNaarTab("gerechten"),
    };
  } else if (!heeftGezocht && boodschappenAantal === 0) {
    fase = 2;
    hoofdactie = {
      icoon: "basket",
      kleur: "blue",
      titel: "Vul boodschappen aan",
      sub: "Controleer je vaste boodschappen, voorraad en extra producten",
      onClick: () => gaNaarTab("aanvullen"),
    };
  } else if (!heeftGezocht) {
    fase = 3;
    hoofdactie = {
      icoon: "truck",
      kleur: "blue",
      titel: "Zoek Picnic-producten",
      sub: "We zoeken het best passende Picnic-product voor elke boodschap",
      onClick: () => gaNaarTab("aanvullen"),
    };
  } else if (controlerenAantal > 0) {
    fase = 4;
    hoofdactie = {
      icoon: "alertTriangle",
      kleur: "orange",
      titel: `Controleer ${controlerenAantal} product${controlerenAantal === 1 ? "" : "en"}`,
      sub: "Er staan nog producten open die een controle nodig hebben",
      onClick: () => gaNaarTab("controle"),
    };
  } else {
    fase = 4;
    hoofdactie = {
      icoon: "truck",
      kleur: "red",
      titel: "Toevoegen aan Picnic",
      sub: "Verstuur je boodschappenlijst naar Picnic",
      onClick: () => gaNaarTab("controle"),
    };
  }

  ovPrimaireActiesEl.innerHTML = "";
  ovPrimaireActiesEl.appendChild(bouwOvActieKnop(hoofdactie));

  if (ovVoortgangEl) {
    const STAPPEN = ["Gerechten kiezen", "Boodschappen aanvullen", "Picnic-producten zoeken", "Controleren en toevoegen"];
    ovVoortgangEl.innerHTML = "";
    STAPPEN.forEach((label, i) => {
      const nr = i + 1;
      const status = nr < fase ? "voltooid" : nr === fase ? "actief" : "toekomst";
      const rij = maakEl("div", `ov-voortgang-stap ov-voortgang-${status}`);
      const bol = maakEl("div", "ov-voortgang-bol");
      bol.innerHTML = status === "voltooid" ? icoonSvg("check") : String(nr);
      rij.appendChild(bol);
      rij.appendChild(maakEl("span", "ov-voortgang-label", label));
      ovVoortgangEl.appendChild(rij);
    });
  }

  // Snelle acties
  ovSnelleActiesEl.innerHTML = "";
  ovSnelleActiesEl.appendChild(
    bouwOvSnelKnop({
      icoon: "plusCircle",
      kleur: "blue",
      label: "Los product toevoegen",
      onClick: () => {
        gaNaarTab("aanvullen");
        setTimeout(() => losNaamEl && losNaamEl.focus(), 50);
      },
    })
  );
  ovSnelleActiesEl.appendChild(
    bouwOvSnelKnop({
      icoon: "clipboardList",
      kleur: "orange",
      label: "Vaste boodschappen",
      onClick: () => gaNaarTab("aanvullen"),
    })
  );
  ovSnelleActiesEl.appendChild(
    bouwOvSnelKnop({
      icoon: "package",
      kleur: "green",
      label: "Voorraad controleren",
      onClick: () => {
        staat.voorraadOpen = true;
        gaNaarTab("aanvullen");
        renderVoorraad();
      },
    })
  );
  const openstaand = overzichtOpenstaandeBeoordelingen();
  ovSnelleActiesEl.appendChild(
    openstaand.length > 0
      ? bouwOvSnelKnop({
          icoon: "refresh",
          kleur: "purple",
          label: "Vorige week beoordelen",
          onClick: () => gaNaarTab("gerechten"),
        })
      : bouwOvSnelKnop({
          icoon: "refresh",
          kleur: "purple",
          label: "Recepten beheren",
          onClick: () => {
            staat.receptenbeheerOpen = true;
            gaNaarTab("meer");
            renderReceptenbeheer();
          },
        })
  );

  // Automatiseringskaart (enige echte, bekende "volgende afspraak": de
  // zondag-check — er is geen Picnic-bezorgmoment-data in deze app).
  ovVolgendeWrapEl.innerHTML = "";
  const nu = new Date();
  const dagenTotZondag = (7 - nu.getDay()) % 7 || 7;
  const volgendeKaart = maakEl("div", "ov-volgende");
  const volgendeIcoon = maakEl("div", "ov-volgende-icoon");
  volgendeIcoon.innerHTML = icoonSvg("calendar");
  volgendeKaart.appendChild(volgendeIcoon);
  const volgendeTekst = maakEl("div", "ov-volgende-tekst");
  volgendeTekst.appendChild(maakEl("div", "ov-volgende-titel", "Automatische controle"));
  volgendeTekst.appendChild(
    maakEl("div", "ov-volgende-sub", "Zondag: al bevestigd? Niets nodig. Anders krijg je alleen een herinnering.")
  );
  volgendeKaart.appendChild(volgendeTekst);
  volgendeKaart.appendChild(
    maakEl("div", "ov-volgende-badge", `Over ${dagenTotZondag} dag${dagenTotZondag === 1 ? "" : "en"}`)
  );
  ovVolgendeWrapEl.appendChild(volgendeKaart);
}

// --- "Meer"-scherm ---

function renderMeer() {
  if (!meerTokenStatusEl) return;

  meerTokenStatusEl.textContent = localStorage.getItem(TOKEN_KEY) ? "Ingesteld op dit toestel" : "Nog niet ingesteld";

  const aantalVoorkeuren =
    staat.productVoorkeuren && staat.productVoorkeuren.ingredient ? Object.keys(staat.productVoorkeuren.ingredient).length : 0;
  meerVoorkeurenDetailEl.textContent =
    aantalVoorkeuren > 0 ? `${aantalVoorkeuren} ingrediënt${aantalVoorkeuren === 1 ? "" : "en"} met een geleerde voorkeur` : "Nog geen voorkeuren geleerd";

  if (staat.laatsteBestelling && staat.laatsteBestelling.datum) {
    const statusLabel =
      staat.laatsteBestelling.status === "voltooid" ? "Geslaagd" : staat.laatsteBestelling.status === "mislukt" ? "Mislukt" : staat.laatsteBestelling.status;
    meerLaatsteBestellingEl.textContent = `${statusLabel} · ${relatieveTijd(staat.laatsteBestelling.datum)}`;
  } else {
    meerLaatsteBestellingEl.textContent = "Nog geen bestelling geplaatst";
  }
}

if (meerTokenWijzigKnop) {
  meerTokenWijzigKnop.onclick = () => {
    if (!confirm("Weet je zeker dat je de opgeslagen GitHub-sleutel wilt verwijderen? Je moet 'm dan opnieuw invoeren.")) return;
    localStorage.removeItem(TOKEN_KEY);
    location.reload();
  };
}

// Eén gedeelde functie voor beide "Picnic-mandje legen"-knoppen (onder Meer
// en onder Controle) — geen losse kopie van de dispatch/poll-logica, en de
// staat.mandjeLegenBezig-vlag zorgt dat hij niet twee keer tegelijk vanaf
// allebei de plekken gestart kan worden.
function zetMandjeStatusTekst(tekst, status) {
  for (const el of [meerMandjeStatusEl, controleMandjeStatusEl]) {
    if (!el) continue;
    el.textContent = tekst;
    el.classList.toggle("status-succes", status === "succes");
    el.classList.toggle("status-fout", status === "fout");
  }
}

function zetMandjeKnoppenDisabled(disabled) {
  if (meerLeegMandjeKnop) meerLeegMandjeKnop.disabled = disabled;
  if (controleLeegMandjeKnop) controleLeegMandjeKnop.disabled = disabled;
}

// Kleine proxy die alleen de .innerHTML-setter doorstuurt naar beide echte
// statuselementen — zo kan volgWorkflow() (die intern statusEl.innerHTML
// zet, o.a. voor de "bekijk voortgang"-link) ongewijzigd hergebruikt worden.
const mandjeStatusProxyEl = {
  set innerHTML(html) {
    for (const el of [meerMandjeStatusEl, controleMandjeStatusEl]) {
      if (el) el.innerHTML = html;
    }
  },
};

async function leegWinkelwagentje() {
  if (staat.mandjeLegenBezig) return;
  if (!confirm("Alles uit je huidige Picnic-mandje verwijderen? Dit kan niet ongedaan gemaakt worden.")) return;

  staat.mandjeLegenBezig = true;
  const startTijd = new Date();
  zetMandjeKnoppenDisabled(true);
  zetMandjeStatusTekst("Winkelwagentje wordt geleegd...");

  try {
    await dispatchWorkflow(LEEG_MANDJE_WORKFLOW, {});
    const run = await volgWorkflow(LEEG_MANDJE_WORKFLOW, startTijd, mandjeStatusProxyEl, "Bezig met legen...");

    if (!run) {
      zetMandjeStatusTekst("Kon de status niet vinden — check zo nodig zelf de Picnic-app.", "fout");
      return;
    }

    // De workflow-conclusie alleen is niet genoeg: die zegt alleen dat de
    // stap zonder crash is afgerond. Het echte resultaat (is het mandje
    // aantoonbaar leeg?) staat in laatste_mandje_actie.json, dat
    // picnic_boodschappen.py --leeg-mandje pas na een verse her-controle
    // wegschrijft — alleen bij status "leeg" tonen we hier ook "geleegd".
    let resultaat = null;
    try {
      const tekst = await haalTekstBestandViaApi("laatste_mandje_actie.json");
      resultaat = tekst ? JSON.parse(tekst) : null;
    } catch (e) {
      resultaat = null;
    }

    if (run.conclusion === "success" && resultaat && resultaat.status === "leeg") {
      zetMandjeStatusTekst("✓ Winkelwagentje geleegd", "succes");
      toonToast("✓ Winkelwagentje geleegd");
    } else if (resultaat && resultaat.status === "niet_leeg") {
      const n = (resultaat.resterende_producten || []).length;
      zetMandjeStatusTekst(
        `Het mandje kon niet volledig worden geleegd. Er sta${n === 1 ? "at" : "an"} nog ${n} product${n === 1 ? "" : "en"} in. Controleer de Picnic-app.`,
        "fout"
      );
    } else if (resultaat && resultaat.foutmelding) {
      zetMandjeStatusTekst(`Legen is mislukt: ${resultaat.foutmelding}`, "fout");
    } else {
      mandjeStatusProxyEl.innerHTML = `Legen is mislukt. <a href="${run.html_url}" target="_blank" rel="noopener">Bekijk het logboek</a>.`;
    }
  } catch (e) {
    zetMandjeStatusTekst("Er ging iets mis: " + e.message, "fout");
  } finally {
    staat.mandjeLegenBezig = false;
    zetMandjeKnoppenDisabled(false);
  }
}

if (meerLeegMandjeKnop) meerLeegMandjeKnop.onclick = leegWinkelwagentje;
if (controleLeegMandjeKnop) controleLeegMandjeKnop.onclick = leegWinkelwagentje;
if (controleToevoegenKnop) controleToevoegenKnop.onclick = bevestigBestelling;

document.querySelectorAll(".nav-icoon[data-icoon]").forEach((el) => {
  el.innerHTML = icoonSvg(el.dataset.icoon);
});

// --- Standaardlijst ---

function renderStandaardlijst() {
  standaardLijstEl.innerHTML = "";
  for (const categorie of staat.standaardCategorieen) {
    if (categorie.items.length === 0) continue;
    if (staat.standaardCategorieen.length > 1) {
      standaardLijstEl.appendChild(maakEl("div", "std-categorie-kop", categorie.naam));
    }
    for (const item of categorie.items) {
      const sleutel = item.naam.toLowerCase();
      const uitgevinkt = staat.standaardUitgevinkt.has(sleutel);

      const wissel = () => {
        if (staat.standaardUitgevinkt.has(sleutel)) staat.standaardUitgevinkt.delete(sleutel);
        else staat.standaardUitgevinkt.add(sleutel);
        ververs();
      };

      const rij = maakEl("div", "std-item" + (uitgevinkt ? " uit" : ""));
      rij.appendChild(maakKnop("vinkje" + (uitgevinkt ? "" : " aan"), uitgevinkt ? "" : "✓", wissel));

      // Bewerkbaar veld i.p.v. platte tekst: als Picnic een product niet
      // vindt, kun je de naam hier meteen corrigeren (bv. exact zoals
      // Picnic het zelf noemt) — dat wordt permanent opgeslagen in
      // standaardlijst.txt.
      const naamVeld = document.createElement("input");
      naamVeld.type = "text";
      naamVeld.className = "std-naam";
      naamVeld.value = item.naam;
      naamVeld.onchange = () => {
        const nieuweNaam = naamVeld.value.trim();
        if (nieuweNaam && nieuweNaam !== item.naam) {
          const vorigeNaam = item.naam;
          item.naam = nieuweNaam;
          staat.standaardlijstGewijzigd = true;
          toonToast(`✓ "${vorigeNaam}" hernoemd naar "${nieuweNaam}"`);
        }
        ververs();
      };
      rij.appendChild(naamVeld);

      const stepper = maakEl("div", "stepper");
      stepper.appendChild(
        maakKnop("stap-knop", "–", () => {
          item.aantal = Math.max(1, item.aantal - 1);
          staat.standaardlijstGewijzigd = true;
          ververs();
        })
      );
      stepper.appendChild(maakEl("span", "stepper-waarde", `${item.aantal}×`));
      stepper.appendChild(
        maakKnop("stap-knop", "+", () => {
          item.aantal += 1;
          staat.standaardlijstGewijzigd = true;
          ververs();
        })
      );
      rij.appendChild(stepper);

      rij.appendChild(
        maakKnop("ingredient-verwijder", "✕", () => {
          if (!confirm(`"${item.naam}" definitief van de vaste boodschappen verwijderen?`)) return;
          const idx = categorie.items.indexOf(item);
          if (idx !== -1) categorie.items.splice(idx, 1);
          staat.standaardlijst = staat.standaardCategorieen.flatMap((c) => c.items);
          staat.standaardUitgevinkt.delete(sleutel);
          staat.standaardlijstGewijzigd = true;
          toonToast(`✓ Verwijderd: ${item.naam}`);
          ververs();
        })
      );

      standaardLijstEl.appendChild(rij);
    }
  }

  standaardLijstEl.appendChild(bouwStandaardToevoegRij());
  renderStandaardOpslaanStatus();
}

// Compacte "tegel" op Aanvullen: hoeveel van de vaste boodschappen (die
// standaard allemaal aan staan) geselecteerd zijn, met een paar
// voorbeeldnamen. De volledige lijst (met vinkjes/aantal/naam-bewerken)
// blijft precies wat renderStandaardlijst() hierboven al opbouwt — dit is
// puur een in-/uitklap-laag eromheen, geen aparte implementatie.
function renderStandaardTegel() {
  if (!standaardSamenvattingEl) return;
  const totaal = staat.standaardlijst.length;
  const geselecteerd = totaal - staat.standaardUitgevinkt.size;
  const voorbeelden = staat.standaardlijst
    .filter((item) => !staat.standaardUitgevinkt.has(item.naam.toLowerCase()))
    .slice(0, 3)
    .map((item) => item.naam);

  standaardSamenvattingEl.textContent =
    totaal === 0
      ? "Geen vaste boodschappenlijst gevonden."
      : `${geselecteerd} van ${totaal} producten geselecteerd${voorbeelden.length > 0 ? ` · ${voorbeelden.join(", ")}${geselecteerd > voorbeelden.length ? ", ..." : ""}` : ""}`;

  if (standaardToggleKnop) standaardToggleKnop.textContent = staat.standaardOpen ? "Inklappen" : "Bekijken en aanpassen";
  if (standaardDetailEl) standaardDetailEl.classList.toggle("verborgen", !staat.standaardOpen);
}

if (standaardToggleKnop) {
  standaardToggleKnop.onclick = () => {
    staat.standaardOpen = !staat.standaardOpen;
    renderStandaardTegel();
  };
}

function renderStandaardOpslaanStatus() {
  standaardOpslaanKnop.classList.toggle("nadruk", staat.standaardlijstGewijzigd);
  standaardOpslaanStatusEl.textContent = staat.standaardlijstGewijzigd ? "Niet opgeslagen wijzigingen" : "";
}

standaardOpslaanKnop.onclick = async () => {
  standaardOpslaanKnop.disabled = true;
  standaardOpslaanStatusEl.textContent = "Opslaan...";
  try {
    await githubPutFile("standaardlijst.txt", herbouwStandaardlijstTekst(), "Vaste boodschappen aangepast via de website");
    staat.standaardlijstGewijzigd = false;
    standaardOpslaanKnop.disabled = false;
    renderStandaardOpslaanStatus();
    toonToast("✓ Vaste boodschappenlijst opgeslagen");
  } catch (e) {
    standaardOpslaanKnop.disabled = false;
    standaardOpslaanStatusEl.textContent = "Opslaan mislukt: " + e.message;
  }
};

function bouwStandaardToevoegRij() {
  const rij = maakEl("div", "std-toevoeg-rij");

  const naamVeld = document.createElement("input");
  naamVeld.type = "text";
  naamVeld.placeholder = "Nieuw product";
  naamVeld.className = "std-toevoeg-naam";

  const aantalVeld = document.createElement("input");
  aantalVeld.type = "text";
  aantalVeld.inputMode = "numeric";
  aantalVeld.value = "1";
  aantalVeld.className = "std-toevoeg-aantal";

  const categorieVeld = document.createElement("select");
  categorieVeld.className = "std-toevoeg-categorie";
  const categorieNamen = staat.standaardCategorieen.length > 0 ? staat.standaardCategorieen.map((c) => c.naam) : ["overig"];
  for (const naam of categorieNamen) {
    const optie = document.createElement("option");
    optie.value = naam;
    optie.textContent = naam;
    categorieVeld.appendChild(optie);
  }

  const toevoegKnop = maakKnop("secundair", "+ Toevoegen", () => {
    const naam = naamVeld.value.trim();
    if (!naam) return;
    const aantal = parseInt(aantalVeld.value, 10) || 1;
    let categorie = staat.standaardCategorieen.find((c) => c.naam === categorieVeld.value);
    if (!categorie) {
      categorie = { naam: categorieVeld.value, items: [] };
      staat.standaardCategorieen.push(categorie);
    }
    categorie.items.push({ naam, aantal });
    staat.standaardlijst = staat.standaardCategorieen.flatMap((c) => c.items);
    staat.standaardlijstGewijzigd = true;
    toonToast(`✓ Toegevoegd: ${naam}`);
    naamVeld.value = "";
    aantalVeld.value = "1";
    ververs();
  });

  rij.appendChild(naamVeld);
  rij.appendChild(aantalVeld);
  rij.appendChild(categorieVeld);
  rij.appendChild(toevoegKnop);
  return rij;
}

// --- Voorraadcheck ---

const VOORRAAD_STATUSSEN = ["genoeg", "bijna op", "op"];
const VOORRAAD_LABELS = { genoeg: "Genoeg", "bijna op": "Bijna op", op: "Op" };

function voorraadSleutel(categorieNaam, itemNaam) {
  return `${categorieNaam}|${itemNaam}`.toLowerCase();
}

function renderVoorraad() {
  voorraadLijstEl.innerHTML = "";
  if (staat.voorraadCategorieen.length === 0) {
    voorraadLijstEl.appendChild(maakEl("div", "std-footnote", "Geen voorraad.txt gevonden."));
    return;
  }

  const laagAantal = voorraadTeBestellen().length;
  voorraadLijstEl.appendChild(
    maakEl(
      "div",
      "aanvullen-samenvatting",
      laagAantal > 0
        ? `${laagAantal} voorraadproduct${laagAantal === 1 ? "" : "en"} geselecteerd`
        : "Nog geen voorraadproducten geselecteerd"
    )
  );
  voorraadLijstEl.appendChild(
    maakKnop("secundair aanvullen-tegel-knop", staat.voorraadOpen ? "Inklappen" : "Voorraad controleren", () => {
      staat.voorraadOpen = !staat.voorraadOpen;
      renderVoorraad();
    })
  );
  if (!staat.voorraadOpen) return;

  for (const categorie of staat.voorraadCategorieen) {
    voorraadLijstEl.appendChild(maakEl("div", "std-categorie-kop", categorie.naam));
    for (const itemNaam of categorie.items) {
      const sleutel = voorraadSleutel(categorie.naam, itemNaam);
      const huidigeStatus = staat.voorraadStatus[sleutel] || "genoeg";

      const rij = maakEl("div", "voorraad-item");
      rij.appendChild(maakEl("div", "voorraad-naam", itemNaam));

      const knoppenRij = maakEl("div", "voorraad-knoppen");
      for (const status of VOORRAAD_STATUSSEN) {
        knoppenRij.appendChild(
          maakKnop("voorraad-knop" + (huidigeStatus === status ? " actief-" + status.replace(" ", "-") : ""), VOORRAAD_LABELS[status], () => {
            staat.voorraadStatus[sleutel] = status;
            ververs();
          })
        );
      }
      rij.appendChild(knoppenRij);

      voorraadLijstEl.appendChild(rij);
    }
  }

  voorraadLijstEl.appendChild(
    maakEl(
      "div",
      "std-footnote",
      "Rijst, pasta, koffie e.d. worden niet automatisch toegevoegd omdat een gerecht ze gebruikt — dat gaat over veel gerechten heen. Geef hier aan wat bijna op of op is, alleen dat komt op de lijst."
    )
  );
}

// Producten waarvan de voorraad "bijna op" of "op" is — dit zijn de items
// die (naast de vaste standaardlijst) aan de boodschappenlijst worden
// toegevoegd.
function voorraadTeBestellen() {
  const resultaat = [];
  for (const categorie of staat.voorraadCategorieen) {
    for (const itemNaam of categorie.items) {
      const sleutel = voorraadSleutel(categorie.naam, itemNaam);
      const status = staat.voorraadStatus[sleutel] || "genoeg";
      if (status === "bijna op" || status === "op") {
        resultaat.push({ naam: itemNaam, aantal: 1 });
      }
    }
  }
  return resultaat;
}

// --- Ingrediënten per dag: inzien/aanpassen ---

function bouwIngredientenSectie(kaart, dag, index) {
  const wrap = maakEl("div", "ingredienten-wrap");
  const open = staat.ingredientenOpen.has(index);

  wrap.appendChild(
    maakKnop("ingredienten-toggle", `${open ? "▾" : "▸"} Ingrediënten (${dag.ingredienten.length})`, () => {
      if (staat.ingredientenOpen.has(index)) staat.ingredientenOpen.delete(index);
      else staat.ingredientenOpen.add(index);
      ververs();
    })
  );

  if (open) {
    const lijst = maakEl("div", "ingredienten-lijst");
    dag.ingredienten.forEach((regel, i) => {
      const item = parseAantalNaam(regel);
      const rij = maakEl("div", "ingredient-rij");
      rij.appendChild(maakEl("span", "ingredient-naam", item.naam));

      const stepper = maakEl("div", "stepper");
      stepper.appendChild(
        maakKnop("stap-knop", "–", () => {
          const huidig = parseAantalNaam(staat.weekmenu[index].ingredienten[i]);
          huidig.aantal = Math.max(1, huidig.aantal - 1);
          staat.weekmenu[index].ingredienten[i] = `${huidig.aantal} x ${huidig.naam}`;
          ververs();
        })
      );
      stepper.appendChild(maakEl("span", "stepper-waarde", `${item.aantal}×`));
      stepper.appendChild(
        maakKnop("stap-knop", "+", () => {
          const huidig = parseAantalNaam(staat.weekmenu[index].ingredienten[i]);
          huidig.aantal += 1;
          staat.weekmenu[index].ingredienten[i] = `${huidig.aantal} x ${huidig.naam}`;
          ververs();
        })
      );
      rij.appendChild(stepper);

      rij.appendChild(
        maakKnop("ingredient-verwijder", "✕", () => {
          staat.weekmenu[index].ingredienten.splice(i, 1);
          ververs();
        })
      );

      lijst.appendChild(rij);
    });
    wrap.appendChild(lijst);

    const invoerRij = maakEl("div", "ingredient-invoer");
    const naamVeld = document.createElement("input");
    naamVeld.type = "text";
    naamVeld.className = "ing-naam";
    naamVeld.placeholder = "Extra ingrediënt";
    const aantalVeld = document.createElement("input");
    aantalVeld.type = "text";
    aantalVeld.className = "ing-aantal";
    aantalVeld.inputMode = "numeric";
    aantalVeld.value = "1";
    invoerRij.appendChild(naamVeld);
    invoerRij.appendChild(aantalVeld);
    invoerRij.appendChild(
      maakKnop("secundair", "Toevoegen", () => {
        const naam = naamVeld.value.trim();
        if (!naam) return;
        const aantal = parseInt(aantalVeld.value, 10) || 1;
        staat.weekmenu[index].ingredienten.push(`${aantal} x ${naam}`);
        ververs();
      })
    );
    wrap.appendChild(invoerRij);
  }

  kaart.appendChild(wrap);
}

// --- Dagkaarten ---

function renderWeekmenu() {
  dagenEl.innerHTML = "";
  staat.weekmenu.forEach((dag, index) => {
    if (POOL_VOOR_CATEGORIE[dag.categorie]) {
      dagenEl.appendChild(bouwGerechtKaart(dag, index));
    } else {
      dagenEl.appendChild(bouwCombiKaart(dag, index));
    }
  });
  renderGerechtenSamenvatting();
}

// Samenvatting + status van de vaste "Verder naar aanvullen"-knop onderaan
// het Gerechten-tabblad — echte state (geen slag om de arm): telt de
// daadwerkelijk gekozen dagen en de daaruit voortvloeiende, samengevoegde
// ingrediënten (dezelfde samenvoeging als de rest van de app gebruikt om
// van "ingrediënt per dag" naar "boodschap" te gaan).
function renderGerechtenSamenvatting() {
  if (staat.tab !== "gerechten") return;
  const gerechtenAantal = staat.weekmenu.length;
  const ingredientenAantal = berekenTotalen(staat.weekmenu, [], voorraadArtikelNamen(staat.voorraadCategorieen)).length;

  if (gerechtenAantal === 0) {
    statusEl.textContent = "Kies eerst minstens één gerecht om verder te gaan.";
    actieKnop.disabled = true;
  } else {
    statusEl.textContent = `${gerechtenAantal} gerecht${gerechtenAantal === 1 ? "" : "en"} gekozen · ${ingredientenAantal} ingrediënt${ingredientenAantal === 1 ? "" : "en"} toegevoegd`;
    actieKnop.disabled = false;
  }
}

// Past het aantal personen voor deze dag aan (handmatige override op het
// vaste weekrooster) en herschaalt de ingrediënten mee als het huidige
// gerecht uit het receptenboek komt.
function wijzigPersonenVoorDag(dag, delta) {
  const nieuwePersonen = Math.max(1, (dag.personen || 2) + delta);
  if (nieuwePersonen === dag.personen) return;
  const gerecht = staat.receptenboek ? staat.receptenboek.find((g) => g.naam === dag.naam) : null;
  pasPersonenAan(dag, gerecht, nieuwePersonen);
  ververs();
}

function bouwDagKop(dag, index) {
  const kop = maakEl("div", "dag-kop-rij");
  kop.appendChild(maakEl("div", "dag-eyebrow", dag.dag));

  const badge = maakEl("div", "personen-badge");
  badge.appendChild(maakKnop("personen-knop", "–", () => wijzigPersonenVoorDag(dag, -1)));
  badge.appendChild(maakEl("span", "personen-waarde", `${dag.personen || 2}p`));
  badge.appendChild(maakKnop("personen-knop", "+", () => wijzigPersonenVoorDag(dag, 1)));
  kop.appendChild(badge);

  return kop;
}

function bouwTagBadges(gerecht) {
  if (!gerecht) return null;
  const badges = [gerecht.vlees ? VLEES_LABELS[gerecht.vlees] || gerecht.vlees : null, ...(gerecht.tags || [])].filter(
    (t) => t && t !== "nieuw" && t !== "probeerrecept"
  );
  const extra = [];
  if ((gerecht.tags || []).includes("nieuw")) extra.push("✨ nieuw");
  if ((gerecht.tags || []).includes("probeerrecept")) extra.push("🧪 probeersel");
  const alles = [...extra, ...badges];
  if (alles.length === 0) return null;
  const wrap = maakEl("div", "tag-badges");
  for (const t of alles) wrap.appendChild(maakEl("span", "tag-badge", t));
  return wrap;
}

function bouwGerechtKaart(dag, index) {
  const kaart = maakEl("section", "kaart");
  kaart.appendChild(bouwDagKop(dag, index));

  const huidigGerecht = staat.receptenboek ? staat.receptenboek.find((g) => g.naam === dag.naam) : null;
  const tagBadges = bouwTagBadges(huidigGerecht);
  if (tagBadges) kaart.appendChild(tagBadges);

  const pool = POOL_VOOR_CATEGORIE[dag.categorie](staat.pools);
  const vleesOpties = VLEES_VOLGORDE.filter((v) => pool.some((g) => (g.vlees || "overig") === v)).map((v) => ({
    sleutel: `vlees:${v}`,
    label: VLEES_LABELS[v],
  }));
  const tagsInPool = new Set();
  pool.forEach((g) => (g.tags || []).forEach((t) => tagsInPool.add(t)));
  const tagOpties = TAG_VOCABULAIRE.filter((t) => tagsInPool.has(t)).map((t) => ({ sleutel: `tag:${t}`, label: t }));
  const alleOpties = [...vleesOpties, ...tagOpties];

  if (staat.filters[dag.categorie] === undefined) staat.filters[dag.categorie] = "alle";
  const huidigFilter = staat.filters[dag.categorie];

  const chipsEl = maakEl("div", "chips");
  chipsEl.appendChild(
    maakKnop("chip" + (huidigFilter === "alle" ? " actief" : ""), "Alles", () => {
      staat.filters[dag.categorie] = "alle";
      renderWeekmenu();
    })
  );
  for (const optie of alleOpties) {
    chipsEl.appendChild(
      maakKnop("chip" + (huidigFilter === optie.sleutel ? " actief" : ""), optie.label, () => {
        staat.filters[dag.categorie] = optie.sleutel;
        renderWeekmenu();
      })
    );
  }
  kaart.appendChild(chipsEl);

  const lijstEl = maakEl("div", "gerecht-lijst");
  const zichtbaar =
    huidigFilter === "alle"
      ? pool
      : pool.filter((g) => {
          if (huidigFilter.startsWith("vlees:")) return (g.vlees || "overig") === huidigFilter.slice(6);
          if (huidigFilter.startsWith("tag:")) return (g.tags || []).includes(huidigFilter.slice(4));
          return true;
        });
  for (const gerecht of zichtbaar) {
    const rij = document.createElement("button");
    rij.type = "button";
    rij.className = "gerecht-rij" + (gerecht.naam === dag.naam ? " gekozen" : "");
    rij.appendChild(maakEl("span", "bolletje"));
    rij.appendChild(document.createTextNode(gerecht.naam));
    rij.onclick = () => {
      staat.weekmenu[index] = gerechtDagEntry(dag.dag, dag.categorie, gerecht, dag.personen || 2);
      staat.ingredientenOpen.delete(index);
      ververs();
    };
    lijstEl.appendChild(rij);
  }
  if (zichtbaar.length === 0) {
    lijstEl.appendChild(maakEl("div", "std-footnote", "Geen gerechten met dit label — kies 'Alles' of voeg er zelf een toe."));
  }
  kaart.appendChild(lijstEl);

  const acties = maakEl("div", "kaart-acties");
  acties.appendChild(
    maakKnop("secundair", "🔀 Verras me", () => {
      herkiesDag(staat.weekmenu, index, staat.pools, staat.dagOpties, staat.evenWeek, staat.geschiedenis);
      staat.ingredientenOpen.delete(index);
      ververs();
    })
  );
  acties.appendChild(maakKnop("secundair", "Kies zelf recept", () => toonZoekveld(kaart, index)));
  acties.appendChild(maakKnop("secundair", "+ Nieuw gerecht", () => toonNieuwGerechtForm(kaart, index)));
  kaart.appendChild(acties);

  bouwIngredientenSectie(kaart, dag, index);

  return kaart;
}

const COMBI_CONFIG = {
  dinsdag: {
    groepen: [
      { key: "aardappel", label: "Aardappelvorm", opties: (d) => d.dinsdag_aardappel },
      { key: "vlees", label: "Vlees", opties: (d) => d.dinsdag_vlees },
      { key: "groente", label: "Groente", opties: (d) => d.groente },
    ],
    samenstellen: samenstellenDinsdag,
  },
  vrijdag_klein: {
    groepen: [
      { key: "vlees", label: "Vlees", opties: (d) => d.vrijdag_vlees_klein },
      { key: "groente", label: "Groente", opties: (d) => d.groente },
    ],
    samenstellen: samenstellenVrijdagKlein,
  },
  zaterdag_klein: {
    groepen: [
      { key: "vlees", label: "Vlees", opties: (d) => d.vrijdag_vlees_klein },
      { key: "groente", label: "Groente", opties: (d) => d.groente },
    ],
    samenstellen: samenstellenZaterdagKlein,
  },
  zondag: {
    groepen: [{ key: "snacks", label: "Snack (tik er 1 of meerdere aan)", opties: (d) => d.zondag_snack, meerkeuze: true }],
    samenstellen: samenstellenZondag,
    vast: "🍟 Patat (airfryer) — altijd erbij",
  },
};

function bouwCombiKaart(dag, index) {
  const config = COMBI_CONFIG[dag.categorie];
  const kaart = maakEl("section", "kaart");
  kaart.appendChild(bouwDagKop(dag, index));

  if (config.vast) {
    const groep = maakEl("div", "combi-groep");
    groep.appendChild(maakEl("div", "vast-item", config.vast));
    kaart.appendChild(groep);
  }

  for (const groep of config.groepen) {
    const groepEl = maakEl("div", "combi-groep");
    groepEl.appendChild(maakEl("div", "combi-label", groep.label));

    const chipsEl = maakEl("div", "chips");
    const opties = groep.opties(staat.dagOpties) || [];
    const huidig = dag.onderdelen ? dag.onderdelen[groep.key] : null;
    for (const optie of opties) {
      const actief = groep.meerkeuze ? (huidig || []).some((h) => h.naam === optie.naam) : huidig && huidig.naam === optie.naam;
      const chip = maakKnop("chip" + (actief ? " actief" : ""), optie.naam, () => {
        let nieuweWaarde;
        if (groep.meerkeuze) {
          const huidigeLijst = dag.onderdelen[groep.key] || [];
          const algeselecteerd = huidigeLijst.some((h) => h.naam === optie.naam);
          nieuweWaarde = algeselecteerd ? huidigeLijst.filter((h) => h.naam !== optie.naam) : [...huidigeLijst, optie];
        } else {
          nieuweWaarde = optie;
        }
        const nieuweOnderdelen = { ...dag.onderdelen, [groep.key]: nieuweWaarde };
        staat.weekmenu[index] = config.samenstellen(nieuweOnderdelen);
        staat.ingredientenOpen.delete(index);
        ververs();
      });
      chipsEl.appendChild(chip);
    }
    groepEl.appendChild(chipsEl);
    kaart.appendChild(groepEl);
  }

  const acties = maakEl("div", "kaart-acties");
  acties.appendChild(
    maakKnop("secundair", "🔀 Verras me", () => {
      herkiesDag(staat.weekmenu, index, staat.pools, staat.dagOpties, staat.evenWeek, staat.geschiedenis);
      staat.ingredientenOpen.delete(index);
      ververs();
    })
  );
  kaart.appendChild(acties);

  bouwIngredientenSectie(kaart, dag, index);

  return kaart;
}

function toonZoekveld(kaart, index) {
  if (kaart.querySelector(".zoekveld")) return; // al open

  const zoekveld = document.createElement("input");
  zoekveld.type = "text";
  zoekveld.className = "zoekveld";
  zoekveld.placeholder = "Typ een receptnaam...";
  zoekveld.style.marginTop = "8px";

  const resultatenEl = maakEl("div", "zoekresultaten");

  zoekveld.oninput = () => {
    resultatenEl.innerHTML = "";
    const matches = zoekReceptenOpNaam(staat.receptenboek, zoekveld.value).slice(0, 8);
    for (const match of matches) {
      const optieKnop = maakKnop("", match.naam, () => {
        const dagLabel = staat.weekmenu[index].dag;
        const categorie = staat.weekmenu[index].categorie;
        const personen = staat.weekmenu[index].personen || 2;
        staat.weekmenu[index] = gerechtDagEntry(dagLabel, categorie, match, personen);
        staat.ingredientenOpen.delete(index);
        ververs();
      });
      resultatenEl.appendChild(optieKnop);
    }
  };

  kaart.appendChild(zoekveld);
  kaart.appendChild(resultatenEl);
  zoekveld.focus();
}

function toonNieuwGerechtForm(kaart, index) {
  if (kaart.querySelector(".nieuw-gerecht-form")) return; // al open

  const form = maakEl("div", "nieuw-gerecht-form");

  const naamVeld = document.createElement("input");
  naamVeld.type = "text";
  naamVeld.placeholder = "Naam van het gerecht";

  const vleesVeld = document.createElement("select");
  for (const v of VLEES_VOLGORDE) {
    const optie = document.createElement("option");
    optie.value = v;
    optie.textContent = VLEES_LABELS[v];
    vleesVeld.appendChild(optie);
  }

  const ingredientenVeld = document.createElement("textarea");
  ingredientenVeld.placeholder = "Ingrediënten, één per regel, bijv.:\n1 x kipfilet\n2 x paprika";

  const foutEl = maakEl("div", "foutmelding");

  const opslaanKnop = maakKnop("", "Toevoegen aan receptenboek en kiezen", () => {
    const naam = naamVeld.value.trim();
    const vlees = vleesVeld.value;
    const ingredienten = ingredientenVeld.value
      .split("\n")
      .map((r) => r.trim())
      .filter(Boolean);

    if (!naam || ingredienten.length === 0) {
      foutEl.textContent = "Vul een naam en minstens 1 ingrediënt in.";
      return;
    }

    const categorie = staat.weekmenu[index].categorie;
    const personen = staat.weekmenu[index].personen || 2;
    const nieuwGerecht = {
      naam,
      label: LABEL_VOOR_CATEGORIE[categorie] ?? null,
      vlees,
      basisPersonen: personen,
      tags: ["nieuw", "probeerrecept"],
      actief: true,
      ingredienten,
    };

    staat.receptenboek.push(nieuwGerecht);
    staat.receptenboekGewijzigd = true;
    staat.pools = bepaalPools(staat.receptenboek);

    const dagLabel = staat.weekmenu[index].dag;
    staat.weekmenu[index] = gerechtDagEntry(dagLabel, categorie, nieuwGerecht, personen);
    staat.ingredientenOpen.delete(index);
    ververs();
  });

  form.appendChild(naamVeld);
  form.appendChild(vleesVeld);
  form.appendChild(ingredientenVeld);
  form.appendChild(opslaanKnop);
  form.appendChild(foutEl);
  kaart.appendChild(form);
  naamVeld.focus();
}

// --- Receptenboek beheren (bewerken/verwijderen van bestaande gerechten) ---

function verversWeekmenuEntriesVoorGerecht(oudeNaam, gerecht) {
  staat.weekmenu.forEach((dag, i) => {
    if (dag.naam === oudeNaam) {
      staat.weekmenu[i] = gerechtDagEntry(dag.dag, dag.categorie, gerecht, dag.personen);
    }
  });
}

function verwijderRecept(gerecht) {
  if (!confirm(`"${gerecht.naam}" verwijderen uit het receptenboek?`)) return;

  staat.receptenboek = staat.receptenboek.filter((g) => g !== gerecht);
  staat.receptenboekGewijzigd = true;
  staat.pools = bepaalPools(staat.receptenboek);

  staat.weekmenu.forEach((dag, i) => {
    if (dag.naam === gerecht.naam) {
      herkiesDag(staat.weekmenu, i, staat.pools, staat.dagOpties, staat.evenWeek, staat.geschiedenis);
    }
  });
  ververs();
}

function toonReceptBewerkForm(container, gerecht) {
  if (container.querySelector(".recept-bewerk-form")) return;

  const beheerbareTags = ["nieuw", "probeerrecept", "niet-meer-tonen"];

  const form = maakEl("div", "recept-bewerk-form nieuw-gerecht-form");

  const naamVeld = document.createElement("input");
  naamVeld.type = "text";
  naamVeld.value = gerecht.naam;

  const vleesVeld = document.createElement("select");
  for (const v of VLEES_VOLGORDE) {
    const optie = document.createElement("option");
    optie.value = v;
    optie.textContent = VLEES_LABELS[v];
    if ((gerecht.vlees || "overig") === v) optie.selected = true;
    vleesVeld.appendChild(optie);
  }

  const basisPersonenVeld = document.createElement("select");
  for (const p of [2, 4]) {
    const optie = document.createElement("option");
    optie.value = String(p);
    optie.textContent = `Basis: ${p} personen`;
    if ((gerecht.basisPersonen || 2) === p) optie.selected = true;
    basisPersonenVeld.appendChild(optie);
  }

  const tagsVeld = document.createElement("input");
  tagsVeld.type = "text";
  tagsVeld.placeholder = "Tags (komma-gescheiden), bv: snel, bowl";
  tagsVeld.value = (gerecht.tags || []).filter((t) => !beheerbareTags.includes(t)).join(", ");

  const ingredientenVeld = document.createElement("textarea");
  ingredientenVeld.value = gerecht.ingredienten.join("\n");

  const foutEl = maakEl("div", "foutmelding");

  const opslaanKnop = maakKnop("", "Wijzigingen opslaan", () => {
    const naam = naamVeld.value.trim();
    const ingredienten = ingredientenVeld.value
      .split("\n")
      .map((r) => r.trim())
      .filter(Boolean);

    if (!naam || ingredienten.length === 0) {
      foutEl.textContent = "Vul een naam en minstens 1 ingrediënt in.";
      return;
    }

    const oudeNaam = gerecht.naam;
    gerecht.naam = naam;
    gerecht.vlees = vleesVeld.value;
    gerecht.basisPersonen = parseInt(basisPersonenVeld.value, 10) || 2;
    const nieuweTags = tagsVeld.value
      .split(",")
      .map((t) => t.trim().toLowerCase())
      .filter(Boolean);
    const behoudenTags = (gerecht.tags || []).filter((t) => beheerbareTags.includes(t));
    gerecht.tags = [...new Set([...behoudenTags, ...nieuweTags])];
    gerecht.ingredienten = ingredienten;

    staat.receptenboekGewijzigd = true;
    staat.pools = bepaalPools(staat.receptenboek);
    verversWeekmenuEntriesVoorGerecht(oudeNaam, gerecht);
    ververs();
  });

  const annuleerKnop = maakKnop("secundair", "Annuleren", () => ververs());

  form.appendChild(naamVeld);
  form.appendChild(vleesVeld);
  form.appendChild(basisPersonenVeld);
  form.appendChild(tagsVeld);
  form.appendChild(ingredientenVeld);
  form.appendChild(opslaanKnop);
  form.appendChild(annuleerKnop);
  form.appendChild(foutEl);
  container.appendChild(form);
}

function renderReceptenbeheer() {
  receptenbeheerEl.innerHTML = "";
  if (!staat.receptenboek) return;

  receptenbeheerEl.appendChild(
    maakKnop(
      "receptenbeheer-toggle",
      `${staat.receptenbeheerOpen ? "▾" : "▸"} Receptenboek beheren (${staat.receptenboek.length})`,
      () => {
        staat.receptenbeheerOpen = !staat.receptenbeheerOpen;
        ververs();
      }
    )
  );

  if (!staat.receptenbeheerOpen) return;

  const groepen = [
    { naam: "Maandag — snel/makkelijk", filter: (g) => g.label === "makkelijk" },
    { naam: "Vrijdag/zaterdag — 4 personen", filter: (g) => g.label === "vrijdag_veel" },
    { naam: "Woensdag/donderdag — algemeen", filter: (g) => g.label === null && g.actief },
    { naam: "Inactief / naslag", filter: (g) => !g.actief },
  ];

  const lijst = maakEl("div", "receptenbeheer-lijst");
  for (const groep of groepen) {
    const gerechten = staat.receptenboek.filter(groep.filter);
    if (gerechten.length === 0) continue;
    lijst.appendChild(maakEl("div", "receptenbeheer-groep-kop", groep.naam));

    for (const gerecht of gerechten) {
      const rij = maakEl("div", "receptenbeheer-rij");

      const infoKolom = maakEl("div", "receptenbeheer-info");
      const naamRij = maakEl("div", "receptenbeheer-naam", gerecht.naam);
      infoKolom.appendChild(naamRij);
      const details = [gerecht.vlees ? VLEES_LABELS[gerecht.vlees] || gerecht.vlees : null, ...(gerecht.tags || [])]
        .filter(Boolean)
        .join(" · ");
      if (details) infoKolom.appendChild(maakEl("div", "receptenbeheer-detail", details));
      rij.appendChild(infoKolom);

      const knoppen = maakEl("div", "receptenbeheer-knoppen");
      knoppen.appendChild(maakKnop("secundair", "Bewerken", () => toonReceptBewerkForm(lijst, gerecht)));
      knoppen.appendChild(maakKnop("secundair", "Verwijderen", () => verwijderRecept(gerecht)));
      rij.appendChild(knoppen);

      lijst.appendChild(rij);
    }
  }
  receptenbeheerEl.appendChild(lijst);
}

// --- Gerecht-waardering (lekker / oké / niet meer) ---

const RATEERBARE_CATEGORIEEN = ["maandag", "woensdag", "donderdag", "vrijdag_veel", "zaterdag_veel"];

function rateerbareGerechten(weekmenu) {
  const set = new Set();
  for (const dag of weekmenu) {
    if (RATEERBARE_CATEGORIEEN.includes(dag.categorie)) set.add(dag.naam);
  }
  return [...set];
}

function renderBeoordelingBlok() {
  beoordelingBlokEl.innerHTML = "";
  if (!staat.laatsteWeekmenu || !staat.laatsteWeekmenu.gerechten) return;

  const openstaand = staat.laatsteWeekmenu.gerechten.filter((naam) => {
    const b = staat.beoordelingen[naam];
    if (!b || !b.laatst) return true;
    return new Date(b.laatst) < new Date(staat.laatsteWeekmenu.datum);
  });
  if (openstaand.length === 0) return;

  const kaart = maakEl("section", "kaart beoordeling-kaart");
  kaart.appendChild(maakEl("div", "dag-eyebrow", "Hoe was het vorige week?"));
  for (const naam of openstaand) {
    const rij = maakEl("div", "beoordeling-rij");
    rij.appendChild(maakEl("span", "beoordeling-naam", naam));
    const knoppen = maakEl("div", "beoordeling-knoppen");
    knoppen.appendChild(maakKnop("beoordeling-knop", "👍 Lekker", () => beoordeelGerecht(naam, "lekker")));
    knoppen.appendChild(maakKnop("beoordeling-knop", "🙂 Oké", () => beoordeelGerecht(naam, "oke")));
    knoppen.appendChild(maakKnop("beoordeling-knop", "👎 Niet meer", () => beoordeelGerecht(naam, "niet_meer")));
    rij.appendChild(knoppen);
    kaart.appendChild(rij);
  }
  beoordelingBlokEl.appendChild(kaart);
}

async function beoordeelGerecht(naam, waarde) {
  const bestaand = staat.beoordelingen[naam] || { lekker: 0, oke: 0, niet_meer: 0 };
  bestaand[waarde] = (bestaand[waarde] || 0) + 1;
  bestaand.laatst = new Date().toISOString();
  staat.beoordelingen[naam] = bestaand;

  if (waarde === "niet_meer") {
    const gerecht = staat.receptenboek.find((g) => g.naam === naam);
    if (gerecht && !(gerecht.tags || []).includes("niet-meer-tonen")) {
      gerecht.tags = [...(gerecht.tags || []), "niet-meer-tonen"];
      staat.receptenboekGewijzigd = true;
      staat.pools = bepaalPools(staat.receptenboek);
    }
  }

  ververs();

  try {
    await githubPutFile(
      "gerecht_beoordelingen.json",
      JSON.stringify(staat.beoordelingen, null, 2),
      `Beoordeling opgeslagen: ${naam} (${waarde})`
    );
    if (staat.receptenboekGewijzigd) {
      await githubPutFile("receptenboek.txt", herbouwReceptenboekTekst(), "Gerecht gemarkeerd als 'niet meer' na beoordeling");
      staat.receptenboekGewijzigd = false;
    }
  } catch (e) {
    // Best-effort: de beoordeling blijft lokaal zichtbaar deze sessie, ook
    // als het opslaan naar GitHub een keer mislukt.
  }
}

// --- Extra producten ---

function renderLosseProducten() {
  losseLijstEl.innerHTML = "";
  staat.losseProducten.forEach((item, i) => {
    const rij = maakEl("div", "losse-item");
    rij.appendChild(maakEl("span", "", `${item.aantal} x ${item.naam}`));
    rij.appendChild(
      maakKnop("", "✕", () => {
        staat.losseProducten.splice(i, 1);
        ververs();
      })
    );
    losseLijstEl.appendChild(rij);
  });
}

document.getElementById("los-toevoegen-knop").onclick = () => {
  const naam = losNaamEl.value.trim();
  const aantal = parseInt(losAantalEl.value, 10) || 1;
  if (!naam) return;
  staat.losseProducten.push({ naam, aantal });
  losNaamEl.value = "";
  losAantalEl.value = "1";
  ververs();
  losNaamEl.focus();
};

document.getElementById("controle-los-toevoegen-knop").onclick = () => {
  const naam = controleLosNaamEl.value.trim();
  const aantal = parseInt(controleLosAantalEl.value, 10) || 1;
  if (!naam || !staat.productVoorstellen) return;

  // Al in de lijst (evt. eerder verwijderd)? Dan gewoon het aantal bijwerken
  // en terugzetten, i.p.v. een dubbele regel te maken.
  const bestaandeSleutel = Object.keys(staat.productVoorstellen).find(
    (k) => k.toLowerCase() === naam.toLowerCase()
  );
  if (bestaandeSleutel) {
    const info = staat.productVoorstellen[bestaandeSleutel];
    info.aantal = aantal;
    info.verwijderd = false;
  } else {
    staat.productVoorstellen[naam] = { aantal, kandidaten: [], nieuw: true };
  }

  controleLosNaamEl.value = "";
  controleLosAantalEl.value = "1";
  renderControleScherm();
  controleLosNaamEl.focus();
};

// --- Kassabon (voorvertoning) ---

function gekozenStandaardProducten() {
  return staat.standaardlijst.filter((item) => !staat.standaardUitgevinkt.has(item.naam.toLowerCase()));
}

// De volledige conceptlijst (menselijke boodschappen — "2 x ui", nog geen
// concreet Picnic-product) hoort niet meer permanent op het Aanvullen-
// scherm te staan (dat maakte dat scherm te druk) en toont bewust geen
// bedrag meer (dat kon voor deze stap nooit meer dan een educated guess
// zijn — zie renderOverzicht/renderControleScherm voor waar een bedrag wél
// op echte, actuele Picnic-prijzen is gebaseerd). Deze functie berekent
// alleen de compacte samenvatting op het Aanvullen-scherm zelf; de volledige
// lijst wordt pas opgebouwd (zie toonVolledigeLijstModal) op het moment dat
// de gebruiker "Volledige lijst bekijken" aantikt.
function huidigeBoodschappenTotalen() {
  const producten = [...gekozenStandaardProducten(), ...voorraadTeBestellen(), ...staat.losseProducten];
  return berekenTotalen(staat.weekmenu, producten, voorraadArtikelNamen(staat.voorraadCategorieen));
}

function renderBoodschappenlijstSamenvatting() {
  if (!aanvullenLijstSamenvattingEl) return;
  const aantal = huidigeBoodschappenTotalen().length;
  aanvullenLijstSamenvattingEl.textContent = aantal > 0 ? `${aantal} product${aantal === 1 ? "" : "en"} geselecteerd` : "Nog geen producten geselecteerd";
  if (lijstModalEl && !lijstModalEl.classList.contains("verborgen")) renderVolledigeLijstModalInhoud();
}

function renderVolledigeLijstModalInhoud() {
  if (!lijstModalInhoudEl) return;
  const totalen = huidigeBoodschappenTotalen();
  lijstModalInhoudEl.innerHTML = "";
  if (totalen.length === 0) {
    lijstModalInhoudEl.appendChild(maakEl("div", "std-footnote", "Nog geen boodschappen geselecteerd."));
    return;
  }
  for (const { naam, aantal } of totalen) {
    const rij = maakEl("div", "bon-rij");
    rij.appendChild(maakEl("span", "bon-naam", naam));
    rij.appendChild(maakEl("span", "bon-aantal", `${aantal}×`));
    lijstModalInhoudEl.appendChild(rij);
  }
}

function toonVolledigeLijstModal() {
  if (!lijstModalEl) return;
  renderVolledigeLijstModalInhoud();
  lijstModalEl.classList.remove("verborgen");
}

function verbergVolledigeLijstModal() {
  if (lijstModalEl) lijstModalEl.classList.add("verborgen");
}

if (aanvullenLijstKnop) aanvullenLijstKnop.onclick = toonVolledigeLijstModal;
if (lijstModalSluitKnop) lijstModalSluitKnop.onclick = verbergVolledigeLijstModal;
if (lijstModalEl) {
  lijstModalEl.onclick = (e) => {
    if (e.target === lijstModalEl) verbergVolledigeLijstModal();
  };
}

function toonWaarschuwingenNaBestelling() {
  waarschuwingenEl.innerHTML = "";
  const nietGevonden = staat.laatsteBestelling ? staat.laatsteBestelling.niet_gevonden || [] : [];
  if (nietGevonden.length === 0) return;

  const waarschuwing = maakEl("div", "waarschuwing");
  waarschuwing.innerHTML =
    `⚠️ <span><strong>${nietGevonden.length} product${nietGevonden.length === 1 ? "" : "en"} niet gevonden:</strong> ` +
    `${nietGevonden.map(escapeHtml).join(", ")} — voeg ze zelf toe in de Picnic-app.</span>`;
  waarschuwingenEl.appendChild(waarschuwing);
}

// --- Controle-scherm (productkeuzes na het zoeken) ---

// --- Productvoorkeuren (client-kant): gerecht-specifieke default-selectie,
// mismatch-detectie en het opslaan van een expliciete voorkeur. De
// algemene voorkeur (tier 2/3) staat al vooraan in de kandidatenlijst
// zelf — dat doet picnic_boodschappen.py bij het zoeken. ---

function normaliseerIngredientNaam(naam) {
  return naam.toLowerCase().replace(/[^a-z0-9]/g, "");
}

// Zet, waar van toepassing, de standaard-geselecteerde kandidaat op basis
// van een gerecht-specifieke voorkeur (tier 1) — de enige tier die nog niet
// al server-side is toegepast op de volgorde van de kandidatenlijst.
function pasProductVoorkeurenToe() {
  const voorkeuren = staat.productVoorkeuren || {};
  const gerechtVoorkeuren = voorkeuren.gerecht_ingredient || {};
  if (Object.keys(gerechtVoorkeuren).length === 0) return;

  for (const naam in staat.productVoorstellen) {
    const info = staat.productVoorstellen[naam];
    const kandidaten = info.kandidaten || [];
    if (kandidaten.length === 0) continue;

    const naamNorm = normaliseerIngredientNaam(naam);
    let voorkeurId = null;
    for (const dag of staat.weekmenu) {
      const sleutel = `${dag.naam}|${naamNorm}`;
      if (gerechtVoorkeuren[sleutel]) {
        voorkeurId = gerechtVoorkeuren[sleutel].id;
        break;
      }
    }
    if (!voorkeurId) continue;
    const idx = kandidaten.findIndex((k) => k.id === voorkeurId);
    if (idx !== -1) staat.productKeuzeIndex[naam] = idx;
  }
}

function heeftVoorkeurMismatch(naam, gekozen) {
  if (!gekozen) return false;
  const voorkeur = (staat.productVoorkeuren?.ingredient || {})[normaliseerIngredientNaam(naam)];
  return !!(voorkeur && voorkeur.id && voorkeur.id !== gekozen.id);
}

// Voorkeuren zijn volledig zelflerend: elke definitieve bestelling wordt
// automatisch de nieuwe standaardkeuze (zie bevestigBestelling +
// _leer_voorkeur in picnic_boodschappen.py) — er is dus geen aparte
// "opslaan"-actie meer nodig. Het enige wat je soms nog wil is het
// omgekeerde: deze ene keer bewust iets anders bestellen zonder dat dát de
// nieuwe standaard wordt. Dat regelt onderstaande vlag, die meegaat in
// gekozen_producten.json en daar de auto-leerslag overslaat.
function wisselAlleenDezeKeer(naam, info) {
  info.alleenDezeKeer = !info.alleenDezeKeer;
  renderControleScherm();
}

// --- Controle-scherm ---

function vervangProduct(naam, info) {
  info.verwijderd = true;
  controleLosNaamEl.value = naam;
  controleLosAantalEl.value = String(info.aantal || 1);
  renderControleScherm();
  controleLosNaamEl.scrollIntoView({ behavior: "smooth", block: "center" });
  controleLosNaamEl.focus();
}

function bouwControleItem(naam, info, compact, isWeekmenuIngredient) {
  const kandidaten = info.kandidaten || [];
  const idx = staat.productKeuzeIndex[naam] ?? 0;
  const gekozen = kandidaten[idx];

  const item = maakEl("div", "controle-item" + (compact ? " compact" : ""));

  const kop = maakEl("div", "controle-kop");
  kop.appendChild(maakEl("span", "", `${info.aantal}× ${naam}`));
  kop.appendChild(
    maakKnop("ingredient-verwijder", "✕", () => {
      info.verwijderd = true;
      renderControleScherm();
    })
  );
  item.appendChild(kop);

  const stepper = maakEl("div", "stepper");
  stepper.appendChild(
    maakKnop("stap-knop", "–", () => {
      info.aantal = Math.max(1, info.aantal - 1);
      renderControleScherm();
    })
  );
  stepper.appendChild(maakEl("span", "stepper-waarde", `${info.aantal}×`));
  stepper.appendChild(
    maakKnop("stap-knop", "+", () => {
      info.aantal += 1;
      renderControleScherm();
    })
  );
  item.appendChild(stepper);

  if (!gekozen) {
    const bericht = info.nieuw
      ? "Nog niet opgezocht — wordt automatisch bij Picnic gezocht op het moment van bestellen."
      : "Niet gevonden bij Picnic — voeg dit later zelf toe in de Picnic-app.";
    item.appendChild(maakEl("div", "controle-fout" + (info.nieuw ? " nieuw" : ""), bericht));
    const acties = maakEl("div", "controle-acties");
    acties.appendChild(maakKnop("secundair", "🔍 Ander product zoeken", () => toonZoekBox(item, naam, info)));
    item.appendChild(acties);
  } else {
    const resultaat = maakEl("div", "controle-resultaat");

    if (gekozen.image_url) {
      const img = document.createElement("img");
      img.src = gekozen.image_url;
      img.className = "controle-afbeelding";
      img.alt = gekozen.naam;
      resultaat.appendChild(img);
    }

    const infoKolom = maakEl("div", "controle-info");
    infoKolom.appendChild(maakEl("div", "controle-naam", gekozen.naam));
    if (gekozen.subtitle) {
      infoKolom.appendChild(maakEl("div", "controle-detail", gekozen.subtitle));
    }
    if (typeof gekozen.prijs_cent === "number") {
      infoKolom.appendChild(maakEl("div", "controle-prijs", `€${(gekozen.prijs_cent / 100).toFixed(2)}`));
    }
    if (heeftVoorkeurMismatch(naam, gekozen)) {
      infoKolom.appendChild(maakEl("div", "controle-mismatch", "⚠ niet je gebruikelijke keuze"));
    }
    const teBestellen = bepaalTeBestellenAantal(info.aantal, gekozen, isWeekmenuIngredient);
    if (teBestellen !== info.aantal) {
      infoKolom.appendChild(
        maakEl(
          "div",
          "controle-verpakking",
          `${info.aantal} nodig → ${teBestellen}× besteld (verpakking van ${verpakkingsGrootte(gekozen.subtitle)} stuks)`
        )
      );
    }
    resultaat.appendChild(infoKolom);
    item.appendChild(resultaat);

    const acties = maakEl("div", "controle-acties");
    if (kandidaten.length > 1) {
      acties.appendChild(maakKnop("secundair", "Andere optie kiezen", () => toonAlternatieven(item, naam, kandidaten, idx)));
    }
    acties.appendChild(maakKnop("secundair", "🔍 Ander product zoeken", () => toonZoekBox(item, naam, info)));
    acties.appendChild(maakKnop("secundair", "Vervangen", () => vervangProduct(naam, info)));
    acties.appendChild(maakKnop("secundair", "Parkeren", () => {
      info.geparkeerd = true;
      renderControleScherm();
    }));
    acties.appendChild(
      maakKnop(
        "secundair" + (info.alleenDezeKeer ? " actief" : ""),
        info.alleenDezeKeer ? "✓ Alleen deze keer" : "Alleen deze keer",
        () => wisselAlleenDezeKeer(naam, info)
      )
    );
    item.appendChild(acties);
  }

  return item;
}

// --- Live zoeken naar een ander product (met afbeelding) via de
// bestaande zoek_producten.yml-actie, met een losse zoekterm i.p.v. de
// hele boodschappenlijst. Duurt ~15-30 sec (workflow moet opstarten). ---

function toonZoekBox(item, naam, info) {
  if (item.querySelector(".zoek-box")) return;

  const box = maakEl("div", "zoek-box");
  const rij = maakEl("div", "zoek-box-rij");
  const invoer = document.createElement("input");
  invoer.type = "text";
  invoer.className = "zoek-box-invoer";
  invoer.value = naam;
  invoer.placeholder = "Zoekterm bij Picnic";
  rij.appendChild(invoer);

  const status = maakEl("div", "zoek-box-status");
  const resultaten = maakEl("div", "zoek-box-resultaten");

  const zoekKnop = maakKnop("secundair", "Zoeken bij Picnic", async () => {
    const term = invoer.value.trim();
    if (!term) return;
    zoekKnop.disabled = true;
    resultaten.innerHTML = "";
    await zoekAndereOptie(naam, info, term, status, resultaten);
    zoekKnop.disabled = false;
  });
  rij.appendChild(zoekKnop);

  box.appendChild(rij);
  box.appendChild(status);
  box.appendChild(resultaten);
  item.appendChild(box);
  invoer.focus();
}

async function zoekAndereOptie(naam, info, zoekterm, statusEl, resultatenEl) {
  const startTijd = new Date();
  statusEl.textContent = "Zoeken bij Picnic gestart (kan ~20-30 sec duren)...";
  try {
    await dispatchWorkflow(ZOEKEN_WORKFLOW, { losse_zoekterm: zoekterm });
    const run = await volgWorkflow(ZOEKEN_WORKFLOW, startTijd, statusEl, "Zoeken bij Picnic...");
    if (!run || run.conclusion !== "success") {
      statusEl.textContent = run
        ? "Zoeken is mislukt — probeer het nog eens."
        : "Kon de status niet vinden — probeer het nog eens.";
      return;
    }
    const tekst = await haalTekstBestandViaApi("losse_zoekresultaten.json");
    const resultaat = tekst ? JSON.parse(tekst) : {};
    if (resultaat.zoekterm && resultaat.zoekterm !== zoekterm) {
      statusEl.textContent = "Kreeg resultaten van een andere zoekopdracht terug — probeer nog eens.";
      return;
    }
    statusEl.textContent = "";
    toonZoekResultaten(resultatenEl, naam, info, resultaat.kandidaten || []);
  } catch (e) {
    statusEl.textContent = "Er ging iets mis: " + e.message;
  }
}

function toonZoekResultaten(resultatenEl, naam, info, kandidaten) {
  resultatenEl.innerHTML = "";
  if (kandidaten.length === 0) {
    resultatenEl.appendChild(maakEl("div", "controle-fout", `Niets gevonden voor deze zoekterm.`));
    return;
  }

  const lijst = maakEl("div", "alternatieven");
  kandidaten.forEach((k) => {
    const wrapper = maakEl("div", "alternatieven-item");
    if (k.image_url) {
      const img = document.createElement("img");
      img.src = k.image_url;
      img.className = "alternatieven-img";
      img.alt = k.naam;
      wrapper.appendChild(img);
    }
    const text = maakEl("div", "alternatieven-text");
    text.appendChild(maakEl("div", "", k.naam));
    if (k.subtitle) text.appendChild(maakEl("div", "alternatieven-detail", k.subtitle));
    if (typeof k.prijs_cent === "number") {
      text.appendChild(maakEl("div", "alternatieven-prijs", `€${(k.prijs_cent / 100).toFixed(2)}`));
    }
    wrapper.appendChild(text);

    const knop = maakKnop("", "", () => {
      info.kandidaten = [k, ...(info.kandidaten || []).filter((x) => x.id !== k.id)];
      staat.productKeuzeIndex[naam] = 0;
      info.nieuw = false;
      info.verwijderd = false;
      toonToast(`✓ Gewisseld naar: ${k.naam}`);
      renderControleScherm();
    });
    knop.className = "";
    knop.appendChild(wrapper);
    knop.style.display = "block";
    knop.style.width = "100%";
    knop.style.marginBottom = "8px";
    knop.style.textAlign = "left";
    lijst.appendChild(knop);
  });
  resultatenEl.appendChild(lijst);
}

// Dag-kop boven een groep controle-items: gerecht + een indicator of alles
// voor die dag al gecontroleerd is + een knop om in één keer alle
// ingrediënten van die dag uit de bestelling te halen (bv. "we koken
// donderdag toch niet").
function bouwControleDagKop(dag, dagNamen, aandachtPerNaam, herkomst, items) {
  const dagLabel = dag.dag.replace(/\s*\(\d+p\)/, "");

  const kop = maakEl("div", "controle-dag-kop");
  const titel = maakEl("div", "controle-dag-titel");
  titel.appendChild(maakEl("span", "controle-dag-naam", `${dagLabel} · ${dag.naam}`));
  const heeftAandacht = dagNamen.some((naam) => aandachtPerNaam[naam]);
  titel.appendChild(
    maakEl("span", "controle-dag-status" + (heeftAandacht ? " let-op" : " compleet"), heeftAandacht ? "⚠ nog checken" : "✓ compleet")
  );
  kop.appendChild(titel);

  kop.appendChild(
    maakKnop("secundair dag-verwijder", `🗑 Geen eten op ${dagLabel.toLowerCase()}`, () => {
      if (!confirm(`Alle ingrediënten voor ${dagLabel} (${dag.naam}) uit deze bestelling halen?`)) return;
      for (const naam of dagNamen) {
        const info = items[naam];
        const entry = herkomst.get(naam.toLowerCase());
        const dagAantal = entry ? entry.dagen.get(dag.dag) || 0 : info.aantal;
        info.aantal -= dagAantal;
        if (info.aantal <= 0) {
          info.aantal = 0;
          info.verwijderd = true;
        }
      }
      toonToast(`✓ Eten voor ${dagLabel} verwijderd uit de bestelling`);
      renderControleScherm();
    })
  );

  return kop;
}

function renderControleScherm() {
  controleLijstEl.innerHTML = "";
  const items = staat.productVoorstellen || {};
  const namen = Object.keys(items);

  if (namen.length === 0) {
    controleLijstEl.appendChild(maakEl("div", "std-footnote", "Geen producten om te controleren."));
    return;
  }

  const actief = [];
  const geparkeerdOfVerwijderd = [];
  for (const naam of namen) {
    const info = items[naam];
    if (info.verwijderd || info.geparkeerd) {
      geparkeerdOfVerwijderd.push(naam);
    } else {
      actief.push(naam);
    }
  }

  // Herkomst (welke dag gebruikt welk ingrediënt) bepaalt ook of "aantal"
  // hier "stuks nodig voor een gerecht" betekent (weekmenu-ingrediënt, dan
  // is de verpakkingsgrootte-correctie van toepassing) of "aantal
  // verpakkingen" (vaste boodschappen/voorraad, dan niet — zie
  // bepaalTeBestellenAantal).
  const herkomst = berekenIngredientHerkomst(staat.weekmenu);
  const isWeekmenuIngredient = (naam) => herkomst.has(naam.toLowerCase());

  let totaalCent = 0;
  let onbekendePrijs = false;
  const aandachtPerNaam = {};

  for (const naam of actief) {
    const info = items[naam];
    const kandidaten = info.kandidaten || [];
    const idx = staat.productKeuzeIndex[naam] ?? 0;
    const gekozen = kandidaten[idx];

    if (gekozen && typeof gekozen.prijs_cent === "number") {
      const teBestellen = bepaalTeBestellenAantal(info.aantal, gekozen, isWeekmenuIngredient(naam));
      totaalCent += gekozen.prijs_cent * teBestellen;
    } else {
      onbekendePrijs = true;
    }

    aandachtPerNaam[naam] = !gekozen || info.nieuw || heeftVoorkeurMismatch(naam, gekozen);
  }

  // Groepeer per dag (maandag t/m zondag, in weekmenu-volgorde) zodat in één
  // oogopslag te zien is of er voor elke dag alles klaarstaat. Een
  // ingrediënt dat door meerdere dagen wordt gebruikt (bv. ui) wordt maar
  // één keer als kaart getoond (bij de eerste dag die het nodig heeft) —
  // maar de dag-kop zelf (status + "verwijder deze dag") blijft voor élke
  // dag zichtbaar die het ingrediënt gebruikt, ook als alle kaarten al bij
  // een eerdere dag staan. Producten zonder dag-herkomst (vaste
  // boodschappen, voorraad, of handmatig toegevoegd in dit scherm) komen in
  // een aparte sectie onderaan.
  const toegewezen = new Set();
  const perDag = staat.weekmenu.map((dag) => {
    const alleNamen = actief.filter((naam) => {
      const entry = herkomst.get(naam.toLowerCase());
      return entry && entry.dagen.has(dag.dag);
    });
    const weergaveNamen = alleNamen.filter((naam) => !toegewezen.has(naam));
    weergaveNamen.forEach((naam) => toegewezen.add(naam));
    return { dag, alleNamen, weergaveNamen };
  });
  const vasteNamen = actief.filter((naam) => !toegewezen.has(naam));

  for (const { dag, alleNamen, weergaveNamen } of perDag) {
    if (alleNamen.length === 0) continue;
    controleLijstEl.appendChild(bouwControleDagKop(dag, alleNamen, aandachtPerNaam, herkomst, items));
    if (weergaveNamen.length === 0) {
      controleLijstEl.appendChild(
        maakEl("div", "controle-dag-gedeeld", "Ingrediënten hiervoor staan al bij een eerdere dag hierboven.")
      );
    } else {
      for (const naam of weergaveNamen) controleLijstEl.appendChild(bouwControleItem(naam, items[naam], !aandachtPerNaam[naam], true));
    }
  }

  if (vasteNamen.length > 0) {
    controleLijstEl.appendChild(maakEl("div", "controle-sectie-kop", "Vaste boodschappen"));
    for (const naam of vasteNamen) controleLijstEl.appendChild(bouwControleItem(naam, items[naam], !aandachtPerNaam[naam], false));
  }

  if (geparkeerdOfVerwijderd.length > 0) {
    controleLijstEl.appendChild(maakEl("div", "controle-sectie-kop", "Niet in deze bestelling"));
    for (const naam of geparkeerdOfVerwijderd) {
      const info = items[naam];
      const rij = maakEl("div", "controle-item verwijderd");
      const kop = maakEl("div", "controle-kop");
      kop.appendChild(maakEl("span", "", `${info.aantal}× ${naam}${info.geparkeerd ? " (geparkeerd)" : ""}`));
      kop.appendChild(
        maakKnop("ingredient-verwijder", "↺ Terugzetten", () => {
          info.verwijderd = false;
          info.geparkeerd = false;
          renderControleScherm();
        })
      );
      rij.appendChild(kop);
      controleLijstEl.appendChild(rij);
    }
  }

  const totaalRij = maakEl("div", "controle-totaal");
  totaalRij.appendChild(maakEl("span", "", "Geschat totaal"));
  totaalRij.appendChild(
    maakEl("span", "controle-totaal-bedrag", `€${(totaalCent / 100).toFixed(2)}${onbekendePrijs ? "+" : ""}`)
  );
  controleLijstEl.appendChild(totaalRij);

  bewaarControleStaat();
}

function toonAlternatieven(item, naam, kandidaten, huidigeIndex) {
  if (item.querySelector(".alternatieven")) return;

  const lijst = maakEl("div", "alternatieven");
  kandidaten.forEach((k, i) => {
    const wrapper = maakEl("div", "alternatieven-item");
    if (i === huidigeIndex) wrapper.classList.add("actief");

    if (k.image_url) {
      const img = document.createElement("img");
      img.src = k.image_url;
      img.className = "alternatieven-img";
      img.alt = k.naam;
      wrapper.appendChild(img);
    }

    const text = maakEl("div", "alternatieven-text");
    text.appendChild(maakEl("div", "", k.naam));
    if (k.subtitle) {
      text.appendChild(maakEl("div", "alternatieven-detail", k.subtitle));
    }
    if (typeof k.prijs_cent === "number") {
      text.appendChild(maakEl("div", "alternatieven-prijs", `€${(k.prijs_cent / 100).toFixed(2)}`));
    }
    wrapper.appendChild(text);

    const knop = maakKnop("", "", () => {
      staat.productKeuzeIndex[naam] = i;
      renderControleScherm();
    });
    knop.className = "";
    knop.innerHTML = "";
    knop.appendChild(wrapper);
    knop.style.display = "block";
    knop.style.width = "100%";
    knop.style.marginBottom = "8px";
    knop.style.textAlign = "left";
    lijst.appendChild(knop);
  });
  item.appendChild(lijst);
}

// --- Laden, zoeken en bestellen ---

async function laadWeekmenuScherm() {
  toonScherm(schermLaden);

  const [
    receptenTekst, dagOptiesTekst, standaardTekst, voorraadTekst, geschiedenisTekst, laatsteTekst,
    beoordelingenTekst, voorkeurenTekst, laatsteWeekmenuTekst,
  ] = await Promise.all([
    haalTekstBestandOp("receptenboek.txt"),
    haalTekstBestandOp("dag_opties.txt"),
    haalTekstBestandOp("standaardlijst.txt"),
    haalTekstBestandOp("voorraad.txt"),
    haalTekstBestandOp("weekmenu_geschiedenis.txt"),
    haalTekstBestandOp("laatste_bestelling.json"),
    haalTekstBestandOp("gerecht_beoordelingen.json"),
    haalTekstBestandOp("product_voorkeuren.json"),
    haalTekstBestandOp("laatste_weekmenu.json"),
  ]);

  staat.receptenboek = laadReceptenboek(receptenTekst);
  staat.receptenboekHeader = receptenboekHeaderUitRuweTekst(receptenTekst);
  staat.receptenboekGewijzigd = false;
  staat.dagOpties = laadDagOpties(dagOptiesTekst);
  staat.standaardCategorieen = laadStandaardlijstPerCategorie(standaardTekst);
  staat.standaardlijst = staat.standaardCategorieen.flatMap((c) => c.items);
  staat.standaardUitgevinkt = new Set();
  staat.standaardlijstGewijzigd = false;
  staat.standaardOpen = false;
  staat.voorraadCategorieen = laadVoorraadCategorieen(voorraadTekst);
  staat.voorraadStatus = {};
  staat.voorraadOpen = false;
  staat.geschiedenis = laadGeschiedenis(geschiedenisTekst);
  staat.evenWeek = isEvenWeek();
  staat.pools = bepaalPools(staat.receptenboek);
  staat.weekmenu = stelWeekmenuSamen(staat.pools, staat.dagOpties, staat.evenWeek, staat.geschiedenis);
  staat.losseProducten = [];
  staat.filters = {};
  staat.ingredientenOpen = new Set();
  staat.receptenbeheerOpen = false;
  staat.productVoorstellen = null;
  staat.productKeuzeIndex = {};
  try {
    staat.laatsteBestelling = laatsteTekst ? JSON.parse(laatsteTekst) : null;
  } catch (e) {
    staat.laatsteBestelling = null;
  }
  try {
    staat.beoordelingen = beoordelingenTekst ? JSON.parse(beoordelingenTekst) : {};
  } catch (e) {
    staat.beoordelingen = {};
  }
  try {
    staat.productVoorkeuren = voorkeurenTekst ? JSON.parse(voorkeurenTekst) : { ingredient: {}, gerecht_ingredient: {} };
  } catch (e) {
    staat.productVoorkeuren = { ingredient: {}, gerecht_ingredient: {} };
  }
  try {
    staat.laatsteWeekmenu = laatsteWeekmenuTekst ? JSON.parse(laatsteWeekmenuTekst) : null;
  } catch (e) {
    staat.laatsteWeekmenu = null;
  }

  waarschuwingenEl.innerHTML = "";
  renderLaatsteBestellingBanner();
  ververs();
  renderLosseProducten();

  // Was er een controle-scherm in uitvoering (bv. tab herladen terwijl je nog
  // aan het controleren was)? Dan die herstellen i.p.v. gewoon weer bij het
  // weekmenu te beginnen — anders moet er onnodig opnieuw gezocht worden.
  const bewaard = laadBewaardeControleStaat();
  if (bewaard) {
    staat.weekmenu = bewaard.weekmenu;
    staat.losseProducten = bewaard.losseProducten || [];
    staat.productVoorstellen = bewaard.productVoorstellen;
    staat.productKeuzeIndex = bewaard.productKeuzeIndex;
    renderLosseProducten();
  }
  gaNaarTab(bewaard ? "controle" : "overzicht");
  toonScherm(appEl);
}

// --- Voortgang van het controle-scherm bewaren, zodat een herladen tabblad
// (of dat iOS de pagina op de achtergrond opschoont) niet betekent dat er
// helemaal opnieuw gezocht moet worden bij Picnic.
//
// Bewust sessionStorage i.p.v. localStorage: dat bewaart alleen binnen
// hetzelfde tabblad/dezelfde sessie (overleeft een herlaad, maar niet het
// sluiten van het tabblad). Met localStorage sprong de app bij elke nieuwe
// opening — soms uren later — meteen terug naar het controle-scherm, zodat
// de vaste boodschappenlijst (die alleen op het kies-scherm staat) leek te
// zijn verdwenen.

const CONTROLE_STAAT_KEY = "picnic_controle_staat";

function bewaarControleStaat() {
  try {
    sessionStorage.setItem(
      CONTROLE_STAAT_KEY,
      JSON.stringify({
        weekmenu: staat.weekmenu,
        losseProducten: staat.losseProducten,
        productVoorstellen: staat.productVoorstellen,
        productKeuzeIndex: staat.productKeuzeIndex,
      })
    );
  } catch (e) {
    // sessionStorage kan vol/geblokkeerd zijn; niet kritiek als dit niet lukt
  }
}

function wisControleStaat() {
  try {
    sessionStorage.removeItem(CONTROLE_STAAT_KEY);
  } catch (e) {
    // niet kritiek
  }
}

function laadBewaardeControleStaat() {
  try {
    const ruw = sessionStorage.getItem(CONTROLE_STAAT_KEY);
    if (!ruw) return null;
    const data = JSON.parse(ruw);
    if (!data.productVoorstellen) {
      wisControleStaat();
      return null;
    }
    return data;
  } catch (e) {
    return null;
  }
}

function renderLaatsteBestellingBanner() {
  const bestaande = waarschuwingenEl.querySelector(".waarschuwing.mislukt");
  if (bestaande) bestaande.remove();

  if (!staat.laatsteBestelling || staat.laatsteBestelling.status !== "mislukt") return;

  const reden = staat.laatsteBestelling.foutmelding
    ? escapeHtml(staat.laatsteBestelling.foutmelding)
    : "onbekende fout";
  const waarschuwing = maakEl("div", "waarschuwing mislukt");
  waarschuwing.innerHTML =
    `⚠️ <span><strong>De laatste automatische bestelpoging is mislukt</strong> ` +
    `(${relatieveTijd(staat.laatsteBestelling.datum)}): ${reden}. ` +
    `Check het Picnic-token of bestel deze week handmatig.</span>`;
  waarschuwingenEl.appendChild(waarschuwing);
}

async function slaWeekmenuOp() {
  if (staat.receptenboekGewijzigd) {
    await githubPutFile("receptenboek.txt", herbouwReceptenboekTekst(), "Receptenboek bijgewerkt via de website");
  }
  if (staat.standaardlijstGewijzigd) {
    await githubPutFile("standaardlijst.txt", herbouwStandaardlijstTekst(), "Vaste boodschap aangepast via de website");
    staat.standaardlijstGewijzigd = false;
  }

  const alleProducten = [...gekozenStandaardProducten(), ...voorraadTeBestellen(), ...staat.losseProducten];
  const lijstTekst = schrijfBoodschappenlijst(staat.weekmenu, alleProducten, voorraadArtikelNamen(staat.voorraadCategorieen));
  await githubPutFile("boodschappenlijst.txt", lijstTekst, "Weekmenu gekozen via de website");

  const nieuweGeschiedenis = werkGeschiedenisBij(staat.geschiedenis, staat.weekmenu);
  await githubPutFile("weekmenu_geschiedenis.txt", slaGeschiedenisOp(nieuweGeschiedenis), "Geschiedenis bijgewerkt via de website");
}

async function startZoeken() {
  if (staat.zoekenBezig) return;

  // 1. Valideren: niets te zoeken zonder geselecteerde boodschappen. De knop
  // staat in dat geval al uitgeschakeld (zie gaNaarTab), maar deze check
  // blijft ook correct als startZoeken() ooit ergens anders vandaan wordt
  // aangeroepen.
  if (huidigeBoodschappenTotalen().length === 0) {
    statusEl.textContent = "Selecteer eerst minstens één boodschap om te zoeken.";
    return;
  }

  staat.zoekenBezig = true;
  const startTijd = new Date();
  actieKnop.disabled = true;
  waarschuwingenEl.innerHTML = "";
  // Begrijpelijke, niet-technische statussen — geen "workflow gestart" of
  // vergelijkbaar. Elke fase hieronder komt overeen met een van deze vier
  // stappen: boodschappen opslaan -> bij Picnic zoeken -> lokaal verwerken
  // (verpakkingen/voorkeuren) -> klaar om te controleren.
  statusEl.textContent = "Boodschappen verzamelen...";

  try {
    // 2. Wijzigingen opslaan.
    await slaWeekmenuOp();

    // 3. De bestaande zoekworkflow starten.
    statusEl.textContent = "Producten zoeken bij Picnic...";
    await dispatchWorkflow(ZOEKEN_WORKFLOW, {});
    const run = await volgWorkflow(ZOEKEN_WORKFLOW, startTijd, statusEl, "Producten zoeken bij Picnic...");

    if (!run || run.conclusion !== "success") {
      statusEl.textContent = run
        ? "Zoeken bij Picnic is mislukt — probeer het opnieuw. Je keuzes blijven gewoon staan."
        : "Kon de status niet vinden — probeer het opnieuw. Je keuzes blijven gewoon staan.";
      return;
    }

    statusEl.textContent = "Producten en verpakkingen controleren...";
    const tekst = await haalTekstBestandViaApi("product_voorstellen.json");
    staat.productVoorstellen = tekst ? JSON.parse(tekst) : {};
    staat.productKeuzeIndex = {};
    pasProductVoorkeurenToe();

    // 4. Duidelijke afronding + automatisch naar Controle — maar alleen als
    // de gebruiker nog steeds op dit tabblad zit. Was er intussen naar een
    // ander tabblad gewisseld, dan voelt een geforceerde sprong naar
    // Controle als een "vastloper" — laat die gebruiker met rust en toon in
    // plaats daarvan een toast.
    statusEl.textContent = "Klaar om te controleren";
    if (staat.tab === "aanvullen") {
      await sleep(500);
      statusEl.textContent = "";
      gaNaarTab("controle");
    } else {
      toonToast("✓ Producten gevonden — bekijk ze bij Controle");
    }
    if (staat.tab === "overzicht") renderOverzicht();
  } catch (e) {
    statusEl.textContent = "Er ging iets mis: " + e.message + " Je keuzes blijven gewoon staan — probeer het opnieuw.";
  } finally {
    staat.zoekenBezig = false;
    actieKnop.disabled = huidigeBoodschappenTotalen().length === 0;
  }
}

function schrijfBoodschappenlijstVanControle() {
  const herkomst = berekenIngredientHerkomst(staat.weekmenu);
  const regels = ["# Weekmenu:"];
  for (const dag of staat.weekmenu) regels.push(`#   ${dag.dag}: ${dag.naam}`);
  regels.push("#");
  for (const naam in staat.productVoorstellen) {
    const info = staat.productVoorstellen[naam];
    if (info.verwijderd || info.geparkeerd) continue;
    const kandidaten = info.kandidaten || [];
    const idx = staat.productKeuzeIndex[naam] ?? 0;
    const gekozen = kandidaten[idx];
    const teBestellen = bepaalTeBestellenAantal(info.aantal, gekozen, herkomst.has(naam.toLowerCase()));
    regels.push(`${teBestellen} x ${naam}`);
  }
  return regels.join("\n") + "\n";
}

async function bevestigBestelling() {
  if (staat.bestellenBezig) return;
  staat.bestellenBezig = true;

  const startTijd = new Date();
  actieKnop.disabled = true;
  if (controleToevoegenKnop) controleToevoegenKnop.disabled = true;
  statusEl.textContent = "Bestelling wordt bevestigd...";

  try {
    const gekozenProducten = {};
    for (const naam in staat.productVoorstellen) {
      const info = staat.productVoorstellen[naam];
      if (info.verwijderd || info.geparkeerd) continue;
      const kandidaten = info.kandidaten || [];
      const idx = staat.productKeuzeIndex[naam] ?? 0;
      const gekozen = kandidaten[idx];
      if (gekozen) gekozenProducten[naam] = info.alleenDezeKeer ? { ...gekozen, alleen_deze_keer: true } : gekozen;
    }
    await githubPutFile("gekozen_producten.json", JSON.stringify(gekozenProducten, null, 2), "Productkeuzes bevestigd via de website");
    await githubPutFile(
      "boodschappenlijst.txt",
      schrijfBoodschappenlijstVanControle(),
      "Aantallen aangepast in het controle-scherm"
    );
    await githubPutFile(
      "laatste_weekmenu.json",
      JSON.stringify({ datum: new Date().toISOString(), gerechten: rateerbareGerechten(staat.weekmenu) }, null, 2),
      "Weekmenu van deze bestelling bewaard voor beoordeling"
    );

    statusEl.textContent = "Bestelling wordt gestart...";
    await dispatchWorkflow(BESTEL_WORKFLOW, { nieuw_weekmenu: "nee" });
    await volgBestelling(startTijd, statusEl);
  } catch (e) {
    statusEl.textContent = "Er ging iets mis: " + e.message;
  } finally {
    staat.bestellenBezig = false;
    actieKnop.disabled = false;
    if (controleToevoegenKnop) controleToevoegenKnop.disabled = false;
  }
}

// ---------------------------------------------------------------------------
// Pincode- en sleutel-scherm
// ---------------------------------------------------------------------------

function initApp() {
  if (!localStorage.getItem(TOKEN_KEY)) {
    toonScherm(schermToken);
  } else {
    laadWeekmenuScherm();
  }
}

document.getElementById("pin-knop").onclick = async () => {
  const invoer = document.getElementById("pin-invoer").value;
  const hash = await sha256Hex(invoer);
  if (hash === PIN_HASH) {
    localStorage.setItem(UNLOCKED_KEY, "1");
    document.getElementById("pin-fout").textContent = "";
    initApp();
  } else {
    document.getElementById("pin-fout").textContent = "Onjuiste pincode.";
  }
};

document.getElementById("pin-invoer").addEventListener("keydown", (e) => {
  if (e.key === "Enter") document.getElementById("pin-knop").click();
});

async function testToken(waarde) {
  const res = await fetch(API, { headers: { Authorization: `Bearer ${waarde}`, Accept: "application/vnd.github+json" } });
  return res.ok;
}

document.getElementById("token-knop").onclick = async () => {
  const knop = document.getElementById("token-knop");
  const foutEl = document.getElementById("token-fout");
  const waarde = document.getElementById("token-invoer").value.trim();
  if (!waarde) {
    foutEl.textContent = "Vul een geldige sleutel in.";
    return;
  }

  knop.disabled = true;
  foutEl.textContent = "Sleutel wordt gecontroleerd...";
  try {
    const geldig = await testToken(waarde);
    if (!geldig) {
      foutEl.textContent = "Deze sleutel werkt niet — check of je 'm goed hebt gekopieerd en of Contents + Actions op 'Read and write' staan.";
      return;
    }
    localStorage.setItem(TOKEN_KEY, waarde);
    foutEl.textContent = "";
    laadWeekmenuScherm();
  } catch (e) {
    foutEl.textContent = "Kon de sleutel niet controleren (netwerkprobleem?). Probeer opnieuw.";
  } finally {
    knop.disabled = false;
  }
};

if (localStorage.getItem(UNLOCKED_KEY) === "1") {
  initApp();
} else {
  toonScherm(schermPin);
}
