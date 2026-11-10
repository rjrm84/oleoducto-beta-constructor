/* Modo desafío: turnos con incidentes, decisiones y puntaje. */
(function (global) {
  'use strict';

  let PLAN_M3H = 690; // 16.500 m³/d (en ductos a medida: plan diario / 24)

  // v8: incidentes armados con las estaciones del ducto a medida
  function customPool(sim) {
    const crisis = (m) => () => sim.applyCrisisMode(m);
    const M = sim.state.config._meta;
    const sts = sim.sortedStations().slice().sort((a, b) => (a.pkKm || 0) - (b.pkKm || 0));
    const H = sim.stationById('ph'), T = sim.stationById('lc'), CD = sim.stationById('cd');
    const mids = sts.filter((x) => x.id !== 'ph' && x.pumps && x.pumps.length);
    const q0 = M.defaultPhCabeceraM3h || 600;
    const out = [];
    if (mids.length) {
      const m = mids[Math.floor(mids.length / 2)];
      const nx = sts.find((x) => (x.pkKm || 0) > (m.pkKm || 0) && x.pumps && x.pumps.length) || T;
      out.push({ id: 'eb', title: `Disparo eléctrico en ${m.name}`, brief: `Las bombas de ${m.name} (${m.shortName}) salieron de servicio. ${nx.name} empieza a perder aspiración y el caudal cae.`, start: () => sim.failStation(m.id), options: [
        { label: 'Contener: bajar el caudal de cabecera', grade: 'ok', why: `Bajar el caudal protege la aspiración aguas abajo mientras se repone ${m.shortName}.`, act: crisis('contener') },
        { label: 'Mantener el caudal y esperar', grade: 'bad', why: 'Sin esa estación, la aspiración aguas abajo colapsa y las EB disparan en cascada.', act: () => {} },
        { label: 'Parada segura de toda la línea', grade: 'mid', why: 'Es seguro pero exagerado: se pierde todo el recibo por una falla local.', act: crisis('parar_seguro') },
      ], repairH: 1.5 });
    }
    const vs = sim.state.valves.slice().sort((a, b) => a.pkKm - b.pkKm);
    const lpk = vs.length > 1 ? Math.round((vs[Math.floor(vs.length / 2) - 1].pkKm + vs[Math.floor(vs.length / 2)].pkKm) / 2) : Math.round((M.lengthKm || 100) * 0.45);
    out.push({ id: 'fuga', title: `Caída brusca de presión en el PK ${lpk}`, brief: `La presión cae en el PK ${lpk} y el balance de volumen no cierra. Puede ser una rotura del ducto.`, start: () => { sim.state._pendingRupturePk = lpk; sim.applyScenario('fuga_rotura_pk'); }, options: [
      { label: 'Parar y aislar el tramo con las VB', grade: 'ok', why: 'Ante una posible rotura, primero se para y se aísla: limita el derrame.', act: () => { sim.applyCrisisMode('parar_seguro'); } },
      { label: 'Subir el caudal para compensar la caída', grade: 'bad', why: 'Bombear más con una rotura activa aumenta el derrame.', act: () => sim.setFlowSetpoint(q0 * 1.05) },
      { label: 'Contener: bajar caudal y observar', grade: 'mid', why: 'Reduce el derrame pero no lo detiene: el tramo sigue sin aislar.', act: crisis('contener') },
    ], repairH: 3 });
    out.push({ id: 'ph', title: `Cabecera ${H.shortName} fuera de servicio`, brief: `Se perdió el bombeo en ${H.name}. Sin cabecera, el crudo deja de avanzar.`, start: () => sim.failStation('ph'), options: CD ? [
      { label: `Redistribuir: ${CD.shortName} como cabecera temporal`, grade: 'ok', why: `El tanque de ${CD.name} sostiene el bombeo unas horas hacia ${T.shortName}.`, act: crisis('redistribuir') },
      { label: 'Parada segura de toda la línea', grade: 'mid', why: `Seguro, pero desaprovecha la autonomía de ${CD.shortName}.`, act: crisis('parar_seguro') },
      { label: 'Subir el caudal en las estaciones intermedias', grade: 'bad', why: 'Sin cabecera no hay aspiración: las intermedias no pueden empujar.', act: () => {} },
    ] : [
      { label: 'Parada segura y rearme en rampa', grade: 'ok', why: 'Sin cabecera alternativa, lo correcto es parar ordenado y rearrancar en rampa.', act: crisis('parar_seguro') },
      { label: 'Mantener las intermedias en marcha', grade: 'bad', why: 'Sin aspiración las bombas cavitan y disparan.', act: () => {} },
      { label: 'Contener: bajar caudal', grade: 'mid', why: 'Ayuda, pero sin cabecera la línea igual se detiene.', act: crisis('contener') },
    ], repairH: 2 });
    out.push({ id: 'surge', title: 'Golpe de ariete tras una parada', brief: 'Una onda de sobrepresión recorre la línea: las estaciones se acercan al 90 % de la MAOP.', start: () => sim.applyScenario('sobrepresion_surge'), options: [
      { label: 'Contener: reducir caudal e inyecciones', grade: 'ok', why: 'Bajar el caudal deja que la onda se amortigüe sin superar la MAOP.', act: crisis('contener') },
      { label: 'Arrancar las bombas de reserva', grade: 'bad', why: 'Más bombeo suma presión justo cuando la línea está al límite.', act: () => sim.setFlowSetpoint(q0 * 1.06) },
      { label: 'Cerrar rápido las VB del tramo', grade: 'bad', why: 'Un cierre rápido genera otro golpe de ariete.', act: () => {} },
    ], repairH: 1 });
    out.push({ id: 'pig', title: 'Pig detenido en el punto alto', brief: `El pig de limpieza se frenó en el PK ${Math.round(M.peakPkKm || 0)}, a ${Math.round(M.peakElevM || 0).toLocaleString('es-AR')} m. La presión detrás sube.`, start: () => sim.applyScenario('pig_stuck_peak'), options: [
      { label: 'Empujarlo subiendo el caudal, vigilando la MAOP', grade: 'ok', why: 'Un aumento controlado de diferencial suele liberar el pig.', act: () => sim.setFlowSetpoint(q0) },
      { label: 'Parar la línea y esperar', grade: 'mid', why: 'El pig queda atascado y el recibo se corta.', act: crisis('parar_seguro') },
      { label: 'Ignorar la alarma', grade: 'bad', why: 'La presión detrás del pig sigue subiendo hasta disparar por MAOP.', act: () => {} },
    ], repairH: 1.5 });
    return out;
  }

  function rng(seed) {
    let s = seed >>> 0;
    return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }

  function incidentPool(sim) {
    if (sim.state.config._meta && sim.state.config._meta.custom) return customPool(sim);
    const crisis = (m) => () => sim.applyCrisisMode(m);
    return [
      {
        id: 'mg', title: 'Disparo eléctrico en Malargüe',
        brief: 'Las bombas de Malargüe (ML) salieron de servicio. El Sosneado (ES) empieza a perder aspiración y el caudal cae.',
        start: () => sim.applyScenario('falla_mg'),
        options: [
          { label: 'Contener: bajar el caudal de cabecera', grade: 'ok', why: 'Bajar el caudal protege la aspiración de ES mientras se repone ML.', act: crisis('contener') },
          { label: 'Mantener el caudal y esperar', grade: 'bad', why: 'Sin ML, la aspiración aguas abajo colapsa y las EB disparan en cascada.', act: () => {} },
          { label: 'Parada segura de toda la línea', grade: 'mid', why: 'Es seguro pero exagerado: se pierde todo el recibo por una falla local.', act: crisis('parar_seguro') },
        ], repairH: 1.5,
      },
      {
        id: 'fuga', title: 'Caída brusca de presión entre CD y ML',
        brief: 'La presión cae en el PK 212 y el balance de volumen no cierra. Puede ser una rotura del ducto.',
        start: () => { sim.state._pendingRupturePk = 212; sim.applyScenario('fuga_rotura_pk'); },
        options: [
          { label: 'Parar y aislar el tramo con las VB', grade: 'ok', why: 'Ante una posible rotura, primero se para y se aísla: limita el derrame.', act: () => { sim.applyCrisisMode('parar_seguro'); sim.isolateRuptureSegment(); } },
          { label: 'Subir el caudal para compensar la caída', grade: 'bad', why: 'Bombear más con una rotura activa aumenta el derrame.', act: () => sim.setFlowSetpoint(700) },
          { label: 'Contener: bajar caudal y observar', grade: 'mid', why: 'Reduce el derrame pero no lo detiene: el tramo sigue sin aislar.', act: crisis('contener') },
        ], repairH: 3,
      },
      {
        id: 'ph', title: 'Cabecera PH fuera de servicio',
        brief: 'Se perdió el bombeo en Puesto Hernández. Sin cabecera, el crudo no llega al Carrizo.',
        start: () => sim.applyScenario('falla_ph'),
        options: [
          { label: 'Redistribuir: CD como cabecera temporal', grade: 'ok', why: 'El tanque de Cerro Divisadero sostiene unas 2 h de bombeo hacia LC.', act: crisis('redistribuir') },
          { label: 'Parada segura de toda la línea', grade: 'mid', why: 'Seguro, pero desaprovecha la autonomía de CD.', act: crisis('parar_seguro') },
          { label: 'Arrancar la bomba de reserva de AC', grade: 'bad', why: 'AC no puede ser cabecera: sin PH no tiene aspiración.', act: () => {} },
        ], repairH: 2,
      },
      {
        id: 'surge', title: 'Golpe de ariete tras una parada',
        brief: 'Una onda de sobrepresión recorre la línea: varias EB se acercan al 90 % de la MAOP.',
        start: () => sim.applyScenario('sobrepresion_surge'),
        options: [
          { label: 'Contener: reducir caudal e inyecciones', grade: 'ok', why: 'Bajar el caudal deja que la onda se amortigüe sin superar la MAOP.', act: crisis('contener') },
          { label: 'Arrancar las bombas de reserva', grade: 'bad', why: 'Más bombeo suma presión justo cuando la línea está al límite.', act: () => sim.setFlowSetpoint(720) },
          { label: 'Cerrar rápido las VB del tramo', grade: 'bad', why: 'Un cierre rápido genera otro golpe de ariete.', act: () => {} },
        ], repairH: 1,
      },
      {
        id: 'pig', title: 'Pig detenido cerca del peak',
        brief: 'El pig de limpieza se frenó en el PK 198, a 1.985 m de altura. La presión detrás sube.',
        start: () => sim.applyScenario('pig_stuck_peak'),
        options: [
          { label: 'Empujarlo subiendo el caudal, vigilando la MAOP', grade: 'ok', why: 'Un aumento controlado de diferencial suele liberar el pig.', act: () => sim.setFlowSetpoint(690) },
          { label: 'Parar la línea y esperar', grade: 'mid', why: 'El pig queda atascado y el recibo se corta.', act: crisis('parar_seguro') },
          { label: 'Ignorar la alarma', grade: 'bad', why: 'La presión detrás del pig sigue subiendo hasta disparar por MAOP.', act: () => {} },
        ], repairH: 1.5,
      },
      {
        id: 'elec', title: 'Corte de energía en El Sosneado',
        brief: 'La red eléctrica dejó sin servicio a la EB de El Sosneado (ES). Río Tunuyán pierde aspiración.',
        start: () => { sim.state._pendingElectricEb = 'sos'; sim.applyScenario('perdida_electrica_eb'); },
        options: [
          { label: 'Contener: bajar el caudal de cabecera', grade: 'ok', why: 'Con una EB menos, la línea solo sostiene un caudal menor.', act: crisis('contener') },
          { label: 'Redistribuir con CD como cabecera', grade: 'bad', why: 'El problema está aguas abajo: CD no lo resuelve.', act: crisis('redistribuir') },
          { label: 'Mantener el caudal y esperar', grade: 'bad', why: 'RT dispara por baja aspiración.', act: () => {} },
        ], repairH: 1.5,
      },
    ];
  }

  function createGame(app) {
    const sim = app.sim;
    const GM = sim.state.config._meta || {};
    if (GM.custom) PLAN_M3H = (GM.dailyPlanM3d || 16500) / 24;
    const GT = (sim.stationById('lc') || {}).shortName || 'LC', GH = (sim.stationById('ph') || {}).shortName || 'PH';
    const $ = (id) => document.getElementById(id);
    let g = null;
    let best = null;
    try { best = JSON.parse(localStorage.getItem('oa-best') || 'null'); } catch (e) { best = null; }

    function dayKey() {
      const d = new Date();
      return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
    }
    function dayLabel() {
      return new Date().toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' });
    }

    function renderBest() {
      const el = $('g-best');
      if (el) el.textContent = best ? `Tu mejor puntaje en este navegador: ${best.score.toLocaleString('es-AR')} (${best.rank}, ${best.mode}).` : '';
      const dl = $('g-day-label');
      if (dl) dl.textContent = 'Misión del ' + dayLabel();
    }

    function start(mode) {
      const pool = incidentPool(sim);
      const isDay = mode === 'mision';
      const r = rng(isDay ? dayKey() : (Date.now() & 0xffffffff));
      const hours = isDay ? 6 : 12;
      const n = isDay ? 2 : 3;
      const picks = [];
      const idx = pool.map((_, i) => i);
      for (let k = 0; k < n; k++) picks.push(pool[idx.splice(Math.floor(r() * idx.length), 1)[0]]);
      // momentos de disparo repartidos en el turno
      const times = picks.map((_, k) => (hours / (n + 1)) * (k + 1) - 0.4 + r() * 0.8);
      app.normalOps();
      sim.setPaused(false);
      sim.setSpeed(144);
      app.setSpeedButtons(144);
      app.alarms.reset();
      g = {
        mode, hours, picks, times, k: 0, t0: sim.state.timeSec, m3: 0, score: 0,
        bonus: 0, penalty: 0, correct: 0, decided: 0, reacts: [], active: null,
        seenIds: {}, spill: 0, ended: false,
        label: isDay ? 'Misión del ' + dayLabel() : 'Turno de 12 horas',
      };
      $('g-hud').hidden = false;
      $('g-incident').hidden = true;
      document.body.classList.add('in-game');
      app.go('vista-3d');
      app.toast(isDay ? 'Comienza la misión: 6 horas simuladas' : 'Comienza el turno: 12 horas simuladas');
    }

    function fire() {
      const inc = g.picks[g.k];
      inc.start();
      g.active = { inc, tFire: performance.now(), simFire: sim.state.timeSec, acked: false, decided: null, repairEnd: null };
      $('g-incident').hidden = false;
      $('g-inc-eyebrow').textContent = `Incidente ${g.k + 1} de ${g.picks.length}`;
      $('g-inc-title').textContent = inc.title;
      $('g-inc-brief').textContent = inc.brief;
      $('g-opts').innerHTML = inc.options.map((o, i) => `<button type="button" class="g-opt" data-opt="${i}">${o.label}</button>`).join('');
      $('g-inc-foot').textContent = 'Reconocé la alarma y elegí una respuesta.';
      g.k++;
    }

    function decide(i) {
      const a = g.active;
      if (!a || a.decided) return;
      const o = a.inc.options[i];
      a.decided = o;
      o.act();
      g.decided++;
      let mult = 1;
      if (o.grade === 'ok') { g.bonus += 500; g.correct++; mult = 1; }
      else if (o.grade === 'mid') { g.bonus += 150; mult = 1.6; }
      else { g.penalty += 400; mult = 2.5; }
      a.repairEnd = sim.state.timeSec + a.inc.repairH * mult * 3600;
      $('g-opts').innerHTML = `<div class="g-verdict ${o.grade}"><b>${o.grade === 'ok' ? 'Correcto' : o.grade === 'mid' ? 'Aceptable' : 'Mala decisión'}.</b> ${o.why}</div>`;
      app.toast(o.grade === 'ok' ? '+500 · decisión correcta' : o.grade === 'mid' ? '+150 · decisión aceptable' : '−400 · mala decisión');
    }

    function resolve() {
      g.active = null;
      app.normalOps();
      $('g-incident').hidden = true;
      app.toast('Incidente resuelto · la línea vuelve a operación normal');
    }

    function onAck() {
      if (!g || !g.active || g.active.acked) return;
      g.active.acked = true;
      const secs = (performance.now() - g.active.tFire) / 1000;
      g.reacts.push(secs);
      const b = Math.max(0, Math.round(300 - secs * 20));
      g.bonus += b;
      if (b) app.toast(`+${b} · alarma reconocida en ${secs.toFixed(1)} s`);
    }

    function update(dtReal) {
      if (!g || g.ended) return;
      const S = sim.state;
      const dtH = Math.max(0, S.timeSec - (g.lastT != null ? g.lastT : S.timeSec)) / 3600;
      g.lastT = S.timeSec;
      g.m3 += (S.segmentFlows.lc || 0) * dtH;
      // penalidades por disparos MAOP nuevos
      for (const a of S.alarms || []) {
        if (g.seenIds[a.id]) continue;
        g.seenIds[a.id] = true;
        if (/TRIP MAOP/.test(a.text)) { g.penalty += 200; app.toast('−200 · disparo por MAOP'); }
      }
      if (S.rupture && S.rupture.active && !S.rupture.isolated) {
        const leak = (S.rupture.qLeakM3h || 0) * dtH;
        g.spill += leak;
        g.penalty += leak * 2;
      }
      const elapsedH = (S.timeSec - g.t0) / 3600;
      if (!g.active && g.k < g.picks.length && elapsedH >= g.times[g.k]) fire();
      if (g.active) {
        const a = g.active;
        if (!a.decided && (performance.now() - a.tFire) / 1000 > 45) {
          // sin decisión: se aplica la peor alternativa por omisión
          a.decided = { grade: 'bad' };
          g.decided++;
          g.penalty += 400;
          a.repairEnd = S.timeSec + a.inc.repairH * 3 * 3600;
          $('g-opts').innerHTML = '<div class="g-verdict bad"><b>Sin decisión.</b> La falla se extiende hasta que llega mantenimiento.</div>';
        }
        if (a.repairEnd != null) {
          const left = Math.max(0, a.repairEnd - S.timeSec) / 3600;
          $('g-inc-foot').textContent = `Normalización estimada en ${left.toFixed(1)} h simuladas`;
          if (S.timeSec >= a.repairEnd) resolve();
        } else {
          const secs = 45 - (performance.now() - a.tFire) / 1000;
          $('g-inc-foot').textContent = (a.acked ? 'Alarma reconocida. ' : 'Reconocé la alarma. ') + `Tenés ${Math.max(0, Math.ceil(secs))} s para decidir.`;
        }
      }
      g.score = Math.round(g.m3 + g.bonus - g.penalty);
      const left = Math.max(0, g.hours - elapsedH);
      $('g-left').textContent = String(Math.floor(left)).padStart(2, '0') + ':' + String(Math.floor((left % 1) * 60)).padStart(2, '0');
      $('g-m3').textContent = Math.round(g.m3).toLocaleString('es-AR');
      $('g-score').textContent = g.score.toLocaleString('es-AR');
      if (elapsedH >= g.hours) finish();
    }

    function rankFor(ratio) {
      if (ratio >= 1.05) return 'Gerente de Operaciones';
      if (ratio >= 0.95) return 'Despachante';
      if (ratio >= 0.85) return 'Jefe de Turno';
      if (ratio >= 0.7) return 'Operador';
      return 'Operador Jr.';
    }

    function finish() {
      g.ended = true;
      const plan = PLAN_M3H * g.hours;
      const ratio = g.score / plan;
      const rank = rankFor(ratio);
      const avgReact = g.reacts.length ? g.reacts.reduce((a, b) => a + b, 0) / g.reacts.length : null;
      const res = { score: g.score, rank, m3: Math.round(g.m3), plan, correct: g.correct, n: g.picks.length, avgReact, spill: Math.round(g.spill), label: g.label, mode: g.mode };
      if (!best || res.score > best.score) {
        best = { score: res.score, rank, mode: g.label };
        try { localStorage.setItem('oa-best', JSON.stringify(best)); } catch (e) { /* sin almacenamiento */ }
      }
      $('g-hud').hidden = true;
      document.body.classList.remove('in-game');
      app.normalOps();
      sim.setSpeed(60);
      app.setSpeedButtons(60);
      showResult(res);
      renderBest();
    }

    function quit() {
      if (!g) return;
      g.ended = true;
      g = null;
      $('g-hud').hidden = true;
      document.body.classList.remove('in-game');
      app.normalOps();
      sim.setSpeed(60);
      app.setSpeedButtons(60);
      app.toast('Turno abandonado');
    }

    function resultText(r) {
      return `Oleoducto Beta · ${r.label}\n${r.score.toLocaleString('es-AR')} puntos · ${r.rank}\n${r.m3.toLocaleString('es-AR')} m³ entregados en Luján de Cuyo · ${r.correct}/${r.n} decisiones correctas` +
        (r.avgReact != null ? ` · reacción media ${r.avgReact.toFixed(1)} s` : '') + '\n¿Lo hacés mejor?';
    }

    function drawCard(r) {
      const W = 1080, H = 1350;
      const c = document.createElement('canvas');
      c.width = W; c.height = H;
      const x = c.getContext('2d');
      x.fillStyle = '#0d1114'; x.fillRect(0, 0, W, H);
      const shot = app.snapshot3d && app.snapshot3d();
      const drawRest = (img) => {
        if (img) {
          const ih = 640;
          const s = Math.max(W / img.width, ih / img.height);
          const iw = img.width * s, ihh = img.height * s;
          x.save(); x.beginPath(); x.rect(0, 0, W, ih); x.clip();
          x.drawImage(img, (W - iw) / 2, (ih - ihh) / 2, iw, ihh);
          x.restore();
          const gr = x.createLinearGradient(0, 380, 0, 640);
          gr.addColorStop(0, 'rgba(13,17,20,0)'); gr.addColorStop(1, 'rgba(13,17,20,1)');
          x.fillStyle = gr; x.fillRect(0, 380, W, 260);
        }
        x.fillStyle = '#9fb3bf'; x.font = '600 34px "Barlow Condensed", sans-serif';
        x.fillText((GM.custom ? String(GM.shortTitle || 'Oleoducto').toUpperCase() : 'OLEODUCTO BETA') + ' · ' + r.label.toUpperCase(), 72, 700);
        x.fillStyle = '#f1efe8'; x.font = '700 190px "Barlow Condensed", sans-serif';
        x.fillText(r.score.toLocaleString('es-AR'), 64, 880);
        x.fillStyle = '#e8b04a'; x.font = '600 64px "Barlow Condensed", sans-serif';
        x.fillText(r.rank, 72, 970);
        const rows = [
          ['m³ entregados en ' + GT, r.m3.toLocaleString('es-AR') + ' / ' + r.plan.toLocaleString('es-AR')],
          ['Decisiones correctas', r.correct + ' de ' + r.n],
          ['Reacción media', r.avgReact != null ? r.avgReact.toFixed(1) + ' s' : '—'],
          ['Crudo derramado', r.spill.toLocaleString('es-AR') + ' m³'],
        ];
        x.font = '400 36px "Barlow", sans-serif';
        rows.forEach((row, i) => {
          const y = 1060 + i * 58;
          x.fillStyle = '#8b979d'; x.fillText(row[0], 72, y);
          x.fillStyle = '#f1efe8'; x.textAlign = 'right'; x.fillText(row[1], W - 72, y); x.textAlign = 'left';
          x.strokeStyle = '#26323a'; x.beginPath(); x.moveTo(72, y + 20); x.lineTo(W - 72, y + 20); x.stroke();
        });
        x.fillStyle = '#8b979d'; x.font = '400 28px "IBM Plex Mono", monospace';
        x.fillText(GM.custom ? `${GH} → ${GT} · ${Math.round(GM.lengthKm || 0)} km · ¿Lo hacés mejor?` : 'PH → LC · 530 km · peak 1.985 m · ¿Lo hacés mejor?', 72, H - 50);
        const url = c.toDataURL('image/png');
        $('g-card').src = url;
        $('g-dl').onclick = () => saveCard(c, url);
      };
      if (shot) { const im = new Image(); im.onload = () => drawRest(im); im.onerror = () => drawRest(null); im.src = shot; }
      else drawRest(null);
    }

    async function saveCard(canvas, url) {
      const name = 'oleoducto-beta-resultado.png';
      let dl = null;
      try { dl = window.claude && window.claude.use ? await window.claude.use('downloads') : null; } catch (e) { dl = null; }
      if (dl) {
        canvas.toBlob(async (blob) => {
          try { await dl.save({ filename: name, data: blob }); app.toast('Imagen guardada'); }
          catch (e) { if (e && e.code !== 'declined') app.toast('No se pudo guardar: mantené presionada la imagen'); }
        }, 'image/png');
        return;
      }
      const a = document.createElement('a');
      a.href = url; a.download = name;
      document.body.appendChild(a); a.click(); a.remove();
    }

    function showResult(r) {
      drawCard(r);
      $('g-res-text').textContent = resultText(r);
      $('g-result').hidden = false;
      $('g-copy').onclick = () => {
        const t = resultText(r);
        const done = () => app.toast('Resultado copiado');
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(t).then(done).catch(() => selectText());
        } else selectText();
      };
      function selectText() {
        const el = $('g-res-text');
        const rg = document.createRange(); rg.selectNodeContents(el);
        const s = getSelection(); s.removeAllRanges(); s.addRange(rg);
        app.toast('Texto seleccionado: copialo con Ctrl/Cmd + C');
      }
      $('g-again').onclick = () => { $('g-result').hidden = true; start(r.mode); };
      $('g-close').onclick = () => { $('g-result').hidden = true; app.go('desafio'); };
    }

    document.querySelectorAll('[data-game]').forEach((b) => b.addEventListener('click', () => start(b.dataset.game)));
    $('g-opts').addEventListener('click', (ev) => { const b = ev.target.closest('[data-opt]'); if (b) decide(Number(b.dataset.opt)); });
    $('g-quit').addEventListener('click', quit);
    app.alarms.on((newAl, acked) => { if (acked) onAck(); });
    renderBest();

    return { start, update, get active() { return !!g && !g.ended; } };
  }

  global.createGame = createGame;
})(window);
