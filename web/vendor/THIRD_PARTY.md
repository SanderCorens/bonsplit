# Third-party browser assets

All runtime dependencies are served from this directory; the app does not load them from a CDN.

| Asset | Version/source | License |
|---|---|---|
| PDF.js (`pdfjs/`) | `pdfjs-dist` 4.10.38 | Apache-2.0; see `pdfjs/LICENSE` |
| Tesseract.js (`tesseract/`) | `tesseract.js` 5.1.1 | Apache-2.0; see `tesseract/LICENSE.md` |
| Tesseract WASM core (`tesseract/core/`) | `tesseract.js-core` 5.1.1 | Apache-2.0; see `tesseract/core/LICENSE` |
| Dutch and English OCR models (`tesseract/lang/`) | `tessdata_fast` from the Tesseract OCR project | Apache-2.0; see the model source in `tesseract/lang/README.txt` |

The minified JS, WebAssembly and language model files are unmodified upstream distributions. BonSplit-specific source code is outside this folder.
