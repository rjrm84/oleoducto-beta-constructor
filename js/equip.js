/* SCADA · Equipos: alimentación de media tensión (33 → 6 kV), filtros autolimpiantes con ΔP,
   central de lubricación, cojinetes y vibración, sala de variadores, curva de bombas y trampa de scraper
   con sensores de paso. Modelo de equipos de entrenamiento montado sobre la hidráulica del simulador. */
(function (global) {
  'use strict';
  const fmt = (v, d) => (v == null || !isFinite(v) ? '—' : Number(v).toFixed(d == null ? 1 : d));
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  function gauss() { let u = 0, v = 0; while (!u) u = Math.random(); while (!v) v = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }
  const lag = (x, target, dtH, tauH) => x + (target - x) * (1 - Math.exp(-dtH / Math.max(1e-4, tauH)));
  const isBooster = (p) => (p.role || '').indexOf('booster') >= 0;

  // umbrales (entrenamiento, típicos de planta)
  const LIM = {
    filtWarn: 0.8, filtAlm: 1.2, filtAuto: 0.8, filtClean: 0.18,
    brgWarn: 85, brgTrip: 95, vibWarn: 7.1, vibTrip: 11,
    oilLow: 1.2, oilTrip: 0.9, vInLow: 31.0,
    porLo: 0.7, porHi: 1.2, aorLo: 0.5, aorHi: 1.3,
  };

  function createEquip(app, ctx) {
    const sim = app.sim;
    const S = () => sim.state;
    const st = (id) => sim.stationById(id);
    const TAGN = ctx.TAGN;
    const NAME = ctx.NAME;
    const sorted = sim.sortedStations().slice().sort((a, b) => (a.pkKm || 0) - (b.pkKm || 0));
    const PUMP_ST = sorted.filter((x) => x.pumps && x.pumps.some((p) => !isBooster(p))).map((x) => x.id);
    const TRAP_ST = sorted.filter((x) => x.pigTrap).map((x) => x.id);
    const EQ_ST = sorted.filter((x) => PUMP_ST.includes(x.id) || TRAP_ST.includes(x.id)).map((x) => x.id);
    // válvulas motorizadas de entrada y salida de estación (operables desde el SCADA)
    const SV_ST = sorted.filter((x) => PUMP_ST.includes(x.id) || x.id === 'lc' || x.type === 'regulating').map((x) => x.id);
    const SV = {};
    for (const id of SV_ST) SV[id] = { in: { pos: 1, target: 1 }, out: { pos: 1, target: 1 } };
    const sn = (id) => (st(id) || {}).shortName || id;
    const hhmm = () => { const d = S().simDate; return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };

    // caudal de mejor eficiencia (BEP) de cada estación = caudal de diseño al iniciar
    const qBep = {};
    for (const id of EQ_ST) qBep[id] = Math.max(50, S().segmentFlows[id] || (S().config._meta.defaultPhCabeceraM3h || 600));

    // ---------- estado por estación ----------
    const E = {};
    for (const id of EQ_ST) {
      const s = st(id);
      const mains = (s.pumps || []).filter((p) => !isBooster(p));
      const kwInst = mains.reduce((a, p) => a + motorKwRated(p, id), 0);
      E[id] = {
        filters: [
          { id: 'F-A', mode: 'servicio', foul: 0.05 + Math.random() * 0.25, cycle: 0, fault: false, washes: 0 },
          { id: 'F-B', mode: 'reserva', foul: 0.02 + Math.random() * 0.08, cycle: 0, fault: false, washes: 0 },
        ],
        foulRate: 0.006 + Math.random() * 0.006, // kg/cm² por hora a caudal de diseño
        elec: { vIn: 33, vBus: 6, sag: 0, trMva: Math.max(2, Math.ceil((kwInst * 1.3) / 1000)) },
        vfdRoom: 24 + Math.random() * 2, hvacFail: false,
        pumps: {},
        trap: { xsOut: null, xsIn: null, log: [], lastLaunch: null },
        // tanque sumidero: recibe drenajes de trampas, sellos y válvulas; su bomba lo reinyecta a la línea
        sump: { capL: 15000, volL: 3000 + Math.random() * 2500, pend: 0, passing: 0, pumpFault: false, mode: 'auto', run: false, lastL: null, lastR: null, unexplT: 0, inj: 0, log: [], lowFlow: false },
      };
      for (const p of mains) {
        E[id].pumps[p.id] = {
          oilP: p.online ? 2.2 : 1.6, oilT: 42, level: 82 + Math.random() * 10, lubeFault: false, aux: 'A',
          mov: { pos: p.online ? 1 : 0, target: p.online ? 1 : 0 }, suc: { pos: 1, target: 1 }, sucT: 0, prevOn: !!p.online, manualStart: false, deadT: 0, sealLeak: false,
          brg: { pDE: 40, pNDE: 38, mDE: 42, mNDE: 40 }, vib: 2, heat: 0, vibFault: 0,
          vfdFault: false, kw: 0, amp: 0, r: 0, head: 0, hours: 12000 + Math.round(Math.random() * 30000),
        };
      }
    }
    function motorKwRated(p, id) {
      const Q = (qBep[id] || 600) / 3600;
      return (Q * (p.boostKgCm2 || 30) * 1.25 * 98066.5) / (0.78 * 0.95) / 1000;
    }

    // ---------- modelo ----------
    let lastT = null;
    function update() {
      const s = S();
      const t = s.timeSec;
      const dtH = lastT == null ? 0 : Math.max(0, Math.min(0.5, (t - lastT) / 3600));
      lastT = t;
      const ev = ctx.ev;
      // carrera de las MOV de estación (1 min) y bloqueo de la línea
      for (const id of SV_ST) {
        const v = SV[id], x = st(id);
        for (const w of ['in', 'out']) { const m = v[w]; const stp = dtH / 0.0167; m.pos = m.target > m.pos ? Math.min(m.target, m.pos + stp) : Math.max(m.target, m.pos - stp); }
        let at = null, why = '';
        if (v.in.pos < 0.05) { at = 'before'; why = `MOV de entrada de ${sn(id)} cerrada`; }
        else if (v.out.pos < 0.05) { at = 'after'; why = `MOV de salida de ${sn(id)} cerrada`; }
        else if (E[id] && PUMP_ST.includes(id)) {
          const failedX = !!s.failedStations[id] || (id === 'ph' && s.phFailed);
          const runM = (x.pumps || []).filter((p) => !isBooster(p) && p.online && !failedX);
          if (runM.length && runM.every((p) => E[id].pumps[p.id] && (E[id].pumps[p.id].mov.pos < 0.05 || E[id].pumps[p.id].suc.pos < 0.05))) { at = 'before'; why = `válvulas de las bombas en marcha cerradas en ${sn(id)}`; }
        }
        x._blockAt = at; x._blockWhy = why;
      }
      for (const id of EQ_ST) {
        const e = E[id];
        const x = st(id);
        const failed = !!s.failedStations[id] || (id === 'ph' && s.phFailed);
        const Q = Math.max(0, s.segmentFlows[id] || 0);
        const r = Q / (qBep[id] || 1);
        // --- eléctrica ---
        const elc = ev && ev.elec ? ev.elec[id] : null;
        let vIn = 33 * (1 + 0.004 * gauss());
        if (e.elec.sag > 0) { e.elec.sag = Math.max(0, e.elec.sag - dtH); vIn = 33 * (0.68 + 0.32 * (1 - e.elec.sag / 0.05)); }
        if (elc && /subestaci/i.test(elc.cause) && !elc.ready) vIn = 0;
        else if (elc && !elc.ready) vIn = 33 * (0.55 + 0.1 * Math.random());
        e.elec.vIn = vIn;
        e.elec.vBus = vIn > 1 ? vIn * (6 / 33) * (1 - 0.01 * Math.random()) : 0;
        // --- filtros (solo plantas de bombeo) ---
        const hasF = PUMP_ST.includes(id);
        const duty = hasF ? e.filters.find((f) => f.mode === 'servicio') || e.filters[0] : null;
        for (const f of hasF ? e.filters : []) {
          if (f.mode === 'retrolavado') {
            f.cycle -= dtH;
            f.foul = Math.max(0.02, f.foul - dtH * 8);
            if (f.cycle <= 0) { f.mode = 'reserva'; f.washes++; }
          }
          if (f === duty && Q > 1) f.foul += e.foulRate * dtH * Math.max(0.2, r * r) * (1 + (s.waterSlugPct || 0));
          f.dp = f.mode === 'servicio' ? (LIM.filtClean + f.foul) * Math.max(0, r * r) : 0;
        }
        if (duty && duty.dp >= LIM.filtAuto && !duty.fault) {
          const other = e.filters.find((f) => f !== duty && f.mode === 'reserva');
          if (other) { duty.mode = 'retrolavado'; duty.cycle = 0.1; other.mode = 'servicio'; ctx.evLog(`${sn(id)}: retrolavado automático de ${duty.id} (ΔP ${fmt(duty.dp, 2)} kg/cm²), pasa a ${other.id}`); }
        }
        e.dp = (e.filters.find((f) => f.mode === 'servicio') || {}).dp || 0;
        if (s.pressuresIn[id] != null && e.dp > LIM.filtClean && !(s.pressuresIn.__eq && s.pressuresIn.__eq[id])) {
          if (!s.pressuresIn.__eq) Object.defineProperty(s.pressuresIn, '__eq', { value: {}, enumerable: false });
          s.pressuresIn.__eq[id] = true;
          s.pressuresIn[id] = Math.max(0, s.pressuresIn[id] - (e.dp - LIM.filtClean));
        }
        // --- sala de variadores ---
        const vfds = (x.pumps || []).filter((p) => !isBooster(p) && p.drive === 'variador');
        const vfdOn = vfds.filter((p) => p.online && !failed).length;
        e.vfdRoom = lag(e.vfdRoom, (e.hvacFail ? 34 : 23) + vfdOn * 1.8, dtH, 0.6);
        // --- bombas ---
        const mains = (x.pumps || []).filter((p) => !isBooster(p));
        const run = mains.filter((p) => p.online && !failed);
        const dP = Math.max(0, (s.pressuresOut[id] || 0) - (s.pressuresIn[id] || 0));
        for (const p of mains) {
          const k = e.pumps[p.id];
          if (!k) continue;
          const on = p.online && !failed;
          const Hb = p.boostKgCm2 || 30;
          k.r = on ? r : 0;
          k.offT = on && Q > 1 && (r < LIM.aorLo || r > LIM.aorHi) ? (k.offT || 0) + dtH : 0;
          k.head = on ? Hb * (1.25 - 0.25 * r * r) : 0;
          const load = on ? Math.max(0.2, Math.min(1.3, (run.length ? dP / run.length : 0) / Hb * 0.6 + r * 0.45)) : 0;
          k.load = load;
          k.kw = on ? ((Q / 3600) * Math.max(0, k.head) * 98066.5) / (0.78 * 0.95) / 1000 : 0;
          k.amp = on && e.elec.vBus > 0.5 ? (k.kw * 1000) / (1.732 * e.elec.vBus * 1000 * 0.88) : 0;
          if (on) k.hours += dtH;
          const off = on ? Math.max(0, Math.abs(1 - r) - 0.15) : 0;
          // cojinetes y vibración
          if (k.heat > 0) k.heat += dtH * 12;
          const base = on ? 25 + 28 + 14 * load + 18 * Math.max(0, Math.abs(1 - r) - 0.3) : 25;
          k.brg.pDE = lag(k.brg.pDE, base + 4 + k.heat, dtH, 0.4);
          k.brg.pNDE = lag(k.brg.pNDE, base + k.heat * 0.6, dtH, 0.4);
          k.brg.mDE = lag(k.brg.mDE, base - 2 + (e.hvacFail && p.drive === 'variador' ? 3 : 0), dtH, 0.5);
          k.brg.mNDE = lag(k.brg.mNDE, base - 5, dtH, 0.5);
          if (k.vibFault > 0) k.vibFault += dtH * 6;
          k.vib = on ? Math.max(0.6, 1.8 + 1.2 * load + 6 * Math.max(0, Math.abs(1 - r) - 0.3) + k.vibFault + 0.15 * gauss()) : 0.2;
          // central de lubricación
          const oilTarget = k.lubeFault ? 0.5 : on ? 2.2 : 1.6;
          k.oilP = lag(k.oilP, oilTarget + 0.03 * gauss(), dtH, k.lubeFault ? 0.08 : 0.05);
          k.oilT = lag(k.oilT, on ? 44 + 10 * load : 32, dtH, 0.8);
          k.level = Math.max(40, k.level - dtH * 0.02);
          // disparos por protección
          const tmax = Math.max(k.brg.pDE, k.brg.pNDE, k.brg.mDE, k.brg.mNDE);
          let trip = null;
          if (on && k.oilP < LIM.oilTrip) trip = 'baja presión de aceite de lubricación';
          else if (on && tmax >= LIM.brgTrip) trip = `alta temperatura de cojinete (${fmt(tmax, 0)} °C)`;
          else if (on && k.vib >= LIM.vibTrip) trip = `alta vibración (${fmt(k.vib, 1)} mm/s)`;
          else if (on && p.drive === 'variador' && (k.vfdFault || e.vfdRoom >= 40)) trip = k.vfdFault ? 'falla de variador' : 'alta temperatura en sala de variadores';
          if (trip) { sim.setPump(id, p.id, false); ctx.evLog(`${sn(id)}: disparo de ${p.name} por ${trip}`); }
          // válvula de descarga actuada (MOV): carrera completa en ~1 min
          const mv = k.mov;
          if (on && !k.prevOn) { if (!k.manualStart) mv.target = 1; k.manualStart = false; if (api.onStart && lastT != null && dtH > 0) api.onStart(id, p); }
          if (!on && k.prevOn && mv.pos > 0.05) ctx.evLog(`${sn(id)}: ${p.name} parada con la válvula de descarga abierta · cerrar MOV`);
          k.prevOn = on;
          const stepMv = dtH / 0.0167;
          mv.pos = mv.target > mv.pos ? Math.min(mv.target, mv.pos + stepMv) : Math.max(mv.target, mv.pos - stepMv);
          const sv = k.suc;
          sv.pos = sv.target > sv.pos ? Math.min(sv.target, sv.pos + stepMv) : Math.max(sv.target, sv.pos - stepMv);
          // variador en manual: la altura sigue la ley de afinidad (H ∝ n²)
          const nMan = p.drive === 'variador' && p._vfdMan != null ? Math.max(0, Math.min(1.05, p._vfdMan / 100)) : null;
          p.powerFraction = on ? Math.max(0, Math.min(1, mv.pos, sv.pos)) * (nMan != null ? nMan * nMan : 1) : 1;
          if (on && mv.pos < 0.1) { k.deadT += dtH; if (k.deadT > 0.05) k.heat = Math.max(k.heat, 0.5); } else k.deadT = 0;
          // aspiración cerrada con la bomba en marcha: cavita y dispara por baja presión de aspiración (~20 s)
          if (on && sv.pos < 0.1) { k.sucT += dtH; if (k.sucT > 0.0055) { k.sucT = 0; sim.setPump(id, p.id, false); ctx.evLog(`${sn(id)}: disparo de ${p.name} por baja presión de aspiración (válvula de aspiración cerrada)`); } } else k.sucT = 0;
          // presión en la carcasa de la bomba: con la descarga cerrada sube a la presión de cierre
          k.pCase = on ? (mv.pos < 0.1 ? (s.pressuresIn[id] || 0) + Hb * 1.15 * Math.max(0.05, sv.pos) : Math.max(s.pressuresOut[id] || 0, (s.pressuresIn[id] || 0))) : (s.pressuresIn[id] || 0) * Math.max(0, sv.pos);
          // variador
          k.hz = on && p.drive === 'variador' ? (nMan != null ? 50 * nMan : Math.min(50, 38 + 12 * Math.min(1, load))) : 0;
          k.rpm = on ? (p.drive === 'variador' ? k.hz * 59.6 : p.drive === 'turbina' ? 4300 + 500 * Math.min(1, load) : 2980) : 0;
        }
        // --- trampa de scraper ---
        const pig = s.pig || {};
        if (x.pigTrap) {
          const tr = e.trap;
          if (tr.sensorFault) { if (pig.active && pig.fromId === id) tr.lastLaunch = pig.launchedAt; if (pig.status === 'received' && pig.atId === id) tr.waiting = false; }
          else if (pig.active && pig.fromId === id && pig.launchedAt != null && tr.lastLaunch !== pig.launchedAt && (pig.pkKm || 0) > (x.pkKm || 0) + 0.05) {
            tr.lastLaunch = pig.launchedAt;
            tr.xsOut = { t: hhmm(), on: true, tMs: Date.now() };
            tr.log.unshift(`${hhmm()} · XS salida: pasó el pig ${pig.typeName || ''}`);
            ctx.evLog(`${sn(id)}: XS de salida detectó el paso del pig hacia ${sn(pig.toId)}`);
          }
          if (pig.active && pig.toId === id) tr.waiting = true;
          if (tr.waiting && pig.status === 'received' && pig.atId === id) {
            tr.waiting = false;
            tr.xsIn = { t: hhmm(), on: true, tMs: Date.now() };
            tr.log.unshift(`${hhmm()} · XS llegada: pig recibido en la trampa`);
            ctx.evLog(`${sn(id)}: XS de llegada detectó el pig en la trampa receptora`);
          }
          if (tr.log.length > 12) tr.log.length = 12;
        }
        // --- tanque sumidero ---
        {
          const sp = e.sump, pg = s.pig || {};
          const slog = (t) => { sp.log.unshift(`${hhmm()} · ${t}`); if (sp.log.length > 10) sp.log.length = 10; };
          if (pg.active && pg.fromId === id && pg.launchedAt != null && sp.lastL !== pg.launchedAt) { sp.lastL = pg.launchedAt; sp.pend += 2500; slog('drenaje de la trampa lanzadora (≈2.500 L)'); }
          if (pg.status === 'received' && pg.atId === id && pg.launchedAt != null && sp.lastR !== pg.launchedAt) { sp.lastR = pg.launchedAt; sp.pend += 3000; slog('drenaje de la trampa receptora (≈3.000 L)'); }
          const drain = Math.min(sp.pend, 7500 * dtH); sp.pend -= drain;
          const seal = Object.values(e.pumps).some((k) => k.sealLeak) ? 150 * dtH : 0;
          const pass = sp.passing * dtH;
          sp.volL = Math.min(sp.capL, sp.volL + drain + seal + pass);
          const pct = sp.volL / sp.capL;
          // bomba del sumidero: en automático arranca en alto nivel y para en bajo; protección por muy bajo nivel
          const pIn = s.pressuresIn[id] || 0;
          sp.lowFlow = sp.run && pIn > 30;
          if (sp.mode === 'auto' && !sp.pumpFault) { if (pct >= 0.7 && !sp.run) { sp.run = true; slog('arranque automático de la bomba (alto nivel): inyección a la línea'); } else if (pct <= 0.2 && sp.run) { sp.run = false; slog('parada automática de la bomba (bajo nivel)'); } }
          if (sp.run && (pct <= 0.08 || sp.pumpFault)) { sp.run = false; slog(sp.pumpFault ? 'bomba del sumidero disparada' : 'parada por muy bajo nivel (protección de marcha en seco)'); }
          const out = sp.run && !sp.lowFlow ? Math.min(sp.volL - 0.05 * sp.capL, 6000 * dtH) : 0;
          sp.volL = Math.max(0, sp.volL - Math.max(0, out));
          sp.inj = sp.run && !sp.lowFlow ? 6 : 0; // m³/h hacia la aspiración de la estación
          // ingreso sin drenaje programado: algo está dejando pasaje
          if ((pass + seal) > 0 && drain <= 0) sp.unexplT += dtH; else if (drain > 0) sp.unexplT = 0; else sp.unexplT = Math.max(0, sp.unexplT - dtH);
        }
      }
    }

    // ---------- alarmas para el gestor ----------
    function alarms() {
      const out = [];
      const s = S();
      for (const id of SV_ST) {
        const v = SV[id], tg = sn(id);
        if (v.in.pos < 0.95) out.push({ id: `eq-svin-${id}`, severity: v.in.pos < 0.05 ? 'critical' : 'warn', text: `${tg}: MOV de entrada de estación ${v.in.pos < 0.05 ? 'cerrada' : 'en movimiento ' + fmt(v.in.pos * 100, 0) + ' %'}`, tag: tg });
        if (v.out.pos < 0.95) out.push({ id: `eq-svout-${id}`, severity: v.out.pos < 0.05 ? 'critical' : 'warn', text: `${tg}: MOV de salida de estación ${v.out.pos < 0.05 ? 'cerrada' : 'en movimiento ' + fmt(v.out.pos * 100, 0) + ' %'}`, tag: tg });
        const rl = (s.relief || {})[id];
        if (rl && rl.open) out.push({ id: `eq-psv-${id}`, severity: 'critical', text: `${tg}: PSV abierta a ${rl.sp} kg/cm² · alivio ${fmt(rl.qM3h, 0)} m³/h al tanque de alivio`, tag: tg });
        if (st(id)._pshhInhibit) out.push({ id: `eq-pshhinh-${id}`, severity: 'warn', text: `${tg}: protección PSHH inhibida`, tag: tg });
      }
      if (s.blockage) { const b = s.blockage; out.push({ id: 'eq-block', severity: 'critical', text: `Línea bloqueada (${b.why}): sin caudal, la presión aguas arriba sube`, tag: sn(b.stationId) }); }
      for (const id of EQ_ST) {
        const e = E[id], x = st(id), tg = sn(id);
        const failed = !!s.failedStations[id] || (id === 'ph' && s.phFailed);
        if (e.dp >= LIM.filtAlm) out.push({ id: `eq-filt-${id}`, severity: 'critical', text: `${tg}: filtro de entrada ocluido · ΔP ${fmt(e.dp, 2)} kg/cm²`, tag: tg });
        else if (e.dp >= LIM.filtWarn) out.push({ id: `eq-filtw-${id}`, severity: 'warn', text: `${tg}: alta ΔP de filtro ${fmt(e.dp, 2)} kg/cm²`, tag: tg });
        if (e.elec.vIn < LIM.vInLow && PUMP_ST.includes(id) && !hasTurbineOnly(x)) out.push({ id: `eq-mt-${id}`, severity: e.elec.vIn < 5 ? 'critical' : 'warn', text: `${tg}: baja tensión de entrada ${fmt(e.elec.vIn, 1)} kV`, tag: tg });
        {
          const sp = e.sump, pct = sp.volL / sp.capL;
          if (pct >= 0.995) out.push({ id: `eq-sumov-${id}`, severity: 'critical', text: `${tg}: REBALSE del tanque sumidero · derrame en la estación`, tag: tg });
          else if (pct >= 0.85) out.push({ id: `eq-sumhh-${id}`, severity: 'critical', text: `${tg}: tanque sumidero muy alto nivel (${fmt(pct * 100, 0)} %)`, tag: tg });
          else if (pct >= 0.7) out.push({ id: `eq-sumh-${id}`, severity: 'warn', text: `${tg}: tanque sumidero alto nivel (${fmt(pct * 100, 0)} %)`, tag: tg });
          if (sp.unexplT > 0.15) out.push({ id: `eq-sumin-${id}`, severity: 'warn', text: `${tg}: ingreso al sumidero sin drenaje programado · posible válvula pasante o sello`, tag: tg });
          if (sp.pumpFault) out.push({ id: `eq-sump-${id}`, severity: 'critical', text: `${tg}: falla de la bomba del sumidero`, tag: tg });
          if (sp.lowFlow) out.push({ id: `eq-sumlf-${id}`, severity: 'warn', text: `${tg}: bomba del sumidero sin caudal (presión de línea alta)`, tag: tg });
        }
        if (e.trap.sensorFault) out.push({ id: `eq-xs-${id}`, severity: 'warn', text: `${tg}: falla del sensor de paso de scraper`, tag: tg });
        if (e.vfdRoom >= 32) out.push({ id: `eq-vfdr-${id}`, severity: e.vfdRoom >= 37 ? 'critical' : 'warn', text: `${tg}: alta temperatura en sala de variadores ${fmt(e.vfdRoom, 1)} °C`, tag: tg });
        for (const p of (x.pumps || []).filter((q) => !isBooster(q))) {
          const k = e.pumps[p.id];
          if (!k) continue;
          const on = p.online && !failed;
          const tmax = Math.max(k.brg.pDE, k.brg.pNDE, k.brg.mDE, k.brg.mNDE);
          if (tmax >= LIM.brgWarn) out.push({ id: `eq-brg-${p.id}`, severity: 'warn', text: `${tg}: ${p.name} alta temperatura de cojinete ${fmt(tmax, 0)} °C`, tag: tg });
          if (on && k.vib >= LIM.vibWarn) out.push({ id: `eq-vib-${p.id}`, severity: 'warn', text: `${tg}: ${p.name} alta vibración ${fmt(k.vib, 1)} mm/s`, tag: tg });
          if (k.oilP < LIM.oilLow) out.push({ id: `eq-oil-${p.id}`, severity: on ? 'critical' : 'warn', text: `${tg}: ${p.name} baja presión de aceite ${fmt(k.oilP, 2)} bar`, tag: tg });
          if (!on && k.mov.pos > 0.05) out.push({ id: `eq-movo-${p.id}`, severity: 'warn', text: `${tg}: ${p.name} parada con válvula de descarga abierta (${fmt(k.mov.pos * 100, 0)} %)`, tag: tg });
          if (on && k.mov.pos < 0.1 && k.deadT > 0.02) out.push({ id: `eq-dead-${p.id}`, severity: 'critical', text: `${tg}: ${p.name} en marcha con la descarga cerrada`, tag: tg });
          if (k.sealLeak) out.push({ id: `eq-seal-${p.id}`, severity: 'critical', text: `${tg}: pérdida por sello mecánico en ${p.name}`, tag: tg });
          if (on && k.suc.pos < 0.95) out.push({ id: `eq-suc-${p.id}`, severity: 'critical', text: `${tg}: ${p.name} en marcha con la aspiración cerrada (${fmt(k.suc.pos * 100, 0)} %)`, tag: tg });
          if (k.vfdFault) out.push({ id: `eq-vfd-${p.id}`, severity: 'critical', text: `${tg}: falla de variador de ${p.name}`, tag: tg });
          if (on && (k.offT || 0) > 0.1) out.push({ id: `eq-curve-${p.id}`, severity: 'warn', text: `${tg}: ${p.name} fuera de curva (${fmt(k.r * 100, 0)} % del BEP)`, tag: tg });
        }
      }
      return out;
    }
    function hasTurbineOnly(x) { const m = (x.pumps || []).filter((p) => !isBooster(p)); return m.length && m.every((p) => p.drive === 'turbina'); }

    // anunciador de estación
    function annunciators(id) {
      const e = E[id];
      if (!e) return [];
      const x = st(id);
      const ps = Object.entries(e.pumps);
      const anyBrg = ps.some(([, k]) => Math.max(k.brg.pDE, k.brg.pNDE, k.brg.mDE, k.brg.mNDE) >= LIM.brgWarn);
      const anyVib = ps.some(([pid, k]) => { const p = (x.pumps || []).find((q) => q.id === pid); return p && p.online && k.vib >= LIM.vibWarn; });
      const anyOil = ps.some(([, k]) => k.oilP < LIM.oilLow);
      const anyVfd = ps.some(([, k]) => k.vfdFault) || e.vfdRoom >= 32;
      const anyCurve = ps.some(([pid, k]) => { const p = (x.pumps || []).find((q) => q.id === pid); return p && p.online && (k.offT || 0) > 0.1; });
      return [
        ['ALTA ΔP FILTRO', e.dp >= LIM.filtWarn, e.dp >= LIM.filtAlm ? 1 : 2],
        ['BAJA TENSIÓN 33 kV', PUMP_ST.includes(id) && !hasTurbineOnly(x) && e.elec.vIn < LIM.vInLow, 1],
        ['BAJA PRES. ACEITE LUBRIC.', anyOil, 1],
        ['ALTA TEMP. COJINETES', anyBrg, 2],
        ['ALTA VIBRACIÓN', anyVib, 2],
        ['FALLA VARIADOR / SALA', anyVfd, 1],
        ['SUMIDERO ALTO NIVEL', e.sump.volL / e.sump.capL >= 0.7, e.sump.volL / e.sump.capL >= 0.85 ? 1 : 2],
        ['INGRESO A SUMIDERO', e.sump.unexplT > 0.15, 2],
        ['BOMBA FUERA DE CURVA', anyCurve, 3],
      ];
    }

    // ---------- pantalla ----------
    let sel = EQ_ST.includes('ph') ? 'ph' : EQ_ST[0];
    let pumpSel = null;
    function bar(v, max, warn, alm) {
      const pct = Math.max(0, Math.min(100, (v / max) * 100));
      const c = v >= alm ? 'bad' : v >= warn ? 'warn' : 'ok';
      return `<span class="eq-bar"><i class="${c}" style="width:${pct.toFixed(1)}%"></i><em style="left:${(warn / max) * 100}%"></em><em class="a" style="left:${(alm / max) * 100}%"></em></span>`;
    }
    function lamp(on, cls) { return `<span class="eq-lamp ${on ? cls || 'on' : ''}"></span>`; }
    function tag(id, k, n) { return `${sn(id).toUpperCase()}_${k}_${(TAGN[id] || 100) + n}`; }

    function elecPanel(id) {
      const e = E[id], x = st(id);
      const mains = (x.pumps || []).filter((p) => !isBooster(p));
      if (!mains.length) return '';
      if (hasTurbineOnly(x)) {
        return `<div class="eq-card"><h3 class="sc-h3">Accionamiento · turbobombas <span>sin alimentación de media tensión</span></h3><table class="me-table"><thead><tr><th>Turbina</th><th class="r">N (rpm)</th><th class="r">EGT °C</th><th class="r">Potencia kW</th><th>Estado</th></tr></thead><tbody>${mains.map((p) => { const k = e.pumps[p.id]; const on = k.rpm > 0; return `<tr><td>${esc(p.name)}</td><td class="r mono">${fmt(k.rpm, 0)}</td><td class="r mono">${on ? fmt(470 + 60 * (k.load || 0), 0) : '—'}</td><td class="r mono">${fmt(k.kw, 0)}</td><td>${on ? 'En marcha' : 'Parada'}</td></tr>`; }).join('')}</tbody></table></div>`;
      }
      const W = 560, n = mains.length, H = 240;
      const vOk = e.elec.vIn >= LIM.vInLow;
      let g = `<svg viewBox="0 0 ${W} ${H}" class="eq-svg" role="img" aria-label="Unifilar de media tensión de ${esc(NAME[id] || id)}">`;
      g += `<text x="20" y="22" class="eq-t">Línea 33 kV</text><line x1="60" y1="30" x2="60" y2="70" class="eq-w ${vOk ? '' : 'off'}"/>`;
      g += `<rect x="48" y="70" width="24" height="18" class="eq-brk ${e.elec.vIn > 1 ? 'on' : ''}"/><text x="80" y="84" class="eq-t">52-${(TAGN[id] || 100) / 100}</text>`;
      g += `<line x1="60" y1="88" x2="60" y2="104" class="eq-w ${vOk ? '' : 'off'}"/><circle cx="60" cy="116" r="12" class="eq-tr"/><circle cx="60" cy="132" r="12" class="eq-tr"/><text x="80" y="126" class="eq-t">TR-1 · ${e.elec.trMva} MVA · 33/6 kV</text>`;
      g += `<line x1="60" y1="144" x2="60" y2="160" class="eq-w ${e.elec.vBus > 1 ? '' : 'off'}"/><line x1="30" y1="160" x2="${W - 20}" y2="160" class="eq-bus ${e.elec.vBus > 1 ? '' : 'off'}"/><text x="${W - 20}" y="152" text-anchor="end" class="eq-t">Barra 6 kV · ${fmt(e.elec.vBus, 2)} kV</text>`;
      mains.forEach((p, i) => {
        const k = e.pumps[p.id];
        const cx = 90 + i * Math.min(120, (W - 120) / Math.max(1, n - 1 || 1));
        const on = k.amp > 0.5;
        g += `<line x1="${cx}" y1="160" x2="${cx}" y2="${p.drive === 'variador' ? 178 : 196}" class="eq-w ${on ? '' : 'off'}"/>`;
        if (p.drive === 'variador') g += `<rect x="${cx - 14}" y="178" width="28" height="18" class="eq-vfd ${k.vfdFault ? 'bad' : on ? 'on' : ''}"/><text x="${cx}" y="191" text-anchor="middle" class="eq-ts">VFD</text>`;
        g += `<circle cx="${cx}" cy="212" r="13" class="eq-mot ${on ? 'on' : ''}"/><text x="${cx}" y="216" text-anchor="middle" class="eq-ts">M</text><text x="${cx}" y="238" text-anchor="middle" class="eq-ts">${esc(p.name)} · ${fmt(k.amp, 0)} A</text>`;
      });
      g += '</svg>';
      return `<div class="eq-card"><h3 class="sc-h3">Alimentación eléctrica · media tensión <span>33 kV → 6 kV</span></h3><div class="eq-row">${box(tag(id, 'VT', 1), fmt(e.elec.vIn, 2), 'kV', vOk ? '' : 'bad')}${box(tag(id, 'VT', 2), fmt(e.elec.vBus, 2), 'kV')}${box(tag(id, 'JT', 1), fmt(mains.reduce((a, p) => a + e.pumps[p.id].kw, 0), 0), 'kW')}</div>${g}<div class="me-btns"><button type="button" class="sc-btn" data-eq="sag">Simular hueco de tensión</button></div></div>`;
    }
    function box(t, v, u, cls) { return `<div class="sc-box ${cls || ''}"><span class="sc-tag">${t}</span><b>${v}</b><i>${u}</i></div>`; }

    function filtPanel(id) {
      const e = E[id];
      if (!PUMP_ST.includes(id)) return '';
      const f = e.filters;
      const card = (x) => {
        const st2 = x.mode === 'retrolavado' ? 'RETROLAVADO' : x.mode === 'servicio' ? (x.dp >= LIM.filtAlm ? 'OCLUIDO' : x.dp >= LIM.filtWarn ? 'ENSUCIÁNDOSE' : 'EN SERVICIO') : x.fault ? 'FALLA' : 'RESERVA';
        const cls = st2 === 'OCLUIDO' || st2 === 'FALLA' ? 'bad' : st2 === 'ENSUCIÁNDOSE' ? 'warn' : st2 === 'RETROLAVADO' ? 'info' : st2 === 'EN SERVICIO' ? 'ok' : '';
        return `<div class="eq-filt ${cls}"><div class="eq-filt-h"><b>${x.id}</b><span class="eq-st ${cls}">${st2}</span></div><div class="eq-kv"><span>ΔP</span><b>${fmt(x.dp || 0, 2)} kg/cm²</b></div>${bar(x.dp || 0, 1.6, LIM.filtWarn, LIM.filtAlm)}<div class="eq-kv"><span>Ensuciamiento</span><b>${fmt(x.foul * 100 / 1.2, 0)} %</b></div><div class="eq-kv"><span>Retrolavados</span><b>${x.washes}</b></div></div>`;
      };
      return `<div class="eq-card"><h3 class="sc-h3">Filtros autolimpiantes de entrada <span>retrolavado automático a ΔP ${LIM.filtAuto} kg/cm² · alarma ${LIM.filtAlm}</span></h3><div class="eq-filts">${f.map(card).join('')}</div><p class="me-note">La ΔP sube con el caudal (al cuadrado) y con el ensuciamiento. Si el filtro en servicio no puede retrolavar, se ocluye y baja la aspiración de las bombas.</p><div class="me-btns"><button type="button" class="sc-btn" data-eq="wash">Retrolavado manual</button><button type="button" class="sc-btn" data-eq="swapf">Cambiar filtro en servicio</button><button type="button" class="sc-btn" data-eq="clog">Simular obstrucción</button></div></div>`;
    }

    function pumpsPanel(id) {
      const e = E[id], x = st(id);
      const mains = (x.pumps || []).filter((p) => !isBooster(p));
      if (!mains.length) return '';
      if (!pumpSel || !mains.some((p) => p.id === pumpSel)) pumpSel = (mains.find((p) => p.online) || mains[0]).id;
      const t = (v, w, a) => `<td class="r mono ${v >= a ? 'bad' : v >= w ? 'warn' : ''}">${fmt(v, 0)}</td>`;
      let h = `<div class="eq-card eq-wide"><h3 class="sc-h3">Bombas principales · lubricación, cojinetes y vibración <span>tocá una fila para ver su curva</span></h3><div class="me-tablewrap"><table class="me-table"><thead><tr><th>Bomba</th><th>Estado</th><th class="r">Carga</th><th class="r">% BEP</th><th class="r">Coj. LA bomba °C</th><th class="r">Coj. LOA bomba °C</th><th class="r">Coj. LA motor °C</th><th class="r">Coj. LOA motor °C</th><th class="r">Vibración mm/s</th><th class="r">Aceite bar</th><th class="r">Aceite °C</th><th class="r">Nivel %</th><th class="r">Aspiración MOV</th><th class="r">Descarga MOV</th><th class="r">Horas</th></tr></thead><tbody>`;
      for (const p of mains) {
        const k = e.pumps[p.id];
        const on = k.rpm > 0;
        const rc = !on ? '' : k.r < LIM.aorLo || k.r > LIM.aorHi ? 'bad' : k.r < LIM.porLo || k.r > LIM.porHi ? 'warn' : '';
        h += `<tr class="${p.id === pumpSel ? 'sel' : ''}" data-eqpump="${p.id}" style="cursor:pointer"><td><b>${esc(p.name)}</b>${!on ? ' <span class="me-last">disponible</span>' : ''}</td><td>${on ? 'En marcha' : 'Parada'}${k.lubeFault ? ' · <span class="me-warn">lubricación</span>' : ''}</td><td class="r mono">${on ? fmt(k.load * 100, 0) + ' %' : '—'}</td><td class="r mono ${rc}">${on ? fmt(k.r * 100, 0) : '—'}</td>${t(k.brg.pDE, LIM.brgWarn, LIM.brgTrip)}${t(k.brg.pNDE, LIM.brgWarn, LIM.brgTrip)}${t(k.brg.mDE, LIM.brgWarn, LIM.brgTrip)}${t(k.brg.mNDE, LIM.brgWarn, LIM.brgTrip)}<td class="r mono ${k.vib >= LIM.vibTrip ? 'bad' : k.vib >= LIM.vibWarn ? 'warn' : ''}">${fmt(k.vib, 1)}</td><td class="r mono ${k.oilP < LIM.oilTrip ? 'bad' : k.oilP < LIM.oilLow ? 'warn' : ''}">${fmt(k.oilP, 2)}</td><td class="r mono">${fmt(k.oilT, 0)}</td><td class="r mono">${fmt(k.level, 0)}</td><td class="r"><button type="button" class="sc-btn" data-suc="${p.id}" data-open="${k.suc.target > 0.5 ? 0 : 1}">${k.suc.pos > 0.95 ? 'Abierta' : k.suc.pos < 0.05 ? 'Cerrada' : fmt(k.suc.pos * 100, 0) + ' %'} · ${k.suc.target > 0.5 ? 'cerrar' : 'abrir'}</button></td><td class="r"><button type="button" class="sc-btn" data-mov="${p.id}" data-open="${k.mov.target > 0.5 ? 0 : 1}">${k.mov.pos > 0.95 ? 'Abierta' : k.mov.pos < 0.05 ? 'Cerrada' : fmt(k.mov.pos * 100, 0) + ' %'} · ${k.mov.target > 0.5 ? 'cerrar' : 'abrir'}</button></td><td class="r mono">${Math.round(k.hours).toLocaleString('es-AR')}</td></tr>`;
      }
      h += `</tbody></table></div><p class="me-note">Alarma de cojinete ${LIM.brgWarn} °C y disparo ${LIM.brgTrip} °C · vibración ${LIM.vibWarn} / ${LIM.vibTrip} mm/s · aceite mínimo ${LIM.oilLow} bar, disparo ${LIM.oilTrip} bar. Con la bomba parada, la bomba auxiliar de la central mantiene la prelubricación.</p>`;
      const perm = pumpPermissives(id, pumpSel);
      h += `<div class="eq-perm"><b>Permisivos de arranque · ${esc(((x.pumps || []).find((q) => q.id === pumpSel) || {}).name || '')}</b>${perm.map(([t, ok]) => `<span class="${ok ? 'ok' : 'bad'}">${ok ? '✓' : '✗'} ${esc(t)}</span>`).join('')}</div>`;
      if (SV[id]) {
        const v = SV[id], rl = (S().relief || {})[id] || {}, pos = (m) => m.pos > 0.95 ? 'abierta' : m.pos < 0.05 ? 'cerrada' : fmt(m.pos * 100, 0) + ' %';
        h += `<div class="eq-perm"><b>Válvulas de estación y protecciones · ${esc(sn(id))}</b><span>MOV entrada: ${pos(v.in)} <button type="button" class="sc-btn" data-stv="in" data-open="${v.in.target > 0.5 ? 0 : 1}">${v.in.target > 0.5 ? 'cerrar' : 'abrir'}</button></span><span>MOV salida: ${pos(v.out)} <button type="button" class="sc-btn" data-stv="out" data-open="${v.out.target > 0.5 ? 0 : 1}">${v.out.target > 0.5 ? 'cerrar' : 'abrir'}</button></span><span class="${rl.open ? 'bad' : 'ok'}">PSV ${rl.sp || ''} kg/cm²: ${rl.open ? 'ABIERTA · ' + fmt(rl.volM3 || 0, 1) + ' m³ aliviados' : 'cerrada'}</span><span class="${x._pshhInhibit ? 'bad' : 'ok'}">PSHH: ${x._pshhInhibit ? 'INHIBIDA' : 'en servicio'}</span></div>`;
      }
      h += `<div class="eq-curvewrap">${curveSvg(id, pumpSel)}<div class="eq-curvetxt">${curveText(id, pumpSel)}<div class="me-btns"><button type="button" class="sc-btn" data-eq="lube">Falla de central de lubricación</button><button type="button" class="sc-btn" data-eq="heat">Calentamiento de cojinete</button><button type="button" class="sc-btn" data-eq="vib">Desbalanceo (vibración)</button><button type="button" class="sc-btn exec" data-eq="fix">Reparar y normalizar</button></div></div></div></div>`;
      return h;
    }
    function curveSvg(id, pid) {
      const p = (st(id).pumps || []).find((q) => q.id === pid);
      const k = E[id].pumps[pid];
      const Hb = p.boostKgCm2 || 30, Qb = qBep[id];
      const W = 420, H = 230, X0 = 46, X1 = W - 12, T = 12, B = H - 30;
      const X = (q) => X0 + (q / (Qb * 1.5)) * (X1 - X0), Y = (hh) => B - (hh / (Hb * 1.35)) * (B - T);
      let d = '';
      for (let i = 0; i <= 30; i++) { const q = (Qb * 1.5 * i) / 30; const hh = Hb * (1.25 - 0.25 * (q / Qb) ** 2); d += (i ? ' L' : 'M') + X(q).toFixed(1) + ' ' + Y(Math.max(0, hh)).toFixed(1); }
      let e = '';
      for (let i = 0; i <= 30; i++) { const q = (Qb * 1.5 * i) / 30; const rr = q / Qb; const eff = Math.max(0, 1 - 1.1 * (rr - 1) ** 2); e += (i ? ' L' : 'M') + X(q).toFixed(1) + ' ' + Y(eff * Hb * 1.3).toFixed(1); }
      let g = `<svg viewBox="0 0 ${W} ${H}" class="eq-svg" role="img" aria-label="Curva de la bomba ${esc(p.name)} con su punto de operación">`;
      g += `<rect x="${X(Qb * LIM.aorLo)}" y="${T}" width="${X(Qb * LIM.aorHi) - X(Qb * LIM.aorLo)}" height="${B - T}" class="eq-aor"/><rect x="${X(Qb * LIM.porLo)}" y="${T}" width="${X(Qb * LIM.porHi) - X(Qb * LIM.porLo)}" height="${B - T}" class="eq-por"/>`;
      g += `<line x1="${X0}" y1="${B}" x2="${X1}" y2="${B}" class="eq-ax"/><line x1="${X0}" y1="${T}" x2="${X0}" y2="${B}" class="eq-ax"/>`;
      g += `<path d="${e}" class="eq-eff"/><path d="${d}" class="eq-hq"/><line x1="${X(Qb)}" y1="${T}" x2="${X(Qb)}" y2="${B}" class="eq-bep"/><text x="${X(Qb) + 4}" y="${T + 12}" class="eq-ts">BEP</text>`;
      if (k.rpm > 0) g += `<circle cx="${X(Math.min(Qb * 1.5, k.r * Qb))}" cy="${Y(Math.max(0, k.head))}" r="7" class="eq-op ${k.r < LIM.aorLo || k.r > LIM.aorHi ? 'bad' : k.r < LIM.porLo || k.r > LIM.porHi ? 'warn' : ''}"/>`;
      g += `<text x="${X1}" y="${H - 8}" text-anchor="end" class="eq-ts">Caudal m³/h · BEP ${Math.round(Qb)}</text><text x="${X0 - 6}" y="${T + 8}" text-anchor="end" class="eq-ts">H</text><text x="${X0 + 6}" y="${H - 8}" class="eq-ts">kg/cm²</text></svg>`;
      return g;
    }
    function curveText(id, pid) {
      const p = (st(id).pumps || []).find((q) => q.id === pid);
      const k = E[id].pumps[pid];
      const on = k.rpm > 0;
      const zone = !on ? 'parada' : k.r < LIM.aorLo ? 'fuera de curva: caudal muy bajo, riesgo de recirculación y calentamiento' : k.r > LIM.aorHi ? 'fuera de curva: caudal muy alto, riesgo de cavitación' : k.r < LIM.porLo || k.r > LIM.porHi ? 'fuera de la zona preferida: más vibración y desgaste' : 'dentro de la zona preferida de operación';
      return `<h3 class="sc-h3">${esc(p.name)} <span>${esc(p.drive || 'directa')}</span></h3><div class="eq-row">${box('Q', fmt(on ? k.r * qBep[id] : 0, 0), 'm³/h')}${box('H', fmt(k.head, 1), 'kg/cm²')}${box('rpm', fmt(k.rpm, 0), '')}${box('kW', fmt(k.kw, 0), '')}</div><p class="me-note"><b>${fmt(on ? k.r * 100 : 0, 0)} % del BEP</b>: ${zone}. Zona preferida ${LIM.porLo * 100}–${LIM.porHi * 100} % (verde) y admisible ${LIM.aorLo * 100}–${LIM.aorHi * 100} % (gris).</p>`;
    }
    function vfdPanel(id) {
      const e = E[id], x = st(id);
      const vfds = (x.pumps || []).filter((p) => !isBooster(p) && p.drive === 'variador');
      if (!vfds.length) return '';
      return `<div class="eq-card"><h3 class="sc-h3">Sala de variadores <span>temperatura ${fmt(e.vfdRoom, 1)} °C · aire acondicionado ${e.hvacFail ? '<b class="eq-bad">EN FALLA</b>' : 'normal'}</span></h3><table class="me-table"><thead><tr><th>Variador</th><th class="r">Hz</th><th class="r">rpm</th><th class="r">A</th><th class="r">Par %</th><th class="r">Gabinete °C</th><th>Estado</th></tr></thead><tbody>${vfds.map((p) => { const k = e.pumps[p.id]; const on = k.hz > 0; return `<tr><td>VFD ${esc(p.name)}</td><td class="r mono">${fmt(k.hz, 1)}</td><td class="r mono">${fmt(k.rpm, 0)}</td><td class="r mono">${fmt(k.amp, 0)}</td><td class="r mono">${on ? fmt(60 + 35 * Math.min(1, k.load), 0) : '—'}</td><td class="r mono">${fmt(e.vfdRoom + (on ? 8 + 6 * k.load : 1), 0)}</td><td>${k.vfdFault ? '<span class="me-warn">FALLA · sobrecorriente</span>' : on ? 'En marcha' : 'Listo'}</td></tr>`; }).join('')}</tbody></table><div class="me-btns"><button type="button" class="sc-btn" data-eq="vfd">Simular falla de variador</button><button type="button" class="sc-btn" data-eq="hvac">Falla de aire acondicionado</button><button type="button" class="sc-btn exec" data-eq="vfdreset">Rearmar variadores</button></div></div>`;
    }
    function trapPanel(id) {
      const x = st(id);
      if (!x.pigTrap) return '';
      const tr = E[id].trap, pig = S().pig || {};
      const launcher = /lanzadora/.test(x.pigTrap.type || ''), receiver = /receptora/.test(x.pigTrap.type || '');
      const fresh = (o) => o && Date.now() - o.tMs < 15000;
      const W = 560, H = 170;
      let g = `<svg viewBox="0 0 ${W} ${H}" class="eq-svg" role="img" aria-label="Trampa de scraper de ${esc(NAME[id] || id)} con sensores de paso">`;
      g += `<line x1="10" y1="120" x2="${W - 10}" y2="120" class="eq-pipe"/><text x="180" y="146" class="eq-ts">Línea principal</text>`;
      g += `<rect x="150" y="40" width="250" height="34" rx="16" class="eq-barrel ${pig.active && (pig.fromId === id || pig.atId === id) ? 'on' : ''}"/><text x="275" y="62" text-anchor="middle" class="eq-t">Barril ${launcher && receiver ? 'lanzador / receptor' : launcher ? 'lanzador' : 'receptor'}</text>`;
      g += `<line x1="140" y1="57" x2="150" y2="57" class="eq-pipe"/><line x1="410" y1="57" x2="440" y2="57" class="eq-pipe"/><line x1="440" y1="57" x2="440" y2="120" class="eq-pipe"/><line x1="120" y1="57" x2="120" y2="120" class="eq-pipe thin"/><text x="96" y="90" class="eq-ts">kicker</text>`;
      g += `<g transform="translate(470 120)"><circle r="12" class="eq-xs ${fresh(tr.xsOut) ? 'hit' : ''}"/><text y="4" text-anchor="middle" class="eq-ts">XS</text><text y="32" text-anchor="middle" class="eq-ts">salida</text></g>`;
      g += `<g transform="translate(70 120)"><circle r="12" class="eq-xs ${fresh(tr.xsIn) ? 'hit' : tr.waiting ? 'wait' : ''}"/><text y="4" text-anchor="middle" class="eq-ts">XS</text><text y="32" text-anchor="middle" class="eq-ts">llegada</text></g>`;
      g += '</svg>';
      const stOut = tr.xsOut ? `pasó ${tr.xsOut.t}` : 'sin paso';
      const stIn = tr.waiting ? `esperando pig desde ${sn(pig.fromId)}` : tr.xsIn ? `detectado ${tr.xsIn.t}` : 'sin pig';
      return `<div class="eq-card"><h3 class="sc-h3">Trampa de scraper <span>${esc(x.pigTrap.type || '')}</span></h3>${g}<div class="eq-row"><div class="eq-kv"><span>XS salida</span><b>${stOut}</b></div><div class="eq-kv"><span>XS llegada</span><b>${stIn}</b></div></div><div class="ev-log">${tr.log.length ? tr.log.map((l) => `<div>${esc(l)}</div>`).join('') : '<div class="me-empty">Sin pasos registrados. Lanzá un pig desde SCADA › Integridad.</div>'}</div></div>`;
    }

    function sumpPanel(id) {
      const sp = E[id].sump, pct = sp.volL / sp.capL;
      const W = 560, H = 190, tx = 150, ty = 50, tw = 220, th = 100;
      const lamp = (y, t, on, cls) => `<g transform="translate(40 ${y})"><circle r="7" class="eq-lamp ${on ? cls : ''}"/><text x="14" y="4" class="eq-ts">${t}</text></g>`;
      let g = `<svg viewBox="0 0 ${W} ${H}" class="eq-svg" role="img" aria-label="Tanque sumidero de ${esc(NAME[id] || id)}">`;
      g += lamp(40, 'Muy alto', pct >= 0.85, 'bad') + lamp(66, 'Alto', pct >= 0.7, 'warn') + lamp(118, 'Bajo', pct <= 0.2, 'warn') + lamp(144, 'Muy bajo', pct <= 0.1, 'bad');
      g += `<rect x="${tx}" y="${ty}" width="${tw}" height="${th}" rx="40" class="eq-tank"/><clipPath id="sump-${id}"><rect x="${tx}" y="${ty}" width="${tw}" height="${th}" rx="40"/></clipPath><rect x="${tx}" y="${ty + th * (1 - pct)}" width="${tw}" height="${th * pct}" clip-path="url(#sump-${id})" class="eq-tank-l"/>`;
      g += `<text x="${tx + tw / 2}" y="${ty + 42}" text-anchor="middle" class="eq-t">${fmt(pct * 1500, 0)} mm</text><text x="${tx + tw / 2}" y="${ty + 62}" text-anchor="middle" class="eq-t">${Math.round(sp.volL).toLocaleString('es-AR')} L</text>`;
      g += `<line x1="${tx + 60}" y1="30" x2="${tx + 60}" y2="${ty}" class="eq-pipe thin"/><text x="${tx + 66}" y="26" class="eq-ts">drenajes de trampas, sellos y válvulas</text>`;
      g += `<line x1="${tx + tw}" y1="${ty + th - 14}" x2="430" y2="${ty + th - 14}" class="eq-pipe thin"/><g transform="translate(445 ${ty + th - 14})"><circle r="14" class="eq-pump ${sp.pumpFault ? 'bad' : sp.run ? 'run' : ''}"/><text y="34" text-anchor="middle" class="eq-ts">bomba ${sp.mode === 'auto' ? 'AUTO' : 'MAN'}</text></g><line x1="459" y1="${ty + th - 14}" x2="540" y2="${ty + th - 14}" class="eq-pipe thin"/><text x="470" y="${ty + th - 30}" class="eq-ts">a la línea</text>`;
      g += '</svg>';
      return `<div class="eq-card"><h3 class="sc-h3">Tanque sumidero <span>se vacía reinyectando a la aspiración de la estación</span></h3>${g}<div class="eq-row"><div class="eq-kv"><span>Ingreso pendiente</span><b>${fmt(sp.pend, 0)} L</b></div><div class="eq-kv"><span>Inyección</span><b>${sp.inj ? sp.inj + ' m³/h' : 'parada'}</b></div><div class="me-btns"><button type="button" class="sc-btn" data-eq="sumpmode">${sp.mode === 'auto' ? 'Pasar a manual' : 'Pasar a automático'}</button>${sp.mode === 'man' ? `<button type="button" class="sc-btn exec" data-eq="sumprun">${sp.run ? 'Parar bomba' : 'Inyectar'}</button>` : ''}${sp.pumpFault ? '<button type="button" class="sc-btn" data-eq="sumpfix">Reparar bomba</button>' : ''}</div></div><p class="me-note">Alto nivel 70 % arranca la bomba, bajo 20 % la para, muy bajo 8 % protege por marcha en seco. Si el nivel sube sin un drenaje programado, algo está dejando pasaje: revisar válvulas de drenaje y sellos.</p><div class="ev-log">${sp.log.length ? sp.log.map((l) => `<div>${esc(l)}</div>`).join('') : '<div class="me-empty">Sin movimientos.</div>'}</div></div>`;
    }

    function render() {
      if (!EQ_ST.includes(sel)) sel = EQ_ST[0];
      const id = sel;
      let h = `<div class="pid-top"><div class="pid-sel">${EQ_ST.map((x) => `<button type="button" data-eqst="${x}" class="${x === id ? 'on' : ''}">${esc(sn(x))}</button>`).join('')}</div><div class="pid-title">${esc(NAME[id] || id)} · equipos <span>PK ${st(id).pkKm}</span></div></div>`;
      h += `<div class="sc-ann">${annunciators(id).map(([t, on, pr]) => `<div class="sc-an ${on ? 'on p' + pr : ''}">${t}</div>`).join('')}</div>`;
      h += `<div class="eq-grid">${elecPanel(id)}${filtPanel(id)}${vfdPanel(id)}${trapPanel(id)}${sumpPanel(id)}${pumpsPanel(id)}</div>`;
      return h;
    }

    function click(el) {
      const d = el.dataset;
      if (d.eqst) { sel = d.eqst; pumpSel = null; return true; }
      if (d.eqpump) { pumpSel = d.eqpump; return true; }
      if (d.mov) { setMov(sel, d.mov, d.open === '1'); return true; }
      if (d.suc) { setSuc(sel, d.suc, d.open === '1'); return true; }
      if (d.stv) { setStValve(sel, d.stv, d.open === '1'); return true; }
      const e = E[sel];
      if (!d.eq || !e) return false;
      if (d.eq === 'sumpmode') { e.sump.mode = e.sump.mode === 'auto' ? 'man' : 'auto'; ctx.evLog(`${sn(sel)}: bomba del sumidero en ${e.sump.mode === 'auto' ? 'automático' : 'manual'}`); return true; }
      if (d.eq === 'sumprun') { if (e.sump.pumpFault) return true; e.sump.run = !e.sump.run; ctx.evLog(`${sn(sel)}: ${e.sump.run ? 'inyección manual del sumidero' : 'parada de la bomba del sumidero'}`); return true; }
      if (d.eq === 'sumpfix') { e.sump.pumpFault = false; ctx.evLog(`${sn(sel)}: bomba del sumidero reparada`); return true; }
      const x = st(sel);
      const duty = e.filters.find((f) => f.mode === 'servicio');
      const pumpK = e.pumps[pumpSel];
      const pumpN = ((x.pumps || []).find((p) => p.id === pumpSel) || {}).name || '';
      switch (d.eq) {
        case 'wash': if (duty) { const o = e.filters.find((f) => f !== duty && f.mode === 'reserva'); if (o) { duty.mode = 'retrolavado'; duty.cycle = 0.1; o.mode = 'servicio'; duty.fault = false; ctx.evLog(`${sn(sel)}: retrolavado manual de ${duty.id}`); } } break;
        case 'swapf': if (duty) { const o = e.filters.find((f) => f !== duty && f.mode === 'reserva'); if (o) { duty.mode = 'reserva'; o.mode = 'servicio'; ctx.evLog(`${sn(sel)}: ${o.id} en servicio`); } } break;
        case 'clog': if (duty) { duty.foul += 1.1; duty.fault = true; e.filters.forEach((f) => { if (f !== duty) f.fault = false; }); ctx.evLog(`${sn(sel)}: obstrucción en ${duty.id} y falla de su retrolavado`); } break;
        case 'sag': e.elec.sag = 0.05; ctx.evLog(`${sn(sel)}: hueco de tensión en la línea de 33 kV`); break;
        case 'lube': if (pumpK) { pumpK.lubeFault = true; ctx.evLog(`${sn(sel)}: falla de la central de lubricación de ${pumpN}`); } break;
        case 'heat': if (pumpK) { pumpK.heat = 1; ctx.evLog(`${sn(sel)}: calentamiento de cojinete en ${pumpN}`); } break;
        case 'vib': if (pumpK) { pumpK.vibFault = 1; ctx.evLog(`${sn(sel)}: desbalanceo en ${pumpN}`); } break;
        case 'fix': if (pumpK) { pumpK.lubeFault = false; pumpK.heat = 0; pumpK.vibFault = 0; pumpK.aux = pumpK.aux === 'A' ? 'B' : 'A'; ctx.evLog(`${sn(sel)}: ${pumpN} reparada (central de lubricación en bomba auxiliar ${pumpK.aux})`); } break;
        case 'vfd': { const p = (x.pumps || []).find((q) => q.drive === 'variador' && q.online); if (p) { e.pumps[p.id].vfdFault = true; ctx.evLog(`${sn(sel)}: falla de variador de ${p.name}`); } break; }
        case 'hvac': e.hvacFail = true; ctx.evLog(`${sn(sel)}: falla del aire acondicionado de la sala de variadores`); break;
        case 'vfdreset': e.hvacFail = false; Object.values(e.pumps).forEach((k) => { k.vfdFault = false; }); ctx.evLog(`${sn(sel)}: variadores rearmados y aire acondicionado normal`); break;
        default: return false;
      }
      return true;
    }

    // falla de filtro desde Eventos y fallas
    function clog(id) { const e = E[id]; if (!e) return; const duty = e.filters.find((f) => f.mode === 'servicio'); if (duty) { duty.foul += 1.1; duty.fault = true; } }
    function unclog(id) { const e = E[id]; if (!e) return; e.filters.forEach((f) => { f.fault = false; if (f.mode === 'servicio') { f.mode = 'retrolavado'; f.cycle = 0.1; } else if (f.mode === 'reserva') f.mode = 'servicio'; }); }
    // ---------- permisivos y válvulas de descarga ----------
    function pumpPermissives(id, pid) {
      const e = E[id], x = st(id), s = S();
      const p = (x.pumps || []).find((q) => q.id === pid);
      const k = e && e.pumps[pid];
      if (!p || !k) return [];
      const elc = ctx.ev && ctx.ev.elec ? ctx.ev.elec[id] : null;
      const out = [];
      if (p.drive !== 'turbina') out.push(['Tensión de barra 6 kV normal', e.elec.vBus > 5.4]);
      out.push(['Estación rearmada (sin disparo ni paro de emergencia)', !(ctx.ev && ctx.ev.esd && ctx.ev.esd[id]) && !(elc && !elc.ready)]);
      out.push(['Presión de aceite de lubricación ≥ 1,2 bar', k.oilP >= LIM.oilLow && !k.lubeFault]);
      out.push(['Cojinetes y vibración sin disparo activo', !k.heat && !k.vibFault && Math.max(k.brg.pDE, k.brg.pNDE, k.brg.mDE, k.brg.mNDE) < LIM.brgWarn]);
      out.push(['Válvula de aspiración abierta', k.suc.pos > 0.95]);
      out.push(['Válvula de descarga cerrada', k.mov.pos < 0.05]);
      if (id !== 'ph') out.push(['Presión de aspiración sobre el mínimo', (s.pressuresIn[id] || 0) >= Math.max(1, (x.pAspMinKgCm2 || 3) - 1)]);
      out.push(['Filtro de entrada sin oclusión', (e.dp || 0) < LIM.filtAlm]);
      if (p.drive === 'variador') out.push(['Variador sin falla', !k.vfdFault && e.vfdRoom < 37]);
      out.push(['Sello mecánico sin pérdida', !k.sealLeak]);
      return out;
    }
    function stationPermissives(id) {
      const e = E[id], x = st(id);
      if (!e || !PUMP_ST.includes(id)) return [];
      const elc = ctx.ev && ctx.ev.elec ? ctx.ev.elec[id] : null;
      const mains = (x.pumps || []).filter((p) => !isBooster(p));
      return [
        ['Tensión de entrada 33 kV normalizada', hasTurbineOnly(x) || (e.elec.vIn >= LIM.vInLow && !(elc && !elc.ready))],
        ['Pulsador de paro de emergencia repuesto', !(ctx.ev && ctx.ev.esd && ctx.ev.esd[id])],
        ['Válvulas de descarga de las bombas cerradas', mains.every((p) => e.pumps[p.id].mov.pos < 0.05)],
        ['MOV de entrada y salida de estación abiertas', !SV[id] || (SV[id].in.pos > 0.95 && SV[id].out.pos > 0.95)],
        ['Lubricación de las bombas en servicio', mains.every((p) => !e.pumps[p.id].lubeFault && e.pumps[p.id].oilP >= LIM.oilLow)],
        ['Filtro de entrada disponible', (e.dp || 0) < LIM.filtAlm || e.filters.some((f) => f.mode === 'reserva')],
        ['Sin pérdidas por sello', mains.every((p) => !e.pumps[p.id].sealLeak)],
      ];
    }
    function setMov(id, pid, open) { const k = E[id] && E[id].pumps[pid]; if (!k) return; k.mov.target = open ? 1 : 0; const p = (st(id).pumps || []).find((q) => q.id === pid); ctx.evLog(`${sn(id)}: ${open ? 'abrir' : 'cerrar'} válvula de descarga de ${p ? p.name : pid}`); }
    function closeAllMovs(id) { const e = E[id]; if (!e) return; Object.values(e.pumps).forEach((k) => { k.mov.target = 0; }); ctx.evLog(`${sn(id)}: cierre de todas las válvulas de descarga`); }
    function setSuc(id, pid, open) { const k = E[id] && E[id].pumps[pid]; if (!k) return; k.suc.target = open ? 1 : 0; const p = (st(id).pumps || []).find((q) => q.id === pid); ctx.evLog(`${sn(id)}: ${open ? 'abrir' : 'cerrar'} válvula de aspiración de ${p ? p.name : pid}`); }
    function sucPos(id, pid) { const k = E[id] && E[id].pumps[pid]; return k ? k.suc.pos : null; }
    function setStValve(id, which, open) { const v = SV[id] && SV[id][which]; if (!v) return; v.target = open ? 1 : 0; ctx.evLog(`${sn(id)}: ${open ? 'abrir' : 'cerrar'} MOV de ${which === 'in' ? 'entrada' : 'salida'} de estación`); }
    function stValvePos(id, which) { const v = SV[id] && SV[id][which]; return v ? v.pos : null; }
    function pumpCaseP(id, pid) { const k = E[id] && E[id].pumps[pid]; return k ? k.pCase : null; }
    function markManualStart(id, pid) { const k = E[id] && E[id].pumps[pid]; if (k) k.manualStart = true; }
    function movPos(id, pid) { const k = E[id] && E[id].pumps[pid]; return k ? k.mov.pos : null; }
    function select(id) { if (EQ_ST.includes(id)) { sel = id; pumpSel = null; } }
    function summary(id) {
      const e = E[id];
      if (!e || !PUMP_ST.includes(id)) return null;
      const ks = Object.values(e.pumps);
      return { dp: e.dp || 0, brg: Math.max(...ks.map((k) => Math.max(k.brg.pDE, k.brg.pNDE, k.brg.mDE, k.brg.mNDE))), oil: Math.min(...ks.map((k) => k.oilP)), vIn: e.elec.vIn, alarm: annunciators(id).some((a) => a[1]) };
    }
    function reset() {
      for (const id of EQ_ST) { const e = E[id]; e.hvacFail = false; e.elec.sag = 0; e.filters.forEach((f) => { f.fault = false; f.foul = Math.min(f.foul, 0.3); }); Object.values(e.pumps).forEach((k) => { k.lubeFault = false; k.heat = 0; k.vibFault = 0; k.vfdFault = false; k.sealLeak = false; }); e.trap.sensorFault = false; e.sump.passing = 0; e.sump.pumpFault = false; e.sump.mode = 'auto'; }
      for (const id of SV_ST) { SV[id].in.target = 1; SV[id].out.target = 1; st(id)._pshhInhibit = false; }
    }

    const api = { update, render, click, alarms, annunciators, clog, unclog, reset, state: E, selector: '[data-eqst],[data-eqpump],[data-eq],[data-mov],[data-suc],[data-stv]', pumpPermissives, stationPermissives, setMov, closeAllMovs, markManualStart, movPos, setSuc, sucPos, setStValve, stValvePos, pumpCaseP, SV_ST, select, summary, PUMP_ST, EQ_ST, TRAP_ST, LIM, onStart: null };
    return api;
  }

  global.createEquip = createEquip;
})(window);
