/* SCADA · Eventos y fallas (instructor): catálogo de fallas de un oleoducto, ubicación por estación,
   PK o válvula, programación con demora, consecuencia real sobre la hidráulica y procedimiento del supervisor. */
(function (global) {
  'use strict';
  const fmt = (v, d) => (v == null || !isFinite(v) ? '—' : Number(v).toFixed(d == null ? 1 : d));
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const isBooster = (p) => (p.role || '').indexOf('booster') >= 0;

  function createFaults(app, ctx) {
    const sim = app.sim;
    const S = () => sim.state;
    const st = (id) => sim.stationById(id);
    const sn = (id) => (st(id) || {}).shortName || id;
    const ev = ctx.ev;
    const evLog = ctx.evLog;
    const eq = () => ctx.equip();
    const META = S().config._meta || {};
    const L = META.lengthKm || 530;
    const sorted = sim.sortedStations().slice().sort((a, b) => (a.pkKm || 0) - (b.pkKm || 0));
    const PUMP = sorted.filter((x) => (x.pumps || []).some((p) => !isBooster(p)));
    const VFD = PUMP.filter((x) => x.pumps.some((p) => p.drive === 'variador'));
    const BOOST = PUMP.filter((x) => x.pumps.some(isBooster));
    const TRAPS = sorted.filter((x) => x.pigTrap);
    const INJ = sorted.filter((x) => (x.injections || []).length || (x.injection && x.injection.enabled));
    const peak = META.peakPkKm != null ? META.peakPkKm : 198;

    // ---------- ubicaciones ----------
    function locOptions(kind) {
      if (kind === 'station') return PUMP.map((x) => [x.id, `${x.shortName} · ${x.name} (PK ${x.pkKm})`]);
      if (kind === 'vfd') return VFD.map((x) => [x.id, `${x.shortName} · ${x.name}`]);
      if (kind === 'boost') return BOOST.map((x) => [x.id, `${x.shortName} · ${x.name}`]);
      if (kind === 'trap') return TRAPS.map((x) => [x.id, `${x.shortName} · ${x.name} (PK ${x.pkKm})`]);
      if (kind === 'valve') return S().valves.slice().sort((a, b) => a.pkKm - b.pkKm).map((v) => [v.id, `${v.name} · PK ${v.pkKm}`]);
      if (kind === 'inj') return (INJ.length ? INJ : [sorted[0]]).map((x) => [x.id, `${x.shortName} · ${x.name}`]);
      if (kind === 'terminal') return [['lc', `${sn('lc')} · ${(st('lc') || {}).name || 'Terminal'}`]];
      if (kind === 'line') return [['line', 'Toda la línea']];
      if (kind === 'pk') {
        const out = [];
        const step = L > 200 ? 10 : L > 60 ? 5 : 1;
        const marks = {};
        for (const x of sorted) marks[Math.round(x.pkKm / step) * step] = x.shortName;
        for (const v of S().valves) marks[Math.round(v.pkKm / step) * step] = marks[Math.round(v.pkKm / step) * step] || v.name;
        marks[Math.round(peak / step) * step] = (marks[Math.round(peak / step) * step] ? marks[Math.round(peak / step) * step] + ' · ' : '') + 'punto alto';
        for (let k = step; k < L - step / 2; k += step) out.push([String(k), `PK ${k}${marks[k] ? ' · cerca de ' + marks[k] : ''}`]);
        return out;
      }
      return [];
    }
    const locLabel = (kind, v) => { const o = locOptions(kind).find((x) => String(x[0]) === String(v)); return o ? o[1].split(' (')[0] : v; };

    // ---------- utilidades de falla ----------
    function tripStation(id, cause, repairS) {
      sim.failStation(id);
      ev.elec[id] = { cause, tTrip: S().timeSec, ready: false, repairS: repairS || 600 };
    }
    function runningMain(id, drive) {
      const x = st(id);
      return (x.pumps || []).find((p) => !isBooster(p) && p.online && (!drive || p.drive === drive));
    }
    function upstreamPump(id) {
      const x = st(id);
      const ups = PUMP.filter((y) => (y.pkKm || 0) < (x.pkKm || 0));
      return ups.length ? ups[ups.length - 1] : null;
    }

    // ---------- catálogo ----------
    const SUP_ELEC = ['Reconocer la alarma y confirmar la causa en Equipos › Alimentación eléctrica', 'Bajar el caudal de cabecera para proteger la aspiración aguas abajo', 'Cerrar las válvulas de descarga de las bombas paradas', 'Esperar la normalización de la tensión y verificar los permisivos', 'Rearmar la estación en Eventos y fallas y volver al caudal en rampa', 'Registrar el evento y avisar a mantenimiento eléctrico'];
    const CAT = [
      // eléctricas
      { k: 'corte', g: 'Eléctricas', t: 'Corte de energía en la estación', where: 'station', d: 'Se abre el interruptor de 33 kV: paran todas las bombas.', c: 'Cae la presión de descarga, se pierde aspiración en la estación siguiente y baja el recibo.', sup: SUP_ELEC,
        run: (id) => tripStation(id, 'Falla subestación', 600) },
      { k: 'hueco', g: 'Eléctricas', t: 'Hueco de tensión (perturbación de red)', where: 'station', d: 'La tensión de 33 kV cae unos segundos: disparan los variadores y protecciones de bajo voltaje.', c: 'Salen de servicio las bombas con variador (o una bomba si no hay); la estación queda con menos presión.', sup: ['Confirmar el hueco en la tendencia de tensión 33 kV', 'Identificar qué bombas dispararon', 'Cerrar sus válvulas de descarga', 'Verificar permisivos y volver a arrancar desde el P&ID', 'Abrir la descarga y recuperar el caudal en rampa'],
        run: (id) => { const e = eq(); if (e) e.state[id].elec.sag = 0.05; const ps = st(id).pumps.filter((p) => !isBooster(p) && p.online && p.drive === 'variador'); (ps.length ? ps : [runningMain(id)].filter(Boolean)).forEach((p) => sim.setPump(id, p.id, false)); } },
      { k: 'trafo', g: 'Eléctricas', t: 'Falla del transformador 33/6 kV', where: 'station', d: 'Actúa la protección del transformador: la barra de 6 kV queda sin tensión por un tiempo largo.', c: 'Estación fuera de servicio unas 2 h simuladas; la línea debe operar con menos caudal.', sup: ['Confirmar la apertura del interruptor y la protección actuada', 'Bajar el caudal y redistribuir', 'Cerrar las descargas de las bombas', 'Coordinar con mantenimiento eléctrico', 'Rearmar al habilitarse y volver en rampa'],
        run: (id) => tripStation(id, 'Falla de transformador', 7200) },
      { k: 'vfd', g: 'Eléctricas', t: 'Falla de variador', where: 'vfd', d: 'El variador de una bomba dispara por sobrecorriente.', c: 'Sale la bomba con variador; baja la presión de la estación.', sup: ['Ver la falla en Equipos › Sala de variadores', 'Arrancar la bomba de reserva si está disponible', 'Cerrar la descarga de la bomba disparada', 'Rearmar el variador cuando mantenimiento lo habilite'],
        run: (id) => { const e = eq(); const p = runningMain(id, 'variador'); if (e && p) e.state[id].pumps[p.id].vfdFault = true; } },
      { k: 'hvac', g: 'Eléctricas', t: 'Falla del aire acondicionado de la sala de variadores', where: 'vfd', d: 'Sube la temperatura de la sala de variadores.', c: 'Si llega a 40 °C, los variadores disparan por temperatura.', sup: ['Seguir la temperatura de la sala en Equipos', 'Abrir puertas o ventilación de emergencia', 'Bajar la carga de las bombas con variador', 'Pedir la reparación del aire acondicionado'],
        run: (id) => { const e = eq(); if (e) e.state[id].hvacFail = true; } },
      // equipos de bombeo
      { k: 'vib', g: 'Bombas', t: 'Alta vibración (desbalanceo)', where: 'station', d: 'La vibración de una bomba sube de forma sostenida.', c: 'A 11 mm/s la bomba dispara por protección.', sup: ['Confirmar la vibración en Equipos › Bombas', 'Arrancar la reserva y parar la bomba afectada antes del disparo', 'Cerrar la descarga de la bomba parada', 'Pedir análisis de vibraciones'],
        run: (id) => { const e = eq(); const p = runningMain(id); if (e && p) e.state[id].pumps[p.id].vibFault = 1; } },
      { k: 'lube', g: 'Bombas', t: 'Falla de la central de lubricación', where: 'station', d: 'Falla la bomba de aceite de la central de una bomba principal.', c: 'Baja la presión de aceite y la bomba dispara por permisivo de lubricación.', sup: ['Ver presión de aceite en Equipos', 'Pasar a la bomba auxiliar de la central (Reparar y normalizar)', 'Si disparó, cerrar la descarga y arrancar la reserva', 'Verificar nivel y temperatura de aceite'],
        run: (id) => { const e = eq(); const p = runningMain(id); if (e && p) e.state[id].pumps[p.id].lubeFault = true; } },
      { k: 'brg', g: 'Bombas', t: 'Alta temperatura de cojinete', where: 'station', d: 'Un cojinete de bomba se calienta progresivamente.', c: 'A 95 °C dispara la bomba.', sup: ['Ver temperaturas de cojinetes en Equipos', 'Verificar lubricación', 'Arrancar la reserva y sacar de servicio la bomba', 'Pedir inspección mecánica'],
        run: (id) => { const e = eq(); const p = runningMain(id); if (e && p) e.state[id].pumps[p.id].heat = 1; } },
      { k: 'sello', g: 'Bombas', t: 'Pérdida por sello mecánico', where: 'station', d: 'Pérdida de crudo por el sello de una bomba principal.', c: 'Hay que sacar la bomba de servicio y aislarla; la estación queda con una bomba menos.', sup: ['Parar la bomba con pérdida', 'Cerrar la válvula de descarga y aislar la bomba', 'Arrancar la reserva si está disponible', 'Avisar a medio ambiente por el derrame en la estación', 'Pedir el cambio de sello'],
        run: (id) => { const e = eq(); const p = runningMain(id); if (e && p) e.state[id].pumps[p.id].sealLeak = true; } },
      { k: 'mov', g: 'Bombas', t: 'Cierre de la válvula de descarga de una bomba en marcha', where: 'station', d: 'La válvula actuada de descarga se cierra por una falla de mando.', c: 'La bomba queda girando contra válvula cerrada: no aporta presión y se calienta.', sup: ['Detectar la bomba sin caudal y la alarma de descarga cerrada', 'Parar la bomba', 'Revisar el actuador de la válvula', 'Volver a arrancar con la secuencia: descarga cerrada, arranque, apertura'],
        run: (id) => { const e = eq(); const p = runningMain(id); if (e && p) e.setMov(id, p.id, false); } },
      { k: 'booster', g: 'Bombas', t: 'Disparo de booster de aspiración', where: 'boost', d: 'Sale de servicio el booster que alimenta la aspiración de las principales.', c: 'Baja la presión de aspiración de las bombas principales.', sup: ['Arrancar el booster de reserva', 'Vigilar la aspiración de las principales', 'Bajar caudal si la aspiración no se recupera'],
        run: (id) => { const b = st(id).pumps.find((p) => isBooster(p) && p.online); if (b) sim.setPump(id, b.id, false); } },
      { k: 'filtro', g: 'Bombas', t: 'Filtro obstruido con falla de retrolavado', where: 'station', d: 'El filtro en servicio se ensucia y no puede retrolavar.', c: 'Sube la ΔP del filtro y cae la aspiración de las bombas.', sup: ['Ver la ΔP en Equipos › Filtros', 'Cambiar al filtro de reserva', 'Retrolavar o limpiar el filtro obstruido', 'Vigilar la aspiración'],
        run: (id) => { const e = eq(); if (e) e.clog(id); ev.filter[id] = 1.8; } },
      // hidráulicas e integridad
      { k: 'fuga', g: 'Integridad', t: 'Fuga pequeña', where: 'pk', d: 'Una pérdida chica en el ducto: se nota en el balance de volumen antes que en las presiones.', c: 'El balance entrada–salida no cierra y baja levemente la presión cerca de la fuga.', sup: ['Revisar el balance en Integridad (ventana de 15 min y 1 h)', 'Confirmar con presiones y caudales', 'Parar el bombeo y aislar el tramo con las VB', 'Avisar a integridad y medio ambiente', 'No rearrancar sin el OK de integridad'],
        run: (pk) => { const sp = S().globalFlowSetpoint; sim.startRuptureAtPk(Number(pk), 0.18); S().globalFlowSetpoint = sp; } },
      { k: 'rotura', g: 'Integridad', t: 'Rotura del ducto', where: 'pk', d: 'Rotura con derrame importante.', c: 'Caída brusca de presión cerca del PK, pérdida de caudal en el recibo y derrame.', sup: ['Parar el bombeo en toda la línea', 'Cerrar las VB a ambos lados de la rotura', 'Activar el plan de contingencia y avisar a las autoridades', 'Seguir la caída de linepack', 'Rearrancar solo con OK de integridad'],
        run: (pk) => sim.startRuptureAtPk(Number(pk), 0.75) },
      { k: 'vb', g: 'Integridad', t: 'Cierre inadvertido de válvula de bloqueo', where: 'valve', d: 'Una VB de línea se cierra sin orden (falla del actuador).', c: 'Se corta el caudal aguas abajo y sube la presión aguas arriba de la válvula.', sup: ['Identificar la VB cerrada en Principal o Integridad', 'Parar las bombas aguas arriba para no superar la MAOP', 'Reabrir la válvula y verificar su posición', 'Volver a bombear en rampa'],
        run: (vid) => sim.setValve(vid, false) },
      { k: 'surge', g: 'Integridad', t: 'Golpe de ariete', where: 'line', d: 'Una parada brusca genera una onda de sobrepresión.', c: 'Varias estaciones se acercan al 90 % de la MAOP.', sup: ['Bajar caudal en rampa', 'No arrancar ni cerrar válvulas rápido', 'Esperar que se amortigüe la onda', 'Verificar MAOP por tramo en Integridad'],
        run: () => sim.applyScenario('sobrepresion_surge') },
      { k: 'altap', g: 'Integridad', t: 'Alta presión de descarga (falla del PID)', where: 'station', d: 'El lazo PID de descarga falla con la válvula de control abierta.', c: 'La presión de descarga sube hasta el límite del ducto y actúa el disparo por MAOP.', sup: ['Ver el PID en el P&ID de la estación', 'Pasar el lazo a manual y bajar el set point', 'Bajar caudal si la presión no baja', 'Verificar la presión máxima del tramo'],
        run: (id) => { const x = st(id); if (x._spFault == null) x._spFault = x.pDescSpKgCm2; const maop = (S().thresholds.pMaxLineKgCm2 || 90); x.pDescSpKgCm2 = maop + 5; x.pDescSpTarget = null; S().scenarioActive = 'pid_fail'; } },
      { k: 'bajaasp', g: 'Integridad', t: 'Baja presión de aspiración', where: 'station', d: 'Dispara una bomba en la estación anterior y llega menos presión.', c: 'La aspiración cae bajo el set point y puede disparar las bombas por baja aspiración.', sup: ['Confirmar la aspiración en Principal', 'Ver qué pasó aguas arriba', 'Bajar caudal de cabecera para recuperar aspiración', 'Rearrancar la bomba aguas arriba'],
        run: (id) => { const u = upstreamPump(id); if (u) { const p = runningMain(u.id); if (p) sim.setPump(u.id, p.id, false); } else { const b = st(id).pumps.find((p) => isBooster(p) && p.online); if (b) sim.setPump(id, b.id, false); } } },
      { k: 'agua', g: 'Integridad', t: 'Agua en el crudo (alto BS&W)', where: 'inj', d: 'Una inyección entra con agua por encima de la especificación.', c: 'El recibo queda fuera de especificación de calidad.', sup: ['Ver BS&W en Custody y laboratorios', 'Cortar o bajar la inyección responsable', 'Avisar al laboratorio y al cliente', 'Segregar el volumen fuera de especificación'],
        run: () => sim.setWaterSlug(1.4) },
      { k: 'tanque', g: 'Integridad', t: 'Terminal sin tanque libre', where: 'terminal', d: 'El tanque receptor llega al máximo y no hay otro disponible.', c: 'Hay que bajar el bombeo o parar hasta liberar un tanque.', sup: ['Ver tanques en la pantalla Terminal', 'Bajar el caudal de cabecera', 'Acelerar la entrega o cambiar de tanque receptor', 'Parar el bombeo si no hay capacidad'],
        run: () => { const tks = (st('lc') || {}).tanks || []; tks.forEach((t) => { t.volumeM3 = (t.maxOpM3 || t.capacityM3 * 0.875) * (t.mode === 'recibe' ? 0.995 : 0.97); if (t.mode === 'espera') t.mode = 'reposo'; t.settleLeftH = 6; }); } },
      // scraper
      { k: 'pig', g: 'Scraper', t: 'Scraper atascado', where: 'pk', d: 'El pig se detiene en el ducto.', c: 'Sube la presión detrás del pig y cae el caudal.', sup: ['Confirmar velocidad cero del pig en Integridad', 'Aumentar el diferencial en forma controlada vigilando la MAOP', 'Si no se libera, parar y coordinar el rescate'],
        run: (pk) => { if (!S().pig.active) sim.launchPig({ auto: false }); const p = S().pig; p.pkKm = Number(pk); p.stuck = true; p.status = 'stuck'; p.speedKmPerHour = 0; S().globalFlowSetpoint = Math.max(120, S().globalFlowSetpoint * 0.6); } },
      { k: 'xs', g: 'Scraper', t: 'Falla del sensor de paso (XS)', where: 'trap', d: 'El sensor de paso de la trampa no detecta el pig.', c: 'No se confirma la salida o la llegada del scraper.', sup: ['Confirmar el paso con otros indicios (presión, tiempo estimado)', 'Enviar un operador a verificar en la trampa', 'Pedir la reparación del sensor'],
        run: (id) => { const e = eq(); if (e) e.state[id].trap.sensorFault = true; } },
      // operativas
      { k: 'esd', g: 'Operativas', t: 'Paro de emergencia de estación', where: 'station', d: 'Se acciona el pulsador de paro de emergencia.', c: 'La estación para por completo hasta reponer el pulsador y rearmar.', sup: ['Confirmar la causa con el personal de la estación', 'Bajar el caudal de la línea', 'Cerrar las descargas de las bombas', 'Reponer el pulsador, verificar permisivos y rearmar'],
        run: (id) => { sim.failStation(id); ev.esd[id] = true; ev.elec[id] = { cause: 'Paro de emergencia', tTrip: S().timeSec, ready: true }; } },
      { k: 'n2', g: 'Operativas', t: 'Baja presión de nitrógeno de sellos', where: 'station', d: 'Baja la presión del tubo de N2 de los sellos.', c: 'Aviso sin disparo: si no se repone, aumenta el riesgo de pérdida por sello.', sup: ['Ver el aviso en el anunciador', 'Pedir reposición del tubo de N2', 'Vigilar los sellos de las bombas'],
        run: (id) => { ev.n2[id] = true; } },
      { k: 'com', g: 'Operativas', t: 'Pérdida de comunicación con la estación', where: 'station', d: 'El SCADA deja de recibir datos de la estación.', c: 'Los valores quedan congelados: no se puede operar a distancia.', sup: ['Detectar los valores congelados y el aviso de comunicación', 'Confirmar el estado por radio o teléfono con la estación', 'No maniobrar a ciegas: operar en local si hace falta', 'Pedir la reparación del enlace'],
        run: (id) => { ev.comm[id] = true; } },
    ];
    // estado
    const scheduled = []; // {uid, k, loc, leftS, label}
    const active = []; // {uid, k, loc, label, t0, real0, steps:[bool], resolved, resp}
    let uidN = 1;
    let form = { k: CAT[0].k, loc: null, delay: 0 };
    function fault(k) { return CAT.find((c) => c.k === k); }
    function available(c) { return locOptions(c.where).length > 0; }
    function ensureLoc() { const c = fault(form.k); const opts = locOptions(c.where); if (!opts.some((o) => String(o[0]) === String(form.loc))) form.loc = opts.length ? (c.where === 'pk' ? String(opts[Math.floor(opts.length / 2)][0]) : opts[0][0]) : null; }
    ensureLoc();

    function fire(k, loc) {
      const c = fault(k);
      if (!c) return;
      try { c.run(loc); } catch (err) { console.error(err); }
      const label = `${c.t} · ${locLabel(c.where, loc)}`;
      active.unshift({ uid: uidN++, k, loc, label, t0: S().timeSec, real0: Date.now(), steps: c.sup.map(() => false), resolved: false });
      evLog(`FALLA: ${label}`);
      if (app.toast) app.toast('Falla: ' + label);
    }
    function schedule(k, loc, minutes) {
      const c = fault(k);
      if (!(minutes > 0)) { fire(k, loc); return; }
      scheduled.push({ uid: uidN++, k, loc, leftS: minutes * 60, label: `${c.t} · ${locLabel(c.where, loc)}` });
      evLog(`Falla programada en ${minutes} min: ${c.t} · ${locLabel(c.where, loc)}`);
    }
    function tick(dt) {
      if (S().running === false) return;
      for (let i = scheduled.length - 1; i >= 0; i--) {
        scheduled[i].leftS -= dt;
        if (scheduled[i].leftS <= 0) { const x = scheduled.splice(i, 1)[0]; fire(x.k, x.loc); }
      }
    }
    function resolve(a) {
      const c = fault(a.k);
      a.resolved = true;
      a.resp = { simMin: (S().timeSec - a.t0) / 60, realS: (Date.now() - a.real0) / 1000, steps: a.steps.filter(Boolean).length, n: a.steps.length };
      // normalizaciones propias de cada falla
      const e = eq();
      if (c.k === 'altap') { S().scenarioActive = null; const x = st(a.loc); x.pDescSpKgCm2 = x._spFault != null ? x._spFault : Math.min(x.pDescSpKgCm2, 80); delete x._spFault; }
      if (c.k === 'vb') sim.setValve(a.loc, true);
      if (c.k === 'com') delete ev.comm[a.loc];
      if (c.k === 'n2') delete ev.n2[a.loc];
      if (c.k === 'xs' && e) e.state[a.loc].trap.sensorFault = false;
      if (c.k === 'hvac' && e) e.state[a.loc].hvacFail = false;
      if ((c.k === 'sello') && e) Object.values(e.state[a.loc].pumps).forEach((k) => { k.sealLeak = false; });
      if (c.k === 'agua') sim.setWaterSlug(0.2);
      if (c.k === 'fuga' || c.k === 'rotura') { const r = S().rupture; if (r && r.active) { r.integrityOk = true; } }
      evLog(`Falla atendida: ${a.label} · ${fmt(a.resp.simMin, 0)} min simulados · ${a.resp.steps}/${a.resp.n} pasos`);
    }

    // ---------- pantalla ----------
    function formHtml() {
      ensureLoc();
      const c = fault(form.k);
      const groups = [...new Set(CAT.map((x) => x.g))];
      let h = `<div class="fl-form"><h3 class="sc-h3">Programar una falla <span>simulador educativo · el instructor elige dónde y cuándo</span></h3>`;
      h += `<label>Falla <select id="fl-k">${groups.map((g) => `<optgroup label="${esc(g)}">${CAT.filter((x) => x.g === g).map((x) => `<option value="${x.k}" ${x.k === form.k ? 'selected' : ''} ${available(x) ? '' : 'disabled'}>${esc(x.t)}</option>`).join('')}</optgroup>`).join('')}</select></label>`;
      h += `<label>Ubicación <select id="fl-loc">${locOptions(c.where).map(([v, t]) => `<option value="${esc(v)}" ${String(v) === String(form.loc) ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select></label>`;
      h += `<label>Ocurre en <select id="fl-delay">${[0, 1, 2, 3, 5, 10, 15, 20, 30].map((m) => `<option value="${m}" ${m === form.delay ? 'selected' : ''}>${m ? m + ' min' : 'ahora'}</option>`).join('')}</select></label>`;
      h += `<div class="me-btns"><button type="button" class="sc-btn exec" data-fl="go">${form.delay ? 'Programar' : 'Disparar ahora'}</button></div>`;
      h += `<div class="fl-desc"><p><b>Qué pasa:</b> ${esc(c.d)}</p><p><b>Consecuencia en el ducto:</b> ${esc(c.c)}</p><p><b>Qué hace el supervisor:</b></p><ol>${c.sup.map((x) => `<li>${esc(x)}</li>`).join('')}</ol></div></div>`;
      if (scheduled.length) h += `<h3 class="sc-h3">Programadas</h3><div class="fl-list">${scheduled.map((x) => `<div class="fl-item"><b>${esc(x.label)}</b><span>en ${Math.floor(x.leftS / 60)}:${String(Math.floor(x.leftS % 60)).padStart(2, '0')} min</span><button type="button" class="sc-btn" data-flcancel="${x.uid}">Cancelar</button></div>`).join('')}</div>`;
      return h;
    }
    function activeHtml() {
      const open = active.filter((a) => !a.resolved);
      const done = active.filter((a) => a.resolved).slice(0, 6);
      let h = `<h3 class="sc-h3">Fallas activas <span>marcá los pasos a medida que el supervisor los cumple</span></h3>`;
      if (!open.length) h += '<p class="me-empty">Sin fallas activas.</p>';
      for (const a of open) {
        const c = fault(a.k);
        const mins = Math.max(0, (S().timeSec - a.t0) / 60);
        h += `<div class="fl-act"><div class="fl-act-h"><b>${esc(a.label)}</b><span>hace ${fmt(mins, 0)} min simulados</span></div><p class="me-note">${esc(c.c)}</p><ul class="ev-pb">${c.sup.map((x, i) => `<li><label><input type="checkbox" data-flstep="${a.uid}:${i}" ${a.steps[i] ? 'checked' : ''}> ${esc(x)}</label></li>`).join('')}</ul><div class="me-btns"><button type="button" class="sc-btn exec" data-flres="${a.uid}">Marcar como atendida</button></div></div>`;
      }
      if (done.length) h += `<h3 class="sc-h3">Atendidas</h3><table class="me-table"><thead><tr><th>Falla</th><th class="r">Respuesta (min sim.)</th><th class="r">Pasos</th></tr></thead><tbody>${done.map((a) => `<tr><td>${esc(a.label)}</td><td class="r mono">${fmt(a.resp.simMin, 0)}</td><td class="r mono">${a.resp.steps}/${a.resp.n}</td></tr>`).join('')}</tbody></table>`;
      return h;
    }
    function click(el) {
      const d = el.dataset;
      if (d.fl === 'go') { if (form.loc != null) schedule(form.k, form.loc, Number(form.delay) || 0); return true; }
      if (d.flcancel) { const i = scheduled.findIndex((x) => x.uid === Number(d.flcancel)); if (i >= 0) { evLog('Falla programada cancelada: ' + scheduled[i].label); scheduled.splice(i, 1); } return true; }
      if (d.flres) { const a = active.find((x) => x.uid === Number(d.flres)); if (a && !a.resolved) resolve(a); return true; }
      return false;
    }
    function change(el) {
      if (el.id === 'fl-k') { form.k = el.value; form.loc = null; ensureLoc(); return true; }
      if (el.id === 'fl-loc') { form.loc = el.value; return true; }
      if (el.id === 'fl-delay') { form.delay = Number(el.value) || 0; return true; }
      if (el.dataset && el.dataset.flstep) { const [u, i] = el.dataset.flstep.split(':').map(Number); const a = active.find((x) => x.uid === u); if (a) a.steps[i] = el.checked; return true; }
      return false;
    }
    function reset() { scheduled.length = 0; active.forEach((a) => { if (!a.resolved) { try { resolve(a); } catch (err) { console.error(err); } } }); }
    return { formHtml, activeHtml, click, change, tick, reset, fire, schedule, CAT, selector: '[data-fl],[data-flcancel],[data-flres]', hasScheduled: () => scheduled.length > 0 };
  }

  global.createFaults = createFaults;
})(window);
