/* CSVXPRESSTRANS — app.js
   Unione logica: CSVXpressSmart + Trasporti Use Friendly (stima trasporto precisa e applicabile alle righe)
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
let selectedRowIndexForTransport = null;

function normalizeListino(rows){
  return rows.map(r => ({
    codice: String(r["Codice"] ?? r["codice"] ?? '').trim(),
    descrizione: String(r["Descrizione"] ?? r["descrizione"] ?? '').trim(),
    prezzoLordo: parseDec(r["PrezzoLordo"] ?? r["prezzoLordo"] ?? 0),
    sconto: 0,
    sconto2: 0,
    margine: 0,
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
  renderTabellaArticoli();
  renderReportPreview();
}

function computeRow(a){
  const lordo = parseDec(a.prezzoLordo);
  const qta = Math.max(1, parseInt(a.quantita || 1, 10) || 1);
  const sc1 = clamp(parseDec(a.sconto), 0, 100);
  const sc2 = clamp(parseDec(a.sconto2), 0, 100);
  const marg = clamp(parseDec(a.margine), 0, 500);

  const netto = lordo * (1 - sc1/100) * (1 - sc2/100);
  const venduto = netto * (1 + marg/100);

  const trasporto = parseDec(a.costoTrasporto);
  const install = parseDec(a.costoInstallazione);

  const totale = venduto * qta;
  const granTot = totale + trasporto + install;

  return { qta, sc1, sc2, marg, netto: roundTwo(netto), venduto: roundTwo(venduto), totale: roundTwo(totale), trasporto: roundTwo(trasporto), install: roundTwo(install), granTot: roundTwo(granTot) };
}

function renderTabellaArticoli(){
  const tbody = document.querySelector("#articoli-table tbody");
  tbody.innerHTML = '';

  articoliAggiunti.forEach((a, idx) => {
    const c = computeRow(a);

    const tr = document.createElement('tr');

    tr.innerHTML = `
      <td>${escapeHtml(a.codice)}</td>
      <td>${escapeHtml(a.descrizione)}</td>
      <td><input data-k="prezzoLordo" data-i="${idx}" value="${fmtEur(parseDec(a.prezzoLordo))}" inputmode="decimal"></td>
      <td><input data-k="sconto" data-i="${idx}" value="${fmtEur(parseDec(a.sconto))}" inputmode="decimal"></td>
      <td><input data-k="sconto2" data-i="${idx}" value="${fmtEur(parseDec(a.sconto2))}" inputmode="decimal"></td>
      <td><input data-k="margine" data-i="${idx}" value="${fmtEur(parseDec(a.margine))}" inputmode="decimal"></td>
      <td>€${fmtEur(c.totale)}</td>
      <td>
        <div style="display:flex; gap:6px; align-items:center;">
          <input style="width:92px" data-k="costoTrasporto" data-i="${idx}" value="${fmtEur(parseDec(a.costoTrasporto))}" inputmode="decimal">
          <button type="button" data-action="calc_tr" data-i="${idx}">Calcola</button>
        </div>
      </td>
      <td><input data-k="costoInstallazione" data-i="${idx}" value="${fmtEur(parseDec(a.costoInstallazione))}" inputmode="decimal"></td>
      <td><input data-k="quantita" data-i="${idx}" value="${c.qta}" inputmode="numeric"></td>
      <td><b>€${fmtEur(c.granTot)}</b></td>
      <td>
        <button type="button" data-action="del" data-i="${idx}">X</button>
      </td>
    `;
    tbody.appendChild(tr);
  });

  // bind inputs
  tbody.querySelectorAll("input[data-k]").forEach(inp => {
    inp.addEventListener('input', (e) => {
      const i = parseInt(e.target.getAttribute('data-i'),10);
      const k = e.target.getAttribute('data-k');
      if(!articoliAggiunti[i]) return;
      const raw = e.target.value;
      if(k === 'quantita'){
        articoliAggiunti[i][k] = parseInt(raw || '1',10) || 1;
      } else {
        articoliAggiunti[i][k] = parseDec(raw);
      }
      renderTabellaArticoli();
      renderReportPreview();
    });
  });

  // actions
  tbody.querySelectorAll("button[data-action]").forEach(btn => {
    btn.addEventListener('click', (e) => {
      const act = e.target.getAttribute('data-action');
      const i = parseInt(e.target.getAttribute('data-i'),10);
      if(act === 'del'){
        articoliAggiunti.splice(i,1);
        renderTabellaArticoli();
        renderReportPreview();
      }
      if(act === 'calc_tr'){
        selectedRowIndexForTransport = i;
        openTransportModalForRow(i);
      }
    });
  });
}

function escapeHtml(s){
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
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
  a.download = 'CSVXpressTrans_report.txt';
  document.body.appendChild(a);
  a.click();
  setTimeout(()=>{ URL.revokeObjectURL(a.href); a.remove(); }, 500);
}

// -------------------- Trasporti Use Friendly (embedded) --------------------
const TR = {
  loaded:false,
  articles:[],
  geo:null,
  pallet:null,
  groupage:null
};

async function loadTransportDatasets(){
  if(TR.loaded) return;
  const [articles, geo, pallet, groupage] = await Promise.all([
    fetch('./articles.json').then(r=>r.json()),
    fetch('./geo_provinces.json').then(r=>r.json()),
    fetch('./pallet_rates_by_region.json').then(r=>r.json()),
    fetch('./groupage_rates.json').then(r=>r.json())
  ]);
  TR.articles = Array.isArray(articles) ? articles : [];
  TR.geo = geo || {};
  TR.pallet = pallet || {};
  TR.groupage = groupage || {};
  TR.loaded = true;
}

function trEl(id){ return document.getElementById(id); }

function trRegions(){
  return (TR.pallet?.meta?.regions) || Object.keys(TR.pallet?.rates || {});
}

function trPalletTypes(){
  return (TR.pallet?.meta?.palletTypes) || [];
}

function trFindArticleByQuery(q){
  const s = (q || '').toLowerCase().trim();
  if(!s) return TR.articles.slice(0, 200);
  return TR.articles.filter(a => {
    const hay = `${a.brand||''} ${a.name||''} ${a.code||''}`.toLowerCase();
    return hay.includes(s);
  }).slice(0, 200);
}

function trPopulateSelect(sel, items, getLabel, getValue){
  sel.innerHTML = '';
  items.forEach(it => {
    const opt = document.createElement('option');
    opt.value = getValue ? getValue(it) : String(it);
    opt.textContent = getLabel ? getLabel(it) : String(it);
    sel.appendChild(opt);
  });
}

function trResolveProvinceBucket(prov){
  // groupage_rates.json usa chiavi come "MI BG BS PV MN CR MB LO"
  const P = String(prov||'').trim().toUpperCase();
  const entries = TR.groupage?.provinces || {};
  for(const key of Object.keys(entries)){
    const parts = key.split(/\s+/).map(x=>x.trim().toUpperCase()).filter(Boolean);
    if(parts.includes(P)) return { key, data: entries[key] };
  }
  return null;
}

function trPickPriceFromRanges(ranges, value){
  if(!Array.isArray(ranges)) return null;
  const v = Number(value);
  if(!Number.isFinite(v)) return null;
  for(const r of ranges){
    const min = Number(r.min);
    const max = Number(r.max);
    if(v >= min && v <= max) return Number(r.price);
  }
  // se fuori range, prendi l'ultima fascia (fallback)
  const last = ranges[ranges.length-1];
  if(last && Number.isFinite(Number(last.price))) return Number(last.price);
  return null;
}

function trCalcPallet({ region, palletType, pallets, insurance }){
  const rates = TR.pallet?.rates?.[region];
  if(!rates) return { ok:false, reason:`Regione non configurata: ${region}` };

  const rate = Number(rates[palletType]);
  if(!Number.isFinite(rate)) return { ok:false, reason:`Tariffa non trovata per ${palletType}` };

  const p = Math.max(1, parseInt(pallets || 1, 10) || 1);
  let cost = rate * p;

  // assicurazione
  const insPct = Number(TR.pallet?.meta?.insurance_pct ?? 0);
  if(insurance && insPct > 0) cost += cost * insPct;

  return { ok:true, cost: roundTwo(cost), text:`${region} • ${palletType} • pallets: ${p} • base: €${fmtEur(rate)}${insurance ? ` • +ass ${Math.round(insPct*100)}%` : ''}` };
}

function trCalcGroupage({ province, lm, quintali, pallets, insurance }){
  const bucket = trResolveProvinceBucket(province);
  if(!bucket) return { ok:false, reason:`Provincia non trovata nel listino groupage: ${province}` };

  const cfg = bucket.data;
  const selMode = String(TR.groupage?.meta?.selection_mode || 'max').toLowerCase();

  const pLm = trPickPriceFromRanges(cfg.linearMeters, lm);
  const pQl = trPickPriceFromRanges(cfg.quintali, quintali);
  const pPl = trPickPriceFromRanges(cfg.pallets, pallets);

  const candidates = [pLm, pQl, pPl].filter(x => Number.isFinite(x));
  if(!candidates.length) return { ok:false, reason:'Valori insufficienti per il calcolo (LM / q.li / bancali).' };

  let base = candidates[0];
  if(selMode === 'max') base = Math.max(...candidates);
  if(selMode === 'min') base = Math.min(...candidates);

  let cost = base;

  const insPct = Number(TR.groupage?.meta?.insurance_pct ?? 0);
  if(insurance && insPct > 0) cost += cost * insPct;

  return { ok:true, cost: roundTwo(cost), text:`${bucket.key} • LM:${lm} (€${fmtEur(pLm||0)}) • q.li:${quintali} (€${fmtEur(pQl||0)}) • banc:${pallets} (€${fmtEur(pPl||0)}) • scelta:${selMode.toUpperCase()} → €${fmtEur(base)}${insurance ? ` • +ass ${Math.round(insPct*100)}%` : ''}` };
}

async function initTransportModal(){
  await loadTransportDatasets();

  // region list
  trPopulateSelect(trEl('trRegion'), trRegions(), (x)=>x, (x)=>x);

  // province list (default regione selezionata)
  updateProvinceByRegion();

  // pallet types
  trPopulateSelect(trEl('trPalletType'), trPalletTypes(), (x)=>x, (x)=>x);

  // article list initial
  updateArticleOptions();

  // events
  trEl('trQ').addEventListener('input', () => updateArticleOptions());
  trEl('trRegion').addEventListener('change', () => updateProvinceByRegion());
  trEl('trService').addEventListener('change', () => syncTransportModeUI());
  trEl('trArticle').addEventListener('change', () => syncFromSelectedTransportArticle());
  trEl('trQty').addEventListener('input', () => { /* qty only */ });

  trEl('trCalc').addEventListener('click', () => trDoCalc());
  trEl('trApply').addEventListener('click', () => trApplyToRow());
  trEl('trClose').addEventListener('click', closeTransportModal);

  // click backdrop to close
  trEl('trModal').addEventListener('click', (e) => { if(e.target.id === 'trModal') closeTransportModal(); });

  syncTransportModeUI();
}

function updateProvinceByRegion(){
  const reg = trEl('trRegion')?.value;
  const provs = (TR.geo && reg && Array.isArray(TR.geo[reg])) ? TR.geo[reg] : [];
  trPopulateSelect(trEl('trProvince'), provs, (x)=>x, (x)=>x);
}

function updateArticleOptions(){
  const q = trEl('trQ')?.value || '';
  const list = trFindArticleByQuery(q);
  trPopulateSelect(trEl('trArticle'), list, (a)=>`${a.code || '—'} — ${a.name || ''}`, (a)=>a.id);
  syncFromSelectedTransportArticle();
}

function selectedTransportArticle(){
  const id = trEl('trArticle')?.value;
  return TR.articles.find(a => a.id === id) || null;
}

function syncFromSelectedTransportArticle(){
  const a = selectedTransportArticle();
  if(!a) return;

  // palletType from article pack
  const pt = a.pack?.palletType;
  if(pt && trPalletTypes().includes(pt)){
    trEl('trPalletType').value = pt;
  }

  // Default groupage values
  const dims = a.pack?.dimsCm;
  const lenM = Array.isArray(dims) && dims[0] ? (Number(dims[0]) / 100) : 0;
  const weightKg = Number(a.pack?.weightKg ?? 0);
  const quintali = weightKg ? (weightKg / 100) : 0;

  if(trEl('trLm') && !trEl('trLm').value) trEl('trLm').value = String(roundTwo(lenM)).replace('.', ',');
  if(trEl('trQuintali') && !trEl('trQuintali').value) trEl('trQuintali').value = String(roundTwo(quintali)).replace('.', ',');
}

function syncTransportModeUI(){
  const svc = trEl('trService')?.value;
  const isGroup = svc === 'GROUPAGE';

  trEl('trProvinceWrap').style.display = isGroup ? '' : 'none';
  trEl('trPalletTypeWrap').style.display = isGroup ? 'none' : '';
  trEl('trLmWrap').style.display = isGroup ? '' : 'none';
  trEl('trQuintaliWrap').style.display = isGroup ? '' : 'none';
}

function trDoCalc(){
  const svc = trEl('trService').value;
  const insurance = !!trEl('trInsurance').checked;

  const qty = Math.max(1, parseInt(trEl('trQty').value || '1',10) || 1);
  const region = trEl('trRegion').value;

  let res = null;

  if(svc === 'PALLET'){
    const palletType = trEl('trPalletType').value;
    res = trCalcPallet({ region, palletType, pallets: qty, insurance });
  } else {
    const province = trEl('trProvince').value;
    const lm = parseDec(trEl('trLm').value || 0);
    const quintali = parseDec(trEl('trQuintali').value || 0);
    // pallets in groupage: usiamo qty come proxy, ma puoi cambiarlo manualmente nel futuro
    res = trCalcGroupage({ province, lm, quintali, pallets: qty, insurance });
  }

  const out = trEl('trOut');
  const outCost = trEl('trOutCost');
  const outText = trEl('trOutText');

  if(res.ok){
    out.style.display = 'block';
    outCost.textContent = `€${fmtEur(res.cost)}`;
    outText.textContent = res.text || '';
    out.dataset.lastCost = String(res.cost);
  } else {
    out.style.display = 'block';
    outCost.textContent = '—';
    outText.textContent = res.reason || 'Errore calcolo.';
    out.dataset.lastCost = '';
  }
}

function trApplyToRow(){
  const out = trEl('trOut');
  const cost = parseDec(out?.dataset?.lastCost || '');
  if(!Number.isFinite(cost) || cost <= 0){
    return alert('Calcola prima un costo valido.');
  }
  const i = selectedRowIndexForTransport;
  if(i === null || i === undefined || !articoliAggiunti[i]){
    return alert('Nessuna riga selezionata.');
  }
  articoliAggiunti[i].costoTrasporto = cost;
  renderTabellaArticoli();
  renderReportPreview();
  closeTransportModal();
}

async function openTransportModalForRow(i){
  await initTransportModal().catch(()=>{});
  const modal = trEl('trModal');
  modal.style.display = 'flex';

  // hint target
  const a = articoliAggiunti[i];
  trEl('trTargetHint').textContent = `Riga: ${a.codice} — ${a.descrizione}`;

  // Prova match automatico: codice CSV == code articles.json
  const match = TR.articles.find(x => String(x.code||'').trim().toLowerCase() === String(a.codice||'').trim().toLowerCase());
  if(match){
    trEl('trArticle').value = match.id;
    syncFromSelectedTransportArticle();
  }

  // qty default
  trEl('trQty').value = String(Math.max(1, parseInt(a.quantita||1,10)||1));
}

function closeTransportModal(){
  const modal = trEl('trModal');
  modal.style.display = 'none';
}

// -------------------- bootstrap --------------------
window.addEventListener('DOMContentLoaded', async () => {
  // bind UI
  $("csvFileInput").addEventListener('change', handleCSVUpload);
  $("searchListino").addEventListener('input', aggiornaListinoSelect);
  $("btnAddFromListino").addEventListener('click', aggiungiArticoloDaListino);
  $("btnWA").addEventListener('click', inviaReportWhatsApp);
  $("btnTXT").addEventListener('click', generaTXT);

  // CSV memory buttons
  $("btnLoadSavedCSV").addEventListener('click', async () => {
    const payload = await loadLastCsvPayload();
    if(!payload?.listino?.length) return alert('Nessun CSV salvato trovato.');
    listino = payload.listino;
    $("csvError").style.display='none';
    aggiornaListinoSelect();
    updateSavedCsvInfoUI(payload);
  });
  $("btnClearSavedCSV").addEventListener('click', async () => {
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

  renderTabellaArticoli();
  renderReportPreview();
});
