# MagLite - Linee Guida e Standard di Sviluppo

Questo file contiene le best practice e gli standard architetturali adottati per lo sviluppo del gestionale MagLite, utile per mantenere il codice pulito, organizzato e scalabile in vista delle future evoluzioni (sia locali che in produzione su server VPS).

---

## 1. Struttura del Database (La "Single Source of Truth")

Abbiamo implementato un sistema di **Auto-Migrazione Intelligente**.
A differenza dei normali framework (che necessitano di ORM complessi), qui adottiamo uno standard molto pratico e "puro":

- **Il file `database/init.sql`**: È l'unico punto di riferimento (Single Source of Truth) per la struttura del database. Se devi creare una nuova tabella o aggiungere una colonna "da zero", scrivila QUI DENTRO.
- **Lo script `backend/src/scripts/migrate.js`**: Questo script **parte in automatico ad ogni avvio del server Node.js** (`app.js`). Il suo comportamento è suddiviso in due passaggi:
  1. **Lettura automatica di `init.sql`**: Prende l'intero file SQL e tenta di eseguirlo riga per riga, assicurandosi che tutte le tabelle principali vengano create se non esistono (`CREATE TABLE IF NOT EXISTS`). In questo modo, su un nuovo VPS non dimenticherai mai le tabelle base!
  2. **Esecuzione delle `ALTER TABLE`**: Contiene un array di query per iniettare nuove colonne a database *già esistenti e popolati*. Se aggiungi una colonna, ricordati di aggiornare `init.sql` (per le nuove installazioni) e di inserire la query `ALTER TABLE` in questo array per aggiornare la VPS di produzione in modo indolore, senza perdite di dati.

*Gli script vecchi ("usa e getta") creati manualmente sono stati spostati per pulizia nella cartella `archive/`.*

---

## 2. Struttura Cartelle e Standard del Codice

### Backend (`/backend/src/`)
- `routes/`: Contiene la logica API divisa per contesto (`customers.js`, `finances.js`, `billing.js`). **Regola d'oro**: Ogni nuovo modulo applicativo (es. HR, Statistiche avanzate) deve avere il suo file dedicato, per non ingigantire `app.js`.
- `config/db.js`: Mantiene la logica di pool e connessione, isolandola dal resto.
- `scripts/`: Confinata esclusivamente per task d'utilità (come `migrate.js` e la creazione forzata di utenti admin).
- `app.js`: È l'entry-point. Si deve limitare *esclusivamente* a: istanziare fastify, registrare i plugin (CORS, JWT), invocare i middleware di autenticazione e registrare i `prefix` delle rotte. **Nessuna logica di business deve stare qui.**

### Frontend (`/frontend/src/`)
- `pages/desktop/`: Le viste React destinate ai computer da magazzino e backoffice (layout largo, dashboard con recharts).
- `zebra/`: Dedicata ai terminali portatili Zebra Android. **Usa sempre interfacce a pulsanti giganti** e input triggerabili via hardware scanner. Nessuna tabella complessa, solo schede e form di lettura rapida.
- `utils/`: Funzioni pure (es. formattazione valuta, parser di date, alert centralizzati con SweetAlert2).

---

## 3. Suggerimenti di Miglioramento e Prossimi Step (Roadmap)

Il gestionale ha raggiunto una solida architettura WMS + ERP (Finanza). Ecco le aree chiave su cui potremmo lavorare in futuro per renderlo una piattaforma di livello Enterprise:

### A. Ottimizzazione delle Prestazioni e del Codice
- **Transazioni SQL (Rollback)**: Attualmente alcune operazioni (es. eliminazione ordini complessi o prelievi in `outbound.js`) eseguono query multiple senza `START TRANSACTION` e `COMMIT`. Implementarle proteggerebbe l'integrità dei dati se la rete dovesse saltare a metà di una spedizione.
- **Paginazione (Pagination)**: Lo storico proforme, l'inventario e le anagrafiche adesso caricano tutte le righe dal DB in un'unica chiamata (`SELECT * FROM table`). Con migliaia di record il browser inizierà a soffrire; dovremmo implementare `LIMIT` e `OFFSET` in backend abbinati ad uno scroll o tabulatore sul React.

### B. Nuove Funzionalità (Feature)
- **Generazione e Stampa Etichette (Barcode)**: Un modulo Node.js (usando `pdfkit` o ZPL puro) per generare file di stampa diretta o PDF nel formato 10x15cm (etichette per le palette), da sputare direttamente sulle stampanti termiche Zebra ZT.
- **Import/Export Massivo (Excel/CSV)**: Creare un modulo in `backend/src/utils/excelParser.js` per permettere agli operatori di caricare decine di anagrafiche articoli in un colpo solo o scaricare l'inventario.
- **Gestione Multi-Magazzino avanzata**: Attualmente tracciamo "Locations" singole. Si potrebbe implementare un sistema a 3 livelli: `Warehouse (Struttura) -> Area (Cella/Secco) -> Location (A1-02)`.
- **Tracciamento dei Corrieri**: Aggiungere campi per collegare le fatture o le uscite merce ai Tracking Number dei corrieri (BRT, SDA, ecc.), per automatizzare le notifiche al cliente via email.

---
*Segui sempre questa struttura e manterrai MagLite scalabile, intuitivo e libero da crash improvvisi!*
