"""
Weekmenu-controle
------------------
Checkt of "boodschappenlijst.txt" deze week al is bijgewerkt via
weekmenu.py. Zo niet, dan:
  1. stuurt een macOS-melding, en
  2. maakt een herinnering aan in de Reminders-app (die via iCloud ook op
     je telefoon verschijnt).

Bedoeld om via launchd elke week op een vast moment te draaien (bijv.
vrijdagavond), zodat je op tijd gewaarschuwd wordt als het weekmenu nog
niet gekozen is — vóórdat de automatische Picnic-bestelling op zondag
gewoon de oude lijst van vorige week opnieuw zou bestellen.

GEBRUIK:
    python3 controleer_weekmenu.py

    Zie "picnic_check.plist" voor een voorbeeld om dit via launchd te
    plannen.
"""

import subprocess
import sys
from datetime import datetime, timedelta
from pathlib import Path

BOODSCHAPPENLIJST = Path(__file__).parent / "boodschappenlijst.txt"

# Als het bestand langer geleden is bijgewerkt dan dit aantal dagen,
# beschouwen we het weekmenu als "nog niet gekozen deze week".
MAX_LEEFTIJD_DAGEN = 6


def bestand_is_verouderd(pad: Path, max_dagen: int) -> bool:
    if not pad.exists():
        return True  # nog nooit een lijst gemaakt telt ook als "verouderd"

    laatst_gewijzigd = datetime.fromtimestamp(pad.stat().st_mtime)
    return laatst_gewijzigd < datetime.now() - timedelta(days=max_dagen)


def stuur_melding(titel: str, tekst: str):
    try:
        subprocess.run(
            ["osascript", "-e", f'display notification "{tekst}" with title "{titel}"'],
            check=False,
        )
    except Exception as e:
        print(f"Kon geen macOS-melding versturen: {e}")


def maak_herinnering(titel: str, notitie: str = ""):
    """Maakt een herinnering aan in de Reminders-app (standaardlijst),
    die via iCloud ook op je telefoon verschijnt."""
    script = f'''
    tell application "Reminders"
        make new reminder with properties {{name:"{titel}", body:"{notitie}"}}
    end tell
    '''
    try:
        resultaat = subprocess.run(
            ["osascript", "-e", script],
            check=False,
            capture_output=True,
            text=True,
        )
        if resultaat.returncode != 0:
            print(f"Kon geen herinnering aanmaken: {resultaat.stderr.strip()}")
    except Exception as e:
        print(f"Kon geen herinnering aanmaken: {e}")


def main():
    if bestand_is_verouderd(BOODSCHAPPENLIJST, MAX_LEEFTIJD_DAGEN):
        titel = "Weekmenu nog niet gekozen"
        tekst = "Draai weekmenu.py, anders bestelt Picnic zondag de oude lijst opnieuw."
        print(f"⚠ {titel}: {tekst}")
        stuur_melding(titel, tekst)
        maak_herinnering(titel, tekst)
    else:
        print("✓ Boodschappenlijst is deze week al bijgewerkt, geen actie nodig.")


if __name__ == "__main__":
    main()
