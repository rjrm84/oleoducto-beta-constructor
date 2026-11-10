/* Shell: vistas, barra superior, banner de alarmas, bienvenida y bucle común. */
(function () {
  'use strict';
  const VIEWS = ['vista-3d', 'scada', 'desafio', 'aula', 'ingenieria'];
  const $ = (id) => document.getElementById(id);

  const app = {
    sim: null, config: null, geo: null, alarms: null, scada: null, game: null,
    profile: [], view: 'vista-3d', view3d: null, snapshot3d: null,
  };
  window.APP = app;

  let toastT = null;
  app.toast = function (msg) {
    let t = $('x-toast');
    if (!t) {
      t = document.createElement('div');
      t.id = 'x-toast'; t.className = 'x-toast'; t.setAttribute('role', 'status');
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastT);
    toastT = setTimeout(() => t.classList.remove('show'), 2600);
  };

  app.normalOps = function () {
    const sim = app.sim;
    sim.applyScenario('clear');
    if (sim.state.impact) sim.state.impact.crisisMode = null;
    if (sim.state.pig && sim.state.pig.active && !sim.state.pig.stuck) { /* el pig sigue su recorrido */ }
    sim.setFlowSetpoint((sim.state.config._meta && sim.state.config._meta.custom && sim.state.config._meta.defaultPhCabeceraM3h) || 680);
    sim.state.flowTarget = null;
    sim.setDra(true);
    sim.computeHydraulics();
    if (app.ing) app.ing.resetEvents();
  };

  app.setSpeedButtons = function (v) {
    document.querySelectorAll('[data-speed]').forEach((b) => b.classList.toggle('active', Number(b.dataset.speed) === v));
  };

  app.go = function (view) {
    if (VIEWS.indexOf(view) < 0) view = 'vista-3d';
    app.view = view;
    document.body.dataset.view = view;
    VIEWS.forEach((v) => {
      const sec = $('view-' + v);
      if (sec) sec.hidden = v !== view;
    });
    document.querySelectorAll('.x-tab').forEach((t) => t.classList.toggle('active', t.dataset.view === view));
    if (location.hash !== '#' + view) {
      try { history.replaceState(null, '', '#' + view); } catch (e) { location.hash = view; }
    }
    if (app.view3d) app.view3d.onShow(view === 'vista-3d');
    window.dispatchEvent(new Event('resize'));
  };

  function initShell() {
    window.addEventListener('hashchange', () => app.go(location.hash.slice(1)));
    document.querySelectorAll('.x-tab').forEach((a) => a.addEventListener('click', (ev) => { ev.preventDefault(); app.go(a.dataset.view); }));
    $('x-pause').addEventListener('click', () => {
      const running = app.sim.togglePause();
      $('x-pause').textContent = running ? '❚❚' : '▶';
      $('x-pause').setAttribute('aria-label', running ? 'Pausar' : 'Reanudar');
    });
    $('x-ab-ack').addEventListener('click', () => {
      const a = app.alarms.newestUnacked();
      if (a) app.alarms.ack(a.id);
    });
    $('x-ab-snd').addEventListener('click', () => {
      const on = app.alarms.enableSound(!app.alarms.soundOn);
      $('x-ab-snd').textContent = on ? 'Sonido: on' : 'Sonido: off';
      $('x-ab-snd').setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    // bienvenida
    let seen = false;
    try { seen = sessionStorage.getItem('oa-intro') === '1'; } catch (e) { seen = false; }
    if (!seen && !location.hash) $('x-intro').hidden = false;
    document.querySelectorAll('[data-intro]').forEach((b) => b.addEventListener('click', () => {
      $('x-intro').hidden = true;
      try { sessionStorage.setItem('oa-intro', '1'); } catch (e) { /* ignore */ }
      app.alarms.enableSound(true);
      $('x-ab-snd').textContent = 'Sonido: on';
      $('x-ab-snd').setAttribute('aria-pressed', 'true');
      app.go(b.dataset.intro);
    }));
  }

  function updateTop() {
    const S = app.sim.state;
    const d = S.simDate;
    $('x-time').textContent = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
    $('x-qlc').textContent = Math.round(S.segmentFlows.lc || 0) + ' m³/h';
    $('x-plc').textContent = (S.pressuresIn.lc || 0).toFixed(1) + ' kg/cm²';
    const c = app.alarms.counts();
    const sev = (S.alarms || []).some((a) => a.severity === 'critical') ? 'crit' : (S.alarms || []).length ? 'warn' : 'ok';
    const L = $('x-light');
    L.dataset.s = sev;
    $('x-light-t').textContent = sev === 'ok' ? 'Normal' : sev === 'warn' ? 'Atención' : 'Crítico';
    // banner
    $('x-ab-p1').textContent = c.p1;
    $('x-ab-p2').textContent = c.p2 + c.p3;
    const n = app.alarms.newestUnacked();
    const bar = $('x-alarmbar');
    bar.dataset.state = n ? 'p' + n.prio : (S.alarms || []).length ? 'acked' : 'ok';
    if (n) $('x-ab-msg').innerHTML = `<b>${n.stamp} · ${n.tag}</b> ${n.text.replace(/[<>&]/g, '')}`;
    else if ((S.alarms || []).length) $('x-ab-msg').textContent = `${S.alarms.length} alarma(s) activa(s), todas reconocidas`;
    else $('x-ab-msg').textContent = 'Sin alarmas activas · operación normal';
    $('x-ab-ack').disabled = !n;
  }

  // v8: textos del shell para un ducto a medida
  function customizeShell(config, sim) {
    const M = config._meta;
    const H = sim.stationById('ph'), T = sim.stationById('lc');
    const hn = H.shortName, tn = T.shortName;
    const L = Math.round(M.lengthKm);
    const q = (sel) => document.querySelector(sel);
    const set = (sel, t) => { const el = q(sel); if (el) el.textContent = t; };
    document.title = `${M.shortTitle} · simulador`;
    set('.x-brand-name', M.shortTitle);
    set('.x-brand-sub', `${hn} → ${tn} · ${L} km · ${M.diameterInch} in`);
    const ql = $('x-qlc'); if (ql && ql.previousElementSibling) ql.previousElementSibling.textContent = 'Recibo ' + tn;
    set('#v3d-cine-txt', `${M.shortTitle} · PK 0`);
    set('#view-scada .hmi-overview h2', `Vista general · ${M.shortTitle} ${hn}–${tn}`);
    set('.hmi-dispatch .hmi-hint', 'Cabecera ' + hn);
    const sp = $('hmi-sp');
    if (sp) { sp.max = String(M.maxLineFlowM3h); sp.step = String(Math.max(1, Math.round(M.maxLineFlowM3h / 100))); sp.value = String(M.defaultPhCabeceraM3h); }
    set('.ing-brand', `${String(M.shortTitle).toUpperCase()} · SCADA`);
    // menú lateral del SCADA: estaciones del ducto
    const side = $('ing-side');
    if (side) {
      side.querySelectorAll('[data-go^="st:"]').forEach((b) => b.remove());
      side.querySelectorAll('[data-go="terminal"]').forEach((b) => { b.textContent = 'Tanques ' + tn; });
      for (const st of sim.sortedStations().slice().sort((a, b) => (a.pkKm || 0) - (b.pkKm || 0))) {
        const b = document.createElement('button');
        b.type = 'button'; b.dataset.go = 'st:' + st.id; b.textContent = st.shortName;
        side.appendChild(b);
      }
    }
    // textos del desafío y la bienvenida
    const plan = Math.round(M.dailyPlanM3d || 0);
    const swap = (root) => {
      if (!root) return;
      const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      const rep = [['Puesto Hernández', H.name], ['Luján de Cuyo', T.name], ['16.500 m³ por día', plan.toLocaleString('es-AR') + ' m³ por día'], ['unos 690 m³/h', 'unos ' + Math.round(plan / 24) + ' m³/h'], ['m³ en LC', 'm³ en ' + tn]];
      let n; while ((n = w.nextNode())) { let t = n.nodeValue; for (const [a, b] of rep) t = t.split(a).join(b); if (t !== n.nodeValue) n.nodeValue = t; }
    };
    swap($('view-desafio')); swap($('g-hud'));
    set('.x-intro-eyebrow', `${M.client ? M.client + ' · ' : ''}${L} km · cota máxima ${Math.round(M.peakElevM || 0).toLocaleString('es-AR')} m · ${M.diameterInch} in`);
    const h1 = q('.x-intro-card h1'); if (h1) h1.innerHTML = `${M.shortTitle}: ${L} km de ${String(M.fluidName || 'crudo').toLowerCase()} de ${hn} a ${tn}.<br>Vos estás a cargo.`;
    const p1 = q('.x-intro-card h1 + p');
    if (p1) p1.textContent = `Ducto generado con el constructor: ${sim.state.stations.length} estaciones, ${sim.state.valves.length} válvulas de bloqueo, caño de ${M.diameterInch} in y destino en ${M.destName}. Física real sobre la altimetría del trazado.`;
    const b = $('x-build');
    if (b) { b.textContent = 'Editar ducto'; b.href = ((window.OB_LINKS || {}).builder || 'constructor.html') + '?id=' + encodeURIComponent(M.specId); }
  }

  function boot(e) {
    const { sim, config } = e.detail;
    app.sim = sim;
    app.config = config;
    if (config._meta && config._meta.custom) { try { customizeShell(config, sim); } catch (err) { console.error(err); } }
    app.geo = window.GEO.build(config);
    app.alarms = window.createAlarmManager(sim);
    app.profile = window.GEO.pressureProfile(sim, app.geo, app.geo.profStep || 5);
    initShell();
    app.scada = window.createScada(app);
    app.game = window.createGame(app);
    app.ing = window.createIng(app);
    app.aula = window.createAula ? window.createAula(app) : null;
    if (/^#eval=/.test(location.hash)) { const ix = $('x-intro'); if (ix) ix.hidden = true; }
    const start = /^#eval=/.test(location.hash) ? 'aula' : location.hash ? location.hash.slice(1) : 'vista-3d';
    if (config._meta && config._meta.custom && window.OBLIC) {
      const gate = () => {
        let o = $('lic-gate');
        if (window.OBLIC.can('constructor:simular')) { if (o) o.remove(); return; }
        if (!o) { o = document.createElement('div'); o.id = 'lic-gate'; o.className = 'lic-gate'; document.body.appendChild(o); }
        o.innerHTML = `<div class="lic-card">${window.OBLIC.lockHtml('constructor:simular', 'El constructor es libre para diseñar. Para simular y operar tu ducto necesitás una licencia.')}<p class="lic-m"><a href="${(window.OB_LINKS || {}).builder || 'constructor.html'}">Volver al constructor</a> · <a href="https://rjrm84.github.io/oleoducto-beta/">Usar el simulador Beta gratis</a></p></div>`;
      };
      window.OBLIC.whenReady.then(gate); window.OBLIC.on(gate);
    }
    app.go(start);
    window.dispatchEvent(new CustomEvent('app-ready', { detail: app }));
    if (window.CUSTOM_ERROR) setTimeout(() => app.toast(window.CUSTOM_ERROR), 600);

    let last = performance.now(), acc = 0;
    function frame(now) {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      app.alarms.update();
      acc += dt;
      if (acc > 0.2) {
        acc = 0;
        app.profile = window.GEO.pressureProfile(sim, app.geo, app.geo.profStep || 5);
        updateTop();
      }
      app.scada.update(dt, app.view === 'scada');
      app.game.update(dt);
      app.ing.update(dt, app.view === 'ingenieria');
      if (app.aula) app.aula.update(dt);
      if (app.view3d) app.view3d.update(dt);
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }

  if (window.SIM) boot({ detail: { sim: window.SIM, config: window.SIM.state.config } });
  else window.addEventListener('sim-ready', boot, { once: true });
})();
