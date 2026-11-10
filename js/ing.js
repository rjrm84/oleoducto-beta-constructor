/* Ingeniería v5: pantallas estilo SCADA de operación, P&ID por estación,
   medición con calibración por prover y eventos/fallas con rearme. */
(function (global) {
  'use strict';

  const ST_B = ['ph', 'ac', 'cd', 'mg', 'sos', 'pa', 'rt', 'ug', 'lc'];
  const METER_ST_B = ['ph', 'ac', 'cd', 'mg', 'sos', 'rt', 'ug', 'lc'];
  const TAGN_B = { ph: 100, ac: 200, cd: 300, mg: 400, sos: 1100, pa: 5800, rt: 700, ug: 600, lc: 1200 };
  const NAME_B = { ph: 'PUESTO HERNÁNDEZ', ac: 'AGUAS DEL CARRIZO', cd: 'CERRO DIVISADERO', mg: 'MALARGÜE', sos: 'EL SOSNEADO', pa: 'PAREDITAS', rt: 'RÍO TUNUYÁN', ug: 'UGARTECHE', lc: 'LUJÁN DE CUYO' };
  const fmt = (v, d) => (v == null || !isFinite(v) ? '—' : Number(v).toFixed(d == null ? 1 : d));
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  function gauss() { let u = 0, v = 0; while (!u) u = Math.random(); while (!v) v = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }

  function createIng(app) {
    const sim = app.sim;
    const S = () => sim.state;
    const $ = (id) => document.getElementById(id);
    const root = $('ing-main');
    // v8: estaciones, tags y nombres desde la configuración (ductos a medida)
    const META = sim.state.config._meta || {};
    const CUST = !!META.custom;
    const SORTED = sim.sortedStations().slice().sort((a, b) => (a.pkKm || 0) - (b.pkKm || 0));
    const ST = CUST ? SORTED.map((x) => x.id) : ST_B;
    const METER_ST = CUST ? SORTED.filter((x) => x.meters && (x.meters.usm || 0) + (x.meters.pd || 0) > 0).map((x) => x.id) : METER_ST_B;
    const TAGN = CUST ? Object.fromEntries(SORTED.map((x, i) => [x.id, x.tagBase || (i + 1) * 100])) : TAGN_B;
    const NAME = CUST ? Object.fromEntries(SORTED.map((x) => [x.id, String(x.name).toUpperCase()])) : NAME_B;
    const HEAD = sim.stationById('ph'), TERM = sim.stationById('lc');
    const HN = (HEAD && HEAD.shortName) || 'PH', TN = (TERM && TERM.shortName) || 'LC';
    const QMAX = META.maxLineFlowM3h || 750;
    const MAOP = META.maopKgCm2 || 90, OPMAX = META.opMaxKgCm2 || 80;
    const QDEF = META.defaultPhCabeceraM3h || 680;
    let sub = 'principal';
    let stSel = 'ph';
    let pending = null;
    let pendingPerm = null;
    const tag = (id, kind, n) => `${(sim.stationById(id).shortName || id).toUpperCase()}_${kind}_${TAGN[id] + (n || 1)}`;

    // ---------------- medición ----------------
    const meters = {};
    METER_ST.forEach((id) => {
      const base = TAGN[id];
      const mk = (suffix, type, kf) => {
        const bias = type === 'PD' ? 0.0012 + gauss() * 0.0008 : gauss() * 0.0009;
        const mf = 1 / (1 + bias + gauss() * 0.0003); // última calibración cercana
        return {
          id: `${(sim.stationById(id).shortName || id).toUpperCase()}_FT_${base + 1}${suffix}`,
          st: id, type, kf, bias, mf,
          drift: type === 'PD' ? 0.0006 + Math.random() * 0.0005 : (Math.random() - 0.5) * 0.0004, // por día simulado
          cum: 0, last: { when: 'calibración anterior', mf, rep: type === 'PD' ? 0.012 : 0.031 },
          duty: suffix === 'A',
        };
      };
      if (CUST) {
        const mm = (sim.stationById(id) || {}).meters || {};
        const list = [];
        for (let k = 0; k < Math.min(4, mm.usm || 0); k++) list.push(mk(String.fromCharCode(65 + k), 'USM', 9000));
        for (let k = 0; k < Math.min(2, mm.pd || 0); k++) list.push(mk(k ? 'Q' : 'P', 'PD', 8400));
        if (!list.length) list.push(mk('A', 'USM', 9000));
        if (list.length === 1) list[0].duty = true;
        meters[id] = list;
      } else meters[id] = [mk('A', 'USM', 9000), mk('B', 'USM', 9000), mk('P', 'PD', 8400)];
    });
    const trueQ = (id) => (id === 'pa' ? 0 : S().segmentFlows[id] || 0);
    const qInd = (m) => trueQ(m.st) * (1 + m.bias) * m.mf; // caudal indicado y corregido por MF
    const devPct = (m) => ((1 + m.bias) * m.mf - 1) * 100; // error residual frente a la verdad
    function meterAlarm(id) {
      const ms = meters[id];
      const a = ms[0];
      const b = ms.find((m, k) => k > 0 && m.type === 'USM') || a;
      const p = ms.find((m) => m.type === 'PD') || b;
      const ab = Math.abs(qInd(a) - qInd(b)) / Math.max(1, qInd(a)) * 100;
      const ap = Math.abs(qInd(a) - qInd(p)) / Math.max(1, qInd(a)) * 100;
      return { ab, ap, warn: ab > 0.15 || ap > 0.25 };
    }

    // ---------------- eventos ----------------
    const ev = { elec: {}, filter: {}, n2: {}, esd: {}, comm: {}, log: [] };
    function evLog(t) {
      const d = S().simDate;
      ev.log.unshift(`${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')} · ${t}`);
      ev.log.length = Math.min(ev.log.length, 40);
      sim.logEvent(t, 'scenario');
    }
    function tripStation(id, cause) {
      sim.failStation(id);
      ev.elec[id] = Object.assign(ev.elec[id] || {}, { cause, tTrip: S().timeSec, ready: false });
    }
    const RAMP = META.rampFlowM3hPerMin || 15;
    const dispQ = () => (S().dispatchQ != null ? S().dispatchQ : QDEF);
    // arranque después de una parada: se baja el caudal a un valor de arranque y se sube en rampa hasta el despacho
    function startRamp(why) {
      const s = S(), disp = dispQ();
      const q0 = Math.max(150, Math.min(disp, (s.lineFlow || 0) > 50 ? s.lineFlow : disp * 0.4));
      if (s.globalFlowSetpoint > q0) s.globalFlowSetpoint = q0;
      if (s.flowTarget === disp && s._rampWhy) return;
      s._rampWhy = why;
      sim.rampFlowTo(disp);
      evLog(`Arranque en rampa por ${why}: ${fmt(Math.min(q0, s.globalFlowSetpoint), 0)} → ${fmt(disp, 0)} m³/h (despacho) a ${RAMP} m³/h por minuto`);
    }
    function rearm(id) {
      if (equip) {
        const bad = equip.stationPermissives(id).filter((x) => !x[1]);
        if (bad.length) { app.toast(`No se puede rearmar ${sim.stationById(id).shortName}: falta ${bad.map((x) => x[0].toLowerCase()).join(', ')}`); evLog(`Rearme rechazado en ${sim.stationById(id).shortName}: permisivos no cumplidos`); return false; }
      }
      sim.clearStationFail(id);
      const st = sim.stationById(id);
      if (st && st.pumps) for (const p of st.pumps) if (p.reserve) p.online = false;
      delete ev.elec[id]; delete ev.esd[id];
      if (!Object.keys(S().failedStations).length && !S().phFailed) startRamp(`rearme de ${st.shortName}`);
      evLog(`Rearme de ${st.shortName}: bombas en marcha`);
    }
    const EVENTS = CUST ? customEvents() : [
      { g: 'Eléctricas', k: 'pert-sur', t: 'Perturbación eléctrica · zona sur', d: 'Hueco de tensión en la red: disparan los variadores de PH y AC. Requiere rearme cuando la tensión se normaliza.', run: () => { ['ph', 'ac'].forEach((i) => tripStation(i, 'Perturbación eléctrica')); evLog('Perturbación eléctrica zona sur · PH y AC fuera de servicio'); } },
      { g: 'Eléctricas', k: 'pert-ml', t: 'Perturbación eléctrica · Malargüe–El Sosneado', d: 'Caída de la línea de media tensión: salen ML y ES a la vez. Aguas abajo RT pierde aspiración.', run: () => { ['mg', 'sos'].forEach((i) => tripStation(i, 'Perturbación eléctrica')); evLog('Perturbación eléctrica ML–ES · dos EB fuera'); } },
      { g: 'Eléctricas', k: 'sub-cd', t: 'Falla de subestación en CD', d: 'Sin energía en Cerro Divisadero: las turbobombas paran y el crudo no pasa el peak de 1.985 m.', run: () => { tripStation('cd', 'Falla subestación'); evLog('Falla subestación CD'); } },
      { g: 'Eléctricas', k: 'sag-rt', t: 'Microcorte en Río Tunuyán', d: 'Disparo del variador de B-701B. Rearme rápido posible.', run: () => { tripStation('rt', 'Microcorte'); evLog('Microcorte RT · B-701B disparada'); } },
      { g: 'Cabecera', k: 'ph-cd', t: 'Falla PH · CD toma la cabecera (2 h)', d: 'PH sale de servicio. CD bombea desde su tanque como cabecera temporal durante unas 2 horas, con caudal reducido. Hay que reponer PH antes de que se agote la autonomía.', run: () => { sim.failStation('ph'); ev.elec.ph = { cause: 'Falla cabecera', tTrip: S().timeSec, ready: false }; evLog('Falla PH · CD cabecera temporal (autonomía 2 h)'); } },
      { g: 'Mecánicas', k: 'filtro', t: 'Filtro tapado en AC', d: 'Sube la presión diferencial del filtro de entrada: cae la aspiración de las bombas.', run: () => { ev.filter.ac = 1.8; if (equip) equip.clog('ac'); evLog('Alta presión diferencial filtro AC'); } },
      { g: 'Mecánicas', k: 'bomba', t: 'Disparo de bomba en ES (vibración)', d: 'B-1101E sale por alta vibración. Hay que arrancar la reserva B-1101F desde el P&ID.', run: () => { sim.setPump('sos', 'sos-1101e', false); evLog('Disparo B-1101E por vibración'); } },
      { g: 'Mecánicas', k: 'n2', t: 'Baja presión de nitrógeno en PH', d: 'Alarma de baja presión de N2 en el tubo de sellos. Aviso sin disparo.', run: () => { ev.n2.ph = true; evLog('Baja presión N2 tubo · PH'); } },
      { g: 'Hidráulicas', k: 'fuga', t: 'Fuga o rotura en PK 212', d: 'Caída de presión y desbalance de volumen. Aislá con VB07 y VB08.', run: () => { S()._pendingRupturePk = 212; sim.applyScenario('fuga_rotura_pk'); evLog('Fuga/rotura PK 212'); } },
      { g: 'Hidráulicas', k: 'surge', t: 'Golpe de ariete tras parada', d: 'Onda de sobrepresión: varias EB cerca del 90 % de la MAOP.', run: () => { sim.applyScenario('sobrepresion_surge'); evLog('Golpe de ariete'); } },
      { g: 'Operativas', k: 'pig', t: 'Scraper detenido en el peak', d: 'El pig se frena en el PK 198. Falla de secuencia de lanzamiento/recepción.', run: () => { sim.applyScenario('pig_stuck_peak'); evLog('Scraper detenido PK 198'); } },
      { g: 'Operativas', k: 'esd', t: 'Paro de emergencia en ES', d: 'Pulsador de paro de emergencia accionado en El Sosneado.', run: () => { sim.failStation('sos'); ev.esd.sos = true; ev.elec.sos = { cause: 'Paro de emergencia', tTrip: S().timeSec, ready: true }; evLog('Paro de emergencia ES'); } },
    ];

    function customEvents() {
      const pumps = SORTED.filter((x) => x.pumps && x.pumps.length);
      const mids = pumps.filter((x) => x.id !== 'ph');
      const sn = (x) => x.shortName;
      const L = META.lengthKm || 100;
      const out = [];
      const a = pumps[0], b = mids[0] || null;
      out.push({ g: 'Eléctricas', k: 'pert-1', t: `Perturbación eléctrica · ${sn(a)}${b ? ' y ' + sn(b) : ''}`, d: 'Hueco de tensión en la red: disparan los motores. Requiere rearme cuando la tensión se normaliza.', run: () => { [a, b].filter(Boolean).forEach((x) => tripStation(x.id, 'Perturbación eléctrica')); evLog(`Perturbación eléctrica · ${[a, b].filter(Boolean).map(sn).join(' y ')} fuera de servicio`); } });
      if (mids.length) {
        const m = mids[Math.floor(mids.length / 2)];
        out.push({ g: 'Eléctricas', k: 'sub-m', t: `Falla de subestación en ${sn(m)}`, d: `Sin energía en ${m.name}: las bombas paran y el tramo aguas abajo pierde presión.`, run: () => { tripStation(m.id, 'Falla subestación'); evLog(`Falla subestación ${sn(m)}`); } });
        const l = mids[mids.length - 1];
        out.push({ g: 'Eléctricas', k: 'sag-l', t: `Microcorte en ${sn(l)}`, d: 'Disparo del variador por un microcorte. Rearme rápido posible.', run: () => { tripStation(l.id, 'Microcorte'); evLog(`Microcorte ${sn(l)}`); } });
      }
      const cd = sim.stationById('cd');
      out.push({ g: 'Cabecera', k: 'ph-cd', t: cd ? `Falla ${HN} · ${sn(cd)} toma la cabecera` : `Falla de la cabecera ${HN}`, d: cd ? `${HEAD.name} sale de servicio. ${cd.name} bombea desde su tanque como cabecera temporal, con caudal reducido.` : `${HEAD.name} sale de servicio y la línea se detiene. Hay que rearmar y volver a llenar en rampa.`, run: () => { sim.failStation('ph'); ev.elec.ph = { cause: 'Falla cabecera', tTrip: S().timeSec, ready: false }; evLog(`Falla ${HN}` + (cd ? ` · ${sn(cd)} cabecera temporal` : '')); } });
      const f = mids[0] || HEAD;
      out.push({ g: 'Mecánicas', k: 'filtro', t: `Filtro tapado en ${sn(f)}`, d: 'Sube la presión diferencial del filtro de entrada: cae la aspiración de las bombas.', run: () => { ev.filter[f.id] = 1.8; if (equip) equip.clog(f.id); evLog(`Alta presión diferencial filtro ${sn(f)}`); } });
      const pb = mids[mids.length - 1] || HEAD;
      const pOn = (pb.pumps || []).find((p) => p.online && !(p.role || '').includes('booster'));
      if (pOn) out.push({ g: 'Mecánicas', k: 'bomba', t: `Disparo de bomba en ${sn(pb)} (vibración)`, d: `${pOn.name} sale por alta vibración. Hay que arrancar la reserva desde el P&ID.`, run: () => { sim.setPump(pb.id, pOn.id, false); evLog(`Disparo ${pOn.name} por vibración`); } });
      out.push({ g: 'Mecánicas', k: 'n2', t: `Baja presión de nitrógeno en ${HN}`, d: 'Alarma de baja presión de N2 en el tubo de sellos. Aviso sin disparo.', run: () => { ev.n2.ph = true; evLog(`Baja presión N2 tubo · ${HN}`); } });
      const vs = S().valves.slice().sort((x, y) => x.pkKm - y.pkKm);
      const vm = vs.length > 1 ? Math.floor(vs.length / 2) : -1;
      const lpk = vm > 0 ? Math.round((vs[vm - 1].pkKm + vs[vm].pkKm) / 2) : Math.round(L * 0.45);
      out.push({ g: 'Hidráulicas', k: 'fuga', t: `Fuga o rotura en PK ${lpk}`, d: vm > 0 ? `Caída de presión y desbalance de volumen. Aislá con ${vs[vm - 1].name} y ${vs[vm].name}.` : 'Caída de presión y desbalance de volumen. Aislá el tramo con las válvulas más cercanas.', run: () => { S()._pendingRupturePk = lpk; sim.applyScenario('fuga_rotura_pk'); evLog(`Fuga/rotura PK ${lpk}`); } });
      out.push({ g: 'Hidráulicas', k: 'surge', t: 'Golpe de ariete tras parada', d: 'Onda de sobrepresión: estaciones cerca del 90 % de la MAOP.', run: () => { sim.applyScenario('sobrepresion_surge'); evLog('Golpe de ariete'); } });
      out.push({ g: 'Operativas', k: 'pig', t: 'Scraper detenido en el punto alto', d: `El pig se frena cerca del PK ${Math.round(META.peakPkKm || 0)} (${Math.round(META.peakElevM || 0)} m).`, run: () => { sim.applyScenario('pig_stuck_peak'); evLog(`Scraper detenido PK ${Math.round(META.peakPkKm || 0)}`); } });
      const e = mids[0] || HEAD;
      out.push({ g: 'Operativas', k: 'esd', t: `Paro de emergencia en ${sn(e)}`, d: `Pulsador de paro de emergencia accionado en ${e.name}.`, run: () => { sim.failStation(e.id); ev.esd[e.id] = true; ev.elec[e.id] = { cause: 'Paro de emergencia', tTrip: S().timeSec, ready: true }; evLog(`Paro de emergencia ${sn(e)}`); } });
      return out;
    }

    function eventTick() {
      for (const id in ev.elec) {
        const e = ev.elec[id];
        if (!e.ready && S().timeSec - e.tTrip > (e.repairS || 600)) { e.ready = true; evLog(`Tensión normalizada en ${sim.stationById(id).shortName}: listo para rearme`); }
      }
      // filtro tapado: lo modela el módulo de equipos (ΔP de los filtros autolimpiantes)
      if (!equip) for (const fid in ev.filter) if (S().pressuresIn[fid] != null) S().pressuresIn[fid] = Math.max(0, S().pressuresIn[fid] - ev.filter[fid]);
    }

    // ---------------- valores por estación ----------------
    const frozen = {};
    function stv(id) {
      if (ev.comm[id] && frozen[id]) return frozen[id];
      const r = stvLive(id);
      frozen[id] = r;
      return r;
    }
    function stvLive(id) {
      const s = S(), st = sim.stationById(id);
      const pin = s.pressuresIn[id], pout = s.pressuresOut[id];
      const failed = !!s.failedStations[id] || (id === 'ph' && s.phFailed);
      const mains = (st.pumps || []).filter((p) => !(p.role || '').includes('booster'));
      const avail = mains.filter((p) => p.online && !failed).reduce((a, p) => a + (p.boostKgCm2 || 0), 0);
      const used = id === 'ph' ? (pout || 0) : Math.max(0, (pout || 0) - (pin || 0));
      let cv = 0;
      if (avail > 0) {
        const sp = st.pDescSpKgCm2;
        if (sp != null && pout >= sp - 0.3) cv = 82 + 14 * Math.min(1, used / avail); // lazo de descarga regulando
        else cv = 100 + Math.min(18, sp ? ((sp - pout) / sp) * 120 : 4); // bombas saturadas, lazo abierto al máximo
      }
      const m = meters[id];
      const q = m ? qInd(m[0]) : trueQ(id);
      return { st, pin, pout, failed, cv, q, inj: sim.stationInjectionTotal(st) };
    }
    function pumpState(id, p, failed, cv) {
      if (failed || !p.online) return { cls: 'stop', mode: 'PARADA', rpm: 0 };
      const drive = p.drive || 'directa';
      if (drive === 'variador') return { cls: 'run', mode: 'VARIADOR', rpm: Math.round(2600 + Math.min(1, cv / 100) * 800) };
      if (drive === 'turbina') return { cls: 'run', mode: 'TURBINA', rpm: Math.round(4300 + Math.min(1, cv / 100) * 500) };
      return { cls: 'run', mode: 'DIRECTA', rpm: 2980 };
    }

    // anunciador por estación
    function annunciators(id) {
      const s = S(), st = sim.stationById(id), v = stv(id);
      const maop = (s.config.segments || []).find((g) => { const a = sim.stationById(g.from), b = sim.stationById(g.to); return (st.pkKm || 0) >= (a.pkKm || 0) && (st.pkKm || 0) < (b.pkKm || 0); });
      const mo = maop ? maop.maopKgCm2 : 95;
      const ma = meters[id] ? meterAlarm(id) : { warn: false };
      return [
        ['PARO EMERGENCIA', !!ev.esd[id], 1],
        ['PARO ESTACIÓN', v.failed, 1],
        ['FALLA ALIMENTACIÓN', !!(ev.elec[id] && ev.elec[id].cause !== 'Paro de emergencia'), 1],
        ['ALTA PRES. SALIDA DUCTO', v.pout != null && v.pout >= 0.9 * mo && (st.pumps || []).length > 0, 2],
        ['ALTA PRES. DESC. BBAS', st.pDescSpKgCm2 != null && v.pout >= st.pDescSpKgCm2 + 1, 2],
        ['BAJA PRES. ASP. BBAS', st.pAspSpKgCm2 != null && v.pin != null && v.pin < st.pAspSpKgCm2 - 1 && s.lineFlow > 50, 1],
        ...(equip ? [] : [['ALTA PRES. DIF. FILTRO', !!ev.filter[id], 2]]),
        ['BAJA PRES. N2 TUBO', !!ev.n2[id], 3],
        ['FALLA SEC. SCRAPER', !!(s.pig && s.pig.stuck && id === 'ph'), 2],
        ['AVISO MEDIDORES (CALIB.)', ma.warn, 3],
        ['SUBESTACIÓN', !!(ev.elec[id] && /subestación/i.test(ev.elec[id].cause)), 1],
        ['DRA / POLÍMERO', !!(st.pumps && st.pumps.length && !sim.stationDraActive(st)), 3],
        ['FALLA COMUNICACIÓN', !!ev.comm[id], 2],
        ['ALIVIO PSV ABIERTA', !!((s.relief || {})[id] && s.relief[id].open), 1],
        ['DISPARO ALTA PRESIÓN (PSHH)', /PSHH/.test((s.tripCause || {})[id] || ''), 1],
        ['LÍNEA BLOQUEADA', !!(s.blockage && s.blockage.stationId === id), 1],
      ].concat(equip ? equip.annunciators(id) : []);
    }

    // ---------------- sub-vistas ----------------
    function nav() {
      const items = [['principal', 'Principal'], ['estacion', 'Estación (P&ID)'], ['equipos', 'Equipos'], ['integridad', 'Integridad'], ['terminal', 'Terminal ' + TN], ['medicion', 'Medición'], ['cierres', 'Cierres OMNI'], ['custody', 'Custody'], ['alarmlog', 'Hist. alarmas'], ['eventos', 'Eventos y fallas']].concat(CUST ? [] : [['clasica', 'Consola clásica']]).filter(([k]) => k !== 'equipos' || equip);
      $('ing-nav').innerHTML = items.map(([k, t]) => `<button type="button" class="${k === sub ? 'on' : ''}" data-sub="${k}">${t}</button>`).join('');
    }
    function setSub(k) {
      sub = k;
      pending = null;
      nav();
      $('ing-classic').hidden = k !== 'clasica';
      root.hidden = k === 'clasica';
      document.body.dataset.ingSub = k;
      built = '';
      render(true);
    }

    // ---- pantalla principal ----
    function routeStrip() {
      const s = S(), L = app.geo.L;
      const x = (pk) => 20 + (pk / L) * 1360;
      let h = `<svg class="sc-route" viewBox="0 0 1400 64" preserveAspectRatio="none" role="img" aria-label="Recorrido con válvulas de bloqueo">`;
      h += `<line x1="20" y1="40" x2="1380" y2="40" class="sc-r-line"/>`;
      for (const id of ST) { const st = sim.stationById(id); h += `<text x="${x(st.pkKm)}" y="16" class="sc-r-st" text-anchor="middle">${st.shortName}</text><rect x="${x(st.pkKm) - 7}" y="33" width="14" height="14" class="sc-r-node ${s.failedStations[id] || (id === 'ph' && s.phFailed) ? 'bad' : ''}"/>`; }
      let lastLab = -99;
      for (const v of s.valves) {
        const vx = x(v.pkKm);
        h += `<rect x="${vx - 5}" y="35" width="10" height="10" class="sc-r-vb ${v.open ? '' : 'closed'}"><title>${esc(v.name)} · PK ${v.pkKm}</title></rect>`;
        if (vx - lastLab > 38) { h += `<text x="${vx}" y="60" class="sc-r-vt" text-anchor="middle">${esc(v.name.split(' ')[0])}</text>`; lastLab = vx; }
      }
      if (s.pig && s.pig.active) h += `<circle cx="${x(s.pig.pkKm)}" cy="40" r="6" class="sc-r-pig ${s.pig.stuck ? 'stuck' : ''}"/>`;
      if (s.rupture && s.rupture.active) h += `<circle cx="${x(s.rupture.pkKm)}" cy="40" r="8" class="sc-r-leak"/>`;
      return h + '</svg>';
    }
    function box(tagname, val, unit, cls) {
      return `<div class="sc-box ${cls || ''}"><span class="sc-tag">${tagname}</span><b>${val}</b><i>${unit}</i></div>`;
    }
    function principal() {
      const s = S();
      const cols = CUST ? ST : ['ph', 'ac', 'cd', 'mg', 'sos', 'pa', 'rt', 'lc'];
      let h = `<div class="sc-head"><div class="sc-route-wrap">${routeStrip()}</div></div>${ext ? ext.pigPanel(true) : ''}<div class="sc-gridwrap"><table class="sc-grid"><thead><tr><th class="sc-rowh"></th>`;
      h += cols.map((id) => `<th class="sc-col ${id === stSel ? 'sel' : ''}" data-st="${id}">${id === 'lc' && !CUST ? 'LUJÁN DE CUYO · UGARTECHE' : NAME[id]}</th>`).join('') + '</tr></thead><tbody>';
      const row = (lab, f) => `<tr><th class="sc-rowh">${lab}</th>${cols.map((id) => `<td>${f(id, stv(id))}</td>`).join('')}</tr>`;
      h += row('Caudal m³/h', (id, v) => id === 'pa' ? '<div class="sc-note">Cálculo aprox. scraper VB18</div>' :
        box(tag(id, 'FT'), fmt(v.q, 1), 'm³/h', id === 'ph' && Math.abs(v.q - s.globalFlowSetpoint) > 40 ? 'hi' : '') + (id === 'ph' ? box('DESPACHO', fmt(dispQ(), 0), 'm³/h', s.flowTarget != null ? 'hi' : '') : '') + box('SP', fmt(id === 'ph' ? s.globalFlowSetpoint : CUST ? (v.st.qMaxM3h || 850) : 850, 0), 'm³/h', 'sp'));
      h += row('Caudal inyec. m³/h', (id, v) => id === 'lc' && !CUST ? box('UG_FR_' + (TAGN.ug + 3), fmt(sim.stationInjectionTotal(sim.stationById('ug')), 1), 'm³/h') : id === 'pa' ? '' : box(tag(id, 'FT', 2), fmt(v.inj, 1), 'm³/h'));
      h += row('Presión aspirac. kg/cm²', (id, v) => id === 'pa' ? box('VB18_PTUP', fmt(v.pin), 'kg/cm²') :
        box(tag(id, 'PT', 4), fmt(v.pin), 'kg/cm²', v.st.pAspSpKgCm2 != null && v.pin < v.st.pAspSpKgCm2 - 1 ? 'bad' : '') + (v.st.pAspSpKgCm2 != null ? box('SP', fmt(v.st.pAspSpKgCm2), 'kg/cm²', 'sp') : ''));
      h += row('Presión descarga kg/cm²', (id, v) => id === 'pa' ? box('VB18_PTDN', fmt(v.pout), 'kg/cm²') : id === 'lc' ? box(CUST ? `${TN}_PT_${TAGN.lc + 3}` : 'LC_PT_1203', fmt(Math.max(0, v.pin - 2.3)), 'kg/cm²') + box('SP', CUST ? fmt(META.opMaxKgCm2 ? Math.max(3, (sim.state.thresholds.lcArrivalTargetKgCm2 || 8) - 2) : 6) : '11.0', 'kg/cm²', 'sp') :
        box(tag(id, 'PT', 6), fmt(v.pout), 'kg/cm²') + (v.st.pDescSpKgCm2 != null ? box('SP', fmt(v.st.pDescSpKgCm2), 'kg/cm²', 'sp') : ''));
      h += row('Lazo PID', (id, v) => {
        if (id === 'pa') return box('VB18_SALIDA', '100.0', '%');
        const auto = !v.failed;
        const cvv = id === 'lc' ? 100 : v.cv;
        return `<div class="sc-pid">${box(id === 'lc' ? (CUST ? `PCV_${TAGN.lc + 1}_CV` : 'PCV_1201_CV') : 'ASC_' + (TAGN[id] + 2) + '_CV', fmt(cvv, 1), '%')}<span class="sc-faceplate"><i></i><i></i><i></i><em class="${auto ? 'auto' : 'man'}">${auto ? 'AUTO' : 'MAN'}</em></span></div>`;
      });
      h += row('Presión ducto kg/cm²', (id, v) => box('ENTRADA', fmt(v.pin), 'kg/cm²') + box('SALIDA', fmt(id === 'lc' ? Math.max(0, v.pin - 2.3) : Math.max(0, v.pout - 0.3)), 'kg/cm²'));
      h += row('Bombas', (id, v) => {
        const ps = (v.st.pumps || []);
        if (!ps.length) return `<div class="sc-note">${id === 'lc' ? 'Terminal de recibo · PCV-' + (TAGN.lc + 1) : v.st.type === 'regulating' ? 'Reductora · SP ' + fmt(v.st.pDescSpKgCm2) + ' kg/cm²' : 'Sin bombeo'}</div>`;
        return '<div class="sc-pumps">' + ps.map((p) => {
          const b = (p.role || '').includes('booster');
          const k = pumpState(id, p, v.failed, v.cv);
          return `<div class="sc-pump ${k.cls} ${b ? 'boost' : ''}" title="${esc(p.name)}"><span class="sc-pm ${k.cls}">${b ? '' : `<em>${k.mode}</em>`}</span><b>${esc(p.name.replace(' (booster)', ''))}</b>${b ? '<i>booster</i>' : `<i>${k.rpm} rpm</i>`}</div>`;
        }).join('') + '</div>';
      });
      if (equip) h += row('Equipos', (id) => {
        const q = equip.summary(id);
        if (!q) return '';
        return `<div class="sc-eqsum ${q.alarm ? 'bad' : ''}"><span>ΔP filtro <b>${fmt(q.dp, 2)}</b></span><span>Cojinete máx <b>${fmt(q.brg, 0)} °C</b></span><span>Aceite <b>${fmt(q.oil, 2)} bar</b></span><span>33 kV <b>${fmt(q.vIn, 1)}</b></span><button type="button" class="sc-link" data-goeq="${id}">Ver equipos${q.alarm ? ' · alarma' : ''}</button></div>`;
      });
      h += '</tbody></table></div>';
      // anunciador de la estación seleccionada
      h += `<div class="sc-ann-h">Anunciador · ${NAME[stSel]} <span>(tocá el nombre de una columna para cambiar de estación)</span></div><div class="sc-ann">` +
        annunciators(stSel).map(([t, on, pr]) => `<div class="sc-an ${on ? 'on p' + pr : ''}">${t}</div>`).join('') + '</div>';
      return h;
    }

    // ---- P&ID de estación ----
    function pid() {
      const s = S(), id = stSel, v = stv(id), st = v.st;
      const mains = (st.pumps || []).filter((p) => !(p.role || '').includes('booster'));
      const boos = (st.pumps || []).filter((p) => (p.role || '').includes('booster'));
      const ms = meters[id];
      const W = 1180, H = Math.max(470, 150 + mains.length * 92);
      const yM = 250; // cabezal
      let g = `<svg viewBox="0 0 ${W} ${H}" class="pid-svg" role="img" aria-label="Diagrama de la estación ${esc(NAME[id])}"><defs><marker id="pid-ar" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L10 5L0 10z" class="pid-arh"/></marker></defs>`;
      const valve = (x, y, open, label) => `<g class="pid-v ${open ? 'open' : 'closed'}" transform="translate(${x} ${y})"><path d="M-10 -8 L10 8 L10 -8 L-10 8 Z"/><text y="-14" text-anchor="middle">${label}</text></g>`;
      const val = (x, y, t, vv, u, cls) => `<g transform="translate(${x} ${y})"><rect x="-58" y="-14" width="116" height="34" class="pid-box ${cls || ''}"/><text y="-2" text-anchor="middle" class="pid-tag">${t}</text><text y="15" text-anchor="middle" class="pid-val">${vv} ${u}</text></g>`;
      // ducto entrada y válvula
      g += `<line x1="20" y1="${yM}" x2="140" y2="${yM}" class="pid-pipe" marker-end="url(#pid-ar)"/><text x="20" y="${yM - 18}" class="pid-lab">Ducto entrada</text>`;
      const movG = (x, y, pos, attr, label, below) => `<g class="pid-v pid-mov ${pos > 0.95 ? 'open' : pos < 0.05 ? 'closed' : 'moving'}" ${attr} transform="translate(${x} ${y})" style="cursor:pointer"><path d="M-10 -8 L10 8 L10 -8 L-10 8 Z"/><rect x="-7" y="-26" width="14" height="10" rx="2"/><path d="M0 -16 V-6"/><text y="${below ? 24 : -32}" text-anchor="middle">${label}${below === 'short' ? (pos > 0.95 || pos < 0.05 ? '' : ' ' + Math.round(pos * 100) + ' %') : ' ' + (pos > 0.95 ? 'abierta' : pos < 0.05 ? 'cerrada' : Math.round(pos * 100) + ' %')}</text></g>`;
      const svIn = equip ? equip.stValvePos(id, 'in') : null;
      g += svIn == null ? valve(160, yM, !v.failed || true, `MOV-${TAGN[id] + 5}`) : movG(160, yM, svIn, 'data-stv="in"', `MOV-${TAGN[id] + 5}`, false);
      g += val(160, yM + 52, tag(id, 'PT', 4), fmt(v.pin), 'kg/cm²', st.pAspSpKgCm2 != null && v.pin < st.pAspSpKgCm2 - 1 ? 'bad' : '');
      // filtros
      const dpf = 0.3 + (ev.filter[id] || 0);
      g += `<line x1="170" y1="${yM}" x2="360" y2="${yM}" class="pid-pipe"/>`;
      g += `<path d="M215 ${yM} V${yM - 70} H300 V${yM}" class="pid-pipe thin"/><path d="M215 ${yM} V${yM + 70} H300 V${yM}" class="pid-pipe thin"/>`;
      g += `<g class="pid-filter ${ev.filter[id] ? 'bad' : ''}"><rect x="238" y="${yM - 86}" width="40" height="32" rx="4"/><text x="258" y="${yM - 66}" text-anchor="middle">F-A</text><rect x="238" y="${yM + 54}" width="40" height="32" rx="4"/><text x="258" y="${yM + 74}" text-anchor="middle">F-B</text></g>`;
      g += `<text x="258" y="${yM - 96}" text-anchor="middle" class="pid-lab ${ev.filter[id] ? 'bad' : ''}">ΔP ${fmt(dpf, 2)} kg/cm²</text>`;
      // inyección / tanque
      if (v.inj > 0.1 || (CUST ? (st.injections || []).length > 0 : ['ph', 'cd', 'ug', 'mg', 'sos', 'ac'].includes(id))) {
        g += `<line x1="335" y1="60" x2="335" y2="${yM - 4}" class="pid-pipe thin" marker-end="url(#pid-ar)"/><text x="345" y="72" class="pid-lab">Inyección ${fmt(v.inj, 1)} m³/h</text>`;
      }
      if (CUST ? !!st.tankBuffer || id === 'lc' : id === 'ph' || id === 'cd' || id === 'lc') {
        const lvl = id === 'cd' && s.phFailed ? Math.max(0.05, s.cdAutonomyRemainH / Math.max(0.1, s.cdAutonomyTotalH)) : 0.62;
        g += `<g transform="translate(60 40)"><rect width="90" height="120" rx="8" class="pid-tank"/><rect y="${120 - 120 * lvl}" width="90" height="${120 * lvl}" rx="6" class="pid-tank-l"/><text x="45" y="-8" text-anchor="middle" class="pid-lab">${CUST ? (st.tankBuffer ? st.tankBuffer.name : 'TK recibo') : id === 'ph' ? 'TK-578' : id === 'cd' ? 'TK CD (cabecera)' : 'TK recibo'}</text><text x="45" y="66" text-anchor="middle" class="pid-val">${Math.round(lvl * 100)} %</text></g>`;
      }
      // skid de medición
      const mx = 430;
      g += `<line x1="360" y1="${yM}" x2="${mx + 220}" y2="${yM}" class="pid-pipe"/>`;
      g += `<rect x="${mx - 20}" y="${yM - 120}" width="260" height="240" rx="8" class="pid-skid"/><text x="${mx - 10}" y="${yM - 102}" class="pid-lab">Skid de medición</text>`;
      if (ms) ms.forEach((m, k) => {
        const y = yM - 70 + k * Math.min(62, 186 / Math.max(3, ms.length));
        g += `<path d="M${mx} ${yM} V${y} H${mx + 200} V${yM}" class="pid-pipe thin"/>`;
        g += `<g class="pid-meter ${meterAlarm(id).warn && k > 0 ? 'warn' : ''}" data-meter="${id}:${k}"><rect x="${mx + 40}" y="${y - 16}" width="120" height="32" rx="4"/><text x="${mx + 100}" y="${y - 2}" text-anchor="middle" class="pid-tag">${m.type === 'PD' ? 'PD' : 'USM-' + m.id.slice(-1)} · MF ${m.mf.toFixed(4)}</text><text x="${mx + 100}" y="${y + 12}" text-anchor="middle" class="pid-val">${fmt(qInd(m), 1)} m³/h</text></g>`;
      });
      g += `<g transform="translate(${mx + 100} ${yM + 160})"><rect x="-70" y="-18" width="140" height="36" rx="18" class="pid-prover"/><text y="-2" text-anchor="middle" class="pid-tag">PROVER BIDIRECCIONAL</text><text y="12" text-anchor="middle" class="pid-val">3,000 m³</text></g><line x1="${mx + 100}" y1="${yM + 118}" x2="${mx + 100}" y2="${yM + 142}" class="pid-pipe dash"/>`;
      // bombas
      const px = 760;
      if (mains.length) {
        const y0 = yM - ((mains.length - 1) * 92) / 2;
        g += `<line x1="${mx + 220}" y1="${yM}" x2="${px - 60}" y2="${yM}" class="pid-pipe"/>`;
        if (boos.length) {
          boos.forEach((b, k) => { const yy = yM - 40 + k * 80; const on = b.online && !v.failed; g += `<path d="M${px - 82} ${yM} V${yy}" class="pid-pipe thin"/><g class="pid-pump small ${on ? 'run' : 'stop'}" data-pump="${b.id}" transform="translate(${px - 82} ${yy})"><circle r="13"/><text y="30" text-anchor="middle">${esc(b.name.replace(' (booster)', ''))}</text></g>`; });
        }
        g += `<line x1="${px - 60}" y1="${y0}" x2="${px - 60}" y2="${y0 + (mains.length - 1) * 92}" class="pid-pipe"/><line x1="${px + 90}" y1="${y0}" x2="${px + 90}" y2="${y0 + (mains.length - 1) * 92}" class="pid-pipe"/>`;
        mains.forEach((p, k) => {
          const y = y0 + k * 92;
          const ps = pumpState(id, p, v.failed, v.cv);
          g += `<line x1="${px - 60}" y1="${y}" x2="${px + 90}" y2="${y}" class="pid-pipe thin"/>`;
          const sp2 = equip ? equip.sucPos(id, p.id) : null;
          g += sp2 == null ? valve(px - 32, y, p.online || !p.reserve, 'MOV') : movG(px - 32, y, sp2, `data-suc="${p.id}"`, 'Asp', 'short');
          g += `<g class="pid-pump ${ps.cls}" data-pump="${p.id}" transform="translate(${px + 15} ${y})"><circle r="22"/><path d="M-8 -12 L14 0 L-8 12 Z" class="pid-imp"/><text y="-30" text-anchor="middle" class="pid-tag">${esc(p.name)}${p.reserve ? ' · reserva' : ''}</text><text y="40" text-anchor="middle" class="pid-val">${ps.mode} · ${ps.rpm} rpm${equip && equip.pumpCaseP(id, p.id) != null && ps.cls === 'run' ? ' · ' + fmt(equip.pumpCaseP(id, p.id), 1) + ' kg' : ''}</text></g>`;
          const mp = equip ? equip.movPos(id, p.id) : null;
          if (mp == null) g += valve(px + 62, y, true, '');
          else g += `<g class="pid-v pid-mov ${mp > 0.95 ? 'open' : mp < 0.05 ? 'closed' : 'moving'}" data-mov="${p.id}" transform="translate(${px + 62} ${y})" style="cursor:pointer"><path d="M-10 -8 L10 8 L10 -8 L-10 8 Z"/><rect x="-7" y="-26" width="14" height="10" rx="2"/><path d="M0 -16 V-6"/><text y="24" text-anchor="middle">Desc${mp > 0.95 || mp < 0.05 ? '' : ' ' + Math.round(mp * 100) + ' %'}</text></g>`;
        });
        g += `<line x1="${px + 90}" y1="${yM}" x2="${px + 170}" y2="${yM}" class="pid-pipe"/>`;
      } else {
        g += `<line x1="${mx + 220}" y1="${yM}" x2="${px + 170}" y2="${yM}" class="pid-pipe"/><text x="${px}" y="${yM - 18}" class="pid-lab">${id === 'lc' ? 'Hacia tanques de recibo' : st.type === 'regulating' ? 'Reductora de presión' : 'Sin bombeo'}</text>`;
      }
      // válvula de control + DRA + salida
      const cx = px + 200;
      const svOut = equip ? equip.stValvePos(id, 'out') : null;
      if (svOut != null) g += movG(cx + 78, yM, svOut, 'data-stv="out"', `MOV-${TAGN[id] + 7}`, true);
      if (mains.length) { const rl = (S().relief || {})[id] || {}; g += `<g class="pid-psv ${rl.open ? 'open' : ''}" transform="translate(${cx - 40} ${yM})"><path d="M0 0 V34" class="pid-pipe thin"/><path d="M-8 34 L8 34 L0 48 Z"/><text y="64" text-anchor="middle" class="pid-tag">PSV ${rl.sp || ''}</text><text y="78" text-anchor="middle" class="pid-val">${rl.open ? 'ALIVIANDO' : 'cerrada'}</text></g>`; }
      g += `<g class="pid-cv" transform="translate(${cx} ${yM})"><path d="M-12 -9 L12 9 L12 -9 L-12 9 Z"/><path d="M0 0 V-24 M-10 -24 H10"/><text y="-32" text-anchor="middle" class="pid-tag">${id === 'lc' ? 'PCV-' + (CUST ? TAGN.lc + 1 : 1201) : (st.type === 'regulating' ? 'PCV-' : 'ASC-') + (TAGN[id] + 2)}</text><text y="34" text-anchor="middle" class="pid-val">CV ${fmt(id === 'lc' ? 100 : v.cv, 1)} %</text></g>`;
      g += `<line x1="${cx + 12}" y1="${yM}" x2="${W - 40}" y2="${yM}" class="pid-pipe" marker-end="url(#pid-ar)"/><text x="${W - 110}" y="${yM - 18}" class="pid-lab">Ducto salida</text>`;
      g += val(cx + 120, yM + 52, id === 'lc' ? (CUST ? `${TN}_PT_${TAGN.lc + 3}` : 'LC_PT_1203') : tag(id, 'PT', 6), fmt(id === 'lc' ? Math.max(0, v.pin - 2.3) : v.pout), 'kg/cm²');
      if (mains.length) g += `<g transform="translate(${cx + 90} ${yM - 80})"><rect x="-44" y="-16" width="88" height="34" rx="4" class="pid-dra ${sim.stationDraActive(st) ? 'on' : ''}"/><text y="-2" text-anchor="middle" class="pid-tag">DRA</text><text y="12" text-anchor="middle" class="pid-val">${sim.stationDraActive(st) ? fmt(sim.stationDraLph(st), 0) + ' L/h' : 'off'}</text></g><line x1="${cx + 90}" y1="${yM - 62}" x2="${cx + 90}" y2="${yM - 4}" class="pid-pipe thin dash"/>`;
      g += '</svg>';

      let h = `<div class="pid-top"><div class="pid-sel">${ST.map((x) => `<button type="button" data-st="${x}" class="${x === id ? 'on' : ''}">${sim.stationById(x).shortName}</button>`).join('')}</div><div class="pid-title">${NAME[id]} <span>PK ${st.pkKm} · cota ${Math.round(app.geo.elevAt(st.pkKm)).toLocaleString('es-AR')} m</span></div></div>`;
      h += `<div class="pid-wrap">${g}</div>`;
      if (equip && equip.summary(id)) h += `<div class="pid-links"><button type="button" class="sc-link" data-goeq="${id}">Ver equipos de ${esc(st.shortName)}: filtros, electricidad 33/6 kV, lubricación, cojinetes, variadores</button>${mains.length ? '<span>Todas las válvulas motorizadas se operan desde acá: entrada y salida de estación, aspiración y descarga de cada bomba. Para arrancar: aspiración abierta, descarga cerrada, arranque y apertura de la descarga.</span>' : ''}</div>`;
      if (mains.length) {
        const spT = st.pDescSpTarget != null ? st.pDescSpTarget : st.pDescSpKgCm2;
        const draOn = sim.stationDraActive(st);
        h += `<div class="pid-ctl"><div class="pid-ctl-g"><b>Lazo PID de descarga</b><span>PV ${fmt(id === 'ph' ? v.pout : v.pout)} kg/cm² · SP ${fmt(st.pDescSpKgCm2)}${st.pDescSpTarget != null ? ' → ' + fmt(st.pDescSpTarget) + ' (rampa 3 kg/cm²/min)' : ''}</span><label>Nuevo SP <input type="number" id="pid-sp" min="5" max="${MAOP}" step="0.5" value="${fmt(spT)}"> kg/cm²</label><button type="button" class="sc-btn exec" data-pidapply="sp">Aplicar SP</button></div>`;
        h += `<div class="pid-ctl-g"><b>DRA (reductor de fricción)</b><span>${draOn ? fmt(sim.stationDraLph(st), 0) + ' L/h · menos fricción aguas abajo' : 'apagado'}</span><label><input type="checkbox" id="pid-dra" ${draOn ? 'checked' : ''}> Inyectar</label><label>Dosis <input type="number" id="pid-lph" min="0" max="10" step="1" value="${fmt(sim.stationDraLph(st), 0)}"> L/h</label><button type="button" class="sc-btn exec" data-pidapply="dra">Aplicar DRA</button></div>`;
        if (id === 'ph') h += `<div class="pid-ctl-g"><b>Caudal de despacho (programa de bombeo)</b><span>Despacho ${fmt(dispQ(), 0)} m³/h · rampa ${RAMP} m³/h por minuto${S().flowTarget != null ? ' · subiendo, faltan ' + fmt(Math.abs(S().flowTarget - S().globalFlowSetpoint) / RAMP, 0) + ' min' : ''}</span></div><div class="pid-ctl-g"><b>Caudal de cabecera</b><span>${fmt(S().segmentFlows.ph, 0)} m³/h · SP ${fmt(S().flowTarget != null ? S().flowTarget : S().globalFlowSetpoint, 0)}${S().flowTarget != null ? ' (en rampa)' : ''} · máx. ${QMAX}</span><label>Nuevo SP <input type="number" id="pid-q" min="0" max="${QMAX}" step="10" value="${fmt(S().flowTarget != null ? S().flowTarget : S().globalFlowSetpoint, 0)}"> m³/h</label><button type="button" class="sc-btn exec" data-pidapply="q">Aplicar en rampa</button></div>`;
        h += `<p class="pid-ctl-note">Más caudal o menos DRA exigen más presión. Con el SP del PID limitás la presión sin tocar el caudal; si no alcanza, subí el DRA. Máximo del ducto: ${MAOP} kg/cm²; operación normal hasta ${OPMAX}.</p></div>`;
      }
      if (!mains.length && st.type === 'regulating') {
        const spT = st.pDescSpTarget != null ? st.pDescSpTarget : st.pDescSpKgCm2;
        h += `<div class="pid-ctl"><div class="pid-ctl-g"><b>Reductora · SP de presión aguas abajo</b><span>Entrada ${fmt(v.pin)} → salida ${fmt(v.pout)} kg/cm² · SP ${fmt(st.pDescSpKgCm2)}</span><label>Nuevo SP <input type="number" id="pid-sp" min="1" max="${MAOP}" step="0.5" value="${fmt(spT)}"> kg/cm²</label><button type="button" class="sc-btn exec" data-pidapply="sp">Aplicar SP</button></div><p class="pid-ctl-note">La reductora protege el tramo en bajada: limita la presión de salida sin bombear.</p></div>`;
      }
      if (pending) h += `<div class="pid-confirm">Confirmar: <b>${esc(pending.label)}</b> <button type="button" class="sc-btn exec" data-exec="1">Ejecutar</button> <button type="button" class="sc-btn" data-cancel="1">Cancelar</button></div>`;
      else h += `<div class="pid-help">Tocá una bomba para arrancarla o pararla y una MOV para abrirla o cerrarla (confirmación en dos pasos). Tocá un medidor para calibrarlo con el prover.</div>`;
      if (equip && pendingPerm && pendingPerm.st === id) h += `<div class="eq-perm"><b>Permisivos de arranque · ${esc(pendingPerm.name)}</b>${equip.pumpPermissives(id, pendingPerm.pid).map(([t, ok]) => `<span class="${ok ? 'ok' : 'bad'}">${ok ? '✓' : '✗'} ${esc(t)}</span>`).join('')}</div>`;
      return h;
    }

    // ---- medición y calibración ----
    let proving = null; // {id:'cd', k:1, runs:[], state:'running'|'done', ...}
    function medicion() {
      let h = `<div class="me-grid"><div class="me-left"><h3 class="sc-h3">Medidores por estación · 2 ultrasónicos (USM) y 1 desplazamiento positivo (PD)</h3><div class="me-tablewrap"><table class="me-table"><thead><tr><th>Estación</th><th>Medidor</th><th>Tipo</th><th class="r">Caudal</th><th class="r">MF</th><th class="r">Desvío vs real</th><th>Última calibración</th><th></th></tr></thead><tbody>`;
      for (const id of METER_ST) {
        const ma = meterAlarm(id);
        meters[id].forEach((m, k) => {
          const d = devPct(m);
          h += `<tr class="${k === 0 ? 'first' : ''} ${proving && proving.id === id && proving.k === k ? 'sel' : ''}">${k === 0 ? `<td rowspan="${meters[id].length}" class="me-st">${sim.stationById(id).shortName}${ma.warn ? '<span class="me-warn">Aviso calib.</span>' : ''}<em>USM A–B ${fmt(ma.ab, 3)} %</em></td>` : ''}<td class="mono">${m.id}${m.duty ? ' <i>duty</i>' : ''}</td><td>${m.type}</td><td class="r mono">${fmt(qInd(m), 1)}</td><td class="r mono">${m.mf.toFixed(5)}</td><td class="r mono ${Math.abs(d) > 0.15 ? 'bad' : ''}">${d >= 0 ? '+' : ''}${fmt(d, 3)} %</td><td class="me-last">${esc(m.last.when)} · rep. ${fmt(m.last.rep, 3)} %</td><td><button type="button" class="sc-btn" data-prove="${id}:${k}" ${proving && proving.state === 'running' ? 'disabled' : ''}>Calibrar</button></td></tr>`;
        });
      }
      h += `</tbody></table></div></div><div class="me-right" id="me-prover">${proverPanel()}</div></div>`;
      h += balancePanel();
      return h;
    }
    function ctl(T) { const a = 0.00085; const dt = T - 15; return Math.exp(-a * dt * (1 + 0.8 * a * dt)); }
    function cpl(P) { const F = 0.000078; return 1 / (1 - F * P * 0.980665 * 10); }
    function startProving(id, k) {
      const m = meters[id][k];
      const s = S();
      proving = { id, k, m, runs: [], state: 'running', Tm: 31 + Math.random() * 3, Pm: s.pressuresIn[id] || 8, oldMf: m.mf, t: performance.now() };
      proving.Tp = proving.Tm - 0.2 - Math.random() * 0.3;
      proving.Pp = proving.Pm - 0.4;
      render(true);
    }
    function provingStep() {
      if (!proving || proving.state !== 'running') return;
      if (performance.now() - proving.t < 1300) return;
      proving.t = performance.now();
      const p = proving, m = p.m;
      const BPV = 3.0;
      const CTSp = 1 + 0.0000335 * (p.Tp - 15), CPSp = 1 + 0.0000032 * p.Pp;
      const Vp = BPV * CTSp * CPSp * ctl(p.Tp) * cpl(p.Pp);
      const sig = m.type === 'PD' ? 0.00008 : 0.00022;
      const Vm_true = Vp / (ctl(p.Tm) * cpl(p.Pm)); // volumen real a condiciones del medidor
      const pulses = Math.round(Vm_true * (1 + m.bias) * (1 + gauss() * sig) * m.kf);
      const IVm = pulses / m.kf;
      const ISVm = IVm * ctl(p.Tm) * cpl(p.Pm);
      const mf = Vp / ISVm;
      p.runs.push({ pulses, IVm, Vp, mf });
      if (p.runs.length >= 5) {
        const mfs = p.runs.map((r) => r.mf);
        const ps = p.runs.map((r) => r.pulses);
        p.rep = (Math.max(...ps) - Math.min(...ps)) / Math.min(...ps) * 100;
        p.mf = mfs.reduce((a, b) => a + b, 0) / mfs.length;
        p.dmf = (p.mf / p.oldMf - 1) * 100;
        p.ok = p.rep <= 0.05 && Math.abs(p.dmf) <= 0.25;
        p.state = 'done';
      }
      renderProver();
    }
    function proverPanel() {
      if (!proving) return `<h3 class="sc-h3">Prover</h3><p class="me-empty">Elegí un medidor y tocá <b>Calibrar</b>. El prover hace 5 corridas, corrige por temperatura y presión (CTL, CPL, CTS, CPS) y calcula el factor del medidor (MF). Se acepta si la repetibilidad es ≤ 0,05 % y el cambio de MF ≤ 0,25 %.</p>`;
      const p = proving, m = p.m;
      let h = `<h3 class="sc-h3">Calibración · ${m.id} <span>${m.type === 'PD' ? 'desplazamiento positivo' : 'ultrasónico'}</span></h3>`;
      h += `<div class="me-cond"><span>T medidor <b>${fmt(p.Tm, 2)} °C</b></span><span>T prover <b>${fmt(p.Tp, 2)} °C</b></span><span>P medidor <b>${fmt(p.Pm, 1)} kg/cm²</b></span><span>BPV <b>3,0000 m³</b></span><span>K-factor <b>${m.kf} p/m³</b></span></div>`;
      h += `<table class="me-runs"><thead><tr><th>Corrida</th><th class="r">Pulsos</th><th class="r">IVm m³</th><th class="r">Vp corr. m³</th><th class="r">MF</th></tr></thead><tbody>`;
      for (let i = 0; i < 5; i++) {
        const r = p.runs[i];
        h += r ? `<tr><td>${i + 1}</td><td class="r mono">${r.pulses}</td><td class="r mono">${r.IVm.toFixed(5)}</td><td class="r mono">${r.Vp.toFixed(5)}</td><td class="r mono">${r.mf.toFixed(5)}</td></tr>` : `<tr class="pend"><td>${i + 1}</td><td colspan="4">${i === p.runs.length ? 'Esfera en recorrido…' : 'pendiente'}</td></tr>`;
      }
      h += '</tbody></table>';
      if (p.state === 'done') {
        h += `<div class="me-res ${p.ok ? 'ok' : 'bad'}"><div><span>Repetibilidad</span><b>${fmt(p.rep, 3)} %</b></div><div><span>MF nuevo</span><b>${p.mf.toFixed(5)}</b></div><div><span>MF anterior</span><b>${p.oldMf.toFixed(5)}</b></div><div><span>Cambio</span><b>${p.dmf >= 0 ? '+' : ''}${fmt(p.dmf, 3)} %</b></div></div>`;
        h += `<p class="me-verdict">${p.ok ? 'Calibración dentro de tolerancia.' : p.rep > 0.05 ? 'Repetibilidad fuera de tolerancia: repetí la calibración.' : 'Cambio de MF mayor a 0,25 %: revisá el medidor antes de aceptar.'}</p>`;
        h += `<div class="me-btns"><button type="button" class="sc-btn exec" data-accept="1" ${p.rep > 0.05 ? 'disabled' : ''}>Aceptar MF</button><button type="button" class="sc-btn" data-reprove="1">Repetir</button><button type="button" class="sc-btn" data-close="1">Cerrar</button></div>`;
      }
      return h;
    }
    function renderProver() { const el = $('me-prover'); if (el) el.innerHTML = proverPanel(); }
    function balancePanel() {
      const s = S();
      const inQ = CUST
        ? (meters.ph ? qInd(meters.ph[0]) : trueQ('ph')) + SORTED.filter((x) => x.id !== 'ph').reduce((a, x) => a + sim.stationInjectionTotal(x), 0)
        : qInd(meters.ph[0]) + ['ac', 'cd', 'mg', 'sos', 'ug'].reduce((a, id) => a + sim.stationInjectionTotal(sim.stationById(id)), 0);
      const outQ = meters.lc ? qInd(meters.lc[0]) : trueQ('lc');
      const day = 24;
      const imb = (outQ - inQ) * day;
      const pct = inQ > 0 ? (outQ - inQ) / inQ * 100 : 0;
      return `<div class="me-bal"><h3 class="sc-h3">Balance de línea · ingresos (${HN} + inyecciones) contra recibo en ${TN}</h3><div class="me-bal-grid"><div><span>Ingresos</span><b>${fmt(inQ, 1)} m³/h</b></div><div><span>Recibo ${TN}</span><b>${fmt(outQ, 1)} m³/h</b></div><div class="${Math.abs(pct) > 0.089 ? 'bad' : ''}"><span>Desbalance</span><b>${pct >= 0 ? '+' : ''}${fmt(pct, 3)} %</b></div><div><span>Proyección diaria</span><b>${imb >= 0 ? '+' : ''}${fmt(imb, 0)} m³/d</b></div><div><span>Tolerancia mensual</span><b>± 0,089 %</b></div><div><span>Tolerancia anual</span><b>± 0,026 %</b></div></div><p class="me-note">El desbalance mezcla error de medición y variación de linepack. Si crece de golpe y la presión cae, puede ser una fuga; si crece lento, calibrá los medidores de PH y LC.</p></div>`;
    }

    // ---- eventos ----
    function eventos() {
      const s = S();
      const groups = [...new Set(EVENTS.map((e) => e.g))];
      let h = '<div class="ev-grid"><div class="ev-left">';
      // cabecera CD
      if (s.phFailed) {
        const rem = Math.max(0, s.cdAutonomyRemainH);
        const pct = rem / Math.max(0.1, s.cdAutonomyTotalH) * 100;
        h += `<div class="ev-cd ${s.cdTempHead ? '' : 'out'}"><div><span class="ev-eyebrow">${CUST ? ((sim.stationById('cd') || {}).name || 'Cabecera alternativa') : 'Cerro Divisadero'} como cabecera</span><b>${s.cdTempHead ? `Autonomía ${Math.floor(rem)}:${String(Math.round((rem % 1) * 60)).padStart(2, '0')} h` : 'Autonomía agotada · línea detenida'}</b></div><div class="ev-bar"><i style="width:${pct.toFixed(1)}%"></i></div><p>Caudal hacia LC: ${fmt(s.segmentFlows.lc, 0)} m³/h. Reponé PH antes de que se vacíe el tanque de CD.</p></div>`;
      }
      // rearmes pendientes
      const pend = Object.keys(ev.elec);
      h += `<h3 class="sc-h3">Estaciones fuera de servicio</h3>`;
      if (!pend.length && !Object.keys(s.failedStations).length) h += '<p class="me-empty">Todas las estaciones en servicio.</p>';
      else {
        h += '<div class="ev-rearm">' + ST.filter((id) => s.failedStations[id] || ev.elec[id]).map((id) => {
          const e = ev.elec[id] || { cause: (S().tripCause || {})[id] || 'Falla', ready: true };
          const perm = equip ? equip.stationPermissives(id) : [];
          const okAll = perm.every((x) => x[1]);
          return `<div class="ev-rc"><b>${sim.stationById(id).shortName}</b><span>${esc(e.cause)}</span><em>${e.ready ? (okAll ? 'Listo para rearme' : 'Faltan permisivos') : 'Esperando normalización…'}</em>${perm.length ? `<div class="eq-perm">${perm.map(([t, ok]) => `<span class="${ok ? 'ok' : 'bad'}">${ok ? '✓' : '✗'} ${esc(t)}</span>`).join('')}</div><div class="me-btns"><button type="button" class="sc-btn" data-closeall="${id}">Cerrar todas las descargas</button>${ev.esd[id] ? `<button type="button" class="sc-btn" data-esdreset="${id}">Reponer paro de emergencia</button>` : ''}</div>` : ''}<button type="button" class="sc-btn exec" data-rearm="${id}" ${e.ready && okAll ? '' : 'disabled'}>Rearmar</button></div>`;
        }).join('') + '</div>';
      }
      const extra = [];
      for (const fid in ev.filter) extra.push(`<button type="button" class="sc-btn" data-fix="filtro" data-fid="${fid}">Cambiar a filtro B en ${sim.stationById(fid).shortName}</button>`);
      for (const nid in ev.n2) extra.push(`<button type="button" class="sc-btn" data-fix="n2" data-fid="${nid}">Reponer N2 en ${sim.stationById(nid).shortName}</button>`);
      for (const cid in ev.comm) extra.push(`<button type="button" class="sc-btn" data-fix="comm" data-fid="${cid}">Restablecer comunicación con ${sim.stationById(cid).shortName}</button>`);
      if (s.scenarioActive) extra.push('<button type="button" class="sc-btn" data-fix="clear">Normalizar escenario</button>');
      if (extra.length) h += `<div class="me-btns">${extra.join('')}</div>`;
      // estrategia global
      const pb = s.playbookActive || [];
      h += `<h3 class="sc-h3">Estrategia global</h3>` + (pb.length ? '<ul class="ev-pb">' + pb.map((x) => `<li><label><input type="checkbox" data-pb="${esc(x.id)}" ${x.done ? 'checked' : ''}> ${esc(x.text)}</label></li>`).join('') + '</ul>' : '<p class="me-empty">Se activa con la primera falla.</p>');
      h += `<h3 class="sc-h3">Registro</h3><div class="ev-log">${ev.log.length ? ev.log.map((l) => `<div>${esc(l)}</div>`).join('') : '<div class="me-empty">Sin eventos.</div>'}</div>`;
      h += '</div><div class="ev-right">';
      if (faults) h += faults.formHtml() + faults.activeHtml();
      h += `<details class="ev-quick" ${faults ? '' : 'open'}><summary>Escenarios guiados rápidos</summary>`;
      for (const gname of groups) {
        h += `<h3 class="sc-h3">${gname}</h3><div class="ev-cards">` + EVENTS.filter((e) => e.g === gname).map((e) => `<div class="ev-card"><b>${esc(e.t)}</b><p>${esc(e.d)}</p><button type="button" class="sc-btn" data-ev="${e.k}">Disparar</button></div>`).join('') + '</div>';
      }
      return h + '</details></div></div>';
    }

    // ---------------- render ----------------
    let built = '';
    let lastKey = '';
    function render(force) {
      if (sub === 'clasica') return;
      if (!force && (root.contains(document.activeElement) && (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'SELECT'))) return;
      const html = sub === 'equipos' && equip ? equip.render() : ext && ext.render[sub] ? ext.render[sub]() : sub === 'principal' ? principal() : sub === 'estacion' ? pid() : sub === 'medicion' ? medicion() : eventos();
      if (sub === 'medicion' && !force && proving) {
        // no pisar el panel del prover mientras corre
        const keep = $('me-prover');
        if (html === lastKey) return;
        lastKey = html;
        const tmp = document.createElement('div');
        tmp.innerHTML = html;
        const left = tmp.querySelector('.me-left'), bal = tmp.querySelector('.me-bal');
        const cl = root.querySelector('.me-left'), cb = root.querySelector('.me-bal');
        if (cl && left) cl.replaceWith(left);
        if (cb && bal) cb.replaceWith(bal);
        if (!keep) root.innerHTML = html;
        return;
      }
      if (html === lastKey) return;
      lastKey = html;
      const sc = root.querySelector('.sc-gridwrap, .pid-wrap, .me-tablewrap');
      const sl = sc ? sc.scrollLeft : 0;
      root.innerHTML = html;
      const sc2 = root.querySelector('.sc-gridwrap, .pid-wrap, .me-tablewrap');
      if (sc2) sc2.scrollLeft = sl;
    }

    // ---------------- eventos de UI ----------------
    $('ing-nav').addEventListener('click', (e) => { const b = e.target.closest('[data-sub]'); if (b) setSub(b.dataset.sub); });
    $('ing-side').addEventListener('click', (e) => {
      const b = e.target.closest('[data-go]');
      if (!b) return;
      const g = b.dataset.go;
      if (g === 'alarmas') { app.go('scada'); return; }
      if (g.startsWith('st:')) { stSel = g.slice(3); setSub('estacion'); return; }
      setSub(g);
    });
    root.addEventListener('click', (e) => {
      const pa = e.target.closest('[data-pidapply]');
      if (pa) {
        const k = pa.dataset.pidapply;
        if (k === 'sp') { const v2 = Number($('pid-sp').value); if (isFinite(v2)) { sim.setStationPidSp(stSel, v2); app.toast(`SP del PID ${sim.stationById(stSel).shortName} → ${Math.min(MAOP, v2)} kg/cm² en rampa`); } }
        if (k === 'dra') { sim.setStationDraInject(stSel, $('pid-dra').checked); sim.setStationDraLph(stSel, Number($('pid-lph').value)); app.toast('DRA actualizado'); }
        if (k === 'q') { const q = Number($('pid-q').value); if (isFinite(q)) { S().dispatchQ = Math.min(QMAX, Math.max(0, q)); sim.rampFlowTo(q); evLog(`Despacho: nuevo caudal programado ${fmt(S().dispatchQ, 0)} m³/h`); app.toast(`Despacho ${HN} → ${Math.min(QMAX, q)} m³/h en rampa`); } }
        render(true); return;
      }
      if (equip && sub === 'equipos') { const tq = e.target.closest(equip.selector); if (tq && equip.click(tq)) { render(true); return; } }
      if (ext) { const tx = e.target.closest(ext.selector); if (tx && ext.click(tx)) { render(true); return; } }
      if (faults && sub === 'eventos') { const tf = e.target.closest(faults.selector); if (tf && faults.click(tf)) { render(true); return; } }
      const g2 = e.target.closest('[data-goeq],[data-closeall],[data-esdreset]');
      if (g2) {
        const d2 = g2.dataset;
        if (d2.goeq && equip) { equip.select(d2.goeq); setSub('equipos'); return; }
        if (d2.closeall && equip) { equip.closeAllMovs(d2.closeall); app.toast('Cerrando válvulas de descarga (carrera 1 min)'); }
        if (d2.esdreset) { delete ev.esd[d2.esdreset]; if (ev.elec[d2.esdreset]) ev.elec[d2.esdreset].cause = 'Paro de emergencia (repuesto)'; evLog(`${sim.stationById(d2.esdreset).shortName}: pulsador de paro de emergencia repuesto`); }
        render(true); return;
      }
      if (sub === 'estacion' && equip) {
        const sv = e.target.closest('[data-stv],[data-suc]');
        if (sv) {
          if (sv.dataset.stv) { const w = sv.dataset.stv, pos = equip.stValvePos(stSel, w), open = !(pos > 0.5); pending = { stv: w, open, label: `${open ? 'abrir' : 'cerrar'} MOV de ${w === 'in' ? 'entrada' : 'salida'} de ${sim.stationById(stSel).shortName}` }; }
          else { const p = sim.stationById(stSel).pumps.find((x) => x.id === sv.dataset.suc), pos = equip.sucPos(stSel, p.id), open = !(pos > 0.5); pending = { suc: p.id, open, label: `${open ? 'abrir' : 'cerrar'} válvula de aspiración de ${p.name}` }; }
          render(true); return;
        }
        const mv = e.target.closest('[data-mov]');
        if (mv) {
          const p = sim.stationById(stSel).pumps.find((x) => x.id === mv.dataset.mov);
          const pos = equip.movPos(stSel, p.id);
          const open = !(pos > 0.5);
          pending = { mov: p.id, open, label: `${open ? 'abrir' : 'cerrar'} válvula de descarga de ${p.name}` };
          render(true); return;
        }
      }
      const t = e.target.closest('[data-st],[data-pump],[data-meter],[data-exec],[data-cancel],[data-prove],[data-accept],[data-reprove],[data-close],[data-ev],[data-rearm],[data-fix]');
      if (!t) return;
      const d = t.dataset;
      if (d.st) { stSel = d.st; pending = null; render(true); return; }
      if (d.pump) {
        const st = sim.stationById(stSel), p = st.pumps.find((x) => x.id === d.pump);
        if (!p) return;
        if (S().failedStations[stSel]) { app.toast('Estación fuera de servicio: primero rearmala en Eventos y fallas'); return; }
        const isB = (p.role || '').includes('booster');
        if (!p.online && equip && !isB) {
          pendingPerm = { st: stSel, pid: p.id, name: p.name };
          const bad = equip.pumpPermissives(stSel, p.id).filter((x) => !x[1]);
          if (bad.length) { pending = null; app.toast(`Permisivos no cumplidos para ${p.name}: ${bad.map((x) => x[0].toLowerCase()).join(', ')}`); render(true); return; }
        } else pendingPerm = null;
        pending = { pump: p.id, on: !p.online, label: `${p.online ? 'parar' : 'arrancar'} ${p.name}` };
        render(true); return;
      }
      if (d.exec && pending && pending.stv) { equip.setStValve(stSel, pending.stv, pending.open); app.toast('Comando ejecutado: ' + pending.label + ' (carrera 1 min)'); pending = null; render(true); return; }
      if (d.exec && pending && pending.suc) { equip.setSuc(stSel, pending.suc, pending.open); app.toast('Comando ejecutado: ' + pending.label); pending = null; render(true); return; }
      if (d.exec && pending && pending.mov) { equip.setMov(stSel, pending.mov, pending.open); app.toast('Comando ejecutado: ' + pending.label); pending = null; render(true); return; }
      if (d.exec && pending) { if (pending.on && equip) { equip.markManualStart(stSel, pending.pump); evLog(`${sim.stationById(stSel).shortName}: arranque con descarga cerrada; abrir la MOV con la bomba en marcha`); } pendingPerm = null; sim.setPump(stSel, pending.pump, pending.on); app.toast('Comando ejecutado: ' + pending.label); evLog(`${sim.stationById(stSel).shortName}: ${pending.label}`); pending = null; render(true); return; }
      if (d.cancel) { pending = null; pendingPerm = null; render(true); return; }
      if (d.meter) { const [id, k] = d.meter.split(':'); setSub('medicion'); startProving(id, Number(k)); return; }
      if (d.prove) { const [id, k] = d.prove.split(':'); startProving(id, Number(k)); return; }
      if (d.accept && proving) {
        const m = proving.m;
        m.mf = proving.mf;
        const dd = S().simDate;
        m.last = { when: `${dd.toLocaleDateString('es-AR')} ${String(dd.getHours()).padStart(2, '0')}:${String(dd.getMinutes()).padStart(2, '0')}`, mf: m.mf, rep: proving.rep };
        evLog(`Calibración aceptada ${m.id}: MF ${m.mf.toFixed(5)}`);
        app.toast(`MF ${m.mf.toFixed(5)} aplicado a ${m.id}`);
        proving = null; render(true); return;
      }
      if (d.reprove && proving) { startProving(proving.id, proving.k); return; }
      if (d.close) { proving = null; render(true); return; }
      if (d.ev) { const e2 = EVENTS.find((x) => x.k === d.ev); if (e2) { e2.run(); app.toast(e2.t); render(true); } return; }
      if (d.rearm) { rearm(d.rearm); render(true); return; }
      if (d.fix === 'filtro') { const fid = d.fid || 'ac'; delete ev.filter[fid]; if (equip) equip.unclog(fid); evLog(`${(sim.stationById(fid) || {}).shortName || fid}: cambio a filtro B, ΔP normal`); }
      if (d.fix === 'n2') { const nid = d.fid || 'ph'; delete ev.n2[nid]; evLog(`${sim.stationById(nid).shortName}: presión de N2 repuesta`); }
      if (d.fix === 'comm') { delete ev.comm[d.fid]; evLog(`${sim.stationById(d.fid).shortName}: comunicación restablecida`); }
      if (d.fix === 'clear') { app.normalOps(); Object.keys(ev.elec).forEach((k) => delete ev.elec[k]); ev.esd = {}; ev.comm = {}; evLog('Escenario normalizado'); }
      render(true);
    });
    root.addEventListener('change', (e) => {
      if (ext && ext.change(e.target)) { render(true); return; }
      if (faults && faults.change(e.target)) { if (e.target.tagName === 'SELECT') e.target.blur(); render(true); return; }
      const c = e.target.closest('[data-pb]');
      if (c) sim.togglePlaybookCheck(c.dataset.pb);
    });

    const ext = global.createIngExt ? global.createIngExt(app, { meters, qInd, evLog, setSub: (k) => setSub(k) }) : null;
    const equip = global.createEquip ? global.createEquip(app, { TAGN, NAME, ev, evLog }) : null;
    if (equip && app.alarms && app.alarms.addSource) app.alarms.addSource(() => equip.alarms());
    if (equip) equip.onStart = (sid, p) => { if (S().stationRamp && S().stationRamp.__init) return; startRamp(`arranque de ${p.name} en ${sim.stationById(sid).shortName}`); };
    const faults = global.createFaults ? global.createFaults(app, { ev, evLog, equip: () => equip }) : null;
    nav();
    setSub('principal');

    let acc = 0, accM = 0;
    function update(dt, visible) {
      // deriva de medidores y acumulados (siempre)
      const s = S();
      const dtH = Math.max(0, s.timeSec - (update.lastT != null ? update.lastT : s.timeSec)) / 3600;
      update.lastT = s.timeSec;
      if (dtH > 0) {
        for (const id of METER_ST) for (const m of meters[id]) {
          m.bias += m.drift * dtH / 24 + gauss() * 0.00002 * Math.sqrt(dtH);
          m.cum += qInd(m) * dtH;
        }
      }
      if (equip) equip.update();
      if (faults) faults.tick(dt);
      eventTick();
      provingStep();
      if (ext) ext.update();
      if (!visible) return;
      acc += dt;
      if (acc > 0.5) { acc = 0; render(false); }
    }

    return { update, resetEvents() { Object.keys(ev.elec).forEach((k) => delete ev.elec[k]); ev.filter = {}; ev.n2 = {}; ev.esd = {}; ev.comm = {}; if (equip) equip.reset(); if (faults) faults.reset(); }, meters, equip, ev, get faults() { return faults; } };
  }

  global.createIng = createIng;
})(window);
