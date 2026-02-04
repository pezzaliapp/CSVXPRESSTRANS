/* Trasporti PWA — logica base + Batch/Convertitori + GEO + km/disagiata
   - Carica JSON (articoli + tariffe + geo province)
   - Calcolo: PALLET / GROUPAGE  (GLS disabilitato se non configurato)
*/

const $ = (id) => document.getElementById(id);

let DB = {
  articles: [],
  palletRates: null,
  groupageRates: null,
};

let GEO = null; // geo_provinces.json (Regione -> Province)

const UI = {
  // Core
  service: $("service"),
  region: $("region"),
  province: $("province"),
  provinceField: $("provinceField"),
  q: $("q"),
  article: $("article"),
  qty: $("qty"),
  palletType: $("palletType"),
  palletTypeField: $("palletTypeField"),
  lm: $("lm"),
  lmField: $("lmField"),
  quintali: $("quintali"),
  quintaliField: $("quintaliField"),
  palletCount: $("palletCount"),
  palletCountField: $("palletCountField"),

  // New fields
  kmOver: $("kmOver"),
  optDisagiata: $("optDisagiata"),

  optPreavviso: $("optPreavviso"),
  optAssicurazione: $("optAssicurazione"),
  optSponda: $("optSponda"),
  extraNote: $("extraNote"),
  btnCalc: $("btnCalc"),
  btnCopy: $("btnCopy"),
  btnShare: $("btnShare"),
  btnShareWA: $("btnShareWA"),
  btnExportTxt: $("btnExportTxt"),
  outCost: $("outCost"),
  outText: $("outText"),
  outAlerts: $("outAlerts"),

  dbgArticle: $("dbgArticle"),
  dbgRules: $("dbgRules"),
  dbgData: $("dbgData"),
  pwaStatus: $("pwaStatus"),

  // Batch / Convertitori
  fileArticlesCsv: $("fileArticlesCsv"),
  fileGeoCsv: $("fileGeoCsv"),
  fileOfferCsv: $("fileOfferCsv"),
  batchPickCheapest: $("batchPickCheapest"),
  batchUseArticlePallet: $("batchUseArticlePallet"),
  btnExportArticles: $("btnExportArticles"),
  btnExportGeo: $("btnExportGeo"),
  btnRunBatch: $("btnRunBatch"),
  btnExportBatch: $("btnExportBatch"),
  batchLog: $("batchLog"),
};

const MEM = {
  generatedArticlesJSON: null,
  generatedGeoJSON: null,
  batchCSVResult: null
};


/* -------------------- GROUPAGE MULTI-CARICO (base + stackabili) -------------------- */
/*
  Obiettivo: per il groupage, poter aggiungere più articoli in un "carico" unico.
  - scegli una BASE (pianale) -> determina i Metri Lineari a terra
  - gli articoli "stackabili" non aumentano i LM a terra (ma sommano peso / bancali / quintali se presenti)
  - gli articoli NON stackabili sommano LM a terra
  - LM usati = max(LM base, somma LM non-stackabili)
  - LM fatturati = arrotondamento a scatto (default 1.0m, leggibile da meta.lm_step se presente)

  NOTA: non richiede modifiche a index.html: se gli elementi non esistono, li iniettiamo sotto al campo LM.
*/

const GROUPAGE_CART = []; // { artId, qty, stackable }
let GROUPAGE_BASE_ID = null;

function cartIsActive(){
  return UI.service?.value === "GROUPAGE" && GROUPAGE_CART.length > 0;
}

function getArtById(id){
  return DB.articles.find(a => String(a.id) === String(id)) || null;
}

function artGroupageParams(art){
  // Ricava LM / quintali / bancali dall'articolo (rules.*) con fallback a 0
  const r = art?.rules || {};
  const lm = Number(r.groupageLm ?? 0) || 0;
  const quintali = Number(r.groupageQuintali ?? 0) || 0;
  const pallets = Number(r.groupagePalletCount ?? 0) || 0;
  return { lm, quintali, pallets };
}

function groupageLmStep(){
  const step = Number(DB.groupageRates?.meta?.lm_step ?? 1);
  return (Number.isFinite(step) && step > 0) ? step : 1;
}

function roundUpToStep(v, step){
  if(!Number.isFinite(v)) return 0;
  const s = (Number.isFinite(step) && step > 0) ? step : 1;
  return Math.ceil(v / s) * s;
}

function calcGroupageCartTotals(){
  // Restituisce: { lmUsed, lmBill, quintaliTotal, palletsTotal, baseArt }
  if(GROUPAGE_CART.length === 0){
    return { lmUsed:0, lmBill:0, quintaliTotal:0, palletsTotal:0, baseArt:null };
  }

  const baseId = GROUPAGE_BASE_ID || GROUPAGE_CART[0].artId;
  const baseEntry = GROUPAGE_CART.find(x => x.artId === baseId) || GROUPAGE_CART[0];
  const baseArt = getArtById(baseEntry.artId);

  // Base LM: trattiamo base come "una base fisica" (non moltiplichiamo per qty) perché in groupage tipicamente si ragiona per pianale.
  // Se vuoi che qty moltiplichi LM base, basta cambiare lmBase = params.lm * baseEntry.qty
  const baseParams = artGroupageParams(baseArt);
  const lmBase = baseParams.lm;

  let lmNonStack = 0;
  let quintaliTotal = 0;
  let palletsTotal = 0;

  for(const it of GROUPAGE_CART){
    const art = getArtById(it.artId);
    const params = artGroupageParams(art);
    const q = Math.max(1, parseInt(it.qty || 1, 10));

    // Totali (somma)
    quintaliTotal += (params.quintali * q);
    palletsTotal += (params.pallets * q);

    // LM a terra: solo per NON stackabili, esclusa la base
    if(it.artId !== baseId){
      if(!it.stackable){
        lmNonStack += (params.lm * q);
      }
    }
  }

  const lmUsed = Math.max(lmBase, lmNonStack);
  const lmBill = roundUpToStep(lmUsed, groupageLmStep());

  return {
    lmUsed: round2(lmUsed),
    lmBill: round2(lmBill),
    quintaliTotal: round2(quintaliTotal),
    palletsTotal: round2(palletsTotal),
    baseArt
  };
}

/* -------------------- UI: BOX CARICO GROUPAGE (iniettato) -------------------- */

function ensureGroupageCartUI(){
  // Se non ho i campi base, esco
  if(!UI.lmField || !$("groupageCartBox")){
    // creo un box sotto LM
    if(!UI.lmField) return;

    const box = document.createElement("div");
    box.id = "groupageCartBox";
    box.className = "panel";
    box.style.marginTop = "10px";
    box.innerHTML = `
      <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap;">
        <b>Carico Groupage</b>
        <button type="button" id="btnAddToCarico" class="btn">Aggiungi articolo</button>
        <button type="button" id="btnClearCarico" class="btn btn-ghost">Svuota</button>
      </div>

      <div style="margin-top:8px; display:flex; gap:10px; flex-wrap:wrap; align-items:center;">
        <label style="display:flex; gap:6px; align-items:center;">
          Base (pianale):
          <select id="caricoBaseSelect"></select>
        </label>

        <span style="opacity:.8;">
          LM usati: <b id="caricoLmUsed">0</b> • LM fatturati: <b id="caricoLmBill">0</b> • q.li tot: <b id="caricoQuintali">0</b> • bancali tot: <b id="caricoPallets">0</b>
        </span>
      </div>

      <div id="caricoList" style="margin-top:8px;"></div>

      <div style="margin-top:8px; font-size:12px; opacity:.85;">
        Suggerimento: scegli come <b>Base</b> il macchinario più lungo (es. PFA 50). Metti <b>stackabile</b> su ciò che “sale sopra” (equilibratrice, assetto).
      </div>
    `;
    UI.lmField.appendChild(box);
  }

  // bind
  const btnAdd = $("btnAddToCarico");
  const btnClear = $("btnClearCarico");
  const baseSel = $("caricoBaseSelect");

  if(btnAdd && !btnAdd.__bound){
    btnAdd.__bound = true;
    btnAdd.addEventListener("click", () => {
      const art = selectedArticle();
      const qty = Math.max(1, parseInt(UI.qty?.value || "1", 10) || 1);
      if(!art) return;

      const defaultStackable = (art.rules?.stackable === false) ? false : true;

      const found = GROUPAGE_CART.find(x => x.artId === art.id);
      if(found){
        found.qty += qty;
      } else {
        GROUPAGE_CART.push({ artId: art.id, qty, stackable: defaultStackable });
      }

      if(!GROUPAGE_BASE_ID) GROUPAGE_BASE_ID = art.id;

      renderGroupageCart();
      try{ onCalc(); }catch(e){}
    });
  }

  if(btnClear && !btnClear.__bound){
    btnClear.__bound = true;
    btnClear.addEventListener("click", () => {
      GROUPAGE_CART.splice(0, GROUPAGE_CART.length);
      GROUPAGE_BASE_ID = null;
      renderGroupageCart();
      try{ onCalc(); }catch(e){}
    });
  }

  if(baseSel && !baseSel.__bound){
    baseSel.__bound = true;
    baseSel.addEventListener("change", () => {
      GROUPAGE_BASE_ID = baseSel.value || null;
      renderGroupageCart();
      try{ onCalc(); }catch(e){}
    });
  }

  renderGroupageCart();
}

function renderGroupageCart(){
  const box = $("groupageCartBox");
  if(!box) return;

  const baseSel = $("caricoBaseSelect");
  const list = $("caricoList");
  const elLmUsed = $("caricoLmUsed");
  const elLmBill = $("caricoLmBill");
  const elQ = $("caricoQuintali");
  const elP = $("caricoPallets");

  // Popola select base
  if(baseSel){
    baseSel.innerHTML = "";
    const o0 = document.createElement("option");
    o0.value = "";
    o0.textContent = "—";
    baseSel.appendChild(o0);

    for(const it of GROUPAGE_CART){
      const art = getArtById(it.artId);
      if(!art) continue;
      const opt = document.createElement("option");
      opt.value = it.artId;
      opt.textContent = `${art.code ? art.code + " — " : ""}${art.name || it.artId}`;
      baseSel.appendChild(opt);
    }
    baseSel.value = GROUPAGE_BASE_ID || "";
  }

  // Lista
  if(list){
    if(GROUPAGE_CART.length === 0){
      list.innerHTML = `<div style="opacity:.75;">Nessun articolo nel carico. (Solo GROUPAGE: puoi aggiungere più articoli.)</div>`;
    } else {
      const rows = GROUPAGE_CART.map((it, idx) => {
        const art = getArtById(it.artId);
        const label = art ? `${art.brand ? art.brand+" — " : ""}${art.name}${art.code ? " · "+art.code : ""}` : it.artId;
        const isBase = (it.artId === (GROUPAGE_BASE_ID || GROUPAGE_CART[0].artId));
        const stackChecked = it.stackable ? "checked" : "";
        return `
          <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap; padding:6px 0; border-bottom:1px solid rgba(0,0,0,.08);">
            <span style="min-width:280px;"><b>${isBase ? "BASE" : ""}</b> ${escapeHtml(label)}</span>
            <label style="display:flex; gap:6px; align-items:center;">
              qta
              <input type="number" min="1" step="1" value="${it.qty}" data-idx="${idx}" data-k="qty" style="width:72px;">
            </label>
            <label style="display:flex; gap:6px; align-items:center;">
              stackabile
              <input type="checkbox" ${stackChecked} data-idx="${idx}" data-k="stackable">
            </label>
            <button type="button" class="btn btn-ghost" data-idx="${idx}" data-k="rm">Rimuovi</button>
          </div>
        `;
      }).join("");
      list.innerHTML = rows;

      // bind row events (delegation)
      list.querySelectorAll("input,button").forEach(el => {
        if(el.__bound) return;
        el.__bound = true;

        const idx = parseInt(el.getAttribute("data-idx"), 10);
        const k = el.getAttribute("data-k");

        if(k === "qty"){
          el.addEventListener("input", () => {
            const v = Math.max(1, parseInt(el.value || "1", 10) || 1);
            GROUPAGE_CART[idx].qty = v;
            renderGroupageCart();
            try{ onCalc(); }catch(e){}
          });
        } else if(k === "stackable"){
          el.addEventListener("change", () => {
            GROUPAGE_CART[idx].stackable = !!el.checked;
            renderGroupageCart();
            try{ onCalc(); }catch(e){}
          });
        } else if(k === "rm"){
          el.addEventListener("click", () => {
            const removed = GROUPAGE_CART.splice(idx, 1);
            if(removed && removed[0] && removed[0].artId === GROUPAGE_BASE_ID){
              GROUPAGE_BASE_ID = GROUPAGE_CART[0]?.artId || null;
            }
            renderGroupageCart();
            try{ onCalc(); }catch(e){}
          });
        }
      });
    }
  }

  // Totali
  const t = calcGroupageCartTotals();
  if(elLmUsed) elLmUsed.textContent = String(t.lmUsed || 0);
  if(elLmBill) elLmBill.textContent = String(t.lmBill || 0);
  if(elQ) elQ.textContent = String(t.quintaliTotal || 0);
  if(elP) elP.textContent = String(t.palletsTotal || 0);
}

// semplice escape per label in HTML (evita problemi se nome ha < >)
function escapeHtml(s){
  return String(s||"").replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
}

function moneyEUR(v){
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  return new Intl.NumberFormat("it-IT", { style:"currency", currency:"EUR" }).format(v);
}

/* -------------------- SHARE (WhatsApp + TXT) -------------------- */
/*
  Obiettivo: inviare un report "client-ready" con:
  - Servizio / Destinazione / Carico (se groupage multi-carico) / Opzioni / Note extra (se presenti)
  - Totale: PREZZO CLIENTE (già calcolato) — senza citare ricarico/margine
*/

function enableShareButtons(enabled){
  if(UI.btnShare) UI.btnShare.disabled = !enabled;
  if(UI.btnShareWA) UI.btnShareWA.disabled = !enabled;
  if(UI.btnExportTxt) UI.btnExportTxt.disabled = !enabled;
}

function buildClientReadyReport(){
    const clientPrice = (UI.outCost?.textContent || "").trim();
  const raw = (UI.outText?.textContent || "").trim();

  if(!raw || raw === "Carica dati…" || !clientPrice || clientPrice === "—") return "";

  const lines = raw.split("\n").map(s => s.trim()).filter(Boolean);

  const out = [];
  out.push("*TRASPORTO — STIMA*");

  for(const ln of lines){
    const up = ln.toUpperCase();

    if(up.startsWith("REGOLE:")) continue;
    if(up.startsWith("ATTENZIONE:")) continue;
        if(up.startsWith("COSTO STIMATO:")) continue;
    if(up.startsWith("COSTO PREVENTIVATO:")) continue;

    if(up.includes("PROVINCIA") && up.includes("TARIFFATA")) continue;
    if(up.startsWith("NOTA:")) continue;
    if(up.startsWith("NOTA / CONTROLLO")) continue;

    if(up.startsWith("SERVIZIO:")){
      out.push(`Servizio: ${ln.split(":").slice(1).join(":").trim()}`);
      continue;
    }
    if(up.startsWith("DESTINAZIONE:")){
      out.push(`Destinazione: ${ln.split(":").slice(1).join(":").trim()}`);
      continue;
    }
    if(up.startsWith("CARICO:")){
      out.push(`Carico: ${ln.split(":").slice(1).join(":").trim()}`);
      continue;
    }

    if(ln.startsWith("-")){
      let s = ln.replace(/^\-\s*/, "• ");
      s = s.replace(/\s*\[stack\]\s*/ig, "");
      s = s.replace(/\s*\[BASE\]\s*/ig, " (Base)");
      s = s.replace(/\s+/g, " ").trim();
      out.push(s);
      continue;
    }

    if(up.startsWith("GROUPAGE:")){
      const rest = ln.split(":").slice(1).join(":").trim();
      out.push(`Dati: ${rest}`);
      continue;
    }

    if(up.startsWith("OPZIONI:")){
      const rest = ln.split(":").slice(1).join(":").trim();
      out.push(`Opzioni: ${rest || "nessuna"}`);
      continue;
    }

    out.push(ln);
  }

  out.push("");
  out.push(`*TOTALE: ${clientPrice}*`);

  return out.slice(0, 40).join("\n").trim();
}


function shareViaWhatsApp(text){
  const url = `https://wa.me/?text=${encodeURIComponent(text)}`;
  window.open(url, "_blank", "noopener");
}


async function shareNative(text){
  // Web Share API (mobile / iOS PWA). Fallback: copia negli appunti.
  try{
    if(navigator.share){
      await navigator.share({ title: "Trasporto — Stima", text });
      return;
    }
  }catch(e){
    // user cancelled or not available -> fallback
  }
  try{
    await navigator.clipboard.writeText(text);
    // feedback leggero (senza alert invasivi)
    
  }catch(e){
    // ultimo fallback: prompt
    window.prompt("Copia il testo:", text);
  }
}

function downloadTxt(text){
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  const ts = new Date().toISOString().slice(0,19).replace(/[:T]/g,"-");
  a.download = `trasporto-${ts}.txt`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function wireShareButtons(){
  // Mostra "Condividi" solo se supportato (o comunque utile come copia negli appunti)
  if(UI.btnShare){
    // Se Web Share API non c'è, il bottone funziona come "copia negli appunti"
    UI.btnShare.textContent = navigator.share ? "Condividi" : "Copia";
    if(!UI.btnShare.__bound){
      UI.btnShare.__bound = true;
      UI.btnShare.addEventListener("click", async () => {
        const txt = buildClientReadyReport();
        if(!txt) return;
        await shareNative(txt);
      });
    }
  }

  if(UI.btnShareWA && !UI.btnShareWA.__bound){
    UI.btnShareWA.__bound = true;
    UI.btnShareWA.addEventListener("click", () => {
      const txt = buildClientReadyReport();
      if(!txt) return;
      shareViaWhatsApp(txt);
    });
  }

  if(UI.btnExportTxt && !UI.btnExportTxt.__bound){
    UI.btnExportTxt.__bound = true;
    UI.btnExportTxt.addEventListener("click", () => {
      const txt = buildClientReadyReport();
      if(!txt) return;
      downloadTxt(txt);
    });
  }

  enableShareButtons(false);
}


function show(el, yes){ if(el) el.style.display = yes ? "" : "none"; }

async function loadJSON(path){
  const r = await fetch(path, { cache: "no-store" });
  if(!r.ok) throw new Error(`Impossibile caricare ${path}`);
  return r.json();
}

function uniq(arr){ return [...new Set(arr)].sort((a,b)=>a.localeCompare(b)); }

function fillSelect(select, items, {placeholder="— Seleziona —", valueKey=null, labelKey=null} = {}){
  if(!select) return;
  select.innerHTML = "";
  const o0 = document.createElement("option");
  o0.value = "";
  o0.textContent = placeholder;
  select.appendChild(o0);

  for (const it of items){
    const o = document.createElement("option");
    if (typeof it === "string"){
      o.value = it; o.textContent = it;
    } else {
      o.value = valueKey ? it[valueKey] : String(it);
      o.textContent = labelKey ? it[labelKey] : String(it);
    }
    select.appendChild(o);
  }
}

function round2(x){ return Math.round((x + Number.EPSILON) * 100) / 100; }

function normalizeProvince(p){
  const x = (p || "").trim().toUpperCase();
  if(x === "SU") return "CI";
  return x;
}

// ✅ NORMALIZZA REGIONE (per match con JSON in maiuscolo o nomi speciali)
function normalizeRegion(r){
  return (r || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, " ");
}

// ✅ NORMALIZZA CODICE ARTICOLO (MEC 820VDL == MEC820VDL)
function normalizeCode(s){
  return (s || "")
    .toString()
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

// flags "touched" (non sovrascrivere se l’utente modifica a mano)
function markTouched(el){
  if(!el) return;
  el.dataset.touched = "1";
}
function isTouched(el){
  return !!(el && el.dataset.touched === "1");
}
function clearTouched(el){
  if(!el) return;
  delete el.dataset.touched;
}

function applyServiceUI(){
  const s = UI.service.value;

  show(UI.provinceField, s === "GROUPAGE");
  show(UI.palletTypeField, s === "PALLET");
  show(UI.lmField, s === "GROUPAGE");
  show(UI.quintaliField, s === "GROUPAGE");
  show(UI.palletCountField, s === "GROUPAGE");

  if(UI.outAlerts) UI.outAlerts.innerHTML = "";
  if(UI.outCost) UI.outCost.textContent = "—";
  if(UI.btnCopy) UI.btnCopy.disabled = true;
  enableShareButtons(false);
}

function searchArticles(q){
  const raw = String(q || "").trim();
  if(!raw) return DB.articles.slice(0, 200);

  const tokens = raw.split(/\s+/g).map(s => s.trim()).filter(Boolean);

  // IMPORTANT:
  // - token puramente numerici (es. 00100208) NON devono "bloccare" la ricerca
  //   perché spesso arrivano dal listino CSV e non esistono nel dataset Trasporti.
  // - i numeri rimangono utili come BOOST (score) quando matchano (820, 10, ecc.)
  const wordTokens = tokens
    .map(t => t.toLowerCase())
    .filter(t => !/^\d{3,}$/.test(t)); // esclude solo-numeri >= 3 cifre

  const codeTokens = tokens
    .map(t => t.replace(/[^0-9]/g,""))
    .filter(t => t.length >= 3); // es. 820, 00100208

  // score-based matching:
  // - richiede che i token "parola" (non numerici) siano presenti nel testo completo
  // - token numerici migliorano lo score se matchano il code (ma non sono obbligatori)
  const scored = DB.articles.map(a => {
    const code = String(a.code || "");
    const brand = String(a.brand || "");
    const name = String(a.name || "");
    const tags = Array.isArray(a.tags) ? a.tags.join(" ") : "";

    const hay = `${code} ${brand} ${name} ${tags}`.toLowerCase();
    const hayN = normalizeCode(hay);
    const codeN = normalizeCode(code);

    let score = 0;

    // parola: tutte devono comparire (salvo token troppo corti)
    for(const t of wordTokens){
      if(t.length < 2) continue;
      const tN = normalizeCode(t);
      const ok = hay.includes(t) || (tN && hayN.includes(tN));
      if(!ok){
        return null;
      }
      // peso parole
      score += Math.min(10, t.length);
    }

    // numeri: aumentano lo score se matchano (non obbligatori)
    for(const c of codeTokens){
      const cN = normalizeCode(c);
      if(!cN) continue;

      if(codeN.includes(cN) || hayN.includes(cN)){
        // match forte su numero
        score += 18;
      }
    }

    // bonus: match su prefisso code
    if(code && tokens.length){
      const t0 = normalizeCode(tokens[0] || "");
      if(t0 && codeN.startsWith(t0)) score += 12;
    }

    // exact code match
    const rawN = normalizeCode(raw);
    if(rawN && codeN === rawN) score += 30;

    return { a, score };
  }).filter(Boolean);

  scored.sort((x,y)=> y.score - x.score);
  return scored.slice(0, 200).map(x => x.a);
}

function renderArticleList(q){
  const found = searchArticles(q);
  const items = found.map(a => ({
    id: a.id,
    label: `${a.brand ? a.brand + " — " : ""}${a.name}${a.code ? " · " + a.code : ""}`
  }));
  fillSelect(UI.article, items, { placeholder: "— Seleziona articolo —", valueKey:"id", labelKey:"label" });
  return items.length;
}


// Prefill da querystring (es. ?q=PUMA%20CE...) — apre già l'articolo suggerito ma resta modificabile
// Prefill da querystring (es. ?q=PUMA%20CE...&fallback=820) — apre già l'articolo suggerito ma resta modificabile
function prefillFromQuery(){
  const params = new URLSearchParams(location.search);
  const rawQ = (params.get("q") || "").trim();
  const explicitFallback = (params.get("fallback") || "").trim();

  // fallback "interno" (estendibile)
  const FALLBACK_MAP = { "822": "820" };

  if(!rawQ || !UI.q) return;

  const stripNumericTokens = (s) => String(s||"")
    .split(/\s+/g)
    .filter(t => t && !/^\d{3,}$/.test(t))   // toglie codici tipo 00100208
    .join(" ")
    .trim();

  const deriveFallback = (s) => {
    const up = String(s||"").toUpperCase();
    // (1) fallback esplicito
    if(explicitFallback) return explicitFallback;

    // (2) mappa interna (es. 822 -> 820)
    for(const k of Object.keys(FALLBACK_MAP)){
      if(up.includes(k)) return FALLBACK_MAP[k];
    }

    // (3) prova a estrarre pattern "MEC 8xx" e usare lo stesso 8xx
    const m = up.match(/\bMEC\s*([0-9]{3})\b/);
    if(m && m[1]) return m[1];

    return "";
  };

  // tenta più varianti, così il menu a tendina resta popolato anche se il "q" arriva dal CSV
  const candidates = [];
  const q1 = rawQ;
  const q2 = stripNumericTokens(rawQ);
  const fb = deriveFallback(rawQ);
  const q3 = fb ? fb : "";
  const q4 = fb ? stripNumericTokens(fb) : "";

  for(const c of [q1, q2, q3, q4]){
    const cc = String(c||"").trim();
    if(cc && !candidates.includes(cc)) candidates.push(cc);
  }

  let used = q1;
  let found = 0;

  for(const c of candidates){
    found = renderArticleList(c);
    if(found > 0){
      used = c;
      break;
    }
  }

  // se abbiamo cambiato query, rendiamolo evidente e coerente con la dropdown
  UI.q.value = used;

  // forza UI update anche se value è settato via JS
  try{ UI.q.dispatchEvent(new Event("input", { bubbles:true })); }catch(e){}

  // prova a selezionare automaticamente il primo risultato utile (placeholder è index 0)
  setTimeout(() => {
    if(UI.article && UI.article.options && UI.article.options.length > 1){
      UI.article.selectedIndex = 1;
      UI.article.dispatchEvent(new Event("change", { bubbles:true }));
    }
  }, 50);
}


function selectedArticle(){
  const id = UI.article.value;
  return DB.articles.find(a => String(a.id) === String(id)) || null;
}

function addAlert(title, text){
  if(!UI.outAlerts) return;
  const div = document.createElement("div");
  div.className = "alert";
  div.innerHTML = `<b>${title}</b><div>${text}</div>`;
  UI.outAlerts.appendChild(div);
}

/* -------------------- GROUPAGE: RISOLUZIONE PROVINCE "RAGGRUPPATE" -------------------- */
/* Esempi chiavi Excel:
   - "FR LT"
   - "RI VT RM"
   - "BN-NA"
   - "AV-SA"
   - "MT / PZ"
*/
function tokenizeProvinceGroupKey(key){
  const raw = (key || "").toUpperCase();
  // split su spazi, slash, trattini, virgole, punto e virgola
  const tokens = raw.split(/[\s\/,\-;]+/g).map(t => t.trim()).filter(Boolean);
  // tieni solo token "tipo provincia" (2 lettere)
  return tokens.filter(t => /^[A-Z]{2}$/.test(t)).map(normalizeProvince);
}

function resolveGroupageProvinceKey(province2){
  const prov = normalizeProvince(province2);
  const provinces = DB.groupageRates?.provinces || {};

  // 1) match diretto
  if(provinces[prov]) return { key: prov, data: provinces[prov], matchedBy: "direct" };

  // 2) match dentro chiavi raggruppate
  for(const k of Object.keys(provinces)){
    const toks = tokenizeProvinceGroupKey(k);
    if(toks.includes(prov)){
      return { key: k, data: provinces[k], matchedBy: "group" };
    }
  }

  return null;
}


/* -------------------- NOTE RULES (override servizio/opzioni) -------------------- */
/*
  Regole richieste:
  - "NO SPONDA" da solo: NON forza groupage; disabilita solo la spunta Sponda.
  - Se la nota contiene "GROUPAGE": forza servizio GROUPAGE.
  - Se la nota contiene "X MT" (es. 3 MT): forza LM a X (solo se GROUPAGE forzato o se sei già in GROUPAGE).
  - Se la nota contiene "quotazione" / "preventivo": segnala come "quotazione" (forceQuote).
*/

function getArticleNoteText(art){
  if(!art) return "";
  // supporta vari nomi di campo
  const n =
    art.note ?? art.notes ?? art.nota ?? art.Note ?? art.Notes ?? "";
  return String(n || "").trim();
}

function parseNoteDirectives(noteText){
  const t = String(noteText || "").toUpperCase();

  const hasGroupage = t.includes("GROUPAGE");
  const hasNoSponda = t.includes("NO SPONDA");
  const hasOkSponda = t.includes("OK SPONDA"); // se presente, non blocchiamo la sponda

  // Cerca "3 MT" / "3,5 MT"
  let forceLm = null;
  const m = t.match(/(\d+(?:[.,]\d+)?)\s*MT\b/);
  if(m){
    forceLm = Number(String(m[1]).replace(",", "."));
    if(!Number.isFinite(forceLm)) forceLm = null;
  }

  const forceQuote = /QUOTAZIONE|PREVENTIVO/i.test(noteText || "");

  return {
    forceService: hasGroupage ? "GROUPAGE" : null,
    forceLm,
    forbidSponda: hasNoSponda && !hasOkSponda, // NO SPONDA blocca sponda (anche se non groupage)
    forceQuote
  };
}

function applyNoteOverridesToUI(art){
  const note = getArticleNoteText(art);
  const dir = parseNoteDirectives(note);

  // 1) Sponda
  if(UI.optSponda){
    if(dir.forbidSponda){
      UI.optSponda.checked = false;
      UI.optSponda.disabled = true;
    } else {
      UI.optSponda.disabled = false;
    }
  }

  // 2) Servizio
  if(dir.forceService && UI.service && UI.service.value !== dir.forceService){
    UI.service.value = dir.forceService;
    applyServiceUI();
  }

  // 3) Metri lineari (solo se in GROUPAGE)
  if(dir.forceLm != null && UI.service?.value === "GROUPAGE" && UI.lm){
    // anche se "touched", qui è una regola di listino: sovrascriviamo
    UI.lm.value = String(dir.forceLm);
    // non marchiamo touched: è un valore imposto dalla regola
    clearTouched(UI.lm);
  }

  // 4) forceQuote: la gestiamo nel calcolo (out.alerts). Qui nulla.
  return dir;
}

function applyNoteOverridesToCalc({service, lm, opts, art}){
  const note = getArticleNoteText(art);
  const dir = parseNoteDirectives(note);

  // Sponda
  if(dir.forbidSponda){
    opts.sponda = false;
  }

  // Servizio forzato
  if(dir.forceService){
    service = dir.forceService;
  }

  // LM forzati solo se groupage (forzato o selezionato)
  if(dir.forceLm != null && service === "GROUPAGE"){
    lm = dir.forceLm;
  }

  return { service, lm, opts, dir };
}

/* -------------------- AUTO-FILL DA ARTICOLO -------------------- */

function onArticleChange(){
  const art = selectedArticle();
  if(!art) return;


  // NOTE rules: forza servizio/opzioni secondo listino (NO SPONDA / GROUPAGE X MT / quotazione)
  const __noteDir = applyNoteOverridesToUI(art);
  // se "quotazione" in nota, aggiungiamo una reason leggibile (non client-facing)
  if(__noteDir && __noteDir.forceQuote){
    art.rules = art.rules || {};
    art.rules.forceQuote = true;
    art.rules.forceQuoteReason = art.rules.forceQuoteReason || "Nota articolo: quotazione/preventivo.";
  }

  // ✅ se l’articolo ha pack.palletType, compila automaticamente PALLET TYPE
  const pt = (art.pack?.palletType || "").trim();
  if(pt && UI.palletType){
    if(!isTouched(UI.palletType)){
      UI.palletType.value = pt;
    }
  }

  // ✅ AUTO-FILL GROUPAGE da rules (es. groupageLm)
  const r = art.rules || {};
  if(UI.service?.value === "GROUPAGE"){
    if(r.groupageLm != null && UI.lm && !isTouched(UI.lm)){
      UI.lm.value = String(r.groupageLm);
    }
    // se in futuro aggiungi: groupageQuintali / groupagePalletCount
    if(r.groupageQuintali != null && UI.quintali && !isTouched(UI.quintali)){
      UI.quintali.value = String(r.groupageQuintali);
    }
    if(r.groupagePalletCount != null && UI.palletCount && !isTouched(UI.palletCount)){
      UI.palletCount.value = String(r.groupagePalletCount);
    }
  }

  // ✅ forza servizio PALLET se stai su GLS o se service è vuoto
  if(UI.service){
    if(!UI.service.value || UI.service.value === "GLS"){
      UI.service.value = "PALLET";
      applyServiceUI();
    }
  }
}

/* -------------------- CALCOLO -------------------- */

function applyKmAndDisagiata({base, shipments=1, opts, rules, alerts, mode="GROUPAGE"}){
  const kmThreshold = DB.groupageRates?.meta?.km_threshold ?? 30;
  const kmSurcharge = DB.groupageRates?.meta?.km_surcharge_per_km ?? 0;
  const disFee = DB.groupageRates?.meta?.disagiata_surcharge ?? 0;

  const kmOver = Math.max(0, parseInt(opts?.kmOver || 0, 10) || 0);

  if(kmOver > 0){
    alerts.push(`Distanza extra indicata: +${kmOver} km (oltre ${kmThreshold} km). Verificare condizioni.`);
    if(kmSurcharge > 0){
      base += (kmOver * kmSurcharge) * (mode === "PALLET" ? shipments : 1);
      rules.push(`km+${kmOver}`);
    }
  }

  if(opts?.disagiata){
    alerts.push("Località disagiata: possibile extra / preventivo (flag).");
    if(disFee > 0){
      base += disFee * (mode === "PALLET" ? shipments : 1);
      rules.push("disagiata");
    }
  }

  return base;
}

function computePallet({region, palletType, qty, opts, art}){
  const rules = [];
  const alerts = [];

  if(!region) return { cost:null, rules:["Manca regione"], alerts:["Seleziona una regione."] };
  if(!palletType) return { cost:null, rules:["Manca taglia bancale"], alerts:["Seleziona tipo bancale (QUARTER/HALF/MEDIUM/...)."] };

  const rate = DB.palletRates?.rates?.[region]?.[palletType];
  if(rate == null){
    return { cost:null, rules:["Tariffa non trovata"], alerts:[`Nessuna tariffa bancale per ${region} / ${palletType}.`] };
  }

  const maxPerShipment = DB.palletRates?.meta?.maxPalletsPerShipment ?? 5;
  const shipments = Math.ceil(qty / maxPerShipment);
  if(shipments > 1){
    rules.push(`split:${shipments}`);
    alerts.push(`Quantità > ${maxPerShipment}: divisione in ${shipments} spedizioni (stima).`);
  }

  let base = rate * qty;

  if(opts.preavviso && DB.palletRates?.meta?.preavviso_fee != null){
    base += DB.palletRates.meta.preavviso_fee * shipments;
    rules.push("preavviso");
  }
  if(opts.assicurazione && DB.palletRates?.meta?.insurance_pct != null){
    base = base * (1 + DB.palletRates.meta.insurance_pct);
    rules.push("assicurazione");
  }

  base = applyKmAndDisagiata({ base, shipments, opts, rules, alerts, mode:"PALLET" });

  // ✅ se l’articolo richiede preventivo, lo segnaliamo ma NON blocchiamo il calcolo
  if(art?.rules?.forceQuote){
    rules.push("forceQuote");
    alerts.push(art.rules.forceQuoteReason || "Nota: quotazione/preventivo.");
  }

  return { cost: round2(base), rules, alerts };
}

function matchGroupageBracket(value, brackets){
  // Returns { bracket, overflow }
  // overflow=true when value exceeds the last defined max (we still return the last bracket)
  if(!Array.isArray(brackets) || brackets.length===0) return { bracket:null, overflow:false };

  // normalize
  const bs = brackets.slice().sort((a,b)=>(a.min??0)-(b.min??0));

  for(const b of bs){
    const okMin = value >= (b.min ?? 0);
    const okMax = (b.max == null) ? true : value <= b.max;
    if(okMin && okMax) return { bracket:b, overflow:false };
  }

  // If no bracket matched, value is likely above the highest max.
  // Use the last bracket as a "cap" and signal overflow to the caller.
  return { bracket: bs[bs.length-1], overflow:true };
}

function computeGroupage({province, lm, quintali, palletCount, opts, art}){
  const rules = [];
  const alerts = [];

  if(!province) return { cost:null, rules:["Manca provincia"], alerts:["Seleziona una provincia."] };

  const resolved = resolveGroupageProvinceKey(province);
  if(!resolved){
    return { cost:null, rules:["Provincia non trovata"], alerts:[`Nessuna tariffa groupage per ${province}.`] };
  }

  const p = resolved.data;
  if(resolved.matchedBy === "group"){
    rules.push(`provGroup:${resolved.key}`);
    alerts.push(`Provincia ${province} tariffata come gruppo: ${resolved.key}`);
  }

  const candidates = [];
  let overflow = false;

  if(lm > 0 && Array.isArray(p.linearMeters)){
    const r = matchGroupageBracket(lm, p.linearMeters);
    if(r.bracket && r.bracket.price != null){
      candidates.push({ mode:"lm", price: r.bracket.price, overflow: r.overflow });
      if(r.overflow) overflow = true;
    }
  }
  if(quintali > 0 && Array.isArray(p.quintali)){
    const r = matchGroupageBracket(quintali, p.quintali);
    if(r.bracket && r.bracket.price != null){
      candidates.push({ mode:"quintali", price: r.bracket.price, overflow: r.overflow });
      if(r.overflow) overflow = true;
    }
  }
  if(palletCount > 0 && Array.isArray(p.pallets)){
    const r = matchGroupageBracket(palletCount, p.pallets);
    if(r.bracket && r.bracket.price != null){
      candidates.push({ mode:"pallets", price: r.bracket.price, overflow: r.overflow });
      if(r.overflow) overflow = true;
    }
  }

  if(overflow){
    // almeno uno dei parametri supera l'ultima fascia del listino.
    // Manteniamo una stima usando l'ultima fascia disponibile, ma segnaliamo che serve preventivo.
    alerts.push("Valori oltre fascia listino: stima calcolata a cap (consigliato preventivo).");
    rules.push("overflow");
  }

  if(candidates.length === 0){
    return {
      cost:null,
      rules:["Nessun parametro groupage valido"],
      alerts:["Inserisci almeno uno tra Metri lineari / Quintali / N° bancali con valori coerenti alle fasce."]
    };
  }

  // Selezione tariffa: per groupage normalmente si applica il vincolo PIÙ penalizzante
  // (LM / quintali / bancali). Default: MAX. Puoi forzare MIN via groupage_rates.json -> meta.selection_mode="min".
  const selectionMode = (DB.groupageRates?.meta?.selection_mode || "max").toLowerCase();

  let picked;
  if(selectionMode === "min"){
    picked = candidates.reduce((best, cur) => (best==null || cur.price < best.price) ? cur : best, null);
    rules.push(`pick:min:${picked.mode}`);
  } else {
    picked = candidates.reduce((worst, cur) => (worst==null || cur.price > worst.price) ? cur : worst, null);
    rules.push(`pick:max:${picked.mode}`);
  }

  let base = picked.price;

  if(opts.sponda && DB.groupageRates?.meta?.liftgate_fee != null){
    base += DB.groupageRates.meta.liftgate_fee;
    rules.push("sponda");
  }
  if(opts.preavviso && DB.groupageRates?.meta?.preavviso_fee != null){
    base += DB.groupageRates.meta.preavviso_fee;
    rules.push("preavviso");
  }
  if(opts.assicurazione && DB.groupageRates?.meta?.insurance_pct != null){
    base = base * (1 + DB.groupageRates.meta.insurance_pct);
    rules.push("assicurazione");
  }

  base = applyKmAndDisagiata({ base, shipments:1, opts, rules, alerts, mode:"GROUPAGE" });

  // ✅ se l’articolo richiede preventivo, lo segnaliamo ma NON blocchiamo il calcolo
  if(art?.rules?.forceQuote){
    rules.push("forceQuote");
    alerts.push(art.rules.forceQuoteReason || "Nota: quotazione/preventivo.");
  }

  return { cost: round2(base), rules, alerts };
}

// ✅ GLS: non c’è tariffario nel tuo Excel 2026 -> blocchiamo
function computeGLS(){
  return {
    cost: null,
    rules: ["GLS disabilitato"],
    alerts: ["Nel file Excel 2026 non esiste un tariffario GLS: calcolo non disponibile."]
  };
}

function buildSummary({service, region, province, art, qty, palletType, lm, quintali, palletCount, opts, cost, rules, alerts, extraNote, cartInfo}){
  const lines = [];
  lines.push(`SERVIZIO: ${service}`);
  lines.push(`DESTINAZIONE: ${province ? (province + " / ") : ""}${region || "—"}`);

  // Se è attivo il carico groupage multi-articolo, riepilogo dettagliato
  if(service === "GROUPAGE" && cartInfo && Array.isArray(cartInfo.items) && cartInfo.items.length){
    lines.push(`CARICO: ${cartInfo.items.length} articoli`);
    for(const it of cartInfo.items){
      lines.push(`- ${it.label} x${it.qty}${it.isBase ? " [BASE]" : ""}${it.stackable ? " [stack]" : ""}`);
    }
  } else {
    lines.push(`ARTICOLO: ${art ? `${art.brand || ""} ${art.name} (${art.code || art.id})`.trim() : "—"}`);
    lines.push(`QTA: ${qty}`);
  }

  if(service === "PALLET") lines.push(`Bancale: ${palletType || "—"}`);
  if(service === "GROUPAGE") lines.push(`Groupage: LM=${lm} | q.li=${quintali} | plt=${palletCount}`);

  const optList = [];
  if(opts.preavviso) optList.push("preavviso");
  if(opts.assicurazione) optList.push("assicurazione");
  if(opts.sponda) optList.push("sponda");
  if(opts.disagiata) optList.push("disagiata");
  if((opts.kmOver||0) > 0) optList.push(`km+${opts.kmOver}`);
  lines.push(`OPZIONI: ${optList.length ? optList.join(", ") : "nessuna"}`);

  if(extraNote?.trim()) lines.push(`NOTE EXTRA: ${extraNote.trim()}`);

  lines.push("");
    lines.push(`COSTO PREVENTIVATO: ${moneyEUR(Number.isFinite(cost) ? round2(cost * 1.3) : null)}`);
  if(rules?.length) lines.push(`REGOLE: ${rules.join(" | ")}`);

  if(alerts?.length){
    lines.push("");
    lines.push("ATTENZIONE:");
    for(const a of alerts) lines.push(`- ${a}`);
  }

  return lines.join("\n");
}

/* -------------------- BATCH OFFERTA (fix match code) -------------------- */

function findArticleByCode(code){
  const t = normalizeCode(code);
  if(!t) return null;
  return DB.articles.find(a => normalizeCode(a.code || "") === t) || null;
}

/* -------------------- UI ACTIONS -------------------- */

function onCalc(){
  const service = UI.service.value;

  const region = normalizeRegion(UI.region.value);
  const province = normalizeProvince(UI.province.value);

  const qty = Math.max(1, parseInt(UI.qty.value || "1", 10));
  const palletType = (UI.palletType.value || "").trim();

  let lm = parseFloat(UI.lm.value || "0");
  let quintali = parseFloat(UI.quintali.value || "0");
  let palletCount = parseFloat(UI.palletCount.value || "0");

  // ✅ GROUPAGE multi-carico: se ho articoli nel carico, calcolo LM/q.li/bancali dal carico
  let cartInfo = null;
  if(UI.service.value === "GROUPAGE" && GROUPAGE_CART.length){
    const t = calcGroupageCartTotals();
    // Forziamo i campi in modo trasparente (utile anche per copia/incolla screenshot)
    if(UI.lm && !isTouched(UI.lm)) UI.lm.value = String(t.lmBill || 0);
    if(UI.quintali && !isTouched(UI.quintali)) UI.quintali.value = String(t.quintaliTotal || 0);
    if(UI.palletCount && !isTouched(UI.palletCount)) UI.palletCount.value = String(t.palletsTotal || 0);

    lm = Number(t.lmBill || 0);
    quintali = Number(t.quintaliTotal || 0);
    palletCount = Number(t.palletsTotal || 0);

    cartInfo = {
      lmUsed: t.lmUsed,
      lmBill: t.lmBill,
      quintaliTotal: t.quintaliTotal,
      palletsTotal: t.palletsTotal,
      baseId: GROUPAGE_BASE_ID || GROUPAGE_CART[0].artId,
      items: GROUPAGE_CART.map(it => {
        const a = getArtById(it.artId);
        return {
          id: it.artId,
          qty: it.qty,
          stackable: !!it.stackable,
          isBase: it.artId === (GROUPAGE_BASE_ID || GROUPAGE_CART[0].artId),
          label: a ? `${a.brand ? a.brand + " — " : ""}${a.name}${a.code ? " · " + a.code : ""}` : it.artId
        };
      })
    };
  }

  const opts = {
    preavviso: !!UI.optPreavviso.checked,
    assicurazione: !!UI.optAssicurazione.checked,
    sponda: !!UI.optSponda.checked,
    disagiata: !!UI.optDisagiata?.checked,
    kmOver: parseInt(UI.kmOver?.value || "0", 10) || 0
  };

  const art = selectedArticle();

  // NOTE rules: applica override di listino al calcolo (NO SPONDA non forza groupage; GROUPAGE forza servizio + LM se indicati)
  let __svc = service;
  let __lm = lm;
  let __opts = opts;
  let __dir = null;

  if(art){
    const adj = applyNoteOverridesToCalc({ service: __svc, lm: __lm, opts: __opts, art });
    __svc = adj.service;
    __lm = adj.lm;
    __opts = adj.opts;
    __dir = adj.dir;

    if(__dir && __dir.forceQuote){
      art.rules = art.rules || {};
      art.rules.forceQuote = true;
      art.rules.forceQuoteReason = art.rules.forceQuoteReason || "Nota articolo: quotazione/preventivo.";
    }

    // Se il servizio viene forzato, aggiorna anche la UI per coerenza
    if(UI.service && UI.service.value !== __svc){
      UI.service.value = __svc;
      applyServiceUI();
    }

    // Se LM viene forzato in groupage, aggiorna anche i campi UI (non "touched")
    if(__svc === "GROUPAGE" && __dir && __dir.forceLm != null && UI.lm){
      UI.lm.value = String(__lm);
      clearTouched(UI.lm);
    }

    // Sponda vietata => aggiorna UI
    if(__dir && __dir.forbidSponda && UI.optSponda){
      UI.optSponda.checked = false;
      UI.optSponda.disabled = true;
    }
  }

  UI.dbgArticle.textContent = art ? JSON.stringify({id:art.id, code:art.code, pack:art.pack || {}, rules: art.rules || {}}, null, 0) : "—";

  let out;
  if(__svc === "PALLET"){
    out = computePallet({ region, palletType, qty, opts: __opts, art });
  } else if(__svc === "GROUPAGE"){
    out = computeGroupage({ province, lm: __lm, quintali, palletCount, opts: __opts, art: (cartInfo?.baseId ? getArtById(cartInfo.baseId) : art) });
  } else {
    out = computeGLS();
  }

  UI.outAlerts.innerHTML = "";
  (out.alerts || []).forEach(a => addAlert("Nota / Controllo", a));

  const summary = buildSummary({
    service: __svc,
    region,
    province,
    art,
    qty,
    palletType,
    lm: __lm, quintali, palletCount,
    opts: __opts,
    cost: out.cost,
    rules: out.rules || [],
    alerts: out.alerts || [],
    extraNote: UI.extraNote.value || "",
    cartInfo
  });

  UI.outText.textContent = summary;
    // Mostra solo il costo preventivato (costo × 1,3)
  UI.outCost.textContent = Number.isFinite(out.cost) ? moneyEUR(round2(out.cost * 1.3)) : "—";
// Abilita share solo se esiste un report client-ready valido
  enableShareButtons(!!buildClientReadyReport());

  UI.dbgRules.textContent = (out.rules || []).join(", ") || "—";

  UI.btnCopy.disabled = !summary;
  UI.btnCopy.dataset.copy = summary;
}

async function onCopy(){
  const text = UI.btnCopy.dataset.copy || "";
  if(!text) return;
  try{
    await navigator.clipboard.writeText(text);
    UI.btnCopy.textContent = "Copiato ✓";
    setTimeout(()=> UI.btnCopy.textContent="Copia riepilogo", 1000);
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
  }
}

/* -------------------- INIT -------------------- */

async function init(){
  // PWA
  if ("serviceWorker" in navigator){
    try{
      await navigator.serviceWorker.register("sw.js");
      UI.pwaStatus.textContent = "Offline-ready: sì";
    } catch(e){
      UI.pwaStatus.textContent = "Offline-ready: no";
    }
  } else {
    UI.pwaStatus.textContent = "Offline-ready: n/d";
  }

  // Load datasets
  DB.articles = await loadJSON("data/articles.json");
  DB.palletRates = await loadJSON("data/pallet_rates_by_region.json");
  DB.groupageRates = await loadJSON("data/groupage_rates.json");

  // GEO (province by region)
  try{
    GEO = await loadJSON("data/geo_provinces.json");
  } catch {
    GEO = null;
  }

  // Regions
  const regions = DB.palletRates?.meta?.regions || Object.keys(DB.palletRates.rates || {});
  fillSelect(UI.region, regions, { placeholder: "— Seleziona Regione —" });

  // Provinces (UI: usa GEO se presente, altrimenti fallback)
  // Fallback: prova a estrarre token (2 lettere) dalle chiavi groupage
  const provFromGroupageKeys = [];
  const groupKeys = Object.keys(DB.groupageRates?.provinces || {});
  for(const k of groupKeys){
    provFromGroupageKeys.push(...tokenizeProvinceGroupKey(k));
    // se per caso hai anche province singole nel JSON:
    if(/^[A-Z]{2}$/.test(k.toUpperCase().trim())) provFromGroupageKeys.push(normalizeProvince(k));
  }
  const allProvincesFallback = uniq(provFromGroupageKeys);

  // se GEO c'è, la lista province di default la prendiamo dal groupage (fallback) ma poi filtriamo su change regione
  fillSelect(UI.province, allProvincesFallback, { placeholder: "— Seleziona Provincia —" });

  // Pallet types
  const palletTypes =
    DB.palletRates?.meta?.palletTypes ||
    (regions[0] && DB.palletRates?.rates?.[regions[0]] ? Object.keys(DB.palletRates.rates[regions[0]]) : []);
  fillSelect(UI.palletType, palletTypes, { placeholder: "— Seleziona tipo bancale —" });

  // Articles
  renderArticleList("");
  prefillFromQuery();

  // Groupage multi-carico UI (iniettato sotto il campo LM)
  ensureGroupageCartUI();

  // Share buttons (WhatsApp + TXT)
  wireShareButtons();

  // ✅ touched tracking (manual override)
  if(UI.palletType) UI.palletType.addEventListener("change", () => markTouched(UI.palletType));
  if(UI.lm) UI.lm.addEventListener("input", () => markTouched(UI.lm));
  if(UI.quintali) UI.quintali.addEventListener("input", () => markTouched(UI.quintali));
  if(UI.palletCount) UI.palletCount.addEventListener("input", () => markTouched(UI.palletCount));

  // Live recalcolo (debounced) per flag/input: non rompe la logica, richiama onCalc() in modo leggero
  let __liveT = null;
  function triggerLiveRecalc(){
    if(__liveT) clearTimeout(__liveT);
    __liveT = setTimeout(() => { try{ onCalc(); }catch(e){} }, 80);
  }

  // Events
  UI.service.addEventListener("change", () => {
    applyServiceUI();
    ensureGroupageCartUI();
triggerLiveRecalc();
  });
  UI.q.addEventListener("input", () => renderArticleList(UI.q.value));
  UI.article.addEventListener("change", onArticleChange);
  UI.btnCalc.addEventListener("click", onCalc);
  UI.btnCopy.addEventListener("click", onCopy);
// Flag/opzioni: ricalcolo costo + prezzo cliente in tempo reale
  const flagEls = [UI.optPreavviso, UI.optAssicurazione, UI.optSponda, UI.chkZona, UI.distKm, UI.qty, UI.palletType, UI.region, UI.province, UI.article, UI.search];
  flagEls.forEach(el => {
    if(!el) return;
    el.addEventListener('input',  () => triggerLiveRecalc());
    el.addEventListener('change', () => triggerLiveRecalc());
  });


  // Filter provinces when region changes
  UI.region.addEventListener("change", () => {
    const regRaw = UI.region.value;
    const reg = regRaw; // GEO potrebbe essere in formato diverso
    const allowed = (GEO && reg && GEO[reg]) ? GEO[reg].map(normalizeProvince) : null;

    if(allowed && allowed.length){
      fillSelect(UI.province, uniq(allowed), { placeholder: "— Seleziona Provincia —" });
    } else {
      fillSelect(UI.province, allProvincesFallback, { placeholder: "— Seleziona Provincia —" });
    }
  });

  UI.province.addEventListener("change", () => {
    const v = normalizeProvince(UI.province.value);
    if(UI.province.value !== v) UI.province.value = v;
  });

  applyServiceUI();
  UI.outText.textContent = "Pronto. Seleziona servizio, destinazione e articolo, poi Calcola.";
  UI.dbgData.textContent = `articoli=${DB.articles.length} | regioni=${regions.length} | province=${(allProvincesFallback||[]).length}`;
}

window.addEventListener("DOMContentLoaded", init);