/* SCADA · Plantas: plantas de tratamiento (PTC), playas de tanques y entregas a clientes,
   ubicadas sobre el ducto con el constructor. Cada planta aporta (+) o toma (−) caudal de la línea
   y tiene sus tanques con nivel, alarmas y operación remota. */
(function (global) {
  'use strict';
  const fmt = (v, d) => (v == null || !isFinite(v) ? '—' : Number(v).toLocaleString('es-AR', { minimumFractionDigits: d == null ? 1 : d, maximumFractionDigits: d == null ? 1 : d }));
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const TIPO = { ptc: 'Planta de tratamiento de crudo', almacenaje: 'Playa de tanques', entrega: 'Entrega a cliente / refinería' };

  function createPlantas(app, ctx) {
    const sim = app.sim, S = () => sim.state;
    const evLog = ctx.evLog || (() => {});
    const list = () => S().stations.filter((x) => x.plant).sort((a, b) => (a.pkKm || 0) - (b.pkKm || 0));
    if (!list().length) return null;
    const why = {};
    let lastT = null;

    function desired(pl) {
      if (!pl.on) return 0;
      const r = Math.max(0, Number(pl.rateM3h) || 0);
      return pl.tipo === 'entrega' || (pl.tipo === 'almacenaje' && pl.modo !== 'despacha') ? -r : r;
    }
    function update() {
      const s = S();
      const t = s.timeSec;
      const dtH = lastT == null ? 0 : Math.max(0, Math.min(0.5, (t - lastT) / 3600));
      lastT = t;
      const flowing = (s.lineFlow || 0) > 30;
      for (const st of list()) {
        const pl = st.plant;
        let q = desired(pl);
        let w = '';
        if (q !== 0 && !flowing) { q = 0; w = 'Sin flujo en la línea'; }
        const full = pl.volM3 >= pl.capM3 * 0.98, empty = pl.volM3 <= pl.capM3 * 0.02;
        if (pl.tipo === 'ptc') {
          if (q > 0 && empty && q > pl.prodM3h) { q = pl.prodM3h; w = 'Tanques vacíos: bombea solo lo que produce'; }
          pl.volM3 += (pl.prodM3h - Math.max(0, q)) * dtH;
          if (pl.volM3 >= pl.capM3) { pl.volM3 = pl.capM3; w = w || 'Tanques llenos: hay que cerrar pozos o aumentar el bombeo'; }
        } else if (pl.tipo === 'almacenaje') {
          if (q < 0 && full) { q = 0; w = 'Tanques llenos: no puede recibir'; }
          if (q > 0 && empty) { q = 0; w = 'Tanques vacíos: no puede despachar'; }
          pl.volM3 -= q * dtH;
        } else {
          if (q < 0 && full) { q = 0; w = 'Tanques del cliente llenos: no puede recibir'; }
          const cons = pl.volM3 > 0 ? pl.prodM3h : 0;
          if (!cons && pl.prodM3h > 0) w = w || 'Cliente sin crudo';
          pl.volM3 += (-q - cons) * dtH;
        }
        pl.volM3 = Math.max(0, Math.min(pl.capM3, pl.volM3));
        pl.effM3h = q;
        if (st.injection) st.injection.rateM3h = q;
        if (w !== (why[st.id] || '') && w) evLog(`${st.shortName}: ${w}`);
        why[st.id] = w;
      }
    }
    function alarms() {
      const out = [];
      for (const st of list()) {
        const pl = st.plant, pct = (100 * pl.volM3) / pl.capM3;
        if (pct >= 98) out.push({ id: 'pl-ff-' + st.id, severity: 'critical', text: `${st.shortName}: ${pl.tk} tanques llenos (${fmt(pct, 0)} %)`, tag: st.shortName });
        else if (pct >= 90) out.push({ id: 'pl-h-' + st.id, severity: 'warn', text: `${st.shortName}: ${pl.tk} alto nivel (${fmt(pct, 0)} %)` });
        if (pct <= 5) out.push({ id: 'pl-ll-' + st.id, severity: pl.tipo === 'entrega' ? 'critical' : 'warn', text: `${st.shortName}: ${pl.tk} muy bajo nivel (${fmt(pct, 0)} %)` });
        if (why[st.id] && /Sin flujo/.test(why[st.id]) && pl.on && pl.rateM3h > 0) out.push({ id: 'pl-nf-' + st.id, severity: 'warn', text: `${st.shortName}: planta en marcha sin flujo en la línea` });
      }
      return out;
    }
    function render() {
      const s = S();
      let h = '<h3 class="sc-h3">Plantas sobre el ducto <span>aporte (+) o toma (−) de caudal, tanques y operación remota</span></h3><div class="pl-grid">';
      for (const st of list()) {
        const pl = st.plant, pct = (100 * pl.volM3) / pl.capM3, q = pl.effM3h || 0;
        const net = pl.tipo === 'ptc' ? pl.prodM3h - Math.max(0, q) : pl.tipo === 'almacenaje' ? -q : -q - pl.prodM3h;
        const aut = net > 1 ? (pl.capM3 - pl.volM3) / net : net < -1 ? pl.volM3 / -net : null;
        h += `<div class="pl-card ${pl.on ? 'on' : 'off'}"><div class="pl-h"><b>${esc(st.shortName)}</b><span>${esc(st.name)}</span><em>${esc(TIPO[pl.tipo] || 'Planta')} · PK ${fmt(st.pkKm, 1)}</em></div>
          <div class="pl-body"><div class="pl-tank" title="${esc(pl.tk)}"><i style="height:${Math.max(0, Math.min(100, pct)).toFixed(0)}%" class="${pct >= 90 || pct <= 5 ? 'bad' : ''}"></i><span>${fmt(pct, 0)} %</span></div>
          <div class="pl-kv"><div><span>Caudal a la línea</span><b class="${q < 0 ? 'neg' : ''}">${q > 0 ? '+' : ''}${fmt(q, 0)} m³/h</b></div><div><span>Presión en el punto</span><b>${fmt(s.pressuresIn[st.id])} kg/cm²</b></div><div><span>${esc(pl.tk)}</span><b>${fmt(pl.volM3, 0)} / ${fmt(pl.capM3, 0)} m³</b></div>${pl.tipo !== 'almacenaje' ? `<div><span>${pl.tipo === 'ptc' ? 'Producción que entra' : 'Consumo del cliente'}</span><b>${fmt(pl.prodM3h, 0)} m³/h</b></div>` : ''}<div><span>${net > 1 ? 'Se llena en' : net < -1 ? 'Se vacía en' : 'Nivel'}</span><b>${aut != null ? fmt(aut, 1) + ' h' : 'estable'}</b></div>${pl.tipo === 'ptc' ? `<div><span>BS&amp;W de salida</span><b>${fmt(pl.bsw, 2)} %</b></div>` : ''}</div></div>
          ${why[st.id] ? `<p class="pl-warn">${esc(why[st.id])}</p>` : ''}
          <div class="pl-ctl"><button type="button" class="sc-btn ${pl.on ? '' : 'exec'}" data-plon="${st.id}">${pl.on ? 'Parar' : 'Poner en marcha'}</button>${pl.tipo === 'almacenaje' ? `<button type="button" class="sc-btn" data-plmode="${st.id}">${pl.modo === 'despacha' ? 'Pasar a recibir' : 'Pasar a despachar'}</button>` : ''}<label>${pl.tipo === 'entrega' ? 'Toma' : pl.tipo === 'almacenaje' ? (pl.modo === 'despacha' ? 'Despacho' : 'Recibo') : 'Bombeo'} <input type="number" min="0" step="10" data-plq="${st.id}" value="${fmt(pl.rateM3h, 0).replace(/\./g, '')}"> m³/h</label>${pl.tipo !== 'almacenaje' ? `<label>${pl.tipo === 'ptc' ? 'Producción' : 'Consumo'} <input type="number" min="0" step="10" data-plp="${st.id}" value="${fmt(pl.prodM3h, 0).replace(/\./g, '')}"> m³/h</label>` : ''}</div></div>`;
      }
      return h + '</div><p class="me-note">Una planta que toma de la línea solo puede hacerlo con caudal pasando. Si cambia el aporte o la toma, cambia el caudal aguas abajo y las presiones de las estaciones siguientes: coordiná con el despacho de cabecera.</p>';
    }
    function click(t) {
      const d = t.dataset;
      const st = sim.stationById(d.plon || d.plmode);
      if (!st || !st.plant) return false;
      const pl = st.plant;
      if (d.plon) { pl.on = !pl.on; evLog(`${st.shortName}: planta ${pl.on ? 'en marcha' : 'parada'} por el operador`); }
      if (d.plmode) { pl.modo = pl.modo === 'despacha' ? 'recibe' : 'despacha'; evLog(`${st.shortName}: playa de tanques pasa a ${pl.modo === 'despacha' ? 'despachar a' : 'recibir de'} la línea`); }
      return true;
    }
    function change(el) {
      const id = el.dataset.plq || el.dataset.plp;
      const st = id && sim.stationById(id);
      if (!st || !st.plant) return false;
      const v = Math.max(0, Number(el.value) || 0);
      if (el.dataset.plq) { st.plant.rateM3h = Math.min(v, st.plant.maxM3h * 2); evLog(`${st.shortName}: caudal de planta ${fmt(st.plant.rateM3h, 0)} m³/h`); }
      else { st.plant.prodM3h = v; evLog(`${st.shortName}: ${st.plant.tipo === 'ptc' ? 'producción' : 'consumo'} ${fmt(v, 0)} m³/h`); }
      return true;
    }
    return { update, alarms, render, click, change, list, selector: '[data-plon],[data-plmode]' };
  }
  global.createPlantas = createPlantas;
})(window);
