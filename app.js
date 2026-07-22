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
      huidig = { naam: regel.slice(regel.indexOf(":") + 1).trim(), label: null, actief: true, ingredienten: [] };
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
// Dagmenu samenstellen (spiegelt weekmenu.py)
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

function kiesDinsdag(dagOpties) {
  const aardappel = pickRandom(dagOpties.dinsdag_aardappel);
  const vlees = pickRandom(dagOpties.dinsdag_vlees);
  const groente = pickRandom(dagOpties.groente);
  const naam = [aardappel, vlees, groente].filter(Boolean).map((x) => x.naam).join(" + ");
  return { dag: "Dinsdag", naam, ingredienten: combineerIngredienten(aardappel, vlees, groente), categorie: "dinsdag" };
}

function kiesVrijdag(dagOpties, pools, evenWeek, geschiedenis) {
  if (evenWeek) {
    const gerecht = kiesUitPool(pools.vrijdag_veel, "vrijdag_veel", geschiedenis);
    return {
      dag: "Vrijdag (4p)",
      naam: gerecht ? gerecht.naam : "(geen 'vrijdag_veel'-gerecht gevonden)",
      ingredienten: gerecht ? gerecht.ingredienten : [],
      categorie: "vrijdag_veel",
    };
  }
  const vlees = pickRandom(dagOpties.vrijdag_vlees_klein);
  const groente = pickRandom(dagOpties.groente);
  const naam = [vlees, groente].filter(Boolean).map((x) => x.naam).join(" + ");
  return { dag: "Vrijdag (2p)", naam, ingredienten: combineerIngredienten(vlees, groente), categorie: "vrijdag_klein" };
}

function kiesZondag(dagOpties) {
  const snack = pickRandom(dagOpties.zondag_snack);
  const patat = { naam: "Patat (airfryer)", aantal: 1 };
  const naam = snack ? `Patat + ${snack.naam}` : "Patat (airfryer)";
  return { dag: "Zondag", naam, ingredienten: combineerIngredienten(patat, snack), categorie: "zondag" };
}

function stelWeekmenuSamen(pools, dagOpties, evenWeek, geschiedenis) {
  const weekmenu = [];

  const ma = kiesUitPool(pools.makkelijk, "maandag", geschiedenis);
  weekmenu.push({
    dag: "Maandag",
    naam: ma ? ma.naam : "(geen 'makkelijk'-gerecht gevonden)",
    ingredienten: ma ? ma.ingredienten : [],
    categorie: "maandag",
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
  });

  weekmenu.push(kiesVrijdag(dagOpties, pools, evenWeek, geschiedenis));
  weekmenu.push(kiesZondag(dagOpties));

  return weekmenu;
}

function herkiesDag(weekmenu, index, pools, dagOpties, evenWeek, geschiedenis) {
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
      };
    },
    vrijdag_veel: () => kiesVrijdag(dagOpties, pools, evenWeek, geschiedenis),
    vrijdag_klein: () => kiesVrijdag(dagOpties, pools, evenWeek, geschiedenis),
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

function schrijfBoodschappenlijst(weekmenu, standaardlijst) {
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
  for (const item of standaardlijst) voegToe(item.naam, item.aantal);

  const regels = ["# Weekmenu:"];
  for (const dag of weekmenu) regels.push(`#   ${dag.dag}: ${dag.naam}`);
  regels.push("#");
  for (const { naam, aantal } of totalen.values()) regels.push(`${aantal} x ${naam}`);

  return regels.join("\n") + "\n";
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

// ---------------------------------------------------------------------------
// UI
// ---------------------------------------------------------------------------

const schermPin = document.getElementById("scherm-pin");
const schermToken = document.getElementById("scherm-token");
const schermLaden = document.getElementById("scherm-laden");
const appEl = document.getElementById("app");
const dagenEl = document.getElementById("dagen");
const weekInfoEl = document.getElementById("week-info");
const statusEl = document.getElementById("status");
const bestelKnop = document.getElementById("bestel-knop");
const losseLijstEl = document.getElementById("losse-lijst");
const losNaamEl = document.getElementById("los-naam");
const losAantalEl = document.getElementById("los-aantal");

// Bepaalt welk label een handmatig toegevoegd gerecht krijgt in
// receptenboek.txt, per dag-categorie waarvoor dat mogelijk is.
const LABEL_VOOR_CATEGORIE = { maandag: "makkelijk", donderdag: null, vrijdag_veel: "vrijdag_veel" };

let staat = {
  pools: null,
  dagOpties: null,
  standaardlijst: null,
  receptenboek: null,
  receptenboekRuweTekst: "",
  receptenboekGewijzigd: false,
  geschiedenis: null,
  evenWeek: false,
  weekmenu: [],
  losseProducten: [],
};

function toonScherm(scherm) {
  for (const el of [schermPin, schermToken, schermLaden, appEl]) el.classList.add("verborgen");
  scherm.classList.remove("verborgen");
}

function renderWeekmenu() {
  weekInfoEl.textContent = `Week met ${staat.evenWeek ? "4" : "2"} personen op vrijdag/weekend (${
    staat.evenWeek ? "even" : "oneven"
  } weeknummer).`;

  dagenEl.innerHTML = "";
  staat.weekmenu.forEach((dag, index) => {
    const kaart = document.createElement("div");
    kaart.className = "dagkaart";

    const dagLabel = document.createElement("div");
    dagLabel.className = "dag";
    dagLabel.textContent = dag.dag;
    kaart.appendChild(dagLabel);

    const naamEl = document.createElement("div");
    naamEl.className = "naam";
    naamEl.textContent = dag.naam;
    kaart.appendChild(naamEl);

    if (dag.categorie !== "woensdag") {
      const knoppen = document.createElement("div");
      knoppen.className = "knoppen";

      const shuffleKnop = document.createElement("button");
      shuffleKnop.className = "secundair";
      shuffleKnop.textContent = "Ander voorstel";
      shuffleKnop.onclick = () => {
        herkiesDag(staat.weekmenu, index, staat.pools, staat.dagOpties, staat.evenWeek, staat.geschiedenis);
        renderWeekmenu();
      };
      knoppen.appendChild(shuffleKnop);

      if (NAAM_TYPBARE_CATEGORIEEN.has(dag.categorie)) {
        const zoekKnop = document.createElement("button");
        zoekKnop.className = "secundair";
        zoekKnop.textContent = "Kies zelf recept";
        zoekKnop.onclick = () => toonZoekveld(kaart, index);
        knoppen.appendChild(zoekKnop);

        const nieuwKnop = document.createElement("button");
        nieuwKnop.className = "secundair";
        nieuwKnop.textContent = "Nieuw gerecht toevoegen";
        nieuwKnop.onclick = () => toonNieuwGerechtForm(kaart, index);
        knoppen.appendChild(nieuwKnop);
      }

      kaart.appendChild(knoppen);
    }

    dagenEl.appendChild(kaart);
  });
}

function toonZoekveld(kaart, index) {
  if (kaart.querySelector(".zoekveld")) return; // al open

  const zoekveld = document.createElement("input");
  zoekveld.type = "text";
  zoekveld.className = "zoekveld";
  zoekveld.placeholder = "Typ een receptnaam...";
  zoekveld.style.marginTop = "8px";

  const resultatenEl = document.createElement("div");
  resultatenEl.className = "zoekresultaten";

  zoekveld.oninput = () => {
    resultatenEl.innerHTML = "";
    const matches = zoekReceptenOpNaam(staat.receptenboek, zoekveld.value).slice(0, 8);
    for (const match of matches) {
      const optieKnop = document.createElement("button");
      optieKnop.textContent = match.naam;
      optieKnop.onclick = () => {
        const dagLabel = staat.weekmenu[index].dag;
        const categorie = staat.weekmenu[index].categorie;
        staat.weekmenu[index] = { dag: dagLabel, naam: match.naam, ingredienten: match.ingredienten, categorie };
        renderWeekmenu();
      };
      resultatenEl.appendChild(optieKnop);
    }
  };

  kaart.appendChild(zoekveld);
  kaart.appendChild(resultatenEl);
  zoekveld.focus();
}

function bouwReceptenboekBlok(gerecht) {
  const regels = [`Gerecht: ${gerecht.naam}`];
  if (gerecht.label) regels.push(`Label: ${gerecht.label}`);
  for (const ingredient of gerecht.ingredienten) regels.push(ingredient);
  return regels.join("\n");
}

function toonNieuwGerechtForm(kaart, index) {
  if (kaart.querySelector(".nieuw-gerecht-form")) return; // al open

  const form = document.createElement("div");
  form.className = "nieuw-gerecht-form";

  const naamVeld = document.createElement("input");
  naamVeld.type = "text";
  naamVeld.placeholder = "Naam van het gerecht";

  const ingredientenVeld = document.createElement("textarea");
  ingredientenVeld.placeholder = "Ingrediënten, één per regel, bijv.:\n1 x kipfilet\n2 x paprika";

  const foutEl = document.createElement("div");
  foutEl.className = "foutmelding";

  const opslaanKnop = document.createElement("button");
  opslaanKnop.textContent = "Toevoegen aan receptenboek en kiezen";
  opslaanKnop.onclick = () => {
    const naam = naamVeld.value.trim();
    const ingredienten = ingredientenVeld.value
      .split("\n")
      .map((r) => r.trim())
      .filter(Boolean);

    if (!naam || ingredienten.length === 0) {
      foutEl.textContent = "Vul een naam en minstens 1 ingrediënt in.";
      return;
    }

    const categorie = staat.weekmenu[index].categorie;
    const nieuwGerecht = { naam, label: LABEL_VOOR_CATEGORIE[categorie], actief: true, ingredienten };

    staat.receptenboek.push(nieuwGerecht);
    staat.receptenboekRuweTekst = staat.receptenboekRuweTekst.trimEnd() + "\n\n" + bouwReceptenboekBlok(nieuwGerecht) + "\n";
    staat.receptenboekGewijzigd = true;
    staat.pools = bepaalPools(staat.receptenboek);

    const dagLabel = staat.weekmenu[index].dag;
    staat.weekmenu[index] = { dag: dagLabel, naam, ingredienten, categorie };
    renderWeekmenu();
  };

  form.appendChild(naamVeld);
  form.appendChild(ingredientenVeld);
  form.appendChild(opslaanKnop);
  form.appendChild(foutEl);
  kaart.appendChild(form);
  naamVeld.focus();
}

function renderLosseProducten() {
  losseLijstEl.innerHTML = "";
  staat.losseProducten.forEach((item, i) => {
    const rij = document.createElement("div");
    rij.className = "losse-item";

    const label = document.createElement("span");
    label.textContent = `${item.aantal} x ${item.naam}`;
    rij.appendChild(label);

    const verwijderKnop = document.createElement("button");
    verwijderKnop.textContent = "✕";
    verwijderKnop.onclick = () => {
      staat.losseProducten.splice(i, 1);
      renderLosseProducten();
    };
    rij.appendChild(verwijderKnop);

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
  renderLosseProducten();
  losNaamEl.focus();
};

async function laadWeekmenuScherm() {
  toonScherm(schermLaden);

  const [receptenTekst, dagOptiesTekst, standaardTekst, geschiedenisTekst] = await Promise.all([
    haalTekstBestandOp("receptenboek.txt"),
    haalTekstBestandOp("dag_opties.txt"),
    haalTekstBestandOp("standaardlijst.txt"),
    haalTekstBestandOp("weekmenu_geschiedenis.txt"),
  ]);

  staat.receptenboek = laadReceptenboek(receptenTekst);
  staat.receptenboekRuweTekst = receptenTekst;
  staat.receptenboekGewijzigd = false;
  staat.dagOpties = laadDagOpties(dagOptiesTekst);
  staat.standaardlijst = laadStandaardlijst(standaardTekst);
  staat.geschiedenis = laadGeschiedenis(geschiedenisTekst);
  staat.evenWeek = isEvenWeek();
  staat.pools = bepaalPools(staat.receptenboek);
  staat.weekmenu = stelWeekmenuSamen(staat.pools, staat.dagOpties, staat.evenWeek, staat.geschiedenis);
  staat.losseProducten = [];

  renderWeekmenu();
  renderLosseProducten();
  toonScherm(appEl);
}

async function bestelNu() {
  const startTijd = new Date();
  bestelKnop.disabled = true;
  statusEl.textContent = "Bezig met opslaan van je weekmenu...";

  try {
    if (staat.receptenboekGewijzigd) {
      await githubPutFile("receptenboek.txt", staat.receptenboekRuweTekst, "Nieuw gerecht toegevoegd via de website");
    }

    const alleProducten = [...staat.standaardlijst, ...staat.losseProducten];
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

document.getElementById("token-knop").onclick = () => {
  const waarde = document.getElementById("token-invoer").value.trim();
  if (!waarde) {
    document.getElementById("token-fout").textContent = "Vul een geldige sleutel in.";
    return;
  }
  localStorage.setItem(TOKEN_KEY, waarde);
  laadWeekmenuScherm();
};

bestelKnop.onclick = bestelNu;

if (localStorage.getItem(UNLOCKED_KEY) === "1") {
  initApp();
} else {
  toonScherm(schermPin);
}
