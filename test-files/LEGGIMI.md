# File di prova per PDF → DOCX

Generati da `tools/make-test-pdfs.js`.

| File | Cosa mette alla prova |
|---|---|
| 01-tabella-semplice | tabella 4 colonne con intestazione |
| 02-due-colonne | titolo a tutta larghezza + testo su due colonne (ordine di lettura, paragrafo che cambia colonna) |
| 03-misto | grassetto/corsivo nel testo, elenco puntato, elenco numerato, tabella con celle su più righe |
| 04-multipagina | più pagine, tabella che continua sulla pagina dopo (righe nei margini) |
| 05-scansione | pagina-immagine senza testo: ripiego sulle immagini (serve OCR per fare meglio) |
| 06-con-immagine | grafico vettoriale in mezzo al testo |

Comandi (dalla cartella del progetto):

- `npx electron tools/make-test-pdfs.js` rigenera i PDF
- `npx electron tools/check.js [filtro]` converte tutto in `output/` e controlla: caratteri persi, tabelle, titoli, elenchi, immagini (con `OUTLINE=30` mostra anche la struttura)

