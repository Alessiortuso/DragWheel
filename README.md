# DragWheel

Un'app per Windows che vive nell'area di notifica. Trascini un file e, tenendo premuto un tasto (di default la **barra spaziatrice**), compare una **ruota**: lasci il file su un petalo e il file viene convertito o modificato. La ruota mostra solo ciò che ha senso per il tipo di file che stai trascinando.

*English: a Windows tray app. Hold a key (Space by default) while dragging a file and a radial wheel appears; drop the file on a petal to convert or edit it. Everything runs locally, nothing is uploaded. See the [English summary](#english-summary) at the end.*

## Cosa sa fare

| File | Conversioni (anello esterno) | Azioni (centro) |
|---|---|---|
| **Immagini** (PNG, JPG, WEBP, TIFF, AVIF, BMP, GIF, SVG) | verso tutti gli altri formati, PDF e DOCX | Ritaglia, Ridimensiona, Rimuovi sfondo (con editor a pennello) |
| **PDF** | PNG, WEBP, JPG, TIFF, AVIF, BMP, GIF, DOCX (con testo e tabelle veri), TXT | |
| **Video** (MP4, MOV, MKV, WEBM, AVI, WMV, FLV, MPG, TS…) | verso gli altri video, GIF e tutti i formati audio | Comprimi, Ridimensiona, Taglia, Fotogrammi |
| **Audio** (MP3, M4A, WAV, FLAC, OGG, OPUS, AAC, AIFF, WMA) | verso tutti gli altri | Taglia (più parti insieme), Unisci in sequenza, Volume |
| **Fogli di calcolo** (XLSX, XLS, ODS, CSV, TSV) | verso gli altri, JSON, HTML, PDF | Dividi, Unisci, Pulisci, Confronta |
| **Documenti Word** (DOCX) | PDF, TXT, HTML, Markdown, immagini estratte | Unisci, Comprimi, Pulisci, Sostituisci |

Tutto avviene **sul tuo computer**: nessun file viene caricato online. I file originali non vengono mai modificati: i risultati sono file nuovi accanto all'originale.

## Requisiti

- Windows 10/11 a 64 bit
- *Facoltativo:* Microsoft Word, per ottenere PDF identici al documento e per unire i DOCX. Senza Word il PDF viene creato dal contenuto e l'impaginazione può differire; l'unione richiede Word.

## Installazione

**Con l'installer** (consigliato): scarica `DragWheel Setup x.y.z.exe` dalla pagina *Releases* e avvialo. L'installer non è firmato digitalmente, quindi Windows SmartScreen può mostrare un avviso ("Maggiori informazioni" → "Esegui comunque").

**Dal codice sorgente:**

```powershell
git clone <url-del-repository>
cd DragWheel
npm install
npm run get-models    # scarica i modelli per "Rimuovi sfondo" (~300 MB, verificati con SHA-256)
npm start
```

Serve [Node.js](https://nodejs.org) 20 o superiore.

## Uso

1. L'icona rossa compare nell'area di notifica (vicino all'orologio). Dal suo menu scegli il **tasto di attivazione** (Spazio, Maiusc, Ctrl, Alt) e se avviare l'app con Windows.
2. Inizia a trascinare un file con il mouse e **tieni premuto il tasto**: compare la ruota.
3. Rilascia il file su un formato (conversione) o su un'azione (si apre una finestra con le opzioni).

## Creare l'installer

```powershell
npm run dist          # scarica i modelli se mancano e crea dist\DragWheel Setup x.y.z.exe
```

L'installer pesa circa 450 MB perché include FFmpeg e i modelli di rimozione sfondo.

## Test

```powershell
npm run test:all      # tutto
npm test              # conversioni immagini/PDF (dentro Electron)
npm run test:audio    # strumenti audio
npm run test:video    # strumenti video
npm run test:sheet    # fogli di calcolo
npm run test:doc      # documenti Word (se Word è installato verifica anche i file prodotti)
npm run test:matrix   # tutte le combinazioni di conversione
```

I test generano da soli i file di cui hanno bisogno (in `tools/` ci sono anche script per provare le finestre e catturare screenshot).

## Privacy e sicurezza

- **Nessuna connessione di rete** durante l'uso. Internet serve solo per `npm install` e `npm run get-models`.
- L'app usa un **hook globale di tastiera e mouse** ([uiohook-napi](https://github.com/SnosMe/uiohook-napi)) solo per accorgersi che stai trascinando un file mentre tieni premuto il tasto scelto. Non registra né salva i tasti premuti.
- Gli eventi dell'app e i percorsi dei file elaborati sono scritti in `%APPDATA%\DragWheel\log.txt` (circa 512 KB al massimo, poi il vecchio log passa a `log.old.txt`). Puoi cancellarlo quando vuoi.
- Le finestre usano `contextIsolation` e `sandbox`, hanno una Content-Security-Policy e non caricano contenuti remoti. Apri/mostra un file dal risultato funziona solo per file di dati, mai per programmi o script.
- Le conversioni verso CSV non neutralizzano le celle che iniziano con `=`: se apri un CSV di provenienza non fidata in Excel, le formule vengono eseguite come in qualsiasi CSV.

## Limiti noti

- Solo Windows. La conversione PDF → DOCX ricostruisce testo, titoli, elenchi e tabelle, ma non è identica all'originale; i PDF scansionati (senza testo) diventano immagini.
- La rimozione dello sfondo con il modello "Preciso" può usare diversi GB di RAM per qualche secondo.
- Windows limita il trascinamento da e verso programmi avviati come amministratore: con quelli l'attivazione può non funzionare.

## Struttura

```
src/            app: main, ruota, finestre degli strumenti
  bg/           rimozione sfondo (onnxruntime)
  video/ audio/ ffmpeg
  sheet/ doc/   fogli di calcolo e DOCX
tools/          test e script di sviluppo (get-models, icona, screenshot)
test-files/     PDF di prova per la conversione PDF → DOCX
build/          icona
```

## Licenze di terze parti

Il codice di DragWheel è rilasciato con licenza [MIT](LICENSE). Le dipendenze hanno licenze proprie:

- **FFmpeg** (`ffmpeg-static`, `@ffprobe-installer`): GPL-3.0. Se distribuisci l'installer, devi rispettare anche i termini della GPL per quei programmi.
- **ISNet** (modello "Veloce"): Apache-2.0, dal progetto [DIS](https://github.com/xuebinqin/DIS), estratto dal pacchetto `@imgly/background-removal-node` (che ha la sua licenza: non è una dipendenza dell'app, serve solo a `npm run get-models`).
- **BiRefNet lite** (modello "Preciso"): MIT, da [onnx-community/BiRefNet_lite-ONNX](https://huggingface.co/onnx-community/BiRefNet_lite-ONNX).
- Electron, sharp, pdf.js, SheetJS, ExcelJS, docx, mammoth, pdf-lib, onnxruntime-node: MIT, Apache-2.0 o BSD.

## English summary

DragWheel is a Windows tray app. While dragging a file, hold the trigger key (Space by default; Shift/Ctrl/Alt selectable from the tray menu) and a radial wheel appears with only the formats and actions that make sense for that file type: image/PDF/video/audio/spreadsheet/DOCX conversions, crop, resize, background removal, trimming, merging, compressing, cleaning and more. Everything runs locally; originals are never modified.

Install from the *Releases* page (unsigned installer) or from source: `npm install`, `npm run get-models`, `npm start`. Build an installer with `npm run dist`. Microsoft Word is optional (exact PDF export and DOCX merging). The UI is in Italian. Licensed under MIT; bundled FFmpeg binaries are GPL-3.0.
