/* CSVXPRESSTRANS — app.js
   CSVXpressSmart (core) + link PWA Trasporti Use Friendly (separata)
   Fix UX: niente re-render su input → puoi scrivere 60, 100, 7,5 ecc senza blocchi.
*/

(function(){
  // -------------------- Service Worker (robusto) --------------------
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', async () => {
      const VER = document.documentElement.getAttribute('data-ver') || 'dev';
      const SW_URL = `service-worker.js?v=${encodeURIComponent(VER)}`;
      try {
        const reg = await navigator.serviceWorker.register(SW_URL);
        try { await reg.update(); } catch (_) {}
        reg.addEventListener('updatefound', () => {
          const nw = reg.installing;
          if (!nw) return;
          nw.addEventListener('statechange', () => {
            if (nw.state === 'installed' && navigator.serviceWorker.controller) {
              try { nw.postMessage({ type: 'SKIP_WAITING' }); } catch (_) {}
            }
          });
        });
        navigator.serviceWorker.addEventListener('controllerchange', () => {
          if (sessionStorage.getItem('sw_reloaded')) return;
          sessionStorage.setItem('sw_reloaded', '1');
          window.location.reload();
        });
      } catch (err) {
        console.warn('Service Worker non registrato:', err);
      }
    });
  }
})();

// -------------------- Helpers numerici --------------------
function parseDec(val){
  const s = String(val ?? '').trim().replace(/\s+/g,'').replace(',', '.');
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : 0;
}
function fmtEur(n){
  const x = Number(n);
  if(!Number.isFinite(x)) return '';
  return x.toFixed(2).replace('.', ',');
}
function clamp(n,min,max){ return Math.max(min, Math.min(max, n)); }
function roundTwo(n){ return Math.round(n*100)/100; }

// pulizia “digitazione”: lascia numeri e una virgola/punto
function sanitizeDecimalTyping(s){
  s = String(s ?? '');
  // consenti cifre + un separatore decimale
  s = s.replace(/[^\d.,-]/g, '');
  // solo un separatore: se ci sono più virgole/punti, tieni il primo
  const firstComma = s.indexOf(',');
  const firstDot = s.indexOf('.');
  let sepPos = -1;
  if(firstComma >= 0 && firstDot >= 0) sepPos = Math.min(firstComma, firstDot);
  else sepPos = Math.max(firstComma, firstDot);

  if(sepPos >= 0){
    const before = s.slice(0, sepPos+1);
    const after  = s.slice(sepPos+1).replace(/[.,]/g,''); // rimuovi altri sep
    s = before + after;
  }
  return s;
}

// -------------------- CSV Memory (IndexedDB) --------------------
const CSV_DB_NAME = 'csvxpresstrans_db_v1';
const CSV_STORE = 'kv';
const CSV_KEY = 'last_csv_payload';

function openDB(){
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(CSV_DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(CSV_STORE)) db.createObjectStore(CSV_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function idbSet(key, value){
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(CSV_STORE,'readwrite');
    tx.objectStore(CSV_STORE).put(value,key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
async function idbGet(key){
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(CSV_STORE,'readonly');
    const req = tx.objectStore(CSV_STORE).get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function idbDel(key){
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(CSV_STORE,'readwrite');
    tx.objectStore(CSV_STORE).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function updateSavedCsvInfoUI(payload){
  const info = document.getElementById('savedCsvInfo');
  if(!info) return;
  if(!payload || !payload.listino?.length){
    info.textContent = 'Nessun CSV salvato.';
    return;
  }
  const name = payload.meta?.name ? `“${payload.meta.name}”` : 'CSV';
  const when = payload.savedAt ? new Date(payload.savedAt).toLocaleString('it-IT') : '';
  const rows = payload.listino?.length || 0;
  info.textContent = `Salvato: ${name} • Righe: ${rows}${when ? ' • ' + when : ''}`;
}

async function saveLastCsvPayload(listinoRows, meta){
  const remember = document.getElementById('toggleRememberCSV');
  if (remember && !remember.checked) return;
  const payload = { savedAt: Date.now(), meta: meta || {}, listino: listinoRows || [] };
  try { await idbSet(CSV_KEY, payload); } catch(e){ console.warn(e); }
  updateSavedCsvInfoUI(payload);
}
async function loadLastCsvPayload(){
  try { return await idbGet(CSV_KEY); } catch(e){ return null; }
}
async function clearLastCsvPayload(){
  try { await idbDel(CSV_KEY); } catch(e){}
  updateSavedCsvInfoUI(null);
}

// -------------------- Stato CSVXpress (core) --------------------
let listino = [];
let articoliAggiunti = [];

function normalizeListino(rows){
  return rows.map(r => ({
    codice: String(r["Codice"] ?? r["codice"] ?? '').trim(),
    descrizione: String(r["Descrizione"] ?? r["descrizione"] ?? '').trim(),
    prezzoLordo: parseDec(r["PrezzoLordo"] ?? r["prezzoLordo"] ?? 0),
    sconto: parseDec(r["Sconto1"] ?? r["sconto"] ?? 0) || 0,
    sconto2: parseDec(r["Sconto2"] ?? r["sconto2"] ?? 0) || 0,
    scontoCliente: parseDec(r["ScontoCliente"] ?? r["scontoCliente"] ?? 0) || 0, // se non c’è, resta 0
    margine: parseDec(r["Margine"] ?? r["margine"] ?? 0) || 0,
    costoTrasporto: parseDec(r["CostoTrasporto"] ?? r["costoTrasporto"] ?? 0),
    costoInstallazione: parseDec(r["CostoInstallazione"] ?? r["costoInstallazione"] ?? 0),
    quantita: 1
  }));
}

// -------------------- UI bind --------------------
function $(id){ return document.getElementById(id); }

function aggiornaListinoSelect(){
  const sel = $("listinoSelect");
  const q = ($("searchListino")?.value || '').toLowerCase();
  sel.innerHTML = '';
  listino.forEach(it => {
    const hay = `${it.codice} ${it.descrizione}`.toLowerCase();
    if (!q || hay.includes(q)){
      const opt = document.createElement('option');
      opt.value = it.codice;
      opt.textContent = `${it.codice} - ${it.descrizione} - €${fmtEur(it.prezzoLordo)}`;
      sel.appendChild(opt);
    }
  });
}

function handleCSVUpload(ev){
  const file = ev.target.files?.[0];
  if(!file) return;

  const t0 = performance.now();
  Papa.parse(file, {
    header:true,
    skipEmptyLines:true,
    complete: async (res) => {
      const ms = Math.round(performance.now()-t0);
      if(!res.data?.length){
        $("csvError").style.display='block';
        return;
      }
      listino = normalizeListino(res.data);
      $("csvError").style.display='none';
      aggiornaListinoSelect();
      await saveLastCsvPayload(listino, { name:file.name, size:file.size, lastModified:file.lastModified });
      console.log('CSV OK', { rows:listino.length, ms });
    },
    error: (err) => {
      console.error('CSV error', err);
      $("csvError").style.display='block';
    }
  });
}

function aggiungiArticoloDaListino(){
  const code = $("listinoSelect")?.value;
  if(!code) return;
  const it = listino.find(x => x.codice === code);
  if(!it) return alert('Articolo non trovato nel listino.');
  articoliAggiunti.push({ ...it });
  renderTabellaArticoli();     // qui va bene re-render (evento “aggiungi”)
  renderReportPreview();
}

function computeRow(a){
  const lordo = parseDec(a.prezzoLordo);
  const qta = Math.max(1, parseInt(a.quantita || 1, 10) || 1);

  const sc1 = clamp(parseDec(a.sconto), 0, 100);
  const sc2 = clamp(parseDec(a.sconto2), 0, 100);
  const scCli = clamp(parseDec(a.scontoCliente), 0, 100);
  const marg = clamp(parseDec(a.margine), 0, 500);

  // modello semplice (coerente col tuo file attuale):
  // netto = lordo - sc1 - sc2
  const netto = lordo * (1 - sc1/100) * (1 - sc2/100);
  const venduto = netto * (1 + marg/100);

  const trasporto = Math.max(0, parseDec(a.costoTrasporto));
  const install = Math.max(0, parseDec(a.costoInstallazione));

  const totale = venduto * qta;
  const granTot = totale + trasporto + install;

  return {
    qta, sc1, sc2, scCli, marg,
    netto: roundTwo(netto),
    venduto: roundTwo(venduto),
    totale: roundTwo(totale),
    trasporto: roundTwo(trasporto),
    install: roundTwo(install),
    granTot: roundTwo(granTot)
  };
}

function escapeHtml(s){
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

// -------------------- Render tabella (NO re-render su input) --------------------
function renderTabellaArticoli(){
  const tbody = document.querySelector("#articoli-table tbody");
  if(!tbody) return;

  tbody.innerHTML = articoliAggiunti.map((a, idx) => {
    const c = computeRow(a);

    return `
      <tr data-row="${idx}">
        <td data-col="codice">${escapeHtml(a.codice)}</td>
        <td data-col="descrizione">${escapeHtml(a.descrizione)}</td>

        <td data-col="prezzoLordo">
          <input data-k="prezzoLordo" data-i="${idx}" value="${fmtEur(parseDec(a.prezzoLordo))}" inputmode="decimal">
        </td>

        <td data-col="sconto1">
          <input data-k="sconto" data-i="${idx}" value="${fmtEur(parseDec(a.sconto))}" inputmode="decimal">
        </td>

        <td data-col="sconto2">
          <input data-k="sconto2" data-i="${idx}" value="${fmtEur(parseDec(a.sconto2))}" inputmode="decimal">
        </td>

        <td data-col="scontoCliente">
          <input data-k="scontoCliente" data-i="${idx}" value="${fmtEur(parseDec(a.scontoCliente))}" inputmode="decimal">
        </td>

        <td data-col="margine">
          <input data-k="margine" data-i="${idx}" value="${fmtEur(parseDec(a.margine))}" inputmode="decimal">
        </td>

        <td data-col="totaleNetto" data-out="totale">€${fmtEur(c.totale)}</td>

        <td data-col="trasporto">
          <div style="display:flex; gap:6px; align-items:center;">
            <input style="width:92px" data-k="costoTrasporto" data-i="${idx}" value="${fmtEur(parseDec(a.costoTrasporto))}" inputmode="decimal">
            <button type="button" data-action="calc_tr" data-i="${idx}">Calcola</button>
          </div>
        </td>

        <td data-col="installazione">
          <input data-k="costoInstallazione" data-i="${idx}" value="${fmtEur(parseDec(a.costoInstallazione))}" inputmode="decimal">
        </td>

        <td data-col="qta">
          <input data-k="quantita" data-i="${idx}" value="${c.qta}" inputmode="numeric">
        </td>

        <td data-col="granTot" data-out="grantot"><b>€${fmtEur(c.granTot)}</b></td>

        <td data-col="azioni">
          <button type="button" data-action="del" data-i="${idx}">X</button>
        </td>
      </tr>
    `;
  }).join('');
}

function updateRowOutputs(rowIndex, tr){
  const a = articoliAggiunti[rowIndex];
  if(!a) return;
  const c = computeRow(a);

  const tdTot = tr.querySelector('[data-out="totale"]');
  if(tdTot) tdTot.textContent = `€${fmtEur(c.totale)}`;

  const tdGT = tr.querySelector('[data-out="grantot"]');
  if(tdGT) tdGT.innerHTML = `<b>€${fmtEur(c.granTot)}</b>`;
}

// -------------------- Event delegation tabella --------------------
function onTableInput(e){
  const t = e.target;
  if(!(t instanceof HTMLInputElement)) return;

  const k = t.getAttribute('data-k');
  const i = parseInt(t.getAttribute('data-i') || '-1', 10);
  if(!k || i < 0 || !articoliAggiunti[i]) return;

  // sanitizza digitazione sui campi decimali (non quantità)
  if(k !== 'quantita'){
    const cleaned = sanitizeDecimalTyping(t.value);
    if(cleaned !== t.value) t.value = cleaned;
  }

  // aggiorna modello (senza re-render tabella)
  if(k === 'quantita'){
    let q = parseInt(String(t.value || '1'), 10);
    if(!Number.isFinite(q) || q < 1) q = 1;
    articoliAggiunti[i][k] = q;
  } else {
    let v = parseDec(t.value);

    // clamp coerenti
    if(k === 'sconto' || k === 'sconto2' || k === 'scontoCliente') v = clamp(v, 0, 100);
    if(k === 'margine') v = clamp(v, 0, 500);
    if(k === 'costoTrasporto' || k === 'costoInstallazione' || k === 'prezzoLordo') v = Math.max(0, v);

    articoliAggiunti[i][k] = v;
  }

  // aggiorna solo celle output della riga
  const tr = t.closest('tr');
  if(tr) updateRowOutputs(i, tr);

  // aggiorna report (nessun re-render tabella)
  renderReportPreview();
}

// format “bello” quando esci dal campo (blur/focusout)
function onTableFocusOut(e){
  const t = e.target;
  if(!(t instanceof HTMLInputElement)) return;

  const k = t.getAttribute('data-k');
  const i = parseInt(t.getAttribute('data-i') || '-1', 10);
  if(!k || i < 0 || !articoliAggiunti[i]) return;

  if(k === 'quantita'){
    // forza numero intero >=1
    let q = parseInt(String(t.value || '1'), 10);
    if(!Number.isFinite(q) || q < 1) q = 1;
    t.value = String(q);
    return;
  }

  // format euro/percentuale a 2 decimali
  const v = parseDec(t.value);
  t.value = fmtEur(v);
}

// -------------------- Actions: delete & trasporti --------------------
function onTableClick(e){
  const btn = e.target.closest('button[data-action]');
  if(!btn) return;

  const act = btn.getAttribute('data-action');
  const i = parseInt(btn.getAttribute('data-i') || '-1', 10);

  if(act === 'del' && i >= 0){
    articoliAggiunti.splice(i, 1);
    renderTabellaArticoli();
    renderReportPreview();
    return;
  }

  if(act === 'calc_tr'){
    // apre la PWA trasporti separata, pre-compilando la ricerca articolo (sempre modificabile)
    const a = articoliAggiunti[i];
    const q = a ? `${a.codice} ${a.descrizione}`.trim() : '';
    const url = `./trasporti/?q=${encodeURIComponent(q)}`;
    window.open(url, '_blank', 'noopener');
    return;
  }
}

// -------------------- Report --------------------
function buildReportText(){
  if(!articoliAggiunti.length) return 'Nessun articolo.';
  const showVAT = !!$("toggleShowVAT")?.checked;
  const vatRate = clamp(parseDec($("vatRate")?.value || 22), 0, 100);

  const lines = [];
  let sum = 0;

  articoliAggiunti.forEach(a => {
    const c = computeRow(a);
    sum += c.granTot;
    lines.push(`${a.codice} — ${a.descrizione}`);
    lines.push(`  Qtà: ${c.qta} | Totale: €${fmtEur(c.totale)} | Trasp: €${fmtEur(c.trasporto)} | Inst: €${fmtEur(c.install)} | Tot: €${fmtEur(c.granTot)}`);
  });

  lines.push('');
  lines.push(`TOTALE: €${fmtEur(sum)}`);
  if(showVAT){
    const iva = sum * (vatRate/100);
    lines.push(`IVA ${vatRate}%: €${fmtEur(iva)}`);
    lines.push(`TOTALE IVA INCLUSA: €${fmtEur(sum + iva)}`);
  }
  return lines.join('\n');
}

function renderReportPreview(){
  const box = $("reportPreview");
  if(!box) return;
  const txt = buildReportText();
  box.style.display = 'block';
  box.textContent = txt;
}

function inviaReportWhatsApp(){
  const txt = buildReportText();
  const url = `https://wa.me/?text=${encodeURIComponent(txt)}`;
  window.open(url, '_blank', 'noopener');
}
function generaTXT(){
  const txt = buildReportText();
  const blob = new Blob([txt], { type:'text/plain;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'CSVXPRESSTRANS_report.txt';
  document.body.appendChild(a);
  a.click();
  setTimeout(()=>{ URL.revokeObjectURL(a.href); a.remove(); }, 500);
}

// -------------------- bootstrap --------------------
window.addEventListener('DOMContentLoaded', async () => {
  // bind UI
  $("csvFileInput")?.addEventListener('change', handleCSVUpload);
  $("searchListino")?.addEventListener('input', aggiornaListinoSelect);
  $("btnAddFromListino")?.addEventListener('click', aggiungiArticoloDaListino);
  $("btnWA")?.addEventListener('click', inviaReportWhatsApp);
  $("btnTXT")?.addEventListener('click', generaTXT);

  // CSV memory buttons
  $("btnLoadSavedCSV")?.addEventListener('click', async () => {
    const payload = await loadLastCsvPayload();
    if(!payload?.listino?.length) return alert('Nessun CSV salvato trovato.');
    listino = payload.listino;
    $("csvError").style.display='none';
    aggiornaListinoSelect();
    updateSavedCsvInfoUI(payload);
  });
  $("btnClearSavedCSV")?.addEventListener('click', async () => {
    await clearLastCsvPayload();
    alert('CSV salvato cancellato.');
  });

  // auto-load saved csv
  const payload = await loadLastCsvPayload();
  updateSavedCsvInfoUI(payload);
  if(payload?.listino?.length){
    listino = payload.listino;
    $("csvError").style.display='none';
    aggiornaListinoSelect();
  }

  // table event delegation
  const tbody = document.querySelector('#articoli-table tbody');
  if(tbody){
    tbody.addEventListener('input', onTableInput, true);
    tbody.addEventListener('focusout', onTableFocusOut, true);
    tbody.addEventListener('click', onTableClick, true);
  }

  renderTabellaArticoli();
  renderReportPreview();
});
