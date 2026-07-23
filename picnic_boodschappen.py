"""
Picnic boodschappenlijst-tool
-----------------------------
Logt in op je eigen Picnic-account en voegt automatisch een vaste lijst
producten toe aan je mandje. Werkt via de (niet-officiële) python-picnic-api2.

INSTALLATIE (eenmalig):
    pip3 install --upgrade -r requirements.txt --break-system-packages

    LET OP: 2FA-ondersteuning (Picnic2FARequired e.a.) zit pas sinds versie
    1.3.3 van python-picnic-api2 in de library, en die versie vereist
    Python 3.13 of hoger. Heb je een oudere Python, dan installeert pip
    zonder waarschuwing stilletjes een oudere versie zónder 2FA-steun — en
    dan blijft inloggen hangen zodra Picnic om een SMS-code vraagt. Check
    dus eerst je Python-versie met: python3 --version

INLOGGEGEVENS:
    Zet je gegevens als omgevingsvariabelen, zodat ze niet in dit bestand
    staan (en dus niet per ongeluk gedeeld worden):

        export PICNIC_USERNAME="jouw@email.nl"
        export PICNIC_PASSWORD="jouwwachtwoord"

    Of vul ze direct in als je het script alleen lokaal gebruikt (zie onderaan).

    Voor automatisch draaien zonder Mac (bijv. via GitHub Actions) kun je in
    plaats van gebruikersnaam/wachtwoord ook een al opgeslagen sessie-token
    meegeven via de omgevingsvariabele PICNIC_SESSION_TOKEN — zie de gids.

GEBRUIK:
    python3 picnic_boodschappen.py

    De vaste boodschappenlijst staat in "boodschappenlijst.txt", in dezelfde
    map als dit script. De eerste keer dat je het script draait, wordt dat
    bestand automatisch met een voorbeeld aangemaakt. Pas het gerust aan met
    een gewoon tekstprogramma (TextEdit, Kladblok) — geen code nodig.

    Na de vaste lijst kun je in het Shell-venster ook losse extra producten
    intypen, voor de keren dat je net iets anders nodig hebt.

AUTOMATISCH OP DE ACHTERGROND DRAAIEN (bv. elke week vanzelf):
    Draai het script met de vlag --automatisch:

        python3 picnic_boodschappen.py --automatisch

    In deze modus worden geen vragen gesteld (geen 2FA-prompt, geen losse
    producten) — het gebruikt alleen het al opgeslagen sessie-token. Log je
    dus eerst één keer gewoon in (zonder --automatisch) zodat er een token
    is opgeslagen. Output gaat naar "picnic_log.txt" i.p.v. het scherm, en je
    krijgt een macOS-melding als het script iets niet kon afronden.

    Zie het meegeleverde bestand "picnic.plist" voor een voorbeeld om dit
    via launchd wekelijks te laten draaien.
"""

import argparse
import difflib
import json
import os
import re
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

import requests

try:
    from python_picnic_api2 import PicnicAPI, Picnic2FARequired, Picnic2FAError
except ImportError:
    sys.exit(
        "Kon Picnic2FARequired/Picnic2FAError niet importeren uit python_picnic_api2.\n"
        "Dit betekent dat er een te oude versie van de library is geïnstalleerd "
        "(zonder 2FA-ondersteuning) — daardoor bleef inloggen eerder vastlopen.\n\n"
        "Los het op met:\n"
        "  python3 --version   (moet 3.13 of hoger zijn)\n"
        "  pip3 install --upgrade -r requirements.txt --break-system-packages\n"
    )

# Zonder timeout blijft een requests-aanroep bij een netwerkhapering voor
# onbepaalde tijd hangen (dit was de oorzaak van het "vastlopen" bij inloggen).
# Alle Picnic-aanroepen lopen via één requests.Session, dus we geven die een
# standaard-timeout mee voor elke aanvraag die geen eigen timeout opgeeft.
STANDAARD_TIMEOUT_SECONDEN = 20


def beveilig_tegen_hangen(api: PicnicAPI) -> None:
    origineel_request = api.session.request

    def request_met_timeout(method, url, *args, **kwargs):
        kwargs.setdefault("timeout", STANDAARD_TIMEOUT_SECONDEN)
        return origineel_request(method, url, *args, **kwargs)

    api.session.request = request_met_timeout


# Bestand waarin het sessie-token lokaal wordt bewaard, zodat je niet elke
# keer opnieuw hoeft in te loggen (en 2FA niet elke keer nodig is).
TOKEN_BESTAND = Path.home() / ".picnic_sessie_token.txt"

# Logbestand voor automatische (achtergrond-)runs, zodat je kunt terugkijken
# wat er is gebeurd zonder dat er een Terminal open hoeft te staan.
LOG_BESTAND = Path(__file__).parent / "picnic_log.txt"

# Samenvatting van de laatste bestelling (datum, geschatte prijs, niet
# gevonden producten), zodat de website dit kan tonen zonder zelf bij
# Picnic te hoeven inloggen.
OVERZICHT_BESTAND = Path(__file__).parent / "laatste_bestelling.json"

# Resultaat van een --voorbeeld-run: per gezocht product de gevonden
# kandidaten (zonder dat er iets besteld wordt), zodat de website dit kan
# tonen en je kan kiezen bij twijfel/meerdere varianten.
VOORSTELLEN_BESTAND = Path(__file__).parent / "product_voorstellen.json"

# Door de website geschreven keuzes (welk exact product-ID bij welke
# gezochte naam hoort), opgeslagen na de controle-stap. Als dit bestaat
# wordt er niet opnieuw gezocht maar precies dát product besteld.
GEKOZEN_BESTAND = Path(__file__).parent / "gekozen_producten.json"

# ---------------------------------------------------------------------------
# De boodschappenlijst staat in een los tekstbestand, in dezelfde map als dit
# script. Dat is fijn omdat je (of je vrouw) die lijst kan aanpassen met een
# gewoon programma zoals TextEdit of Kladblok — geen Python-kennis nodig.
# ---------------------------------------------------------------------------
LIJST_BESTAND = Path(__file__).parent / "boodschappenlijst.txt"

VOORBEELD_LIJST = """\
# Boodschappenlijst voor Picnic
# ------------------------------
# Eén product per regel. Formaat: aantal x productnaam
# Regels die beginnen met # worden genegeerd (dat zijn opmerkingen).
#
# Voorbeelden:
2 x halfvolle melk
1 x eieren
1 x kipfilet
1 x rundergehakt
1 x bananen
"""


def log(bericht: str, automatisch: bool):
    """Print altijd; schrijf bij automatische runs ook naar het logbestand."""
    print(bericht)
    if automatisch:
        with open(LOG_BESTAND, "a", encoding="utf-8") as f:
            tijdstip = datetime.now().strftime("%Y-%m-%d %H:%M")
            f.write(f"[{tijdstip}] {bericht}\n")


def stuur_melding(titel: str, tekst: str):
    """Toon een macOS-notificatie (werkt niet op Windows/Linux, dan gewoon negeren)."""
    try:
        subprocess.run(
            ["osascript", "-e", f'display notification "{tekst}" with title "{titel}"'],
            check=False,
        )
    except Exception:
        pass


def laad_boodschappenlijst() -> list:
    if not LIJST_BESTAND.exists():
        LIJST_BESTAND.write_text(VOORBEELD_LIJST, encoding="utf-8")
        print(f"Geen lijst gevonden — een voorbeeldbestand is aangemaakt op:")
        print(f"  {LIJST_BESTAND}")
        print("Pas dit bestand aan met je eigen boodschappen en start het script opnieuw.\n")
        sys.exit(0)

    # Herkent: "2 x melk", "2x melk", "2 X Melk", of gewoon "melk" (dan aantal 1)
    patroon = re.compile(r"^\s*(\d+)\s*[xX]\s*(.+)$")

    items = []
    for regel in LIJST_BESTAND.read_text(encoding="utf-8").splitlines():
        regel = regel.strip()
        if not regel or regel.startswith("#"):
            continue

        match = patroon.match(regel)
        if match:
            aantal = int(match.group(1))
            naam = match.group(2).strip()
        else:
            aantal, naam = 1, regel

        items.append({"naam": naam, "aantal": aantal})

    return items


def log_in(automatisch: bool = False) -> PicnicAPI:
    # 1. Probeer eerst een al bekend sessie-token: PICNIC_SESSION_TOKEN (handig
    #    voor draaien zonder Mac, bijv. GitHub Actions, waar TOKEN_BESTAND niet
    #    bewaard blijft tussen runs) heeft voorrang boven het lokale bestand.
    kandidaat_token = os.environ.get("PICNIC_SESSION_TOKEN", "").strip()
    if not kandidaat_token and TOKEN_BESTAND.exists():
        kandidaat_token = TOKEN_BESTAND.read_text().strip()

    if kandidaat_token:
        api = PicnicAPI(country_code="NL", auth_token=kandidaat_token)
        beveilig_tegen_hangen(api)
        if api.logged_in():
            try:
                api.get_user()  # test of het token nog echt geldig is
                log("Ingelogd met opgeslagen sessie (geen 2FA nodig).\n", automatisch)
                return api
            except requests.exceptions.RequestException as e:
                log(f"✗ Kon Picnic niet bereiken om de sessie te controleren: {e}", automatisch)
            except Exception:
                pass  # token verlopen of ongeldig, val terug op normale login

    # 2. Sessie is verlopen of er is nog nooit ingelogd.
    if automatisch:
        # In automatische modus kunnen we niet interactief om een SMS-code
        # vragen — dan stoppen we netjes met een duidelijke melding, in
        # plaats van vast te lopen op een input()-vraag die nooit komt.
        bericht = (
            "Sessie verlopen of nog geen sessie opgeslagen. "
            "Start het script één keer handmatig (zonder --automatisch) om opnieuw in te loggen, "
            "of zet een geldig token in PICNIC_SESSION_TOKEN."
        )
        log(f"✗ {bericht}", automatisch)
        stuur_melding("Picnic-script gestopt", bericht)
        sys.exit(1)

    username = os.environ.get("PICNIC_USERNAME")
    password = os.environ.get("PICNIC_PASSWORD")

    if not username or not password:
        print("Geen PICNIC_USERNAME / PICNIC_PASSWORD gevonden in omgevingsvariabelen.")
        username = input("Picnic e-mailadres: ").strip()
        password = input("Picnic wachtwoord: ").strip()

    api = PicnicAPI(country_code="NL")
    beveilig_tegen_hangen(api)

    try:
        try:
            api.login(username=username, password=password)
        except Picnic2FARequired:
            print("\nJe Picnic-account vraagt om tweestapsverificatie (2FA).")
            api.generate_2fa_code(channel="SMS")
            code = input("Vul de code in die je via SMS hebt ontvangen: ").strip()
            try:
                api.verify_2fa_code(code)
            except Picnic2FAError:
                print("De ingevoerde code klopt niet. Start het script opnieuw.")
                sys.exit(1)
    except requests.exceptions.Timeout:
        sys.exit(
            f"Picnic reageerde niet binnen {STANDAARD_TIMEOUT_SECONDEN} seconden "
            "(netwerkprobleem?). Controleer je internetverbinding en probeer opnieuw."
        )
    except requests.exceptions.RequestException as e:
        sys.exit(f"Kon geen verbinding maken met Picnic: {e}")

    if not api.logged_in():
        print("Inloggen mislukt. Controleer je gegevens.")
        sys.exit(1)

    # Token opslaan voor volgende keer
    try:
        TOKEN_BESTAND.write_text(api.session.auth_token)
        TOKEN_BESTAND.chmod(0o600)  # alleen leesbaar voor jouw gebruiker
    except Exception:
        pass  # niet kritiek als opslaan niet lukt

    print(f"Ingelogd als {username}.\n")
    return api


def _normalize(tekst: str) -> str:
    """Normaliseer tekst voor fuzzy matching: lowercase, geen special chars/spaties."""
    return re.sub(r"[^a-z0-9]", "", tekst.lower())


def _fuzzy_score(zoekterm: str, product_naam: str) -> float:
    """Bereken gelijkenis tussen zoekterm en product, 0.0-1.0.
    Werkt met genormaliseerde teksten en ook woord-voor-woord."""
    norm_zoek = _normalize(zoekterm)
    norm_prod = _normalize(product_naam)

    # Direct match
    ratio = difflib.SequenceMatcher(None, norm_zoek, norm_prod).ratio()

    # Woord-match: hoe veel woorden van de zoekterm komen voor in het product?
    zoek_woorden = set(norm_zoek.split()) if norm_zoek else set()
    prod_woorden = set(norm_prod.split()) if norm_prod else set()
    if zoek_woorden:
        woord_match = len(zoek_woorden & prod_woorden) / len(zoek_woorden)
    else:
        woord_match = 0

    # Combinatie: 70% sequence match, 30% word match
    return ratio * 0.7 + woord_match * 0.3


# Picnic geeft in zoekresultaten alleen een image_id terug, geen kant-en-klare
# URL. De echte afbeelding staat op dit vaste basispad (zelfde patroon als de
# get_image()-helper in python_picnic_api2, die niet publiek geëxporteerd wordt).
PICNIC_IMAGE_BASE_URL = "https://storefront-prod.nl.picnicinternational.com/static/images"


def zoek_producten(api: PicnicAPI, naam: str, automatisch: bool = False, max_kandidaten: int = 4) -> list:
    """Zoekt bij Picnic en geeft tot max_kandidaten resultaten terug
    (id/naam/prijs), zonder iets te bestellen. Gedeeld door de
    --voorbeeld-modus en de gewone bestel-modus."""
    try:
        resultaten = api.search(naam)
    except Exception as e:
        log(f"  ✗ Fout bij zoeken naar '{naam}': {e}", automatisch)
        return []

    # search() geeft een lijst met groepen terug, elk met een 'items'-lijst
    # van daadwerkelijke producten.
    gevonden_producten = []
    for groep in (resultaten or []):
        items = groep.get("items") if isinstance(groep, dict) else None
        if items:
            gevonden_producten = items
            break

    kandidaten = []
    for product in gevonden_producten[:max_kandidaten * 2]:  # pak meer, sorteer straks
        if not product.get("id"):
            continue
        image_id = product.get("image_id")
        kandidaten.append({
            "id": product["id"],
            "naam": product.get("name", "onbekend product"),
            "prijs_cent": product.get("display_price"),
            "image_url": f"{PICNIC_IMAGE_BASE_URL}/{image_id}/small.png" if image_id else None,
            "subtitle": product.get("unit_quantity"),  # bijv. "750 gram" of "1 stuk"
            "_score": _fuzzy_score(naam, product.get("name", "")),
        })

    # Sorteer op fuzzy score zodat het best-passende product bovenaan staat
    kandidaten.sort(key=lambda k: k["_score"], reverse=True)

    # Verwijder intern score-veld en geef top N terug
    for k in kandidaten:
        del k["_score"]
    return kandidaten[:max_kandidaten]


def voeg_product_toe(api: PicnicAPI, naam: str, aantal: int = 1, automatisch: bool = False, gekozen: dict = None) -> dict:
    """Voegt een product toe. Als 'gekozen' is meegegeven (uit de
    controle-stap op de website) wordt dat exacte product besteld zonder
    opnieuw te zoeken; anders wordt het eerste zoekresultaat gebruikt.
    Geeft een resultaat-dict terug zodat main() een overzicht (prijs,
    niet-gevonden producten) kan bijhouden."""
    if gekozen and gekozen.get("id"):
        try:
            api.add_product(gekozen["id"], count=aantal)
            log(f"  ✓ {aantal}x {gekozen.get('naam', naam)} toegevoegd (gekozen via website)", automatisch)
            prijs_cent = gekozen.get("prijs_cent")
            return {
                "status": "toegevoegd",
                "naam": gekozen.get("naam", naam),
                "aantal": aantal,
                "prijs_cent": prijs_cent * aantal if isinstance(prijs_cent, (int, float)) else None,
            }
        except Exception as e:
            log(f"  ✗ Kon '{gekozen.get('naam', naam)}' niet toevoegen: {e}", automatisch)
            return {"status": "fout", "gezocht_op": naam}

    kandidaten = zoek_producten(api, naam, automatisch)
    if not kandidaten:
        log(f"  ✗ Geen resultaat gevonden voor '{naam}'.", automatisch)
        return {"status": "niet_gevonden", "gezocht_op": naam}

    product = kandidaten[0]
    try:
        api.add_product(product["id"], count=aantal)
        log(f"  ✓ {aantal}x {product['naam']} toegevoegd (gezocht op '{naam}')", automatisch)
        # Toon 1-2 alternatieven ter controle, voor het geval het verkeerde
        # product gepakt is (bijv. ander merk of formaat).
        alternatieven = [k["naam"] for k in kandidaten[1:3]]
        if alternatieven:
            log(f"    (andere opties waren: {', '.join(alternatieven)})", automatisch)
        prijs_cent = product.get("prijs_cent")
        return {
            "status": "toegevoegd",
            "naam": product["naam"],
            "aantal": aantal,
            "prijs_cent": prijs_cent * aantal if isinstance(prijs_cent, (int, float)) else None,
        }
    except Exception as e:
        log(f"  ✗ Kon '{product['naam']}' niet toevoegen: {e}", automatisch)
        return {"status": "fout", "gezocht_op": naam}


def laad_gekozen_producten() -> dict:
    if not GEKOZEN_BESTAND.exists():
        return {}
    try:
        return json.loads(GEKOZEN_BESTAND.read_text(encoding="utf-8"))
    except Exception:
        return {}


def los_toevoegen(api: PicnicAPI):
    print("\nWil je nog losse producten toevoegen? (druk Enter zonder tekst om te stoppen)")
    while True:
        naam = input("Product: ").strip()
        if not naam:
            break
        aantal_tekst = input("Aantal (Enter voor 1): ").strip()
        aantal = int(aantal_tekst) if aantal_tekst.isdigit() else 1
        voeg_product_toe(api, naam, aantal)


def main():
    parser = argparse.ArgumentParser(description="Picnic boodschappenlijst-tool")
    parser.add_argument(
        "--automatisch",
        action="store_true",
        help="Draai zonder interactieve vragen (voor gebruik via een planner zoals launchd).",
    )
    parser.add_argument(
        "--voorbeeld",
        action="store_true",
        help="Zoek alleen producten op bij Picnic en schrijf de kandidaten weg "
             "(product_voorstellen.json) zonder iets te bestellen — voor de controle-stap op de website.",
    )
    args = parser.parse_args()
    automatisch = args.automatisch or args.voorbeeld

    api = log_in(automatisch=automatisch)
    boodschappenlijst = laad_boodschappenlijst()

    if args.voorbeeld:
        log(f"Producten opzoeken bij Picnic (uit {LIJST_BESTAND.name}), nog niets bestellen:", automatisch)
        voorstellen = {}
        for item in boodschappenlijst:
            kandidaten = zoek_producten(api, item["naam"], automatisch)
            voorstellen[item["naam"]] = {"aantal": item.get("aantal", 1), "kandidaten": kandidaten}
            if kandidaten:
                log(f"  ✓ {item['naam']}: {len(kandidaten)} resultaat/resultaten", automatisch)
            else:
                log(f"  ✗ {item['naam']}: niets gevonden", automatisch)
        VOORSTELLEN_BESTAND.write_text(json.dumps(voorstellen, ensure_ascii=False, indent=2), encoding="utf-8")
        return

    gekozen_producten = laad_gekozen_producten()

    log(f"Producten toevoegen aan mandje (uit {LIJST_BESTAND.name}):", automatisch)
    resultaten = [
        voeg_product_toe(
            api,
            item["naam"],
            item.get("aantal", 1),
            automatisch=automatisch,
            gekozen=gekozen_producten.get(item["naam"]),
        )
        for item in boodschappenlijst
    ]

    if not automatisch:
        los_toevoegen(api)

    log("\nHuidig mandje:", automatisch)
    cart = api.get_cart()
    for item in cart.get("items", []):
        log(f"  - {item.get('name', '?')}", automatisch)

    schrijf_overzicht(resultaten)

    # Eenmalig gebruiken: voorkomt dat een oude keuze een andere week's
    # gelijknamige zoekopdracht overschrijft.
    try:
        GEKOZEN_BESTAND.unlink(missing_ok=True)
    except Exception:
        pass

    if automatisch:
        stuur_melding("Picnic boodschappen bijgewerkt", "De vaste lijst is toegevoegd aan je mandje.")


def schrijf_overzicht(resultaten: list):
    """Schrijft een klein overzicht (datum, geschatte prijs, niet-gevonden
    producten) weg, zodat de website dit kan tonen zonder zelf in te loggen."""
    toegevoegd = [r for r in resultaten if r.get("status") == "toegevoegd"]
    niet_gevonden = [r["gezocht_op"] for r in resultaten if r.get("status") in ("niet_gevonden", "fout")]
    prijzen = [r["prijs_cent"] for r in toegevoegd if r.get("prijs_cent") is not None]

    overzicht = {
        "datum": datetime.now(timezone.utc).isoformat(),
        "aantal_producten": len(toegevoegd),
        "totaal_prijs_cent": sum(prijzen) if prijzen else None,
        "niet_gevonden": niet_gevonden,
    }
    try:
        OVERZICHT_BESTAND.write_text(json.dumps(overzicht, ensure_ascii=False, indent=2), encoding="utf-8")
    except Exception:
        pass  # niet kritiek als dit niet lukt


if __name__ == "__main__":
    main()
