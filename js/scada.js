/* Sala de control HMI de alto rendimiento (filosofía ISA-101): gris, color solo para lo anormal. */
(function (global) {
  'use strict';
  const NS = 'http://www.w3.org/2000/svg';
  const ORDER_BETA = ['ph', 'ac', 'cd', 'mg', 'sos', 'pa', 'rt', 'ug', 'lc'];

  function el(tag, attrs, parent) {
    const e = document.createElementNS(NS, tag);
    for (const k in attrs || {}) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }
  function fmt(v, d) { return v == null || !isFinite(v) ? '—' : Number(v).toFixed(d == null ? 1 : d); }
  function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

  function createScada(app) {
    const sim = app.sim;
    const svg = document.getElementById('hmi-svg');
    const X0 = 80, X1 = 1320;
    const META = (app.config && app.config._meta) || {};
    const CUST = !!META.custom;
    const ORDER = CUST ? sim.sortedStations().slice().sort((a, b) => (a.pkKm || 0) - (b.pkKm || 0)).map((x) => x.id) : ORDER_BETA;
    const HN = (sim.stationById('ph') || {}).shortName || 'PH';
    const TN = (sim.stationById('lc') || {}).shortName || 'LC';
    // escala vertical del perfil
    let YMIN = 0, YMAX = 4000, YSTEP = 1000;
    if (CUST) {
      let eMin = Infinity, eMax = -Infinity;
      for (const sm of app.geo.samples) { eMin = Math.min(eMin, sm.e); eMax = Math.max(eMax, sm.e); }
      const rho = (app.config.hydraulics && app.config.hydraulics.fluidDensity_kg_m3) || 860;
      const head = (META.opMaxKgCm2 || 80) * 1e5 / (rho * 9.81);
      const hi = Math.max(eMax + 100, app.geo.elevAt(0) + head * 1.05);
      const span0 = Math.max(100, hi - Math.min(eMin, 0 < eMin ? eMin : eMin));
      const nice = [10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000];
      YSTEP = nice.find((n) => span0 / n <= 5) || 2000;
      YMIN = Math.floor((eMin - YSTEP * 0.2) / YSTEP) * YSTEP;
      YMAX = Math.ceil(hi / YSTEP) * YSTEP;
    }
    const xs = {};
    ORDER.forEach((id, i) => { xs[id] = X0 + i * ((X1 - X0) / (ORDER.length - 1)); });
    const refs = {};
    let selected = CUST ? (ORDER.includes('cd') ? 'cd' : ORDER[Math.min(1, ORDER.length - 1)]) : 'cd';
    let pending = null; // acción de dos pasos: {kind, id, sub, value, label}
    const trend = [];
    let lastSample = -1;

    function blockX(pk) {
      // PK → x por tramos (el sinóptico no está a escala)
      const sts = ORDER.map((id) => sim.stationById(id)).filter(Boolean);
      for (let i = 1; i < sts.length; i++) {
        const a = sts[i - 1], b = sts[i];
        if (pk <= (b.pkKm || 0)) {
          const f = (pk - (a.pkKm || 0)) / Math.max(1e-6, (b.pkKm || 0) - (a.pkKm || 0));
          return xs[a.id] + (xs[b.id] - xs[a.id]) * f;
        }
      }
      return X1;
    }
    function profX(pk) { return X0 + (pk / app.geo.L) * (X1 - X0); }

    // ---------- construcción del sinóptico ----------
    function build() {
      svg.innerHTML = '';
      el('rect', { x: 0, y: 0, width: 1400, height: 560, fill: 'var(--hmi-bg)' }, svg);

      // ducto
      const PY = 268;
      refs.pipe = el('line', { x1: X0, y1: PY, x2: X1, y2: PY, stroke: 'var(--hmi-pipe)', 'stroke-width': 8, 'stroke-linecap': 'round' }, svg);
      refs.front = el('line', { x1: X1, y1: PY, x2: X1, y2: PY, stroke: 'var(--hmi-bg2)', 'stroke-width': 8, 'stroke-dasharray': '6 6' }, svg);
      refs.flows = {};
      for (let i = 1; i < ORDER.length; i++) {
        const a = ORDER[i - 1], b = ORDER[i];
        const mx = (xs[a] + xs[b]) / 2;
        el('path', { d: `M${mx - 6} ${PY - 4} L${mx + 4} ${PY} L${mx - 6} ${PY + 4}`, fill: 'none', stroke: 'var(--hmi-bg)', 'stroke-width': 2 }, svg);
        refs.flows[b] = el('text', { x: mx, y: PY + 26, 'text-anchor': 'middle', class: 'hmi-t-small' }, svg);
      }
      // válvulas de bloqueo
      refs.valves = {};
      for (const v of sim.state.valves) {
        const x = blockX(v.pkKm || 0);
        const g = el('g', { class: 'hmi-valve', 'data-valve': v.id, transform: `translate(${x} ${PY})` }, svg);
        el('title', {}, g).textContent = `${v.name} · PK ${v.pkKm}`;
        refs.valves[v.id] = el('path', { d: 'M-6 -6 L6 6 L6 -6 L-6 6 Z', fill: 'var(--hmi-bg)', stroke: 'var(--hmi-fg)', 'stroke-width': 1.2 }, g);
      }
      refs.pig = el('path', { d: 'M0 -9 L7 0 L0 9 L-7 0 Z', fill: 'var(--hmi-info)', stroke: 'var(--hmi-fg)', 'stroke-width': 1 }, svg);
      refs.rupt = el('g', {}, svg);
      el('circle', { r: 11, fill: 'var(--hmi-p1)' }, refs.rupt);
      el('text', { y: 4, 'text-anchor': 'middle', class: 'hmi-t-inv' }, refs.rupt).textContent = '!';

      // bloques de estación
      refs.st = {};
      for (const id of ORDER) {
        const st = sim.stationById(id);
        if (!st) continue;
        const x = xs[id];
        const g = el('g', { class: 'hmi-block', 'data-st': id, transform: `translate(${x - 64} 36)`, tabindex: 0, role: 'button' }, svg);
        const box = el('rect', { x: 0, y: 0, width: 128, height: 196, rx: 3, fill: 'var(--hmi-panel)', stroke: 'var(--hmi-line)', 'stroke-width': 1 }, g);
        el('text', { x: 10, y: 24, class: 'hmi-t-tag' }, g).textContent = st.shortName || id.toUpperCase();
        el('text', { x: 10, y: 40, class: 'hmi-t-small' }, g).textContent = (st.name || '').replace(/\s*\(.*\)/, '').slice(0, 20);
        el('text', { x: 118, y: 24, 'text-anchor': 'end', class: 'hmi-t-small' }, g).textContent = 'PK ' + st.pkKm;
        // bombas
        const pumps = (st.pumps || []);
        const prow = [];
        pumps.forEach((p, k) => {
          const booster = p.role && p.role.indexOf('booster') >= 0;
          const sz = booster ? 10 : 15;
          const r = el('rect', { x: 10 + k * 21, y: 52 + (booster ? 3 : 0), width: sz, height: sz, rx: 1.5, 'stroke-width': 1.2 }, g);
          el('title', {}, r).textContent = p.name;
          prow.push({ r, p });
        });
        if (!pumps.length) el('text', { x: 10, y: 64, class: 'hmi-t-small' }, g).textContent = id === 'lc' ? 'Terminal de recibo' : 'Sin bombeo';
        const rows = {};
        [['pin', 'P asp', 96], ['pout', 'P desc', 116], ['q', 'Caudal', 136]].forEach(([k, lab, y]) => {
          el('text', { x: 10, y, class: 'hmi-t-lab' }, g).textContent = lab;
          rows[k + 'bg'] = el('rect', { x: 62, y: y - 13, width: 58, height: 17, rx: 2, fill: 'none' }, g);
          rows[k] = el('text', { x: 116, y, 'text-anchor': 'end', class: 'hmi-t-val' }, g);
        });
        // barra % MAOP
        el('text', { x: 10, y: 160, class: 'hmi-t-lab' }, g).textContent = '% MAOP';
        el('rect', { x: 10, y: 166, width: 108, height: 10, fill: 'var(--hmi-bg2)', stroke: 'var(--hmi-line)', 'stroke-width': 0.8 }, g);
        const bar = el('rect', { x: 10, y: 166, width: 0, height: 10, fill: 'var(--hmi-fg2)' }, g);
        el('line', { x1: 10 + 108 * 0.9, x2: 10 + 108 * 0.9, y1: 163, y2: 179, stroke: 'var(--hmi-fg)', 'stroke-width': 1.2 }, g);
        const pct = el('text', { x: 118, y: 160, 'text-anchor': 'end', class: 'hmi-t-small' }, g);
        const units = el('text', { x: 10, y: 190, class: 'hmi-t-small' }, g);
        units.textContent = 'kg/cm² · m³/h';
        // indicador de alarma
        const al = el('g', { transform: 'translate(112 -6)', visibility: 'hidden' }, g);
        const alShape = el('path', { d: '', 'stroke-width': 1 }, al);
        const alNum = el('text', { y: 4, 'text-anchor': 'middle', class: 'hmi-t-alnum' }, al);
        // conector al ducto
        el('line', { x1: 64, x2: 64, y1: 196, y2: PY - 36 - 6, stroke: 'var(--hmi-line)', 'stroke-width': 1 }, g);
        g.addEventListener('click', () => select(id));
        g.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); select(id); } });
        refs.st[id] = { g, box, prow, rows, bar, pct, al, alShape, alNum };
      }

      // perfil hidráulico (nivel 4)
      const T = 330, B = 530;
      refs.prof = { T, B };
      el('text', { x: X0, y: T - 12, class: 'hmi-t-lab' }, svg).textContent = 'Perfil hidráulico · cota del terreno y línea piezométrica (m s. n. m.)';
      for (let m = YMIN; m <= YMAX; m += YSTEP) {
        const y = B - ((m - YMIN) / (YMAX - YMIN)) * (B - T);
        el('line', { x1: X0, x2: X1, y1: y, y2: y, stroke: 'var(--hmi-grid)', 'stroke-width': 1 }, svg);
        el('text', { x: X0 - 8, y: y + 4, 'text-anchor': 'end', class: 'hmi-t-small' }, svg).textContent = m.toLocaleString('es-AR');
      }
      refs.terrain = el('path', { fill: 'var(--hmi-terrain)', stroke: 'var(--hmi-line)', 'stroke-width': 1 }, svg);
      refs.maopEnv = el('path', { fill: 'none', stroke: 'var(--hmi-fg2)', 'stroke-width': 1, 'stroke-dasharray': '3 4' }, svg);
      refs.hgl = el('path', { fill: 'none', stroke: 'var(--hmi-fg)', 'stroke-width': 2.2 }, svg);
      for (const id of ORDER) {
        const st = sim.stationById(id);
        if (!st) continue;
        const x = profX(st.pkKm || 0);
        el('line', { x1: x, x2: x, y1: T, y2: B, stroke: 'var(--hmi-grid)', 'stroke-width': 1, 'stroke-dasharray': '2 3' }, svg);
        el('text', { x, y: B + 16, 'text-anchor': 'middle', class: 'hmi-t-small' }, svg).textContent = st.shortName || id;
      }
      const pkPk = CUST ? (META.peakPkKm || 0) : 198, pkE = CUST ? app.geo.elevAt(META.peakPkKm || 0) : 1985;
      const peakX = profX(pkPk);
      el('text', { x: peakX + 6, y: B - ((pkE - YMIN) / (YMAX - YMIN)) * (B - T) - 8, class: 'hmi-t-small' }, svg).textContent = (CUST ? 'Punto alto ' : 'Peak ') + Math.round(pkE).toLocaleString('es-AR') + ' m';
      const lg = el('g', { transform: `translate(${X1 - 360} ${T - 16})` }, svg);
      el('line', { x1: 0, x2: 22, y1: -4, y2: -4, stroke: 'var(--hmi-fg)', 'stroke-width': 2.2 }, lg);
      el('text', { x: 28, y: 0, class: 'hmi-t-small' }, lg).textContent = 'HGL';
      el('line', { x1: 80, x2: 102, y1: -4, y2: -4, stroke: 'var(--hmi-fg2)', 'stroke-width': 1, 'stroke-dasharray': '3 4' }, lg);
      el('text', { x: 108, y: 0, class: 'hmi-t-small' }, lg).textContent = 'Límite MAOP';
      el('rect', { x: 196, y: -10, width: 14, height: 10, fill: 'var(--hmi-terrain)', stroke: 'var(--hmi-line)' }, lg);
      el('text', { x: 216, y: 0, class: 'hmi-t-small' }, lg).textContent = 'Terreno';

      // trazado del terreno (fijo)
      const yOf = (m) => B - ((Math.max(YMIN, Math.min(YMAX, m)) - YMIN) / (YMAX - YMIN)) * (B - T);
      let d = `M${X0} ${B}`;
      for (let pk = 0; pk <= app.geo.L; pk += Math.max(0.05, app.geo.L / 180)) d += ` L${profX(pk).toFixed(1)} ${yOf(app.geo.elevAt(pk)).toFixed(1)}`;
      d += ` L${X1} ${B} Z`;
      refs.terrain.setAttribute('d', d);
      refs.yOf = yOf;
    }

    // ---------- actualización del sinóptico ----------
    function stationAlarm(tag) {
      let best = null;
      for (const a of app.alarms.sorted()) {
        if (a.tag !== tag) continue;
        if (!best || a.prio < best.prio || (a.prio === best.prio && !a.acked && best.acked)) best = a;
      }
      return best;
    }
    function maopFor(id) {
      for (const seg of sim.state.config.segments || []) {
        const a = sim.stationById(seg.from), b = sim.stationById(seg.to), s = sim.stationById(id);
        if (a && b && s && (s.pkKm || 0) >= (a.pkKm || 0) && (s.pkKm || 0) < (b.pkKm || 0)) return seg.maopKgCm2;
      }
      return 80;
    }

    function updateOverview(blink) {
      const st = sim.state;
      for (const id of ORDER) {
        const r = refs.st[id];
        if (!r) continue;
        const s = sim.stationById(id);
        const pin = st.pressuresIn[id], pout = st.pressuresOut[id], q = st.segmentFlows[id];
        r.rows.pin.textContent = fmt(pin);
        r.rows.pout.textContent = id === 'lc' || id === 'pa' ? '—' : fmt(pout);
        r.rows.q.textContent = fmt(q, 0);
        const failed = !!st.failedStations[id] || (id === 'ph' && st.phFailed);
        const trip = !!st.tripFlags[id];
        r.prow.forEach(({ r: rect, p }) => {
          const run = p.online && !failed;
          rect.setAttribute('fill', failed ? 'var(--hmi-p1)' : run ? 'var(--hmi-run)' : 'var(--hmi-panel)');
          rect.setAttribute('stroke', failed ? 'var(--hmi-p1)' : 'var(--hmi-fg)');
        });
        // abnormal values get color
        const pMinA = s.pAspSpKgCm2 != null ? s.pAspSpKgCm2 - 1 : 4;
        const lowAsp = s.pumps && s.pumps.length && id !== 'ph' && pin != null && pin < pMinA;
        r.rows.pinbg.setAttribute('fill', lowAsp ? (pin < 3 ? 'var(--hmi-p1)' : 'var(--hmi-p2)') : 'none');
        r.rows.pin.setAttribute('class', 'hmi-t-val' + (lowAsp && pin < 3 ? ' inv' : ''));
        const maop = maopFor(id);
        const frac = pout != null && maop ? pout / maop : 0;
        r.bar.setAttribute('width', (108 * Math.max(0, Math.min(1.05, frac))).toFixed(1));
        r.bar.setAttribute('fill', frac >= 1 ? 'var(--hmi-p1)' : frac >= 0.9 ? 'var(--hmi-p2)' : 'var(--hmi-fg2)');
        r.pct.textContent = id === 'lc' || id === 'pa' ? '' : Math.round(frac * 100) + ' %';
        r.rows.poutbg.setAttribute('fill', frac >= 1 ? 'var(--hmi-p1)' : frac >= 0.9 ? 'var(--hmi-p2)' : 'none');
        r.rows.pout.setAttribute('class', 'hmi-t-val' + (frac >= 1 ? ' inv' : ''));
        r.box.setAttribute('stroke', id === selected ? 'var(--hmi-fg)' : 'var(--hmi-line)');
        r.box.setAttribute('stroke-width', id === selected ? 2.4 : 1);
        if (trip && !failed) r.box.setAttribute('stroke', 'var(--hmi-p1)');
        // alarma
        const a = stationAlarm(s.shortName || id.toUpperCase());
        if (a) {
          r.al.setAttribute('visibility', !a.acked && blink ? 'hidden' : 'visible');
          const shapes = {
            1: ['M-9 -9 H9 V9 H-9 Z', 'var(--hmi-p1)'],
            2: ['M0 -11 L10 8 L-10 8 Z', 'var(--hmi-p2)'],
            3: ['M-10 -8 L10 -8 L0 11 Z', 'var(--hmi-p3)'],
          };
          r.alShape.setAttribute('d', shapes[a.prio][0]);
          r.alShape.setAttribute('fill', shapes[a.prio][1]);
          r.alShape.setAttribute('stroke', 'var(--hmi-fg)');
          r.alNum.textContent = a.prio;
        } else r.al.setAttribute('visibility', 'hidden');
      }
      for (let i = 1; i < ORDER.length; i++) {
        const b = ORDER[i];
        const q = st.segmentFlows[b];
        if (refs.flows[b]) refs.flows[b].textContent = q != null ? `${fmt(q, 0)} m³/h` : '';
      }
      for (const v of st.valves) {
        const p = refs.valves[v.id];
        if (!p) continue;
        p.setAttribute('fill', v.open ? 'var(--hmi-bg)' : 'var(--hmi-p1)');
      }
      // pig
      if (st.pig && st.pig.active) {
        refs.pig.setAttribute('visibility', 'visible');
        refs.pig.setAttribute('transform', `translate(${blockX(st.pig.pkKm || 0)} 268)`);
        refs.pig.setAttribute('fill', st.pig.stuck ? 'var(--hmi-p2)' : 'var(--hmi-info)');
      } else refs.pig.setAttribute('visibility', 'hidden');
      if (st.rupture && st.rupture.active) {
        refs.rupt.setAttribute('visibility', blink && !st.rupture.isolated ? 'hidden' : 'visible');
        refs.rupt.setAttribute('transform', `translate(${blockX(st.rupture.pkKm || 0)} 240)`);
      } else refs.rupt.setAttribute('visibility', 'hidden');
      const front = st.oilReachablePkKm != null ? Math.min(app.geo.L, st.oilReachablePkKm) : app.geo.L;
      refs.front.setAttribute('x1', blockX(front));
      refs.front.setAttribute('visibility', front < app.geo.L - 1 ? 'visible' : 'hidden');

      // perfil
      const prof = app.profile || [];
      if (prof.length) {
        let d = '', e = '';
        const kgToM = 1e5 / (860 * 9.81);
        prof.forEach((p, k) => {
          d += (k ? ' L' : 'M') + profX(p.pk).toFixed(1) + ' ' + refs.yOf(p.hgl).toFixed(1);
          e += (k ? ' L' : 'M') + profX(p.pk).toFixed(1) + ' ' + refs.yOf(p.elev + p.maop * kgToM).toFixed(1);
        });
        refs.hgl.setAttribute('d', d);
        refs.maopEnv.setAttribute('d', e);
      }
    }

    // ---------- faceplate (niveles 2 y 3) ----------
    function select(id) {
      selected = id;
      pending = null;
      renderFace(true);
      updateOverview(false);
    }

    function nearbyValves(st) {
      const sorted = ORDER.map((i) => sim.stationById(i)).filter(Boolean);
      const k = sorted.findIndex((s) => s.id === st.id);
      const lo = k > 0 ? sorted[k - 1].pkKm : 0;
      const hi = k < sorted.length - 1 ? sorted[k + 1].pkKm : app.geo.L;
      return sim.state.valves.filter((v) => v.pkKm > lo && v.pkKm < hi).sort((a, b) => a.pkKm - b.pkKm);
    }

    let faceKey = '';
    function renderFace(force) {
      const box = document.getElementById('hmi-face');
      if (!box) return;
      if (!force && box.contains(document.activeElement) && document.activeElement.tagName === 'INPUT') return;
      const st = sim.stationById(selected);
      if (!st) return;
      const S = sim.state;
      const failed = !!S.failedStations[st.id] || (st.id === 'ph' && S.phFailed);
      const pumps = st.pumps || [];
      const valves = nearbyValves(st);
      const maop = maopFor(st.id);
      const pout = S.pressuresOut[st.id];
      const vals = [
        ['P aspiración', fmt(S.pressuresIn[st.id]), 'kg/cm²'],
        ['P descarga', st.id === 'lc' ? '—' : fmt(pout), 'kg/cm²'],
        ['Caudal', fmt(S.segmentFlows[st.id], 0), 'm³/h'],
        ['% MAOP', st.id === 'lc' ? '—' : Math.round((pout || 0) / maop * 100), '%'],
        ['Cota', (st.elevationMsnm || app.geo.elevAt(st.pkKm || 0)).toLocaleString('es-AR'), 'm'],
        ['DRA', sim.stationDraActive(st) ? fmt(sim.stationDraLph(st), 0) : 'off', sim.stationDraActive(st) ? 'L/h' : ''],
      ];
      const key = JSON.stringify([selected, vals, pumps.map((p) => p.online), valves.map((v) => v.open), failed, pending]);
      if (!force && key === faceKey) return;
      faceKey = key;
      const state = failed ? ['FALLA', 'p1'] : S.tripFlags[st.id] ? ['DISPARO MAOP', 'p1'] : pumps.length ? ['EN SERVICIO', 'ok'] : ['NODO PASIVO', 'ok'];
      let h = `<div class="hmi-ph"><h2>${esc(st.shortName)} · ${esc((st.name || '').replace(/\s*\(.*\)/, ''))}</h2><span class="hmi-state ${state[1]}">${state[0]}</span></div>`;
      h += `<div class="hmi-sub">PK ${st.pkKm} · ${esc(st.opsNote || '')}</div>`;
      h += '<div class="hmi-vals">' + vals.map((v) => `<div><span>${v[0]}</span><b>${v[1]}</b><i>${v[2]}</i></div>`).join('') + '</div>';
      if (pumps.length) {
        h += '<h3 class="hmi-h3">Bombas</h3><table class="hmi-table hmi-pumps"><tbody>';
        for (const p of pumps) {
          const run = p.online && !failed;
          const isPend = pending && pending.kind === 'pump' && pending.sub === p.id;
          h += `<tr><td><span class="hmi-pstate ${run ? 'run' : failed ? 'fail' : 'stop'}"></span>${esc(p.name)}${!run && !failed ? ' <em>disponible</em>' : ''}</td>
            <td>${p.role && p.role.indexOf('booster') >= 0 ? 'Booster' : (p.boostKgCm2 || 0) + ' kg/cm²'}</td>
            <td class="r">${isPend
              ? `<button type="button" class="hmi-btn exec" data-exec="1">Ejecutar: ${pending.label}</button> <button type="button" class="hmi-btn" data-cancel="1">Cancelar</button>`
              : `<button type="button" class="hmi-btn" data-pump="${p.id}" data-on="${run ? 0 : 1}" ${failed ? 'disabled' : ''}>${run ? 'Parar' : 'Arrancar'}</button>`}</td></tr>`;
        }
        h += '</tbody></table>';
      }
      if (st.draCapable !== false && pumps.length) {
        h += `<h3 class="hmi-h3">Inyección de DRA</h3><div class="hmi-inline">
          <label class="hmi-check"><input type="checkbox" id="hmi-face-dra" ${st.draInjectOn ? 'checked' : ''}> Inyectar</label>
          <label class="hmi-field-inline" for="hmi-face-lph">L/h <input type="number" id="hmi-face-lph" min="0" max="10" step="1" value="${fmt(sim.stationDraLph(st), 0)}"></label></div>`;
      }
      if (valves.length) {
        h += '<h3 class="hmi-h3">Válvulas de bloqueo del tramo</h3><table class="hmi-table hmi-pumps"><tbody>';
        for (const v of valves) {
          const isPend = pending && pending.kind === 'valve' && pending.sub === v.id;
          h += `<tr><td><span class="hmi-vstate ${v.open ? 'open' : 'closed'}"></span>${esc(v.name)}</td><td>PK ${v.pkKm}</td>
            <td class="r">${isPend
              ? `<button type="button" class="hmi-btn exec" data-exec="1">Ejecutar: ${pending.label}</button> <button type="button" class="hmi-btn" data-cancel="1">Cancelar</button>`
              : `<button type="button" class="hmi-btn" data-valve="${v.id}" data-open="${v.open ? 0 : 1}">${v.open ? 'Cerrar' : 'Abrir'}</button>`}</td></tr>`;
        }
        h += '</tbody></table>';
      }
      h += '<p class="hmi-note">Los comandos piden confirmación en dos pasos, como en una sala real.</p>';
      box.innerHTML = h;
    }

    function bindFace() {
      const box = document.getElementById('hmi-face');
      box.addEventListener('click', (ev) => {
        const b = ev.target.closest('button');
        if (!b) return;
        if (b.dataset.pump) {
          pending = { kind: 'pump', sub: b.dataset.pump, value: b.dataset.on === '1', label: b.dataset.on === '1' ? 'arrancar' : 'parar' };
        } else if (b.dataset.valve) {
          pending = { kind: 'valve', sub: b.dataset.valve, value: b.dataset.open === '1', label: b.dataset.open === '1' ? 'abrir' : 'cerrar' };
        } else if (b.dataset.cancel) {
          pending = null;
        } else if (b.dataset.exec && pending) {
          if (pending.kind === 'pump') sim.setPump(selected, pending.sub, pending.value);
          else if (pending.kind === 'valve') {
            // un cierre rápido provoca golpe de ariete
            sim.setValve(pending.sub, pending.value);
            if (!pending.value && sim.state.lineFlow > 200) {
              sim.state.surgeBoostKg = 12;
              sim.state.surgeRemainSec = 240;
              sim.logEvent('Cierre de VB con línea en movimiento → golpe de ariete', 'scenario');
            }
          }
          app.toast(`Comando ejecutado: ${pending.label}`);
          pending = null;
        }
        renderFace(true);
      });
      box.addEventListener('change', (ev) => {
        if (ev.target.id === 'hmi-face-dra') sim.setStationDraInject(selected, ev.target.checked);
        if (ev.target.id === 'hmi-face-lph') sim.setStationDraLph(selected, ev.target.value);
        renderFace(true);
      });
    }

    // ---------- despacho ----------
    function bindDispatch() {
      const sp = document.getElementById('hmi-sp');
      const spv = document.getElementById('hmi-sp-v');
      sp.addEventListener('input', () => { spv.textContent = sp.value; });
      sp.addEventListener('change', () => { sim.rampFlowTo(Number(sp.value)); app.toast(`Rampa de caudal hacia ${sp.value} m³/h (15 m³/h por minuto)`); });
      document.getElementById('hmi-dra').addEventListener('change', (e) => sim.setDra(e.target.checked));
      document.getElementById('hmi-pig').addEventListener('click', () => {
        const ok = sim.launchPig();
        app.toast(ok === false ? 'Ya hay un pig en la línea' : 'Pig lanzado desde ' + HN);
      });
      document.getElementById('hmi-normal').addEventListener('click', () => { app.normalOps(); app.toast('Línea en operación normal'); });
      document.getElementById('hmi-ack-all').addEventListener('click', () => app.alarms.ackAll());
      document.getElementById('hmi-alarm-rows').addEventListener('click', (ev) => {
        const b = ev.target.closest('button[data-ack]');
        if (b) app.alarms.ack(b.dataset.ack);
      });
    }

    function updateDispatch() {
      const S = sim.state;
      const sp = document.getElementById('hmi-sp');
      if (document.activeElement !== sp) {
        const tgt = S.flowTarget != null ? S.flowTarget : S.globalFlowSetpoint;
        sp.value = Math.round(tgt);
        document.getElementById('hmi-sp-v').textContent = Math.round(tgt) + (S.flowTarget != null ? ` (rampa: ${Math.round(S.globalFlowSetpoint)})` : '');
      }
      document.getElementById('hmi-dra').checked = !!S.draEnabled;
      const lp = Object.values(S.linepack || {}).reduce((a, b) => a + (typeof b === 'number' ? b : (b && b.m3) || 0), 0);
      const imp = S.impact || {};
      const k = [
        ['Caudal cabecera', fmt(S.segmentFlows.ph, 0), 'm³/h'],
        ['Pig', S.pig && S.pig.active ? 'PK ' + fmt(S.pig.pkKm, 0) : 'sin pig', ''],
        ['Recibo ' + TN, fmt(S.segmentFlows.lc, 0), 'm³/h'],
        ['Cumplimiento del plan', fmt(imp.pctDailyPlan, 0), '%'],
        ['Pérdida acumulada', fmt(imp.cumulativeLostM3, 0), 'm³'],
        ['Costo de oportunidad', 'USD ' + Math.round(imp.opportunityUsd || 0).toLocaleString('es-AR'), ''],
        ['Linepack', lp ? Math.round(lp).toLocaleString('es-AR') : '—', 'm³'],
      ];
      document.getElementById('hmi-kpis').innerHTML = k.map((v) => `<div><span>${v[0]}</span><b>${v[1]}</b><i>${v[2]}</i></div>`).join('');
    }

    // ---------- alarmas ----------
    let alarmKey = '';
    function updateAlarmTable() {
      const rows = app.alarms.sorted();
      const key = JSON.stringify(rows.map((a) => [a.id, a.acked, a.active, a.text]));
      if (key === alarmKey) return;
      alarmKey = key;
      const tb = document.getElementById('hmi-alarm-rows');
      if (!rows.length) { tb.innerHTML = '<tr><td colspan="6" class="hmi-empty">Sin alarmas. La línea opera dentro de los límites.</td></tr>'; return; }
      tb.innerHTML = rows.map((a) => {
        const st = a.active ? (a.acked ? 'Reconocida' : 'Sin reconocer') : 'Normalizada · sin reconocer';
        return `<tr class="${a.acked ? 'ack' : 'unack'}"><td class="mono">${a.stamp}</td><td><span class="hmi-prio p${a.prio}">${a.prio}</span></td><td class="mono">${esc(a.tag)}</td><td>${esc(a.text)}</td><td>${st}</td><td class="r">${a.acked ? '' : `<button type="button" class="hmi-btn" data-ack="${esc(a.id)}">Reconocer</button>`}</td></tr>`;
      }).join('');
    }

    // ---------- tendencias ----------
    function sampleTrend() {
      const S = sim.state;
      const t = S.timeSec;
      if (lastSample >= 0 && t - lastSample < 120) return;
      if (lastSample >= 0 && t < lastSample) trend.length = 0;
      lastSample = t;
      let maxPct = 0;
      for (const id of ORDER) {
        const s = sim.stationById(id);
        if (!s || !s.pumps || !s.pumps.length) continue;
        maxPct = Math.max(maxPct, (S.pressuresOut[id] || 0) / maopFor(id) * 100);
      }
      trend.push({ t, d: new Date(S.simDate.getTime()), qlc: S.segmentFlows.lc || 0, plc: S.pressuresIn.lc || 0, pd: S.pressuresOut[selected] || 0, maop: maxPct });
      while (trend.length && t - trend[0].t > 8 * 3600) trend.shift();
    }

    function drawTrend() {
      const c = document.getElementById('hmi-trend');
      if (!c) return;
      const dpr = window.devicePixelRatio || 1;
      const w = c.clientWidth, h = c.clientHeight;
      if (!w || !h) return;
      if (c.width !== Math.round(w * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
      const g = c.getContext('2d');
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      const css = getComputedStyle(document.documentElement);
      const col = (n) => css.getPropertyValue(n).trim();
      g.fillStyle = col('--hmi-panel'); g.fillRect(0, 0, w, h);
      const L = 44, R = w - 40, T = 10, B = h - 22;
      g.strokeStyle = col('--hmi-grid'); g.lineWidth = 1;
      g.font = '11px "IBM Plex Mono", ui-monospace, monospace';
      g.fillStyle = col('--hmi-fg2');
      const QM = CUST ? Math.max(100, Math.ceil(((META.defaultLcReceiptTargetM3h || 800) * 1.25) / 100) * 100) : 800;
      for (let i = 0; i <= 4; i++) {
        const y = T + (B - T) * i / 4;
        g.beginPath(); g.moveTo(L, y); g.lineTo(R, y); g.stroke();
        g.textAlign = 'right'; g.fillText(String(Math.round(QM - i * QM / 4)), L - 6, y + 4);
        g.textAlign = 'left'; g.fillText(String(100 - i * 25), R + 6, y + 4);
      }
      g.save(); g.textAlign = 'left'; g.fillText('m³/h', 4, T + 4); g.textAlign = 'right'; g.fillText('kg/cm² · %', w - 2, h - 6); g.restore();
      if (trend.length < 2) {
        g.fillStyle = col('--hmi-fg2'); g.textAlign = 'center';
        g.fillText('Registrando… la tendencia aparece a los pocos minutos simulados', (L + R) / 2, (T + B) / 2);
        return;
      }
      const t1 = trend[trend.length - 1].t, t0 = Math.min(trend[0].t, t1 - 1);
      const X = (t) => L + (R - L) * (t - t0) / Math.max(1, t1 - t0);
      const YQ = (v) => B - (B - T) * Math.max(0, Math.min(QM, v)) / QM;
      const YP = (v) => B - (B - T) * Math.max(0, Math.min(100, v)) / 100;
      // ticks de tiempo
      g.fillStyle = col('--hmi-fg2'); g.textAlign = 'center';
      for (let k = 0; k <= 4; k++) {
        const p = trend[Math.min(trend.length - 1, Math.round((trend.length - 1) * k / 4))];
        const lab = String(p.d.getHours()).padStart(2, '0') + ':' + String(p.d.getMinutes()).padStart(2, '0');
        g.fillText(lab, X(p.t), h - 6);
      }
      const pens = [
        ['qlc', YQ, col('--hmi-pen1'), [], 2],
        ['plc', YP, col('--hmi-pen2'), [5, 4], 1.6],
        ['pd', YP, col('--hmi-pen3'), [], 1.6],
        ['maop', YP, col('--hmi-p1'), [2, 3], 1.2],
      ];
      for (const [k, Y, c2, dash, lw] of pens) {
        g.strokeStyle = c2; g.lineWidth = lw; g.setLineDash(dash);
        g.beginPath();
        trend.forEach((p, i) => { const x = X(p.t), y = Y(p[k]); if (i) g.lineTo(x, y); else g.moveTo(x, y); });
        g.stroke();
        const lp = trend[trend.length - 1];
        g.setLineDash([]); g.fillStyle = c2; g.beginPath(); g.arc(X(lp.t), Y(lp[k]), 3, 0, Math.PI * 2); g.fill();
      }
      g.setLineDash([]);
    }

    function renderLegend() {
      const s = sim.stationById(selected);
      document.getElementById('hmi-trend-legend').innerHTML =
        `<span class="l1">Recibo ${esc(TN)} (m³/h)</span><span class="l2">P llegada ${esc(TN)} (kg/cm²)</span><span class="l3">P descarga ${esc(s ? s.shortName : '')} (kg/cm²)</span><span class="l4">% MAOP máximo</span>`;
    }

    build();
    bindFace();
    bindDispatch();
    renderFace(true);

    let acc = 0, blinkT = 0, blink = false;
    function update(dt, visible) {
      sampleTrend();
      acc += dt; blinkT += dt;
      if (blinkT > 0.5) { blinkT = 0; blink = !blink; if (visible) updateOverview(blink); }
      if (!visible || acc < 0.25) return;
      acc = 0;
      updateOverview(blink);
      renderFace(false);
      updateDispatch();
      updateAlarmTable();
      renderLegend();
      drawTrend();
    }

    return { update, select, get selected() { return selected; } };
  }

  global.createScada = createScada;
})(window);
