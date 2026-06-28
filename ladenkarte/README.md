# Ladenkarte & Einkaufsroute — Phase 1

Testbarer **Kern-Loop** im Browser, lokal und ohne Backend (kein Account, kein Server,
Daten in `localStorage`). Umsetzung des Projekt-Briefs *„Ladenkarte & Einkaufsroute“*.

## Starten

Reines Static-Web-App – kein Build nötig.

```bash
# aus diesem Ordner heraus, z. B.:
python3 -m http.server 8000
# dann im Browser öffnen:
# http://localhost:8000/
```

Oder die Datei via GitHub Pages unter `…/ladenkarte/` aufrufen.
Service Worker / „zum Homescreen hinzufügen“ (PWA) funktioniert nur über `http(s)://`,
nicht per `file://`.

## Definition of Done (Phase 1) — erfüllt

Eine Web-Ansicht, in der man:

1. **einen Beispiel-Laden mit Raster sieht und Abteilungen platzieren kann** —
   Tab *Händler* → Karten-Editor: Abteilung wählen, Felder antippen (Toggle), Raster-Größe änderbar.
2. **einen Einkaufszettel anlegt** — Tab *Kunde*: Produkt eintippen (mit Vorschlägen) oder Chip antippen.
3. **den Zettel automatisch nach Abteilung sortiert sieht** — *Kunde* → „Deine Route“,
   gruppiert und sortiert nach dem Laufweg (`Department.order`).

### Bereits ergänzt (Phase-1-Punkte 4 & 5)

- **Route-Highlight auf der Karte** — nummerierte Reihenfolge der Abteilungen.
- **Erinnerungs-/Aktionsspalte** — Händler hinterlegt Hinweise (`update` / `aktion`),
  Kunde sieht sie unter „Neues im Laden“.

## Zwei Oberflächen

- **Händler (Editor):** Karten-Editor, Abteilungen + Laufweg, Produkte, Hinweise.
- **Kunde (Shopper):** mobile-first, Einkaufszettel → sortierte Route → Karte.

## Daten-Modell

Entspricht der Brief-Skizze:

```
Store            { id, name, grid:{rows,cols}, departments[], products[], notices[] }
Department       { id, name, color, cells[] /* "r,c" */, order /* Laufweg */ }
Product          { id, name, departmentId }
ShoppingListItem { productId, checked }
Notice           { id, text, type:"update"|"aktion", createdAt }
```

## Route-Logik

Jede Abteilung hat ein `order` entlang des typischen Ladenwegs.
Route = benötigte Abteilungen, sortiert nach `order`. (Echte Wegberechnung über das
Raster ist bewusst Phase 2.)

## Dateien

| Datei | Zweck |
|-------|-------|
| `index.html` | App-Hülle + Rollen-Umschalter |
| `styles.css` | mobile-first Styling, große Tap-Flächen |
| `app.js` | State, Persistenz, Seed-Daten, Render-Logik |
| `manifest.webmanifest`, `sw.js`, `icon.svg` | PWA / Offline |

## Zurücksetzen

*Händler* → „Beispiel-Laden zurücksetzen“ stellt die Seed-Daten wieder her.
