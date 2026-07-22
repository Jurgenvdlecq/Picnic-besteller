# Picnic boodschappen-tools — complete installatiegids

Deze gids neemt je helemaal vanaf nul mee: van een schone MacBook tot een
werkend systeem dat wekelijks een dag-specifiek menu kiest en de
boodschappen klaarzet in je Picnic-mandje.

Er zijn acht bestanden, die je allemaal in **dezelfde map** zet
(bijvoorbeeld een nieuwe map "Picnic" in je Documenten):

| Bestand | Wat het doet |
|---|---|
| `picnic_boodschappen.py` | Bestelt producten bij Picnic |
| `weekmenu.py` | Kiest het dag-specifieke weekmenu en vult de boodschappenlijst |
| `receptenboek.txt` | Jullie complete receptenboek (labels + actief/inactief) |
| `dag_opties.txt` | Losse lijstjes voor dinsdag/vrijdag/zondag |
| `standaardlijst.txt` | Vaste wekelijkse boodschappen (yoghurt, wc-papier, etc.) |
| `controleer_weekmenu.py` | Waarschuwt als het weekmenu nog niet gekozen is |
| `picnic.plist` | Optioneel — automatische wekelijkse bestelling |
| `picnic_check.plist` | Optioneel — automatische controle-melding |

---

## Stap 1 — Terminal openen

Terminal is het "zwarte scherm" waarin je typ-commando's uitvoert.

1. Druk op **Cmd + Spatie** (Spotlight-zoeken).
2. Typ `Terminal` en druk op Enter.

Je ziet nu een venster met een knipperende cursor. Hier typ je zo meteen
commando's in.

---

## Stap 2 — Python controleren

Typ in Terminal:
```
python3 --version
```
Druk Enter.

- Zie je iets als `Python 3.11.x`? Dan is Python al aanwezig, ga door naar Stap 3.
- Zie je een foutmelding of een popup die vraagt om "Command Line Tools" te
  installeren? Klik akkoord en wacht tot de installatie klaar is (kan een
  paar minuten duren). Typ het commando daarna nogmaals om te checken.

---

## Stap 3 — De benodigde library installeren

Nog steeds in Terminal, typ:
```
pip3 install --upgrade python-picnic-api2 --break-system-packages
```
Druk Enter en wacht tot je een regel ziet met "Successfully installed...".

---

## Stap 4 — De map met bestanden klaarzetten

1. Maak een nieuwe map aan, bijvoorbeeld in Finder: **Documenten → Nieuwe map → "Picnic"**.
2. Download alle acht bestanden uit de tabel bovenaan en sleep ze naar die map.

> Belangrijk: alle bestanden moeten in **dezelfde map** staan, anders
> vinden de scripts elkaars bestanden (zoals de boodschappenlijst) niet.

---

## Stap 5 — IDLE openen en het Picnic-script voor het eerst draaien

IDLE is het programma waarin je Python-bestanden opent en uitvoert.

1. Open IDLE via **Cmd + Spatie**, typ `IDLE`, Enter.
2. Bovenaan je **scherm** (niet in het IDLE-venster zelf) verschijnt een
   menubalk zodra IDLE actief is. Klik op **File → Open...**
3. Zoek naar `picnic_boodschappen.py` in je Picnic-map en open het.
4. Druk op **F5** (of **Fn + F5** op sommige MacBooks) om het script te
   draaien.

Wat er nu gebeurt:
- Het vraagt om je Picnic e-mailadres en wachtwoord — typ die in het
  Shell-venster dat verschijnt en druk telkens Enter.
- Heeft je account tweestapsverificatie (2FA) aan staan? Dan stuurt het
  script automatisch een SMS-code aan en vraagt het je die in te typen.
- Daarna maakt het script automatisch een leeg voorbeeldbestand
  `boodschappenlijst.txt` aan in dezelfde map, en stopt het.

> Dit is normaal bij de allereerste keer — er is nog geen boodschappenlijst
> om te bestellen. Vanaf Stap 6 vullen we die.

---

## Stap 6 — Het weekmenu kiezen

1. Open in IDLE ook `weekmenu.py` (**File → Open...**).
2. Druk op **F5**.

Omdat je `receptenboek.txt`, `dag_opties.txt` en `standaardlijst.txt` al hebt
gedownload (met jullie eigen gerechten en boodschappen erin), hoeft er niets
handmatig aangemaakt te worden — het script gaat meteen aan de slag.

Je krijgt een voorstel te zien met een vast dagpatroon:

```
Week met 4 personen op vrijdag/weekend (even weeknummer).

Voorgesteld weekmenu:
  1. Maandag: Kofta met pitabroodjes
  2. Dinsdag: Kroketjes + Kipschnitzel + Broccoli
  3. Woensdag: Kip met rijst en paprika
  4. Donderdag: Rundergehaktballen met zoete aardappel
  5. Vrijdag (4p): Pannenkoeken
  6. Zondag: Patat + Mini kaassoufflé
```

- **Druk Enter** om te accepteren.
- **Typ een nummer** om alléén die dag opnieuw te laten kiezen (de rest
  blijft staan). Woensdag is een vast gerecht en kan niet gewisseld worden.
- Bij maandag/donderdag/vrijdag kun je na het kiezen van een dagnummer ook
  een receptnaam typen (bijv. "kofta") in plaats van Enter te drukken —
  dan zoekt het script dat op in het **hele** receptenboek (ook recepten
  met `Actief: nee`) en gebruikt precies dat gerecht voor die dag.
- Even/oneven week (4 of 2 personen op vrijdag/weekend) wordt automatisch
  bepaald aan de hand van de kalender.

Zodra je klaar bent, wordt `boodschappenlijst.txt` automatisch gevuld met
alle benodigde ingrediënten **plus** de standaardlijst (yoghurt, wc-papier,
cola, etc. — die komt er altijd bij, ongeacht het menu).

> Wil je later gerechten toevoegen of aanpassen? Open gewoon `receptenboek.txt`
> of `dag_opties.txt` met TextEdit — geen code nodig. Zie de uitleg
> bovenin die bestanden voor het exacte formaat.

---

## Stap 7 — Boodschappen bestellen

1. Ga terug naar het `picnic_boodschappen.py`-venster in IDLE (of open het
   opnieuw als het gesloten was).
2. Druk op **F5**.
3. Dit keer log je in (met opgeslagen sessie als je al eerder bent
   ingelogd — dan hoeft dat niet opnieuw met 2FA) en worden alle producten
   uit `boodschappenlijst.txt` gezocht en toegevoegd aan je Picnic-mandje.
4. Aan het eind vraagt het script of je nog losse extra producten wilt
   toevoegen — typ die in, of druk Enter om te stoppen.
5. Open de **echte Picnic-app** op je telefoon: de producten staan daar nu
   gewoon in je mandje. Kies een bezorgmoment en reken af zoals je gewend
   bent — dat doet het script bewust niet automatisch.

---

## Stap 8 (optioneel) — Volledig automatisch laten bestellen

Wil je dat de bestelling iedere week vanzelf gebeurt, zonder dat iemand
iets hoeft te doen? Zie de instructies bovenin `picnic.plist` zelf — kort
samengevat:

1. Zorg dat je minstens één keer succesvol bent ingelogd (Stap 5), zodat er
   een sessie is opgeslagen.
2. Pas in `picnic.plist` het pad naar je script aan naar waar jij het hebt
   opgeslagen.
3. In Terminal:
   ```
   mkdir -p ~/Library/LaunchAgents
   cp ~/Downloads/picnic.plist ~/Library/LaunchAgents/nl.jurgen.picnic.plist
   launchctl load ~/Library/LaunchAgents/nl.jurgen.picnic.plist
   ```
4. Vanaf nu draait het elke zondag om 8:00 automatisch (mits je Mac dan
   aan/wakker is).

> Let op: het weekmenu kiezen (Stap 6) is bewust **niet** in deze
> automatisering meegenomen, omdat je daar zelf nog even naar wilt kijken
> en eventueel iets wilt vervangen. Die stap blijf je handmatig draaien.

---

## Stap 9 (optioneel) — Waarschuwing als het weekmenu nog niet gekozen is

Omdat Stap 6 handmatig blijft, is het risico dat je 'm een keer vergeet —
dan zou de automatische bestelling van Stap 8 gewoon de oude lijst van
vorige week herhalen. `controleer_weekmenu.py` vangt dat op:

1. Pas in `picnic_check.plist` het pad naar het script aan.
2. In Terminal:
   ```
   cp ~/Downloads/picnic_check.plist ~/Library/LaunchAgents/nl.jurgen.picnic-check.plist
   launchctl load ~/Library/LaunchAgents/nl.jurgen.picnic-check.plist
   ```
3. Elke vrijdagavond om 18:00 checkt het script of `boodschappenlijst.txt`
   deze week al is bijgewerkt. Zo niet: je krijgt een macOS-melding én een
   herinnering in de Reminders-app (die via iCloud ook op je telefoon
   verschijnt).

> De eerste keer kan macOS om toestemming vragen om Reminders aan te
> sturen — keur dat goed in Systeeminstellingen → Privacy en beveiliging.

---

## Snel overzicht — wat draai je wanneer?

| Wanneer | Wat draaien | Wat gebeurt er |
|---|---|---|
| Eén keer, bij installatie | Stap 1 t/m 5 | Alles installeren, eerste keer inloggen |
| Elke week (bijv. weekend) | `weekmenu.py` | Kiest het dag-menu, vult boodschappenlijst |
| Daarna, elke week | `picnic_boodschappen.py` | Bestelt alles bij Picnic |
| Eén keer, optioneel | `picnic.plist` installeren | Laat de bestelstap voortaan vanzelf gaan |
| Eén keer, optioneel | `picnic_check.plist` installeren | Waarschuwt als je het weekmenu vergeet |

---

## Hoe het weekmenu is opgebouwd

| Dag | Logica |
|---|---|
| Maandag | Uit de pool met label `makkelijk` (wereldgerecht/pasta/rijst) |
| Dinsdag | Willekeurige combi: aardappelvorm + vlees + groente |
| Woensdag | Altijd hetzelfde vaste gerecht: kip met rijst en paprika |
| Donderdag | Vrije rotatie uit de algemene pool ("wees creatief") |
| Vrijdag | Even week (4p): pool met label `vrijdag_veel` — Oneven week (2p): vlees + groente |
| Zaterdag | Overgeslagen (wisselend, hoeft niet in het menu) |
| Zondag | Altijd patat (airfryer) + willekeurige snack |

---

## Hulp nodig?

Als je ergens een foutmelding krijgt, kopieer dan de volledige tekst van de
foutmelding (niet alleen de laatste regel) en stuur die door — dan kan ik
precies zien wat er misgaat.
