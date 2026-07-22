"use strict";

const OWNER = "Jurgenvdlecq";
const REPO = "Picnic-besteller";
const API = `https://api.github.com/repos/${OWNER}/${REPO}`;
const WORKFLOW_FILE = "bestel.yml";

// SHA-256 van de pincode, zodat de code zelf niet in platte tekst in de
// paginabron staat. Dit is geen sterke beveiliging (view-source + brute
// force op 4 cijfers is triviaal) — het is alleen bedoeld om toevallige
// bezoekers buiten de deur te houden.
const PIN_HASH = "88cf986449b61aeba90a4baedfaeba95cc12e8d04dedfebe53b78dd29fc0a4ac";

const UNLOCKED_KEY = "picnic_unlocked";
const TOKEN_KEY = "picnic_gh_token";

const WOENSDAG_GERECHT = "kip met rijst en paprika";
const NAAM_TYPBARE_CATEGORIEEN = new Set(["maandag", "donderdag", "vrijdag_veel"]);

// Volgorde + weergavenaam voor de vlees-filterknoppen. "overig" vangt
// gerechten op zonder (herkend) Vlees:-label.
const VLEES_VOLGORDE = ["kip", "rund", "varken", "ei-vega", "overig"];
const VLEES_LABELS = { kip: "Kip", rund: "Rund", varken: "Varken", "ei-vega": "Ei / vega", overig: "Overig" };

// Bepaalt welk label een handmatig toegevoegd gerecht krijgt in
// receptenboek.txt, per dag-categorie waarvoor dat mogelijk is.
const LABEL_VOOR_CATEGORIE = { maandag: "makkelijk", donderdag: null, vrijdag_veel: "vrijdag_veel" };
const POOL_VOOR_CATEGORIE = {
  maandag: (pools) => pools.makkelijk,
  donderdag: (pools) => pools.algemeen,
  vrijdag_veel: (pools) => pools.vrijdag_veel,
};

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
      huidig = { naam: regel.slice(regel.indexOf(":") + 1).trim(), label: null, vlees: null, actief: true, ingredienten: [] };
    } else if (laag.startsWith("vlees:") && huidig) {
      huidig.vlees = regel.slice(regel.indexOf(":") + 1).trim().toLowerCase();
    } else if (laag.startsWith("label:") && huidig) {
      huidig.label = regel.slice(regel.indexOf(":") + 1).trim().toLowerCase();
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
    .filter((r) => r && !r.startsWith("#"))
    .map(parseAantalNaam);
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
  let woensdagGerecht = receptenboek.find((g) => g.naam.trim().toLowerCase() === WOENSDAG_GERECHT);
  if (!woensdagGerecht) {
    woensdagGerecht = { naam: "Kip met rijst (niet gevonden in receptenboek)", ingredienten: [] };
  }
  const actieveRecepten = receptenboek.filter((g) => g.actief);

  return {
    makkelijk: actieveRecepten.filter((g) => g.label === "makkelijk"),
    vrijdag_veel: actieveRecepten.filter((g) => g.label === "vrijdag_veel"),
    algemeen: actieveRecepten.filter((g) => g.label === null && g.naam.trim().toLowerCase() !== WOENSDAG_GERECHT),
    woensdag: woensdagGerecht,
  };
}

function kiesUitPool(pool, categorie, geschiedenis) {
  if (!pool || pool.length === 0) return null;
  const eerdereKeuzes = geschiedenis[categorie] || [];

  function recentheid(gerecht) {
    return eerdereKeuzes.lastIndexOf(gerecht.naam); // -1 als nooit eerder gekozen
  }

  const gesorteerd = [...pool].sort((a, b) => recentheid(a) - recentheid(b));
  const aantalKandidaten = Math.max(2, Math.floor(gesorteerd.length / 2));
  return pickRandom(gesorteerd.slice(0, aantalKandidaten));
}

function samenstellenDinsdag(onderdelen) {
  const { aardappel, vlees, groente } = onderdelen;
  const naam = [aardappel, vlees, groente].filter(Boolean).map((x) => x.naam).join(" + ");
  return { dag: "Dinsdag", naam, ingredienten: combineerIngredienten(aardappel, vlees, groente), categorie: "dinsdag", onderdelen };
}

function kiesDinsdag(dagOpties) {
  return samenstellenDinsdag({
    aardappel: pickRandom(dagOpties.dinsdag_aardappel),
    vlees: pickRandom(dagOpties.dinsdag_vlees),
    groente: pickRandom(dagOpties.groente),
  });
}

function samenstellenVrijdagKlein(onderdelen) {
  const { vlees, groente } = onderdelen;
  const naam = [vlees, groente].filter(Boolean).map((x) => x.naam).join(" + ");
  return { dag: "Vrijdag (2p)", naam, ingredienten: combineerIngredienten(vlees, groente), categorie: "vrijdag_klein", onderdelen };
}

function samenstellenZondag(onderdelen) {
  const { snack } = onderdelen;
  const patat = { naam: "Patat (airfryer)", aantal: 1 };
  const naam = snack ? `Patat + ${snack.naam}` : "Patat (airfryer)";
  return { dag: "Zondag", naam, ingredienten: combineerIngredienten(patat, snack), categorie: "zondag", onderdelen };
}

function kiesZondag(dagOpties) {
  return samenstellenZondag({ snack: pickRandom(dagOpties.zondag_snack) });
}

function kiesVrijdag(dagOpties, pools, vierPersonen, geschiedenis) {
  if (vierPersonen) {
    const gerecht = kiesUitPool(pools.vrijdag_veel, "vrijdag_veel", geschiedenis);
    return {
      dag: "Vrijdag (4p)",
      naam: gerecht ? gerecht.naam : "(geen 'vrijdag_veel'-gerecht gevonden)",
      ingredienten: gerecht ? gerecht.ingredienten : [],
      categorie: "vrijdag_veel",
      vlees: gerecht ? gerecht.vlees : null,
    };
  }
  return samenstellenVrijdagKlein({
    vlees: pickRandom(dagOpties.vrijdag_vlees_klein),
    groente: pickRandom(dagOpties.groente),
  });
}

function stelWeekmenuSamen(pools, dagOpties, vierPersonen, geschiedenis) {
  const weekmenu = [];

  const ma = kiesUitPool(pools.makkelijk, "maandag", geschiedenis);
  weekmenu.push({
    dag: "Maandag",
    naam: ma ? ma.naam : "(geen 'makkelijk'-gerecht gevonden)",
    ingredienten: ma ? ma.ingredienten : [],
    categorie: "maandag",
    vlees: ma ? ma.vlees : null,
  });

  weekmenu.push(kiesDinsdag(dagOpties));

  weekmenu.push({
    dag: "Woensdag",
    naam: pools.woensdag.naam,
    ingredienten: pools.woensdag.ingredienten,
    categorie: "woensdag",
  });

  const doo = kiesUitPool(pools.algemeen, "donderdag", geschiedenis);
  weekmenu.push({
    dag: "Donderdag",
    naam: doo ? doo.naam : "(pool leeg)",
    ingredienten: doo ? doo.ingredienten : [],
    categorie: "donderdag",
    vlees: doo ? doo.vlees : null,
  });

  weekmenu.push(kiesVrijdag(dagOpties, pools, vierPersonen, geschiedenis));
  weekmenu.push(kiesZondag(dagOpties));

  return weekmenu;
}

function herkiesDag(weekmenu, index, pools, dagOpties, vierPersonen, geschiedenis) {
  const categorie = weekmenu[index].categorie;
  const vorigeNaam = weekmenu[index].naam;
  if (categorie === "woensdag") return false;

  const herkiesFuncties = {
    maandag: () => {
      const g = kiesUitPool(pools.makkelijk, "maandag", geschiedenis);
      return {
        dag: "Maandag",
        naam: g ? g.naam : "(geen 'makkelijk'-gerecht gevonden)",
        ingredienten: g ? g.ingredienten : [],
        categorie: "maandag",
        vlees: g ? g.vlees : null,
      };
    },
    dinsdag: () => kiesDinsdag(dagOpties),
    donderdag: () => {
      const g = kiesUitPool(pools.algemeen, "donderdag", geschiedenis);
      return {
        dag: "Donderdag",
        naam: g ? g.naam : "(pool leeg)",
        ingredienten: g ? g.ingredienten : [],
        categorie: "donderdag",
        vlees: g ? g.vlees : null,
      };
    },
    vrijdag_veel: () => kiesVrijdag(dagOpties, pools, vierPersonen, geschiedenis),
    vrijdag_klein: () => kiesVrijdag(dagOpties, pools, vierPersonen, geschiedenis),
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

function zoekReceptenOpNaam(receptenboek, zoekterm) {
  const z = zoekterm.trim().toLowerCase();
  if (!z) return [];
  return receptenboek.filter((g) => g.naam.toLowerCase().includes(z));
}

function berekenTotalen(weekmenu, producten) {
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
      voegToe(item.naam, item.aantal);
    }
  }
  for (const item of producten) voegToe(item.naam, item.aantal);

  return [...totalen.values()];
}

function schrijfBoodschappenlijst(weekmenu, producten) {
  const totalen = berekenTotalen(weekmenu, producten);

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
  for (const ingredient of gerecht.ingredienten) regels.push(ingredient);
  return regels.join("\n");
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
    Authorization: `Bearer ${localStorage.getItem(TOKEN_KEY)}`,
    Accept: "application/vnd.github+json",
    ...extra,
  };
}

async function githubGetFileSha(path) {
  const res = await fetch(`${API}/contents/${encodeURIComponent(path)}?ref=main`, { headers: ghHeaders() });
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

async function dispatchWorkflow() {
  const res = await fetch(`${API}/actions/workflows/${WORKFLOW_FILE}/dispatches`, {
    method: "POST",
    headers: ghHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ ref: "main", inputs: { nieuw_weekmenu: "nee" } }),
  });
  if (!res.ok) throw new Error(`Kon de bestelling niet starten (${res.status})`);
}

async function vindLaatsteRun(naDatum) {
  const res = await fetch(`${API}/actions/workflows/${WORKFLOW_FILE}/runs?per_page=5`, { headers: ghHeaders() });
  if (!res.ok) return null;
  const data = await res.json();
  return (data.workflow_runs || []).find((r) => new Date(r.created_at) >= naDatum) || null;
}

async function volgBestelling(startTijd, statusEl) {
  let run = null;
  for (let poging = 0; poging < 20 && !run; poging++) {
    await sleep(3000);
    run = await vindLaatsteRun(startTijd);
  }
  if (!run) {
    statusEl.textContent = "Kon de status niet vinden — check over een minuutje de Picnic-app.";
    return;
  }

  statusEl.innerHTML = `Bestelling wordt verwerkt... <a href="${run.html_url}" target="_blank" rel="noopener">bekijk voortgang</a>`;

  while (run.status !== "completed") {
    await sleep(4000);
    const res = await fetch(run.url, { headers: ghHeaders() });
    if (res.ok) run = await res.json();
  }

  if (run.conclusion === "success") {
    statusEl.textContent = "Klaar! De producten staan in je Picnic-mandje. Open de Picnic-app om af te ronden.";
    await verversLaatsteBestelling();
    renderKopInfo();
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

async function verversLaatsteBestelling() {
  const tekst = await haalTekstBestandOp("laatste_bestelling.json");
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
const dagenEl = document.getElementById("dagen");
const weekInfoEl = document.getElementById("week-info");
const personenSwitchEl = document.getElementById("personen-switch");
const laatstBesteldEl = document.getElementById("laatst-besteld");
const standaardLijstEl = document.getElementById("standaard-lijst");
const kassabonEl = document.getElementById("kassabon-wrap");
const waarschuwingenEl = document.getElementById("waarschuwingen");
const statusEl = document.getElementById("status");
const bestelKnop = document.getElementById("bestel-knop");
const losseLijstEl = document.getElementById("losse-lijst");
const losNaamEl = document.getElementById("los-naam");
const losAantalEl = document.getElementById("los-aantal");

let staat = {
  pools: null,
  dagOpties: null,
  standaardlijst: null,
  standaardUitgevinkt: new Set(),
  receptenboek: null,
  receptenboekRuweTekst: "",
  receptenboekGewijzigd: false,
  geschiedenis: null,
  vierPersonen: false,
  weekmenu: [],
  losseProducten: [],
  filters: {},
  laatsteBestelling: null,
};

function toonScherm(scherm) {
  for (const el of [schermPin, schermToken, schermLaden, appEl]) el.classList.add("verborgen");
  scherm.classList.remove("verborgen");
}

function ververs() {
  renderKopInfo();
  renderStandaardlijst();
  renderWeekmenu();
  renderKassabon();
}

// --- Kop: personen-schuifje + laatst besteld ---

function renderKopInfo() {
  weekInfoEl.textContent = staat.vierPersonen ? "Vrijdag & weekend voor 4 personen" : "Vrijdag & weekend voor 2 personen";

  personenSwitchEl.querySelectorAll(".optie").forEach((el) => {
    el.classList.toggle("actief", (el.dataset.personen === "4") === staat.vierPersonen);
  });

  if (staat.laatsteBestelling && staat.laatsteBestelling.datum) {
    laatstBesteldEl.textContent = `Laatst besteld: ${relatieveTijd(staat.laatsteBestelling.datum)}`;
  } else {
    laatstBesteldEl.textContent = "Nog niet eerder besteld";
  }
}

personenSwitchEl.querySelectorAll(".optie").forEach((el) => {
  el.onclick = () => {
    const nieuweWaarde = el.dataset.personen === "4";
    if (nieuweWaarde === staat.vierPersonen) return;
    staat.vierPersonen = nieuweWaarde;
    const vrijdagIndex = staat.weekmenu.findIndex((d) => d.categorie.startsWith("vrijdag"));
    if (vrijdagIndex !== -1) {
      staat.weekmenu[vrijdagIndex] = kiesVrijdag(staat.dagOpties, staat.pools, staat.vierPersonen, staat.geschiedenis);
    }
    ververs();
  };
});

// --- Standaardlijst ---

function renderStandaardlijst() {
  standaardLijstEl.innerHTML = "";
  for (const item of staat.standaardlijst) {
    const sleutel = item.naam.toLowerCase();
    const uitgevinkt = staat.standaardUitgevinkt.has(sleutel);

    const wissel = () => {
      if (staat.standaardUitgevinkt.has(sleutel)) staat.standaardUitgevinkt.delete(sleutel);
      else staat.standaardUitgevinkt.add(sleutel);
      ververs();
    };

    const rij = maakEl("div", "std-item" + (uitgevinkt ? " uit" : ""));
    rij.appendChild(maakKnop("vinkje" + (uitgevinkt ? "" : " aan"), uitgevinkt ? "" : "✓", wissel));

    const naamEl = maakEl("div", "std-naam", item.naam);
    naamEl.onclick = wissel;
    rij.appendChild(naamEl);

    rij.appendChild(maakEl("div", "std-aantal", `${item.aantal}×`));
    standaardLijstEl.appendChild(rij);
  }
}

// --- Dagkaarten ---

function renderWeekmenu() {
  dagenEl.innerHTML = "";
  staat.weekmenu.forEach((dag, index) => {
    if (dag.categorie === "woensdag") {
      dagenEl.appendChild(bouwVasteKaart(dag));
    } else if (POOL_VOOR_CATEGORIE[dag.categorie]) {
      dagenEl.appendChild(bouwGerechtKaart(dag, index));
    } else {
      dagenEl.appendChild(bouwCombiKaart(dag, index));
    }
  });
}

function bouwVasteKaart(dag) {
  const kaart = maakEl("section", "kaart vast-kaart");
  const links = document.createElement("div");
  links.appendChild(maakEl("div", "dag-eyebrow", dag.dag));
  links.appendChild(maakEl("div", "naam", dag.naam));
  kaart.appendChild(links);
  kaart.appendChild(maakEl("div", "vast-badge", "altijd hetzelfde"));
  return kaart;
}

function bouwGerechtKaart(dag, index) {
  const kaart = maakEl("section", "kaart");
  kaart.appendChild(maakEl("div", "dag-eyebrow", dag.dag));

  const pool = POOL_VOOR_CATEGORIE[dag.categorie](staat.pools);
  const beschikbareVlezen = VLEES_VOLGORDE.filter((v) => pool.some((g) => (g.vlees || "overig") === v));
  if (staat.filters[dag.categorie] === undefined) staat.filters[dag.categorie] = "alle";
  const huidigFilter = staat.filters[dag.categorie];

  const chipsEl = maakEl("div", "chips");
  const alleChip = maakKnop("chip" + (huidigFilter === "alle" ? " actief" : ""), "Alles", () => {
    staat.filters[dag.categorie] = "alle";
    renderWeekmenu();
  });
  chipsEl.appendChild(alleChip);
  for (const v of beschikbareVlezen) {
    const chip = maakKnop("chip" + (huidigFilter === v ? " actief" : ""), VLEES_LABELS[v], () => {
      staat.filters[dag.categorie] = v;
      renderWeekmenu();
    });
    chipsEl.appendChild(chip);
  }
  kaart.appendChild(chipsEl);

  const lijstEl = maakEl("div", "gerecht-lijst");
  const zichtbaar = huidigFilter === "alle" ? pool : pool.filter((g) => (g.vlees || "overig") === huidigFilter);
  for (const gerecht of zichtbaar) {
    const rij = document.createElement("button");
    rij.type = "button";
    rij.className = "gerecht-rij" + (gerecht.naam === dag.naam ? " gekozen" : "");
    rij.appendChild(maakEl("span", "bolletje"));
    rij.appendChild(document.createTextNode(gerecht.naam));
    rij.onclick = () => {
      staat.weekmenu[index] = { dag: dag.dag, naam: gerecht.naam, ingredienten: gerecht.ingredienten, categorie: dag.categorie, vlees: gerecht.vlees };
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
      herkiesDag(staat.weekmenu, index, staat.pools, staat.dagOpties, staat.vierPersonen, staat.geschiedenis);
      ververs();
    })
  );
  acties.appendChild(maakKnop("secundair", "Kies zelf recept", () => toonZoekveld(kaart, index)));
  acties.appendChild(maakKnop("secundair", "+ Nieuw gerecht", () => toonNieuwGerechtForm(kaart, index)));
  kaart.appendChild(acties);

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
  zondag: {
    groepen: [{ key: "snack", label: "Snack", opties: (d) => d.zondag_snack }],
    samenstellen: samenstellenZondag,
    vast: "🍟 Patat (airfryer) — altijd erbij",
  },
};

function bouwCombiKaart(dag, index) {
  const config = COMBI_CONFIG[dag.categorie];
  const kaart = maakEl("section", "kaart");
  kaart.appendChild(maakEl("div", "dag-eyebrow", dag.dag));

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
      const chip = maakKnop("chip" + (huidig && huidig.naam === optie.naam ? " actief" : ""), optie.naam, () => {
        const nieuweOnderdelen = { ...dag.onderdelen, [groep.key]: optie };
        staat.weekmenu[index] = config.samenstellen(nieuweOnderdelen);
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
      herkiesDag(staat.weekmenu, index, staat.pools, staat.dagOpties, staat.vierPersonen, staat.geschiedenis);
      ververs();
    })
  );
  kaart.appendChild(acties);

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
        staat.weekmenu[index] = { dag: dagLabel, naam: match.naam, ingredienten: match.ingredienten, categorie, vlees: match.vlees };
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
    const nieuwGerecht = { naam, label: LABEL_VOOR_CATEGORIE[categorie], vlees, actief: true, ingredienten };

    staat.receptenboek.push(nieuwGerecht);
    staat.receptenboekRuweTekst = staat.receptenboekRuweTekst.trimEnd() + "\n\n" + bouwReceptenboekBlok(nieuwGerecht) + "\n";
    staat.receptenboekGewijzigd = true;
    staat.pools = bepaalPools(staat.receptenboek);

    const dagLabel = staat.weekmenu[index].dag;
    staat.weekmenu[index] = { dag: dagLabel, naam, ingredienten, categorie, vlees };
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

// --- Kassabon (voorvertoning) ---

function gekozenStandaardProducten() {
  return staat.standaardlijst.filter((item) => !staat.standaardUitgevinkt.has(item.naam.toLowerCase()));
}

function renderKassabon() {
  const producten = [...gekozenStandaardProducten(), ...staat.losseProducten];
  const totalen = berekenTotalen(staat.weekmenu, producten);

  kassabonEl.innerHTML = "";
  const bon = maakEl("div", "bon");
  bon.appendChild(maakEl("div", "bon-titel", "Boodschappenlijst"));
  bon.appendChild(maakEl("div", "bon-sub", `${totalen.length} producten — voorvertoning`));

  for (const { naam, aantal } of totalen) {
    const rij = maakEl("div", "bon-rij");
    rij.appendChild(maakEl("span", "bon-naam", naam));
    rij.appendChild(maakEl("span", "bon-aantal", `${aantal}×`));
    bon.appendChild(rij);
  }

  bon.appendChild(maakEl("div", "bon-streep"));

  const totaalRij = maakEl("div", "bon-totaal");
  const linkerKant = document.createElement("span");
  linkerKant.textContent = "Geschat totaal";
  const letOp = maakEl("span", "let-op", "op basis van de vorige bestelling — kan afwijken");
  linkerKant.appendChild(letOp);

  const rechterKant = document.createElement("span");
  const heeftPrijs = staat.laatsteBestelling && typeof staat.laatsteBestelling.totaal_prijs_cent === "number";
  rechterKant.textContent = heeftPrijs ? `≈ €${(staat.laatsteBestelling.totaal_prijs_cent / 100).toFixed(2)}` : "nog onbekend";

  totaalRij.appendChild(linkerKant);
  totaalRij.appendChild(rechterKant);
  bon.appendChild(totaalRij);

  kassabonEl.appendChild(bon);
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

// --- Laden en bestellen ---

async function laadWeekmenuScherm() {
  toonScherm(schermLaden);

  const [receptenTekst, dagOptiesTekst, standaardTekst, geschiedenisTekst, laatsteTekst] = await Promise.all([
    haalTekstBestandOp("receptenboek.txt"),
    haalTekstBestandOp("dag_opties.txt"),
    haalTekstBestandOp("standaardlijst.txt"),
    haalTekstBestandOp("weekmenu_geschiedenis.txt"),
    haalTekstBestandOp("laatste_bestelling.json"),
  ]);

  staat.receptenboek = laadReceptenboek(receptenTekst);
  staat.receptenboekRuweTekst = receptenTekst;
  staat.receptenboekGewijzigd = false;
  staat.dagOpties = laadDagOpties(dagOptiesTekst);
  staat.standaardlijst = laadStandaardlijst(standaardTekst);
  staat.standaardUitgevinkt = new Set();
  staat.geschiedenis = laadGeschiedenis(geschiedenisTekst);
  staat.vierPersonen = isEvenWeek();
  staat.pools = bepaalPools(staat.receptenboek);
  staat.weekmenu = stelWeekmenuSamen(staat.pools, staat.dagOpties, staat.vierPersonen, staat.geschiedenis);
  staat.losseProducten = [];
  staat.filters = {};
  try {
    staat.laatsteBestelling = laatsteTekst ? JSON.parse(laatsteTekst) : null;
  } catch (e) {
    staat.laatsteBestelling = null;
  }

  waarschuwingenEl.innerHTML = "";
  ververs();
  renderLosseProducten();
  toonScherm(appEl);
}

async function bestelNu() {
  const startTijd = new Date();
  bestelKnop.disabled = true;
  waarschuwingenEl.innerHTML = "";
  statusEl.textContent = "Bezig met opslaan van je weekmenu...";

  try {
    if (staat.receptenboekGewijzigd) {
      await githubPutFile("receptenboek.txt", staat.receptenboekRuweTekst, "Nieuw gerecht toegevoegd via de website");
    }

    const alleProducten = [...gekozenStandaardProducten(), ...staat.losseProducten];
    const lijstTekst = schrijfBoodschappenlijst(staat.weekmenu, alleProducten);
    await githubPutFile("boodschappenlijst.txt", lijstTekst, "Weekmenu gekozen via de website");

    const nieuweGeschiedenis = werkGeschiedenisBij(staat.geschiedenis, staat.weekmenu);
    await githubPutFile("weekmenu_geschiedenis.txt", slaGeschiedenisOp(nieuweGeschiedenis), "Geschiedenis bijgewerkt via de website");

    statusEl.textContent = "Bestelling wordt gestart...";
    await dispatchWorkflow();
    await volgBestelling(startTijd, statusEl);
  } catch (e) {
    statusEl.textContent = "Er ging iets mis: " + e.message;
  } finally {
    bestelKnop.disabled = false;
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

bestelKnop.onclick = bestelNu;

if (localStorage.getItem(UNLOCKED_KEY) === "1") {
  initApp();
} else {
  toonScherm(schermPin);
}
