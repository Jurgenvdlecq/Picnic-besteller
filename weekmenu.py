"""
Weekmenu-tool (v4 — weekrooster met personen-per-dag + zaterdag)
------------------------------------------------------------------
Stelt een weekmenu samen volgens een vast weekrooster (WEEKROOSTER
hieronder bepaalt het aantal personen per dag):

    Maandag    - altijd 4 personen. "makkelijk"-gerecht uit het receptenboek
                 (snel, max ~20-25 minuten).
    Dinsdag    - altijd 4 personen. Willekeurige combi aardappel+vlees+groente.
    Woensdag   - altijd 2 personen. Vrije rotatie uit de algemene pool.
    Donderdag  - altijd 2 personen. Vrije rotatie uit de algemene pool
                 (nooit hetzelfde als woensdag).
    Vrijdag    - oneven week: 4 personen, "vrijdag_veel"-gerecht.
                 even week: 2 personen, vlees+groente combi.
    Zaterdag   - zelfde patroon als vrijdag (oneven=4p, even=2p), put uit
                 dezelfde pools maar sluit vrijdags keuze uit zodat ze
                 niet gelijk zijn.
    Zondag     - altijd 4 personen, altijd patat (airfryer) + snack(s).

Gerechten met "Basispersonen: N" in het receptenboek worden automatisch
op- of afgeschaald naar het daadwerkelijke aantal personen die dag
(bijv. bij een handmatige personen-aanpassing op de website).

Alleen recepten met "Actief: ja" (of geen Actief-regel) doen mee in de
automatische rotatie, en nooit gerechten met de tag "niet-meer-tonen"
(gezet nadat je een gerecht na het eten met "niet meer" beoordeelt).

Daarnaast wordt een vaste standaardlijst (boodschappen die elke week
terugkomen) automatisch toegevoegd.

Resultaat: "boodschappenlijst.txt", klaar voor picnic_boodschappen.py.

BESTANDEN:
    receptenboek.txt    - alle recepten (+ Label/Basispersonen/Tags/Actief)
    dag_opties.txt      - losse lijstjes voor dinsdag/vrijdag/zaterdag/zondag
    standaardlijst.txt  - vaste wekelijkse boodschappen (optioneel per categorie)

GEBRUIK:
    python3 weekmenu.py

    Bij het aanpassen van maandag/woensdag/donderdag/vrijdag_veel/
    zaterdag_veel kun je, in plaats van Enter te drukken voor een
    willekeurig alternatief, ook een receptnaam (of een deel ervan)
    typen — dan wordt dat recept gekozen, ook als het normaal niet in de
    rotatie zit (Actief: nee).

    Met de vlag --automatisch wordt het voorgestelde weekmenu direct
    geaccepteerd zonder vragen te stellen (voor gebruik zonder Terminal,
    bijv. via GitHub Actions).
"""

import argparse
import math
import random
import re
import sys
from datetime import date, timedelta
from pathlib import Path

RECEPTENBOEK_BESTAND = Path(__file__).parent / "receptenboek.txt"
DAG_OPTIES_BESTAND = Path(__file__).parent / "dag_opties.txt"
STANDAARDLIJST_BESTAND = Path(__file__).parent / "standaardlijst.txt"
VOORRAAD_BESTAND = Path(__file__).parent / "voorraad.txt"
GESCHIEDENIS_BESTAND = Path(__file__).parent / "weekmenu_geschiedenis.txt"
BOODSCHAPPENLIJST = Path(__file__).parent / "boodschappenlijst.txt"

# Voorraadartikelen (rijst, pasta, koffie, wc-papier, ...) gaan over veel
# gerechten heen (een zak rijst van 1 kilo doe je misschien wel 10 gerechten
# mee) — "dit gerecht gebruikt rijst" zegt dus niks over of je deze week
# rijst nodig hebt. Een normale hoeveelheid voor zo'n artikel wordt daarom
# NIET automatisch meegeteld in de boodschappenlijst; alleen een ongewoon
# grote hoeveelheid voor één gerecht (bv. 10 eieren voor een bakrecept) is
# duidelijk gerecht-specifieke vraag en telt gewoon mee.
VOORRAAD_DREMPEL = 4

AANTAL_PATROON = re.compile(r"^\s*(\d+)\s*[xX]\s*(.+)$")

# Vast weekrooster: personen per dag-categorie. Vrijdag/zaterdag hangen af
# van even/oneven weeknummer (zie is_even_week()).
WEEKROOSTER_VAST = {
    "maandag": 4,
    "dinsdag": 4,
    "woensdag": 2,
    "donderdag": 2,
    "zondag": 4,
}


def personen_voor(categorie: str, even_week: bool) -> int:
    if categorie in WEEKROOSTER_VAST:
        return WEEKROOSTER_VAST[categorie]
    if categorie in ("vrijdag", "zaterdag"):
        return 2 if even_week else 4
    return 2


# ---------------------------------------------------------------------------
# Bestanden aanmaken bij eerste gebruik (minimaal voorbeeld, met verwijzing
# naar de uitgebreide versie die je al hebt ingevuld).
# ---------------------------------------------------------------------------

def zorg_dat_bestand_bestaat(pad: Path, voorbeeldtekst: str, omschrijving: str) -> bool:
    """Maakt het bestand aan met voorbeeldtekst als het nog niet bestaat.
    Geeft True terug als het bestand al bestond, anders False."""
    if pad.exists():
        return True
    pad.write_text(voorbeeldtekst, encoding="utf-8")
    print(f"Geen {omschrijving} gevonden — een voorbeeldbestand is aangemaakt op:")
    print(f"  {pad}")
    return False


VOORBEELD_RECEPTENBOEK = """\
# Receptenboek
Gerecht: Kip met rijst en paprika
Basispersonen: 2
1 x kipfilet
1 x rijst
2 x paprika

Gerecht: Pasta bolognese uit een pot
Label: makkelijk
Basispersonen: 4
1 x gehakt
1 x pasta
1 x bolognesesaus pot
"""

VOORBEELD_DAG_OPTIES = """\
== dinsdag_aardappel ==
Aardappelblokjes

== dinsdag_vlees ==
Hamburger

== groente ==
Broccoli

== vrijdag_vlees_klein ==
Biefstuk

== zondag_snack ==
Frikandel
"""

VOORBEELD_STANDAARDLIJST = """\
# Standaardlijst
1 x Melk
1 x Eieren
"""


# ---------------------------------------------------------------------------
# Inlezen
# ---------------------------------------------------------------------------

def parse_aantal_naam(regel: str) -> dict:
    match = AANTAL_PATROON.match(regel)
    if match:
        return {"naam": match.group(2).strip(), "aantal": int(match.group(1))}
    return {"naam": regel.strip(), "aantal": 1}


def laad_receptenboek() -> list:
    gerechten = []
    huidig = None

    for regel in RECEPTENBOEK_BESTAND.read_text(encoding="utf-8").splitlines():
        regel = regel.strip()
        if not regel or regel.startswith("#"):
            continue

        if regel.lower().startswith("gerecht:"):
            if huidig:
                gerechten.append(huidig)
            huidig = {
                "naam": regel.split(":", 1)[1].strip(),
                "label": None,
                "vlees": None,
                "basis_personen": 2,
                "tags": [],
                "actief": True,
                "ingredienten": [],
            }
        elif regel.lower().startswith("vlees:") and huidig is not None:
            huidig["vlees"] = regel.split(":", 1)[1].strip().lower()
        elif regel.lower().startswith("label:") and huidig is not None:
            huidig["label"] = regel.split(":", 1)[1].strip().lower()
        elif regel.lower().startswith("basispersonen:") and huidig is not None:
            try:
                huidig["basis_personen"] = int(regel.split(":", 1)[1].strip())
            except ValueError:
                pass
        elif regel.lower().startswith("tags:") and huidig is not None:
            huidig["tags"] = [t.strip().lower() for t in regel.split(":", 1)[1].split(",") if t.strip()]
        elif regel.lower().startswith("actief:") and huidig is not None:
            huidig["actief"] = regel.split(":", 1)[1].strip().lower() in ("ja", "yes", "true", "1")
        elif huidig is not None:
            huidig["ingredienten"].append(regel)

    if huidig:
        gerechten.append(huidig)

    return gerechten


def zoek_recepten_op_naam(receptenboek: list, zoekterm: str) -> list:
    """Zoekt (hoofdletterongevoelig, deel van de naam) in het VOLLEDIGE
    receptenboek, inclusief Actief: nee-recepten."""
    zoekterm = zoekterm.strip().lower()
    return [g for g in receptenboek if zoekterm in g["naam"].lower()]


def laad_dag_opties() -> dict:
    secties = {}
    huidige_sectie = None

    for regel in DAG_OPTIES_BESTAND.read_text(encoding="utf-8").splitlines():
        regel = regel.strip()
        if not regel or regel.startswith("#"):
            continue

        sectie_match = re.match(r"^==\s*(.+?)\s*==$", regel)
        if sectie_match:
            huidige_sectie = sectie_match.group(1).strip().lower()
            secties[huidige_sectie] = []
        elif huidige_sectie is not None:
            secties[huidige_sectie].append(parse_aantal_naam(regel))

    return secties


def laad_standaardlijst() -> list:
    """Leest de (optioneel per categorie ingedeelde) standaardlijst plat
    in — de categorie-indeling is alleen relevant voor de website-weergave,
    voor de boodschappenlijst zelf maakt de categorie niet uit."""
    items = []
    for regel in STANDAARDLIJST_BESTAND.read_text(encoding="utf-8").splitlines():
        regel = regel.strip()
        if not regel or regel.startswith("#"):
            continue
        if re.match(r"^==\s*(.+?)\s*==$", regel):
            continue
        items.append(parse_aantal_naam(regel))
    return items


def laad_voorraad_namen() -> set:
    """Namen (lowercase) van alle voorraadartikelen uit voorraad.txt, plat
    over alle categorieën heen. Bestand is optioneel bij dit
    command-line-pad (i.h.t. de website is er hier geen sessie waarin je kan
    aangeven wat er "bijna op" is — zie schrijf_boodschappenlijst)."""
    if not VOORRAAD_BESTAND.exists():
        return set()
    namen = set()
    for regel in VOORRAAD_BESTAND.read_text(encoding="utf-8").splitlines():
        regel = regel.strip()
        if not regel or regel.startswith("#") or re.match(r"^==\s*(.+?)\s*==$", regel):
            continue
        namen.add(regel.lower())
    return namen


def is_onderdrukbaar_voorraad_artikel(naam: str, aantal: int, voorraad_namen: set) -> bool:
    return naam.lower() in voorraad_namen and aantal <= VOORRAAD_DREMPEL


# ---------------------------------------------------------------------------
# Geschiedenis (om herhaling binnen elke categorie te voorkomen)
# ---------------------------------------------------------------------------

def laad_geschiedenis() -> dict:
    """Geeft per categorie een lijst van eerder gekozen namen terug
    (oudste eerst)."""
    geschiedenis = {}
    if not GESCHIEDENIS_BESTAND.exists():
        return geschiedenis

    for regel in GESCHIEDENIS_BESTAND.read_text(encoding="utf-8").splitlines():
        if "|" not in regel:
            continue
        categorie, naam = regel.split("|", 1)
        geschiedenis.setdefault(categorie.strip(), []).append(naam.strip())

    return geschiedenis


def sla_geschiedenis_op(geschiedenis: dict):
    regels = []
    for categorie, namen in geschiedenis.items():
        for naam in namen[-15:]:  # bewaar per categorie de laatste 15 keuzes
            regels.append(f"{categorie}|{naam}")
    GESCHIEDENIS_BESTAND.write_text("\n".join(regels) + "\n", encoding="utf-8")


def kies_uit_pool(pool: list, categorie: str, geschiedenis: dict, uitgesloten_naam: str = None) -> dict:
    """Kiest 1 gerecht uit een pool, met voorrang voor gerechten die het
    langst niet gekozen zijn binnen deze categorie. Met uitgesloten_naam
    kun je voorkomen dat dezelfde week een gerecht 2x gekozen wordt (bijv.
    woensdag en donderdag, of vrijdag en zaterdag, die uit dezelfde pool
    putten). Gerechten met de tag "niet-meer-tonen" worden altijd
    overgeslagen."""
    bruikbaar = [g for g in pool if "niet-meer-tonen" not in (g.get("tags") or [])]
    if not bruikbaar:
        return None

    kandidaten_pool = bruikbaar
    if uitgesloten_naam:
        gefilterd = [g for g in bruikbaar if g["naam"] != uitgesloten_naam]
        if gefilterd:
            kandidaten_pool = gefilterd

    eerdere_keuzes = geschiedenis.get(categorie, [])

    def recentheid(gerecht):
        naam = gerecht["naam"]
        if naam not in eerdere_keuzes:
            return -1
        return len(eerdere_keuzes) - 1 - eerdere_keuzes[::-1].index(naam)

    gesorteerd = sorted(kandidaten_pool, key=recentheid)
    kandidaten = gesorteerd[: max(2, len(gesorteerd) // 2)]
    return random.choice(kandidaten)


# ---------------------------------------------------------------------------
# Weekbepaling
# ---------------------------------------------------------------------------

def is_even_week() -> bool:
    vandaag = date.today()
    dagen_tot_maandag = (7 - vandaag.weekday()) % 7
    komende_maandag = vandaag + timedelta(days=dagen_tot_maandag)
    return komende_maandag.isocalendar()[1] % 2 == 0


# ---------------------------------------------------------------------------
# Schalen naar personen
# ---------------------------------------------------------------------------

def schaal_ingredienten(ingredienten: list, basis_personen: int, doel_personen: int) -> list:
    """Schaalt "N x product"-regels van basis_personen naar doel_personen.
    Rond naar boven af (liever iets te ruim dan te weinig), maar verdubbelt
    niet onnodig als het al klopt (factor 1 = geen wijziging)."""
    if not basis_personen or basis_personen <= 0:
        basis_personen = 2
    factor = doel_personen / basis_personen
    if factor == 1:
        return list(ingredienten)

    resultaat = []
    for regel in ingredienten:
        item = parse_aantal_naam(regel)
        nieuw_aantal = max(1, math.ceil(item["aantal"] * factor))
        resultaat.append(f"{nieuw_aantal} x {item['naam']}")
    return resultaat


# ---------------------------------------------------------------------------
# Dagmenu samenstellen
# ---------------------------------------------------------------------------

def combineer_ingredienten(*groepen) -> list:
    """Voegt losse dag-optie-items samen tot een 'virtueel gerecht' met
    ingrediënten in het standaardformaat "aantal x naam"."""
    ingredienten = []
    for item in groepen:
        if item is None:
            continue
        ingredienten.append(f"{item['aantal']} x {item['naam']}")
    return ingredienten


def bepaal_pools(receptenboek: list) -> dict:
    actieve_recepten = [g for g in receptenboek if g["actief"] and "niet-meer-tonen" not in (g.get("tags") or [])]

    return {
        "makkelijk": [g for g in actieve_recepten if g["label"] == "makkelijk"],
        # Vrijdag én zaterdag putten (bij 4 personen) allebei uit deze pool.
        "vrijdag_veel": [g for g in actieve_recepten if g["label"] == "vrijdag_veel"],
        # Woensdag en donderdag putten allebei uit deze "algemeen"-pool
        # (zie kies_uit_pool's uitgesloten_naam: zo krijgen ze binnen
        # dezelfde week niet toevallig hetzelfde gerecht).
        "algemeen": [g for g in actieve_recepten if g["label"] is None],
    }


def kies_dinsdag(dag_opties: dict) -> dict:
    aardappel = random.choice(dag_opties.get("dinsdag_aardappel", [])) if dag_opties.get("dinsdag_aardappel") else None
    vlees = random.choice(dag_opties.get("dinsdag_vlees", [])) if dag_opties.get("dinsdag_vlees") else None
    groente = random.choice(dag_opties.get("groente", [])) if dag_opties.get("groente") else None
    naam = " + ".join(filter(None, [
        aardappel["naam"] if aardappel else None,
        vlees["naam"] if vlees else None,
        groente["naam"] if groente else None,
    ]))
    return {"dag": "Dinsdag", "naam": naam,
            "ingredienten": combineer_ingredienten(aardappel, vlees, groente), "categorie": "dinsdag",
            "personen": 4}


def kies_vrijdag_of_zaterdag(dag_label: str, veel_categorie: str, klein_categorie: str,
                              dag_opties: dict, pools: dict, personen: int, geschiedenis: dict,
                              uitgesloten_naam: str = None) -> dict:
    if personen == 4:
        gerecht = kies_uit_pool(pools["vrijdag_veel"], veel_categorie, geschiedenis, uitgesloten_naam=uitgesloten_naam)
        naam = gerecht["naam"] if gerecht else "(geen 'vrijdag_veel'-gerecht gevonden)"
        ingredienten = schaal_ingredienten(gerecht["ingredienten"], gerecht.get("basis_personen", 4), 4) if gerecht else []
        return {"dag": f"{dag_label} (4p)", "naam": naam, "ingredienten": ingredienten,
                "categorie": veel_categorie, "personen": 4, "vlees": gerecht["vlees"] if gerecht else None}

    vlees = random.choice(dag_opties.get("vrijdag_vlees_klein", [])) if dag_opties.get("vrijdag_vlees_klein") else None
    groente = random.choice(dag_opties.get("groente", [])) if dag_opties.get("groente") else None
    naam = " + ".join(filter(None, [
        vlees["naam"] if vlees else None,
        groente["naam"] if groente else None,
    ]))
    return {"dag": f"{dag_label} (2p)", "naam": naam,
            "ingredienten": combineer_ingredienten(vlees, groente), "categorie": klein_categorie,
            "personen": 2}


def kies_zondag(dag_opties: dict) -> dict:
    snack = random.choice(dag_opties.get("zondag_snack", [])) if dag_opties.get("zondag_snack") else None
    patat = {"naam": "Patat (airfryer)", "aantal": 1}
    naam = f"Patat + {snack['naam']}" if snack else "Patat (airfryer)"
    return {"dag": "Zondag", "naam": naam,
            "ingredienten": combineer_ingredienten(patat, snack), "categorie": "zondag",
            "personen": 4}


def _gerecht_dag_entry(dag_label: str, categorie: str, gerecht: dict, personen: int) -> dict:
    ingredienten = schaal_ingredienten(gerecht["ingredienten"], gerecht.get("basis_personen", 2), personen) if gerecht else []
    return {
        "dag": dag_label,
        "naam": gerecht["naam"] if gerecht else "(pool leeg)",
        "ingredienten": ingredienten,
        "categorie": categorie,
        "personen": personen,
        "vlees": gerecht["vlees"] if gerecht else None,
    }


def stel_weekmenu_samen(pools: dict, dag_opties: dict, even_week: bool, geschiedenis: dict) -> list:
    weekmenu = []

    ma_personen = personen_voor("maandag", even_week)
    ma_gerecht = kies_uit_pool(pools["makkelijk"], "maandag", geschiedenis)
    weekmenu.append(_gerecht_dag_entry("Maandag", "maandag", ma_gerecht, ma_personen))

    weekmenu.append(kies_dinsdag(dag_opties))

    woe_personen = personen_voor("woensdag", even_week)
    do_personen = personen_voor("donderdag", even_week)
    doo = kies_uit_pool(pools["algemeen"], "donderdag", geschiedenis)
    woe = kies_uit_pool(pools["algemeen"], "woensdag", geschiedenis, uitgesloten_naam=doo["naam"] if doo else None)
    weekmenu.append(_gerecht_dag_entry("Woensdag", "woensdag", woe, woe_personen))
    weekmenu.append(_gerecht_dag_entry("Donderdag", "donderdag", doo, do_personen))

    vrijdag_personen = personen_voor("vrijdag", even_week)
    vrijdag = kies_vrijdag_of_zaterdag("Vrijdag", "vrijdag_veel", "vrijdag_klein", dag_opties, pools,
                                        vrijdag_personen, geschiedenis)
    weekmenu.append(vrijdag)

    zaterdag_personen = personen_voor("zaterdag", even_week)
    zaterdag = kies_vrijdag_of_zaterdag("Zaterdag", "zaterdag_veel", "zaterdag_klein", dag_opties, pools,
                                         zaterdag_personen, geschiedenis, uitgesloten_naam=vrijdag["naam"])
    weekmenu.append(zaterdag)

    weekmenu.append(kies_zondag(dag_opties))

    return weekmenu


# ---------------------------------------------------------------------------
# Boodschappenlijst schrijven
# ---------------------------------------------------------------------------

def schrijf_boodschappenlijst(weekmenu: list, standaardlijst: list, voorraad_namen: set = None):
    """Let op: dit command-line-pad kent geen website-sessie, dus er is hier
    geen manier om aan te geven dat een voorraadartikel "bijna op" is — een
    onderdrukt voorraadartikel komt via dit pad dus nooit op de
    boodschappenlijst terecht, in tegenstelling tot de website (waar de
    voorraadcheck dat als aanvulling regelt). Wie dit script los draait en
    toch rijst/pasta/koffie e.d. nodig heeft, voegt dat zelf toe."""
    voorraad_namen = voorraad_namen or set()
    totalen = {}

    def voeg_toe(naam: str, aantal: int):
        sleutel = naam.lower()
        if sleutel in totalen:
            totalen[sleutel]["aantal"] += aantal
        else:
            totalen[sleutel] = {"naam": naam, "aantal": aantal}

    for dag in weekmenu:
        for regel in dag["ingredienten"]:
            item = parse_aantal_naam(regel)
            if is_onderdrukbaar_voorraad_artikel(item["naam"], item["aantal"], voorraad_namen):
                continue
            voeg_toe(item["naam"], item["aantal"])

    for item in standaardlijst:
        voeg_toe(item["naam"], item["aantal"])

    regels = [f"# Weekmenu:"]
    for dag in weekmenu:
        regels.append(f"#   {dag['dag']}: {dag['naam']} ({dag.get('personen', '?')}p)")
    regels.append("#")
    for item in totalen.values():
        regels.append(f"{item['aantal']} x {item['naam']}")

    BOODSCHAPPENLIJST.write_text("\n".join(regels) + "\n", encoding="utf-8")


# ---------------------------------------------------------------------------
# Interactieve aanpassing
# ---------------------------------------------------------------------------

NAAM_TYPBARE_CATEGORIEEN = {"maandag", "woensdag", "donderdag", "vrijdag_veel", "zaterdag_veel"}


def herkies_dag(weekmenu: list, index: int, pools: dict, dag_opties: dict, even_week: bool, geschiedenis: dict) -> bool:
    """Kiest alléén de opgegeven dag opnieuw (willekeurig). Geeft True terug
    als er daadwerkelijk iets anders gekozen is, anders False."""
    categorie = weekmenu[index]["categorie"]
    vorige_naam = weekmenu[index]["naam"]
    personen = weekmenu[index].get("personen", 2)

    def ander_dag_naam(cat_naam):
        gevonden = next((d for d in weekmenu if d["categorie"] == cat_naam), None)
        return gevonden["naam"] if gevonden else None

    herkies_functies = {
        "maandag": lambda: _gerecht_dag_entry(
            "Maandag", "maandag", kies_uit_pool(pools["makkelijk"], "maandag", geschiedenis), personen),
        "dinsdag": lambda: kies_dinsdag(dag_opties),
        "woensdag": lambda: _gerecht_dag_entry(
            "Woensdag", "woensdag",
            kies_uit_pool(pools["algemeen"], "woensdag", geschiedenis, uitgesloten_naam=ander_dag_naam("donderdag")),
            personen),
        "donderdag": lambda: _gerecht_dag_entry(
            "Donderdag", "donderdag",
            kies_uit_pool(pools["algemeen"], "donderdag", geschiedenis, uitgesloten_naam=ander_dag_naam("woensdag")),
            personen),
        "vrijdag_veel": lambda: kies_vrijdag_of_zaterdag(
            "Vrijdag", "vrijdag_veel", "vrijdag_klein", dag_opties, pools, personen, geschiedenis,
            uitgesloten_naam=ander_dag_naam("zaterdag_veel")),
        "vrijdag_klein": lambda: kies_vrijdag_of_zaterdag(
            "Vrijdag", "vrijdag_veel", "vrijdag_klein", dag_opties, pools, personen, geschiedenis),
        "zaterdag_veel": lambda: kies_vrijdag_of_zaterdag(
            "Zaterdag", "zaterdag_veel", "zaterdag_klein", dag_opties, pools, personen, geschiedenis,
            uitgesloten_naam=ander_dag_naam("vrijdag_veel")),
        "zaterdag_klein": lambda: kies_vrijdag_of_zaterdag(
            "Zaterdag", "zaterdag_veel", "zaterdag_klein", dag_opties, pools, personen, geschiedenis),
        "zondag": lambda: kies_zondag(dag_opties),
    }

    if categorie not in herkies_functies:
        return False

    for _ in range(10):
        nieuw = herkies_functies[categorie]()
        if nieuw["naam"] != vorige_naam:
            weekmenu[index] = nieuw
            return True

    print("Kon geen ander alternatief vinden voor deze dag (te weinig opties in de pool).")
    return False


def kies_recept_op_naam(weekmenu: list, index: int, receptenboek: list, zoekterm: str) -> bool:
    """Zoekt zoekterm op in het VOLLEDIGE receptenboek (ook Actief: nee) en
    kiest, bij precies 1 match, dat recept voor de opgegeven dag. Bij
    meerdere matches laat het de gebruiker kiezen uit een genummerde lijst."""
    matches = zoek_recepten_op_naam(receptenboek, zoekterm)

    if not matches:
        print(f"Geen recept gevonden met '{zoekterm}' in de naam.")
        return False

    if len(matches) > 1:
        print(f"\nMeerdere recepten gevonden met '{zoekterm}':")
        for i, m in enumerate(matches, start=1):
            print(f"  {i}. {m['naam']}")
        keuze = input("Welke bedoel je? (nummer, of Enter om te annuleren): ").strip()
        if not keuze.isdigit() or not (1 <= int(keuze) <= len(matches)):
            print("Geannuleerd.")
            return False
        gekozen = matches[int(keuze) - 1]
    else:
        gekozen = matches[0]

    dag_label = weekmenu[index]["dag"]
    categorie = weekmenu[index]["categorie"]
    personen = weekmenu[index].get("personen", 2)
    weekmenu[index] = _gerecht_dag_entry(dag_label, categorie, gekozen, personen)

    print(f"\n'{gekozen['naam']}' gekozen. Ingrediënten:")
    for regel in weekmenu[index]["ingredienten"]:
        print(f"  - {regel}")

    return True


def laat_gebruiker_aanpassen(weekmenu: list, pools: dict, dag_opties: dict, even_week: bool,
                              geschiedenis: dict, receptenboek: list) -> list:
    while True:
        print("\nVoorgesteld weekmenu:")
        for i, dag in enumerate(weekmenu, start=1):
            print(f"  {i}. {dag['dag']}: {dag['naam']} ({dag.get('personen', '?')}p)")

        antwoord = input(
            "\nDruk Enter om te accepteren, of typ een nummer om die dag opnieuw te laten kiezen: "
        ).strip()

        if not antwoord:
            return weekmenu

        if not antwoord.isdigit() or not (1 <= int(antwoord) <= len(weekmenu)):
            print("Ongeldige keuze, probeer opnieuw.")
            continue

        index = int(antwoord) - 1
        categorie = weekmenu[index]["categorie"]

        if categorie in NAAM_TYPBARE_CATEGORIEEN:
            sub_antwoord = input(
                "Typ een receptnaam (bijv. 'kofta') om dat te kiezen, "
                "of druk Enter voor een willekeurig ander recept: "
            ).strip()
            if sub_antwoord:
                kies_recept_op_naam(weekmenu, index, receptenboek, sub_antwoord)
                continue

        herkies_dag(weekmenu, index, pools, dag_opties, even_week, geschiedenis)


# ---------------------------------------------------------------------------
# Hoofdprogramma
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description="Weekmenu-tool")
    parser.add_argument(
        "--automatisch",
        action="store_true",
        help="Accepteer het voorgestelde weekmenu direct, zonder interactieve vragen "
             "(voor gebruik via een planner zoals GitHub Actions of launchd).",
    )
    args = parser.parse_args()

    bestaat_receptenboek = zorg_dat_bestand_bestaat(RECEPTENBOEK_BESTAND, VOORBEELD_RECEPTENBOEK, "receptenboek")
    bestaat_opties = zorg_dat_bestand_bestaat(DAG_OPTIES_BESTAND, VOORBEELD_DAG_OPTIES, "dag-opties bestand")
    bestaat_standaard = zorg_dat_bestand_bestaat(STANDAARDLIJST_BESTAND, VOORBEELD_STANDAARDLIJST, "standaardlijst")

    if not (bestaat_receptenboek and bestaat_opties and bestaat_standaard):
        print("\nVul de aangemaakte bestanden aan met jullie eigen recepten/producten en start opnieuw.\n")
        sys.exit(0)

    receptenboek = laad_receptenboek()
    dag_opties = laad_dag_opties()
    standaardlijst = laad_standaardlijst()
    voorraad_namen = laad_voorraad_namen()
    geschiedenis = laad_geschiedenis()
    even_week = is_even_week()
    pools = bepaal_pools(receptenboek)

    print(f"Week met vrijdag/zaterdag voor {'2' if even_week else '4'} personen "
          f"({'even' if even_week else 'oneven'} weeknummer).\n")

    weekmenu = stel_weekmenu_samen(pools, dag_opties, even_week, geschiedenis)
    if args.automatisch:
        for dag in weekmenu:
            print(f"  {dag['dag']}: {dag['naam']} ({dag.get('personen', '?')}p)")
    else:
        weekmenu = laat_gebruiker_aanpassen(weekmenu, pools, dag_opties, even_week, geschiedenis, receptenboek)

    schrijf_boodschappenlijst(weekmenu, standaardlijst, voorraad_namen)

    # Geschiedenis bijwerken per categorie
    for dag in weekmenu:
        geschiedenis.setdefault(dag["categorie"], []).append(dag["naam"])
    sla_geschiedenis_op(geschiedenis)

    print(f"\nBoodschappenlijst bijgewerkt: {BOODSCHAPPENLIJST}")
    print("Draai nu picnic_boodschappen.py om alles te laten bestellen.")


if __name__ == "__main__":
    main()
