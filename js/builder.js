/* Constructor de ductos a medida: biblioteca, asistente por pasos, mapa con altimetría real,
   propuesta automática y revisión con el mismo motor hidráulico del simulador. */
(function () {
  'use strict';
  const G = window.PIPEGEN;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const fmt = (v, d) => (v == null || !isFinite(v) ? '—' : Number(v).toLocaleString('es-AR', { minimumFractionDigits: d == null ? 1 : d, maximumFractionDigits: d == null ? 1 : d }));
  const n0 = (v) => fmt(v, 0);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const KG_M = (rho) => 1e5 / ((rho || 860) * 9.81); // metros de columna por kg/cm²

  let spec = null;
  let step = 'proyecto';
  let dirty = false;
  let map = null;
  let mapL = {};
  let drawing = false;
  let busy = false;
  let review = null;
  const openSt = new Set();

  const STEPS = [
    ['proyecto', 'Proyecto', 'nombre y fluido'],
    ['trazado', 'Trazado', 'mapa y altimetría'],
    ['cano', 'Caño', 'diámetro, schedule, MAOP'],
    ['operacion', 'Operación', 'caudal y presiones'],
    ['estaciones', 'Estaciones', 'bombas, medición, pig'],
    ['valvulas', 'Válvulas', 'bloqueo de línea'],
    ['destino', 'Destino', 'tanques, puerto, refinería'],
    ['revision', 'Revisión', 'hidráulica y simular'],
  ];

  function toast(msg) {
    const t = $('b-toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toast.t);
    toast.t = setTimeout(() => t.classList.remove('show'), 3200);
  }

  // ======================= biblioteca =======================
  function showLib() {
    spec = null;
    $('lib').hidden = false;
    $('ed').hidden = true;
    $('ed-actions').hidden = true;
    try { history.replaceState(null, '', location.pathname); } catch (e) { /* nada */ }
    const list = G.lib.list();
    const box = $('lib-cards');
    if (!list.length) {
      box.innerHTML = '<div class="b-empty">Todavía no guardaste ningún ducto en este navegador. Empezá uno nuevo o cargá el ejemplo para ver cómo funciona.</div>';
      return;
    }
    box.innerHTML = list.map((s) => {
      const nSt = (s.stations || []).length;
      const pumps = (s.stations || []).filter((x) => x.kind === 'bombeo').length;
      const d = new Date(s.updatedAt || Date.now());
      return `<article class="b-card"><div><h3>${esc(s.name)}</h3><div class="b-meta">${esc(s.client || 'sin cliente')} · actualizado ${d.toLocaleDateString('es-AR')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}</div></div>
        <div class="b-kv"><div><span>Largo</span><b>${n0(s.lengthKm)} km</b></div><div><span>Caño</span><b>${esc(s.pipe && s.pipe.nps)} in</b></div><div><span>Estaciones</span><b>${nSt} (${pumps} EB)</b></div></div>
        <div class="b-row"><button type="button" class="b-btn b-btn-sm b-btn-hot" data-act="sim" data-id="${esc(s.id)}" ${nSt >= 2 ? '' : 'disabled'}>Simular</button><button type="button" class="b-btn b-btn-sm" data-act="edit" data-id="${esc(s.id)}">Editar</button><button type="button" class="b-btn b-btn-sm" data-act="dup" data-id="${esc(s.id)}">Duplicar</button><button type="button" class="b-btn b-btn-sm" data-act="exp" data-id="${esc(s.id)}">Exportar</button><button type="button" class="b-btn b-btn-sm b-btn-danger" data-act="del" data-id="${esc(s.id)}">Borrar</button></div></article>`;
    }).join('');
  }

  function download(name, text) {
    const blob = new Blob([text], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }
  const fileName = (s) => (String(s.name || 'ducto').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'ducto') + '.json';

  $('lib-cards').addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const s = G.lib.get(b.dataset.id);
    if (!s) return;
    const act = b.dataset.act;
    if (act === 'sim') location.href = ((window.OB_LINKS || {}).sim || 'index.html') + '?ducto=' + encodeURIComponent(s.id);
    if (act === 'edit') openEditor(s);
    if (act === 'dup') { const c = JSON.parse(JSON.stringify(s)); c.id = 'd' + Date.now().toString(36); c.name = s.name + ' (copia)'; c.createdAt = Date.now(); G.lib.save(c); showLib(); toast('Ducto duplicado'); }
    if (act === 'exp') download(fileName(s), JSON.stringify(s, null, 1));
    if (act === 'del') {
      if (b.dataset.confirm !== '1') { b.dataset.confirm = '1'; b.textContent = '¿Borrar? Tocá otra vez'; setTimeout(() => { if (b.isConnected) { b.dataset.confirm = ''; b.textContent = 'Borrar'; } }, 3500); return; }
      G.lib.remove(s.id); showLib(); toast('Ducto borrado de este navegador');
    }
  });
  $('lib-new').addEventListener('click', () => { const s = G.defaultSpec(); openEditor(s, 'proyecto'); markDirty(); });
  $('lib-example').addEventListener('click', () => { const s = exampleSpec(); G.lib.save(s); openEditor(s, 'estaciones'); toast('Ejemplo cargado con un perfil aproximado: en Trazado podés bajar la altimetría real'); });
  $('lib-import').addEventListener('change', async (e) => {
    const f = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!f) return;
    try {
      const s = G.normalize(JSON.parse(await f.text()));
      if (G.lib.get(s.id)) s.id = 'd' + Date.now().toString(36);
      G.lib.save(s);
      openEditor(s, 'revision');
      toast('Ducto importado');
    } catch (err) { toast('No se pudo leer el archivo: ' + err.message); }
  });
  $('nav-lib').addEventListener('click', (e) => {
    e.preventDefault();
    if (spec && dirty && !confirmLeave()) return;
    showLib();
  });
  function confirmLeave() {
    const b = $('nav-lib');
    if (b.dataset.confirm === '1') { b.dataset.confirm = ''; b.textContent = 'Mis ductos'; return true; }
    b.dataset.confirm = '1'; b.textContent = 'Hay cambios sin guardar · tocá de nuevo';
    setTimeout(() => { b.dataset.confirm = ''; b.textContent = 'Mis ductos'; }, 3500);
    return false;
  }

  // ======================= ejemplo =======================
  function exampleSpec() {
    const s = G.defaultSpec();
    s.name = 'Ejemplo · Añelo → puerto atlántico';
    s.client = 'Ejemplo ilustrativo';
    s.notes = 'Trazado y perfil aproximados para mostrar el constructor. No representa un proyecto real.';
    s.route = [[-38.355, -68.788], [-38.62, -68.35], [-38.94, -67.98], [-39.03, -67.58], [-39.12, -66.9], [-39.26, -66.0], [-39.29, -65.66], [-39.2, -64.9], [-39.0, -64.1], [-38.84, -63.4], [-38.83, -62.69], [-38.92, -62.07]];
    s.lengthKm = G.routeLength(s.route);
    const pts = G.samplePoints(s.route, Math.max(0.5, s.lengthKm / 360));
    const ctrl = [[0, 420], [40, 330], [75, 275], [110, 255], [170, 215], [250, 150], [290, 135], [340, 160], [400, 195], [460, 140], [520, 70], [560, 25], [s.lengthKm, 6]];
    const base = (pk) => { for (let i = 1; i < ctrl.length; i++) if (pk <= ctrl[i][0]) { const a = ctrl[i - 1], b = ctrl[i]; const f = (pk - a[0]) / (b[0] - a[0]); return a[1] + (b[1] - a[1]) * f; } return 6; };
    s.profile = pts.map((p) => ({ pk: p.pk, lat: p.lat, lon: p.lon, elev: Math.max(2, base(p.pk) + 12 * Math.sin(p.pk / 9) + 7 * Math.sin(p.pk / 3.1)) }));
    s.profileApprox = true;
    Object.assign(s.pipe, { nps: 24, odMm: 609.6, schedule: 'XS', wallMm: 12.7, grade: 'X65', ansiClass: 600, designFactor: 0.72 });
    Object.assign(s.ops, { qDesignM3h: 2200, qMaxHeadM3h: 2500, pAspSpKg: 6, pArrivalKg: 6, draEnabled: true, draLph: 6, maxPumpHeadKg: 35 });
    Object.assign(s.fluid, { name: 'Crudo Medanito', densityKgM3: 850, viscCst: 8 });
    s.dest = Object.assign(s.dest, { kind: 'puerto', name: 'Terminal portuaria', tanks: 4, tankM3: 60000, shipM3: 80000, loadRateM3h: 8000, shipIntervalH: 0 });
    const inj = G.newStation('inyeccion', 95, 1);
    inj.name = 'Yacimiento Allen'; inj.short = 'ALL'; inj.injection = { name: 'Yacimiento Allen', rate: 60, owner: 'Tercero' };
    s.stations = [inj];
    G.autoDesign(s, true);
    const mid = s.stations.filter((x) => x.kind === 'bombeo');
    if (mid.length) { mid[0].altHead = true; mid[0].tankM3 = 25000; }
    s.valves = G.autoValves(s, 30);
    return s;
  }

  // ======================= editor =======================
  function openEditor(s, at) {
    spec = G.normalize(JSON.parse(JSON.stringify(s)));
    dirty = false;
    review = null;
    openSt.clear();
    $('lib').hidden = true;
    $('ed').hidden = false;
    $('ed-actions').hidden = false;
    setSaved();
    try { history.replaceState(null, '', location.pathname + '?id=' + encodeURIComponent(spec.id)); } catch (e) { /* nada */ }
    go(at || firstPending());
  }
  function firstPending() {
    if (!spec.route || spec.route.length < 2) return 'trazado';
    if (!spec.profile || !spec.profile.length) return 'trazado';
    if (!spec.stations.length) return 'estaciones';
    return 'revision';
  }
  function markDirty() { dirty = true; review = null; setSaved(); renderSteps(); }
  function setSaved() {
    const el = $('ed-saved');
    el.textContent = dirty ? 'Cambios sin guardar' : 'Guardado';
    el.classList.toggle('dirty', dirty);
    $('ed-sim').disabled = !spec || spec.stations.length < 2 || !spec.profile.length;
  }
  function save(quiet) {
    if (!spec) return false;
    const ok = G.lib.save(spec);
    if (ok) { dirty = false; setSaved(); if (!quiet) toast('Guardado en este navegador'); }
    else toast('No se pudo guardar: el navegador no tiene espacio disponible. Exportá el .json.');
    return ok;
  }
  $('ed-save').addEventListener('click', () => save());
  $('ed-export').addEventListener('click', () => { if (spec) download(fileName(spec), JSON.stringify(spec, null, 1)); });
  $('ed-sim').addEventListener('click', () => {
    const errs = blockers();
    if (errs.length) { toast(errs[0]); go(errs[1] || 'revision'); return; }
    if (save(true)) location.href = ((window.OB_LINKS || {}).sim || 'index.html') + '?ducto=' + encodeURIComponent(spec.id);
  });
  function blockers() {
    if (!spec.route || spec.route.length < 2) return ['Falta el trazado', 'trazado'];
    if (!spec.profile.length) return ['Falta la altimetría del trazado', 'trazado'];
    if (!spec.stations.some((x) => x.kind === 'cabecera') || !spec.stations.some((x) => x.kind === 'terminal')) return ['Faltan la cabecera y la terminal: usá Proponer automáticamente', 'estaciones'];
    return [];
  }

  function stepState(k) {
    if (!spec) return '';
    if (k === 'proyecto') return spec.name ? 'done' : '';
    if (k === 'trazado') return spec.route.length >= 2 && spec.profile.length ? (spec.profileStale || spec.profileApprox ? 'warn' : 'done') : '';
    if (k === 'cano') return spec.profile.length ? 'done' : '';
    if (k === 'operacion') return spec.profile.length ? 'done' : '';
    if (k === 'estaciones') return spec.stations.length >= 2 ? (designCheck().some((w) => w.lvl === 'bad') ? 'warn' : 'done') : '';
    if (k === 'valvulas') return spec.valves.length ? 'done' : '';
    if (k === 'destino') return spec.stations.length >= 2 ? 'done' : '';
    if (k === 'revision') return review ? (review.bad ? 'warn' : 'done') : '';
    return '';
  }
  function stepSub(k) {
    if (!spec) return '';
    if (k === 'trazado') return spec.route.length >= 2 ? `${n0(spec.lengthKm)} km · ${spec.route.length} vértices` : 'sin trazado';
    if (k === 'cano') { const p = G.pipeCalc(spec.pipe); return `${spec.pipe.nps} in · MAOP ${fmt(p.maop)} kg/cm²`; }
    if (k === 'operacion') return `${n0(spec.ops.qDesignM3h)} m³/h`;
    if (k === 'estaciones') return `${spec.stations.length} · ${spec.stations.filter((x) => x.kind === 'bombeo').length} de bombeo`;
    if (k === 'valvulas') return `${spec.valves.length} VB`;
    if (k === 'destino') return G.DEST[spec.dest.kind] || '';
    return STEPS.find((x) => x[0] === k)[2];
  }
  function renderSteps() {
    $('ed-steps').innerHTML = STEPS.map(([k, t], i) => `<button type="button" class="b-step ${k === step ? 'on' : ''} ${stepState(k)}" data-step="${k}"><i>${stepState(k) === 'done' ? '✓' : i + 1}</i><b>${t}</b><em>${esc(stepSub(k))}</em></button>`).join('');
  }
  $('ed-steps').addEventListener('click', (e) => { const b = e.target.closest('[data-step]'); if (b) go(b.dataset.step); });

  function go(k) {
    step = k;
    renderSteps();
    const pane = $('ed-pane');
    if (map) { try { map.remove(); } catch (e) { /* nada */ } map = null; mapL = {}; }
    const i = STEPS.findIndex((x) => x[0] === k);
    const nav = `<div class="b-navbtns">${i > 0 ? `<button type="button" class="b-btn" data-step="${STEPS[i - 1][0]}">← ${STEPS[i - 1][1]}</button>` : '<span></span>'}${i < STEPS.length - 1 ? `<button type="button" class="b-btn b-btn-hot" data-step="${STEPS[i + 1][0]}">${STEPS[i + 1][1]} →</button>` : ''}</div>`;
    pane.innerHTML = VIEWS[k]() + nav;
    if (AFTER[k]) AFTER[k]();
    window.scrollTo(0, 0);
  }
  $('ed-pane').addEventListener('click', (e) => { const b = e.target.closest('.b-navbtns [data-step]'); if (b) go(b.dataset.step); });

  // ---------- binding genérico de campos ----------
  function getPath(obj, path) {
    let o = obj;
    for (const k of path.split('.')) {
      if (o == null) return undefined;
      if (Array.isArray(o) && !/^\d+$/.test(k)) o = o.find((x) => x.uid === k);
      else o = o[k];
    }
    return o;
  }
  function setPath(obj, path, v) {
    const ks = path.split('.');
    let o = obj;
    for (let i = 0; i < ks.length - 1; i++) {
      const k = ks[i];
      let nx = Array.isArray(o) && !/^\d+$/.test(k) ? o.find((x) => x.uid === k) : o[k];
      if (nx == null) { nx = {}; o[k] = nx; }
      o = nx;
    }
    o[ks[ks.length - 1]] = v;
  }
  function F(label, path, type, opts) {
    opts = opts || {};
    const v = getPath(spec, path);
    const id = 'f-' + path.replace(/[^a-z0-9]/gi, '-');
    if (type === 'select') {
      return `<label class="b-f" for="${id}">${label}<select id="${id}" data-k="${path}" data-t="${opts.num ? 'num' : 'str'}">${opts.options.map(([val, t]) => `<option value="${esc(val)}" ${String(val) === String(v) ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select>${opts.hint ? `<small>${opts.hint}</small>` : ''}</label>`;
    }
    if (type === 'bool') return `<label class="b-chk"><input type="checkbox" data-k="${path}" data-t="bool" ${v ? 'checked' : ''}> ${label}</label>`;
    if (type === 'area') return `<label class="b-f" for="${id}">${label}<textarea id="${id}" rows="${opts.rows || 3}" data-k="${path}" data-t="str">${esc(v || '')}</textarea></label>`;
    const num = type === 'num';
    return `<label class="b-f" for="${id}">${label}<input id="${id}" type="${num ? 'number' : 'text'}" ${num ? `step="${opts.step || 'any'}" ${opts.min != null ? `min="${opts.min}"` : ''} ${opts.max != null ? `max="${opts.max}"` : ''}` : ''} value="${v == null ? '' : esc(num ? +(+v).toFixed(opts.dec != null ? opts.dec : 3) : v)}" ${opts.ph ? `placeholder="${esc(opts.ph)}"` : ''} data-k="${path}" data-t="${num ? 'num' : 'str'}">${opts.hint ? `<small>${opts.hint}</small>` : ''}</label>`;
  }
  function onField(e) {
    const el = e.target.closest('[data-k]');
    if (!el || !spec) return;
    const t = el.dataset.t;
    let v = t === 'bool' ? el.checked : t === 'num' ? (el.value === '' ? null : Number(el.value)) : el.value;
    if (t === 'num' && v != null && !isFinite(v)) return;
    const path = el.dataset.k;
    setPath(spec, path, v);
    HOOK(path, v, e.type);
    markDirty();
    if (REFRESH[step]) REFRESH[step](path, e.type);
  }
  $('ed-pane').addEventListener('input', onField);
  $('ed-pane').addEventListener('change', onField);

  function HOOK(path, v, kind) {
    if (path === 'pipe.nps') {
      const t = G.NPS[v];
      if (t) {
        spec.pipe.odMm = t.od;
        spec.pipe.customOd = false;
        const sch = Object.keys(t.w).find((k) => /STD/.test(k)) || Object.keys(t.w)[0];
        spec.pipe.schedule = sch; spec.pipe.wallMm = t.w[sch];
        if (kind === 'change') go('cano');
      }
    }
    if (path === 'pipe.schedule') {
      const t = G.NPS[spec.pipe.nps];
      if (t && t.w[v] != null) { spec.pipe.wallMm = t.w[v]; const w = $('f-pipe-wallMm'); if (w) w.value = t.w[v]; }
    }
    if (path === 'pipe.wallMm') {
      const t = G.NPS[spec.pipe.nps];
      const k = t && Object.keys(t.w).find((x) => Math.abs(t.w[x] - v) < 0.005);
      spec.pipe.schedule = k || 'Personalizado';
      const s = $('f-pipe-schedule'); if (s) s.value = spec.pipe.schedule;
    }
    if (path === 'fluid.api' && v) { spec.fluid.densityKgM3 = +(999.0 * 141.5 / (v + 131.5)).toFixed(1); const d = $('f-fluid-densityKgM3'); if (d) d.value = spec.fluid.densityKgM3; delete spec.fluid.api; }
    if (path === 'fluid.densityKgM3') { const a = $('f-fluid-api'); if (a && v) a.value = (141.5 / (v / 999.0) - 131.5).toFixed(1); }
    if (/^stations\./.test(path) && /\.pk$/.test(path)) spec.stations.sort((a, b) => a.pk - b.pk);
  }

  // ---------- perfil (SVG) ----------
  function profileSvg(o) {
    o = o || {};
    const prof = spec.profile;
    if (!prof || prof.length < 2) return '<div class="b-empty">Sin altimetría todavía: dibujá el trazado y bajá el perfil en el paso Trazado.</div>';
    const W = 1000, H = o.h || 300, X0 = 54, X1 = W - 14, T = 18, B = H - 28;
    const L = spec.lengthKm || prof[prof.length - 1].pk;
    const rho = spec.fluid.densityKgM3, km = KG_M(rho);
    const pc = G.pipeCalc(spec.pipe);
    let eMin = Infinity, eMax = -Infinity;
    for (const p of prof) { eMin = Math.min(eMin, p.elev); eMax = Math.max(eMax, p.elev); }
    let yMax = eMax, yMin = eMin;
    if (o.hgl) for (const p of o.hgl) yMax = Math.max(yMax, p.h);
    if (o.maop) yMax = Math.max(yMax, Math.min(eMax + pc.maop * km, (o.hgl ? Math.max(...o.hgl.map((p) => p.h)) : eMax) + 200));
    const pad = Math.max(20, (yMax - yMin) * 0.06);
    yMin -= pad; yMax += pad;
    const X = (pk) => X0 + (pk / L) * (X1 - X0);
    const Y = (m) => B - ((m - yMin) / (yMax - yMin)) * (B - T);
    let g = `<svg class="b-prof" viewBox="0 0 ${W} ${H}" role="img" aria-label="Perfil del trazado">`;
    const nice = [5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000];
    const st = nice.find((n) => (yMax - yMin) / n <= 6) || 2000;
    for (let m = Math.ceil(yMin / st) * st; m <= yMax; m += st) g += `<line x1="${X0}" x2="${X1}" y1="${Y(m)}" y2="${Y(m)}" stroke="#1e272c"/><text x="${X0 - 6}" y="${Y(m) + 4}" text-anchor="end" class="t">${m.toLocaleString('es-AR')}</text>`;
    const kst = nice.find((n) => L / n <= 10) || 2000;
    for (let k = 0; k <= L; k += kst) g += `<text x="${X(k)}" y="${H - 8}" text-anchor="middle" class="t">${k}</text>`;
    g += `<text x="${X1}" y="${H - 8}" text-anchor="end" class="t">km</text>`;
    let d = `M${X(0)} ${B}`;
    const stepP = Math.max(1, Math.floor(prof.length / 600));
    for (let i = 0; i < prof.length; i += stepP) d += ` L${X(prof[i].pk).toFixed(1)} ${Y(prof[i].elev).toFixed(1)}`;
    d += ` L${X(prof[prof.length - 1].pk).toFixed(1)} ${Y(prof[prof.length - 1].elev).toFixed(1)} L${X(L)} ${B} Z`;
    g += `<path d="${d}" fill="#3a3a30" stroke="#8a8270" stroke-width="1"/>`;
    if (o.maop) {
      let e = '';
      for (let i = 0; i < prof.length; i += stepP) e += (i ? ' L' : 'M') + X(prof[i].pk).toFixed(1) + ' ' + Y(prof[i].elev + pc.maop * km).toFixed(1);
      g += `<path d="${e}" fill="none" stroke="#e5484d" stroke-width="1" stroke-dasharray="4 4" opacity="0.8"/>`;
    }
    if (o.hgl && o.hgl.length) {
      let h = '';
      o.hgl.forEach((p, i) => { h += (i ? ' L' : 'M') + X(p.pk).toFixed(1) + ' ' + Y(p.h).toFixed(1); });
      g += `<path d="${h}" fill="none" stroke="#8fe6ff" stroke-width="2"/>`;
    }
    if (o.valves !== false) for (const v of spec.valves || []) g += `<rect x="${X(v.pk) - 3}" y="${Y(G.elevAt(prof, v.pk)) - 3}" width="6" height="6" fill="#e7e3da" transform="rotate(45 ${X(v.pk)} ${Y(G.elevAt(prof, v.pk))})"><title>${esc(v.name)} · PK ${v.pk}</title></rect>`;
    const col = { cabecera: '#57d68d', terminal: '#57d68d', bombeo: '#e8b04a', reductora: '#8fc1e3', inyeccion: '#c48df0' };
    let lastX = -99;
    for (const s of spec.stations || []) {
      const x = X(s.pk), y = Y(G.elevAt(prof, s.pk));
      g += `<line x1="${x}" x2="${x}" y1="${T}" y2="${B}" stroke="${col[s.kind] || '#aaa'}" stroke-width="1" stroke-dasharray="2 3" opacity="0.7"/><circle cx="${x}" cy="${y}" r="5" fill="${col[s.kind] || '#aaa'}"><title>${esc(s.name)} · PK ${s.pk}</title></circle>`;
      if (x - lastX > 34) { g += `<text x="${x}" y="${T - 4}" text-anchor="middle" class="tl">${esc(s.short)}</text>`; lastX = x; }
    }
    return g + '</svg>';
  }
  function legend(items) { return `<div class="b-legend">${items.map(([c, t, dash]) => `<span><i style="background:${dash ? `repeating-linear-gradient(90deg, ${c} 0 5px, transparent 5px 9px)` : c}"></i>${t}</span>`).join('')}</div>`; }

  /** Envolvente de diseño: cada estación descarga a su set point (o lo que alcancen sus bombas). */
  function designProfile() {
    const prof = spec.profile;
    if (!prof.length || spec.stations.length < 2) return null;
    const H = G.hyd(spec);
    const grad = H.kgPerKm(spec.ops.qDesignM3h);
    const km = KG_M(spec.fluid.densityKgM3);
    const sts = spec.stations.slice().sort((a, b) => a.pk - b.pk);
    const out = [];
    const stIn = {};
    let P = 0, si = 0, pmin = Infinity, pmax = -Infinity, pminPk = 0, pmaxPk = 0;
    const L = spec.lengthKm;
    const pts = prof.map((p) => p.pk);
    for (const s of sts) pts.push(s.pk);
    pts.sort((a, b) => a - b);
    let prevPk = 0;
    for (const pk of pts) {
      const dz = G.elevAt(prof, pk) - G.elevAt(prof, prevPk);
      if (pk > prevPk) P -= grad * (pk - prevPk) + dz / km;
      while (si < sts.length && sts[si].pk <= pk + 1e-9) {
        const s = sts[si];
        stIn[s.uid] = P;
        if (s.kind === 'cabecera' && s.pumps) P = Math.min(s.pDescSp || G.opLimit(spec), (s.pumps.online || 1) * (s.pumps.headKg || 0) + 3);
        else if (s.kind === 'bombeo' && s.pumps) P = Math.min(s.pDescSp || G.opLimit(spec), P + (s.pumps.online || 1) * (s.pumps.headKg || 0));
        else if (s.kind === 'reductora' && s.pDescSp != null) P = Math.min(P, s.pDescSp);
        si++;
        out.push({ pk, h: G.elevAt(prof, pk) + P * km, p: P });
      }
      out.push({ pk, h: G.elevAt(prof, pk) + P * km, p: P });
      if (pk > 0.001 && pk < L - 0.001) { if (P < pmin) { pmin = P; pminPk = pk; } if (P > pmax) { pmax = P; pmaxPk = pk; } }
      prevPk = pk;
    }
    return { pts: out, stIn, pmin, pmax, pminPk, pmaxPk, arrival: P };
  }
  function designCheck() {
    const w = [];
    const d = designProfile();
    if (!d) return w;
    const pc = G.pipeCalc(spec.pipe);
    const pMin = Number(spec.ops.pMinLineKg) || 2;
    if (d.pmin < pMin) w.push({ lvl: 'bad', t: `La presión cae a ${fmt(d.pmin)} kg/cm² cerca del PK ${n0(d.pminPk)} (mínimo ${pMin}): falta una estación antes de ese punto o más presión aguas arriba.` });
    if (d.pmax > pc.maop) w.push({ lvl: 'bad', t: `La presión llega a ${fmt(d.pmax)} kg/cm² cerca del PK ${n0(d.pmaxPk)}, sobre la MAOP de ${fmt(pc.maop)}: agregá una reductora o subí el espesor.` });
    for (const s of spec.stations) {
      if (s.kind !== 'bombeo') continue;
      const pin = d.stIn[s.uid];
      if (pin != null && s.pAspSp != null && pin < s.pAspSp - 0.5) w.push({ lvl: 'warn', t: `${s.name}: llega con ${fmt(pin)} kg/cm² de aspiración contra un set point de ${fmt(s.pAspSp)}.` });
    }
    const pArr = Number(spec.ops.pArrivalKg) || 8;
    if (d.arrival < pArr - 0.5) w.push({ lvl: 'warn', t: `Llegada a la terminal con ${fmt(d.arrival)} kg/cm² (objetivo ${pArr}).` });
    const heads = spec.stations.filter((x) => x.kind === 'cabecera').length, terms = spec.stations.filter((x) => x.kind === 'terminal').length;
    if (heads !== 1) w.push({ lvl: 'bad', t: 'Tiene que haber exactamente una cabecera (PK 0).' });
    if (terms !== 1) w.push({ lvl: 'bad', t: 'Tiene que haber exactamente una terminal (al final del trazado).' });
    if (spec.stations.filter((x) => x.altHead).length > 1) w.push({ lvl: 'warn', t: 'Solo una estación puede ser cabecera alternativa: se usa la primera.' });
    return w;
  }
  function warnsHtml(ws, okText) {
    if (!ws.length) return okText ? `<div class="b-warns"><div class="b-warn ok">${okText}</div></div>` : '';
    return `<div class="b-warns">${ws.map((w) => `<div class="b-warn ${w.lvl === 'bad' ? 'bad' : ''}">${esc(w.t)}</div>`).join('')}</div>`;
  }

  // ======================= pasos =======================
  const VIEWS = {}, AFTER = {}, REFRESH = {};

  // ---- 1. proyecto ----
  VIEWS.proyecto = () => {
    const api = (141.5 / (spec.fluid.densityKgM3 / 999.0) - 131.5).toFixed(1);
    return `<h2>Proyecto</h2><p class="b-lead">Datos generales del ducto. El nombre aparece en el simulador, en el SCADA y en la tarjeta del desafío.</p>
    <div class="b-box"><h3>Identificación</h3><div class="b-grid">${F('Nombre del ducto', 'name', 'str')}${F('Cliente u operador', 'client', 'str', { ph: 'opcional' })}</div>${F('Notas', 'notes', 'area', { rows: 2 })}</div>
    <div class="b-box"><h3>Fluido</h3><div class="b-grid">${F('Producto', 'fluid.name', 'str')}${F('Densidad a 15 °C (kg/m³)', 'fluid.densityKgM3', 'num', { step: 0.5, min: 600, max: 1100 })}
      <label class="b-f" for="f-fluid-api">Grados API<input id="f-fluid-api" type="number" step="0.1" value="${api}" data-k="fluid.api" data-t="num"><small>se convierte a densidad</small></label>
      ${F('Viscosidad cinemática (cSt)', 'fluid.viscCst', 'num', { step: 0.5, min: 0.5, hint: 'a la temperatura de operación' })}${F('Temperatura de operación (°C)', 'fluid.tempC', 'num', { step: 1 })}</div></div>`;
  };
  REFRESH.proyecto = () => renderSteps();

  // ---- 2. trazado ----
  VIEWS.trazado = () => {
    const hasL = typeof window.L !== 'undefined';
    return `<h2>Trazado</h2><p class="b-lead">Tocá el mapa para marcar el recorrido desde la cabecera hasta el destino. Arrastrá los vértices para ajustarlo, tocá la línea para agregar un vértice intermedio y hacé clic derecho (o mantené presionado) sobre un vértice para borrarlo. Después bajá la altimetría real del terreno.</p>
    <div class="b-mapwrap"><div class="b-map" id="b-map"></div>${hasL ? '' : '<div class="b-map-msg">No se pudo cargar el mapa (sin conexión a internet o bloqueado). Podés pegar las coordenadas abajo, en “Cargar a mano”.</div>'}
      <div class="b-maptools" ${hasL ? '' : 'hidden'}>
        <button type="button" class="b-btn b-btn-sm" id="mt-draw">Dibujar</button>
        <button type="button" class="b-btn b-btn-sm" id="mt-undo">Deshacer</button>
        <button type="button" class="b-btn b-btn-sm" id="mt-rev">Invertir sentido</button>
        <button type="button" class="b-btn b-btn-sm" id="mt-fit">Ver todo</button>
        <button type="button" class="b-btn b-btn-sm b-btn-danger" id="mt-clear">Borrar trazado</button>
        <form class="b-search" id="mt-search"><input type="text" id="mt-q" placeholder="-38.95, -68.06" aria-label="Ir a coordenadas"><button type="submit">Ir</button></form>
      </div></div>
    <div class="b-box"><h3>Trazado y altimetría</h3><div class="b-out" id="tz-out"></div>
      <div class="b-row"><button type="button" class="b-btn b-btn-hot" id="tz-elev">Obtener altimetría real</button><label class="b-chk"><input type="checkbox" id="tz-grid" ${spec.noTerrain ? '' : 'checked'}> Bajar también la grilla de terreno para la vista 3D</label></div>
      <div class="b-prog" id="tz-prog" hidden><i></i></div><p class="b-note" id="tz-msg">Cotas del modelo digital de elevación Copernicus GLO-90 (resolución 90 m) a través de Open-Meteo.</p></div>
    <div class="b-box"><h3>Perfil del terreno</h3><div id="tz-prof">${profileSvg({ valves: false })}</div></div>
    <details class="b-box"><summary><b>Cargar a mano</b> · coordenadas o perfil PK–cota</summary>
      <label class="b-f" for="tz-coords">Coordenadas del trazado (una por línea: latitud, longitud)<textarea id="tz-coords" rows="5" placeholder="-38.355, -68.788&#10;-38.94, -67.98">${esc(spec.route.map((p) => p[0].toFixed(5) + ', ' + p[1].toFixed(5)).join('\n'))}</textarea></label>
      <div class="b-row"><button type="button" class="b-btn b-btn-sm" id="tz-coords-ok">Usar estas coordenadas</button></div>
      <label class="b-f" for="tz-prof-in">Perfil (una línea por punto: PK en km; cota en m). Reemplaza la altimetría.<textarea id="tz-prof-in" rows="5" placeholder="0; 420&#10;35,5; 330&#10;120; 260"></textarea></label>
      <div class="b-row"><button type="button" class="b-btn b-btn-sm" id="tz-prof-ok">Usar este perfil</button></div>
    </details>`;
  };
  function tzOut() {
    const el = $('tz-out');
    if (!el) return;
    const prof = spec.profile;
    let eMin = Infinity, eMax = -Infinity, pkMax = 0;
    for (const p of prof) { if (p.elev < eMin) eMin = p.elev; if (p.elev > eMax) { eMax = p.elev; pkMax = p.pk; } }
    const st = !prof.length ? 'falta' : spec.profileStale ? 'desactualizada' : spec.profileApprox ? 'aproximada' : 'real';
    el.innerHTML = `<div class="hot"><span>Largo</span><b>${fmt(spec.lengthKm)} km</b></div><div><span>Vértices</span><b>${spec.route.length}</b></div><div class="${st === 'real' ? '' : 'bad'}"><span>Altimetría</span><b>${st}</b></div><div><span>Puntos de perfil</span><b>${prof.length}</b></div><div><span>Cota mín. / máx.</span><b>${prof.length ? n0(eMin) + ' / ' + n0(eMax) + ' m' : '—'}</b></div><div><span>Punto alto</span><b>${prof.length ? 'PK ' + n0(pkMax) : '—'}</b></div><div><span>Grilla 3D</span><b>${spec.terrain ? spec.terrain.nx + '×' + spec.terrain.ny : 'no'}</b></div>`;
  }
  function routeChanged() {
    spec.lengthKm = G.routeLength(spec.route);
    if (spec.profile.length) spec.profileStale = true;
    spec.terrain = null;
    markDirty();
    drawRoute();
    tzOut();
  }
  function drawRoute() {
    if (!map) return;
    const L = window.L;
    if (mapL.line) map.removeLayer(mapL.line);
    (mapL.vtx || []).forEach((m) => map.removeLayer(m));
    (mapL.st || []).forEach((m) => map.removeLayer(m));
    mapL.vtx = []; mapL.st = [];
    mapL.line = L.polyline(spec.route, { color: '#e8b04a', weight: 4, opacity: 0.95 }).addTo(map);
    mapL.line.on('click', (e) => {
      L.DomEvent.stopPropagation(e);
      // insertar un vértice en el tramo más cercano
      let best = 0, bd = Infinity;
      for (let i = 1; i < spec.route.length; i++) {
        const a = map.latLngToLayerPoint(spec.route[i - 1]), b = map.latLngToLayerPoint(spec.route[i]), p = map.latLngToLayerPoint(e.latlng);
        const dx = b.x - a.x, dy = b.y - a.y, t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
        const d = Math.hypot(a.x + t * dx - p.x, a.y + t * dy - p.y);
        if (d < bd) { bd = d; best = i; }
      }
      spec.route.splice(best, 0, [+e.latlng.lat.toFixed(6), +e.latlng.lng.toFixed(6)]);
      routeChanged();
    });
    spec.route.forEach((p, i) => {
      const cls = i === 0 ? 'first' : i === spec.route.length - 1 ? 'last' : '';
      const m = L.marker(p, { draggable: true, icon: L.divIcon({ className: '', html: `<div class="b-vtx ${cls}"></div>`, iconSize: [14, 14], iconAnchor: [7, 7] }), title: i === 0 ? 'Cabecera' : i === spec.route.length - 1 ? 'Destino' : 'Vértice ' + i }).addTo(map);
      m.on('dragend', () => { const ll = m.getLatLng(); spec.route[i] = [+ll.lat.toFixed(6), +ll.lng.toFixed(6)]; routeChanged(); });
      m.on('contextmenu', () => { spec.route.splice(i, 1); routeChanged(); });
      mapL.vtx.push(m);
    });
    // estaciones existentes
    if (spec.route.length > 1) for (const s of spec.stations) {
      const ll = G.pointAt(spec.route, s.pk);
      mapL.st.push(L.marker(ll, { interactive: false, icon: L.divIcon({ className: '', html: `<span class="b-stmk k-${s.kind}">${esc(s.short)}</span>`, iconSize: [0, 0] }) }).addTo(map));
    }
  }
  AFTER.trazado = () => {
    tzOut();
    const L = window.L;
    if (L) {
      map = L.map('b-map', { zoomControl: true, preferCanvas: false });
      const sat = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 18, attribution: 'Imágenes © Esri, Maxar, Earthstar Geographics' });
      const topo = L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', { maxZoom: 17, attribution: '© OpenStreetMap · © OpenTopoMap (CC-BY-SA)' });
      const osm = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' });
      const labels = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}', { maxZoom: 18, attribution: '' });
      sat.addTo(map); labels.addTo(map);
      L.control.layers({ 'Satélite': sat, 'Topográfico': topo, 'Calles': osm }, { 'Nombres': labels }, { position: 'topright' }).addTo(map);
      L.control.scale({ imperial: false }).addTo(map);
      if (spec.route.length > 1) map.fitBounds(L.latLngBounds(spec.route).pad(0.15));
      else if (spec.route.length === 1) map.setView(spec.route[0], 9);
      else map.setView([-38.6, -68.4], 7);
      drawing = spec.route.length < 2;
      const setDraw = () => { $('mt-draw').classList.toggle('on', drawing); $('mt-draw').textContent = drawing ? 'Dibujando · tocá el mapa' : 'Dibujar'; map.getContainer().style.cursor = drawing ? 'crosshair' : ''; };
      setDraw();
      map.on('click', (e) => { if (!drawing) return; spec.route.push([+e.latlng.lat.toFixed(6), +e.latlng.lng.toFixed(6)]); routeChanged(); });
      $('mt-draw').onclick = () => { drawing = !drawing; setDraw(); };
      $('mt-undo').onclick = () => { if (spec.route.length) { spec.route.pop(); routeChanged(); } };
      $('mt-rev').onclick = () => { spec.route.reverse(); routeChanged(); toast('Sentido invertido: la cabecera ahora es el otro extremo'); };
      $('mt-fit').onclick = () => { if (spec.route.length > 1) map.fitBounds(L.latLngBounds(spec.route).pad(0.15)); };
      $('mt-clear').onclick = (ev) => {
        const b = ev.currentTarget;
        if (b.dataset.c !== '1') { b.dataset.c = '1'; b.textContent = '¿Borrar? Tocá otra vez'; setTimeout(() => { b.dataset.c = ''; b.textContent = 'Borrar trazado'; }, 3000); return; }
        spec.route = []; spec.profile = []; spec.terrain = null; spec.profileStale = false; spec.profileApprox = false; drawing = true; setDraw(); routeChanged();
        $('tz-prof').innerHTML = profileSvg({ valves: false });
      };
      $('mt-search').onsubmit = (e) => {
        e.preventDefault();
        const m = String($('mt-q').value).match(/(-?\d+(?:[.,]\d+)?)\s*[,; ]\s*(-?\d+(?:[.,]\d+)?)/);
        if (!m) { toast('Escribí latitud y longitud, por ejemplo -38.95, -68.06'); return; }
        map.setView([Number(m[1].replace(',', '.')), Number(m[2].replace(',', '.'))], 11);
      };
      drawRoute();
      setTimeout(() => map && map.invalidateSize(), 120);
    }
    $('tz-elev').onclick = () => fetchProfile();
    $('tz-coords-ok').onclick = () => {
      const pts = $('tz-coords').value.split(/\n+/).map((l) => l.match(/(-?\d+(?:\.\d+)?)\s*[,; \t]\s*(-?\d+(?:\.\d+)?)/)).filter(Boolean).map((m) => [Number(m[1]), Number(m[2])]).filter((p) => Math.abs(p[0]) <= 90 && Math.abs(p[1]) <= 180);
      if (pts.length < 2) { toast('Hacen falta al menos dos coordenadas válidas'); return; }
      spec.route = pts; routeChanged(); toast(`${pts.length} vértices cargados`);
      if (map) map.fitBounds(window.L.latLngBounds(spec.route).pad(0.15));
    };
    $('tz-prof-in') && ($('tz-prof-ok').onclick = () => {
      const rows = $('tz-prof-in').value.split(/\n+/).map((l) => l.trim()).filter(Boolean).map((l) => l.split(/\s*[;\t]\s*|\s+/)).map((a) => [Number(String(a[0]).replace(',', '.')), Number(String(a[1]).replace(',', '.'))]).filter((a) => isFinite(a[0]) && isFinite(a[1])).sort((a, b) => a[0] - b[0]);
      if (rows.length < 2) { toast('Hacen falta al menos dos puntos PK; cota'); return; }
      if (spec.route.length < 2) { toast('Primero marcá el trazado (los extremos alcanzan)'); return; }
      const Lr = spec.lengthKm, Lp = rows[rows.length - 1][0];
      const f = Lp > 0 ? Lr / Lp : 1;
      spec.profile = rows.map(([pk, e]) => { const p = G.pointAt(spec.route, pk * f); return { pk: +(pk * f).toFixed(3), elev: e, lat: +p[0].toFixed(6), lon: +p[1].toFixed(6) }; });
      spec.profileStale = false; spec.profileApprox = false;
      markDirty(); tzOut(); $('tz-prof').innerHTML = profileSvg({ valves: false });
      toast(Math.abs(f - 1) > 0.01 ? `Perfil escalado al largo del trazado (×${f.toFixed(3)})` : 'Perfil cargado');
    });
  };

  // Open-Meteo cuenta cada coordenada: el plan gratuito admite ~600 por minuto. Se espacian los pedidos
  // y, ante un 429, se espera un minuto y se reintenta.
  async function elevations(points, onProg, paceMs, onWait) {
    const out = [];
    for (let i = 0; i < points.length; i += 100) {
      const ch = points.slice(i, i + 100);
      const url = 'https://api.open-meteo.com/v1/elevation?latitude=' + ch.map((p) => p.lat.toFixed(5)).join(',') + '&longitude=' + ch.map((p) => p.lon.toFixed(5)).join(',');
      let tries = 0;
      for (;;) {
        try {
          const r = await fetch(url);
          if (r.status === 429 && tries < 4) { tries++; if (onWait) onWait(); await sleep(62000); continue; }
          if (!r.ok) throw new Error('HTTP ' + r.status);
          const j = await r.json();
          if (!j.elevation || j.elevation.length !== ch.length) throw new Error('respuesta incompleta');
          out.push(...j.elevation);
          break;
        } catch (e) {
          if (++tries >= 4) throw e;
          await sleep(900 * tries);
        }
      }
      onProg(Math.min(points.length, i + 100), points.length);
      if (i + 100 < points.length) await sleep(paceMs || 400);
    }
    return out;
  }
  async function fetchProfile() {
    if (busy) return;
    if (spec.route.length < 2) { toast('Primero marcá el trazado en el mapa'); return; }
    busy = true;
    const btn = $('tz-elev'), prog = $('tz-prog'), msg = $('tz-msg');
    btn.disabled = true; prog.hidden = false;
    const bar = prog.firstElementChild;
    try {
      spec.lengthKm = G.routeLength(spec.route);
      const stepKm = Math.max(0.1, Math.min(3, spec.lengthKm / 300));
      const pts = G.samplePoints(spec.route, stepKm);
      const wantGrid = $('tz-grid').checked;
      spec.noTerrain = !wantGrid;
      let grid = null, gpts = [];
      if (wantGrid) {
        let laMin = 90, laMax = -90, loMin = 180, loMax = -180;
        for (const p of spec.route) { laMin = Math.min(laMin, p[0]); laMax = Math.max(laMax, p[0]); loMin = Math.min(loMin, p[1]); loMax = Math.max(loMax, p[1]); }
        const la0 = (laMin + laMax) / 2, kx = 111.32 * Math.cos((la0 * Math.PI) / 180);
        const spanKm = Math.max((laMax - laMin) * 110.57, (loMax - loMin) * kx, 1);
        const mgKm = spanKm * 0.38 + 3;
        grid = { latMin: laMin - mgKm / 110.57, latMax: laMax + mgKm / 110.57, lonMin: loMin - mgKm / kx, lonMax: loMax + mgKm / kx };
        const wKm = (grid.lonMax - grid.lonMin) * kx, hKm = (grid.latMax - grid.latMin) * 110.57;
        const N = 900;
        grid.nx = Math.max(12, Math.min(60, Math.round(Math.sqrt((N * wKm) / hKm))));
        grid.ny = Math.max(12, Math.min(60, Math.round(N / grid.nx)));
        for (let j = 0; j < grid.ny; j++) for (let i = 0; i < grid.nx; i++) gpts.push({ lat: grid.latMin + ((grid.latMax - grid.latMin) * j) / (grid.ny - 1), lon: grid.lonMin + ((grid.lonMax - grid.lonMin) * i) / (grid.nx - 1) });
      }
      const waitMsg = () => { const el = $('tz-msg'); if (el) el.textContent = 'El servicio de altimetría pide una pausa: reintento en un minuto…'; };
      msg.textContent = `Bajando ${pts.length} cotas del trazado…`;
      const e1 = await elevations(pts, (k) => { bar.style.width = (k / pts.length) * 100 + '%'; }, 1200, waitMsg);
      spec.profile = pts.map((p, i) => ({ pk: p.pk, lat: p.lat, lon: p.lon, elev: Math.round(Number(e1[i]) || 0) }));
      spec.profileStale = false; spec.profileApprox = false;
      spec.terrain = null;
      // estaciones fuera del nuevo largo
      const term = spec.stations.find((x) => x.kind === 'terminal');
      if (term) term.pk = +spec.lengthKm.toFixed(1);
      for (const s of spec.stations) if (s.pk > spec.lengthKm) s.pk = +spec.lengthKm.toFixed(1);
      spec.valves = spec.valves.filter((v) => v.pk < spec.lengthKm);
      markDirty();
      msg.textContent = `Listo: ${pts.length} cotas cada ${fmt(stepKm, 2)} km. Fuente: Copernicus GLO-90 vía Open-Meteo.` + (grid ? ' Ahora bajo la grilla de terreno para la vista 3D: podés seguir con los otros pasos.' : '');
      tzOut();
      $('tz-prof').innerHTML = profileSvg({ valves: false });
      if (!spec.stations.length) toast('Altimetría lista. Seguí con el caño y después proponé las estaciones');
      if (grid) {
        const owner = spec;
        bar.style.width = '0';
        const gm = (t) => { const el = $('tz-msg'); if (el && spec === owner) el.textContent = t; };
        elevations(gpts, (k, n) => { const b2 = $('tz-prog'); if (b2) { b2.hidden = false; b2.firstElementChild.style.width = (k / n) * 100 + '%'; } gm(`Grilla de terreno 3D: ${k} de ${n} puntos (el servicio gratuito limita el ritmo, tarda un par de minutos)…`); }, 10500, () => gm('El servicio de altimetría pide una pausa: reintento en un minuto…'))
          .then((e2) => {
            if (spec !== owner) { owner.terrain = Object.assign(grid, { elev: e2.map((v) => Math.round(Number(v) || 0)) }); G.lib.save(owner); return; }
            grid.elev = e2.map((v) => Math.round(Number(v) || 0)); spec.terrain = grid; markDirty(); tzOut();
            gm(`Listo: perfil de ${spec.profile.length} cotas y grilla 3D de ${grid.nx}×${grid.ny}. Fuente: Copernicus GLO-90 vía Open-Meteo.`);
            const b2 = $('tz-prog'); if (b2) b2.hidden = true;
            toast('Grilla de terreno 3D lista');
          })
          .catch((err) => gm('No se pudo bajar la grilla 3D (' + err.message + '): la vista 3D usará un relieve aproximado.'));
      }
    } catch (err) {
      msg.textContent = 'No se pudo bajar la altimetría (' + err.message + '). Revisá la conexión o cargá el perfil a mano más abajo.';
    } finally {
      busy = false; btn.disabled = false; setTimeout(() => { prog.hidden = true; bar.style.width = '0'; }, 800);
    }
  }

  // ---- 3. caño ----
  VIEWS.cano = () => {
    const t = G.NPS[spec.pipe.nps] || { w: {} };
    const sch = Object.keys(t.w).map((k) => [k, `${k} · ${t.w[k]} mm`]).concat([['Personalizado', 'Personalizado']]);
    return `<h2>Caño</h2><p class="b-lead">Diámetro nominal, schedule (espesor), grado del acero y clase de las bridas. La MAOP es la menor entre la fórmula de Barlow (ASME B31.4) y la presión de las bridas (ASME B16.5).</p>
    <div class="b-box"><h3>Especificación</h3><div class="b-grid">
      ${F('Diámetro nominal (NPS)', 'pipe.nps', 'select', { num: true, options: Object.keys(G.NPS).map((k) => [k, `${k} in · OD ${G.NPS[k].od} mm`]) })}
      ${F('Schedule', 'pipe.schedule', 'select', { options: sch })}
      ${F('Espesor de pared (mm)', 'pipe.wallMm', 'num', { step: 0.01, min: 2 })}
      ${F('Grado API 5L', 'pipe.grade', 'select', { options: Object.keys(G.GRADES).map((k) => [k, `${k} · SMYS ${G.GRADES[k]} MPa`]) })}
      ${F('Serie / clase ANSI de bridas', 'pipe.ansiClass', 'select', { num: true, options: Object.keys(G.ANSI).map((k) => [k, `Clase ${k} · ${fmt(G.ANSI[k] * G.BAR_TO_KG, 1)} kg/cm²`]) })}
      ${F('Factor de diseño', 'pipe.designFactor', 'select', { num: true, options: [[0.72, '0,72 · ASME B31.4 general'], [0.6, '0,60 · zona poblada / cruces'], [0.5, '0,50 · criterio conservador']] })}
      ${F('Rugosidad interna (mm)', 'pipe.roughnessMm', 'num', { step: 0.005, min: 0.001, hint: 'acero comercial 0,045' })}
      ${F('Límite de operación (kg/cm²)', 'pipe.opMaxKg', 'num', { step: 0.5, min: 0, hint: '0 = 90 % de la MAOP' })}
      ${F('Calibración de fricción', 'pipe.calib', 'num', { step: 0.01, min: 0.5, max: 2.5, hint: '1 = teórico; >1 si la línea real pierde más' })}
    </div></div>
    <div class="b-box"><h3>Resultado</h3><div class="b-out" id="pc-out"></div><p class="b-note">Barlow: P = 2·S·t·F·E / D. Para crudo, la MAOP de diseño se toma con la temperatura de operación ambiente (sin reducción por temperatura).</p></div>`;
  };
  function pcOut() {
    const el = $('pc-out');
    if (!el) return;
    const p = G.pipeCalc(spec.pipe);
    el.innerHTML = `<div><span>Diámetro exterior</span><b>${fmt(p.od)} mm</b></div><div><span>Diámetro interior</span><b>${fmt(p.idMm)} mm</b></div><div><span>Espesor</span><b>${fmt(p.t, 2)} mm</b></div><div><span>Barlow</span><b>${fmt(p.barlowKg)} kg/cm²</b></div><div><span>Bridas</span><b>${fmt(p.flangeKg)} kg/cm²</b></div><div class="hot"><span>MAOP</span><b>${fmt(p.maop)} kg/cm²</b></div><div><span>Limitada por</span><b style="font-size:14px">${esc(p.limitedBy)}</b></div><div class="hot"><span>Operación hasta</span><b>${fmt(G.opLimit(spec))} kg/cm²</b></div>`;
  }
  AFTER.cano = pcOut;
  REFRESH.cano = () => { pcOut(); renderSteps(); };

  // ---- 4. operación ----
  VIEWS.operacion = () => `<h2>Operación</h2><p class="b-lead">Caudal y presiones con las que se diseñan las estaciones. Más caudal o menos DRA piden más presión y más estaciones.</p>
    <div class="b-box"><h3>Caudal</h3><div class="b-grid">${F('Caudal de diseño en cabecera (m³/h)', 'ops.qDesignM3h', 'num', { step: 10, min: 1 })}${F('Caudal máximo de cabecera (m³/h)', 'ops.qMaxHeadM3h', 'num', { step: 10, min: 1 })}</div></div>
    <div class="b-box"><h3>Presiones</h3><div class="b-grid">${F('Set point de aspiración en EB (kg/cm²)', 'ops.pAspSpKg', 'num', { step: 0.5, min: 1 })}${F('Presión de llegada a la terminal (kg/cm²)', 'ops.pArrivalKg', 'num', { step: 0.5, min: 1 })}${F('Presión mínima en línea (kg/cm²)', 'ops.pMinLineKg', 'num', { step: 0.5, min: 0.5, hint: 'evita separación de columna en puntos altos' })}${F('Altura máxima por bomba (kg/cm²)', 'ops.maxPumpHeadKg', 'num', { step: 1, min: 5, hint: 'bombas en serie por estación' })}</div></div>
    <div class="b-box"><h3>DRA (reductor de fricción)</h3><div class="b-row">${F('Inyectar DRA en las estaciones', 'ops.draEnabled', 'bool')}</div><div class="b-grid">${F('Dosis (L/h)', 'ops.draLph', 'num', { step: 1, min: 0, max: 10 })}${F('Reducción de fricción a 10 L/h', 'ops.draReduction', 'num', { step: 0.01, min: 0, max: 0.7 })}</div></div>
    <div class="b-box"><h3>Hidráulica de diseño</h3><div class="b-out" id="op-out"></div><div id="op-warn"></div></div>`;
  function opOut() {
    const el = $('op-out');
    if (!el) return;
    const H = G.hyd(spec);
    const Q = spec.ops.qDesignM3h;
    const grad = H.kgPerKm(Q);
    const L = spec.lengthKm || 0;
    const dz = spec.profile.length ? spec.profile[spec.profile.length - 1].elev - spec.profile[0].elev : 0;
    const dpF = grad * L, dpE = (dz * H.kgPerM);
    const lp = H.A * L * 1000;
    const kw = ((Q / 3600) * (dpF + Math.max(0, dpE)) * 1e5) / 1000 / 0.75;
    el.innerHTML = `<div><span>Velocidad</span><b>${fmt(H.v, 2)} m/s</b></div><div><span>Reynolds</span><b>${n0(H.Re)}</b></div><div><span>Factor f</span><b>${fmt(H.f, 4)}</b></div><div class="hot"><span>Gradiente</span><b>${fmt(grad, 3)} kg/cm²/km</b></div><div><span>Fricción total</span><b>${n0(dpF)} kg/cm²</b></div><div><span>Desnivel extremo</span><b>${n0(dz)} m</b></div><div><span>Linepack</span><b>${n0(lp)} m³</b></div><div><span>Potencia aprox.</span><b>${n0(kw / 1000 * 1000)} kW</b></div>`;
    const w = [];
    if (H.v > 2.5) w.push({ lvl: 'warn', t: `Velocidad alta (${fmt(H.v, 2)} m/s): más fricción y riesgo de erosión. Probá un diámetro mayor.` });
    if (H.v < 0.5) w.push({ lvl: 'warn', t: `Velocidad baja (${fmt(H.v, 2)} m/s): favorece depósitos de parafina y agua. Probá un diámetro menor.` });
    if (spec.ops.qMaxHeadM3h < Q) w.push({ lvl: 'warn', t: 'El caudal máximo de cabecera es menor que el de diseño.' });
    $('op-warn').innerHTML = warnsHtml(w, 'Velocidad dentro del rango habitual para crudo (0,5 a 2,5 m/s).');
  }
  AFTER.operacion = opOut;
  REFRESH.operacion = () => { opOut(); renderSteps(); };

  // ---- 5. estaciones ----
  VIEWS.estaciones = () => `<h2>Estaciones</h2><p class="b-lead">El constructor recorre el perfil a caudal de diseño y ubica una estación de bombeo donde la presión llegaría al set point de aspiración, y una reductora donde una bajada superaría la MAOP. Después podés mover, agregar o quitar estaciones y ajustar bombas, medición, trampas e inyecciones.</p>
    <div class="b-box"><div class="b-row"><button type="button" class="b-btn b-btn-hot" id="st-auto">Proponer automáticamente</button><button type="button" class="b-btn" id="st-size">Recalcular bombas</button>
      <span style="flex:1"></span><label class="b-f" style="width:170px" for="st-new-k">Tipo<select id="st-new-k">${Object.keys(G.KINDS).filter((k) => k !== 'cabecera' && k !== 'terminal').map((k) => `<option value="${k}">${G.KINDS[k]}</option>`).join('')}</select></label><label class="b-f" style="width:110px" for="st-new-pk">PK (km)<input id="st-new-pk" type="number" step="0.1" min="0" value="${n0((spec.lengthKm || 0) / 2)}"></label><button type="button" class="b-btn" id="st-add" style="align-self:end">Agregar</button></div>
      <div id="st-autonote"></div></div>
    <div class="b-box"><h3>Perfil a caudal de diseño</h3><div id="st-prof"></div>${legend([['#8fe6ff', 'Piezométrica con set points de descarga'], ['#e5484d', 'MAOP', 1], ['#e8b04a', 'Bombeo'], ['#8fc1e3', 'Reductora'], ['#c48df0', 'Inyección']])}<div id="st-warn"></div></div>
    <div class="b-sts" id="st-list"></div>`;
  function stProf() {
    const d = designProfile();
    const el = $('st-prof');
    if (el) el.innerHTML = profileSvg({ hgl: d ? d.pts : null, maop: true, h: 320 });
    const w = $('st-warn');
    if (w) w.innerHTML = spec.stations.length >= 2 ? warnsHtml(designCheck(), 'La piezométrica de diseño queda entre la presión mínima y la MAOP en todo el trazado.') : '';
  }
  function stCard(s) {
    const open = openSt.has(s.uid);
    const k = s.kind;
    const pumps = s.pumps;
    const sum = k === 'cabecera' || k === 'bombeo' ? (pumps ? `${pumps.online}+${pumps.mains - pumps.online} bombas × ${fmt(pumps.headKg)} kg/cm² · desc. ${fmt(s.pDescSp)}` : 'sin bombas') : k === 'reductora' ? `SP salida ${fmt(s.pDescSp)} kg/cm²` : k === 'inyeccion' ? `${n0(s.injection && s.injection.rate)} m³/h` : k === 'terminal' ? `llegada ${fmt(s.pAspSp)} kg/cm²` : '';
    let h = `<article class="b-st"><div class="b-st-h" data-toggle="${s.uid}" role="button" tabindex="0" aria-expanded="${open}"><b>${esc(s.short)}</b><span>${esc(s.name)}</span><span class="b-tag k-${k}">${G.KINDS[k]}${s.altHead ? ' · cabecera alternativa' : ''}</span><span class="b-tag">PK ${fmt(s.pk)}</span><span class="b-sum">${esc(sum)}</span></div>`;
    if (!open) return h + '</article>';
    const P = 'stations.' + s.uid + '.';
    h += `<div class="b-st-b"><div class="b-grid">${F('Nombre', P + 'name', 'str')}${F('Sigla', P + 'short', 'str')}${F('PK (km)', P + 'pk', 'num', { step: 0.1, min: 0, max: spec.lengthKm })}
      ${k === 'cabecera' || k === 'terminal' ? '' : F('Tipo', P + 'kind', 'select', { options: Object.keys(G.KINDS).filter((x) => x !== 'cabecera' && x !== 'terminal').map((x) => [x, G.KINDS[x]]) })}</div>`;
    if (k === 'cabecera' || k === 'bombeo') {
      if (!s.pumps) s.pumps = G.sizePumps(G.opLimit(spec) - (spec.ops.pAspSpKg || 5), spec.ops.maxPumpHeadKg);
      h += `<p class="b-sub">Bombas principales (en serie)</p><div class="b-grid">${F('Bombas instaladas', P + 'pumps.mains', 'num', { step: 1, min: 1, max: 8 })}${F('En línea', P + 'pumps.online', 'num', { step: 1, min: 1, max: 8 })}${F('Altura por bomba (kg/cm²)', P + 'pumps.headKg', 'num', { step: 0.5, min: 1 })}${F('Accionamiento', P + 'pumps.drive', 'select', { options: Object.entries(G.DRIVES) })}</div>
        <p class="b-sub">Boosters de aspiración</p><div class="b-grid">${F('Boosters instalados', P + 'pumps.boosters', 'num', { step: 1, min: 0, max: 4 })}${F('En línea', P + 'pumps.boostersOnline', 'num', { step: 1, min: 0, max: 4 })}${F('Aporte a la aspiración (kg/cm²)', P + 'pumps.boosterKg', 'num', { step: 0.5, min: 0 })}</div>
        <p class="b-sub">Control</p><div class="b-grid">${k === 'bombeo' ? F('SP de aspiración (kg/cm²)', P + 'pAspSp', 'num', { step: 0.5, min: 0.5 }) : ''}${F('SP de descarga · PID (kg/cm²)', P + 'pDescSp', 'num', { step: 0.5, min: 1, max: G.pipeCalc(spec.pipe).maop })}${F('Inyección de DRA', P + 'dra', 'bool')}${k === 'bombeo' ? F('Cabecera alternativa si falla la cabecera', P + 'altHead', 'bool') : ''}${F('Tanque de la estación (m³)', P + 'tankM3', 'num', { step: 500, min: 0, hint: k === 'bombeo' ? 'necesario para ser cabecera alternativa' : '' })}</div>`;
    }
    if (k === 'reductora') h += `<div class="b-grid">${F('SP de presión de salida (kg/cm²)', P + 'pDescSp', 'num', { step: 0.5, min: 1 })}</div>`;
    if (k === 'terminal') h += `<div class="b-grid">${F('Presión de llegada objetivo (kg/cm²)', P + 'pAspSp', 'num', { step: 0.5, min: 1 })}</div><p class="b-note">Los tanques y el destino se configuran en el paso Destino.</p>`;
    if (k !== 'reductora') {
      if (!s.meters) s.meters = { usm: 2, pd: 1, prover: true, lact: false };
      h += `<p class="b-sub">Medición</p><div class="b-grid">${F('Ultrasónicos (USM)', P + 'meters.usm', 'num', { step: 1, min: 0, max: 4 })}${F('Desplazamiento positivo (PD)', P + 'meters.pd', 'num', { step: 1, min: 0, max: 2 })}${F('Prover para calibración', P + 'meters.prover', 'bool')}${F('Unidad LACT (custody)', P + 'meters.lact', 'bool')}</div>`;
    }
    if (k !== 'reductora') h += `<div class="b-row">${F('Trampa de pig (lanzadora/receptora)', P + 'pigTrap', 'bool')}</div>`;
    if (k !== 'terminal' && k !== 'reductora') {
      const inj = s.injection;
      h += `<p class="b-sub">Inyección lateral</p>`;
      if (inj) h += `<div class="b-grid">${F('Origen', P + 'injection.name', 'str')}${F('Caudal (m³/h)', P + 'injection.rate', 'num', { step: 1, min: 0 })}${F('Titular', P + 'injection.owner', 'select', { options: [['Propia', 'Propia'], ['Tercero', 'Tercero']] })}</div><div class="b-row"><button type="button" class="b-btn b-btn-sm" data-noinj="${s.uid}">Quitar inyección</button></div>`;
      else h += `<div class="b-row"><button type="button" class="b-btn b-btn-sm" data-addinj="${s.uid}">Agregar inyección</button></div>`;
    }
    if (k !== 'cabecera' && k !== 'terminal') h += `<div class="b-row"><button type="button" class="b-btn b-btn-sm b-btn-danger" data-delst="${s.uid}">Quitar estación</button></div>`;
    return h + '</div></article>';
  }
  function stList() {
    const el = $('st-list');
    if (!el) return;
    el.innerHTML = spec.stations.length ? spec.stations.map(stCard).join('') : '<div class="b-empty">Sin estaciones todavía. Tocá “Proponer automáticamente”: arma cabecera, estaciones de bombeo, reductoras y terminal según el perfil.</div>';
  }
  AFTER.estaciones = () => {
    stProf(); stList();
    $('st-auto').onclick = (ev) => {
      if (!spec.profile.length) { toast('Primero bajá la altimetría del trazado'); go('trazado'); return; }
      const b = ev.currentTarget;
      if (spec.stations.some((x) => x.kind === 'bombeo' || x.kind === 'reductora') && b.dataset.c !== '1') { b.dataset.c = '1'; b.textContent = 'Reemplaza bombeo y reductoras · tocá otra vez'; setTimeout(() => { b.dataset.c = ''; b.textContent = 'Proponer automáticamente'; }, 3500); return; }
      const r = G.autoDesign(spec, true);
      if (!spec.valves.length) spec.valves = G.autoValves(spec, spec.valveSpacingKm);
      markDirty(); stProf(); stList();
      $('st-autonote').innerHTML = warnsHtml(r.warnings.map((t) => ({ lvl: 'warn', t })).concat([{ lvl: 'ok', t: `Propuesta: ${r.stations.filter((x) => x.kind === 'bombeo').length} estaciones de bombeo y ${r.stations.filter((x) => x.kind === 'reductora').length} reductoras · gradiente ${fmt(r.gradKgKm, 3)} kg/cm²/km a ${n0(spec.ops.qDesignM3h)} m³/h.` }]).map((x) => x.lvl === 'ok' ? Object.assign(x, {}) : x));
      b.textContent = 'Proponer automáticamente'; b.dataset.c = '';
    };
    $('st-size').onclick = () => { G.sizeAll(spec); markDirty(); stProf(); stList(); toast('Bombas y set points recalculados'); };
    $('st-add').onclick = () => {
      const k = $('st-new-k').value, pk = Math.max(0.1, Math.min((spec.lengthKm || 1) - 0.1, Number($('st-new-pk').value) || 0));
      const n = spec.stations.filter((x) => x.kind === k).length + 1;
      const s = G.newStation(k, pk, n);
      spec.stations.push(s);
      spec.stations.sort((a, b) => a.pk - b.pk);
      if (k === 'bombeo') { s.pumps = G.sizePumps(G.opLimit(spec) - (spec.ops.pAspSpKg || 5), spec.ops.maxPumpHeadKg); s.pDescSp = G.opLimit(spec); s.pAspSp = spec.ops.pAspSpKg; }
      if (k === 'reductora') s.pDescSp = Math.round(G.opLimit(spec) * 0.55);
      openSt.add(s.uid);
      markDirty(); stProf(); stList();
    };
  };
  REFRESH.estaciones = (path, kind) => {
    stProf();
    if (kind === 'change' && /\.(kind|pk|altHead)$/.test(path)) { const s = getPath(spec, path.split('.').slice(0, 2).join('.')); if (s && /kind$/.test(path)) { s.pumps = null; G.sizeAll({ ...spec, stations: [s] }); } stList(); }
    renderSteps();
  };
  $('ed-pane').addEventListener('click', (e) => {
    if (!spec || step !== 'estaciones') return;
    const t = e.target.closest('[data-toggle],[data-delst],[data-addinj],[data-noinj]');
    if (!t) return;
    const d = t.dataset;
    if (d.toggle) { if (openSt.has(d.toggle)) openSt.delete(d.toggle); else openSt.add(d.toggle); stList(); return; }
    const s = spec.stations.find((x) => x.uid === (d.delst || d.addinj || d.noinj));
    if (!s) return;
    if (d.delst) spec.stations = spec.stations.filter((x) => x !== s);
    if (d.addinj) s.injection = { name: 'Yacimiento ' + s.short, rate: 30, owner: 'Tercero' };
    if (d.noinj) s.injection = null;
    markDirty(); stProf(); stList();
  });
  $('ed-pane').addEventListener('keydown', (e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('[data-toggle]')) { e.preventDefault(); e.target.click(); } });

  // ---- 6. válvulas ----
  VIEWS.valvulas = () => `<h2>Válvulas de bloqueo</h2><p class="b-lead">Las VB permiten aislar un tramo ante una fuga. La propuesta las reparte cada cierta distancia, evita las estaciones (que tienen sus propias válvulas) y agrega una en el punto más bajo del trazado.</p>
    <div class="b-box"><div class="b-row">${F('Separación (km)', 'valveSpacingKm', 'num', { step: 1, min: 2 })}<button type="button" class="b-btn b-btn-hot" id="vb-auto" style="align-self:end">Proponer</button><button type="button" class="b-btn" id="vb-add" style="align-self:end">Agregar VB</button></div></div>
    <div class="b-box"><h3>Perfil</h3><div id="vb-prof">${profileSvg({ h: 240 })}</div></div>
    <div class="b-box"><h3>${spec.valves.length} válvulas</h3><div class="b-tablewrap"><table class="b-table"><thead><tr><th>Nombre</th><th class="r">PK (km)</th><th class="r">Cota (m)</th><th></th></tr></thead><tbody id="vb-rows"></tbody></table></div></div>`;
  function vbRows() {
    const el = $('vb-rows');
    if (!el) return;
    spec.valves.forEach((v, i) => { if (!v.uid) v.uid = 'v' + i + Date.now().toString(36); });
    el.innerHTML = spec.valves.map((v) => `<tr><td><input type="text" value="${esc(v.name)}" data-k="valves.${v.uid}.name" data-t="str" aria-label="Nombre"></td><td class="r"><input type="number" step="0.1" min="0" max="${spec.lengthKm}" value="${v.pk}" data-k="valves.${v.uid}.pk" data-t="num" style="max-width:110px" aria-label="PK"></td><td class="r mono">${spec.profile.length ? n0(G.elevAt(spec.profile, v.pk)) : '—'}</td><td class="r"><button type="button" class="b-btn b-btn-sm b-btn-danger" data-delvb="${v.uid}">Quitar</button></td></tr>`).join('') || '<tr><td colspan="4" class="b-note">Sin válvulas.</td></tr>';
  }
  AFTER.valvulas = () => {
    vbRows();
    $('vb-auto').onclick = () => { spec.valves = G.autoValves(spec, spec.valveSpacingKm); markDirty(); go('valvulas'); };
    $('vb-add').onclick = () => { spec.valves.push({ uid: 'v' + Date.now().toString(36), name: 'VB' + String(spec.valves.length + 1).padStart(2, '0'), pk: +((spec.lengthKm || 1) / 2).toFixed(1) }); spec.valves.sort((a, b) => a.pk - b.pk); markDirty(); go('valvulas'); };
  };
  REFRESH.valvulas = (path, kind) => { if (kind === 'change' && /\.pk$/.test(path)) { spec.valves.sort((a, b) => a.pk - b.pk); $('vb-prof').innerHTML = profileSvg({ h: 240 }); vbRows(); } renderSteps(); };
  $('ed-pane').addEventListener('click', (e) => {
    if (!spec || step !== 'valvulas') return;
    const t = e.target.closest('[data-delvb]');
    if (!t) return;
    spec.valves = spec.valves.filter((v) => v.uid !== t.dataset.delvb);
    markDirty(); go('valvulas');
  });

  // ---- 7. destino ----
  VIEWS.destino = () => {
    const k = spec.dest.kind;
    return `<h2>Destino</h2><p class="b-lead">Qué hay al final del ducto. La terminal recibe en un tanque mientras otro entrega; el lleno reposa para drenar agua antes de entregar.</p>
    <div class="b-box"><h3>Tipo</h3><div class="b-grid">${F('Destino', 'dest.kind', 'select', { options: Object.entries(G.DEST) })}${F('Nombre', 'dest.name', 'str')}</div></div>
    <div class="b-box"><h3>Tanques de la terminal</h3><div class="b-grid">${F('Cantidad de tanques', 'dest.tanks', 'num', { step: 1, min: 1, max: 8 })}${F('Capacidad por tanque (m³)', 'dest.tankM3', 'num', { step: 1000, min: 500 })}${F('Reposo y drenaje (h)', 'dest.settleHours', 'num', { step: 1, min: 0 })}</div></div>
    ${k === 'puerto' ? `<div class="b-box"><h3>Buques</h3><div class="b-grid">${F('Lote por buque (m³)', 'dest.shipM3', 'num', { step: 1000, min: 1000 })}${F('Caudal de carga (m³/h)', 'dest.loadRateM3h', 'num', { step: 100, min: 100 })}${F('Intervalo entre buques (h)', 'dest.shipIntervalH', 'num', { step: 1, min: 0, hint: '0 = calculado para equilibrar el recibo' })}</div></div>`
      : `<div class="b-box"><h3>${k === 'parque' ? 'Despacho' : 'Programa de la refinería'}</h3><div class="b-grid">${F(k === 'parque' ? 'Despacho programado (m³/d)' : 'Carga programada (m³/d)', 'dest.programM3d', 'num', { step: 100, min: 0, hint: '0 = igual al recibo del ducto' })}</div></div>`}
    <div class="b-box"><h3>Balance</h3><div class="b-out" id="ds-out"></div></div>`;
  };
  function dsOut() {
    const el = $('ds-out');
    if (!el) return;
    const d = spec.dest;
    const inj = spec.stations.reduce((a, s) => a + (s.injection ? Number(s.injection.rate) || 0 : 0), 0);
    const qr = (Number(spec.ops.qDesignM3h) || 0) + inj;
    const cap = d.tanks * d.tankM3;
    const usable = d.tanks * d.tankM3 * (0.875 - 0.2);
    let out = d.kind === 'puerto' ? 0 : Number(d.programM3d) || qr * 24;
    let extra = '';
    if (d.kind === 'puerto') {
      const iv = Number(d.shipIntervalH) || Math.max(4, Math.round((d.shipM3 / Math.max(10, qr)) * 0.92 - d.shipM3 / Math.max(100, d.loadRateM3h)));
      const cyc = iv + d.shipM3 / Math.max(100, d.loadRateM3h);
      out = (d.shipM3 / cyc) * 24;
      extra = `<div><span>Buque cada</span><b>${fmt(cyc, 1)} h</b></div><div><span>Carga de un buque</span><b>${fmt(d.shipM3 / d.loadRateM3h, 1)} h</b></div>`;
    }
    const bal = out - qr * 24;
    el.innerHTML = `<div><span>Recibo del ducto</span><b>${n0(qr * 24)} m³/d</b></div><div><span>Salida</span><b>${n0(out)} m³/d</b></div><div class="${Math.abs(bal) > qr * 24 * 0.05 ? 'bad' : 'hot'}"><span>Balance</span><b>${bal >= 0 ? '+' : ''}${n0(bal)} m³/d</b></div><div><span>Capacidad total</span><b>${n0(cap)} m³</b></div><div><span>Volumen operativo</span><b>${n0(usable)} m³</b></div><div><span>Autonomía de recibo</span><b>${fmt(usable / Math.max(1, qr), 1)} h</b></div>${extra}`;
  }
  AFTER.destino = dsOut;
  REFRESH.destino = (path, kind) => { if (path === 'dest.kind' && kind === 'change') { if (!spec.dest.name || Object.values(G.DEST).includes(spec.dest.name)) spec.dest.name = G.DEST[spec.dest.kind]; go('destino'); return; } dsOut(); renderSteps(); };

  // ---- 8. revisión ----
  VIEWS.revision = () => `<h2>Revisión</h2><p class="b-lead">El ducto se arma con la misma configuración que usa el simulador y se corre unas horas simuladas con el motor hidráulico real (Darcy-Weisbach sobre la altimetría, PID de descarga por estación y DRA).</p>
    <div id="rv-body"><div class="b-box"><p class="b-note">Calculando…</p></div></div>`;
  function runReview() {
    const errs = blockers();
    if (errs.length) return { error: errs[0], at: errs[1] };
    const cfg = G.generateConfig(spec);
    const sim = window.PHLDC.createSim(JSON.parse(JSON.stringify(cfg)));
    sim.setDra(!!spec.ops.draEnabled);
    let t = performance.now();
    for (let i = 0; i < 420; i++) { t += 100; sim.tick(t); }
    const geo = window.GEO.build(cfg);
    const prof = window.GEO.pressureProfile(sim, geo, geo.profStep || 5);
    const S = sim.state;
    const rows = sim.sortedStations().slice().sort((a, b) => a.pkKm - b.pkKm).map((s) => ({ s, pin: S.pressuresIn[s.id], pout: S.pressuresOut[s.id], q: S.segmentFlows[s.id] }));
    let pmin = Infinity, pmax = -Infinity, pminPk = 0, pmaxPk = 0;
    for (const p of prof) { if (p.pk > 0.5 && p.pk < geo.L - 0.5) { if (p.p < pmin) { pmin = p.p; pminPk = p.pk; } } if (p.p > pmax) { pmax = p.p; pmaxPk = p.pk; } }
    const w = [];
    const qH = S.segmentFlows.ph || 0, qT = S.segmentFlows.lc || 0;
    if (qH < spec.ops.qDesignM3h * 0.97) w.push({ lvl: 'bad', t: `La cabecera solo sostiene ${n0(qH)} m³/h contra ${n0(spec.ops.qDesignM3h)} de diseño: faltan bombas, presión o DRA.` });
    if (pmin < (Number(spec.ops.pMinLineKg) || 2)) w.push({ lvl: 'warn', t: `Presión mínima de ${fmt(pmin)} kg/cm² cerca del PK ${n0(pminPk)}.` });
    if (pmax > cfg._meta.maopKgCm2) w.push({ lvl: 'bad', t: `Presión máxima de ${fmt(pmax)} kg/cm² en el PK ${n0(pmaxPk)}, sobre la MAOP.` });
    for (const a of S.alarms || []) if (!/Tanque|Terminal/.test(a.text)) w.push({ lvl: a.severity === 'critical' ? 'bad' : 'warn', t: 'Alarma del simulador: ' + a.text });
    return { cfg, rows, prof, geo, S, qH, qT, pmin, pmax, w, bad: w.some((x) => x.lvl === 'bad') };
  }
  AFTER.revision = () => {
    setTimeout(() => {
      let r;
      try { r = runReview(); } catch (err) { console.error(err); r = { error: 'No se pudo correr el motor: ' + err.message }; }
      const body = $('rv-body');
      if (!body) return;
      if (r.error) { body.innerHTML = `<div class="b-warns"><div class="b-warn bad">${esc(r.error)}</div></div>${r.at ? `<div class="b-row"><button type="button" class="b-btn b-btn-hot" data-goto="${r.at}">Ir al paso</button></div>` : ''}`; return; }
      review = r; renderSteps();
      const M = r.cfg._meta, km = KG_M(spec.fluid.densityKgM3);
      const hgl = r.prof.map((p) => ({ pk: p.pk, h: p.hgl }));
      const pumps = spec.stations.reduce((a, s) => a + (s.pumps ? s.pumps.mains + (s.pumps.boosters || 0) : 0), 0);
      let h = `<div class="b-box"><h3>Resumen</h3><div class="b-out"><div class="hot"><span>Largo</span><b>${fmt(M.lengthKm)} km</b></div><div><span>Caño</span><b>${M.diameterInch} in · ${esc(spec.pipe.grade)}</b></div><div class="hot"><span>MAOP</span><b>${fmt(M.maopKgCm2)} kg/cm²</b></div><div><span>Estaciones</span><b>${spec.stations.length}</b></div><div><span>Bombas</span><b>${pumps}</b></div><div><span>Válvulas</span><b>${spec.valves.length}</b></div><div class="${r.qH < spec.ops.qDesignM3h * 0.97 ? 'bad' : 'hot'}"><span>Caudal cabecera</span><b>${n0(r.qH)} m³/h</b></div><div><span>Recibo ${esc(r.cfg.stations[r.cfg.stations.length - 1].shortName)}</span><b>${n0(r.qT)} m³/h</b></div><div><span>Plan diario</span><b>${n0(M.dailyPlanM3d)} m³/d</b></div><div><span>Linepack</span><b>${n0(r.cfg.segments.reduce((a, s) => a + s.linepackM3, 0))} m³</b></div><div><span>P mín. en línea</span><b>${fmt(r.pmin)} kg/cm²</b></div><div><span>P máx. en línea</span><b>${fmt(r.pmax)} kg/cm²</b></div></div>
        ${warnsHtml(r.w, 'El motor sostiene el caudal de diseño sin alarmas hidráulicas. Listo para simular.')}</div>`;
      h += `<div class="b-box"><h3>Perfil hidráulico del simulador</h3>${profileSvg({ hgl, maop: true, h: 340 })}${legend([['#8fe6ff', 'Piezométrica (motor)'], ['#e5484d', 'MAOP', 1]])}</div>`;
      h += `<div class="b-box"><h3>Estaciones</h3><div class="b-tablewrap"><table class="b-table"><thead><tr><th>Estación</th><th>Tipo</th><th class="r">PK</th><th class="r">Cota</th><th class="r">Aspiración</th><th class="r">Descarga</th><th class="r">% MAOP</th><th class="r">Caudal</th><th>Bombas</th></tr></thead><tbody>` +
        r.rows.map(({ s, pin, pout, q }) => {
          const pct = pout != null ? (pout / M.maopKgCm2) * 100 : null;
          const mains = (s.pumps || []).filter((p) => p.role === 'main');
          const lowA = s.pAspSpKgCm2 != null && pin != null && pin < s.pAspSpKgCm2 - 0.5 && s.id !== 'ph';
          return `<tr><td><b>${esc(s.shortName)}</b> ${esc(s.name)}</td><td>${G.KINDS[s.kind] || s.type}</td><td class="r mono">${fmt(s.pkKm)}</td><td class="r mono">${n0(s.elevationMsnm)}</td><td class="r mono ${lowA ? 'warn' : ''}">${fmt(pin)}</td><td class="r mono">${fmt(pout)}</td><td class="r mono ${pct > 100 ? 'bad' : pct > 90 ? 'warn' : ''}">${pct == null ? '—' : n0(pct)}</td><td class="r mono">${n0(q)}</td><td>${mains.length ? `${mains.filter((p) => p.online).length}/${mains.length} × ${fmt(mains[0].boostKgCm2)}` : '—'}</td></tr>`;
        }).join('') + '</tbody></table></div><p class="b-note">Presiones en kg/cm² y caudales en m³/h, con el PID de cada estación entregando la presión que necesita el caudal (tope en su set point de descarga).</p></div>';
      h += `<div class="b-box"><h3>Listo para operar</h3><p class="b-note">Al simular se generan la vista 3D con el terreno del trazado, la sala de control, el SCADA (principal, P&ID por estación, medición y prover, integridad, terminal, cierres OMNI, custody, alarmas, eventos y fallas) y el desafío con incidentes armados con tus estaciones. Todo queda modificable desde las pantallas.</p><div class="b-row"><button type="button" class="b-btn b-btn-hot" id="rv-sim">Guardar y simular</button><button type="button" class="b-btn" id="rv-json">Exportar .json</button></div></div>`;
      body.innerHTML = h;
      $('rv-sim').onclick = () => $('ed-sim').click();
      $('rv-json').onclick = () => $('ed-export').click();
    }, 30);
  };
  $('ed-pane').addEventListener('click', (e) => { const b = e.target.closest('[data-goto]'); if (b) go(b.dataset.goto); });

  window.addEventListener('beforeunload', (e) => { if (spec && dirty) { e.preventDefault(); e.returnValue = ''; } });

  // ======================= arranque =======================
  const qid = new URLSearchParams(location.search).get('id');
  const s0 = qid ? G.lib.get(qid) : null;
  if (s0) openEditor(s0);
  else showLib();
  window.BUILDER = { get spec() { return spec; }, go, exampleSpec, runReview };
})();
