/* SCADA · Faceplate de control de estación: lazos de aspiración, descarga y caudal con selector,
   SP directo, SP por pasos, SP en rampa, Auto/Manual con SP tracking, modo Estación/SCADA y variadores. */
(function (global) {
  'use strict';
  const fmt = (v, d) => (v == null || !isFinite(v) ? '—' : Number(v).toFixed(d == null ? 1 : d));
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const isBooster = (p) => (p.role || '').indexOf('booster') >= 0;

  function createPidFp(app, ctx) {
    const sim = app.sim;
    const S = () => sim.state;
    const st = (id) => sim.stationById(id);
    const eq = () => ctx.equip();
    const evLog = ctx.evLog;
    const F = {};
    const LOOPS = ['asp', 'desc', 'q'];
    // el lazo de caudal existe solo en la cabecera; las demás estaciones controlan solo presiones
    const loopsFor = (id) => (id === 'ph' ? LOOPS : ['asp', 'desc']);
    const NAME = { asp: 'Aspiración', desc: 'Descarga', q: 'Caudal' };
    const UNIT = { asp: 'kg/cm²', desc: 'kg/cm²', q: 'm³/h' };
    const STEP = { asp: 0.5, desc: 0.5, q: 10 };
    const fp = (id) => F[id] || (F[id] = { mode: 'auto', cv: null, tracking: true, released: false, local: false, ramp: { asp: 1, desc: 1, q: 1 }, nsp: {}, run: {}, tune: { asp: { kp: 1.2, ti: 30 }, desc: { kp: 0.8, ti: 20 }, q: { kp: 0.5, ti: 60 } }, showTune: false });
    const span = (lp) => (lp === 'asp' ? 50 : lp === 'desc' ? Math.max(100, ctx.MAOP + 10) : Math.max(1000, ctx.QMAX * 1.3));

    function getSP(id, lp) {
      const x = st(id), s = S();
      if (lp === 'asp') return x.pAspSpKgCm2 != null ? Number(x.pAspSpKgCm2) : null;
      if (lp === 'desc') return x.pDescSpKgCm2 != null ? Number(x.pDescSpKgCm2) : null;
      return id === 'ph' ? s.globalFlowSetpoint : (x._qSp != null ? x._qSp : (x.qMaxM3h || ctx.QMAX));
    }
    function setSP(id, lp, v, why) {
      const x = st(id), s = S();
      if (lp === 'asp') x.pAspSpKgCm2 = clamp(v, 0, 40);
      else if (lp === 'desc') { x.pDescSpKgCm2 = clamp(v, 1, ctx.MAOP); delete x.pDescSpTarget; }
      else if (id === 'ph') { s.globalFlowSetpoint = clamp(v, 0, ctx.QMAX); s.flowTarget = null; if (why !== 'tracking') s.dispatchQ = s.globalFlowSetpoint; }
      else x._qSp = clamp(v, 0, ctx.QMAX * 1.3);
    }
    function getPV(id, lp) {
      const s = S();
      if (lp === 'asp') return s.pressuresIn[id];
      if (lp === 'desc') return s.pressuresOut[id];
      return s.segmentFlows[id];
    }
    // salida de cada lazo y selector de mínima
    function cvs(id) {
      const f = fp(id), v = ctx.stv(id);
      const base = clamp(v.cv || 0, 0, 100);
      const out = {};
      for (const lp of loopsFor(id)) {
        const sp = getSP(id, lp), pv = getPV(id, lp);
        if (sp == null || pv == null) { out[lp] = 100; continue; }
        const e = lp === 'asp' ? (pv - sp) : (sp - pv); // positivo = el lazo pide más bombeo
        out[lp] = clamp(base + f.tune[lp].kp * e / span(lp) * 100 * 4, 0, 100);
      }
      let sel = 'desc';
      for (const lp of loopsFor(id)) if (out[lp] < out[sel] - 0.01) sel = lp;
      out.sel = sel;
      out.out = f.mode === 'man' ? f.cv : out[sel];
      return out;
    }

    // ---------- dinámica: rampas de SP y SP tracking ----------
    let lastT = null;
    function update() {
      const s = S();
      const dtMin = lastT == null ? 0 : Math.max(0, Math.min(5, (s.timeSec - lastT) / 60));
      lastT = s.timeSec;
      for (const id in F) {
        const f = F[id], x = st(id);
        for (const lp of LOOPS) {
          const r = f.run[lp];
          if (!r) continue;
          const cur = getSP(id, lp);
          const step = r.rate * dtMin;
          const nx = Math.abs(r.target - cur) <= step ? r.target : cur + Math.sign(r.target - cur) * step;
          setSP(id, lp, nx, 'ramp');
          if (nx === r.target) { delete f.run[lp]; evLog(`${x.shortName}: SP de ${NAME[lp].toLowerCase()} llegó a ${fmt(r.target, lp === 'q' ? 0 : 1)} ${UNIT[lp]}`); }
        }
        x._manualCv = f.mode === 'man' ? f.cv : null;
        if (x._bumpKg) {
          x._bumpKg *= Math.exp(-dtMin / 0.8);
          if (Math.abs(x._bumpKg) < 0.2) delete x._bumpKg;
          const po = s.pressuresOut[id] || 0;
          if (x._bumpKg > 0 && po >= ctx.MAOP - 0.05 && !s.failedStations[id]) {
            s.tripCause = s.tripCause || {}; sim.failStation(id); s.tripCause[id] = 'Disparo por alta presión de descarga: golpe al pasar a automático sin tracking';
            evLog(`${x.shortName}: DISPARO por alta presión (${fmt(po)} kg/cm²) tras el golpe del controlador`); delete x._bumpKg;
          }
        }
        // SP tracking: en manual el SP sigue a la variable para volver a automático sin salto
        if (f.mode === 'man' && f.tracking && !f.released) {
          for (const lp of loopsFor(id)) { const pv = getPV(id, lp); if (pv != null) setSP(id, lp, pv, 'tracking'); }
        }
      }
    }

    // ---------- pantalla ----------
    function bar(v, max, cls) {
      const h = clamp((v || 0) / max, 0, 1) * 100;
      return `<div class="fp-bar ${cls}"><i style="height:${h.toFixed(1)}%"></i></div>`;
    }
    function loopHtml(id, lp, c) {
      const f = fp(id), sp = getSP(id, lp), pv = getPV(id, lp), d = lp === 'q' ? 0 : 1, mx = span(lp);
      const run = f.run[lp];
      const sel = c.sel === lp;
      return `<div class="fp-loop ${sel ? 'sel' : ''}"><div class="fp-h">${NAME[lp]}${sel ? ' <em>controla</em>' : ''}</div><div class="fp-u"><span>SP</span><span>PV</span><span>CV %</span></div>
        <div class="fp-ro"><input type="number" class="fp-spin" data-fpsp="${lp}" step="${STEP[lp]}" value="${fmt(sp, d)}" title="Salto directo: escribí el SP y presioná Enter"><b>${fmt(pv, d)}</b><b>${fmt(c[lp], 1)}</b></div>
        <div class="fp-bars"><div class="fp-stepcol"><button type="button" data-fpstep="${lp}:1" title="Subir ${STEP[lp]} ${UNIT[lp]}">▲</button>${bar(sp, mx, 'sp')}<button type="button" data-fpstep="${lp}:-1" title="Bajar ${STEP[lp]} ${UNIT[lp]}">▼</button></div>${bar(pv, mx, 'pv')}${bar(c[lp], 100, 'cv')}</div>
        <div class="fp-ramp"><label>Rampa <input type="number" min="0.1" step="0.5" data-fpramp="${lp}" value="${f.ramp[lp]}"> min</label><label>Nuevo SP <input type="number" step="${STEP[lp]}" data-fpnsp="${lp}" value="${f.nsp[lp] != null ? f.nsp[lp] : ''}"> ${UNIT[lp]}</label><div><button type="button" class="sc-btn exec" data-fpgo="${lp}">Sí</button><button type="button" class="sc-btn" data-fpno="${lp}">No</button></div>${run ? `<span class="fp-run">→ ${fmt(run.target, d)} · ${fmt(run.rate, lp === 'q' ? 0 : 2)} ${UNIT[lp]}/min</span>` : ''}</div></div>`;
    }
    function render(id) {
      const x = st(id), f = fp(id), c = cvs(id), e = eq();
      const vfds = (x.pumps || []).filter((p) => !isBooster(p) && p.drive === 'variador');
      const E = e && e.state[id];
      let h = `<div class="fp-wrap"><div class="fp-title">${x.shortName} · control de estación <span>${id === 'ph' ? 'cabecera: lazos de aspiración, descarga y caudal con selector de mínima' : 'estación intermedia: lazos de aspiración y descarga (el caudal lo fija la cabecera)'}</span></div><div class="fp-row">`;
      for (const lp of loopsFor(id)) h += loopHtml(id, lp, c);
      // bloque de control A/M
      h += `<div class="fp-loop fp-ctl"><div class="fp-h">Control</div><div class="fp-mode ${f.mode}">${f.mode === 'man' ? 'MAN' : 'AUTO'} ${fmt(c.out, 1)} %</div><div class="fp-bars"><div class="fp-stepcol">${f.mode === 'man' ? '<button type="button" data-fpcv="1">▲</button>' : ''}${bar(c.out, 100, 'cv')}${f.mode === 'man' ? '<button type="button" data-fpcv="-1">▼</button>' : ''}</div></div><button type="button" class="sc-btn" data-fpam="1">A / M</button>
        <div class="fp-pv"><span>Aspiración <b>${fmt(getPV(id, 'asp'))}</b> kg/cm²</span><span>Descarga <b>${fmt(getPV(id, 'desc'))}</b> kg/cm²</span><span>Caudal <b>${fmt(getPV(id, 'q'), 0)}</b> m³/h${id === 'ph' ? '' : ' (medido)'}</span></div>
        <div class="fp-modo ${f.local ? 'loc' : ''}"><small>Modo control</small><button type="button" data-fploc="1">${f.local ? 'ESTACIÓN' : 'SCADA'}</button></div>
        <div class="fp-modo ${x._spLocal ? 'loc' : ''}"><small>SP de descarga</small><button type="button" data-fpspr="1">${x._spLocal ? 'LOCAL' : 'REMOTO'}</button></div></div>`;
      // variadores
      for (const p of vfds) {
        const k = E && E.pumps[p.id];
        const on = p.online && !S().failedStations[id];
        const man = p._vfdMan != null;
        const pct = on ? (man ? p._vfdMan : c.out) : 0;
        const lamp = (t, onL) => `<span class="fp-lamp ${onL ? 'on' : ''}">${t}</span>`;
        const spD = getSP(id, 'desc'), spA = getSP(id, 'asp');
        h += `<div class="fp-loop fp-vfd"><div class="fp-h">Variador ${p.name.replace(/^B-?/, '')}</div><div class="fp-mode ${man ? 'man' : 'auto'}">${man ? 'M' : 'L'} ${on ? fmt(pct, 0) + ' %' : '—'}</div><div class="fp-bars"><div class="fp-stepcol">${man ? `<button type="button" data-fpvfd="${p.id}:1">▲</button>` : ''}${bar(pct, 100, 'cv')}${man ? `<button type="button" data-fpvfd="${p.id}:-1">▼</button>` : ''}</div></div>
          <button type="button" class="sc-btn" data-fplm="${p.id}">L / M</button><div class="fp-lr ${p._vfdLocal ? 'loc' : ''}">${p._vfdLocal ? 'LOCAL' : 'REMOTO'}</div><button type="button" class="fp-mini" data-fplr="${p.id}">cambiar</button>
          <div class="fp-rpm">${p.name}<b>${on && k ? fmt(k.rpm, 0) : 0} rpm</b></div>
          <div class="fp-lamps">${lamp('Pmax', on && (getPV(id, 'desc') || 0) > (spD || 99) + 1)}${lamp('Pmin', on && spA != null && (getPV(id, 'asp') || 0) < spA - 1)}${lamp('Qmax', on && k && k.r > 1.2)}${lamp('Qmin', on && k && k.r < 0.7)}</div></div>`;
      }
      const eD = (getSP(id, 'desc') || 0) - (getPV(id, 'desc') || 0);
      let warn = '';
      if (f.confirm) warn += `<div class="fp-warn"><b>Atención:</b> el SP de descarga está ${fmt(Math.abs(f.confirm.errD), 1)} kg/cm² ${f.confirm.errD > 0 ? 'por encima' : 'por debajo'} del PV${f.confirm.errQ ? ` y el de caudal ${fmt(Math.abs(f.confirm.errQ), 0)} m³/h ${f.confirm.errQ > 0 ? 'por encima' : 'por debajo'}` : ''}. Al pasar a automático el PID corrige de golpe: pico de presión de descarga o caída de aspiración aguas abajo, posible disparo. Lo seguro es acercar el SP al PV o subirlo de a poco. <button type="button" class="sc-btn" data-fpamno="1">Cancelar</button> <button type="button" class="sc-btn exec" data-fpamok="1">Pasar a AUTO igual</button></div>`;
      else if (f.mode === 'man' && (f.released || !f.tracking) && Math.abs(eD) > 2 && f.pv0 && Math.abs(f.pv0.d - (getPV(id, 'desc') || 0)) > 2) warn += `<div class="fp-warn">SP liberado: el error SP−PV de descarga ya es ${fmt(eD, 1)} kg/cm² y crece sin que el PID actúe. Anotá el SP y volvé a automático solo con PV y SP cerca.</div>`;
      if (x._spLocal) warn += `<div class="fp-warn">SP LOCAL: la estación sostiene ${fmt(getSP(id, 'desc'))} kg/cm² y el centro de control ya no la mueve. Si cambia el caudal, aguas arriba puede subir la presión y aguas abajo quedar corto. Volvé a REMOTO o mové el SP a mano.</div>`;
      h += `</div>${warn}<div class="fp-foot"><button type="button" class="fp-tog ${f.tracking ? 'on' : ''}" data-fptrk="1">SP tracking ${f.tracking ? 'activo' : 'apagado'}</button><button type="button" class="fp-tog ${f.released ? 'on' : ''}" data-fprel="1">${f.released ? 'SP liberado' : 'Liberar SP'}</button><button type="button" class="sc-btn" data-fptune="1">Sintonía</button><button type="button" class="sc-btn" data-goeq="${id}">Equipos</button>
        <span class="fp-help">En automático manda el lazo que pide menos. En manual el operador fija la salida y, con SP tracking, cada SP sigue a su variable (presiones en todas las estaciones; el caudal solo en la cabecera) para volver a automático sin salto. "Liberar SP" corta el seguimiento para dejar un SP fijo antes de volver a automático.</span></div>`;
      if (f.showTune) h += `<div class="fp-tune"><b>Sintonía PI</b>${LOOPS.map((lp) => `<span>${NAME[lp]} Kp <input type="number" step="0.1" data-fpkp="${lp}" value="${f.tune[lp].kp}"> Ti <input type="number" step="5" data-fpti="${lp}" value="${f.tune[lp].ti}"> s</span>`).join('')}</div>`;
      return h + '</div>';
    }

    // ---------- comandos ----------
    function blocked(id) { if (fp(id).local) { app.toast('Control en ESTACIÓN: pasá a SCADA para operar desde la sala'); return true; } return false; }
    function click(el, id) {
      const d = el.dataset, f = fp(id), x = st(id);
      if (d.fploc) { f.local = !f.local; evLog(`${x.shortName}: modo de control ${f.local ? 'ESTACIÓN (local)' : 'SCADA (remoto)'}`); return true; }
      if (d.fptune) { f.showTune = !f.showTune; return true; }
      if (d.fptrk) { f.tracking = !f.tracking; evLog(`${x.shortName}: SP tracking ${f.tracking ? 'activado' : 'desactivado'}`); return true; }
      if (d.fprel) { f.released = !f.released; evLog(`${x.shortName}: ${f.released ? 'SP liberado (deja de seguir a la variable)' : 'SP vuelve a seguir a la variable en manual'}`); return true; }
      if (blocked(id)) return true;
      if (d.fpam || d.fpamok) {
        const c = cvs(id);
        if (f.mode === 'auto') { f.mode = 'man'; f.cv = Math.round(c.out * 10) / 10; f.released = false; f.confirm = null; f.pv0 = { d: getPV(id, 'desc') || 0, q: getPV(id, 'q') || 0 }; evLog(`${x.shortName}: control a MANUAL con salida ${fmt(f.cv, 1)} %`); return true; }
        // lo que el PV se alejó en manual sin que el SP lo siga: eso es lo que el PID corrige de golpe
        const pv0 = f.pv0 || { d: getPV(id, 'desc') || 0, q: getPV(id, 'q') || 0 };
        const lim = (a, b) => (Math.abs(a) < Math.abs(b) ? a : Math.sign(a) * Math.abs(b));
        const errD = lim(pv0.d - (getPV(id, 'desc') || 0), (getSP(id, 'desc') || 0) - (getPV(id, 'desc') || 0));
        const errQ = id === 'ph' ? lim(pv0.q - (getPV(id, 'q') || 0), (getSP(id, 'q') || 0) - (getPV(id, 'q') || 0)) : 0;
        const bumpy = Math.abs(errD) > 2 || Math.abs(errQ) > 50;
        if (bumpy && !d.fpamok) { f.confirm = { errD, errQ }; return true; }
        f.mode = 'auto'; f.cv = null; f.confirm = null; x._manualCv = null;
        if (bumpy) {
          // sin tracking el error se acumuló en silencio: el PID corrige de golpe
          x._bumpKg = clamp(0.6 * errD, -25, 25);
          if (Math.abs(errQ) > 50) { S().surgeBoostKg = Math.min(14, Math.abs(errQ) / 35); S().surgeRemainSec = 120; }
          evLog(`${x.shortName}: paso a AUTOMÁTICO con error SP−PV de ${fmt(errD, 1)} kg/cm²${errQ ? ' y ' + fmt(errQ, 0) + ' m³/h' : ''}: golpe del controlador`);
        } else evLog(`${x.shortName}: control a AUTOMÁTICO sin salto (SP desc ${fmt(getSP(id, 'desc'))} kg/cm²)`);
        return true;
      }
      if (d.fpamno) { f.confirm = null; return true; }
      if (d.fpspr) {
        if (x._spLocal) { x._spLocal = false; if (x._spRemote != null) { x.pDescSpKgCm2 = x._spRemote; delete x._spRemote; } evLog(`${x.shortName}: SP de descarga vuelve a REMOTO (lo mueve el centro de control)`); }
        else { x._spRemote = x.pDescSpKgCm2; x._spLocal = true; x.pDescSpKgCm2 = Math.round((getPV(id, 'desc') || x.pDescSpKgCm2 || 0) * 2) / 2; evLog(`${x.shortName}: SP liberado del centro de control: queda LOCAL en ${fmt(x.pDescSpKgCm2)} kg/cm² y la estación deja de balancear la línea`); }
        return true;
      }
      if (d.fpcv && f.mode === 'man') { f.cv = clamp((f.cv || 0) + Number(d.fpcv) * 2, 0, 100); return true; }
      if (d.fpstep) { const [lp, sg] = d.fpstep.split(':'); setSP(id, lp, (getSP(id, lp) || 0) + Number(sg) * STEP[lp]); delete f.run[lp]; evLog(`${x.shortName}: SP ${NAME[lp].toLowerCase()} ${Number(sg) > 0 ? '+' : '−'}${STEP[lp]} → ${fmt(getSP(id, lp), lp === 'q' ? 0 : 1)} ${UNIT[lp]}`); return true; }
      if (d.fpgo) {
        const lp = d.fpgo, t = Number(f.nsp[lp]);
        if (!isFinite(t) || f.nsp[lp] === '' || f.nsp[lp] == null) { app.toast('Cargá el nuevo SP'); return true; }
        const cur = getSP(id, lp) || 0, T = Math.max(0.1, Number(f.ramp[lp]) || 1);
        f.run[lp] = { target: t, rate: Math.max(0.01, Math.abs(t - cur) / T) };
        evLog(`${x.shortName}: SP ${NAME[lp].toLowerCase()} en rampa ${fmt(cur, lp === 'q' ? 0 : 1)} → ${fmt(t, lp === 'q' ? 0 : 1)} ${UNIT[lp]} en ${T} min`);
        f.nsp[lp] = null; return true;
      }
      if (d.fpno) { f.nsp[d.fpno] = null; delete f.run[d.fpno]; return true; }
      if (d.fplm) { const p = x.pumps.find((q) => q.id === d.fplm); if (p._vfdLocal) { app.toast('Variador en LOCAL'); return true; } if (p._vfdMan != null) { p._vfdMan = null; evLog(`${x.shortName}: variador de ${p.name} a LAZO`); } else { p._vfdMan = Math.round(cvs(id).out); evLog(`${x.shortName}: variador de ${p.name} a MANUAL ${p._vfdMan} %`); } return true; }
      if (d.fpvfd) { const [pid, sg] = d.fpvfd.split(':'); const p = x.pumps.find((q) => q.id === pid); if (p._vfdLocal) { app.toast('Variador en LOCAL'); return true; } p._vfdMan = clamp((p._vfdMan || 0) + Number(sg) * 2, 0, 105); return true; }
      if (d.fplr) { const p = x.pumps.find((q) => q.id === d.fplr); p._vfdLocal = !p._vfdLocal; evLog(`${x.shortName}: variador de ${p.name} en ${p._vfdLocal ? 'LOCAL' : 'REMOTO'}`); return true; }
      return false;
    }
    function change(el, id) {
      const d = el.dataset, f = fp(id), x = st(id);
      if (d.fpramp) { f.ramp[d.fpramp] = Number(el.value) || 1; return true; }
      if (d.fpnsp) { f.nsp[d.fpnsp] = el.value; return true; }
      if (d.fpkp) { f.tune[d.fpkp].kp = Number(el.value) || 0; return true; }
      if (d.fpti) { f.tune[d.fpti].ti = Number(el.value) || 0; return true; }
      if (d.fpsp) { if (blocked(id)) return true; const lp = d.fpsp, v = Number(el.value); if (isFinite(v)) { setSP(id, lp, v); delete f.run[lp]; evLog(`${x.shortName}: SP ${NAME[lp].toLowerCase()} salto directo a ${fmt(v, lp === 'q' ? 0 : 1)} ${UNIT[lp]}`); } return true; }
      return false;
    }
    const selector = '[data-fploc],[data-fptune],[data-fptrk],[data-fprel],[data-fpam],[data-fpamok],[data-fpamno],[data-fpspr],[data-fpcv],[data-fpstep],[data-fpgo],[data-fpno],[data-fplm],[data-fpvfd],[data-fplr]';
    function reset() { for (const id in F) { const x = st(id); x._manualCv = null; (x.pumps || []).forEach((p) => { p._vfdMan = null; p._vfdLocal = false; }); delete F[id]; } }
    return { render, click, change, update, reset, selector, cvs };
  }
  global.createPidFp = createPidFp;
})(window);
