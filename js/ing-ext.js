/* SCADA v6: pig y ETA, integridad de ductos, terminal LC (tanques + programa refinería),
   cierres diarios OMNI/LACT, custody con laboratorios e historial de alarmas. */
(function (global) {
  'use strict';
  const fmt = (v, d) => (v == null || !isFinite(v) ? '—' : Number(v).toFixed(d == null ? 1 : d));
  const n0 = (v) => (v == null || !isFinite(v) ? '—' : Math.round(v).toLocaleString('es-AR'));
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  function gauss() { let u = 0, v = 0; while (!u) u = Math.random(); while (!v) v = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }
  const hhmm = (h) => (h == null || !isFinite(h) ? '—' : `${Math.floor(h)}:${String(Math.round((h % 1) * 60) % 60).padStart(2, '0')} h`);
  const KG_M = 1e5 / (860 * 9.81);

  // UAM (unidades automáticas de medición): 5 propias y 3 de terceros
  const UAM_B = [
    { k: 'PH', st: 'ph', name: 'LACT Puesto Hernández', owner: 'Propia', dir: 'in', lab: 'PH' },
    { k: 'CD', st: 'cd', name: 'LACT Cerro Divisadero (yacimiento)', owner: 'Propia', dir: 'in', lab: 'CD', inj: true },
    { k: 'ES', st: 'sos', name: 'LACT El Sosneado', owner: 'Propia', dir: 'mid', lab: 'ES' },
    { k: 'UG', st: 'ug', name: 'LACT Ugarteche (yacimiento)', owner: 'Propia', dir: 'in', lab: 'LC', inj: true },
    { k: 'LC', st: 'lc', name: 'LACT Luján de Cuyo (recibo)', owner: 'Propia', dir: 'out', lab: 'LC' },
    { k: 'ACO', st: 'ac', name: 'Aconcagua · inyección en AC', owner: 'Tercero', dir: 'in', lab: 'CD', inj: true },
    { k: 'PCR', st: 'mg', name: 'PCR / Hattrick · inyección en ML', owner: 'Tercero', dir: 'in', lab: 'ML', inj: true },
    { k: 'EME', st: 'sos', name: 'EMESA / PCR · inyección en ES', owner: 'Tercero', dir: 'in', lab: 'ES', inj: true },
  ];
  const LABS_B = ['PH', 'CD', 'ML', 'ES', 'LC'];

  function createIngExt(app, ctx) {
    const sim = app.sim;
    const S = () => sim.state;
    const st = (id) => sim.stationById(id);
    // v8: unidades de medición, laboratorios y textos desde la configuración
    const META = S().config._meta || {};
    const CUST = !!META.custom;
    const SORTED = sim.sortedStations().slice().sort((a, b) => (a.pkKm || 0) - (b.pkKm || 0));
    const HN = (st('ph') || {}).shortName || 'PH', TN = (st('lc') || {}).shortName || 'LC';
    const DEST = META.destName || 'refinería';
    const DKIND = (S().config.refinery && S().config.refinery.mode) || 'refineria';
    const RHO = (S().config.hydraulics && S().config.hydraulics.fluidDensity_kg_m3) || 860;
    const UAM = CUST ? [] : UAM_B;
    if (CUST) {
      for (const x of SORTED) {
        const m = x.meters || {};
        const sn = x.shortName;
        if (m.lact || x.id === 'ph' || x.id === 'lc') {
          if (x.id === 'ph') UAM.push({ k: sn, st: x.id, name: `LACT ${x.name}`, owner: 'Propia', dir: 'in', lab: sn });
          else if (x.id === 'lc') UAM.push({ k: sn, st: x.id, name: `LACT ${x.name} (recibo)`, owner: 'Propia', dir: 'out', lab: sn });
          else if (x.type !== 'injection') UAM.push({ k: sn, st: x.id, name: `LACT ${x.name}`, owner: 'Propia', dir: 'mid', lab: sn });
        }
        for (const inj of x.injections || []) UAM.push({ k: (sn + '-I').slice(0, 8), st: x.id, name: `${inj.name} · inyección en ${sn}`, owner: inj.owner || 'Tercero', dir: 'in', lab: sn, inj: true, injOnly: true });
      }
      const seen = new Set();
      for (const u of UAM) { let k = u.k, n = 2; while (seen.has(k)) k = u.k + n++; u.k = k; seen.add(k); }
    }
    const LABS = CUST ? [...new Set(UAM.map((u) => u.lab))] : LABS_B;

    // ---------- muestreo para integridad / linepack ----------
    const series = []; // {t, qin, qout, lp}
    let lastSample = -1;
    function linepackTotal() {
      const lp = S().linepack || {};
      return Object.values(lp).reduce((a, b) => a + (typeof b === 'number' ? b : (b && b.m3) || 0), 0);
    }
    function qIn() {
      let q = S().segmentFlows.ph || 0;
      if (CUST) { for (const x of SORTED) if (x.id !== 'ph') q += sim.stationInjectionTotal(x); return q; }
      for (const id of ['ac', 'cd', 'mg', 'sos', 'ug']) q += sim.stationInjectionTotal(st(id));
      return q;
    }
    function qOut() { return S().segmentFlows.lc || 0; }
    function leakQ() { const r = S().rupture; return r && r.active ? (r.qLeakM3h || 0) * (r.isolated ? 0.2 : 1) : 0; }

    // ---------- cierres diarios (OMNI / LACT) ----------
    const days = []; // [{date, rows:{k:{gov,gsv,nsv,mf,t,p,bsw,dens}}, lpStart, lpEnd, in, out, diff, pct}]
    const acc = {}; UAM.forEach((u) => { acc[u.k] = { gov: 0, tSum: 0, pSum: 0, n: 0 }; });
    let accLp0 = null;
    function uamQ(u) {
      // caudal "real" que pasa por la UAM
      const s = S();
      if (u.k === 'ACO') return sim.stationInjectionTotal(st('ac'));
      if (u.k === 'PCR') return sim.stationInjectionTotal(st('mg'));
      if (u.k === 'EME') return sim.stationInjectionTotal(st('sos'));
      if (u.inj) return sim.stationInjectionTotal(st(u.st));
      return s.segmentFlows[u.st] || 0;
    }
    function uamMeter(u) { return u.inj || (!CUST && ['ACO', 'PCR', 'EME'].includes(u.k)) ? null : ctx.meters[u.st] && ctx.meters[u.st][0]; }
    function labSample(lab) {
      const base = CUST ? RHO + ((LABS.indexOf(lab) * 7) % 11) - 4 : { PH: 858, CD: 862, ML: 870, ES: 866, LC: 862 }[lab] || 862;
      const dens = base + gauss() * 1.2;
      return { dens, api: 141.5 / (dens / 999.0) - 131.5, bsw: Math.max(0.05, 0.30 + gauss() * 0.02 + (lab === 'ML' ? 0.05 : 0)), sal: Math.max(5, 28 + gauss() * 6) };
    }
    const CTL = (T, dens) => { const a = 613.9723 / (dens * dens); const dt = T - 15; return Math.exp(-a * dt * (1 + 0.8 * a * dt)); };
    const CPL = (P) => 1 / (1 - 0.00000079 * P * 98.0665);
    function closeDay(dateLabel, synthetic) {
      const rows = {};
      let tin = 0, tout = 0;
      for (const u of UAM) {
        const a = acc[u.k];
        const lab = labSample(u.lab);
        const T = a.n ? a.tSum / a.n : 30, P = a.n ? a.pSum / a.n : 8;
        const m = uamMeter(u);
        const gov = a.gov;
        const ctl = CTL(T, lab.dens), cpl = CPL(P);
        const gsv = gov * ctl * cpl;
        const nsv = gsv * (1 - lab.bsw / 100);
        rows[u.k] = { gov, gsv, nsv, mf: m ? m.mf : 1, T, P, bsw: lab.bsw, dens: lab.dens, api: lab.api, sal: lab.sal, ctl, cpl };
        if (u.dir === 'in') tin += nsv;
        if (u.dir === 'out') tout += nsv;
        acc[u.k] = { gov: 0, tSum: 0, pSum: 0, n: 0 };
      }
      const lpEnd = linepackTotal();
      const dLp = accLp0 != null ? lpEnd - accLp0 : 0;
      accLp0 = lpEnd;
      const diff = tout + dLp - tin;
      days.unshift({ date: dateLabel, rows, in: tin, out: tout, dLp, diff, pct: tin ? diff / tin * 100 : 0, synthetic: !!synthetic });
      if (days.length > 62) days.pop();
    }
    // historial simulado de 30 días para que custody no arranque vacío
    (function seed() {
      const base = new Date(S().simDate.getTime());
      for (let d = 30; d >= 1; d--) {
        if (CUST) {
          const q0 = (META.defaultPhCabeceraM3h || 600) * (0.96 + gauss() * 0.02);
          let up = q0;
          const qs = {};
          for (const x of SORTED) {
            for (const u of UAM.filter((z) => z.st === x.id)) {
              if (u.injOnly) { const r = (x.injections || []).reduce((a, i) => a + (i.rateM3h || 0), 0) * (1 + gauss() * 0.002); qs[u.k] = r; }
              else qs[u.k] = x.id === 'ph' ? q0 : up;
            }
            up += (x.injections || []).reduce((a, i) => a + (i.rateM3h || 0), 0);
            for (const u of UAM.filter((z) => z.st === x.id && !z.injOnly && x.id === 'lc')) qs[u.k] = up;
          }
          UAM.forEach((u) => {
            const bias = (u.dir === 'out' ? 0.0003 : u.st === 'ph' ? -0.0001 : 0) + gauss() * 0.0003;
            acc[u.k] = { gov: Math.max(0, qs[u.k] || 0) * 24 * (1 + bias), tSum: 30 + gauss(), pSum: 8, n: 1 };
          });
          accLp0 = linepackTotal() + gauss() * 40;
          closeDay(new Date(base.getTime() - d * 86400000).toLocaleDateString('es-AR'), true);
          continue;
        }
        const qph = 600 + gauss() * 25;
        const aco = 10 + Math.abs(gauss() * 4), pcr = 21 + gauss() * 3, eme = 12 + gauss() * 3;
        const qs = { PH: qph, CD: 50, ES: qph + 50 + aco + pcr, UG: 18, LC: qph + 50 + 18 + aco + pcr + eme, ACO: aco, PCR: pcr, EME: eme };
        UAM.forEach((u) => {
          const q = qs[u.k];
          const bias = (u.k === 'LC' ? 0.0003 : u.k === 'PH' ? -0.0001 : 0) + gauss() * 0.0003;
          acc[u.k] = { gov: Math.max(0, q) * 24 * (1 + bias), tSum: 30 + gauss(), pSum: 8, n: 1 };
        });
        accLp0 = linepackTotal() + gauss() * 40;
        const dt = new Date(base.getTime() - d * 86400000);
        closeDay(dt.toLocaleDateString('es-AR'), true);
      }
      accLp0 = linepackTotal();
    })();
    let lastCloseDay = null;

    // ---------- historial de alarmas ----------
    // (lo provee el gestor de alarmas)

    function update() {
      const s = S();
      const t = s.timeSec;
      const dtH = lastSample >= 0 ? Math.max(0, t - lastSample) / 3600 : 0;
      if (lastSample < 0 || t - lastSample >= 60) {
        lastSample = t;
        series.push({ t, qin: qIn(), qout: qOut(), lp: linepackTotal(), leak: leakQ() });
        while (series.length && t - series[0].t > 26 * 3600) series.shift();
        // acumulados OMNI
        for (const u of UAM) {
          const m = uamMeter(u);
          const q = m ? ctx.qInd(m) : uamQ(u) * (1 + 0.0008 * gauss());
          acc[u.k].gov += q * dtH;
          acc[u.k].tSum += 28 + (u.st === 'lc' ? 3 : 0) + gauss() * 0.5;
          acc[u.k].pSum += s.pressuresIn[u.st] || 8;
          acc[u.k].n++;
        }
        // cierre a las 06:00
        const d = s.simDate;
        const key = d.toDateString();
        if (d.getHours() >= 6 && lastCloseDay !== key && t > 3600) {
          lastCloseDay = key;
          closeDay(new Date(d.getTime() - 86400000).toLocaleDateString('es-AR') + ' (06:00)');
          ctx.evLog('Cierre diario OMNI 06:00 generado');
        } else if (lastCloseDay == null) lastCloseDay = key;
      }
    }

    // ---------- pig ----------
    let pigSel = { from: 'ph', type: 'limpieza', auto: true };
    function pigPanel(compact) {
      const s = S();
      const p = s.pig || {};
      const traps = sim.trapStations();
      const types = s.config.pigTypes || [];
      const vLine = sim.velocityKmH(s.segmentFlows.ph || 0);
      let h = `<div class="pg-box ${p.stuck ? 'bad' : ''}">`;
      if (p.active || p.stuck) {
        const etas = sim.pigEtas();
        h += `<div class="pg-h"><b>Pig ${esc(p.typeName || '')} · ${esc(st(p.fromId).shortName)} → ${esc(st(p.toId).shortName)} · PK ${fmt(p.pkKm, 1)}</b><span>${p.stuck ? 'DETENIDO' : fmt(p.speedKmPerHour, 2) + ' km/h (' + fmt(p.speedKmPerHour / 3.6, 2) + ' m/s) · ΔP ' + fmt(p.dPForeAft, 1) + ' kg/cm²'}${p.auto ? ' · corrida completa' : ''}</span></div>`;
        h += `<div class="pg-etas">${etas.map((e) => `<div class="pg-eta ${e.etaH == null ? 'stop' : ''} ${e.dest ? 'dest' : ''} ${e.trap ? '' : 'pass'}"><span>${esc(st(e.id).shortName)}${e.dest ? ' · recibe' : e.trap ? ' · trampa' : ''}</span><b>${e.etaH == null ? 'detenido' : hhmm(e.etaH)}</b><i>PK ${e.pk}</i></div>`).join('')}</div>`;
        if (p.vMinMs && p.vOut > 0) h += `<p class="me-note bad">Fuera de la ventana de velocidad del instrumentado durante ${fmt(p.vOut, 1)} h: los datos de ese tramo no sirven.</p>`;
      } else {
        const at = p.status === 'received' && p.atId ? st(p.atId) : null;
        h += `<div class="pg-h"><b>Pig / scraper</b><span>${at ? `recibido en ${esc(at.shortName)}${p.relaunchInH != null ? ' · relanza en ' + hhmm(p.relaunchInH) : ''}` : 'sin pig en línea'}</span></div>`;
        h += `<p class="me-note">Con ${n0(s.segmentFlows.ph)} m³/h el crudo avanza a ${fmt(vLine, 2)} km/h: ${esc(HN)}→${esc(TN)} ≈ ${hhmm((META.lengthKm || 530) / Math.max(0.1, vLine))} más las maniobras en cada trampa.</p>`;
      }
      if (compact) return h + (p.active ? '' : `<button type="button" class="sc-btn" data-gosub="integridad">Programar corrida de pig</button>`) + '</div>';
      if (!p.active) {
        const fromDef = p.status === 'received' && p.atId && traps.findIndex((x) => x.id === p.atId) < traps.length - 1 ? p.atId : pigSel.from;
        h += `<div class="in-ctl"><label>Trampa lanzadora <select id="pg-from">${traps.slice(0, -1).map((x) => `<option value="${x.id}" ${x.id === fromDef ? 'selected' : ''}>${esc(x.shortName)} · PK ${x.pkKm}</option>`).join('')}</select></label><label>Tipo <select id="pg-type">${types.map((t) => `<option value="${t.id}" ${t.id === pigSel.type ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}</select></label><label><input type="checkbox" id="pg-auto" ${pigSel.auto ? 'checked' : ''}> Corrida completa (relanzar en cada estación)</label><button type="button" class="sc-btn exec" data-pig="launch">Lanzar</button></div>`;
        const t = types.find((x) => x.id === pigSel.type);
        if (t) h += `<p class="me-note">${esc(t.note || '')}${t.vMinMs ? ` · ventana ${t.vMinMs}–${t.vMaxMs} m/s (hoy ${fmt(vLine / 3.6, 2)} m/s)` : ''}</p>`;
      }
      const runs = s.pigRuns || [];
      if (runs.length) h += `<table class="me-table"><thead><tr><th>Tramo</th><th>Tipo</th><th class="r">Horas</th><th>Resultado</th></tr></thead><tbody>${runs.slice(0, 8).map((r) => `<tr><td class="mono">${esc(st(r.from).shortName)}→${esc(st(r.to).shortName)}</td><td>${esc(r.type)}</td><td class="r mono">${fmt(r.hours, 1)}</td><td>${esc(r.result)}</td></tr>`).join('')}</tbody></table>`;
      return h + '</div>';
    }

    // ---------- integridad ----------
    function balanceWindow(h) {
      if (series.length < 2) return null;
      const tEnd = series[series.length - 1].t;
      const pts = series.filter((x) => tEnd - x.t <= h * 3600);
      if (pts.length < 2) return null;
      let vin = 0, vout = 0;
      for (let i = 1; i < pts.length; i++) {
        const dt = (pts[i].t - pts[i - 1].t) / 3600;
        vin += pts[i].qin * dt; vout += (pts[i].qout) * dt;
      }
      const dlp = pts[pts.length - 1].lp - pts[0].lp;
      const imb = vin - vout - dlp;
      return { vin, vout, dlp, imb, pct: vin ? imb / vin * 100 : 0, h };
    }
    function integridad() {
      const s = S();
      const r = s.rupture || {};
      const prof = app.profile || [];
      const wins = [[0.25, 1.5], [1, 0.8], [24, 0.3]].map(([h, th]) => ({ b: balanceWindow(h), th }));
      let h = '<div class="in-grid"><div>';
      h += `<h3 class="sc-h3">Detección de fugas · balance volumétrico compensado por linepack</h3><div class="in-wins">` + wins.map(({ b, th }) => {
        if (!b) return `<div class="in-win"><span>Ventana</span><b>registrando…</b></div>`;
        const alarm = Math.abs(b.pct) > th && b.vin > 10;
        return `<div class="in-win ${alarm ? 'bad' : ''}"><span>Ventana ${b.h < 1 ? Math.round(b.h * 60) + ' min' : b.h + ' h'} · umbral ${th} %</span><b>${b.pct >= 0 ? '+' : ''}${fmt(b.pct, 2)} %</b><i>Entra ${n0(b.vin)} · sale ${n0(b.vout)} · ΔLP ${n0(b.dlp)} m³</i></div>`;
      }).join('') + '</div>';
      // perfil MAOP por tramo
      h += `<h3 class="sc-h3">Uso de MAOP por tramo</h3><table class="me-table"><thead><tr><th>Tramo</th><th class="r">Long. km</th><th class="r">MAOP</th><th class="r">P máx</th><th class="r">P mín</th><th class="r">% MAOP</th><th class="r">Linepack m³</th></tr></thead><tbody>`;
      for (const sg of s.config.segments || []) {
        const a = st(sg.from), b = st(sg.to);
        const pts = prof.filter((x) => x.pk >= a.pkKm && x.pk <= b.pkKm);
        const pmax = Math.max(...pts.map((x) => x.p)), pmin = Math.min(...pts.map((x) => x.p));
        const pct = pmax / sg.maopKgCm2 * 100;
        const lp = s.linepack && s.linepack[sg.id];
        h += `<tr><td class="mono">${a.shortName}–${b.shortName}</td><td class="r mono">${sg.lengthKm}</td><td class="r mono">${sg.maopKgCm2}</td><td class="r mono">${fmt(pmax)}</td><td class="r mono ${pmin < 2 ? 'bad' : ''}">${fmt(pmin)}</td><td class="r mono ${pct >= 90 ? 'bad' : ''}">${fmt(pct, 0)} %</td><td class="r mono">${n0(lp && lp.m3)}</td></tr>`;
      }
      h += `</tbody></table><p class="me-note">P mín &lt; 2 kg/cm² indica riesgo de separación de columna en puntos altos (${CUST ? 'punto alto PK ' + Math.round(META.peakPkKm || 0) : 'peak PK 198 y PK 375'}). Linepack total: <b>${n0(linepackTotal())} m³</b>.</p>`;
      h += `<h3 class="sc-h3">Simulación de pérdida de integridad</h3><div class="in-ctl"><label>PK <input type="number" id="in-pk" min="1" max="529" value="${r.active ? Math.round(r.pkKm) : 212}"></label><label>Severidad <select id="in-sev"><option value="0.3">Fisura (30 %)</option><option value="0.75" selected>Rotura parcial (75 %)</option><option value="1">Rotura total</option></select></label><button type="button" class="sc-btn exec" data-in="leak">Simular fuga</button><button type="button" class="sc-btn" data-in="isolate" ${r.active && !r.isolated ? '' : 'disabled'}>Aislar tramo con VB</button><button type="button" class="sc-btn" data-in="ok" ${r.active ? '' : 'disabled'}>Integridad verificada · normalizar</button></div>`;
      if (r.active) h += `<div class="ev-cd ${r.isolated ? '' : 'out'}"><span class="ev-eyebrow">Evento de integridad</span><b>${r.isolated ? 'Tramo aislado' : 'Fuga activa'} · PK ${fmt(r.pkKm, 0)}</b><p>Caudal de pérdida estimado ${fmt(leakQ(), 0)} m³/h. ${r.isolated ? 'VB cerradas aguas arriba y abajo.' : 'Cerrá las VB más cercanas para limitar el derrame.'}</p></div>`;
      h += '</div><div>';
      h += `<h3 class="sc-h3">Válvulas de bloqueo (VB)</h3><div class="in-vbs">` + s.valves.map((v) => `<div class="in-vb ${v.open ? '' : 'closed'}"><b>${esc(v.name)}</b><span>PK ${v.pkKm}</span><button type="button" class="sc-btn" data-vb="${v.id}" data-open="${v.open ? 0 : 1}">${v.open ? 'Cerrar' : 'Abrir'}</button></div>`).join('') + '</div>';
      h += `<p class="me-note">Cerrar una VB con la línea en movimiento genera golpe de ariete. Primero bajá el caudal.</p>`;
      h += `<h3 class="sc-h3">Transitorios</h3><div class="in-wins"><div class="in-win ${s.surgeRemainSec > 0 ? 'bad' : ''}"><span>Golpe de ariete</span><b>${s.surgeRemainSec > 0 ? '+' + fmt(s.surgeBoostKg) + ' kg/cm²' : 'sin onda'}</b><i>${s.surgeRemainSec > 0 ? 'quedan ' + Math.round(s.surgeRemainSec) + ' s' : 'estable'}</i></div></div>`;
      h += '<h3 class="sc-h3">Pig / scraper · corridas entre trampas</h3>' + pigPanel(false);
      h += '</div></div>';
      return h;
    }

    // ---------- terminal LC ----------
    function terminal() {
      const s = S(), lc = st('lc'), ref = s.config.refinery || { programM3d: 16500 };
      const tks = lc.tanks || [];
      const PORT = ref.mode === 'puerto';
      const inlet = s.segmentFlows.lc || 0, outRate = PORT ? (s.port && s.port.berthed ? (ref.loadRateM3h || 3000) : 0) : ref.programM3d / 24;
      const invTk = tks.reduce((a, t) => a + (t.volumeM3 || 0), 0);
      const extr = tks.reduce((a, t) => a + Math.max(0, (t.volumeM3 || 0) - (t.minOpM3 || 4000)), 0);
      const recv = tks.find((t) => t.mode === 'recibe');
      const toFull = recv && inlet > 1 ? Math.max(0, (recv.maxOpM3 - recv.volumeM3) / inlet) : null;
      const net = (inlet - outRate) * 24;
      let h = '<div class="tl-grid"><div class="tl-tanks">';
      for (const t of tks) {
        const pct = t.volumeM3 / t.capacityM3 * 100, maxP = t.maxOpM3 / t.capacityM3 * 100, minP = t.minOpM3 / t.capacityM3 * 100;
        const mode = { recibe: 'RECIBE DEL DUCTO', entrega: PORT ? 'CARGA DE BUQUE' : DKIND === 'parque' ? 'DESPACHO' : 'ENTREGA A REFINERÍA', reposo: 'REPOSO / DRENAJE', espera: 'EN ESPERA' }[t.mode] || t.mode;
        h += `<div class="tl-tank"><div class="tl-name">${esc(t.name)}</div><div class="tl-shell"><div class="tl-fill ${t.mode}" style="height:${pct.toFixed(1)}%"></div><i class="tl-max" style="bottom:${maxP}%"><span>máx. op.</span></i><i class="tl-min" style="bottom:${minP}%"><span>fondo</span></i></div><b>${n0(t.volumeM3)} m³</b><span class="tl-pct">${fmt(pct, 1)} % de ${n0(t.capacityM3)}</span><em class="tl-mode ${t.mode}">${mode}</em>${t.mode === 'reposo' ? `<span class="tl-pct">libera en ${hhmm(t.settleLeftH)}</span>` : ''}${t.mode === 'recibe' ? `<span class="tl-pct">+${n0(inlet)} m³/h</span>` : t.mode === 'entrega' ? `<span class="tl-pct">−${n0(outRate)} m³/h</span>` : ''}</div>`;
      }
      h += '</div><div>';
      h += `<h3 class="sc-h3">Inventario</h3><div class="me-bal-grid"><div><span>En tanques</span><b>${n0(invTk)} m³</b></div><div><span>Extraíble (sobre fondo)</span><b>${n0(extr)} m³</b></div><div><span>Linepack del ducto</span><b>${n0(linepackTotal())} m³</b></div><div><span>Inventario total</span><b>${n0(invTk + linepackTotal())} m³</b></div><div><span>${CUST ? (PORT ? 'Volumen para carga' : 'Autonomía de ' + esc(DEST)) : 'Autonomía de refinería'}</span><b>${CUST && PORT ? n0(extr) + ' m³' : hhmm(extr / Math.max(1, outRate))}</b></div><div class="${toFull != null && toFull < 6 ? 'bad' : ''}"><span>Tanque receptor lleno en</span><b>${toFull == null ? '—' : hhmm(toFull)}</b></div><div class="${net > 0 ? '' : 'bad'}"><span>Balance diario terminal</span><b>${net >= 0 ? '+' : ''}${n0(net)} m³/d</b></div></div>`;
      if (CUST && PORT) {
        const P = s.port || {};
        h += `<h3 class="sc-h3">Puerto · ${esc(ref.name || DEST)}</h3><div class="me-bal-grid"><div><span>Buque</span><b>${P.berthed ? 'amarrado' : 'en espera'}</b></div><div><span>Cargado</span><b>${n0(P.loadedM3 || 0)} / ${n0(ref.shipM3)} m³</b></div><div><span>Próximo arribo</span><b>${P.berthed ? '—' : hhmm(P.nextShipH != null ? P.nextShipH : ref.firstShipH || 8)}</b></div><div><span>Buques cargados</span><b>${Math.max(0, (P.ships || 0) - (P.berthed ? 1 : 0))}</b></div></div>`;
        h += `<div class="in-ctl"><label>Lote por buque <input type="number" id="tl-ship" min="1000" step="1000" value="${ref.shipM3}"> m³</label><label>Caudal de carga <input type="number" id="tl-load" min="100" step="100" value="${ref.loadRateM3h}"> m³/h</label><label>Intervalo entre buques <input type="number" id="tl-int" min="2" step="1" value="${ref.shipIntervalH}"> h</label><button type="button" class="sc-btn exec" data-tl="port">Aplicar</button><button type="button" class="sc-btn" data-tl="swap">Cambiar tanque receptor</button></div>`;
        h += `<p class="me-note">Un tanque recibe del ducto, otro carga el buque amarrado y el resto queda en reposo o en espera. Si no queda un tanque libre, hay que bajar el bombeo en ${esc(HN)}. Recibo actual ${n0(inlet)} m³/h.</p>`;
      } else if (CUST) {
        const lab = DKIND === 'parque' ? 'Programa de despacho' : 'Programa de ' + esc(DEST);
        h += `<h3 class="sc-h3">${lab}</h3><div class="in-ctl"><label>Despacho programado <input type="number" id="tl-prog" min="0" step="100" value="${ref.programM3d}"> m³/d</label><button type="button" class="sc-btn exec" data-tl="prog">Aplicar programa</button><button type="button" class="sc-btn" data-tl="swap">Cambiar tanque receptor</button></div>`;
        h += `<p class="me-note">Un tanque recibe del ducto mientras otro entrega a ${esc(DEST)}. Al llegar al máximo operativo pasa a reposo y drenaje (${(ref.settleHours || 6)} h). Si no queda un tanque libre, hay que bajar el bombeo en ${esc(HN)}. Recibo actual ${n0(inlet)} m³/h contra un programa de ${n0(outRate)} m³/h.</p>`;
      } else {
      h += `<h3 class="sc-h3">Programa de refinería</h3><div class="in-ctl"><label>Carga programada <input type="number" id="tl-prog" min="0" max="25000" step="100" value="${ref.programM3d}"> m³/d</label><button type="button" class="sc-btn exec" data-tl="prog">Aplicar programa</button><button type="button" class="sc-btn" data-tl="swap">Cambiar tanque receptor</button></div>`;
      h += `<p class="me-note">Un tanque recibe del ducto mientras el otro entrega a refinería. Al llegar al máximo operativo pasa a reposo y drenaje de agua (${(ref.settleHours || 6)} h) antes de entregar. Si los dos están ocupados, hay que bajar el bombeo en PH. Recibo actual ${n0(inlet)} m³/h contra un programa de ${n0(outRate)} m³/h.</p>`;
      h += `<p class="me-note">Capacidades supuestas: 20.000 m³ nominal, 17.500 m³ máximo operativo y 4.000 m³ de fondo por tanque. Se editan en <code>stations-data.js</code>.</p>`;
      }
      h += '</div></div>';
      return h;
    }

    // ---------- cierres OMNI ----------
    let dSel = 0;
    function cierres() {
      const d = days[dSel];
      let h = `<div class="pid-top"><div class="pid-sel">${days.slice(0, 10).map((x, i) => `<button type="button" data-day="${i}" class="${i === dSel ? 'on' : ''}">${esc(x.date.replace(' (06:00)', ''))}</button>`).join('')}</div><div class="pid-title">Cierre diario OMNI · 06:00 <span>${d && d.synthetic ? 'historial simulado' : 'cierre del simulador'}</span></div></div>`;
      if (!d) return h + '<p class="me-empty">Sin cierres todavía.</p>';
      h += `<div class="me-tablewrap"><table class="me-table"><thead><tr><th>UAM</th><th>Titular</th><th class="r">GOV m³</th><th class="r">MF</th><th class="r">T °C</th><th class="r">P kg/cm²</th><th class="r">CTL</th><th class="r">CPL</th><th class="r">GSV m³</th><th class="r">BS&W %</th><th class="r">NSV m³</th><th class="r">ρ15 kg/m³</th><th class="r">API</th></tr></thead><tbody>`;
      for (const u of UAM) {
        const r = d.rows[u.k];
        h += `<tr><td><b>${u.k}</b> <span class="me-last">${esc(u.name)}</span></td><td>${u.owner}</td><td class="r mono">${n0(r.gov)}</td><td class="r mono">${r.mf.toFixed(4)}</td><td class="r mono">${fmt(r.T)}</td><td class="r mono">${fmt(r.P)}</td><td class="r mono">${r.ctl.toFixed(5)}</td><td class="r mono">${r.cpl.toFixed(5)}</td><td class="r mono">${n0(r.gsv)}</td><td class="r mono">${fmt(r.bsw, 2)}</td><td class="r mono"><b>${n0(r.nsv)}</b></td><td class="r mono">${fmt(r.dens, 1)}</td><td class="r mono">${fmt(r.api, 1)}</td></tr>`;
      }
      h += `</tbody></table></div><div class="me-bal-grid" style="margin-top:8px"><div><span>Entradas NSV</span><b>${n0(d.in)} m³</b></div><div><span>Recibo ${esc(TN)} NSV</span><b>${n0(d.out)} m³</b></div><div><span>Δ linepack</span><b>${n0(d.dLp)} m³</b></div><div class="${Math.abs(d.pct) > 0.089 ? 'bad' : ''}"><span>Diferencia del día</span><b>${d.diff >= 0 ? '+' : ''}${n0(d.diff)} m³ · ${fmt(d.pct, 3)} %</b></div></div>`;
      h += `<p class="me-note">GOV = volumen bruto del computador de flujo (pulsos × MF). GSV = GOV × CTL × CPL (corregido a 15 °C y presión atmosférica). NSV = GSV × (1 − BS&W). El cierre se genera solo a las 06:00 del tiempo simulado; con 720× pasa cada 2 minutos.</p><div class="me-btns"><button type="button" class="sc-btn exec" data-close-day="1">Forzar cierre ahora</button><button type="button" class="sc-btn" data-csv="cierre">Exportar cierre (CSV)</button></div>`;
      return h;
    }

    // ---------- custody ----------
    function custody() {
      const month = days.slice(0, 30);
      const sumIn = month.reduce((a, d) => a + d.in, 0), sumDiff = month.reduce((a, d) => a + d.diff, 0);
      const pctM = sumIn ? sumDiff / sumIn * 100 : 0;
      const tolM = 0.089, tolA = 0.026;
      let h = `<div class="cu-head"><div class="cu-kpi"><span>Bombeo diario promedio</span><b>${n0(month.reduce((a, d) => a + d.out, 0) / Math.max(1, month.length))} m³/d</b><i>${CUST ? 'plan ' + n0(META.dailyPlanM3d) + ' m³/d' : 'objetivo 16.500 · 85 % del crudo de CILC'}</i></div><div class="cu-kpi ${Math.abs(pctM) > tolM ? 'bad' : 'ok'}"><span>Balance ${esc(TN)} – resto · 30 días</span><b>${sumDiff >= 0 ? '+' : ''}${n0(sumDiff)} m³</b><i>${pctM >= 0 ? '+' : ''}${fmt(pctM, 3)} % · tolerancia mensual ± ${tolM} % (± ${n0(sumIn * tolM / 100)} m³)</i></div><div class="cu-kpi"><span>Tolerancia anual</span><b>± ${tolA} %</b><i>± ${n0(sumIn * 12 * tolA / 100)} m³ proyectado</i></div><div class="cu-kpi"><span>Medición</span><b>${UAM.length} UAM · ${LABS.length} lab.</b><i>${UAM.filter((u) => u.owner === 'Propia').length} propias y ${UAM.filter((u) => u.owner !== 'Propia').length} de terceros</i></div></div>`;
      // gráfico diario
      const W = 1000, H = 200, pad = 40;
      const vals = month.slice().reverse();
      const maxA = Math.max(0.2, ...vals.map((d) => Math.abs(d.pct)));
      const X = (i) => pad + i * ((W - pad * 2) / Math.max(1, vals.length - 1));
      const Y = (v) => H / 2 - (v / maxA) * (H / 2 - 20);
      let svg = `<svg viewBox="0 0 ${W} ${H}" class="cu-chart" role="img" aria-label="Diferencia diaria del balance en porcentaje"><line x1="${pad}" x2="${W - pad}" y1="${Y(0)}" y2="${Y(0)}" class="cu-zero"/><rect x="${pad}" y="${Y(tolM)}" width="${W - pad * 2}" height="${Y(-tolM) - Y(tolM)}" class="cu-band"/><text x="${W - pad + 4}" y="${Y(tolM) + 4}" class="cu-t">+${tolM} %</text><text x="${W - pad + 4}" y="${Y(-tolM) + 4}" class="cu-t">−${tolM} %</text>`;
      vals.forEach((d, i) => { svg += `<rect x="${X(i) - 9}" y="${Math.min(Y(0), Y(d.pct))}" width="18" height="${Math.abs(Y(d.pct) - Y(0))}" class="cu-bar ${Math.abs(d.pct) > tolM ? 'bad' : ''}"><title>${esc(d.date)} · ${fmt(d.pct, 3)} %</title></rect>`; });
      svg += `<text x="${pad}" y="${H - 4}" class="cu-t">${esc(vals[0] ? vals[0].date : '')}</text><text x="${W - pad}" y="${H - 4}" text-anchor="end" class="cu-t">${esc(vals.length ? vals[vals.length - 1].date : '')}</text></svg>`;
      h += `<h3 class="sc-h3">Diferencia diaria (recibo + Δ linepack − entradas) / entradas</h3><div class="cu-chartwrap">${svg}</div>`;
      // tabla diaria
      h += `<div class="cu-grid"><div><h3 class="sc-h3">Balance diario</h3><div class="me-tablewrap" style="max-height:320px"><table class="me-table"><thead><tr><th>Día</th><th class="r">Entradas NSV</th><th class="r">Recibo NSV</th><th class="r">Δ LP</th><th class="r">Dif. m³</th><th class="r">%</th></tr></thead><tbody>` +
        month.map((d) => `<tr><td>${esc(d.date)}</td><td class="r mono">${n0(d.in)}</td><td class="r mono">${n0(d.out)}</td><td class="r mono">${n0(d.dLp)}</td><td class="r mono">${n0(d.diff)}</td><td class="r mono ${Math.abs(d.pct) > tolM ? 'bad' : ''}">${fmt(d.pct, 3)}</td></tr>`).join('') + '</tbody></table></div></div>';
      // laboratorios
      const last = days[0];
      h += `<div><h3 class="sc-h3">Laboratorios · último cierre</h3><table class="me-table"><thead><tr><th>Lab.</th><th class="r">ρ15 kg/m³</th><th class="r">API</th><th class="r">BS&W %</th><th class="r">Sal g/m³</th><th>Estado</th></tr></thead><tbody>`;
      for (const lb of LABS) {
        const u = UAM.find((x) => x.lab === lb && last.rows[x.k]);
        const r = last.rows[u.k];
        const oos = r.bsw > 0.5 || r.sal > 45;
        h += `<tr><td><b>${lb}</b></td><td class="r mono">${fmt(r.dens, 1)}</td><td class="r mono">${fmt(r.api, 1)}</td><td class="r mono ${r.bsw > 0.5 ? 'bad' : ''}">${fmt(r.bsw, 2)}</td><td class="r mono ${r.sal > 45 ? 'bad' : ''}">${fmt(r.sal, 0)}</td><td>${oos ? '<span class="me-warn">Fuera de especificación</span>' : 'En especificación'}</td></tr>`;
      }
      h += `</tbody></table><p class="me-note">Especificación de referencia para recibo: BS&W ≤ 0,5 % y sal ≤ 45 g/m³. Los resultados de laboratorio entran en el NSV del cierre.</p><h3 class="sc-h3">Unidades de medición (UAM)</h3><ul class="cu-uam">${UAM.map((u) => `<li><b>${u.k}</b> ${esc(u.name)} <em class="${u.owner === 'Propia' ? 'own' : 'third'}">${u.owner}</em></li>`).join('')}</ul></div></div>`;
      h += `<div class="me-btns"><button type="button" class="sc-btn" data-csv="custody">Exportar balance 30 días (CSV)</button></div>`;
      return h;
    }

    // ---------- historial de alarmas ----------
    let alFilter = { st: '', prio: '' };
    function alarmlog() {
      const hist = app.alarms.history();
      const rows = hist.filter((x) => (!alFilter.st || x.tag === alFilter.st) && (!alFilter.prio || String(x.prio) === alFilter.prio));
      const tags = [...new Set(hist.map((x) => x.tag))].sort();
      let h = `<div class="in-ctl"><label>Estación <select id="al-st"><option value="">Todas</option>${tags.map((t) => `<option ${alFilter.st === t ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select></label><label>Prioridad <select id="al-prio"><option value="">Todas</option>${[1, 2, 3].map((p) => `<option value="${p}" ${alFilter.prio === String(p) ? 'selected' : ''}>${p}</option>`).join('')}</select></label><span class="me-last">${rows.length} registros (${hist.length} en total)</span><button type="button" class="sc-btn" data-csv="alarmas">Exportar CSV</button></div>`;
      h += `<div class="me-tablewrap" style="max-height:620px"><table class="me-table"><thead><tr><th>Fecha / hora sim.</th><th>Evento</th><th>Prio</th><th>Tag</th><th>Descripción</th><th>Operador</th></tr></thead><tbody>` +
        (rows.length ? rows.slice(0, 400).map((x) => `<tr><td class="mono">${esc(x.when)}</td><td><span class="al-ev ${x.ev}">${x.ev}</span></td><td><span class="hmi-prio p${x.prio}">${x.prio}</span></td><td class="mono">${esc(x.tag)}</td><td>${esc(x.text)}</td><td>${x.ev === 'ACK' ? 'sala de control' : '—'}</td></tr>`).join('') : '<tr><td colspan="6" class="me-empty">Sin registros todavía.</td></tr>') + '</tbody></table></div>';
      h += '<p class="me-note">ALM = alarma nueva · ACK = reconocida por el operador · RTN = volvió a normal. Se guardan las últimas 2.000 transiciones.</p>';
      return h;
    }

    // ---------- CSV ----------
    async function saveCsv(name, rows) {
      const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(';')).join('\n');
      let dl = null;
      try { dl = window.claude && window.claude.use ? await window.claude.use('downloads') : null; } catch (e) { dl = null; }
      if (dl) { try { await dl.save({ filename: name, data: '﻿' + csv }); app.toast('Archivo guardado'); } catch (e) { if (e && e.code !== 'declined') app.toast('No se pudo exportar'); } return; }
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv' }));
      a.download = name; document.body.appendChild(a); a.click(); a.remove();
    }

    function click(t) {
      const d = t.dataset;
      const s = S();
      if (d.pig === 'launch') {
        const f = document.getElementById('pg-from'), ty = document.getElementById('pg-type'), au = document.getElementById('pg-auto');
        if (f) pigSel = { from: f.value, type: ty.value, auto: au.checked };
        const ok = sim.launchPig({ from: pigSel.from, type: pigSel.type, auto: pigSel.auto });
        if (ok) ctx.evLog(`Pig ${sim.pigTypeById(pigSel.type).name} lanzado desde ${st(pigSel.from).shortName}`);
        return true;
      }
      if (d.gosub) { ctx.setSub(d.gosub); return true; }
      if (d.in === 'leak') {
        const pk = Number(document.getElementById('in-pk').value) || 212;
        const sev = Number(document.getElementById('in-sev').value) || 0.75;
        s._pendingRupturePk = pk; sim.applyScenario('fuga_rotura_pk');
        if (s.rupture) s.rupture.severity = sev;
        ctx.evLog(`Fuga simulada en PK ${pk}`); return true;
      }
      if (d.in === 'isolate') { sim.isolateRuptureSegment(); ctx.evLog('Tramo con fuga aislado (VB)'); return true; }
      if (d.in === 'ok') { sim.setRuptureIntegrityOk && sim.setRuptureIntegrityOk(true); app.normalOps(); ctx.evLog('Integridad verificada · línea normalizada'); return true; }
      if (d.vb) {
        const open = d.open === '1';
        sim.setValve(d.vb, open);
        if (!open && s.lineFlow > 200) { s.surgeBoostKg = 12; s.surgeRemainSec = 240; sim.logEvent('Cierre de VB con línea en movimiento → golpe de ariete', 'scenario'); }
        ctx.evLog(`${d.vb.toUpperCase()} ${open ? 'abierta' : 'cerrada'}`); return true;
      }
      if (d.tl === 'prog') {
        const v = Number(document.getElementById('tl-prog').value);
        if (isFinite(v) && v >= 0) { s.config.refinery = Object.assign(s.config.refinery || {}, { programM3d: v }); ctx.evLog(`Programa de ${CUST ? DEST : 'refinería'}: ${v} m³/d`); }
        return true;
      }
      if (d.tl === 'port') {
        const r = s.config.refinery;
        const sh = Number(document.getElementById('tl-ship').value), ld = Number(document.getElementById('tl-load').value), iv = Number(document.getElementById('tl-int').value);
        if (sh > 0) r.shipM3 = sh; if (ld > 0) r.loadRateM3h = ld; if (iv > 0) r.shipIntervalH = iv;
        ctx.evLog(`Puerto: lote ${r.shipM3} m³ · carga ${r.loadRateM3h} m³/h · cada ${r.shipIntervalH} h`);
        return true;
      }
      if (d.tl === 'swap') {
        const tks = st('lc').tanks;
        const r = tks.find((x) => x.mode === 'recibe');
        const o = CUST ? tks.filter((x) => x !== r && x.mode !== 'entrega').sort((a, b) => a.volumeM3 - b.volumeM3)[0] : tks.find((x) => x !== r);
        if (r && o) { r.mode = 'reposo'; r.settleLeftH = (s.config.refinery && s.config.refinery.settleHours) || 6; r.ready = false; o.mode = 'recibe'; o.ready = false; ctx.evLog(`Terminal ${TN}: ${o.name} pasa a recibir`); }
        return true;
      }
      if (d.day != null) { dSel = Number(d.day); return true; }
      if (d.closeDay) { closeDay(s.simDate.toLocaleDateString('es-AR') + ' (manual)'); dSel = 0; ctx.evLog('Cierre OMNI forzado'); return true; }
      if (d.csv === 'cierre' && days[dSel]) {
        const x = days[dSel];
        saveCsv(`cierre-omni-${x.date.replace(/[^0-9]/g, '-')}.csv`, [['UAM', 'Titular', 'GOV m3', 'MF', 'T C', 'P kg/cm2', 'CTL', 'CPL', 'GSV m3', 'BSW %', 'NSV m3', 'Dens15', 'API']].concat(UAM.map((u) => { const r = x.rows[u.k]; return [u.k, u.owner, r.gov.toFixed(1), r.mf.toFixed(5), r.T.toFixed(2), r.P.toFixed(2), r.ctl.toFixed(5), r.cpl.toFixed(5), r.gsv.toFixed(1), r.bsw.toFixed(3), r.nsv.toFixed(1), r.dens.toFixed(1), r.api.toFixed(1)]; })));
        return true;
      }
      if (d.csv === 'custody') { saveCsv('balance-custody-30d.csv', [['Dia', 'Entradas NSV', 'Recibo NSV', 'Delta LP', 'Dif m3', 'Dif %']].concat(days.slice(0, 30).map((x) => [x.date, x.in.toFixed(1), x.out.toFixed(1), x.dLp.toFixed(1), x.diff.toFixed(1), x.pct.toFixed(4)]))); return true; }
      if (d.csv === 'alarmas') { saveCsv('historial-alarmas.csv', [['Fecha', 'Evento', 'Prio', 'Tag', 'Descripcion']].concat(app.alarms.history().map((x) => [x.when, x.ev, x.prio, x.tag, x.text]))); return true; }
      return false;
    }
    function change(t) {
      if (t.id === 'pg-type' || t.id === 'pg-from' || t.id === 'pg-auto') {
        const f = document.getElementById('pg-from'), ty = document.getElementById('pg-type'), au = document.getElementById('pg-auto');
        pigSel = { from: f.value, type: ty.value, auto: au.checked };
        return true;
      }
      if (t.id === 'al-st') { alFilter.st = t.value; return true; }
      if (t.id === 'al-prio') { alFilter.prio = t.value; return true; }
      return false;
    }

    return {
      update, click, change, pigPanel,
      render: { integridad, terminal, cierres, custody, alarmlog },
      selector: '[data-pig],[data-gosub],[data-in],[data-vb],[data-tl],[data-day],[data-close-day],[data-csv]',
    };
  }

  global.createIngExt = createIngExt;
})(window);
