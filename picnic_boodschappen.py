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
import os
import re
import subprocess
import sys
from datetime import datetime
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


def voeg_product_toe(api: PicnicAPI, naam: str, aantal: int = 1, automatisch: bool = False):
    try:
        resultaten = api.search(naam)
    except Exception as e:
        log(f"  ✗ Fout bij zoeken naar '{naam}': {e}", automatisch)
        return

    # search() geeft een lijst met groepen terug, elk met een 'items'-lijst
    # van daadwerkelijke producten.
    gevonden_producten = []
    for groep in (resultaten or []):
        items = groep.get("items") if isinstance(groep, dict) else None
        if items:
            gevonden_producten = items
            break

    if not gevonden_producten:
        log(f"  ✗ Geen resultaat gevonden voor '{naam}'.", automatisch)
        return

    product = gevonden_producten[0]
    product_id = product.get("id")
    product_naam = product.get("name", "onbekend product")

    if not product_id:
        log(f"  ✗ Geen geldig product-ID gevonden voor '{naam}'.", automatisch)
        return

    try:
        api.add_product(product_id, count=aantal)
        log(f"  ✓ {aantal}x {product_naam} toegevoegd (gezocht op '{naam}')", automatisch)
        # Toon 1-2 alternatieven ter controle, voor het geval het verkeerde
        # product gepakt is (bijv. ander merk of formaat).
        alternatieven = [p.get("name") for p in gevonden_producten[1:3] if p.get("name")]
        if alternatieven:
            log(f"    (andere opties waren: {', '.join(alternatieven)})", automatisch)
    except Exception as e:
        log(f"  ✗ Kon '{product_naam}' niet toevoegen: {e}", automatisch)


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
    args = parser.parse_args()
    automatisch = args.automatisch

    api = log_in(automatisch=automatisch)
    boodschappenlijst = laad_boodschappenlijst()

    log(f"Producten toevoegen aan mandje (uit {LIJST_BESTAND.name}):", automatisch)
    for item in boodschappenlijst:
        voeg_product_toe(api, item["naam"], item.get("aantal", 1), automatisch=automatisch)

    if not automatisch:
        los_toevoegen(api)

    log("\nHuidig mandje:", automatisch)
    cart = api.get_cart()
    for item in cart.get("items", []):
        log(f"  - {item.get('name', '?')}", automatisch)

    if automatisch:
        stuur_melding("Picnic boodschappen bijgewerkt", "De vaste lijst is toegevoegd aan je mandje.")


if __name__ == "__main__":
    main()
