"""
Weekmenu-tool (v3 — receptenboek + dag-specifiek)
---------------------------------------------------
Stelt een weekmenu samen volgens een vast dagpatroon:

    Maandag    - "makkelijk"-gerecht uit het receptenboek (wereldgerecht/pasta/rijst)
    Dinsdag    - AVG: willekeurige combi aardappel + vlees + groente
    Woensdag   - altijd hetzelfde vaste gerecht (kip met rijst)
    Donderdag  - vrije rotatie uit de algemene pool ("wees creatief")
    Vrijdag    - even week (4p): "vrijdag_veel"-gerecht uit het receptenboek
                 oneven week (2p): vlees + groente combi
    Zaterdag   - overgeslagen (wisselend, hoeft niet in het menu)
    Zondag     - altijd patat (airfryer) + willekeurige snack

Alleen recepten met "Actief: ja" (of geen Actief-regel) doen mee in de
automatische rotatie. Recepten met "Actief: nee" staan wél in het boek om
te raadplegen of handmatig te kiezen (typ een naam bij het aanpassen van
een dag), maar worden nooit automatisch voorgesteld.

Daarnaast wordt een vaste standaardlijst (boodschappen die elke week
terugkomen) automatisch toegevoegd.

Resultaat: "boodschappenlijst.txt", klaar voor picnic_boodschappen.py.

BESTANDEN:
    receptenboek.txt    - alle recepten (+ Label:, + Actief: ja/nee)
    dag_opties.txt      - losse lijstjes voor dinsdag/vrijdag/zondag
    standaardlijst.txt  - vaste wekelijkse boodschappen

GEBRUIK:
    python3 weekmenu.py

    Bij het aanpassen van maandag/donderdag/vrijdag kun je, in plaats van
    Enter te drukken voor een willekeurig alternatief, ook een receptnaam
    (of een deel ervan) typen — dan wordt dat recept gekozen, ook als het
    normaal niet in de rotatie zit (Actief: nee).

    Met de vlag --automatisch wordt het voorgestelde weekmenu direct
    geaccepteerd zonder vragen te stellen (voor gebruik zonder Terminal,
    bijv. via GitHub Actions).
"""

import argparse
import random
import re
import sys
from datetime import date, timedelta
from pathlib import Path

RECEPTENBOEK_BESTAND = Path(__file__).parent / "receptenboek.txt"
DAG_OPTIES_BESTAND = Path(__file__).parent / "dag_opties.txt"
STANDAARDLIJST_BESTAND = Path(__file__).parent / "standaardlijst.txt"
GESCHIEDENIS_BESTAND = Path(__file__).parent / "weekmenu_geschiedenis.txt"
BOODSCHAPPENLIJST = Path(__file__).parent / "boodschappenlijst.txt"

WOENSDAG_GERECHT = "kip met rijst en paprika"  # moet exact overeenkomen (hoofdletterongevoelig)

AANTAL_PATROON = re.compile(r"^\s*(\d+)\s*[xX]\s*(.+)$")


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
1 x kipfilet
1 x rijst
2 x paprika

Gerecht: Pasta bolognese uit een pot
Label: makkelijk
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
            huidig = {"naam": regel.split(":", 1)[1].strip(), "label": None, "actief": True, "ingredienten": []}
        elif regel.lower().startswith("label:") and huidig is not None:
            huidig["label"] = regel.split(":", 1)[1].strip().lower()
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
    return [
        parse_aantal_naam(regel)
        for regel in STANDAARDLIJST_BESTAND.read_text(encoding="utf-8").splitlines()
        if regel.strip() and not regel.strip().startswith("#")
    ]


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


def kies_uit_pool(pool: list, categorie: str, geschiedenis: dict) -> dict:
    """Kiest 1 gerecht uit een pool, met voorrang voor gerechten die het
    langst niet gekozen zijn binnen deze categorie."""
    if not pool:
        return None

    eerdere_keuzes = geschiedenis.get(categorie, [])

    def recentheid(gerecht):
        naam = gerecht["naam"]
        if naam not in eerdere_keuzes:
            return -1
        return len(eerdere_keuzes) - 1 - eerdere_keuzes[::-1].index(naam)

    gesorteerd = sorted(pool, key=recentheid)
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
    # Woensdag mag ook gevonden worden als het toevallig Actief: nee heeft
    # (het is een vast gerecht, geen onderdeel van de "rotatie").
    woensdag_gerecht = next(
        (g for g in receptenboek if g["naam"].strip().lower() == WOENSDAG_GERECHT), None
    )
    if not woensdag_gerecht:
        print(f"⚠ Let op: geen gerecht gevonden met de naam '{WOENSDAG_GERECHT}' in {RECEPTENBOEK_BESTAND.name}.")
        woensdag_gerecht = {"naam": "Kip met rijst (niet gevonden in receptenboek)", "ingredienten": []}

    actieve_recepten = [g for g in receptenboek if g["actief"]]

    return {
        "makkelijk": [g for g in actieve_recepten if g["label"] == "makkelijk"],
        "vrijdag_veel": [g for g in actieve_recepten if g["label"] == "vrijdag_veel"],
        "algemeen": [
            g for g in actieve_recepten
            if g["label"] is None and g["naam"].strip().lower() != WOENSDAG_GERECHT
        ],
        "woensdag": woensdag_gerecht,
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
            "ingredienten": combineer_ingredienten(aardappel, vlees, groente), "categorie": "dinsdag"}


def kies_vrijdag(dag_opties: dict, pools: dict, even_week: bool, geschiedenis: dict) -> dict:
    if even_week:
        gerecht = kies_uit_pool(pools["vrijdag_veel"], "vrijdag_veel", geschiedenis)
        return {"dag": "Vrijdag (4p)", "naam": gerecht["naam"] if gerecht else "(geen 'vrijdag_veel'-gerecht gevonden)",
                "ingredienten": gerecht["ingredienten"] if gerecht else [], "categorie": "vrijdag_veel"}

    vlees = random.choice(dag_opties.get("vrijdag_vlees_klein", [])) if dag_opties.get("vrijdag_vlees_klein") else None
    groente = random.choice(dag_opties.get("groente", [])) if dag_opties.get("groente") else None
    naam = " + ".join(filter(None, [
        vlees["naam"] if vlees else None,
        groente["naam"] if groente else None,
    ]))
    return {"dag": "Vrijdag (2p)", "naam": naam,
            "ingredienten": combineer_ingredienten(vlees, groente), "categorie": "vrijdag_klein"}


def kies_zondag(dag_opties: dict) -> dict:
    snack = random.choice(dag_opties.get("zondag_snack", [])) if dag_opties.get("zondag_snack") else None
    patat = {"naam": "Patat (airfryer)", "aantal": 1}
    naam = f"Patat + {snack['naam']}" if snack else "Patat (airfryer)"
    return {"dag": "Zondag", "naam": naam,
            "ingredienten": combineer_ingredienten(patat, snack), "categorie": "zondag"}


def stel_weekmenu_samen(pools: dict, dag_opties: dict, even_week: bool, geschiedenis: dict) -> list:
    weekmenu = []

    ma_gerecht = kies_uit_pool(pools["makkelijk"], "maandag", geschiedenis)
    weekmenu.append({"dag": "Maandag", "naam": ma_gerecht["naam"] if ma_gerecht else "(geen 'makkelijk'-gerecht gevonden)",
                      "ingredienten": ma_gerecht["ingredienten"] if ma_gerecht else [], "categorie": "maandag"})

    weekmenu.append(kies_dinsdag(dag_opties))

    weekmenu.append({"dag": "Woensdag", "naam": pools["woensdag"]["naam"],
                      "ingredienten": pools["woensdag"]["ingredienten"], "categorie": "woensdag"})

    do_gerecht = kies_uit_pool(pools["algemeen"], "donderdag", geschiedenis)
    weekmenu.append({"dag": "Donderdag", "naam": do_gerecht["naam"] if do_gerecht else "(pool leeg)",
                      "ingredienten": do_gerecht["ingredienten"] if do_gerecht else [], "categorie": "donderdag"})

    weekmenu.append(kies_vrijdag(dag_opties, pools, even_week, geschiedenis))

    # Zaterdag: bewust overgeslagen

    weekmenu.append(kies_zondag(dag_opties))

    return weekmenu


# ---------------------------------------------------------------------------
# Boodschappenlijst schrijven
# ---------------------------------------------------------------------------

def schrijf_boodschappenlijst(weekmenu: list, standaardlijst: list):
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
            voeg_toe(item["naam"], item["aantal"])

    for item in standaardlijst:
        voeg_toe(item["naam"], item["aantal"])

    regels = [f"# Weekmenu:"]
    for dag in weekmenu:
        regels.append(f"#   {dag['dag']}: {dag['naam']}")
    regels.append("#")
    for item in totalen.values():
        regels.append(f"{item['aantal']} x {item['naam']}")

    BOODSCHAPPENLIJST.write_text("\n".join(regels) + "\n", encoding="utf-8")


# ---------------------------------------------------------------------------
# Interactieve aanpassing
# ---------------------------------------------------------------------------

NAAM_TYPBARE_CATEGORIEEN = {"maandag", "donderdag", "vrijdag_veel"}


def maak_dag_entry(dag_label: str, categorie: str, gerecht: dict) -> dict:
    return {
        "dag": dag_label,
        "naam": gerecht["naam"],
        "ingredienten": gerecht["ingredienten"],
        "categorie": categorie,
    }


def herkies_dag(weekmenu: list, index: int, pools: dict, dag_opties: dict, even_week: bool, geschiedenis: dict) -> bool:
    """Kiest alléén de opgegeven dag opnieuw (willekeurig). Geeft True terug
    als er daadwerkelijk iets anders gekozen is, anders False."""
    categorie = weekmenu[index]["categorie"]
    vorige_naam = weekmenu[index]["naam"]

    if categorie == "woensdag":
        print("Woensdag is een vast gerecht en kan niet gewisseld worden.")
        return False

    herkies_functies = {
        "maandag": lambda: (lambda g: {
            "dag": "Maandag", "naam": g["naam"] if g else "(geen 'makkelijk'-gerecht gevonden)",
            "ingredienten": g["ingredienten"] if g else [], "categorie": "maandag",
        })(kies_uit_pool(pools["makkelijk"], "maandag", geschiedenis)),
        "dinsdag": lambda: kies_dinsdag(dag_opties),
        "donderdag": lambda: (lambda g: {
            "dag": "Donderdag", "naam": g["naam"] if g else "(pool leeg)",
            "ingredienten": g["ingredienten"] if g else [], "categorie": "donderdag",
        })(kies_uit_pool(pools["algemeen"], "donderdag", geschiedenis)),
        "vrijdag_veel": lambda: kies_vrijdag(dag_opties, pools, even_week, geschiedenis),
        "vrijdag_klein": lambda: kies_vrijdag(dag_opties, pools, even_week, geschiedenis),
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
    weekmenu[index] = maak_dag_entry(dag_label, categorie, gekozen)

    print(f"\n'{gekozen['naam']}' gekozen. Ingrediënten:")
    for regel in gekozen["ingredienten"]:
        print(f"  - {regel}")

    return True


def laat_gebruiker_aanpassen(weekmenu: list, pools: dict, dag_opties: dict, even_week: bool,
                              geschiedenis: dict, receptenboek: list) -> list:
    while True:
        print("\nVoorgesteld weekmenu:")
        for i, dag in enumerate(weekmenu, start=1):
            print(f"  {i}. {dag['dag']}: {dag['naam']}")

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
    geschiedenis = laad_geschiedenis()
    even_week = is_even_week()
    pools = bepaal_pools(receptenboek)

    print(f"Week met {'4' if even_week else '2'} personen op vrijdag/weekend "
          f"({'even' if even_week else 'oneven'} weeknummer).\n")

    weekmenu = stel_weekmenu_samen(pools, dag_opties, even_week, geschiedenis)
    if args.automatisch:
        for dag in weekmenu:
            print(f"  {dag['dag']}: {dag['naam']}")
    else:
        weekmenu = laat_gebruiker_aanpassen(weekmenu, pools, dag_opties, even_week, geschiedenis, receptenboek)

    schrijf_boodschappenlijst(weekmenu, standaardlijst)

    # Geschiedenis bijwerken per categorie
    for dag in weekmenu:
        geschiedenis.setdefault(dag["categorie"], []).append(dag["naam"])
    sla_geschiedenis_op(geschiedenis)

    print(f"\nBoodschappenlijst bijgewerkt: {BOODSCHAPPENLIJST}")
    print("Draai nu picnic_boodschappen.py om alles te laten bestellen.")


if __name__ == "__main__":
    main()
