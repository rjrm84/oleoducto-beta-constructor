/**
 * PH-LDC UI v3 — Spanish · demo gerencia · file:// friendly
 */
(function () {
  'use strict';

  let sim = null;
  let baseConfig = null;
  let animId = null;
  let pigSopPending = false;

  function qs(sel, root) { return (root || document).querySelector(sel); }
  function qsa(sel, root) { return Array.from((root || document).querySelectorAll(sel)); }

  async function loadConfig() {
    if (window.CUSTOM_CONFIG) return JSON.parse(JSON.stringify(window.CUSTOM_CONFIG));
    if (typeof STATIONS_DATA !== 'undefined' && STATIONS_DATA) {
      try { return JSON.parse(JSON.stringify(STATIONS_DATA)); } catch (e) { /* fall */ }
    }
    const res = await fetch('data/stations.json');
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return await res.json();
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function severityClass(sev) {
    if (sev === 'critical') return 'alarm-critical';
    if (sev === 'warn') return 'alarm-warn';
    return 'alarm-info';
  }
  function stationsOrdered() {
    return sim.sortedStations();
  }
  function pkLabel(st) {
    if (!st) return 'PK ?';
    if (st.pkIsPlaceholder) return 'PK ~' + st.pkKm;
    return 'PK ' + st.pkKm;
  }
  function formatWallClock(ms) {
    try {
      return new Date(ms).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
    } catch (e) { return '--:--:--'; }
  }
  function formatSimStamp(t) {
    const sec = Math.floor(t || 0);
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
  }

  function renderHeader() {
    const dt = qs('#sim-datetime');
    if (dt && sim.formatSimDateTime) dt.textContent = sim.formatSimDateTime();
    qs('#sim-time').textContent = sim.formatSimTime();
    const hod = sim.hourOfDayProgress ? sim.hourOfDayProgress() : { hour: 0, pct: 0 };
    const hodEl = qs('#sim-hod');
    if (hodEl) hodEl.textContent = hod.hour.toFixed(1) + ' h';
    const fill = qs('#hod-fill');
    if (fill) fill.style.width = Math.max(0, Math.min(100, hod.pct)) + '%';
    const hl = qs('#hod-label');
    if (hl) hl.textContent = 'Hora del día · ' + hod.hour.toFixed(1) + '/24';
    qs('#sim-speed').textContent = sim.state.speed + 'x';
    qs('#line-flow').textContent = (sim.state.lineFlow || 0).toFixed(0) + ' m³/h';
    const pmm = qs('#line-pminmax');
    if (pmm) {
      const a = sim.state.linePMin;
      const b = sim.state.linePMax;
      pmm.textContent = (a != null && b != null) ? (a.toFixed(1) + ' / ' + b.toFixed(1) + ' kg/cm²') : '—';
    }
    const frontEl = qs('#oil-front-kpi');
    if (frontEl) {
      frontEl.textContent = 'PK ' + (sim.state.oilFrontPkKm != null ? sim.state.oilFrontPkKm.toFixed(0) : '—');
    }
    qs('#flow-setpoint-val').textContent = sim.state.globalFlowSetpoint.toFixed(0) + (sim.state.flowTarget != null ? ' → ' + sim.state.flowTarget.toFixed(0) : '');
    const pigEl = qs('#pig-status');
    if (pigEl) {
      const p = sim.state.pig;
      let t = 'Pig: inactivo';
      if (p.status === 'in_transit') {
        t = `Pig PK ${p.pkKm.toFixed(1)} · ${p.speedKmPerHour.toFixed(1)} km/h · ΔP ${p.dPForeAft.toFixed(1)}`;
        const et = sim.pigEtas().find((x) => x.etaH != null);
        if (et) t += ` · ${sim.stationById(et.id).shortName} en ${et.etaH.toFixed(1)} h`;
      } else if (p.status === 'stuck') t = `Pig ATASCADO PK ${p.pkKm.toFixed(1)}`;
      else if (p.status === 'received') t = 'Pig: recibido en LC';
      pigEl.textContent = t;
    }
    const pause = qs('#btn-pause');
    if (pause) pause.textContent = sim.state.running ? 'Pausar' : 'Reanudar';
    const auto = qs('#cd-autonomy');
    if (auto) {
      if (sim.state.phFailed && sim.state.cdTempHead) {
        auto.hidden = false;
        auto.textContent = `CD cabecera temporal · autonomía ${sim.state.cdAutonomyRemainH.toFixed(2)} / ${sim.state.cdAutonomyTotalH} h · linepack PH–CD`;
        auto.className = 'autonomy-banner' + (sim.state.cdAutonomyRemainH < 0.5 ? ' critical' : '');
      } else if (sim.state.allStationsOff) {
        auto.hidden = false;
        auto.textContent = 'CASCADA TOTAL — todas EB off · sin cabecera CD · Q→0 · notificar CILC';
        auto.className = 'autonomy-banner critical';
      } else {
        auto.hidden = true;
      }
    }
  }

  function renderImpact() {
    const imp = sim.state.impact;
    if (!imp) return;
    const set = (id, v) => { const el = qs(id); if (el) el.textContent = v; };
    set('#imp-lost', imp.lostM3h.toFixed(0) + ' m³/h');
    set('#imp-cum', imp.cumulativeLostM3.toFixed(0) + ' m³');
    set('#imp-hours', imp.hoursToNormalize != null ? imp.hoursToNormalize.toFixed(1) + ' h' : '—');
    set('#imp-pct', imp.pctDailyPlan.toFixed(0) + '%');
    set('#imp-usd', 'USD ' + imp.opportunityUsd.toFixed(0));
    const light = qs('#imp-light');
    const card = qs('#imp-traffic');
    if (light) {
      light.textContent = imp.traffic === 'green' ? '● VERDE' : imp.traffic === 'amber' ? '● ÁMBAR' : '● ROJO';
      light.style.color = imp.traffic === 'green' ? '#4ade80' : imp.traffic === 'amber' ? '#f59e0b' : '#ef4444';
    }
    if (card) card.dataset.traffic = imp.traffic;
    const lc = qs('#lc-receipt');
    if (lc) {
      const q = sim.state.segmentFlows.lc != null ? sim.state.segmentFlows.lc : sim.state.lineFlow || 0;
      const p = sim.state.pressuresIn.lc != null ? sim.state.pressuresIn.lc : 0;
      lc.innerHTML = `<div class="lc-box"><strong>${q.toFixed(0)}</strong> m³/h recibo<br/><span class="muted">P llegada ${p.toFixed(1)} kg/cm² · target ${sim.state.lcReceiptTarget || 800}</span></div>`;
    }
  }

  function renderPlaybook() {
    const box = qs('#playbook-panel');
    if (!box) return;
    const steps = sim.state.playbookActive || [];
    if (!steps.length) {
      box.innerHTML = '<p class="muted">Se activa al disparar fallas / pig / calidad / crisis.</p>';
      return;
    }
    box.innerHTML = steps.map((s) =>
      `<label class="pb-step"><input type="checkbox" data-pb="${escapeHtml(s.id)}" ${s.done ? 'checked' : ''}/> ${escapeHtml(s.text)} <em class="edit-hint">${escapeHtml(s.group)}</em></label>`
    ).join('');
    box.querySelectorAll('input[data-pb]').forEach((inp) => {
      inp.addEventListener('change', () => sim.togglePlaybookCheck(inp.dataset.pb));
    });
  }

  function renderThresholds() {
    const box = qs('#thresholds-panel');
    if (!box || box.dataset.bound === '1') return;
    const t = sim.state.thresholds || {};
    box.innerHTML = `
      <p class="muted" style="margin-top:0">operativo / no contractual</p>
      <label class="ed-label">P_asp mín default (kg/cm²)
        <input type="number" id="th-pasp" step="0.5" min="1" max="10" value="${t.pAspMinKgCm2_default || 4}"/>
      </label>
      <label class="ed-label">Target recibo LC (m³/h)
        <input type="number" id="th-lc" step="10" value="${t.lcReceiptTargetM3h || 800}"/>
      </label>
      <label class="ed-label">Autonomía CD (h)
        <input type="number" id="th-cd" step="0.25" min="0.25" max="8" value="${t.cdAutonomyHours || 2}"/>
      </label>
      <label class="ed-label">Delay respuesta ops (min)
        <input type="number" id="th-delay" step="1" value="${t.operatorResponseDelayMin || 5}"/>
      </label>
      <label class="ed-label">Agua OOS % en LC
        <input type="number" id="th-water" step="0.05" min="0" max="5" value="${t.waterSlugOosPct || 0.75}"/>
      </label>
      <label class="ed-label">% agua batch actual
        <input type="number" id="th-water-now" step="0.05" min="0" max="5" value="${sim.state.waterSlugPct || 0.2}"/>
      </label>
      <label class="ed-label">Excel duty (vs DATOS BOMBEO)
        <input type="checkbox" id="th-excel" ${sim.state.useExcelDuty ? 'checked' : ''}/>
      </label>
      <label class="ed-label">P_desc máx con DRA (kg/cm²)
        <input type="number" id="th-pdesc" step="1" min="50" max="120" value="${t.pDescMaxKgCm2 != null ? t.pDescMaxKgCm2 : 85}"/>
      </label>
      <label class="ed-label">P_mín línea (kg/cm²)
        <input type="number" id="th-pmin" step="0.5" min="0" max="20" value="${t.pMinLineKgCm2 != null ? t.pMinLineKgCm2 : 2}"/>
      </label>
      <label class="ed-label">P_máx línea (kg/cm²)
        <input type="number" id="th-pmax" step="1" min="20" max="120" value="${t.pMaxLineKgCm2 != null ? t.pMaxLineKgCm2 : 95}"/>
      </label>
      <label class="ed-label">DRA default L/h (0–10)
        <input type="number" id="th-dra-lph" step="0.5" min="0" max="10" value="${t.draDefaultLph != null ? t.draDefaultLph : 6}"/>
      </label>
      <div class="editor-actions"><button type="button" class="btn accent" id="btn-apply-th">Aplicar umbrales</button></div>
      <h4 style="margin-top:12px">MAOP tramos (estim. entrenamiento)</h4>
      <div id="maop-edits"></div>
    `;
    const maop = qs('#maop-edits');
    if (maop) {
      maop.innerHTML = (sim.state.config.segments || []).map((s) =>
        `<label class="ed-label">${escapeHtml(s.id)} MAOP kg/cm² · Q ${s.qMaxM3h}/${s.qMaxDraM3h} DRA
          <input type="number" data-maop="${escapeHtml(s.id)}" value="${s.maopKgCm2}" step="1"/>
        </label>`
      ).join('');
    }
    box.dataset.bound = '1';
    qs('#btn-apply-th')?.addEventListener('click', () => {
      sim.setThreshold('pAspMinKgCm2_default', Number(qs('#th-pasp').value));
      sim.setThreshold('lcReceiptTargetM3h', Number(qs('#th-lc').value));
      sim.setThreshold('cdAutonomyHours', Number(qs('#th-cd').value));
      sim.state.cdAutonomyTotalH = Number(qs('#th-cd').value) || 2;
      sim.setThreshold('operatorResponseDelayMin', Number(qs('#th-delay').value));
      sim.setThreshold('waterSlugOosPct', Number(qs('#th-water').value));
      sim.setWaterSlug(Number(qs('#th-water-now').value));
      sim.state.useExcelDuty = !!qs('#th-excel')?.checked;
      sim.setThreshold('pDescMaxKgCm2', Number(qs('#th-pdesc').value));
      sim.setThreshold('pMinLineKgCm2', Number(qs('#th-pmin').value));
      sim.setThreshold('pMaxLineKgCm2', Number(qs('#th-pmax').value));
      sim.setThreshold('draDefaultLph', Number(qs('#th-dra-lph').value));
      qsa('#maop-edits [data-maop]').forEach((inp) => sim.updateSegmentMaop(inp.dataset.maop, Number(inp.value)));
      sim.persistStationsOverride();
      renderEventLog();
    });
  }

  function renderLinepack() {
    const box = qs('#linepack-panel');
    if (!box) return;
    const lp = sim.state.linepack || {};
    const segs = sim.state.config.segments || [];
    if (!segs.length) { box.innerHTML = ''; return; }
    box.innerHTML = segs.map((s) => {
      const x = lp[s.id] || {};
      return `<div class="lp-row"><strong>${escapeHtml(s.id)}</strong> ${((x.m3) || s.linepackM3 || 0).toFixed(0)} m³
        <span class="muted">MAOP ${s.maopKgCm2} · Qmáx ${sim.state.draEnabled ? s.qMaxDraM3h : s.qMaxM3h}</span></div>`;
    }).join('');
  }

  function renderValves() {
    const box = qs('#valves-panel');
    if (!box) return;
    box.innerHTML = (sim.state.valves || []).map((v) =>
      `<button type="button" class="vb-btn ${v.open ? 'open' : 'closed'}" data-vb="${escapeHtml(v.id)}">${escapeHtml(v.name)} PK${v.pkKm} · ${v.open ? 'ABIERTA' : 'CERRADA'}</button>`
    ).join('');
    box.querySelectorAll('[data-vb]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const v = sim.state.valves.find((x) => x.id === btn.dataset.vb);
        if (v) sim.setValve(v.id, !v.open);
        renderValves();
        renderEventLog();
      });
    });
  }

  function renderAlarms() {
    const box = qs('#alarms-list');
    if (!box) return;
    const alarms = sim.state.alarms;
    if (!alarms.length) { box.innerHTML = '<div class="alarm-ok">Sin alarmas activas</div>'; return; }
    box.innerHTML = alarms.map((a) =>
      `<div class="alarm ${severityClass(a.severity)}"><span class="dot"></span>${escapeHtml(a.text)}</div>`
    ).join('');
  }
  function renderAlarmLog() {
    const box = qs('#alarm-log');
    if (!box) return;
    const rows = sim.state.alarmLog;
    if (!rows.length) { box.innerHTML = '<div class="log-empty">Sin entradas</div>'; return; }
    box.innerHTML = rows.slice(0, 80).map((r) =>
      `<div class="log-row ${severityClass(r.severity)}"><span class="log-ts">${escapeHtml(formatWallClock(r.wallMs))} · t=${escapeHtml(formatSimStamp(r.t))}</span><span class="log-msg">${escapeHtml(r.message)}</span></div>`
    ).join('');
  }
  function renderEventLog() {
    const box = qs('#event-log');
    if (!box) return;
    const rows = sim.state.eventLog;
    if (!rows.length) { box.innerHTML = '<div class="log-empty">Sin eventos</div>'; return; }
    box.innerHTML = rows.slice(0, 80).map((r) =>
      `<div class="log-row log-${escapeHtml(r.kind || 'info')}"><span class="log-ts">${escapeHtml(formatWallClock(r.wallMs))} · t=${escapeHtml(formatSimStamp(r.t))}</span><span class="log-msg">${escapeHtml(r.message)}</span></div>`
    ).join('');
  }
  function renderTanksSidebar() {
    const box = qs('#tanks-sidebar');
    if (!box) return;
    const lc = sim.stationById('lc');
    if (!lc || !lc.tanks) { box.innerHTML = ''; return; }
    box.innerHTML = lc.tanks.map((tk) => {
      const pct = Math.max(0, Math.min(100, tk.levelPct));
      return `<div class="tank-mini"><div class="tank-mini-label">${escapeHtml(tk.name)} · ${escapeHtml(tk.mode || '')}</div><div class="tank-mini-bar"><div style="width:${pct}%"></div></div><div class="tank-mini-pct">${Math.round(tk.volumeM3 || 0).toLocaleString('es-AR')} m³</div></div>`;
    }).join('');
  }

  function pkToX(pk, w, pad) {
    return pad + (pk / sim.lengthKm()) * (w - 2 * pad);
  }

  function drawSchematic() {
    const canvas = qs('#schematic-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const w = rect.width, h = rect.height;
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#0d1518';
    ctx.fillRect(0, 0, w, h);
    const pad = 40;
    const yPipe = h * 0.55;
    const stations = stationsOrdered().filter((s) => s.type !== 'valve' || s.id === 'pa');

    ctx.strokeStyle = '#1a6b6b';
    ctx.lineWidth = 14;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(pad, yPipe);
    ctx.lineTo(w - pad, yPipe);
    ctx.stroke();

    // Oil column filled to reachable / oil front PK
    const Lkm = sim.lengthKm();
    const frontPk = Math.min(
      Lkm,
      sim.state.oilFrontPkKm != null ? sim.state.oilFrontPkKm : 0,
      sim.state.oilReachablePkKm != null ? sim.state.oilReachablePkKm : Lkm
    );
    const xFront = pkToX(frontPk, w, pad);
    const flow = sim.state.lineFlow || 0;
    const grad = ctx.createLinearGradient(pad, 0, xFront, 0);
    grad.addColorStop(0, '#9a3412');
    grad.addColorStop(0.55, '#ea580c');
    grad.addColorStop(1, '#fbbf24');
    ctx.strokeStyle = grad;
    ctx.lineWidth = 10;
    ctx.beginPath();
    ctx.moveTo(pad, yPipe);
    ctx.lineTo(Math.max(pad, xFront), yPipe);
    ctx.stroke();
    ctx.strokeStyle = sim.state.allStationsOff ? '#7f1d1d' : '#2dd4bf';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(pad, yPipe);
    ctx.lineTo(w - pad, yPipe);
    ctx.stroke();

    // Moving oil parcels / slug along pressurized section (freeze when duct stopped)
    if (frontPk > 2) {
      const ductRun = sim.isDuctMotionRunning ? sim.isDuctMotionRunning() : ((sim.state.lineFlow || 0) > 5);
      if (!ductRun) {
        if (sim.state.animPhaseFrozen == null) sim.state.animPhaseFrozen = (sim.state.timeSec * 0.003) % 1;
      } else {
        sim.state.animPhaseFrozen = (sim.state.timeSec * Math.min(sim.state.speed, 60) * 0.003) % 1;
      }
      const t = sim.state.animPhaseFrozen != null ? sim.state.animPhaseFrozen : 0;
      const n = 10;
      for (let i = 0; i < n; i++) {
        const frac = (i / n + t) % 1;
        const pk = frac * frontPk;
        const x = pkToX(pk, w, pad);
        ctx.beginPath();
        ctx.ellipse(x, yPipe, 11, 5, 0, 0, Math.PI * 2);
        ctx.fillStyle = i === Math.floor((t * n) % n) ? 'rgba(251,191,36,0.95)' : 'rgba(234,88,12,0.55)';
        ctx.fill();
      }
      // Oil front marker
      ctx.beginPath();
      ctx.moveTo(xFront, yPipe - 14);
      ctx.lineTo(xFront + 10, yPipe);
      ctx.lineTo(xFront, yPipe + 14);
      ctx.closePath();
      ctx.fillStyle = '#fde68a';
      ctx.fill();
      ctx.strokeStyle = '#b45309';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.fillStyle = '#fbbf24';
      ctx.font = 'bold 10px system-ui';
      ctx.textAlign = 'center';
      ctx.fillText('FRENTE PK ' + frontPk.toFixed(0), Math.min(w - pad - 40, Math.max(pad + 40, xFront)), yPipe - 22);
    }
    if (flow <= 5) {
      ctx.fillStyle = '#fca5a5';
      ctx.font = '10px system-ui';
      ctx.textAlign = 'left';
      ctx.fillText('Sin caudal efectivo', pad, yPipe - 28);
    }

    // injection side branches
    for (const st of stations) {
      const inj = sim.stationInjectionTotal(st);
      if (inj > 0.5) {
        const x = pkToX(st.pkKm, w, pad);
        ctx.strokeStyle = '#f59e0b';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(x, yPipe);
        ctx.lineTo(x, yPipe - 48);
        ctx.stroke();
        ctx.fillStyle = '#fbbf24';
        ctx.font = '9px system-ui';
        ctx.textAlign = 'center';
        ctx.fillText('INJ ' + inj.toFixed(0), x, yPipe - 52);
      }
    }

    for (const st of stations) {
      const x = pkToX(st.pkKm, w, pad);
      const selected = sim.state.selectedStationId === st.id;
      const pIn = sim.state.pressuresIn[st.id] || 0;
      const pOut = sim.state.pressuresOut[st.id] || 0;
      let fill = '#14b8a6';
      if (st.type === 'valve') fill = '#a78bfa';
      if (st.type === 'terminal' || st.type === 'cabecera') fill = '#38bdf8';
      if (sim.state.failedStations[st.id] || (st.pumps && st.pumps.length && st.pumps.every((pu) => !pu.online))) fill = '#ef4444';
      if (sim.state.cdTempHead && st.id === 'cd') fill = '#f59e0b';

      ctx.beginPath();
      ctx.arc(x, yPipe, selected ? 13 : 10, 0, Math.PI * 2);
      ctx.fillStyle = fill;
      ctx.fill();
      ctx.strokeStyle = selected ? '#fff' : '#0f766e';
      ctx.lineWidth = selected ? 3 : 2;
      ctx.stroke();

      if (st.pumps && st.pumps.length) {
        const mains = st.pumps.filter((pu) => pu.role !== 'booster' && pu.role !== 'booster_suction');
        const on = mains.filter((pu) => pu.online).length;
        const need = sim.minMainsRequired ? sim.minMainsRequired(st) : 2;
        ctx.fillStyle = on >= need ? '#94a3b8' : '#fca5a5';
        ctx.font = '9px ui-monospace, monospace';
        ctx.textAlign = 'center';
        ctx.fillText(`B ${on}/${mains.length} (≥${need})`, x, yPipe - 20);
      }

      ctx.fillStyle = '#e2e8f0';
      ctx.font = selected ? 'bold 11px system-ui' : '11px system-ui';
      ctx.textAlign = 'center';
      ctx.fillText(st.shortName || st.name, x, yPipe + 26);
      ctx.fillStyle = st.pkIsPlaceholder ? '#f59e0b' : '#64748b';
      ctx.font = '9px ui-monospace, monospace';
      ctx.fillText(pkLabel(st), x, yPipe + 40);
      ctx.fillStyle = '#94a3b8';
      const pMn = sim.state.segmentPMin[st.id];
      const pMx = sim.state.segmentPMax[st.id];
      const qSt = sim.state.segmentFlows[st.id];
      ctx.fillText(`asp ${pIn.toFixed(0)} / disc ${pOut.toFixed(0)}`, x, yPipe + 54);
      ctx.fillStyle = '#67e8f9';
      ctx.font = 'bold 9px ui-monospace, monospace';
      ctx.fillText(`Q ${qSt != null ? qSt.toFixed(0) : '—'} m³/h`, x, yPipe + 66);
      if (pMn != null && pMx != null) {
        ctx.fillStyle = '#64748b';
        ctx.font = '8px ui-monospace, monospace';
        ctx.fillText(`mín ${pMn.toFixed(0)} · máx ${pMx.toFixed(0)}`, x, yPipe + 78);
      }
    }

    const pig = sim.state.pig;
    if (pig.active || pig.status === 'stuck' || pig.status === 'received') {
      const pk = pig.status === 'received' ? sim.lengthKm() : pig.pkKm;
      const x = pkToX(pk, w, pad);
      ctx.beginPath();
      ctx.ellipse(x, yPipe, 9, 7, 0, 0, Math.PI * 2);
      ctx.fillStyle = pig.stuck ? '#ef4444' : '#fb923c';
      ctx.fill();
      ctx.fillStyle = '#fdba74';
      ctx.font = 'bold 10px system-ui';
      ctx.textAlign = 'center';
      ctx.fillText('PIG', x, yPipe - 16);
    }

    if (sim.state.cascadeBlock && sim.state.cascadeBlock.reason && sim.state.cascadeBlock.reason !== 'ok') {
      ctx.fillStyle = 'rgba(127,29,29,0.85)';
      ctx.fillRect(pad, 4, w - 2 * pad, 18);
      ctx.fillStyle = '#fecaca';
      ctx.font = '10px system-ui';
      ctx.textAlign = 'center';
      ctx.fillText(
        'Alcance: ' + sim.state.cascadeBlock.reason + ' · frente reachable PK ' +
          Number(sim.state.oilReachablePkKm || 0).toFixed(0),
        w / 2,
        16
      );
    }
    ctx.fillStyle = '#64748b';
    ctx.font = '10px system-ui';
    ctx.textAlign = 'left';
    ctx.fillText('PH (Neuquén)', pad, 28);
    ctx.textAlign = 'right';
    ctx.fillText('LC (Mendoza)', w - pad, 16);
    ctx.textAlign = 'center';
    if (sim.isDuctMotionRunning && !sim.isDuctMotionRunning()) {
      ctx.fillStyle = 'rgba(127,29,29,0.75)';
      ctx.fillRect(pad, h - 28, w - 2 * pad, 16);
      ctx.fillStyle = '#fecaca';
      ctx.font = '10px system-ui';
      ctx.textAlign = 'center';
      ctx.fillText('DUCTO DETENIDO — frente / partículas / pig congelados', w / 2, h - 16);
    }
    ctx.fillStyle = '#f59e0b';
    ctx.font = '9px system-ui';
    ctx.fillText('No Confidencial · altimetría PH-LC / datos bombeo · asp/disc kg/cm²', w / 2, h - 8);
  }

  function drawAltimetry() {
    const canvas = qs('#altimetry-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const w = rect.width, h = rect.height;
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#0a1214';
    ctx.fillRect(0, 0, w, h);
    const series = sim.getAltimetrySeries();
    if (!series.length) return;
    const padL = 52, padR = 24, padT = 28, padB = 36;
    const plotW = w - padL - padR, plotH = h - padT - padB;
    let minE = Infinity, maxE = -Infinity;
    for (const pt of series) {
      minE = Math.min(minE, pt.elev, pt.hgl || pt.elev);
      maxE = Math.max(maxE, pt.elev, pt.hgl || pt.elev);
    }
    minE = Math.floor(minE / 50) * 50 - 50;
    maxE = Math.ceil(maxE / 50) * 50 + 100;
    const L = sim.lengthKm();
    const xOf = (pk) => padL + (pk / L) * plotW;
    const yOf = (e) => padT + ((maxE - e) / (maxE - minE)) * plotH;

    ctx.strokeStyle = '#1e293b';
    ctx.fillStyle = '#475569';
    ctx.font = '9px ui-monospace, monospace';
    ctx.textAlign = 'right';
    for (let e = minE; e <= maxE; e += 200) {
      const y = yOf(e);
      ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(padL + plotW, y); ctx.stroke();
      ctx.fillText(String(e), padL - 6, y + 3);
    }
    ctx.textAlign = 'center';
    for (let pk = 0; pk <= L; pk += 100) {
      const x = xOf(pk);
      ctx.beginPath(); ctx.moveTo(x, padT); ctx.lineTo(x, padT + plotH); ctx.stroke();
      ctx.fillText('PK ' + pk, x, h - 12);
    }

    ctx.beginPath();
    ctx.moveTo(xOf(series[0].pkKm), yOf(minE));
    for (const pt of series) ctx.lineTo(xOf(pt.pkKm), yOf(pt.elev));
    ctx.lineTo(xOf(series[series.length - 1].pkKm), yOf(minE));
    ctx.closePath();
    ctx.fillStyle = 'rgba(20,83,45,0.35)';
    ctx.fill();

    ctx.beginPath();
    series.forEach((pt, i) => { const x = xOf(pt.pkKm), y = yOf(pt.elev); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
    ctx.strokeStyle = '#4ade80';
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.beginPath();
    series.forEach((pt, i) => { const x = xOf(pt.pkKm), y = yOf(pt.hgl || pt.elev); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
    ctx.strokeStyle = '#22d3ee';
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);
    ctx.stroke();
    ctx.setLineDash([]);

    for (const pt of series) {
      if (!pt.name) continue;
      ctx.beginPath();
      ctx.arc(xOf(pt.pkKm), yOf(pt.elev), pt.profileOnly ? 3 : 4, 0, Math.PI * 2);
      ctx.fillStyle = pt.profileOnly ? '#f472b6' : '#f8fafc';
      ctx.fill();
      ctx.fillStyle = '#94a3b8';
      ctx.font = '9px system-ui';
      ctx.textAlign = 'center';
      ctx.fillText(pt.name, xOf(pt.pkKm), yOf(pt.elev) - 10);
    }

    // Interpolate elevation along the profile polyline at a given PK
    function elevOnProfile(pk) {
      if (!series.length) return 0;
      if (pk <= series[0].pkKm) return series[0].elev;
      for (let i = 0; i < series.length - 1; i++) {
        const a = series[i], b = series[i + 1];
        if (pk >= a.pkKm && pk <= b.pkKm) {
          const t = (pk - a.pkKm) / (b.pkKm - a.pkKm || 1);
          return a.elev + t * (b.elev - a.elev);
        }
      }
      return series[series.length - 1].elev;
    }

    // Oil column + moving slug/front along profile up to oilFrontPkKm
    const flowQ = sim.state.lineFlow || 0;
    const frontPkA = Math.min(
      L,
      sim.state.oilFrontPkKm != null ? sim.state.oilFrontPkKm : 0,
      sim.state.oilReachablePkKm != null ? sim.state.oilReachablePkKm : L
    );
    if (series.length > 1 && frontPkA > 1) {
      // tint elevation under oil
      ctx.beginPath();
      let started = false;
      for (const pt of series) {
        if (pt.pkKm > frontPkA) break;
        const x = xOf(pt.pkKm), y = yOf(pt.elev);
        if (!started) { ctx.moveTo(x, y); started = true; }
        else ctx.lineTo(x, y);
      }
      // close along front down a bit
      const yF = yOf(elevOnProfile(frontPkA));
      ctx.lineTo(xOf(frontPkA), yF + 8);
      ctx.strokeStyle = 'rgba(234,88,12,0.85)';
      ctx.lineWidth = 5;
      ctx.stroke();

      const pts = [];
      for (const pt of series) {
        if (pt.pkKm > frontPkA) break;
        pts.push({ x: xOf(pt.pkKm), y: yOf(pt.elev), pk: pt.pkKm });
      }
      // ensure front point
      pts.push({ x: xOf(frontPkA), y: yF, pk: frontPkA });
      const segLen = [];
      let total = 0;
      for (let i = 0; i < pts.length - 1; i++) {
        const dx = pts[i + 1].x - pts[i].x, dy = pts[i + 1].y - pts[i].y;
        const len = Math.hypot(dx, dy) || 0.001;
        segLen.push(len);
        total += len;
      }
      const ductRunA = sim.isDuctMotionRunning ? sim.isDuctMotionRunning() : ((sim.state.lineFlow || 0) > 5);
      if (!ductRunA) {
        if (sim.state._altAnimFrozen == null) sim.state._altAnimFrozen = (sim.state.timeSec * 0.0025) % 1;
      } else {
        sim.state._altAnimFrozen = (sim.state.timeSec * Math.min(sim.state.speed, 60) * 0.0025) % 1;
      }
      const tAnim = sim.state._altAnimFrozen != null ? sim.state._altAnimFrozen : 0;
      const nMark = 12;
      for (let i = 0; i < nMark; i++) {
        let dist = ((i / nMark + tAnim) % 1) * total;
        let si = 0;
        while (si < segLen.length - 1 && dist > segLen[si]) {
          dist -= segLen[si];
          si++;
        }
        const a = pts[si], b = pts[Math.min(si + 1, pts.length - 1)];
        const u = dist / (segLen[si] || 1);
        const x = a.x + u * (b.x - a.x);
        const y = a.y + u * (b.y - a.y);
        ctx.beginPath();
        ctx.ellipse(x, y, 7, 4, Math.atan2(b.y - a.y, b.x - a.x), 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(251,191,36,0.85)';
        ctx.fill();
      }
      // Front head
      ctx.beginPath();
      ctx.arc(xOf(frontPkA), yF, 8, 0, Math.PI * 2);
      ctx.fillStyle = '#fde68a';
      ctx.fill();
      ctx.strokeStyle = '#c2410c';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.fillStyle = '#ffedd5';
      ctx.font = 'bold 10px system-ui';
      ctx.textAlign = 'center';
      ctx.fillText('OIL PK' + frontPkA.toFixed(0), xOf(frontPkA), yF - 14);
    } else if (flowQ <= 5) {
      ctx.fillStyle = '#fca5a5';
      ctx.font = '10px system-ui';
      ctx.textAlign = 'left';
      ctx.fillText('Frente de crudo detenido / sin alcance', padL, padT + 12);
    }

    // PIG on the altimetry profile at current pkKm
    const pig = sim.state.pig;
    if (pig && (pig.active || pig.status === 'stuck' || pig.status === 'received')) {
      const pk = pig.status === 'received' ? L : pig.pkKm;
      const x = xOf(pk);
      const y = yOf(elevOnProfile(pk));
      ctx.beginPath();
      ctx.ellipse(x, y, 10, 7, 0, 0, Math.PI * 2);
      ctx.fillStyle = pig.stuck ? '#ef4444' : '#fb923c';
      ctx.fill();
      ctx.strokeStyle = pig.stuck ? '#991b1b' : '#c2410c';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.fillStyle = pig.stuck ? '#fecaca' : '#ffedd5';
      ctx.font = 'bold 10px system-ui';
      ctx.textAlign = 'center';
      ctx.fillText('PIG', x, y - 14);
      ctx.fillStyle = '#fdba74';
      ctx.font = '9px ui-monospace, monospace';
      ctx.fillText('PK ' + pk.toFixed(1), x, y + 18);
    }

    ctx.font = '10px system-ui';
    ctx.textAlign = 'left';
    ctx.fillStyle = '#4ade80';
    ctx.fillText('─ Elevación', padL + 8, padT + 12);
    ctx.fillStyle = '#22d3ee';
    ctx.fillText('┄ HGL', padL + 100, padT + 12);
    ctx.fillStyle = '#ea580c';
    ctx.fillText('● Oil/frente', padL + 150, padT + 12);
    ctx.fillStyle = '#fb923c';
    ctx.fillText('● Pig', padL + 250, padT + 12);
  }

  function renderDetailPanel() {
    const panel = qs('#station-detail');
    if (!panel) return;
    const id = sim.state.selectedStationId;
    if (!id) {
      panel.innerHTML = '<p class="muted">Seleccione una estación en el esquema.</p>';
      return;
    }
    const st = sim.stationById(id);
    if (!st) return;
    const pIn = sim.state.pressuresIn[st.id];
    const pOut = sim.state.pressuresOut[st.id];
    const flow = sim.state.segmentFlows[st.id];
    let html = `<h3>${escapeHtml(st.name)} <span class="tag">${escapeHtml(st.shortName || '')}</span></h3>`;
    if (st.opsNote) html += `<p class="muted">${escapeHtml(st.opsNote)}</p>`;
    html += `<div class="meta-grid">
      <div><span class="lbl">PK</span><span class="val">${st.pkKm} km ${st.pkIsPlaceholder ? '<em class="edit-hint">estim.</em>' : ''}</span></div>
      <div><span class="lbl">Elevación</span><span class="val">${st.elevationMsnm} msnm</span></div>
      <div><span class="lbl">P aspiración</span><span class="val">${pIn != null ? pIn.toFixed(1) : '—'} kg/cm²</span></div>
      <div><span class="lbl">P descarga</span><span class="val">${pOut != null ? pOut.toFixed(1) : '—'} kg/cm²</span></div>
      <div><span class="lbl">Q estación (setpoint)</span><span class="val" style="color:#67e8f9;font-weight:700">${flow != null ? flow.toFixed(0) : '—'} m³/h</span></div>
      <div><span class="lbl">P_asp mín</span><span class="val">${st.pAspMinKgCm2 != null ? st.pAspMinKgCm2 : '—'} <em class="edit-hint">operativo</em></span></div>
      <div><span class="lbl">DRA global</span><span class="val">${sim.state.draEnabled ? 'ON' : 'OFF'}</span></div>
      <div><span class="lbl">P_desc máx</span><span class="val">${sim.pDescMax ? sim.pDescMax() : 85} kg/cm²</span></div>
      <div><span class="lbl">P_mín / P_máx</span><span class="val">${(sim.state.segmentPMin[st.id] != null ? sim.state.segmentPMin[st.id].toFixed(1) : '—')} / ${(sim.state.segmentPMax[st.id] != null ? sim.state.segmentPMax[st.id].toFixed(1) : '—')} kg/cm²</span></div>
      <div><span class="lbl">Frente crudo</span><span class="val">PK ${(sim.state.oilFrontPkKm != null ? sim.state.oilFrontPkKm : 0).toFixed(0)} / reach ${(sim.state.oilReachablePkKm != null ? sim.state.oilReachablePkKm : 0).toFixed(0)}</span></div>
    </div>`;
    if (sim.state.cascadeBlock && sim.state.cascadeBlock.reason && sim.state.cascadeBlock.reason !== 'ok') {
      html += `<p class="muted" style="color:#fecaca">Cascade: ${escapeHtml(sim.state.cascadeBlock.reason)} · qFactor ${(sim.state.cascadeBlock.qFactor || 0).toFixed(2)}</p>`;
    }

    // DRA / polímero — per-station toggle + 0–10 L/h (default 6)
    const draLph = st.draInjectionLph != null ? st.draInjectionLph : 6;
    const draOn = !!(st.draInjectOn || sim.state.draEnabled);
    const cons24 = (draOn ? draLph : 0) * 24;
    html += `<h4>DRA / polímero</h4>
      <p class="muted" style="font-size:11px;margin:0 0 6px">Ops: 6–10 L/h · baja ΔP · P_desc soft ≤ ~85 kg/cm². Consumo 24h = L/h × 24.</p>
      <label class="inj-label" style="display:flex;align-items:center;gap:8px">
        <input type="checkbox" data-dra-inject="${st.id}" ${draOn ? 'checked' : ''}/> Inyectar polímero (sí/no)
      </label>
      <label class="inj-label">Dosis DRA (L/h)
        <input type="range" min="0" max="10" step="0.5" value="${draLph}" data-dra-lph="${st.id}"/>
        <span id="dra-lph-val">${draLph}</span> L/h
      </label>
      <div class="meta-grid" style="margin-top:6px">
        <div><span class="lbl">Consumo 24h estación</span><span class="val" id="dra-cons24">${cons24.toFixed(0)} L</span></div>
        <div><span class="lbl">Σ 24h todas</span><span class="val">${(sim.state.draBoard && sim.state.draBoard.cons24hTotalL != null ? sim.state.draBoard.cons24hTotalL : 0).toFixed(0)} L</span></div>
      </div>`;
    const dpMap = sim.state.segmentDpDra || {};
    const dpRows = Object.keys(dpMap).filter((k) => k.startsWith(st.id + '→') || k.endsWith('→' + st.id));
    if (dpRows.length) {
      html += '<div class="dra-dp-box" style="font-size:11px;margin-top:6px">';
      for (const k of dpRows) {
        const r = dpMap[k];
        html += `<div><strong>ΔP ${escapeHtml(k)}</strong>: sin polímero ${r.dPWithoutKgCm2.toFixed(2)} · con ${r.dPWithKgCm2.toFixed(2)} · <span style="color:#4ade80">ahorro ${r.dPSavedKgCm2.toFixed(2)} kg/cm²</span> @ ${r.draLph} L/h</div>`;
      }
      html += '</div>';
    }

    if (st.id === 'pa' || st.type === 'regulating') {
      const th = st.flowThrottlePct != null ? st.flowThrottlePct : 100;
      html += `<h4>Regulación Pareditas (altimetría)</h4>
        <label class="inj-label">Throttle caudal %
          <input type="range" min="0" max="100" step="1" value="${th}" data-pa-throttle="1"/>
          <span id="pa-th-val">${th}</span>%
        </label>
        <p class="muted" style="font-size:11px">Estación reguladora: limita Q aguas abajo según altimetría (no es solo VB).</p>`;
    }

    if (st.pumps && st.pumps.length) {
      html += '<h4>Bombas</h4><div class="pump-list">';
      const need = sim.minMainsRequired ? sim.minMainsRequired(st) : 2;
      const mains = st.pumps.filter((pu) => pu.role !== 'booster' && pu.role !== 'booster_suction');
      const onM = mains.filter((pu) => pu.online).length;
      html += `<p class="muted" style="font-size:11px">Regla: ≥${need} principales en línea (ahora ${onM}/${mains.length}). Boosters = aspiración, no cuentan.</p>`;
      for (const pu of st.pumps) {
        const isB = pu.role === 'booster' || pu.role === 'booster_suction';
        const tag = isB ? ' · aspiración' : (pu.reserve ? ' · reserva' : '');
        const boostTxt = isB
          ? (pu.suctionAssistKgCm2 != null ? ' · succión +' + pu.suctionAssistKgCm2 : '')
          : (pu.boostKgCm2 != null ? ' · disc +' + pu.boostKgCm2 : '');
        html += `<button type="button" class="pump-btn ${pu.online ? 'on' : 'off'}${isB ? ' booster' : ''}" data-station="${st.id}" data-pump="${pu.id}" aria-pressed="${pu.online ? 'true' : 'false'}" title="Clic para ${pu.online ? 'parar' : 'arrancar'}">
          <span class="pump-led"></span><strong>${pu.online ? 'ON' : 'OFF'}</strong> · ${escapeHtml(pu.name)} — ${pu.online ? 'EN MARCHA' : 'PARADA'}${tag}${boostTxt}
        </button>`;
      }
      html += '</div>';
      html += `<button type="button" class="btn danger" style="margin-top:8px;width:100%" data-fail-one="${st.id}">CAÍDA / APAGAR ${escapeHtml(st.shortName)}</button>`;
    }

    if (st.injections && st.injections.length) {
      html += '<h4>Inyecciones (DATOS DE BOMBEO)</h4>';
      for (const inj of st.injections) {
        const instant = sim.injectionInstantRate(inj);
        const active = sim.state.injectionActive && sim.state.injectionActive[inj.id];
        html += `<div class="inj-card"><div class="inj-head">${escapeHtml(inj.name)}
          <span class="tag ${active || inj.mode === 'continuous' ? 'on' : ''}">${inj.mode} · ${instant.toFixed(1)} m³/h</span></div>
          <p class="muted" style="font-size:11px">${escapeHtml(inj.datosBombeoNote || inj.note || '')}</p>
          <label class="inj-label">Override manual
            <input type="range" min="0" max="${inj.maxM3h}" step="1" value="${inj.manualOverride ? inj.manualRateM3h : 0}" data-inj="${st.id}" data-inj-id="${inj.id}"/>
            <span>${inj.manualOverride ? inj.manualRateM3h : 0}</span>
          </label></div>`;
      }
    }

    if (st.pigTrap && st.pigTrap.type === 'launcher') {
      html += '<button type="button" class="btn accent" id="btn-launch-pig">Lanzar pig (SOP)</button>';
    }
    if (st.tankBuffer) {
      html += `<p class="muted">Buffer ${escapeHtml(st.tankBuffer.name)} — ${escapeHtml(st.tankBuffer.note || '')}</p>`;
    }

    panel.innerHTML = html;
    panel.querySelectorAll('.pump-btn').forEach((btn) => {
      btn.addEventListener('click', () => { sim.togglePump(btn.dataset.station, btn.dataset.pump); renderDetailPanel(); renderEventLog(); });
    });
    panel.querySelectorAll('[data-fail-one]').forEach((btn) => {
      btn.addEventListener('click', () => { sim.failStation(btn.dataset.failOne); renderDetailPanel(); renderEventLog(); renderPlaybook(); });
    });
    panel.querySelector('#btn-launch-pig')?.addEventListener('click', () => openPigSopModal());
    panel.querySelectorAll('input[data-inj]').forEach((inp) => {
      inp.addEventListener('input', () => {
        sim.setInjection(inp.dataset.inj, Number(inp.value), inp.dataset.injId || null);
        const span = inp.parentElement.querySelector('span');
        if (span) span.textContent = inp.value;
      });
    });
    panel.querySelectorAll('input[data-dra-inject]').forEach((inp) => {
      inp.addEventListener('change', () => {
        if (sim.setStationDraInject) sim.setStationDraInject(inp.dataset.draInject, inp.checked);
        renderDetailPanel();
        renderDraDpSummary();
    renderDraBoard();
    renderRuptureBanner();
        renderDraBoard();
        renderEventLog();
      });
    });
    panel.querySelectorAll('input[data-dra-lph]').forEach((inp) => {
      inp.addEventListener('input', () => {
        sim.setStationDraLph(inp.dataset.draLph, Number(inp.value));
        const span = qs('#dra-lph-val', panel);
        if (span) span.textContent = inp.value;
        const cons = qs('#dra-cons24', panel);
        const st2 = sim.stationById(inp.dataset.draLph);
        const on2 = st2 && (st2.draInjectOn || sim.state.draEnabled);
        if (cons) cons.textContent = ((on2 ? Number(inp.value) : 0) * 24).toFixed(0) + ' L';
        renderLinepack();
        renderEventLog();
        renderDraDpSummary();
        renderDraBoard();
      });
    });
    panel.querySelectorAll('input[data-pa-throttle]').forEach((inp) => {
      inp.addEventListener('input', () => {
        if (sim.setPaThrottle) sim.setPaThrottle(Number(inp.value));
        const span = qs('#pa-th-val', panel);
        if (span) span.textContent = inp.value;
        renderEventLog();
      });
    });
  }

  function renderDraBoard() {
    let box = qs('#dra-board');
    if (!box) {
      const host = qs('#impact-dashboard');
      if (host && host.parentElement) {
        box = document.createElement('div');
        box.id = 'dra-board';
        box.className = 'impact-grid';
        box.style.marginTop = '8px';
        host.parentElement.insertBefore(box, host.nextSibling);
      }
    }
    if (!box) return;
    if (sim.updateDraBoard) sim.updateDraBoard();
    const b = sim.state.draBoard || {};
    box.innerHTML = `
      <div class="impact-card"><span class="k">ΔQ_LC (DRA)</span><span class="v">${(b.deltaQLc != null ? b.deltaQLc : 0).toFixed(0)} m³/h</span></div>
      <div class="impact-card"><span class="k">ΔP_desc ahorro</span><span class="v">${(b.deltaPDesc != null ? b.deltaPDesc : 0).toFixed(1)} kg/cm²</span></div>
      <div class="impact-card"><span class="k">Polímero Σ 24h</span><span class="v">${(b.cons24hTotalL != null ? b.cons24hTotalL : 0).toFixed(0)} L</span></div>
      <div class="impact-card"><span class="k">Ducto animación</span><span class="v">${sim.isDuctMotionRunning && sim.isDuctMotionRunning() ? 'EN MARCHA' : 'CONGELADO'}</span></div>`;
  }

  function renderRuptureBanner() {
    let el = qs('#rupture-banner');
    if (!el) {
      const rib = qs('.scenario-ribbon') || qs('#cd-autonomy');
      if (!rib) return;
      el = document.createElement('div');
      el.id = 'rupture-banner';
      el.className = 'autonomy-banner';
      rib.appendChild(el);
    }
    const r = sim.state.rupture;
    if (!r || !r.active) { el.hidden = true; el.innerHTML = ''; return; }
    el.hidden = false;
    el.innerHTML = `<strong>FUGA/ROTURA PK ${Number(r.pkKm).toFixed(0)}</strong>
      · Q_fuga ~${(r.qLeakM3h || 0).toFixed(0)} m³/h
      · ${r.isolated ? 'AISLADO (VB)' : 'sin aislar'}
      · integridad ${r.integrityOk ? 'OK' : 'NO OK'}
      <button type="button" class="btn" id="btn-isolate-rupture">Aislar VB</button>
      <button type="button" class="btn" id="btn-integrity-ok">Integridad OK</button>`;
    qs('#btn-isolate-rupture', el)?.addEventListener('click', () => {
      if (sim.isolateRuptureSegment) sim.isolateRuptureSegment();
      renderRuptureBanner(); renderEventLog(); renderPlaybook();
    });
    qs('#btn-integrity-ok', el)?.addEventListener('click', () => {
      if (sim.setRuptureIntegrityOk) sim.setRuptureIntegrityOk(true);
      renderRuptureBanner();
    });
  }

  function renderDraDpSummary() {
    let box = qs('#dra-dp-summary');
    if (!box) {
      const host = qs('#dra-compare-table');
      if (!host) return;
      box = document.createElement('div');
      box.id = 'dra-dp-summary';
      box.className = 'dra-table';
      host.parentElement.insertBefore(box, host.nextSibling);
    }
    const map = sim.state.segmentDpDra || {};
    const keys = Object.keys(map);
    if (!keys.length) {
      box.innerHTML = '<p class="muted">ΔP polímero por tramo: active DRA para ver ahorro.</p>';
      return;
    }
    let html = '<table class="cmp-table"><thead><tr><th>Tramo</th><th>L/h</th><th>ΔP sin</th><th>ΔP con</th><th>Ahorro</th></tr></thead><tbody>';
    for (const k of keys) {
      const r = map[k];
      html += `<tr><td>${escapeHtml(k)}</td><td>${r.draLph}</td><td>${r.dPWithoutKgCm2.toFixed(2)}</td><td>${r.dPWithKgCm2.toFixed(2)}</td><td style="color:#4ade80">${r.dPSavedKgCm2.toFixed(2)}</td></tr>`;
    }
    html += '</tbody></table><p class="muted">kg/cm² · dose tip. ≥10 L/h · P_desc soft-clamp ≤85</p>';
    box.innerHTML = html;
  }

  function openPigSopModal() {
    if (sim.state.pig.active) return;
    const modal = qs('#pig-sop-modal');
    if (!modal) { sim.launchPig(); return; }
    pigSopPending = true;
    modal.querySelectorAll('input[type="checkbox"]').forEach((c) => { c.checked = false; });
    const err = qs('#pig-sop-error');
    if (err) err.textContent = '';
    modal.classList.add('open');
    modal.setAttribute('aria-hidden', 'false');
  }
  function closePigSopModal() {
    pigSopPending = false;
    const modal = qs('#pig-sop-modal');
    if (!modal) return;
    modal.classList.remove('open');
    modal.setAttribute('aria-hidden', 'true');
  }
  function confirmPigSop() {
    const checks = qsa('#pig-sop-modal input[type="checkbox"]');
    if (!checks.every((c) => c.checked)) {
      const err = qs('#pig-sop-error');
      if (err) err.textContent = 'Complete todos los pasos del checklist (entrenamiento).';
      return;
    }
    closePigSopModal();
    sim.logEvent('SOP pig completado', 'pig');
    sim.launchPig();
    renderEventLog();
    renderPlaybook();
  }

  function renderDraTable() {
    const box = qs('#dra-compare-table');
    const row = sim.state.impact && sim.state.impact.draCompare;
    if (!box || !row) return;
    box.innerHTML = `<table class="cmp-table"><thead><tr><th></th><th>DRA OFF</th><th>DRA ON</th><th>Δ</th></tr></thead>
      <tbody>
        <tr><td>Q_LC m³/h</td><td>${row.qLcOff.toFixed(0)}</td><td>${row.qLcOn.toFixed(0)}</td><td>${row.deltaQ.toFixed(0)}</td></tr>
        <tr><td>Energía proxy</td><td>${row.energyProxyOff.toFixed(1)}</td><td>${row.energyProxyOn.toFixed(1)}</td><td>${row.deltaEnergy.toFixed(1)}</td></tr>
        <tr><td>m³ / 24h</td><td>${row.m3_24h_off.toFixed(0)}</td><td>${row.m3_24h_on.toFixed(0)}</td><td>${row.deltaM3_24h.toFixed(0)}</td></tr>
      </tbody></table>
      <p class="muted">${escapeHtml(row.note)}</p>`;
  }

  function renderCriticality() {
    const box = qs('#criticality-table');
    const ranking = sim.state.impact && sim.state.impact.ranking;
    if (!box || !ranking || !ranking.length) return;
    box.innerHTML = `<table class="cmp-table"><thead><tr><th>#</th><th>EB</th><th>m³/h perdidos LC</th><th>Q_LC</th><th>% plan</th></tr></thead><tbody>` +
      ranking.map((r, i) => `<tr><td>${i + 1}</td><td>${escapeHtml(r.name)}</td><td>${r.lostM3h.toFixed(0)}</td><td>${r.qLc.toFixed(0)}</td><td>${r.pctPlan.toFixed(0)}%</td></tr>`).join('') +
      `</tbody></table>`;
  }

  function bindControls() {
    const flow = qs('#flow-setpoint');
    if (flow) {
      flow.max = String(sim.maxFlow());
      flow.value = String(sim.state.globalFlowSetpoint);
      flow.addEventListener('change', () => {
        sim.rampFlowTo(Number(flow.value));
        qs('#flow-setpoint-val').textContent = flow.value;
        renderHeader();
        drawSchematic();
        drawAltimetry();
        renderDetailPanel();
        renderTanksSidebar();
        renderLinepack();
      });
    }
    qsa('[data-speed]').forEach((btn) => {
      btn.addEventListener('click', () => {
        sim.setSpeed(Number(btn.dataset.speed));
        qsa('[data-speed]').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        renderEventLog();
      });
    });
    qs('#btn-pause')?.addEventListener('click', () => { sim.togglePause(); renderHeader(); renderEventLog(); });
    qs('#chk-dra')?.addEventListener('change', (ev) => {
      sim.setDra(ev.target.checked);
      renderLinepack();
      renderEventLog();
      renderDetailPanel();
    });
    qs('#btn-launch-pig-global')?.addEventListener('click', () => openPigSopModal());
    qs('#btn-reset-pig')?.addEventListener('click', () => { sim.resetPig(); renderEventLog(); });

    qs('#btn-apagar-todas')?.addEventListener('click', () => {
      sim.apagarTodasEstaciones();
      renderPlaybook(); renderEventLog(); renderImpact(); renderDetailPanel();
    });
    qs('#btn-restablecer-todas')?.addEventListener('click', () => {
      sim.restablecerTodasEstaciones();
      qsa('[data-scenario]').forEach((b) => b.classList.remove('active'));
      renderPlaybook(); renderEventLog(); renderImpact(); renderValves(); renderDetailPanel();
    });

    qsa('[data-scenario]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const sc = btn.dataset.scenario;
        if (sc === 'clear') sim.applyScenario('clear');
        else if (sc === 'fuga_rotura_pk') {
          const raw = window.prompt('PK de fuga/rotura (km, 1–529):', '120');
          const pk = Number(raw);
          if (!Number.isFinite(pk)) return;
          sim.state._pendingRupturePk = pk;
          if (sim.startRuptureAtPk) sim.startRuptureAtPk(pk, 0.75);
          else sim.applyScenario('fuga_rotura_pk');
        } else if (sc === 'perdida_electrica_eb') {
          const raw = window.prompt('EB con pérdida eléctrica (ph/ac/cd/mg/sos/rt/ug):', 'sos');
          sim.state._pendingElectricEb = (raw || 'sos').trim().toLowerCase();
          sim.applyScenario('perdida_electrica_eb');
        } else sim.applyScenario(sc);
        qsa('[data-scenario]').forEach((b) => b.classList.remove('active'));
        if (sc !== 'clear') btn.classList.add('active');
        renderDetailPanel(); renderEventLog(); renderPlaybook(); renderImpact();
      });
    });

    qsa('[data-crisis]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const out = sim.applyCrisisMode(btn.dataset.crisis);
        const el = qs('#crisis-outcome');
        if (el && out) {
          el.textContent = `Resultado ${out.mode}: Q_LC ${out.qLc.toFixed(0)} m³/h · perdidos ${out.lostM3h.toFixed(0)} m³/h · ~${(out.hoursToNormalize || 0).toFixed(1)} h a normalizar`;
        }
        renderPlaybook(); renderEventLog(); renderImpact(); renderValves();
      });
    });

    qs('#usd-per-m3')?.addEventListener('change', (ev) => {
      sim.setUsdPerM3(Number(ev.target.value));
      renderImpact();
    });
    qs('#btn-dra-compare')?.addEventListener('click', () => { sim.runDraComparator(); renderDraTable(); renderEventLog(); });
    qs('#btn-criticality')?.addEventListener('click', () => { sim.computeStationCriticality(); renderCriticality(); renderEventLog(); });

    qs('#btn-clear-alarm-log')?.addEventListener('click', () => { sim.clearAlarmLog(); renderAlarmLog(); });
    qs('#btn-clear-event-log')?.addEventListener('click', () => { sim.clearEventLog(); renderEventLog(); });
    qs('#pig-sop-cancel')?.addEventListener('click', () => closePigSopModal());
    qs('#pig-sop-confirm')?.addEventListener('click', () => confirmPigSop());
    qs('#pig-sop-modal')?.addEventListener('click', (ev) => { if (ev.target && ev.target.id === 'pig-sop-modal') closePigSopModal(); });

    document.addEventListener('keydown', (ev) => {
      if (ev.code !== 'Space' && ev.key !== ' ') return;
      const tag = (ev.target && ev.target.tagName) || '';
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || tag === 'BUTTON') return;
      if (pigSopPending) return;
      ev.preventDefault();
      sim.togglePause();
      renderHeader();
      renderEventLog();
    });

    qs('#schematic-canvas')?.addEventListener('click', (ev) => {
      const canvas = qs('#schematic-canvas');
      const rect = canvas.getBoundingClientRect();
      const x = ev.clientX - rect.left;
      const w = rect.width, pad = 40, L = sim.lengthKm();
      const pk = ((x - pad) / (w - 2 * pad)) * L;
      let best = null, bestD = Infinity;
      for (const st of sim.state.stations) {
        const d = Math.abs(st.pkKm - pk);
        if (d < bestD) { bestD = d; best = st; }
      }
      if (best && bestD < L * 0.06) {
        sim.selectStation(best.id);
        renderDetailPanel();
      }
    });
  }

  function loop(now) {
    sim.tick(now);
    // v4: la consola de ingeniería sólo se dibuja cuando está visible (el motor sigue corriendo)
    if (document.body.dataset.view !== 'ingenieria' || document.body.dataset.ingSub !== 'clasica') {
      animId = requestAnimationFrame(loop);
      return;
    }
    renderHeader();
    renderImpact();
    drawSchematic();
    drawAltimetry();
    renderDraDpSummary();
    renderAlarms();
    renderAlarmLog();
    renderEventLog();
    renderTanksSidebar();
    renderLinepack();
    if (!loop._lastPb || now - loop._lastPb > 1500) {
      renderPlaybook();
      loop._lastPb = now;
    }
    const active = document.activeElement;
    if (!active || (active.tagName !== 'INPUT' && active.tagName !== 'TEXTAREA')) {
      if (!loop._lastDetail || now - loop._lastDetail > 1200) {
        const editing = qs('#station-detail input:focus');
        if (!editing) renderDetailPanel();
        loop._lastDetail = now;
      }
    }
    animId = requestAnimationFrame(loop);
  }

  async function main() {
    try {
      const config = await loadConfig();
      baseConfig = JSON.parse(JSON.stringify(config));
      sim = window.PHLDC.createSim(config);
      sim.loadStationsOverride();
      // v4: operación normal con DRA activo; arranque estable y logs limpios
      sim.setDra(true);
      sim.setSpeed(1);
      for (let k = 1; k <= 12; k++) sim.tick(performance.now() + k * 33);
      sim.state.lastTickMs = performance.now();
      sim.state.knownAlarmIds = {};
      sim.clearAlarmLog();
      sim.clearEventLog();
      sim.state.alarms = [];
      sim.computeHydraulics();
      sim.logEvent('Simulación v4 iniciada · operación normal con DRA', 'ops');
      sim.setSpeed(60);
      document.querySelectorAll('[data-speed]').forEach((b) => b.classList.toggle('active', b.dataset.speed === '60'));
      const chk = qs('#chk-dra');
      if (chk) chk.checked = true;
      window.SIM = sim;
      window.dispatchEvent(new CustomEvent('sim-ready', { detail: { sim, config } }));
      qs('#pipeline-title').textContent = config._meta.name + ' · ' + config._meta.pipelineId;
      qs('#disclaimer-banner').textContent = config._meta.disclaimer;
      const metaLen = qs('#meta-length');
      if (metaLen) {
        metaLen.textContent = `${sim.lengthKm()} km · PH tip. ${config._meta.defaultPhCabeceraM3h || 650} → LC ~${config._meta.defaultLcReceiptTargetM3h || 800} m³/h`;
      }
      const usd = qs('#usd-per-m3');
      if (usd && sim.state.impact) usd.value = String(sim.state.impact.usdPerM3);
      bindControls();
      renderThresholds();
      renderValves();
      renderDetailPanel();
      renderAlarmLog();
      renderEventLog();
      renderPlaybook();
      renderImpact();
      animId = requestAnimationFrame(loop);
      window.addEventListener('resize', () => { drawSchematic(); drawAltimetry(); });
    } catch (err) {
      console.error(err);
      const root = qs('#app');
      if (root) {
        root.innerHTML = '<div class="fatal">Error: ' + escapeHtml(err.message) + '</div>';
      }
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', main);
  else main();
})();
