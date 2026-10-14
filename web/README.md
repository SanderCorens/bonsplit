# BonSplit browserapp

Deze losse statische webversie staat naast de bestaande Streamlit-app. De browserapp heeft geen Python-server nodig en kan op GitHub Pages worden gepubliceerd. PDF-tekst wordt lokaal gelezen met PDF.js; scans en afbeeldingen worden lokaal verwerkt met Tesseract.js en meegeleverde Nederlandse en Engelse taalmodellen.

## Lokaal testen

Vanuit deze map kun je een eenvoudige statische server starten, bijvoorbeeld:

```bash
python3 -m http.server 8000
```

Open daarna `http://localhost:8000` in een browser. Open `index.html` niet rechtstreeks als `file://`; ES-modules, de PDF-worker en OCR-worker hebben een HTTP-origin nodig.

De parser- en geldtests gebruiken de ingebouwde Node-testmodule; er zijn geen npm-dependencies nodig:

```bash
node --test
```

## GitHub Pages

De workflow in `.github/workflows/pages.yml` publiceert uitsluitend deze map (`web/`) bij een push naar `main`. Stel in GitHub bij **Settings → Pages → Build and deployment** de bron in op **GitHub Actions**. Na de eerste succesvolle workflow toont GitHub de openbare website-URL.

De GitHub Pages-site is openbaar, maar de bonnen worden niet naar GitHub gestuurd: PDF- en afbeeldingsverwerking, OCR, verdeling en CSV-opmaak gebeuren in de browser. De repository bevat wel de applicatiecode en de lokale PDF/OCR-libraries en taalmodellen. Voeg nooit echte bonnen, CSV-exporten, `.venv` of browsergegevens toe aan de site.

## Privacy en browserondersteuning

- Geen API-calls voor OCR, geen analytics, geen database en geen login.
- De pagina laadt geen externe CDN- of fontbestanden; benodigde verwerkingsbestanden staan lokaal in `vendor/`.
- De eerste laadbeurt downloadt de webapp en OCR-modellen vanaf GitHub Pages. Daarna blijft de bon op het apparaat; OCR kan op oudere iPhones traag zijn.
- Gebruik **Wis bon** of sluit het tabblad om tijdelijke bon- en verdelingsgegevens uit de app te verwijderen. De webapp bewaart geen bonhistoriek en beëindigt de OCR/PDF-workers na verwerking.
- Controleer herkende regels en bon-totalen altijd vóór export.

## Meegeleverde libraries

Licenties en versies staan bij de bestanden in `vendor/` en in `vendor/THIRD_PARTY.md`.
