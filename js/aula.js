/* Oleoducto Beta · Aula: panel docente (banco de preguntas, desafíos en el simulador, evaluaciones,
   reportes y Excel) y modo alumno (rendir por link, desafíos medidos en el simulador, comprobante de entrega).
   Sin servidor: la evaluación viaja comprimida en el link y la entrega vuelve como un código o un archivo. */
(function (global) {
  'use strict';
  const KEY = 'ob.aula.v1', KMIS = 'ob.aula.mis', KTAKE = 'ob.aula.take';
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const fmt = (v, d) => (v == null || !isFinite(v) ? '—' : Number(v).toLocaleString('es-AR', { minimumFractionDigits: d || 0, maximumFractionDigits: d || 0 }));
  const uid = () => Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);
  const ls = {
    get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* sin almacenamiento */ } },
    del(k) { try { localStorage.removeItem(k); } catch (e) { /* idem */ } },
  };
  const now = () => new Date().toISOString();
  const fdt = (iso) => { try { const d = new Date(iso); return d.toLocaleDateString('es-AR') + ' ' + d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }); } catch (e) { return iso; } };

  // ---------- codificación compacta (deflate + base64url) ----------
  const toB64u = (u8) => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
  const fromB64u = (t) => Uint8Array.from(atob(t.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((t.length + 3) % 4)), (c) => c.charCodeAt(0));
  async function pipe(u8, Stream, mode) { const s = new Blob([u8]).stream().pipeThrough(new Stream(mode)); return new Uint8Array(await new Response(s).arrayBuffer()); }
  async function pack(obj) {
    const raw = new TextEncoder().encode(JSON.stringify(obj));
    if (global.CompressionStream) { try { return 'z' + toB64u(await pipe(raw, CompressionStream, 'deflate-raw')); } catch (e) { /* sin compresión */ } }
    return 'j' + toB64u(raw);
  }
  async function unpack(code) {
    const c = String(code || '').trim();
    const raw = fromB64u(c.slice(1));
    const u8 = c[0] === 'z' ? await pipe(raw, DecompressionStream, 'deflate-raw') : raw;
    return JSON.parse(new TextDecoder().decode(u8));
  }
  async function sha(text) {
    const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return Array.from(new Uint8Array(h)).slice(0, 8).map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  // ---------- contenido de ejemplo ----------
  const SEED_Q = [
    ['mc', 'Protecciones', '¿A qué presión abre la válvula de alivio (PSV) de las estaciones en el simulador?', ['85 kg/cm²', '90 kg/cm²', '95 kg/cm²', '110 kg/cm²'], 2, 'La PSV está calibrada a 95 kg/cm² y alivia al tanque de alivio si el PSHH no actuó.'],
    ['vf', 'Arranque', 'Una bomba principal se arranca con la válvula de aspiración abierta y la de descarga cerrada.', null, true, 'Es un permisivo: arranque contra descarga cerrada y apertura de la MOV con la bomba en marcha.'],
    ['mc', 'Protecciones', 'Si se cierra una válvula de bloqueo aguas abajo con las bombas en marcha, ¿qué pasa primero?', ['Baja la presión aguas arriba', 'Sube la presión aguas arriba hasta el PSHH', 'Aumenta el caudal de recibo', 'No cambia nada'], 1, 'La línea queda bloqueada: aguas arriba la presión sube hasta el disparo por PSHH; aguas abajo se despresuriza.'],
    ['mc', 'Control', '¿Qué hace el SP tracking cuando el lazo pasa a manual?', ['El SP sigue a la PV para evitar un salto al volver a automático', 'Congela la PV', 'Lleva el SP a cero', 'Abre la válvula de control al 100 %'], 0, 'Con tracking, el SP copia la variable medida; al volver a automático no hay salto (bump).'],
    ['vf', 'Control', 'En el faceplate, el lazo de caudal solo existe en la cabecera; las estaciones intermedias controlan presiones.', null, true, 'Las intermedias regulan aspiración y descarga; el caudal se fija en cabecera.'],
    ['mc', 'Arranque', '¿Cuál es el orden correcto para arrancar la línea?', ['Todas las estaciones a la vez', 'Desde la terminal hacia la cabecera', 'Cabecera primero y cada estación cuando le llega presión de aspiración', 'Indistinto'], 2, 'Es la secuencia que hace el arranque automático de línea.'],
    ['num', 'Arranque', 'Caudal de arranque 150 m³/h, rampa de 15 m³/h por minuto. ¿Cuántos minutos tarda en llegar a 690 m³/h?', { u: 'min' }, { v: 36, tol: 1 }, '(690 − 150) / 15 = 36 minutos.'],
    ['mc', 'Equipos', '¿Cuándo se drena crudo al tanque sumidero de una estación?', ['Al lanzar o recibir un scraper', 'Cada hora', 'Con alta presión de descarga', 'Nunca'], 0, 'Lanzamiento y recepción de scraper drenan a sumidero; una válvula pasante también lo llena.'],
    ['mc', 'Operación', 'Si la cabecera queda parada más de 5 minutos, la estrategia global...', ['Arranca la reserva de cabecera', 'Detiene las estaciones aguas abajo', 'Sube el caudal de las intermedias', 'No hace nada'], 1, 'Sin cabecera no tiene sentido seguir bombeando aguas abajo (salvo cabecera temporal).'],
    ['mc', 'Alarmas', 'Según la gestión de alarmas (ISA-18.2), una alarma de prioridad 1...', ['Requiere acción inmediata del operador', 'Es solo informativa', 'Es para mantenimiento', 'Se reconoce al final del turno'], 0, 'Prioridad 1: consecuencia grave y poco tiempo para responder.'],
    ['vf', 'Operación', 'La bomba de reserva es siempre la misma y no puede usarse como bomba de servicio.', null, false, 'La reserva no es una designación permanente: es la que queda parada.'],
    ['mc', 'Hidráulica', '¿Qué efecto tiene inyectar DRA (reductor de fricción)?', ['Disminuye la pérdida de carga por fricción', 'Aumenta la fricción', 'Sube la viscosidad del crudo', 'Ninguno'], 0, 'El DRA reduce la fricción turbulenta: con la misma presión pasa más caudal.'],
    ['num', 'Hidráulica', '¿Cuántos kg/cm² ejerce una columna de 100 m de crudo de densidad relativa 0,85?', { u: 'kg/cm²' }, { v: 8.5, tol: 0.3 }, 'P = 0,1 × densidad × altura = 0,1 × 0,85 × 100 = 8,5 kg/cm².'],
    ['mc', 'Integridad', 'Una fuga pequeña se detecta primero en...', ['El balance de volumen entrada–salida', 'La vibración de las bombas', 'La temperatura de cojinetes', 'El nivel del sumidero'], 0, 'El balance no cierra antes de que las presiones muestren un cambio claro.'],
    ['vf', 'Protecciones', 'Con la MOV de salida de una estación cerrada y las bombas en marcha, la presión de descarga sube hasta el disparo por PSHH.', null, true, 'Sube unos 4 kg/cm² por minuto hasta el PSHH; si está inhibido, alivia la PSV.'],
    ['ab', 'Operación', 'Describí los pasos del supervisor ante un corte de energía en una estación intermedia.', null, 'Reconocer la alarma, bajar caudal de cabecera, cerrar descargas, coordinar con eléctrica, rearmar con permisivos y volver en rampa.', 'Se corrige a mano en el panel docente.'],
  ];
  function seedQuestions() {
    return SEED_Q.map(([tipo, tema, texto, op, correcta, expl]) => {
      const q = { id: uid(), tipo, tema, texto, puntos: tipo === 'ab' ? 2 : 1, expl };
      if (tipo === 'mc') { q.op = op; q.ok = correcta; }
      if (tipo === 'vf') q.ok = correcta;
      if (tipo === 'num') { q.ok = correcta; q.u = op.u; }
      if (tipo === 'ab') q.modelo = correcta;
      return q;
    });
  }
  function seedChallenges() {
    return [
      { id: uid(), titulo: 'Arranque de línea en frío', consigna: 'La línea está parada con todas las bombas detenidas. Reiniciá las estaciones, arrancá cabecera primero y cada estación cuando reciba presión de aspiración, y llevá el caudal al despacho sin disparos.', inicio: 'parada', durH: 3, fallas: [], metas: [{ t: 'recibo', v: 85, p: 4 }, { t: 'disparos', v: 0, p: 3 }, { t: 'alivio', v: 0, p: 3 }] },
      { id: uid(), titulo: 'Corte de energía en una estación intermedia', consigna: 'Operá el turno. A los 10 minutos se corta la energía de una estación intermedia: reconocé la alarma, protegé la línea, seguí los pasos del supervisor y recuperá el bombeo.', inicio: 'normal', durH: 3, fallas: [{ k: 'corte', loc: 'auto2', min: 10 }], metas: [{ t: 'ack', v: 60, p: 2 }, { t: 'pasos', v: 80, p: 3 }, { t: 'volumen', v: 70, p: 3 }, { t: 'disparos', v: 0, p: 2 }] },
      { id: uid(), titulo: 'Bloqueo: MOV de salida cerrada', consigna: 'Se cierra la MOV de salida de una estación con las bombas en marcha. Detectá la subida de presión y pará las bombas antes del disparo por PSHH. Después normalizá.', inicio: 'normal', durH: 2, fallas: [{ k: 'movout', loc: 'auto2', min: 5 }], metas: [{ t: 'disparos', v: 0, p: 4 }, { t: 'alivio', v: 0, p: 3 }, { t: 'ack', v: 45, p: 3 }] },
      { id: uid(), titulo: 'Fuga en el ducto', consigna: 'Turno normal con una fuga sorpresa. Detectala con el balance de volumen, aislá el tramo y seguí el procedimiento.', inicio: 'normal', durH: 4, fallas: [{ k: 'fuga', loc: 'auto', min: 20 }], metas: [{ t: 'pasos', v: 80, p: 4 }, { t: 'ack', v: 60, p: 3 }, { t: 'alivio', v: 0, p: 3 }] },
    ];
  }
  const META_T = {
    recibo: ['Caudal de recibo al final', '≥ % del despacho', '%'],
    volumen: ['Volumen recibido', '≥ % del plan del período', '%'],
    disparos: ['Disparos de estaciones evitables', '≤ cantidad', ''],
    alivio: ['Sin alivio por PSV', 'tolerancia en m³', 'm³'],
    ack: ['Reconocimiento de alarmas', '≤ s promedio', 's'],
    pasos: ['Pasos del supervisor marcados', '≥ % de los pasos', '%'],
  };
  const TIPO_Q = { mc: 'Opción múltiple', vf: 'Verdadero / falso', num: 'Numérica', ab: 'Respuesta abierta' };

  function createAula(app) {
    const sim = app.sim, S = () => sim.state;
    const root = document.getElementById('aula-root');
    const LIC = () => global.OBLIC || null;
    const flt = () => (app.ing && app.ing.faults) || null;
    const META = S().config._meta || {};
    const QDISP = () => (S().dispatchQ != null ? S().dispatchQ : (META.defaultPhCabeceraM3h || 680));
    let db = ls.get(KEY, null);
    function save() { ls.set(KEY, db); }
    function ensureDb() { if (!db) { db = { q: seedQuestions(), d: seedChallenges(), e: [], r: [] }; save(); } }
    let mode = 'inicio', dtab = 'preguntas', edit = null, pub = null, resEv = null, resDet = null, msg = '';
    let open = null; // evaluación abierta por el alumno
    let take = ls.get(KTAKE, null); // evaluación en curso
    let run = null; // desafío en curso
    let done = null; // última entrega

    // ---------- link de evaluación al abrir ----------
    const pendingHash = /^#eval=/.test(location.hash) ? location.hash.slice(6) : null;
    if (pendingHash) loadEvalCode(pendingHash);
    async function loadEvalCode(code) {
      try {
        const c = String(code).trim().replace(/^.*[#?&]eval=/, '').replace(/\s+/g, '');
        const ev = await unpack(c);
        if (!ev || !ev.id || !ev.preg) throw new Error('x');
        if (ev.lic && LIC()) { const r = await LIC().activate(ev.lic); if (r.ok && !r.kept) app.toast(`Licencia de alumno activada: ${ev.curso || ev.inst || 'curso'}`); }
        open = ev; mode = 'alumno'; msg = '';
        if (take && take.ev.id !== ev.id) take = null;
        render();
        return true;
      } catch (e) { msg = 'No se pudo leer la evaluación. Copiá el link completo.'; render(); return false; }
    }

    // ---------- corrección ----------
    function gradeQ(q, r) {
      if (r == null || r === '') return 0;
      if (q.tipo === 'mc') return Number(r) === q.ok ? q.puntos : 0;
      if (q.tipo === 'vf') return (r === true || r === 'v') === q.ok ? q.puntos : 0;
      if (q.tipo === 'num') { const x = Number(String(r).replace(',', '.')); return isFinite(x) && Math.abs(x - q.ok.v) <= (q.ok.tol || 0) ? q.puntos : 0; }
      return null; // abierta: corrige el docente
    }
    function scoreTake(ev, answers, chRes, manual) {
      const preg = ev.preg.map((q) => { const r = answers[q.id]; let pts = gradeQ(q, r); if (manual && manual[q.id] != null) pts = manual[q.id]; return { id: q.id, r, pts, max: q.puntos }; });
      const des = (ev.des || []).map((d) => { const x = chRes[d.id]; const max = d.metas.reduce((a, m) => a + m.p, 0); return x ? { id: d.id, titulo: d.titulo, metas: x.metas, pts: x.pts, max, kpi: x.kpi } : { id: d.id, titulo: d.titulo, metas: [], pts: 0, max, sin: true }; });
      const total = preg.reduce((a, x) => a + (x.pts || 0), 0) + des.reduce((a, x) => a + x.pts, 0);
      const max = preg.reduce((a, x) => a + x.max, 0) + des.reduce((a, x) => a + x.max, 0);
      const pend = preg.some((x) => x.pts == null);
      const pct = max ? Math.round(1000 * total / max) / 10 : 0;
      return { preg, des, total, max, pct, pend, aprobado: pct >= (ev.aprob || 60) };
    }

    // ---------- desafío en el simulador ----------
    function stationsPumped() { return sim.sortedStations().slice().sort((a, b) => (a.pkKm || 0) - (b.pkKm || 0)).filter((x) => (x.pumps || []).some((p) => !(p.role || '').includes('booster'))); }
    function resolveLoc(k, loc) {
      const F = flt(); if (!F) return null;
      const c = F.CAT.find((x) => x.k === k); if (!c) return null;
      const opts = F.locOptions(c.where);
      if (!opts.length) return null;
      if (loc && opts.some((o) => String(o[0]) === String(loc))) return loc;
      if (c.where === 'pk') return opts[Math.floor(opts.length * 0.45)][0];
      if (c.where === 'station' && loc === 'auto2' && opts.length > 2) return opts[Math.min(opts.length - 2, 2)][0];
      return opts[opts.length > 1 ? 1 : 0][0];
    }
    const TRIP_FAULTS = ['corte', 'trafo', 'hueco', 'esd', 'vfd', 'hvac', 'vib', 'lube', 'brg', 'sello', 'booster', 'rotura'];
    function startChallenge(d, preview) {
      const F = flt();
      app.normalOps();
      if (app.alarms.ackAll) app.alarms.ackAll();
      if (app.alarms.reset) app.alarms.reset();
      sim.setPaused(false);
      sim.setSpeed(60); app.setSpeedButtons(60);
      if (d.inicio === 'parada') {
        S().stations.forEach((x) => (x.pumps || []).forEach((p) => { if (p.online) sim.setPump(x.id, p.id, false); }));
        S().globalFlowSetpoint = 0; S().flowTarget = null;
      }
      const excl = {};
      const fired = [];
      const plan = [];
      (d.fallas || []).forEach((f) => { const loc = resolveLoc(f.k, f.loc); if (F && loc != null) { plan.push({ k: f.k, loc, atS: Math.max(0, Number(f.min) || 0) * 60 }); fired.push(f.k); if (TRIP_FAULTS.includes(f.k)) excl[loc] = 1; } });
      const relief0 = Object.values(S().relief || {}).reduce((a, r) => a + (r.volM3 || 0), 0);
      run = { d, preview: !!preview, t0: S().timeSec, durS: (Number(d.durH) || 2) * 3600, m3: 0, trips: {}, excl, relief0, seen: {}, acks: [], act0: F ? F.active().length : 0, plan, lastT: S().timeSec, preTrip: Object.assign({}, S().failedStations), qEnd: 0 };
      if (d.inicio === 'parada') run.preTrip = {};
      showHud();
      app.go('ingenieria');
      app.toast(`Desafío: ${d.titulo}`);
    }
    function measure() {
      if (!run) return;
      const s = S(), dt = Math.max(0, s.timeSec - run.lastT); run.lastT = s.timeSec;
      for (const f of run.plan) if (!f.done && s.timeSec - run.t0 >= f.atS) { f.done = true; const F = flt(); if (F) F.fire(f.k, f.loc); }
      run.m3 += (s.segmentFlows.lc || 0) * dt / 3600;
      for (const id of Object.keys(s.failedStations || {})) if (s.failedStations[id] && !run.preTrip[id] && !run.excl[id]) run.trips[id] = 1;
      for (const id of Object.keys(run.preTrip)) if (!(s.failedStations || {})[id]) delete run.preTrip[id];
      const tnow = performance.now();
      for (const a of app.alarms.sorted()) {
        if (!run.seen[a.id]) run.seen[a.id] = { t: a.t || tnow, done: false };
        const r = run.seen[a.id];
        if (a.acked && !r.done) { r.done = true; run.acks.push(Math.max(0, ((a.ackT || tnow) - r.t) / 1000)); }
      }
      if (s.timeSec - run.t0 >= run.durS) finishChallenge();
    }
    function kpis(final) {
      const s = S(), F = flt();
      const elapsedH = Math.max(1 / 60, (s.timeSec - run.t0) / 3600);
      const pending = Object.values(run.seen).filter((r) => !r.done).map((r) => { const w = (performance.now() - r.t) / 1000; return final ? Math.max(w, 120) : w; });
      const all = run.acks.concat(pending);
      const acts = F ? F.active().slice(0, Math.max(0, F.active().length - run.act0)) : [];
      const steps = acts.reduce((a, x) => a + x.steps.length, 0), marked = acts.reduce((a, x) => a + x.steps.filter(Boolean).length, 0);
      const relief = Math.max(0, Object.values(s.relief || {}).reduce((a, r) => a + (r.volM3 || 0), 0) - run.relief0);
      return {
        recibo: QDISP() > 0 ? 100 * (s.segmentFlows.lc || 0) / QDISP() : 0,
        volumen: QDISP() > 0 ? 100 * run.m3 / (QDISP() * elapsedH) : 0,
        disparos: Object.keys(run.trips).length,
        alivio: relief,
        ack: all.length ? all.reduce((a, b) => a + b, 0) / all.length : 0,
        pasos: steps ? 100 * marked / steps : 100,
        m3: run.m3, h: elapsedH, nAlm: all.length,
      };
    }
    function metOk(m, k) { const v = k[m.t]; return m.t === 'recibo' || m.t === 'volumen' || m.t === 'pasos' ? v >= m.v : v <= m.v; }
    function finishChallenge(abort) {
      if (!run) return;
      const k = kpis(true), d = run.d;
      const metas = d.metas.map((m) => { const ok = !abort && metOk(m, k); return { t: m.t, obj: m.v, val: Math.round(k[m.t] * 10) / 10, ok, pts: ok ? m.p : 0, max: m.p }; });
      const res = { metas, pts: metas.reduce((a, m) => a + m.pts, 0), kpi: { m3: Math.round(k.m3), h: Math.round(k.h * 100) / 100, alarmas: k.nAlm }, abort: !!abort };
      const F = flt(); if (F && F.reset) F.reset();
      const wasPreview = run.preview;
      run = null; hideHud();
      if (!wasPreview && take) { take.ch[d.id] = res; ls.set(KTAKE, take); }
      else app.toast(`Prueba del desafío: ${res.pts} de ${d.metas.reduce((a, m) => a + m.p, 0)} puntos`);
      app.normalOps();
      app.go('aula'); render();
    }
    function showHud() {
      let h = document.getElementById('aula-hud');
      if (!h) { h = document.createElement('div'); h.id = 'aula-hud'; h.className = 'au-hud min'; document.body.appendChild(h); h.addEventListener('click', (e) => { if (e.target.closest('[data-auhud="fin"]')) finishChallenge(); if (e.target.closest('[data-auhud="ab"]')) finishChallenge(true); if (e.target.closest('[data-auhud="ver"]')) h.classList.toggle('min'); }); }
      h.hidden = false; paintHud();
    }
    function hideHud() { const h = document.getElementById('aula-hud'); if (h) h.hidden = true; }
    function paintHud() {
      const h = document.getElementById('aula-hud'); if (!h || !run) return;
      const k = kpis(), left = Math.max(0, run.durS - (S().timeSec - run.t0));
      const hh = Math.floor(left / 3600), mm = Math.floor((left % 3600) / 60);
      h.innerHTML = `<div class="au-hud-h"><b>Desafío${run.preview ? ' (prueba)' : ''}: ${esc(run.d.titulo)}</b><span>restan <b>${hh}:${String(mm).padStart(2, '0')}</b> h sim</span><span>metas <b>${run.d.metas.filter((m) => metOk(m, k)).length}/${run.d.metas.length}</b></span><button type="button" data-auhud="ver">Consigna y metas</button><button type="button" class="hot" data-auhud="fin">Entregar desafío</button><button type="button" data-auhud="ab">Abandonar</button></div>
        <div class="au-hud-c">${esc(run.d.consigna)}<ul>${run.d.metas.map((m) => { const ok = metOk(m, k); const T = META_T[m.t]; return `<li class="${ok ? 'ok' : 'no'}">${ok ? '✓' : '·'} ${esc(T[0])} ${esc(T[1].split(' ')[0])} ${fmt(m.v)} ${esc(T[2])} <i>ahora ${fmt(k[m.t], m.t === 'alivio' ? 1 : 0)} ${esc(T[2])}</i></li>`; }).join('')}</ul></div>`;
    }

    // ---------- vistas ----------
    function inicio() {
      const mis = ls.get(KMIS, []);
      const canDoc = LIC() ? LIC().can('docente') : true;
      return `<div class="au-hero"><div class="g-eyebrow">Aula</div><h1>Docentes y alumnos</h1><p>El docente arma preguntas, desafíos que se miden en el simulador y evaluaciones. Los alumnos las abren con un link, las rinden y devuelven un comprobante que el docente importa para ver reportes y exportar a Excel.</p></div>
      <div class="au-two">
        <article class="au-card"><div class="g-tag">Alumno</div><h2>Rendir una evaluación</h2><p>Pegá el link o el código que te pasó tu docente.</p><textarea id="au-code" rows="3" placeholder="https://…#eval=…"></textarea><button type="button" class="x-btn x-btn-hot" data-au="abrir">Abrir evaluación</button>${msg ? `<p class="au-bad">${esc(msg)}</p>` : ''}${take ? `<p class="au-note">Tenés una evaluación en curso: <b>${esc(take.ev.titulo)}</b>. <button type="button" class="au-lnk" data-au="seguir">Continuar</button></p>` : ''}</article>
        <article class="au-card"><div class="g-tag">Docente</div><h2>Panel docente</h2><p>Banco de preguntas editable, desafíos con fallas programadas y metas medidas, evaluaciones por link, reportes por alumno y por tema, Excel.</p><button type="button" class="x-btn ${canDoc ? 'x-btn-hot' : ''}" data-au="docente">${canDoc ? 'Entrar al panel docente' : '🔒 Ver el panel (licencia institucional)'}</button></article>
      </div>
      ${mis.length ? `<h3 class="au-h3">Mis entregas en este dispositivo</h3><table class="au-t"><tr><th>Fecha</th><th>Evaluación</th><th>Curso</th><th>Resultado</th><th></th></tr>${mis.map((m, i) => `<tr><td>${fdt(m.fin)}</td><td>${esc(m.titulo)}</td><td>${esc(m.curso || '')}</td><td>${m.mostrar ? `${fmt(m.pct, 1)} % ${m.pend ? '(falta corregir abiertas)' : m.aprobado ? '· aprobado' : '· no aprobado'}` : 'Entregada'}</td><td><button type="button" class="au-lnk" data-aumis="${i}">Ver comprobante</button></td></tr>`).join('')}</table>` : ''}`;
    }
    // ----- alumno -----
    function alumno() {
      if (done) return entregaView(done);
      if (!open && take) open = take.ev;
      if (!open) { mode = 'inicio'; return inicio(); }
      const ev = open;
      if (!take || take.ev.id !== ev.id) {
        return `<div class="au-sheet"><button type="button" class="au-lnk" data-au="volver">← Aula</button><div class="g-eyebrow">${esc(ev.curso || 'Evaluación')}${ev.inst ? ' · ' + esc(ev.inst) : ''}</div><h1 class="au-h1">${esc(ev.titulo)}</h1>${ev.instr ? `<p class="au-instr">${esc(ev.instr)}</p>` : ''}
          <div class="au-facts"><span><b>${ev.preg.length}</b> preguntas</span><span><b>${(ev.des || []).length}</b> desafíos en el simulador</span><span>${ev.tiempo ? `<b>${ev.tiempo}</b> min` : 'sin límite de tiempo'}</span><span>aprobás con <b>${ev.aprob}%</b></span></div>
          <label class="au-f">Nombre y apellido <input id="au-nom" autocomplete="name"></label><label class="au-f">DNI o legajo <input id="au-dni"></label>
          <button type="button" class="x-btn x-btn-hot" data-au="comenzar">Comenzar</button></div>`;
      }
      const leftMin = ev.tiempo ? Math.max(0, ev.tiempo - (Date.now() - take.t0) / 60000) : null;
      let h = `<div class="au-sheet"><div class="au-bar"><div><div class="g-eyebrow">${esc(ev.curso || '')}</div><b>${esc(ev.titulo)}</b> · ${esc(take.alumno)}</div>${leftMin != null ? `<div class="au-timer" id="au-timer">${Math.floor(leftMin)}:${String(Math.floor((leftMin % 1) * 60)).padStart(2, '0')}</div>` : ''}</div>`;
      if ((ev.des || []).length) {
        h += `<h3 class="au-h3">Desafíos en el simulador</h3><p class="au-note">Cada desafío prepara el simulador, programa las fallas y mide tus metas. Al terminar el tiempo simulado (o al tocar «Entregar desafío») se guarda el resultado.</p><div class="au-chs">`;
        h += ev.des.map((d) => { const r = take.ch[d.id]; const max = d.metas.reduce((a, m) => a + m.p, 0); return `<div class="au-ch ${r ? 'done' : ''}"><b>${esc(d.titulo)}</b><p>${esc(d.consigna)}</p><small>${d.durH} h simuladas · ${d.inicio === 'parada' ? 'línea parada' : 'operación normal'}${(d.fallas || []).length ? ' · ' + d.fallas.length + ' falla(s) programada(s)' : ''}</small><ul>${d.metas.map((m) => `<li>${esc(META_T[m.t][0])} ${esc(META_T[m.t][1].split(' ')[0])} ${fmt(m.v)} ${esc(META_T[m.t][2])} · ${m.p} pts</li>`).join('')}</ul>${r ? `<p class="au-ok">Realizado${ev.mostrar ? `: ${r.pts} de ${max} puntos` : ''}</p>` : `<button type="button" class="x-btn x-btn-hot" data-auch="${d.id}">Iniciar desafío</button>`}</div>`; }).join('');
        h += '</div>';
      }
      h += `<h3 class="au-h3">Preguntas</h3><ol class="au-qs">`;
      for (const q of take.orden.map((id) => ev.preg.find((x) => x.id === id)).filter(Boolean)) {
        const r = take.ans[q.id];
        h += `<li class="au-q"><p>${esc(q.texto)} <span class="au-pts">${q.puntos} pt${q.puntos === 1 ? '' : 's'}</span></p>`;
        if (q.tipo === 'mc') h += q.op.map((o, i) => `<label class="au-op"><input type="radio" name="q-${q.id}" data-auq="${q.id}" value="${i}" ${String(r) === String(i) ? 'checked' : ''}> ${esc(o)}</label>`).join('');
        if (q.tipo === 'vf') h += `<label class="au-op"><input type="radio" name="q-${q.id}" data-auq="${q.id}" value="v" ${r === 'v' ? 'checked' : ''}> Verdadero</label><label class="au-op"><input type="radio" name="q-${q.id}" data-auq="${q.id}" value="f" ${r === 'f' ? 'checked' : ''}> Falso</label>`;
        if (q.tipo === 'num') h += `<label class="au-op"><input type="text" inputmode="decimal" data-auq="${q.id}" value="${esc(r || '')}" class="au-num"> ${esc(q.u || '')}</label>`;
        if (q.tipo === 'ab') h += `<textarea data-auq="${q.id}" rows="3">${esc(r || '')}</textarea>`;
        h += '</li>';
      }
      h += `</ol><div class="au-actions"><button type="button" class="x-btn x-btn-hot" data-au="entregar">Entregar evaluación</button><span class="au-note">Las respuestas se guardan solas en este dispositivo.</span></div></div>`;
      return h;
    }
    async function entregar(auto) {
      const ev = take.ev;
      const pendCh = (ev.des || []).filter((d) => !take.ch[d.id]).length;
      if (!auto && pendCh && !confirm(`Te falta${pendCh > 1 ? 'n' : ''} ${pendCh} desafío(s). ¿Entregás igual?`)) return;
      const sc = scoreTake(ev, take.ans, take.ch);
      const rec = { v: 1, ev: ev.id, titulo: ev.titulo, curso: ev.curso || '', alumno: take.alumno, dni: take.dni, ini: new Date(take.t0).toISOString(), fin: now(), min: Math.round((Date.now() - take.t0) / 600) / 100, ans: take.ans, ch: take.ch, total: sc.total, max: sc.max, pct: sc.pct, pend: sc.pend, aprobado: sc.aprobado };
      rec.h = await sha(JSON.stringify([rec.ev, rec.alumno, rec.dni, rec.ans, rec.ch, rec.fin]) + (ev.sal || ''));
      const code = 'OBE1.' + await pack(rec);
      const mis = ls.get(KMIS, []);
      mis.unshift({ fin: rec.fin, titulo: ev.titulo, curso: ev.curso, pct: sc.pct, pend: sc.pend, aprobado: sc.aprobado, mostrar: !!ev.mostrar, code, mail: ev.mail || '', ev: ev.mostrar ? ev : null, rec: ev.mostrar ? rec : null });
      ls.set(KMIS, mis.slice(0, 40));
      ls.del(KTAKE); take = null; open = null;
      done = mis[0];
      if (auto) app.toast('Se terminó el tiempo: la evaluación se entregó sola');
      render();
    }
    function entregaView(m) {
      const ev = m.ev, rec = m.rec;
      let h = `<div class="au-sheet"><button type="button" class="au-lnk" data-au="volver">← Aula</button><div class="g-eyebrow">Entrega · ${fdt(m.fin)}</div><h1 class="au-h1">${esc(m.titulo)}</h1>`;
      if (m.mostrar) h += `<div class="au-score ${m.aprobado ? 'ok' : 'no'}"><b>${fmt(m.pct, 1)} %</b><span>${m.pend ? 'Faltan corregir las respuestas abiertas' : m.aprobado ? 'Aprobado' : 'No aprobado'}</span></div>`;
      h += `<div class="au-rec"><h3 class="au-h3">Comprobante de entrega</h3><p class="au-note">Mandale este código a tu docente (o el archivo). Sin el comprobante, el docente no recibe tu evaluación.</p><textarea readonly rows="4" id="au-rc">${esc(m.code)}</textarea>
        <div class="au-actions"><button type="button" class="x-btn x-btn-hot" data-au="copiar">Copiar código</button><button type="button" class="x-btn" data-au="bajar">Descargar archivo</button>${m.mail ? `<a class="x-btn" href="mailto:${esc(m.mail)}?subject=${encodeURIComponent('Entrega: ' + m.titulo)}&body=${encodeURIComponent(m.code)}">Enviar por mail</a>` : ''}<a class="x-btn" target="_blank" rel="noopener" href="https://wa.me/?text=${encodeURIComponent('Entrega ' + m.titulo + ': ' + m.code)}">WhatsApp</a></div></div>`;
      if (m.mostrar && ev && rec) {
        h += '<h3 class="au-h3">Devolución</h3><ol class="au-qs">';
        for (const q of ev.preg) {
          const r = rec.ans[q.id], g = gradeQ(q, r);
          const rTxt = q.tipo === 'mc' ? (r != null ? q.op[r] : '—') : q.tipo === 'vf' ? (r === 'v' ? 'Verdadero' : r === 'f' ? 'Falso' : '—') : (r || '—');
          const okTxt = q.tipo === 'mc' ? q.op[q.ok] : q.tipo === 'vf' ? (q.ok ? 'Verdadero' : 'Falso') : q.tipo === 'num' ? `${fmt(q.ok.v, 2)} ± ${fmt(q.ok.tol, 2)} ${q.u || ''}` : q.modelo || '';
          h += `<li class="au-q ${g == null ? '' : g > 0 ? 'ok' : 'no'}"><p>${esc(q.texto)}</p><small>Tu respuesta: <b>${esc(rTxt)}</b>${g == null ? ' · la corrige el docente' : ''}</small><small>Respuesta esperada: ${esc(okTxt)}</small>${q.expl ? `<small class="au-expl">${esc(q.expl)}</small>` : ''}</li>`;
        }
        h += '</ol>';
        for (const d of ev.des || []) { const r = rec.ch[d.id]; h += `<div class="au-ch ${r ? 'done' : ''}"><b>${esc(d.titulo)}</b>${r ? `<ul>${r.metas.map((x) => `<li class="${x.ok ? 'ok' : 'no'}">${x.ok ? '✓' : '✗'} ${esc(META_T[x.t][0])}: ${fmt(x.val, 1)} ${esc(META_T[x.t][2])} (objetivo ${fmt(x.obj)})</li>`).join('')}</ul>` : '<p>No realizado</p>'}</div>`; }
      }
      return h + '</div>';
    }
    // ----- docente -----
    function docente() {
      if (LIC() && !LIC().can('docente')) return `<div class="au-sheet"><button type="button" class="au-lnk" data-au="volver">← Aula</button>${LIC().lockHtml('docente', 'Con la licencia institucional armás evaluaciones y das acceso a todos tus alumnos con un link.')}</div>`;
      ensureDb();
      const tabs = [['preguntas', `Preguntas (${db.q.length})`], ['desafios', `Desafíos (${db.d.length})`], ['evaluaciones', `Evaluaciones (${db.e.length})`], ['resultados', `Resultados (${db.r.length})`], ['respaldo', 'Respaldo']];
      let h = `<div class="au-sheet wide"><div class="au-dtop"><button type="button" class="au-lnk" data-au="volver">← Aula</button><h1 class="au-h1">Panel docente</h1>${LIC() && LIC().lic ? `<span class="au-note">${esc(LIC().lic.sub || '')} · ${LIC().alumnos ? 'licencia de alumnos incluida en los links' : 'sin licencia de alumnos'}</span>` : ''}</div><nav class="au-tabs">${tabs.map(([k, t]) => `<button type="button" class="${k === dtab ? 'on' : ''}" data-audt="${k}">${t}</button>`).join('')}</nav>`;
      if (dtab === 'preguntas') h += edit && edit.kind === 'q' ? qForm(edit.obj) : qList();
      if (dtab === 'desafios') h += edit && edit.kind === 'd' ? dForm(edit.obj) : dList();
      if (dtab === 'evaluaciones') h += edit && edit.kind === 'e' ? eForm(edit.obj) : eList();
      if (dtab === 'resultados') h += resultados();
      if (dtab === 'respaldo') h += `<div class="au-box"><p>Todo lo del panel docente se guarda en este navegador. Exportá un respaldo para no perderlo o para pasarlo a otra computadora.</p><div class="au-actions"><button type="button" class="x-btn x-btn-hot" data-au="exp">Exportar respaldo .json</button><label class="x-btn">Importar respaldo<input type="file" id="au-imp" accept=".json,application/json" hidden></label><button type="button" class="x-btn" data-au="seed">Agregar preguntas y desafíos de ejemplo</button></div></div>`;
      return h + '</div>';
    }
    function qList() {
      const temas = [...new Set(db.q.map((q) => q.tema || 'General'))];
      return `<div class="au-actions"><button type="button" class="x-btn x-btn-hot" data-au="qnew">Nueva pregunta</button><span class="au-note">${temas.length} temas: ${temas.map(esc).join(', ')}</span></div><table class="au-t"><tr><th>Tema</th><th>Tipo</th><th>Pregunta</th><th>Pts</th><th></th></tr>${db.q.map((q) => `<tr><td>${esc(q.tema)}</td><td>${TIPO_Q[q.tipo]}</td><td>${esc(q.texto)}</td><td>${q.puntos}</td><td class="au-acts"><button type="button" class="au-lnk" data-auqe="${q.id}">Editar</button><button type="button" class="au-lnk" data-auqc="${q.id}">Duplicar</button><button type="button" class="au-lnk bad" data-auqd="${q.id}">Borrar</button></td></tr>`).join('')}</table>`;
    }
    function qForm(q) {
      const op = q.op || ['', '', '', ''];
      return `<div class="au-box"><h3 class="au-h3">${q._new ? 'Nueva pregunta' : 'Editar pregunta'}</h3>
        <div class="au-grid"><label class="au-f">Tipo <select id="qf-tipo">${Object.entries(TIPO_Q).map(([k, t]) => `<option value="${k}" ${q.tipo === k ? 'selected' : ''}>${t}</option>`).join('')}</select></label><label class="au-f">Tema <input id="qf-tema" value="${esc(q.tema || '')}" list="au-temas"><datalist id="au-temas">${[...new Set(db.q.map((x) => x.tema))].map((t) => `<option value="${esc(t)}">`).join('')}</datalist></label><label class="au-f">Puntos <input id="qf-pts" type="number" min="0" step="0.5" value="${q.puntos}"></label></div>
        <label class="au-f">Enunciado <textarea id="qf-txt" rows="2">${esc(q.texto || '')}</textarea></label>
        ${q.tipo === 'mc' ? `<div class="au-f">Opciones (marcá la correcta)${op.map((o, i) => `<label class="au-op"><input type="radio" name="qf-ok" value="${i}" ${q.ok === i ? 'checked' : ''}><input class="qf-op" value="${esc(o)}" placeholder="Opción ${i + 1}"></label>`).join('')}<button type="button" class="au-lnk" data-au="qop">+ agregar opción</button></div>` : ''}
        ${q.tipo === 'vf' ? `<div class="au-f">Respuesta correcta <label class="au-op"><input type="radio" name="qf-ok" value="v" ${q.ok !== false ? 'checked' : ''}> Verdadero</label><label class="au-op"><input type="radio" name="qf-ok" value="f" ${q.ok === false ? 'checked' : ''}> Falso</label></div>` : ''}
        ${q.tipo === 'num' ? `<div class="au-grid"><label class="au-f">Valor correcto <input id="qf-v" type="number" step="any" value="${q.ok ? q.ok.v : ''}"></label><label class="au-f">Tolerancia ± <input id="qf-tol" type="number" step="any" value="${q.ok ? q.ok.tol : 0}"></label><label class="au-f">Unidad <input id="qf-u" value="${esc(q.u || '')}"></label></div>` : ''}
        ${q.tipo === 'ab' ? `<label class="au-f">Respuesta modelo (guía para corregir) <textarea id="qf-mod" rows="2">${esc(q.modelo || '')}</textarea></label>` : ''}
        <label class="au-f">Explicación para la devolución <textarea id="qf-exp" rows="2">${esc(q.expl || '')}</textarea></label>
        <div class="au-actions"><button type="button" class="x-btn x-btn-hot" data-au="qsave">Guardar</button><button type="button" class="x-btn" data-au="cancel">Cancelar</button></div></div>`;
    }
    function readQ(q) {
      const v = (id) => { const el = document.getElementById(id); return el ? el.value : ''; };
      const o = { id: q.id, tipo: v('qf-tipo') || q.tipo, tema: v('qf-tema').trim() || 'General', texto: v('qf-txt').trim(), puntos: Math.max(0, Number(v('qf-pts')) || 1), expl: v('qf-exp').trim() };
      const okEl = root.querySelector('input[name="qf-ok"]:checked');
      if (o.tipo === 'mc') { o.op = [...root.querySelectorAll('.qf-op')].map((x) => x.value.trim()); o.ok = okEl ? Number(okEl.value) : 0; }
      if (o.tipo === 'vf') o.ok = okEl ? okEl.value === 'v' : true;
      if (o.tipo === 'num') { o.ok = { v: Number(v('qf-v')), tol: Math.abs(Number(v('qf-tol')) || 0) }; o.u = v('qf-u').trim(); }
      if (o.tipo === 'ab') o.modelo = v('qf-mod').trim();
      return o;
    }
    function dList() {
      return `<div class="au-actions"><button type="button" class="x-btn x-btn-hot" data-au="dnew">Nuevo desafío</button><span class="au-note">Un desafío prepara el simulador, programa fallas y mide metas objetivas mientras el alumno opera.</span></div><div class="au-chs">${db.d.map((d) => `<div class="au-ch"><b>${esc(d.titulo)}</b><p>${esc(d.consigna)}</p><small>${d.durH} h sim · ${d.inicio === 'parada' ? 'línea parada' : 'operación normal'} · ${(d.fallas || []).map((f) => esc(faultName(f.k)) + ' min ' + f.min).join(', ') || 'sin fallas'}</small><ul>${d.metas.map((m) => `<li>${esc(META_T[m.t][0])} ${esc(META_T[m.t][1].split(' ')[0])} ${fmt(m.v)} ${esc(META_T[m.t][2])} · ${m.p} pts</li>`).join('')}</ul><div class="au-acts"><button type="button" class="au-lnk" data-aude="${d.id}">Editar</button><button type="button" class="au-lnk" data-audp="${d.id}">Probar en el simulador</button><button type="button" class="au-lnk" data-audc="${d.id}">Duplicar</button><button type="button" class="au-lnk bad" data-audd="${d.id}">Borrar</button></div></div>`).join('')}</div>`;
    }
    function faultName(k) { const F = flt(); const c = F && F.CAT.find((x) => x.k === k); return c ? c.t : k; }
    function locSel(f, i) {
      const F = flt(); const c = F && F.CAT.find((x) => x.k === f.k); const opts = c ? F.locOptions(c.where) : [];
      return `<select data-dfl="${i}:loc"><option value="auto" ${f.loc === 'auto' ? 'selected' : ''}>automática</option><option value="auto2" ${f.loc === 'auto2' ? 'selected' : ''}>automática (intermedia)</option>${opts.map((o) => `<option value="${esc(o[0])}" ${String(f.loc) === String(o[0]) ? 'selected' : ''}>${esc(o[1])}</option>`).join('')}</select>`;
    }
    function dForm(d) {
      const F = flt();
      return `<div class="au-box"><h3 class="au-h3">${d._new ? 'Nuevo desafío' : 'Editar desafío'}</h3>
        <label class="au-f">Título <input id="df-tit" value="${esc(d.titulo)}"></label><label class="au-f">Consigna para el alumno <textarea id="df-con" rows="3">${esc(d.consigna)}</textarea></label>
        <div class="au-grid"><label class="au-f">Estado inicial <select id="df-ini"><option value="normal" ${d.inicio !== 'parada' ? 'selected' : ''}>Operación normal</option><option value="parada" ${d.inicio === 'parada' ? 'selected' : ''}>Línea parada (arranque)</option></select></label><label class="au-f">Duración (horas simuladas) <input id="df-dur" type="number" min="0.5" step="0.5" value="${d.durH}"></label></div>
        <h4>Fallas programadas</h4>${(d.fallas || []).map((f, i) => `<div class="au-row"><select data-dfl="${i}:k">${(F ? F.CAT : []).map((c) => `<option value="${c.k}" ${c.k === f.k ? 'selected' : ''}>${esc(c.g + ' · ' + c.t)}</option>`).join('')}</select>${locSel(f, i)}<label>min <input type="number" min="0" step="1" data-dfl="${i}:min" value="${f.min}"></label><button type="button" class="au-lnk bad" data-audfx="${i}">quitar</button></div>`).join('')}<button type="button" class="au-lnk" data-au="dfadd">+ agregar falla</button>
        <h4>Metas que se miden</h4>${d.metas.map((m, i) => `<div class="au-row"><select data-dmt="${i}:t">${Object.entries(META_T).map(([k, t]) => `<option value="${k}" ${m.t === k ? 'selected' : ''}>${esc(t[0])}</option>`).join('')}</select><label>${esc(META_T[m.t][1])} <input type="number" step="any" data-dmt="${i}:v" value="${m.v}"></label><label>puntos <input type="number" min="0" step="0.5" data-dmt="${i}:p" value="${m.p}"></label><button type="button" class="au-lnk bad" data-audmx="${i}">quitar</button></div>`).join('')}<button type="button" class="au-lnk" data-au="dmadd">+ agregar meta</button>
        <p class="au-note">Los disparos que provoca la propia falla (por ejemplo, el corte de energía en esa estación) no cuentan como evitables. La velocidad se pone en 60× al iniciar.</p>
        <div class="au-actions"><button type="button" class="x-btn x-btn-hot" data-au="dsave">Guardar</button><button type="button" class="x-btn" data-au="cancel">Cancelar</button></div></div>`;
    }
    function syncD() {
      const d = edit.obj, v = (id) => { const el = document.getElementById(id); return el ? el.value : null; };
      if (v('df-tit') != null) { d.titulo = v('df-tit'); d.consigna = v('df-con'); d.inicio = v('df-ini'); d.durH = Math.max(0.25, Number(v('df-dur')) || 2); }
      root.querySelectorAll('[data-dfl]').forEach((el) => { const [i, k] = el.dataset.dfl.split(':'); const f = d.fallas[i]; if (!f) return; f[k] = k === 'min' ? Math.max(0, Number(el.value) || 0) : el.value; });
      root.querySelectorAll('[data-dmt]').forEach((el) => { const [i, k] = el.dataset.dmt.split(':'); const m = d.metas[i]; if (!m) return; m[k] = k === 't' ? el.value : Number(el.value) || 0; });
    }
    function eList() {
      return `<div class="au-actions"><button type="button" class="x-btn x-btn-hot" data-au="enew">Nueva evaluación</button></div>${db.e.length ? `<table class="au-t"><tr><th>Evaluación</th><th>Curso</th><th>Contenido</th><th>Entregas</th><th></th></tr>${db.e.map((e) => `<tr><td><b>${esc(e.titulo)}</b><br><small>${fdt(e.creada)}</small></td><td>${esc(e.curso)}</td><td>${e.preg.length} preg. · ${e.des.length} desaf. · ${e.tiempo ? e.tiempo + ' min' : 'sin límite'} · aprueba ${e.aprob}%</td><td>${db.r.filter((r) => r.ev === e.id).length}</td><td class="au-acts"><button type="button" class="au-lnk" data-aupub="${e.id}">Publicar link</button><button type="button" class="au-lnk" data-auee="${e.id}">Editar</button><button type="button" class="au-lnk" data-aures="${e.id}">Resultados</button><button type="button" class="au-lnk" data-auec="${e.id}">Duplicar</button><button type="button" class="au-lnk bad" data-aued="${e.id}">Borrar</button></td></tr>${pub && pub.id === e.id ? `<tr><td colspan="5">${pubBox(e)}</td></tr>` : ''}`).join('')}</table>` : '<p class="au-note">Todavía no hay evaluaciones. Creá una eligiendo preguntas del banco y desafíos.</p>'}`;
    }
    function pubBox(e) {
      if (!pub.link) return '<p class="au-note">Generando link…</p>';
      return `<div class="au-pub"><p>Link para los alumnos${LIC() && LIC().alumnos ? ' (incluye la licencia de alumno de tu institución)' : ''}. Cada alumno lo abre, rinde y te devuelve un comprobante que importás en Resultados.</p><textarea readonly rows="3" id="au-link">${esc(pub.link)}</textarea><div class="au-actions"><button type="button" class="x-btn x-btn-hot" data-au="lcopy">Copiar link</button><a class="x-btn" target="_blank" rel="noopener" href="https://wa.me/?text=${encodeURIComponent(e.titulo + ': ' + pub.link)}">Compartir por WhatsApp</a><a class="x-btn" href="mailto:?subject=${encodeURIComponent('Evaluación: ' + e.titulo)}&body=${encodeURIComponent(pub.link)}">Mail</a></div><small class="au-note">${fmt(pub.link.length)} caracteres. Si cambiás preguntas o desafíos, volvé a publicar y mandá el link nuevo.</small></div>`;
    }
    function eForm(e) {
      const byT = {};
      db.q.forEach((q) => (byT[q.tema || 'General'] = byT[q.tema || 'General'] || []).push(q));
      return `<div class="au-box"><h3 class="au-h3">${e._new ? 'Nueva evaluación' : 'Editar evaluación'}</h3>
        <div class="au-grid"><label class="au-f">Título <input id="ef-tit" value="${esc(e.titulo)}"></label><label class="au-f">Curso o comisión <input id="ef-cur" value="${esc(e.curso)}"></label></div>
        <label class="au-f">Instrucciones <textarea id="ef-ins" rows="2">${esc(e.instr || '')}</textarea></label>
        <div class="au-grid"><label class="au-f">Tiempo (min, 0 = sin límite) <input id="ef-tie" type="number" min="0" value="${e.tiempo}"></label><label class="au-f">Aprobación (%) <input id="ef-apr" type="number" min="0" max="100" value="${e.aprob}"></label><label class="au-f">Mail del docente (opcional) <input id="ef-mail" type="email" value="${esc(e.mail || '')}"></label></div>
        <label class="au-chk"><input type="checkbox" id="ef-mez" ${e.mezclar ? 'checked' : ''}> Mezclar el orden de las preguntas</label><label class="au-chk"><input type="checkbox" id="ef-mos" ${e.mostrar ? 'checked' : ''}> Mostrar nota y respuestas correctas al entregar</label>
        <h4>Preguntas <button type="button" class="au-lnk" data-au="eall">todas</button> <button type="button" class="au-lnk" data-au="enone">ninguna</button></h4>${Object.entries(byT).map(([t, qs]) => `<fieldset class="au-fs"><legend>${esc(t)}</legend>${qs.map((q) => `<label class="au-chk"><input type="checkbox" class="ef-q" value="${q.id}" ${e.preg.includes(q.id) ? 'checked' : ''}> ${esc(q.texto)} <i>${q.puntos} pt</i></label>`).join('')}</fieldset>`).join('')}
        <h4>Desafíos en el simulador</h4>${db.d.map((d) => `<label class="au-chk"><input type="checkbox" class="ef-d" value="${d.id}" ${e.des.includes(d.id) ? 'checked' : ''}> ${esc(d.titulo)} <i>${d.durH} h sim · ${d.metas.reduce((a, m) => a + m.p, 0)} pts</i></label>`).join('')}
        <div class="au-actions"><button type="button" class="x-btn x-btn-hot" data-au="esave">Guardar</button><button type="button" class="x-btn" data-au="cancel">Cancelar</button></div></div>`;
    }
    function readE(e) {
      const v = (id) => document.getElementById(id).value;
      return Object.assign(e, { titulo: v('ef-tit').trim() || 'Evaluación', curso: v('ef-cur').trim(), instr: v('ef-ins').trim(), tiempo: Math.max(0, Number(v('ef-tie')) || 0), aprob: Math.min(100, Math.max(0, Number(v('ef-apr')) || 60)), mail: v('ef-mail').trim(), mezclar: document.getElementById('ef-mez').checked, mostrar: document.getElementById('ef-mos').checked, preg: [...root.querySelectorAll('.ef-q:checked')].map((x) => x.value), des: [...root.querySelectorAll('.ef-d:checked')].map((x) => x.value) });
    }
    function evPayload(e) {
      const L = LIC();
      return { v: 1, id: e.id, sal: e.sal, titulo: e.titulo, curso: e.curso, inst: L && L.lic ? L.lic.sub || '' : '', instr: e.instr, tiempo: e.tiempo, aprob: e.aprob, mezclar: e.mezclar, mostrar: e.mostrar, mail: e.mail, preg: e.preg.map((id) => db.q.find((q) => q.id === id)).filter(Boolean), des: e.des.map((id) => db.d.find((d) => d.id === id)).filter(Boolean), lic: L && L.alumnos ? L.alumnos : undefined };
    }
    function evFull(id) { const e = db.e.find((x) => x.id === id); return e ? (e.snap || evPayload(e)) : null; }
    // ----- resultados -----
    function resultados() {
      if (!resEv && db.e.length) resEv = db.e[0].id;
      const e = db.e.find((x) => x.id === resEv);
      let h = `<div class="au-box"><div class="au-grid"><label class="au-f">Evaluación <select id="rs-ev">${db.e.map((x) => `<option value="${x.id}" ${x.id === resEv ? 'selected' : ''}>${esc(x.titulo)} · ${esc(x.curso)}</option>`).join('')}</select></label></div>
        <label class="au-f">Importar entregas: pegá uno o varios códigos (uno por línea) <textarea id="rs-in" rows="3" placeholder="OBE1.z…"></textarea></label><div class="au-actions"><button type="button" class="x-btn x-btn-hot" data-au="rimp">Importar</button><label class="x-btn">Importar archivos<input type="file" id="rs-files" accept=".json,.txt" multiple hidden></label>${e ? '<button type="button" class="x-btn" data-au="rxls">Exportar a Excel</button>' : ''}</div>${msg ? `<p class="au-note">${esc(msg)}</p>` : ''}</div>`;
      if (!e) return h + '<p class="au-note">Creá una evaluación primero.</p>';
      const ev = evFull(e.id);
      const rows = db.r.filter((r) => r.ev === e.id);
      if (!rows.length) return h + '<p class="au-note">Todavía no importaste entregas de esta evaluación.</p>';
      const sc = rows.map((r) => ({ r, s: scoreTake(ev, r.ans, r.ch, r.manual) }));
      const prom = sc.reduce((a, x) => a + x.s.pct, 0) / sc.length, apr = sc.filter((x) => x.s.aprobado).length;
      h += `<div class="au-kpis"><span>Entregas <b>${rows.length}</b></span><span>Promedio <b>${fmt(prom, 1)} %</b></span><span>Aprobados <b>${apr} de ${rows.length}</b></span></div>`;
      // por tema
      const tem = {};
      for (const { s } of sc) for (const x of s.preg) { const q = ev.preg.find((y) => y.id === x.id); if (!q || x.pts == null) continue; const t = tem[q.tema] || (tem[q.tema] = { a: 0, m: 0 }); t.a += x.pts; t.m += x.max; }
      for (const { s } of sc) for (const x of s.des) { const t = tem['Desafíos en el simulador'] || (tem['Desafíos en el simulador'] = { a: 0, m: 0 }); t.a += x.pts; t.m += x.max; }
      h += `<h3 class="au-h3">Logro por tema (competencias)</h3><div class="au-bars">${Object.entries(tem).map(([t, v]) => { const p = v.m ? 100 * v.a / v.m : 0; return `<div class="au-bar-r"><span>${esc(t)}</span><i><b style="width:${p.toFixed(0)}%" class="${p >= (ev.aprob || 60) ? 'ok' : 'no'}"></b></i><em>${fmt(p, 0)} %</em></div>`; }).join('')}</div>`;
      h += `<h3 class="au-h3">Alumnos</h3><table class="au-t"><tr><th>Alumno</th><th>DNI / legajo</th><th>Entrega</th><th>Min</th><th>Puntaje</th><th>%</th><th>Estado</th><th>Sello</th><th></th></tr>${sc.map(({ r, s }) => `<tr class="${resDet === r.key ? 'sel' : ''}"><td>${esc(r.alumno)}</td><td>${esc(r.dni)}</td><td>${fdt(r.fin)}</td><td>${fmt(r.min, 0)}</td><td>${fmt(s.total, 1)} / ${fmt(s.max, 1)}</td><td><b>${fmt(s.pct, 1)}</b></td><td>${s.pend ? 'corregir abiertas' : s.aprobado ? '<span class="au-ok">aprobado</span>' : '<span class="au-bad">no aprobado</span>'}</td><td>${r.ok ? '✓' : '<span class="au-bad" title="El código fue modificado o es de otra versión de la evaluación">✗</span>'}</td><td class="au-acts"><button type="button" class="au-lnk" data-aurd="${r.key}">Detalle</button><button type="button" class="au-lnk bad" data-aurx="${r.key}">Quitar</button></td></tr>${resDet === r.key ? `<tr><td colspan="9">${detalle(ev, r, s)}</td></tr>` : ''}`).join('')}</table>`;
      return h;
    }
    function detalle(ev, r, s) {
      let h = '<div class="au-det"><ol class="au-qs">';
      for (const x of s.preg) {
        const q = ev.preg.find((y) => y.id === x.id); if (!q) continue;
        const a = x.r;
        const aT = q.tipo === 'mc' ? (a != null && a !== '' ? q.op[a] : '—') : q.tipo === 'vf' ? (a === 'v' ? 'Verdadero' : a === 'f' ? 'Falso' : '—') : (a || '—');
        h += `<li class="au-q ${x.pts == null ? '' : x.pts > 0 ? 'ok' : 'no'}"><p>${esc(q.texto)}</p><small>Respuesta: <b>${esc(aT)}</b></small>${q.tipo === 'ab' ? `<small>Modelo: ${esc(q.modelo || '')}</small><label class="au-op">Puntos <input type="number" min="0" max="${q.puntos}" step="0.5" data-aumn="${r.key}:${q.id}" value="${r.manual && r.manual[q.id] != null ? r.manual[q.id] : ''}"> de ${q.puntos}</label>` : `<small>${fmt(x.pts, 1)} de ${q.puntos}</small>`}</li>`;
      }
      h += '</ol>';
      for (const d of s.des) h += `<div class="au-ch ${d.sin ? '' : 'done'}"><b>${esc(d.titulo)}</b> · ${d.sin ? 'no realizado' : `${fmt(d.pts, 1)} de ${fmt(d.max, 1)} pts · ${fmt(d.kpi && d.kpi.m3)} m³ en ${fmt(d.kpi && d.kpi.h, 2)} h`}${d.metas.length ? `<ul>${d.metas.map((m) => `<li class="${m.ok ? 'ok' : 'no'}">${m.ok ? '✓' : '✗'} ${esc(META_T[m.t][0])}: ${fmt(m.val, 1)} ${esc(META_T[m.t][2])} (objetivo ${fmt(m.obj)})</li>`).join('')}</ul>` : ''}</div>`;
      return h + '</div>';
    }
    async function importCodes(texts) {
      let ok = 0, bad = 0, dup = 0;
      for (const t of texts) {
        const codes = String(t).match(/OBE1\.[zj][A-Za-z0-9_-]+/g) || [];
        for (const c of codes) {
          try {
            const r = await unpack(c.slice(5));
            const e = db.e.find((x) => x.id === r.ev);
            if (!e) { bad++; continue; }
            r.key = await sha(c);
            if (db.r.some((x) => x.key === r.key)) { dup++; continue; }
            r.ok = (await sha(JSON.stringify([r.ev, r.alumno, r.dni, r.ans, r.ch, r.fin]) + (e.sal || ''))) === r.h;
            db.r.push(r); ok++; resEv = e.id;
          } catch (err) { bad++; }
        }
      }
      save();
      msg = `Importadas ${ok}${dup ? ` · ${dup} repetidas` : ''}${bad ? ` · ${bad} no válidas o de otra evaluación` : ''}`;
      render();
    }
    function excel() {
      const e = db.e.find((x) => x.id === resEv); if (!e) return;
      const ev = evFull(e.id);
      const rows = db.r.filter((r) => r.ev === e.id);
      const cell = (v) => { const s = v == null ? '' : typeof v === 'number' ? String(v).replace('.', ',') : String(v); return /[;"\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
      const head = ['Alumno', 'DNI/legajo', 'Curso', 'Entrega', 'Minutos', 'Puntaje', 'Máximo', '%', 'Estado', 'Sello'].concat(ev.preg.map((q, i) => `P${i + 1} ${q.tema}`), ev.des.map((d) => 'D: ' + d.titulo));
      const lines = [head.map(cell).join(';')];
      for (const r of rows) {
        const s = scoreTake(ev, r.ans, r.ch, r.manual);
        lines.push([r.alumno, r.dni, r.curso, fdt(r.fin), r.min, s.total, s.max, s.pct, s.pend ? 'corregir abiertas' : s.aprobado ? 'aprobado' : 'no aprobado', r.ok ? 'ok' : 'modificado'].concat(s.preg.map((x) => (x.pts == null ? '' : x.pts)), s.des.map((x) => x.pts)).map(cell).join(';'));
      }
      lines.push('');
      lines.push(['Pregunta', 'Tema', 'Tipo', 'Puntos', 'Enunciado'].map(cell).join(';'));
      ev.preg.forEach((q, i) => lines.push([`P${i + 1}`, q.tema, TIPO_Q[q.tipo], q.puntos, q.texto].map(cell).join(';')));
      download(`resultados-${e.titulo.replace(/[^\wáéíóúñ -]/gi, '').trim().replace(/\s+/g, '-')}.csv`, '﻿' + lines.join('\r\n'), 'text/csv;charset=utf-8');
    }
    function download(name, text, type) {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([text], { type: type || 'application/json' }));
      a.download = name; document.body.appendChild(a); a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
    }
    async function copy(id) { const el = document.getElementById(id); if (!el) return; try { await navigator.clipboard.writeText(el.value); app.toast('Copiado'); } catch (e) { el.select(); document.execCommand('copy'); app.toast('Copiado'); } }

    // ---------- render y eventos ----------
    function render() {
      if (!root) return;
      root.innerHTML = mode === 'docente' ? docente() : mode === 'alumno' ? alumno() : inicio();
    }
    root.addEventListener('click', async (e) => {
      const t = e.target.closest('[data-au],[data-auch],[data-aumis],[data-audt],[data-auqe],[data-auqc],[data-auqd],[data-aude],[data-audp],[data-audc],[data-audd],[data-audfx],[data-audmx],[data-aupub],[data-auee],[data-aures],[data-auec],[data-aued],[data-aurd],[data-aurx]');
      if (!t) return;
      const d = t.dataset, a = d.au;
      if (a === 'abrir') { await loadEvalCode(document.getElementById('au-code').value); return; }
      if (a === 'seguir') { open = take.ev; mode = 'alumno'; render(); return; }
      if (a === 'volver') { mode = 'inicio'; done = null; edit = null; msg = ''; if (!take) open = null; render(); return; }
      if (a === 'docente') { if (LIC() && !LIC().can('docente')) { LIC().openPlans(); } mode = 'docente'; render(); return; }
      if (a === 'comenzar') {
        const nom = document.getElementById('au-nom').value.trim();
        if (nom.length < 3) { app.toast('Escribí tu nombre y apellido'); document.getElementById('au-nom').focus(); return; }
        const orden = open.preg.map((q) => q.id);
        if (open.mezclar) for (let i = orden.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [orden[i], orden[j]] = [orden[j], orden[i]]; }
        take = { ev: open, alumno: nom, dni: document.getElementById('au-dni').value.trim(), t0: Date.now(), ans: {}, ch: {}, orden };
        ls.set(KTAKE, take); render(); return;
      }
      if (a === 'entregar') { await entregar(false); return; }
      if (a === 'copiar') { copy('au-rc'); return; }
      if (a === 'bajar') { const m = done; download(`entrega-${(m.titulo || 'evaluacion').replace(/\s+/g, '-')}.json`, JSON.stringify({ comprobante: m.code }), 'application/json'); return; }
      if (d.aumis != null) { done = ls.get(KMIS, [])[Number(d.aumis)]; mode = 'alumno'; render(); return; }
      if (d.auch) { const dd = take.ev.des.find((x) => x.id === d.auch); if (dd) startChallenge(dd, false); return; }
      // docente
      if (d.audt) { dtab = d.audt; edit = null; pub = null; msg = ''; render(); return; }
      if (a === 'cancel') { edit = null; render(); return; }
      if (a === 'qnew') { edit = { kind: 'q', obj: { _new: true, id: uid(), tipo: 'mc', tema: '', texto: '', puntos: 1, op: ['', '', '', ''], ok: 0 } }; render(); return; }
      if (d.auqe) { edit = { kind: 'q', obj: JSON.parse(JSON.stringify(db.q.find((q) => q.id === d.auqe))) }; render(); return; }
      if (d.auqc) { const q = JSON.parse(JSON.stringify(db.q.find((x) => x.id === d.auqc))); q.id = uid(); q.texto += ' (copia)'; db.q.push(q); save(); render(); return; }
      if (d.auqd) { if (!confirm('¿Borrar la pregunta?')) return; db.q = db.q.filter((q) => q.id !== d.auqd); save(); render(); return; }
      if (a === 'qop') { const o = readQ(edit.obj); o.op.push(''); edit.obj = Object.assign(o, { _new: edit.obj._new }); render(); return; }
      if (a === 'qsave') {
        const o = readQ(edit.obj);
        if (!o.texto) { app.toast('Falta el enunciado'); return; }
        if (o.tipo === 'mc') { const ok = o.op[o.ok]; o.op = o.op.filter((x) => x); o.ok = Math.max(0, o.op.indexOf(ok)); if (o.op.length < 2) { app.toast('Poné al menos dos opciones'); return; } }
        const i = db.q.findIndex((q) => q.id === o.id); if (i >= 0) db.q[i] = o; else db.q.push(o);
        save(); edit = null; render(); return;
      }
      if (a === 'dnew') { edit = { kind: 'd', obj: { _new: true, id: uid(), titulo: 'Nuevo desafío', consigna: '', inicio: 'normal', durH: 2, fallas: [], metas: [{ t: 'disparos', v: 0, p: 5 }, { t: 'ack', v: 60, p: 5 }] } }; render(); return; }
      if (d.aude) { edit = { kind: 'd', obj: JSON.parse(JSON.stringify(db.d.find((x) => x.id === d.aude))) }; render(); return; }
      if (d.audp) { const dd = db.d.find((x) => x.id === d.audp); if (dd) startChallenge(dd, true); return; }
      if (d.audc) { const x = JSON.parse(JSON.stringify(db.d.find((y) => y.id === d.audc))); x.id = uid(); x.titulo += ' (copia)'; db.d.push(x); save(); render(); return; }
      if (d.audd) { if (!confirm('¿Borrar el desafío?')) return; db.d = db.d.filter((x) => x.id !== d.audd); save(); render(); return; }
      if (a === 'dfadd') { syncD(); edit.obj.fallas.push({ k: 'corte', loc: 'auto', min: 10 }); render(); return; }
      if (a === 'dmadd') { syncD(); edit.obj.metas.push({ t: 'volumen', v: 70, p: 2 }); render(); return; }
      if (d.audfx != null) { syncD(); edit.obj.fallas.splice(Number(d.audfx), 1); render(); return; }
      if (d.audmx != null) { syncD(); edit.obj.metas.splice(Number(d.audmx), 1); render(); return; }
      if (a === 'dsave') { syncD(); const o = edit.obj; delete o._new; if (!o.metas.length) { app.toast('Agregá al menos una meta'); return; } const i = db.d.findIndex((x) => x.id === o.id); if (i >= 0) db.d[i] = o; else db.d.push(o); save(); edit = null; render(); return; }
      if (a === 'enew') { edit = { kind: 'e', obj: { _new: true, id: uid(), sal: uid(), titulo: '', curso: '', instr: 'Respondé las preguntas y realizá los desafíos en el simulador. Al final entregá y mandá el comprobante.', tiempo: 60, aprob: 60, mezclar: true, mostrar: true, mail: '', preg: db.q.map((q) => q.id), des: db.d.slice(0, 1).map((x) => x.id), creada: now() } }; render(); return; }
      if (d.auee) { edit = { kind: 'e', obj: JSON.parse(JSON.stringify(db.e.find((x) => x.id === d.auee))) }; render(); return; }
      if (d.auec) { const x = JSON.parse(JSON.stringify(db.e.find((y) => y.id === d.auec))); x.id = uid(); x.sal = uid(); x.titulo += ' (copia)'; x.creada = now(); delete x.snap; db.e.push(x); save(); render(); return; }
      if (d.aued) { if (!confirm('¿Borrar la evaluación y sus entregas importadas?')) return; db.e = db.e.filter((x) => x.id !== d.aued); db.r = db.r.filter((r) => r.ev !== d.aued); save(); render(); return; }
      if (a === 'eall' || a === 'enone') { root.querySelectorAll('.ef-q').forEach((x) => { x.checked = a === 'eall'; }); return; }
      if (a === 'esave') { const o = readE(edit.obj); if (!o.preg.length && !o.des.length) { app.toast('Elegí al menos una pregunta o un desafío'); return; } delete o._new; delete o.snap; const i = db.e.findIndex((x) => x.id === o.id); if (i >= 0) db.e[i] = o; else db.e.push(o); save(); edit = null; render(); return; }
      if (d.aupub) {
        const e2 = db.e.find((x) => x.id === d.aupub);
        e2.snap = evPayload(e2); save();
        pub = { id: e2.id, link: null }; render();
        const base = META.custom ? 'https://rjrm84.github.io/oleoducto-beta/' : location.origin + location.pathname;
        pub.link = base + '#eval=' + await pack(e2.snap); render(); return;
      }
      if (a === 'lcopy') { copy('au-link'); return; }
      if (d.aures) { resEv = d.aures; dtab = 'resultados'; render(); return; }
      if (a === 'rimp') { await importCodes([document.getElementById('rs-in').value]); return; }
      if (a === 'rxls') { excel(); return; }
      if (d.aurd) { resDet = resDet === d.aurd ? null : d.aurd; render(); return; }
      if (d.aurx) { if (!confirm('¿Quitar esta entrega?')) return; db.r = db.r.filter((r) => r.key !== d.aurx); save(); render(); return; }
      if (a === 'exp') { download('aula-oleoducto-beta.json', JSON.stringify(db, null, 1)); return; }
      if (a === 'seed') { db.q = db.q.concat(seedQuestions()); db.d = db.d.concat(seedChallenges()); save(); app.toast('Ejemplos agregados'); render(); }
    });
    root.addEventListener('change', async (e) => {
      const t = e.target;
      if (t.dataset.auq && take) { take.ans[t.dataset.auq] = t.value; ls.set(KTAKE, take); return; }
      if (t.id === 'qf-tipo' && edit) { const o = readQ(edit.obj); o.tipo = t.value; if (o.tipo === 'mc' && !o.op) { o.op = ['', '', '', '']; o.ok = 0; } if (o.tipo === 'vf') o.ok = true; if (o.tipo === 'num') o.ok = { v: 0, tol: 0 }; edit.obj = Object.assign(o, { _new: edit.obj._new }); render(); return; }
      if (t.dataset.dfl && t.dataset.dfl.endsWith(':k')) { syncD(); edit.obj.fallas[Number(t.dataset.dfl)].loc = 'auto'; render(); return; }
      if (t.dataset.dmt && t.dataset.dmt.endsWith(':t')) { syncD(); render(); return; }
      if (t.id === 'rs-ev') { resEv = t.value; resDet = null; msg = ''; render(); return; }
      if (t.dataset.aumn) { const [k, qid] = t.dataset.aumn.split(':'); const r = db.r.find((x) => x.key === k); if (r) { r.manual = r.manual || {}; if (t.value === '') delete r.manual[qid]; else r.manual[qid] = Math.max(0, Number(t.value) || 0); save(); render(); } return; }
      if (t.id === 'rs-files' && t.files.length) { const texts = await Promise.all([...t.files].map((f) => f.text())); await importCodes(texts); return; }
      if (t.id === 'au-imp' && t.files.length) {
        try { const x = JSON.parse(await t.files[0].text()); if (!x || !Array.isArray(x.q)) throw new Error('x'); ensureDb(); const ids = (arr, cur) => arr.filter((o) => !cur.some((c) => c.id === o.id)); db.q = db.q.concat(ids(x.q, db.q)); db.d = db.d.concat(ids(x.d || [], db.d)); db.e = db.e.concat(ids(x.e || [], db.e)); db.r = db.r.concat((x.r || []).filter((o) => !db.r.some((c) => c.key === o.key))); save(); app.toast('Respaldo importado'); render(); } catch (err) { app.toast('El archivo no es un respaldo del aula'); }
      }
    });
    root.addEventListener('input', (e) => { const t = e.target; if (t.dataset.auq && take && (t.tagName === 'TEXTAREA' || t.type === 'text')) { take.ans[t.dataset.auq] = t.value; ls.set(KTAKE, take); } });
    if (LIC() && LIC().on) LIC().on(() => { if (mode === 'docente' || mode === 'inicio') render(); });

    let acc = 0;
    function update(dt) {
      if (run) { measure(); acc += dt; if (acc > 0.5) { acc = 0; paintHud(); } }
      if (take && take.ev.tiempo && !run) {
        const left = take.ev.tiempo - (Date.now() - take.t0) / 60000;
        const el = document.getElementById('au-timer');
        if (el) el.textContent = `${Math.max(0, Math.floor(left))}:${String(Math.max(0, Math.floor((left % 1) * 60))).padStart(2, '0')}`;
        if (left <= 0 && !update.busy) { update.busy = true; entregar(true).finally(() => { update.busy = false; }); }
      }
    }
    if (take && !pendingHash) { open = take.ev; mode = 'alumno'; }
    render();
    return { update, render, get run() { return run; }, startChallenge, finishChallenge, get db() { return db; }, loadEvalCode, kpis: () => (run ? kpis() : null) };
  }
  global.createAula = createAula;
})(window);
