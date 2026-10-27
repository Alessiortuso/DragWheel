# DragWheel

Un'app per Windows che vive nell'area di notifica. Trascini un file e, tenendo premuto un tasto (di default la **barra spaziatrice**), compare una **ruota**: lasci il file su un petalo e il file viene convertito o modificato. La ruota mostra solo ciò che ha senso per il tipo di file che stai trascinando.

*English: a Windows tray app. Hold a key (Space by default) while dragging a file and a radial wheel appears; drop the file on a petal to convert or edit it. Everything runs locally, nothing is uploaded. See the [English summary](#english-summary) at the end.*

## Cosa sa fare

| File | Conversioni (anello esterno) | Azioni (centro) |
|---|---|---|
| **Immagini** (PNG, JPG, WEBP, TIFF, AVIF, BMP, GIF, SVG) | verso tutti gli altri formati, PDF e DOCX | Ritaglia, Ridimensiona, Rimuovi sfondo (con editor a pennello) |
| **PDF** | PNG, WEBP, JPG, TIFF, AVIF, BMP, GIF, DOCX (con testo e tabelle veri), TXT | Modifica, Pagine, Unisci, **Firma digitale**, Proteggi con password, Comprimi |
| **Video** (MP4, MOV, MKV, WEBM, AVI, WMV, FLV, MPG, TS…) | verso gli altri video, GIF e tutti i formati audio | Comprimi, Ridimensiona, Taglia, Fotogrammi, Voce e musica |
| **Audio** (MP3, M4A, WAV, FLAC, OGG, OPUS, AAC, AIFF, WMA) | verso tutti gli altri | Taglia (più parti insieme), Unisci in sequenza, Volume, **Voce e musica** (separa la voce dalla base strumentale, anche batteria, basso e altri strumenti) |
| **Fogli di calcolo** (XLSX, XLS, ODS, CSV, TSV) | verso gli altri, JSON, HTML, PDF, SQL | Dividi, Unisci, Pulisci, Confronta |
| **Documenti Word** (DOCX) | PDF, TXT, HTML, Markdown, immagini estratte | Unisci, Comprimi, Pulisci, Sostituisci |
| **Dati** (JSON, YAML, TOML, XML) | verso gli altri, CSV, SQL (CREATE TABLE + INSERT) | Formatta, Minifica (JSON, XML), Valida (con riga e colonna dell'errore), Tipi TS e schema (interfacce TypeScript + JSON Schema) |
| **Markdown** (MD) e **HTML** | Markdown → HTML (pagina con stile) e PDF; HTML → PDF | |
| **Cartelle** e **ZIP** | | Cartelle (anche con file) → Comprimi in ZIP; ZIP → Estrai |

### Strumenti PDF

- **Modifica**: aggiungi testo (con carattere, dimensione, colore, allineamento), modifica un testo già presente (viene coperto e riscritto con carattere e corpo stimati), evidenzia, copri (bianchetto), **oscura** in modo sicuro (la pagina diventa un'immagine e il testo sotto il nero sparisce davvero), rettangoli, ellissi, linee, frecce, penna a mano libera, spunte, croci, data, immagini e **firma autografa** (disegnata, scritta o da immagine, salvata per le volte successive). Annulla/Ripeti, zoom, proprietà del documento (titolo, autore…).
- **Pagine**: riordina trascinando, ruota, duplica, elimina, inserisci pagine vuote, altri PDF o immagini; salva le pagine scelte come nuovo PDF o dividi il documento ogni N pagine.
- **Unisci** (trascinando più PDF): tutte le pagine in un unico file, con le stesse possibilità della scheda Pagine.
- **Moduli**: compila i campi dei moduli PDF ed eventualmente rendili definitivi.
- **Firma digitale**: firma PAdES (il PDF resta un PDF, Acrobat mostra la firma) o busta CAdES **.p7m**, con i certificati installati in Windows, con **smart card e chiavette di firma digitale** (CNS, firma qualificata: Windows chiede il PIN) o con un file **.pfx/.p12**. Firma visibile con nome, data, motivo e firma autografa, oppure invisibile. Le firme già presenti restano valide (aggiornamento incrementale) e vengono verificate.
- **Proteggi**: password di apertura e limiti di stampa, copia e modifica (AES a 256 bit).
- **Comprimi**: ricomprime e ridimensiona le foto, elimina gli oggetti inutilizzati.

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
npm run get-models    # scarica i modelli per "Rimuovi sfondo" (~460 MB, verificati con SHA-256)
npm start
```

Serve [Node.js](https://nodejs.org) 20 o superiore.

## Uso

1. L'icona rossa compare nell'area di notifica (vicino all'orologio). Dal suo menu scegli il **tasto di attivazione** (Spazio, Maiusc, Ctrl, Alt) e se avviare l'app con Windows.
2. Inizia a trascinare un file con il mouse e **tieni premuto il tasto**: compare la ruota.
3. Rilascia il file su un formato (conversione) o su un'azione (si apre una finestra con le opzioni).

La ruota propone solo opzioni per file supportati. Le **cartelle** si possono solo comprimere in uno ZIP; i **formati non supportati** non hanno opzioni: la ruota lo scrive al centro e spiega il motivo in basso. Se Windows non indica il tipo durante il trascinamento (succede con le cartelle e con alcuni file, per esempio MKV), la ruota chiede di rilasciare il file per controllarlo e poi propone le opzioni giuste.

## Creare l'installer

```powershell
npm run dist          # scarica i modelli se mancano e crea dist\DragWheel Setup x.y.z.exe
```

L'installer pesa circa 600 MB perché include FFmpeg e i modelli di intelligenza artificiale (rimozione sfondo e separazione voce/musica).

## Test

```powershell
npm run test:all      # tutto
npm test              # conversioni immagini/PDF (dentro Electron)
npm run test:audio    # strumenti audio
npm run test:video    # strumenti video
npm run test:sheet    # fogli di calcolo
npm run test:doc      # documenti Word (se Word è installato verifica anche i file prodotti)
npm run test:dev      # dati (JSON/YAML/TOML/XML/CSV/SQL), ZIP, Markdown e HTML -> PDF
npm run test:wheel    # ruota: cartelle, formati non supportati, file senza tipo
npm run test:pdf      # strumenti PDF: modifiche, pagine, moduli, compressione, password, firma digitale
npm run test:matrix   # tutte le combinazioni di conversione
```

I test generano da soli i file di cui hanno bisogno (in `tools/` ci sono anche script per provare le finestre e catturare screenshot).

## Privacy e sicurezza

- **Nessuna connessione di rete** durante l'uso. Internet serve solo per `npm install` e `npm run get-models`.
- L'app usa un **hook globale di tastiera e mouse** ([uiohook-napi](https://github.com/SnosMe/uiohook-napi)) solo per accorgersi che stai trascinando un file mentre tieni premuto il tasto scelto. Non registra né salva i tasti premuti.
- Gli eventi dell'app e i percorsi dei file elaborati sono scritti in `%APPDATA%\DragWheel\log.txt` (circa 512 KB al massimo, poi il vecchio log passa a `log.old.txt`). Puoi cancellarlo quando vuoi.
- Le finestre usano `contextIsolation` e `sandbox`, hanno una Content-Security-Policy e non caricano contenuti remoti. Apri/mostra un file dal risultato funziona solo per file di dati, mai per programmi o script.
- La firma digitale usa le API crittografiche di Windows tramite PowerShell (`src/pdf/sign.ps1`): la chiave privata non esce mai dal certificato o dalla smart card. La password di un file .pfx viene passata solo in memoria e non viene salvata. Le firme autografe disegnate sono salvate nella cartella `firme` dentro `%APPDATA%\DragWheel`.
- Le conversioni verso CSV non neutralizzano le celle che iniziano con `=`: se apri un CSV di provenienza non fidata in Excel, le formule vengono eseguite come in qualsiasi CSV.

## Limiti noti

- PDF: “Modifica testo” copre il testo originale e lo riscrive, ma l'originale resta nel file sotto la copertura (per eliminarlo davvero usa “Oscura”). I testi aggiunti usano i caratteri standard del PDF (Helvetica, Times, Courier): lettere accentate ed euro vanno bene, gli alfabeti non latini e le emoji diventano “?”. I PDF protetti da password non si possono aprire.
- Dati: convertendo verso TOML i valori null vengono tolti (TOML non li prevede) e i commenti TOML non sopravvivono a “Formatta” (quelli YAML e XML sì); gli attributi XML diventano chiavi “@_nome”. I tipi TypeScript e lo schema sono ricavati dai dati di esempio: vanno controllati.
- Markdown/HTML → PDF: JavaScript non viene eseguito e le risorse online (immagini, font remoti) non vengono scaricate, per non usare la rete; quelle locali sì.
- ZIP: gli archivi protetti da password non si estraggono; quelli con percorsi che uscirebbero dalla cartella (“../”) vengono rifiutati. I collegamenti simbolici nelle cartelle non vengono inclusi.
- Firma digitale: non viene aggiunta una marca temporale (servirebbe Internet). Il valore legale dipende dal certificato: serve un certificato di firma qualificato (per esempio quello della smart card o della chiavetta del tuo ente certificatore). Modificare, comprimere o proteggere con password un PDF già firmato rende non valide le firme presenti (l'app lo segnala).
- Solo Windows. La conversione PDF → DOCX ricostruisce testo, titoli, elenchi e tabelle, ma non è identica all'originale; i PDF scansionati (senza testo) diventano immagini.
- La rimozione dello sfondo con il modello "Preciso" può usare diversi GB di RAM per qualche secondo.
- La separazione voce/musica impiega circa i due terzi della durata del brano su un portatile recente (un brano da 4 minuti richiede circa 3 minuti), usa circa 500 MB di RAM e restituisce audio stereo a 44,1 kHz.
- Windows limita il trascinamento da e verso programmi avviati come amministratore: con quelli l'attivazione può non funzionare.

## Struttura

```
src/            app: main, ruota, finestre degli strumenti
  bg/           rimozione sfondo (onnxruntime)
  video/ audio/ ffmpeg
  sheet/ doc/   fogli di calcolo e DOCX
  pdf/          modifica, pagine, password (AES-256) e firma digitale dei PDF
  data/         JSON, YAML, TOML, XML: conversioni, validazione, tipi
  archive.js    cartelle <-> ZIP;  web-docs.js  Markdown/HTML -> HTML/PDF
tools/          test e script di sviluppo (get-models, icona, screenshot)
test-files/     PDF di prova per la conversione PDF → DOCX
build/          icona
```

## Licenze di terze parti

Il codice di DragWheel è rilasciato con licenza [MIT](LICENSE). Le dipendenze hanno licenze proprie:

- **FFmpeg** (`ffmpeg-static`, `@ffprobe-installer`): GPL-3.0. Se distribuisci l'installer, devi rispettare anche i termini della GPL per quei programmi.
- **ISNet** (modello "Veloce"): Apache-2.0, dal progetto [DIS](https://github.com/xuebinqin/DIS), estratto dal pacchetto `@imgly/background-removal-node` (che ha la sua licenza: non è una dipendenza dell'app, serve solo a `npm run get-models`).
- **BiRefNet lite** (modello "Preciso"): MIT, da [onnx-community/BiRefNet_lite-ONNX](https://huggingface.co/onnx-community/BiRefNet_lite-ONNX).
- **HT-Demucs** (separazione voce/musica): MIT, [Meta / facebookresearch/demucs](https://github.com/facebookresearch/demucs), nell'esportazione ONNX di [adowu/htdemucs-onnx](https://huggingface.co/adowu/htdemucs-onnx).
- Electron, sharp, pdf.js, SheetJS, ExcelJS, docx, mammoth, pdf-lib, onnxruntime-node, marked, yaml, smol-toml, fast-xml-parser, yazl, yauzl: MIT, ISC, Apache-2.0 o BSD.

## English summary

DragWheel is a Windows tray app. While dragging a file, hold the trigger key (Space by default; Shift/Ctrl/Alt selectable from the tray menu) and a radial wheel appears with only the formats and actions that make sense for that file type: image/PDF/video/audio/spreadsheet/DOCX conversions, crop, resize, background removal, trimming, merging, compressing, cleaning and more. PDFs can also be edited (text, shapes, highlights, true redaction, images, handwritten signatures), reorganized, merged, form-filled, password-protected (AES-256), compressed and **digitally signed** (PAdES or CAdES .p7m) with Windows certificates, smart cards/tokens or .pfx files. Everything runs locally; originals are never modified.

Install from the *Releases* page (unsigned installer) or from source: `npm install`, `npm run get-models`, `npm start`. Build an installer with `npm run dist`. Microsoft Word is optional (exact PDF export and DOCX merging). The UI is in Italian. Licensed under MIT; bundled FFmpeg binaries are GPL-3.0.
