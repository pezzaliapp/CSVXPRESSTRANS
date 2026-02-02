# Trasporti Use Friendly — Calcolo automatico (PWA)

PWA offline-first per stimare **costi di trasporto** su base:
- **Bancale (PALLET)**: tariffa max per Regione + tipo bancale
- **Groupage / Parziale (GROUPAGE)**: tariffa per Provincia (o gruppi di province) + scaglioni **LM / Quintali / N° bancali**

Include:
- UI ottimizzata **mobile/desktop**
- **Multi-carico Groupage** (aggiungi più articoli, base + stack)
- Opzioni: **preavviso**, **assicurazione (3%)**, **sponda (se prevista)**, **km oltre capoluogo**, **località disagiata/ZTL/isole minori**
- Pulsanti **Condividi / WhatsApp / TXT**
- Il costo mostrato è **già comprensivo di ricarico fisso 30%** (UI semplificata)
- Auto-update PWA (Service Worker) con reload automatico quando esce una nuova versione

> **Versione clienti (Use Friendly):** interfaccia semplificata, niente funzioni tecniche/batch, ricarico fisso 30% già incluso.

---

## Demo / URL
Apri la PWA da GitHub Pages (se pubblicata nel repo) oppure dal tuo dominio.

---

## Struttura progetto
```
/
├─ index.html
├─ styles.css
├─ app.js
├─ sw.js
├─ manifest.json
└─ data/
├─ articles.json
├─ pallet_rates_by_region.json
├─ groupage_rates.json
└─ geo_provinces.json        (opzionale)
```
### Dataset richiesti

#### `data/articles.json`
Elenco articoli. Campi tipici supportati:
- `code` (codice)
- `name` (descrizione)
- `palletType` (es. FULL / HALF / ecc.) se applicabile
- `note` / `notes` / `nota` (testo note) usato per le **regole automatiche** (vedi sotto)

> Le note possono contenere indicazioni operative tipo:  
> `NO SPONDA - GROUPAGE 3 MT / quotazione`

#### `data/pallet_rates_by_region.json`
Tariffe bancale per Regione e per tipo bancale.

#### `data/groupage_rates.json`
Tariffe groupage per Provincia o per **gruppi di province** (es. `AR SI LI`, `FR LT`, `BN-NA`, `MT / PZ`).
Supporta scaglioni e logiche “forfait” come da listino Excel.

#### `data/geo_provinces.json` (opzionale)
Mappa Regione → elenco Province per filtrare la select Province in base alla Regione.

---

## Regole automatiche basate sulle NOTE (IMPORTANTI)

La PWA legge le note articolo (campo `note/notes/nota`) e applica direttive:

### 1) `NO SPONDA`
- **Non forza** Groupage da sola
- Disabilita/ignora la spunta **Sponda** (anche se l’utente la attiva)

### 2) `GROUPAGE`
- Forza il servizio **GROUPAGE** (anche se l’utente aveva selezionato PALLET)

### 3) `X MT` (es. `3 MT`, `3,5 MT`)
- Imposta i **metri lineari (LM)** a quel valore
- Applicata solo se **GROUPAGE** è attivo (o viene forzato dalla nota)

### 4) `quotazione` / `preventivo`
- Attiva una nota di controllo (flag interno “forceQuote”)
- Serve a indicare che la tariffa è da considerarsi **indicativa / da confermare**

> Esempio valido:  
> `NO SPONDA - GROUPAGE 3 MT / quotazione`  
> Risultato: servizio GROUPAGE, LM=3, sponda bloccata, warning “quotazione”.

---

## Come si usa

### A) Calcolo singolo
1. Seleziona **Servizio**
2. Seleziona **Regione** e (se GROUPAGE) anche **Provincia**
3. Seleziona **Articolo** e **Quantità**
4. Premi **Calcola**

### B) Multi-carico (solo GROUPAGE)
Quando il servizio è **GROUPAGE**, puoi aggiungere più articoli:
- scegli una **Base (pianale)** e marca gli altri come **stackabili**
- il sistema riporta LM / quintali / bancali totali e calcola su scaglioni

---

## Pulsanti Condivisione

Sotto il box “Riepilogo” ci sono:
- **Condividi** (fallback: copia testo/uso Web Share se disponibile)
- **WhatsApp** (apre WhatsApp con testo pronto)
- **TXT** (scarica un file `.txt` con il report)

Il testo condiviso contiene **solo dati utili** (destinazione, servizio, carico, opzioni e totale), evitando indicazioni “interne”.

---

## Batch / Convertitori

Sezione dedicata a:
- Import CSV articoli → genera `articles.json`
- Import CSV Regioni→Province → genera `geo_provinces.json`
- Import CSV offerta (righe) → calcola trasporto in batch → export `batch_result.csv`

> I template CSV sono indicati nella UI.

---

## PWA / Offline / Auto-update

- La PWA registra `sw.js` per cache offline
- All’avvio forza `reg.update()` (check aggiornamenti)
- Quando un nuovo SW prende il controllo (controllerchange), la pagina fa reload automatico (anti-loop via sessionStorage)

---

## Note e limiti noti (buone pratiche)
- Le tariffe Groupage sono **a scaglioni**: oltre le soglie massime del listino, può servire logica “preventivo”
- Alcune destinazioni (es. isole / ZTL / disagiata) introducono maggiorazioni/avvisi
- Le “note articolo” sono la chiave per forzare comportamenti corretti (es. NO SPONDA / GROUPAGE / X MT)

---

## Licenza

### Licenza proprietaria – Uso riservato

© Alessandro Pezzali – PezzaliAPP  
Tutti i diritti riservati.

Questo progetto, inclusi ma non limitati a:
- codice sorgente (`app.js`, `sw.js`, ecc.)
- logiche di calcolo, algoritmi e regole automatiche
- dataset (`articles.json`, `groupage_rates.json`, `pallet_rates_by_region.json`, ecc.)
- struttura PWA, Service Worker, UI e documentazione

è un’opera protetta da diritto d’autore.

---

### Utilizzi vietati

È **espressamente vietato**, senza preventiva autorizzazione scritta dell’autore:

- copiare, riprodurre o distribuire il progetto, in tutto o in parte  
- modificare, adattare o creare opere derivate  
- utilizzare il software per scopi commerciali, professionali o produttivi  
- pubblicare fork, mirror o versioni modificate del repository  
- integrare logiche, algoritmi o strutture dati in altri software o servizi  
- utilizzare il progetto come base per strumenti simili o concorrenti  

---

### Utilizzi consentiti

È consentito **esclusivamente**:

- l’uso personale, interno o dimostrativo  
- **solo previa concessione espressa e scritta** da parte dell’autore  

La disponibilità del codice su GitHub **non costituisce concessione di licenza**, né implicita né esplicita.

---

### Clausola di tutela

Qualsiasi utilizzo non autorizzato sarà considerato violazione dei diritti d’autore e potrà essere perseguito ai sensi delle normative vigenti in materia di proprietà intellettuale.

---

### Nota finale

Questo progetto **non è open source**, anche se ospitato su GitHub.  
Per richieste di utilizzo, licenze dedicate o collaborazioni, contattare direttamente l’autore.

## License

### Proprietary License – Restricted Use

© Alessandro Pezzali – PezzaliAPP  
All rights reserved.

This project, including but not limited to:
- source code (`app.js`, `sw.js`, etc.)
- calculation logic, algorithms, and automatic rules
- datasets (`articles.json`, `groupage_rates.json`, `pallet_rates_by_region.json`, etc.)
- PWA structure, Service Worker, UI, and documentation

is protected by copyright law.

---

### Prohibited Uses

Unless explicitly authorized in writing by the author, it is strictly prohibited to:

- copy, reproduce, or distribute this project, in whole or in part  
- modify, adapt, or create derivative works  
- use the software for commercial, professional, or production purposes  
- publish forks, mirrors, or modified versions of the repository  
- reuse or integrate logic, algorithms, or data structures into other software or services  
- use this project as a basis for similar or competing tools  

---

### Permitted Uses

The following is permitted **only**:

- personal, internal, or demonstrative use  
- **exclusively with prior written permission** from the author  

The availability of this code on GitHub **does not grant any license**, whether explicit or implied.

---

### Legal Protection Clause

Any unauthorized use of this project will be considered a violation of copyright law and may be prosecuted under applicable intellectual property regulations.

---

### Final Note

This project **is not open source**, even if hosted on GitHub.  
For licensing requests, authorized usage, or collaborations, please contact the author directly.
