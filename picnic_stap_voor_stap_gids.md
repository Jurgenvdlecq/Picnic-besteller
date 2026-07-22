# Picnic boodschappen-tools — complete installatiegids

Deze gids neemt je mee van een schone MacBook tot een werkend systeem dat
wekelijks een dag-specifiek menu kiest en de boodschappen klaarzet in je
Picnic-mandje — én laat zien hoe je dat daarna ook helemaal **zonder Mac**,
vanaf je iPhone, kunt laten draaien en bijsturen.

Er zijn negen bestanden, die je allemaal in **dezelfde map** zet
(bijvoorbeeld een nieuwe map "Picnic" in je Documenten):

| Bestand | Wat het doet |
|---|---|
| `picnic_boodschappen.py` | Bestelt producten bij Picnic |
| `weekmenu.py` | Kiest het dag-specifieke weekmenu en vult de boodschappenlijst |
| `receptenboek.txt` | Jullie complete receptenboek (labels + actief/inactief) |
| `dag_opties.txt` | Losse lijstjes voor dinsdag/vrijdag/zondag |
| `standaardlijst.txt` | Vaste wekelijkse boodschappen (yoghurt, wc-papier, etc.) |
| `controleer_weekmenu.py` | Waarschuwt als het weekmenu nog niet gekozen is |
| `requirements.txt` | De precieze library-versie die dit script nodig heeft |
| `picnic.plist` / `picnic_check.plist` | Optioneel — automatisering **op je Mac** via launchd |
| `.github/workflows/bestel.yml` | Optioneel — automatisering **in de cloud**, ook vanaf je iPhone te starten |

> **Belangrijk over de library-versie:** 2FA-ondersteuning (de SMS-code bij
> het inloggen) zit pas sinds versie 1.3.3 van `python-picnic-api2` in de
> library, en die versie vereist **Python 3.13 of hoger**. Met een oudere
> Python installeert `pip` zonder waarschuwing een oudere versie zónder
> 2FA — en dan blijft inloggen precies hangen zoals je nu meemaakte. Stap 2
> hieronder zorgt dat je de juiste Python-versie hebt.

---

## Deel 1 — Eenmalig installeren op je Mac

Ook als je straks alles vanaf je iPhone wilt bedienen, doorloop je dit deel
**één keer** op je Mac: dat is de enige plek waar je met je Picnic
e-mailadres, wachtwoord en SMS-code kunt inloggen (dat kan niet automatisch
in de cloud, om veiligheidsredenen).

### Stap 1 — Terminal openen

1. Druk op **Cmd + Spatie** (Spotlight-zoeken).
2. Typ `Terminal` en druk op Enter.

### Stap 2 — Python 3.13 controleren/installeren

Typ in Terminal:
```
python3 --version
```
- Zie je `Python 3.13.x` of hoger? Ga door naar Stap 3.
- Zie je een lager versienummer (bijv. 3.9, 3.11, 3.12)? Download dan de
  nieuwste Python van **python.org/downloads** (macOS-installer), of — als
  je Homebrew gebruikt — typ `brew install python@3.13`. Sluit daarna
  Terminal en open het opnieuw, en controleer nogmaals met `python3 --version`.

### Stap 3 — De benodigde library installeren

Ga in Terminal naar de map met de bestanden (bijv. `cd ~/Documenten/Picnic`)
en typ:
```
pip3 install --upgrade -r requirements.txt --break-system-packages
```
Dit installeert precies de versie die 2FA ondersteunt en nog compatibel is
met dit script. Wacht tot je "Successfully installed..." ziet.

### Stap 4 — De map met bestanden klaarzetten

1. Maak een nieuwe map aan, bijvoorbeeld in Finder: **Documenten → Nieuwe map → "Picnic"**.
2. Download alle bestanden uit de tabel bovenaan en sleep ze naar die map.

> Belangrijk: alle bestanden moeten in **dezelfde map** staan, anders
> vinden de scripts elkaars bestanden (zoals de boodschappenlijst) niet.

### Stap 5 — IDLE openen en voor het eerst inloggen

IDLE is het programma waarin je Python-bestanden opent en uitvoert.

1. Open IDLE via **Cmd + Spatie**, typ `IDLE`, Enter.
2. Klik in de menubalk bovenaan je scherm op **File → Open...**
3. Zoek naar `picnic_boodschappen.py` in je Picnic-map en open het.
4. Druk op **F5** (of **Fn + F5**) om het script te draaien.

Wat er nu gebeurt:
- Het vraagt om je Picnic e-mailadres en wachtwoord — typ die in het
  Shell-venster dat verschijnt en druk telkens Enter.
- Heeft je account tweestapsverificatie (2FA) aan staan? Dan stuurt het
  script automatisch een SMS-code en vraagt het je die in te typen.
- Als het inloggen slaagt, wordt de sessie lokaal opgeslagen (in
  `~/.picnic_sessie_token.txt`) zodat je niet elke keer opnieuw met 2FA
  hoeft in te loggen — dit token gebruiken we straks ook voor Deel 2.
- Daarna maakt het script automatisch een leeg voorbeeldbestand
  `boodschappenlijst.txt` aan in dezelfde map, en stopt het.

> Dit is normaal bij de allereerste keer — er is nog geen boodschappenlijst
> om te bestellen. Vanaf Stap 6 vullen we die.

### Stap 6 — Het weekmenu kiezen

1. Open in IDLE ook `weekmenu.py` (**File → Open...**), druk op **F5**.
2. Je krijgt een voorstel te zien met een vast dagpatroon:

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
- **Typ een nummer** om alléén die dag opnieuw te laten kiezen. Woensdag is
  een vast gerecht en kan niet gewisseld worden.
- Bij maandag/donderdag/vrijdag kun je ook een receptnaam typen (bijv.
  "kofta") in plaats van Enter — dan zoekt het script dat op in het **hele**
  receptenboek (ook `Actief: nee`-recepten).

Zodra je klaar bent, wordt `boodschappenlijst.txt` gevuld met alle
ingrediënten **plus** de standaardlijst.

> Wil je later gerechten toevoegen of aanpassen? Open gewoon `receptenboek.txt`
> of `dag_opties.txt` met TextEdit — geen code nodig.

### Stap 7 — Boodschappen bestellen

1. Ga terug naar het `picnic_boodschappen.py`-venster in IDLE, druk **F5**.
2. Je logt nu in met de opgeslagen sessie (geen 2FA meer nodig) en alle
   producten uit `boodschappenlijst.txt` worden gezocht en toegevoegd aan
   je Picnic-mandje.
3. Aan het eind vraagt het script of je nog losse extra producten wilt
   toevoegen — typ die in, of druk Enter om te stoppen.
4. Open de **echte Picnic-app** op je telefoon: de producten staan daar nu
   in je mandje. Kies een bezorgmoment en reken af zoals je gewend bent —
   dat doet het script bewust niet automatisch.

---

## Deel 2 — Bestellen zonder Mac, ook vanaf je iPhone

Nu je één keer succesvol bent ingelogd (Stap 5), kun je de wekelijkse
bestelling voortaan in de cloud laten draaien via **GitHub Actions** — dat
is een gratis "computer in de cloud" die aan je GitHub-repo hangt. Je kunt
'm zowel automatisch elke week laten draaien, als handmatig met één druk op
de knop starten vanaf je iPhone (via de GitHub-app).

### Stap 8 — Je sessie-token als GitHub-secret opslaan (eenmalig)

1. Op je Mac, in Terminal:
   ```
   cat ~/.picnic_sessie_token.txt
   ```
   Kopieer de tekst die verschijnt (dit is je sessie-token — niet je
   wachtwoord, dat staat hier nergens).
2. Ga naar je repo op github.com → **Settings** → **Secrets and variables**
   → **Actions** → **New repository secret**.
3. Naam: `PICNIC_SESSION_TOKEN`. Waarde: plak het token. Klik **Add secret**.

Deze repo staat op **privé**, en GitHub-secrets zijn altijd versleuteld en
onzichtbaar in logs — ook voor jezelf nadat je 'm hebt opgeslagen.

> Sessie-tokens van Picnic blijven doorgaans weken geldig. Mocht een
> bestelling ooit mislukken met "sessie verlopen", herhaal dan gewoon Stap 5
> op je Mac en werk de secret bij met het nieuwe token (2 minuutjes werk).

### Stap 9 — Automatisch elke week laten bestellen

Dat staat al klaar in `.github/workflows/bestel.yml`: elke zondag rond 8-9
uur 's ochtends kiest de workflow automatisch een weekmenu en bestelt alles
bij Picnic — zonder dat je Mac of iPhone aan hoeven te staan.

### Stap 10 — Handmatig bestellen vanaf je iPhone

1. Open de **GitHub-app** op je iPhone (of github.com in Safari) en ga naar
   deze repo.
2. Tik op het tabblad **Actions**.
3. Kies **"Bestel bij Picnic"** in de lijst, tik op **Run workflow**.
4. Kies "ja" als je eerst een nieuw weekmenu wilt laten kiezen, of "nee" als
   je de boodschappenlijst.txt wilt gebruiken zoals die nu in de repo staat
   (handig als je 'm net zelf hebt aangepast, zie Stap 11).
5. Tik op **Run workflow** om te starten. Onder "Actions" zie je de
   voortgang en het volledige logboek van wat er is gezocht/toegevoegd.
6. Klaar? Open de Picnic-app zelf om een bezorgmoment te kiezen en af te
   rekenen — dat blijft bewust een handmatige stap.

### Stap 11 — Snel iets aanpassen vanaf je iPhone

Voor kleine wijzigingen hoef je niet te programmeren: open het bestand in de
GitHub-app (tik op het bestand → potlood-icoon rechtsboven om te bewerken)
en sla op met "Commit changes":

- **`boodschappenlijst.txt`** — voeg een los extra product toe of verwijder er een.
- **`receptenboek.txt`** / **`dag_opties.txt`** / **`standaardlijst.txt`** —
  pas recepten of de vaste lijst aan. Zie de uitleg bovenin die bestanden
  voor het exacte formaat.

### Stap 12 — Verder programmeren vanaf je iPhone

Voor grotere aanpassingen (aan `weekmenu.py`, `picnic_boodschappen.py`, etc.)
gebruik je gewoon deze chat met Claude — vanaf je iPhone via de Claude-app
of claude.ai/code, verbonden met deze GitHub-repo, zoals nu. Beschrijf wat
je aangepast wilt hebben, Claude past de code aan en pusht het naar de
`main`-branch (of een branch die je zelf beheert).

---

## Bonus (optioneel) — Automatisch draaien op je Mac zelf (launchd)

Wil je liever dat het via je eigen Mac blijft lopen in plaats van de cloud?
Dat kan ook nog steeds:

1. Zorg dat je minstens één keer succesvol bent ingelogd (Stap 5).
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

En om een waarschuwing te krijgen als je het weekmenu een keer vergeet te
kiezen (relevant als je deze Mac-route gebruikt in plaats van Deel 2):

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

| Wanneer | Wat | Waar |
|---|---|---|
| Eén keer, bij installatie | Stap 1 t/m 7 | Mac (Terminal/IDLE) |
| Eén keer, voor bestellen zonder Mac | Stap 8 | Mac (token ophalen) + github.com |
| Elke week, automatisch | `bestel.yml` (schedule) of `picnic.plist` | Cloud, of je Mac |
| Op elk moment, handmatig | "Run workflow" in de GitHub-app | Overal, ook je iPhone |
| Snelle boodschap/recept aanpassen | Bestand bewerken in de GitHub-app | Overal, ook je iPhone |
| Grotere codewijziging | Deze Claude-chat | Overal, ook je iPhone |

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
