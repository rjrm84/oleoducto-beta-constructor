/**
 * PH-LDC Operations Simulator v3 — demo gerencia
 * Darcy-Weisbach + elevación (polyline) · f por tramo · umbrales operativos editables
 * NO es SCADA / No Confidencial — entrenamiento
 */
(function (global) {
  'use strict';

  const G = 9.81;
  const LS_KEY = 'oleoducto-beta-stations-v10';
  const MAX_LOG = 200;
  const KGCM2_PA = 1e5;

  function deepClone(o) {
    return JSON.parse(JSON.stringify(o));
  }

  function createSim(config) {
    const meta = config._meta || {};
    // v8: ductos a medida (constructor). La cabecera se llama 'ph', la terminal 'lc' y la cabecera alternativa 'cd'.
    const isCustom = !!meta.custom;
    const lsKey = isCustom ? LS_KEY + '-' + (meta.pipelineId || 'custom') + '-' + (meta.specVersion || 0) : LS_KEY;
    const peakPk = () => (meta.peakPkKm != null ? Number(meta.peakPkKm) : 198);
    const thr0 = deepClone(config.thresholds || {});
    const state = {
      config: deepClone(config),
      thresholds: thr0,
      timeSec: 0,
      simDate: new Date('2026-09-06T06:00:00-03:00'),
      speed: 720, // Demo 24h default
      running: true,
      globalFlowSetpoint: meta.defaultPhCabeceraM3h || 650,
      lcReceiptTarget: (thr0.lcReceiptTargetM3h != null ? thr0.lcReceiptTargetM3h : (meta.defaultLcReceiptTargetM3h || 800)),
      selectedStationId: null,
      draEnabled: false,
      useExcelDuty: false,
      waterSlugPct: 0.2,
      operatorResponseDelayMin: thr0.operatorResponseDelayMin != null ? thr0.operatorResponseDelayMin : 5,
      pig: {
        active: false,
        stuck: false,
        pkKm: 0,
        speedKmPerHour: 0,
        launchedAt: null,
        status: 'idle',
        dPForeAft: 0,
        etaNextHours: null,
        nextStationId: null,
        lowSpeedSec: 0,
      },
      alarms: [],
      alarmLog: [],
      eventLog: [],
      knownAlarmIds: {},
      scenarioActive: null,
      failedStations: {},
      allStationsOff: false,
      impact: {
        baselineLcM3h: 800,
        lostM3h: 0,
        cumulativeLostM3: 0,
        hoursToNormalize: null,
        pctDailyPlan: 100,
        traffic: 'green',
        usdPerM3: 45,
        opportunityUsd: 0,
        uptimePct: 100,
        cilcQuotaPct: 100,
        crisisMode: null,
        ranking: [],
        draCompare: null,
      },
      baselineFlowAtFail: null,
      failureStartedAt: null,
      phFailed: false,
      cdTempHead: false,
      cdAutonomyRemainH: 0,
      cdAutonomyTotalH: thr0.cdAutonomyHours != null ? thr0.cdAutonomyHours : 2,
      overpressureBoost: 0,
      segmentFlows: {},
      pressures: {},
      pressuresIn: {},
      pressuresOut: {},
      segmentLoss: {},
      hgl: {},
      injectionActive: {},
      tripFlags: {},
      playbookActive: [],
      playbookChecks: {},
      linepack: {},
      oilFrontPkKm: 0,
      oilReachablePkKm: meta.lengthKm || 530,
      cascadeBlock: null,
      segmentDpDra: {},
      segmentPMin: {},
      segmentPMax: {},
      linePMin: null,
      linePMax: null,
      coldStart: false,
      ductMotionFrozen: false,
      animPhaseFrozen: 0,
      rupture: { active: false, pkKm: null, severity: 0, isolated: false, integrityOk: false, qLeakM3h: 0 },
      surgeBoostKg: 0,
      surgeRemainSec: 0,
      aspAlarmStations: {},
      draBoard: { deltaQLc: 0, deltaPDesc: 0, cons24hL: 0, cons24hTotalL: 0, rows: [] },
      valves: deepClone(config.valves || []),
      lastTickMs:
        typeof performance !== 'undefined' && performance.now
          ? performance.now()
          : Date.now(),
    };

    state.stations = deepClone(config.stations);
    // DRA/polímero per station: toggle + 0–10 L/h (default 6 when on)
    const draDefLph = (thr0.draDefaultLph != null ? thr0.draDefaultLph : 6);
    const draMaxLph = (thr0.draMaxLph != null ? thr0.draMaxLph : 10);
    for (const st of state.stations) {
      if (st.draInjectionLph == null || Number.isNaN(Number(st.draInjectionLph))) {
        st.draInjectionLph = draDefLph;
      }
      st.draInjectionLph = Math.max(0, Math.min(draMaxLph, Number(st.draInjectionLph) || 0));
      if (st.draCapable == null) st.draCapable = true;
      if (st.draInjectOn == null) st.draInjectOn = false;
      if (st.minMainsOnline == null) {
        if (st.id === 'cd') st.minMainsOnline = 3;
        else if (st.pumps && st.pumps.length) st.minMainsOnline = 2;
      }
    }
    if (state.thresholds.pDescMaxKgCm2 == null) state.thresholds.pDescMaxKgCm2 = 85;
    if (state.thresholds.draDefaultLph == null) state.thresholds.draDefaultLph = draDefLph;
    if (state.thresholds.draMaxLph == null) state.thresholds.draMaxLph = draMaxLph;
    if (state.thresholds.pAspAlarmKgCm2 == null) state.thresholds.pAspAlarmKgCm2 = 5;
    if (state.thresholds.pAspStrongKgCm2 == null) state.thresholds.pAspStrongKgCm2 = 4;
    if (state.thresholds.pAspTripKgCm2 == null) state.thresholds.pAspTripKgCm2 = 3;
    if (state.thresholds.pAspAlarmDerateFrac == null) state.thresholds.pAspAlarmDerateFrac = 0.15;

    function maxFlow() {
      return state.config._meta.maxFlowM3h || 730;
    }
    function lengthKm() {
      return state.config._meta.lengthKm || 530;
    }
    function hyd() {
      return state.config.hydraulics || {};
    }
    function density() {
      return hyd().fluidDensity_kg_m3 || 860;
    }
    function diameterM() {
      return hyd().diameterM || 16 * 0.0254;
    }
    function areaM2() {
      const D = diameterM();
      return Math.PI * D * D * 0.25;
    }
    function frictionFDefault() {
      return hyd().frictionFactor_f || 0.038;
    }
    function phMaxDisc() {
      return hyd().phMaxDischargeKgCm2 || 85;
    }
    function pDescMax() {
      const t = thr();
      if (t.pDescMaxKgCm2 != null) return Number(t.pDescMaxKgCm2);
      return phMaxDisc();
    }
    function thr() {
      return state.thresholds;
    }
    function stationDraLph(st) {
      if (!st) return 0;
      const maxL = thr().draMaxLph != null ? Number(thr().draMaxLph) : 10;
      const v = Number(st.draInjectionLph);
      if (Number.isNaN(v) || v < 0) return 0;
      return Math.min(maxL, v);
    }
    /** Station contributes DRA when (global OR per-station inject) and L/h > 0 */
    function stationDraActive(st) {
      if (!st || !st.draCapable) return false;
      const on = !!state.draEnabled || !!st.draInjectOn;
      return on && stationDraLph(st) > 0;
    }
    /**
     * DRA friction curve: reduce f by up to draFrictionReduction at ≥ draRefLph (typ. 10).
     * Dose band ops 6–10 L/h. Upstream station injection feeds the next segment.
     */
    function draFrictionMul(fromId) {
      let st = stationById(fromId);
      // v8: en ductos a medida el DRA sigue aguas abajo hasta la próxima estación de bombeo (las bombas lo degradan)
      if (isCustom && st && !(st.pumps && st.pumps.length)) {
        const up = sortedStations().filter((x) => x.pumps && x.pumps.length && (x.pkKm || 0) < (st.pkKm || 0)).sort((a, b) => (b.pkKm || 0) - (a.pkKm || 0))[0];
        if (up) st = up;
      }
      if (!stationDraActive(st)) return 1;
      const lph = stationDraLph(st);
      const h = hyd();
      const maxRed = h.draFrictionReduction != null ? Number(h.draFrictionReduction) : 0.45;
      const ref = h.draRefLph != null ? Number(h.draRefLph) : 10;
      const frac = Math.min(1, lph / Math.max(0.1, ref));
      return Math.max(0.2, 1 - maxRed * frac);
    }

    function isBoosterRole(role) {
      return role === 'booster' || role === 'booster_suction';
    }

    function minMainsRequired(st) {
      if (!st) return 2;
      if (st.minMainsOnline != null) return Number(st.minMainsOnline);
      if (st.id === 'cd') return st.minTurbosForPeak != null ? Number(st.minTurbosForPeak) : 3;
      return 2;
    }

    function mainsOnlineRequired(st) {
      return mainsOnline(st);
    }

    function stationMeetsPumpRule(st) {
      if (!st || !st.pumps || !st.pumps.length) return true;
      if (state.failedStations[st.id]) return false;
      const m = mainsOnline(st);
      return m.on >= Math.min(minMainsRequired(st), m.n || minMainsRequired(st));
    }

    function isDuctMotionRunning() {
      if (state.allStationsOff) return false;
      if (state.impact && state.impact.crisisMode === 'parar_seguro') return false;
      const q = state.lineFlow || 0;
      const casc = state.cascadeBlock;
      if (casc && casc.qFactor != null && casc.qFactor <= 0) return false;
      if (q <= 5) return false;
      if (state.rupture && state.rupture.active && state.rupture.isolated && q <= 5) return false;
      return true;
    }

    function updateDuctMotionFlag() {
      const running = isDuctMotionRunning();
      state.ductMotionFrozen = !running;
      return running;
    }

    function draConsumption24h() {
      let total = 0;
      const rows = [];
      for (const st of state.stations) {
        if (!stationDraActive(st)) {
          rows.push({ id: st.id, lph: 0, L24h: 0 });
          continue;
        }
        const lph = stationDraLph(st);
        const L24h = lph * 24;
        total += L24h;
        rows.push({ id: st.id, short: st.shortName || st.id, lph, L24h });
      }
      state.draBoard.cons24hTotalL = total;
      state.draBoard.rows = rows;
      return { total, rows };
    }

    function updateDraBoard() {
      draConsumption24h();
      const cmp = state.impact && state.impact.draCompare;
      if (cmp) {
        const qOn = cmp.qLcOn != null ? cmp.qLcOn : (cmp.qOn != null ? cmp.qOn : 0);
        const qOff = cmp.qLcOff != null ? cmp.qLcOff : (cmp.qOff != null ? cmp.qOff : 0);
        const pOn = cmp.pDescOn != null ? cmp.pDescOn : 0;
        const pOff = cmp.pDescOff != null ? cmp.pDescOff : 0;
        state.draBoard.deltaQLc = qOn - qOff;
        state.draBoard.deltaPDesc = pOff - pOn;
      }
    }

    function suctionAssistKg(st) {
      if (!st || !st.pumps) return 0;
      let a = 0;
      for (const p of st.pumps) {
        if (!p.online || !isBoosterRole(p.role)) continue;
        const v = p.suctionAssistKgCm2 != null ? Number(p.suctionAssistKgCm2) : 5;
        a += Math.max(0, v) * (p.powerFraction != null ? p.powerFraction : 1);
      }
      return a;
    }

    /** Hard cascade reachability (ops): PH → AC(2) → CD(3 turbos) → peak → LC; PA regulates Q. */
    function cascadeReachabilityGeneric() {
      const L = lengthKm();
      const sorted = sortedStations().slice().sort((a, b) => (a.pkKm || 0) - (b.pkKm || 0));
      const result = { maxPkKm: L, reason: 'ok', qFactor: 1, phOk: false, acOk: true, cdOk: true, turbosOn: 0, paThrottle: 1 };
      const ph = stationById('ph');
      const phM = ph ? mainsOnline(ph) : { n: 0, on: 0 };
      const phNeed = ph ? minMainsRequired(ph) : 1;
      const phPumping = !!ph && !state.phFailed && !state.failedStations.ph && !state.allStationsOff && phM.on >= Math.min(phNeed, phM.n || phNeed);
      const cdTemp = state.phFailed && state.cdTempHead && !state.allStationsOff && !!stationById('cd');
      result.phOk = phPumping || cdTemp;
      if (!phPumping && !cdTemp) {
        const nxt = sorted.find((x) => x.id !== 'ph' && (x.pkKm || 0) > (ph ? ph.pkKm || 0 : 0));
        result.maxPkKm = Math.max(1, (nxt ? nxt.pkKm || 0 : L) * 0.35);
        result.reason = 'sin_PH';
        result.qFactor = 0;
        return result;
      }
      if (cdTemp && !phPumping) { result.reason = 'cd_cabecera_temp'; result.qFactor = 0.55; }
      for (const eb of sorted) {
        if (eb.id === 'ph' || !eb.pumps || !eb.pumps.length) continue;
        if (cdTemp && eb.id !== 'cd' && (eb.pkKm || 0) < (stationById('cd').pkKm || 0)) continue;
        const em = mainsOnline(eb);
        const need = minMainsRequired(eb);
        if (state.failedStations[eb.id] || em.on < Math.min(need, em.n || need)) {
          result.maxPkKm = Math.min(result.maxPkKm, (eb.pkKm || 0) + Math.max(3, L * 0.03));
          result.reason = 'EB_' + (eb.shortName || eb.id) + '_sin_bombas';
          result.qFactor = Math.min(result.qFactor, 0.25);
          return result;
        }
      }
      if (state.rupture && state.rupture.active && state.rupture.pkKm != null) {
        const rpk = Number(state.rupture.pkKm);
        if (state.rupture.isolated) {
          result.maxPkKm = Math.min(result.maxPkKm, rpk);
          result.reason = 'fuga_aislada_PK' + rpk.toFixed(0);
          result.qFactor = Math.min(result.qFactor, 0.05);
          return result;
        }
        result.maxPkKm = Math.min(result.maxPkKm, rpk + 5);
        result.reason = 'fuga_PK' + rpk.toFixed(0);
        result.qFactor = Math.min(result.qFactor, 0.35);
      }
      result.maxPkKm = L;
      return result;
    }

    function cascadeReachability() {
      if (isCustom) return cascadeReachabilityGeneric();
      const L = lengthKm();
      const ph = stationById('ph');
      const ac = stationById('ac');
      const cd = stationById('cd');
      const pa = stationById('pa');
      const peakPkV = peakPk();
      const result = {
        maxPkKm: L,
        reason: 'ok',
        qFactor: 1,
        phOk: false,
        acOk: false,
        cdOk: false,
        turbosOn: 0,
        paThrottle: 1,
      };

      const phMains = ph ? mainsOnline(ph) : { n: 0, on: 0 };
      const phNeed = ph ? minMainsRequired(ph) : 2;
      const phPumping =
        !!ph &&
        !state.phFailed &&
        !state.failedStations.ph &&
        !state.allStationsOff &&
        phMains.on >= Math.min(phNeed, phMains.n || phNeed);
      // CD temp head exception: limited reach from CD onward
      const cdTemp = state.phFailed && state.cdTempHead && !state.allStationsOff;
      result.phOk = phPumping || cdTemp;

      if (!phPumping && !cdTemp) {
        // Without PH pumping → crude does NOT reach Carrizo (dies in PH–AC)
        const acPk = ac ? ac.pkKm || 65 : 65;
        result.maxPkKm = Math.max(5, (ph ? ph.pkKm || 0 : 0) + (acPk - (ph ? ph.pkKm || 0 : 0)) * 0.35);
        result.reason = 'sin_PH';
        result.qFactor = 0;
        return result;
      }

      if (cdTemp && !phPumping) {
        // Column only from CD — upstream of CD depressurized
        result.maxPkKm = L; // further limited by CD turbos
        result.reason = 'cd_cabecera_temp';
        result.qFactor = 0.55;
      }

      const acMains = ac ? mainsOnline(ac) : { n: 0, on: 0 };
      const acOk =
        cdTemp ||
        (!!ac &&
          !state.failedStations.ac &&
          acMains.on >= Math.min(2, acMains.n || 2));
      result.acOk = acOk;
      if (!acOk && !cdTemp) {
        // Without Carrizo (2 pumps) → does NOT reach Divisadero / peak
        const cdPk = cd ? cd.pkKm || 160 : 160;
        const acPk = ac ? ac.pkKm || 65 : 65;
        result.maxPkKm = acPk + (cdPk - acPk) * 0.25;
        result.reason = 'sin_Carrizo_2bombas';
        result.qFactor = Math.min(result.qFactor, 0.15);
        return result;
      }

      const cdMains = cd ? mainsOnline(cd) : { n: 0, on: 0 };
      result.turbosOn = cdMains.on;
      const needTurbos = (cd && cd.minTurbosForPeak != null) ? cd.minTurbosForPeak : 3;
      const cdOk =
        !!cd &&
        !state.failedStations.cd &&
        cdMains.on >= Math.min(needTurbos, cdMains.n || needTurbos);
      result.cdOk = cdOk;
      if (!cdOk) {
        // CD needs 3 turbos in line to push over high point toward LC
        result.maxPkKm = Math.min(peakPkV + 5, (cd ? cd.pkKm || 160 : 160) + 45);
        result.reason = 'CD_sin_3_turbos';
        result.qFactor = Math.min(result.qFactor, 0.2);
        return result;
      }

      // Downstream EBs: 2 mains in line required to sustain toward LC
      const chain = ['mg', 'sos', 'rt', 'ug'];
      for (const eid of chain) {
        const eb = stationById(eid);
        if (!eb || !eb.pumps || !eb.pumps.length) continue;
        const em = mainsOnline(eb);
        const need = minMainsRequired(eb);
        if (state.failedStations[eid] || em.on < Math.min(need, em.n || need)) {
          result.maxPkKm = Math.min(result.maxPkKm, (eb.pkKm || 0) + 15);
          result.reason = 'EB_' + (eb.shortName || eid) + '_sin_2_en_linea';
          result.qFactor = Math.min(result.qFactor, 0.25);
          return result;
        }
      }

      if (state.rupture && state.rupture.active && state.rupture.pkKm != null) {
        const rpk = Number(state.rupture.pkKm);
        if (state.rupture.isolated) {
          result.maxPkKm = Math.min(result.maxPkKm, rpk);
          result.reason = 'fuga_aislada_PK' + rpk.toFixed(0);
          result.qFactor = Math.min(result.qFactor, 0.05);
          return result;
        }
        result.maxPkKm = Math.min(result.maxPkKm, rpk + 5);
        result.reason = 'fuga_PK' + rpk.toFixed(0);
        result.qFactor = Math.min(result.qFactor, 0.35);
      }

      // Pareditas regulating throttle
      let throttle = 1;
      if (pa) {
        const pct = pa.flowThrottlePct != null ? Number(pa.flowThrottlePct) : 100;
        throttle = Math.max(0, Math.min(1, pct / 100));
        if (state.failedStations.pa) throttle = Math.min(throttle, 0.4);
      }
      result.paThrottle = throttle;
      result.qFactor = Math.min(result.qFactor, 0.55 + 0.45 * throttle);
      result.maxPkKm = L;
      result.reason = throttle < 0.99 ? 'PA_throttle' : 'ok';
      return result;
    }

    function updateOilFront(dtHours) {
      const reach = cascadeReachability();
      state.cascadeBlock = reach;
      state.oilReachablePkKm = reach.maxPkKm;
      const q = state.lineFlow || 0;
      const v = velocityKmH(q); // km/h of fluid
      // Front advances with fluid; retracts toward reachable if blocked
      let pk = state.oilFrontPkKm != null ? state.oilFrontPkKm : 0;
      if (q > 5 && reach.qFactor > 0) {
        pk = Math.min(reach.maxPkKm, pk + v * dtHours);
      } else {
        // drain / stall: front slowly falls back if unreachable
        if (pk > reach.maxPkKm) {
          pk = Math.max(reach.maxPkKm, pk - Math.max(2, v) * dtHours * 2);
        }
      }
      // If PH offline and not CD temp, collapse front into PH–AC
      if (reach.reason === 'sin_PH') {
        pk = Math.min(pk, reach.maxPkKm);
      }
      state.oilFrontPkKm = Math.max(0, Math.min(lengthKm(), pk));
    }

    function computeDraSegmentDeltas(flow) {
      const sorted = hydraulicStations();
      state.segmentDpDra = {};
      const q = Math.max(flow || state.lineFlow || 1, 1);
      for (let i = 1; i < sorted.length; i++) {
        const prev = sorted[i - 1];
        const st = sorted[i];
        const dL = Math.max(0.01, (st.pkKm || 0) - (prev.pkKm || 0));
        const map = hyd().segmentFriction || {};
        const k = segmentKey(prev.id, st.id);
        let fBase = map[k] != null ? Number(map[k]) : frictionFDefault();
        const mul = draFrictionMul(prev.id);
        // frictionFFor already includes mul — reconstruct without DRA
        const dPWith = frictionLossKg(q, dL, fBase * mul);
        const dPWithout = frictionLossKg(q, dL, fBase);
        const saved = Math.max(0, dPWithout - dPWith);
        const lph = stationDraActive(prev) ? stationDraLph(prev) : 0;
        state.segmentDpDra[prev.id + '→' + st.id] = {
          from: prev.id,
          to: st.id,
          dL_km: dL,
          fBase,
          draMul: mul,
          draLph: lph,
          dPWithoutKgCm2: dPWithout,
          dPWithKgCm2: dPWith,
          dPSavedKgCm2: saved,
          active: lph > 0 && stationDraActive(prev),
        };
      }
    }


    function pumpingStations() {
      return state.stations.filter((s) => s.pumps && s.pumps.length > 0);
    }
    function stationById(id) {
      return state.stations.find((s) => s.id === id || (s.aliases && s.aliases.indexOf(id) >= 0));
    }
    function pumpsOnlineCount(st) {
      if (!st.pumps) return 0;
      return st.pumps.filter((p) => p.online).length;
    }
    function mainsOnline(st) {
      if (!st.pumps) return { n: 0, on: 0 };
      const mains = st.pumps.filter((p) => !isBoosterRole(p.role));
      return { n: mains.length || st.pumps.length, on: mains.filter((p) => p.online).length };
    }
    function sortedStations() {
      return state.stations.slice().sort((a, b) => {
        const ao = a.layoutOrder != null ? a.layoutOrder : 999;
        const bo = b.layoutOrder != null ? b.layoutOrder : 999;
        if (ao !== bo) return ao - bo;
        return (a.pkKm || 0) - (b.pkKm || 0);
      });
    }
    function hydraulicStations() {
      // Exclude pure profile-only; include valve nodes as waypoints (no boost)
      return sortedStations();
    }

    function pushLog(list, entry) {
      list.unshift(entry);
      if (list.length > MAX_LOG) list.length = MAX_LOG;
    }
    function logEvent(message, kind) {
      pushLog(state.eventLog, {
        t: state.timeSec,
        wallMs: Date.now(),
        kind: kind || 'info',
        message: String(message),
      });
    }
    function logAlarm(message, severity) {
      pushLog(state.alarmLog, {
        t: state.timeSec,
        wallMs: Date.now(),
        severity: severity || 'warn',
        message: String(message),
      });
    }
    function clearAlarmLog() {
      state.alarmLog = [];
    }
    function clearEventLog() {
      state.eventLog = [];
    }

    function altimetry() {
      return state.config.altimetryPolyline || [];
    }

    /** Elev at PK via polyline interpolation */
    function elevAtPk(pk) {
      const poly = altimetry();
      if (!poly.length) {
        const st = hydraulicStations();
        if (!st.length) return 0;
        if (pk <= st[0].pkKm) return st[0].elevationMsnm || 0;
        for (let i = 0; i < st.length - 1; i++) {
          if (pk >= st[i].pkKm && pk <= st[i + 1].pkKm) {
            const t = (pk - st[i].pkKm) / (st[i + 1].pkKm - st[i].pkKm || 1);
            return (st[i].elevationMsnm || 0) + t * ((st[i + 1].elevationMsnm || 0) - (st[i].elevationMsnm || 0));
          }
        }
        return st[st.length - 1].elevationMsnm || 0;
      }
      if (pk <= poly[0].pkKm) return poly[0].elevMsnm;
      for (let i = 0; i < poly.length - 1; i++) {
        if (pk >= poly[i].pkKm && pk <= poly[i + 1].pkKm) {
          const t = (pk - poly[i].pkKm) / (poly[i + 1].pkKm - poly[i].pkKm || 1);
          return poly[i].elevMsnm + t * (poly[i + 1].elevMsnm - poly[i].elevMsnm);
        }
      }
      return poly[poly.length - 1].elevMsnm;
    }

    /** Path elevation ΔP along polyline (sums ρgΔz of each sub-segment) */
    function elevLossAlong(pkA, pkB) {
      const poly = altimetry();
      const lo = Math.min(pkA, pkB);
      const hi = Math.max(pkA, pkB);
      let pts = [];
      pts.push({ pk: lo, e: elevAtPk(lo) });
      for (const p of poly) {
        if (p.pkKm > lo && p.pkKm < hi) pts.push({ pk: p.pkKm, e: p.elevMsnm });
      }
      pts.push({ pk: hi, e: elevAtPk(hi) });
      pts.sort((a, b) => a.pk - b.pk);
      let sum = 0;
      for (let i = 1; i < pts.length; i++) {
        sum += elevLossKg(pts[i].e - pts[i - 1].e);
      }
      // If pkB < pkA (shouldn't), flip sign conceptually — we always go downstream
      return sum;
    }

    function segmentKey(fromId, toId) {
      return fromId + '-' + toId;
    }

    function frictionFFor(fromId, toId) {
      const map = hyd().segmentFriction || {};
      const k = segmentKey(fromId, toId);
      let f;
      if (map[k] != null) f = Number(map[k]);
      else if ((fromId === 'ph' || fromId === 'ac') && (toId === 'ac' || toId === 'cd')) {
        if (map['ph-ac'] && fromId === 'ph') f = Number(map['ph-ac']);
        else if (map['ac-cd'] && fromId === 'ac') f = Number(map['ac-cd']);
        else f = frictionFDefault();
      } else {
        f = frictionFDefault();
      }
      return f * draFrictionMul(fromId);
    }

    function capacitySegmentFor(fromPk, toPk) {
      const segs = state.config.segments || [];
      const mid = (fromPk + toPk) / 2;
      for (const s of segs) {
        const a = stationById(s.from);
        const b = stationById(s.to);
        if (!a || !b) continue;
        if (mid >= a.pkKm && mid <= b.pkKm) return s;
      }
      return null;
    }

    function segmentQMax(capSeg) {
      if (!capSeg) return maxFlow();
      return state.draEnabled
        ? Number(capSeg.qMaxDraM3h) || Number(capSeg.qMaxM3h) || maxFlow()
        : Number(capSeg.qMaxM3h) || maxFlow();
    }

    function maopForStations(fromId, toId) {
      const segs = state.config.segments || [];
      for (const s of segs) {
        if (s.from === fromId || (s.via && s.via.indexOf(fromId) >= 0) || s.to === toId) {
          // find owning capacity segment
        }
      }
      // map station pair into capacity segment
      const order = ['ph', 'ac', 'cd', 'mg', 'sos', 'pa', 'rt', 'ug', 'lc'];
      const fi = order.indexOf(fromId);
      const ti = order.indexOf(toId);
      let seg = null;
      if (fi >= 0 && ti >= 0) {
        if (fi < order.indexOf('cd') || ti <= order.indexOf('cd')) seg = segs.find((x) => x.id === 'ph-cd');
        if (fi >= order.indexOf('cd') && ti <= order.indexOf('sos')) seg = segs.find((x) => x.id === 'cd-sos');
        if (fi >= order.indexOf('sos') && ti <= order.indexOf('ug')) seg = segs.find((x) => x.id === 'sos-ug');
        if (fi >= order.indexOf('ug')) seg = segs.find((x) => x.id === 'ug-lc');
      }
      if (!seg) {
        const a = stationById(fromId);
        const b = stationById(toId);
        seg = capacitySegmentFor(a ? a.pkKm : 0, b ? b.pkKm : 0);
      }
      return seg ? Number(seg.maopKgCm2) || 90 : 90;
    }

    // ---- v11: línea bloqueada (válvula cerrada) → sin caudal, la presión sube hasta el cierre de bombas;
    // protecciones: PSHH dispara la estación (por defecto en la MAOP) y la PSV alivia (por defecto 95 kg/cm²).
    function psvFor(st, prevId) {
      if (st && st.psvSetKgCm2 != null) return Number(st.psvSetKgCm2);
      if (thr().psvSetKgCm2 != null) return Number(thr().psvSetKgCm2);
      const m = prevId ? maopForStations(prevId, st.id) : 90;
      return Math.round(m * 1.055);
    }
    function pshhFor(st, prevId, nextId) {
      if (st && st.pshhKgCm2 != null) return Number(st.pshhKgCm2);
      if (thr().pshhKgCm2 != null) return Number(thr().pshhKgCm2);
      return nextId ? maopForStations(st.id, nextId) : (prevId ? maopForStations(prevId, st.id) : 90);
    }
    function applyBlockage(sorted) {
      const now = state.timeSec || 0;
      const dtMin = Math.max(0, Math.min(5, (now - (state._blkT != null ? state._blkT : now)) / 60));
      state._blkT = now;
      state.relief = state.relief || {};
      state.tripCause = state.tripCause || {};
      const P = state._blkP || (state._blkP = {});
      let bIdx = -1, bMode = null, bWhy = '';
      for (let i = 0; i < sorted.length; i++) {
        const st = sorted[i];
        if (i > 0) { const v = closedValveBlocking(sorted[i - 1].pkKm || 0, st.pkKm || 0); if (v) { bIdx = i; bMode = 'line'; bWhy = v.name || v.id; break; } }
        if (st._blockAt) { bIdx = i; bMode = st._blockAt; bWhy = st._blockWhy || ''; break; }
      }
      const relieve = (st, idx, p, cap) => {
        const r = state.relief[st.id] || (state.relief[st.id] = { open: false, volM3: 0, qM3h: 0, sp: cap });
        r.sp = cap;
        if (p > cap) {
          if (!r.open) logEvent(`PSV ${st.shortName || st.id} abierta a ${cap} kg/cm²: alivio al tanque de alivio`, 'alarm');
          r.open = true; r.qM3h = Math.max(60, (state.globalFlowSetpoint || 600) * 0.3); r.volM3 += r.qM3h * dtMin / 60;
          return cap;
        }
        if (r.open && p < cap - 3) { r.open = false; r.qM3h = 0; logEvent(`PSV ${st.shortName || st.id} reasentada`, 'ops'); }
        return p;
      };
      if (bIdx < 0) {
        state.blockage = null;
        for (const k in P) delete P[k];
        // alivio por transitorio (golpe de ariete) sin bloqueo
        for (let i = 0; i < sorted.length; i++) {
          const st = sorted[i];
          if (!st.pumps || !st.pumps.length) continue;
          const po = state.pressuresOut[st.id];
          if (po == null) continue;
          const cap = psvFor(st, i > 0 ? sorted[i - 1].id : null);
          const p2 = relieve(st, i, po, cap);
          if (p2 !== po) { state.pressuresOut[st.id] = p2; if (i === 0) state.pressures[st.id] = p2; }
        }
        return;
      }
      state.blockage = { idx: bIdx, mode: bMode, stationId: sorted[bIdx].id, why: bWhy, since: (state.blockage && state.blockage.stationId === sorted[bIdx].id && state.blockage.mode === bMode) ? state.blockage.since : now };
      const tIn = {}, tOut = {};
      let pl = 0;
      for (const st of sorted) if (!P[st.id]) P[st.id] = { in: state.pressuresIn[st.id] || 0, out: state.pressuresOut[st.id] || 0 };
      for (let i = 0; i < sorted.length; i++) {
        const st = sorted[i];
        const upstream = i < bIdx || (i === bIdx && bMode !== 'line');
        let pin;
        if (i === 0) pin = 1.5;
        else pin = pl - elevLossAlong(sorted[i - 1].pkKm || 0, st.pkKm || 0);
        if (upstream) {
          let boost = 0;
          const running = st.pumps && st.pumps.length && !state.failedStations[st.id] && !(i === 0 && state.phFailed);
          if (running && !(i === bIdx && bMode === 'before')) boost = pumpBoostKg(st) * 1.15; // presión de cierre (caudal cero)
          // tramo empaquetado: con las bombas paradas, la retención aguas arriba mantiene la presión atrapada
          if (!boost && P[st.id].out > pin) pin = Math.max(pin, P[st.id].out - 0.1 * dtMin);
          tIn[st.id] = Math.max(0, Math.min(pin, i > 0 ? pl - elevLossAlong(sorted[i - 1].pkKm || 0, st.pkKm || 0) + 0.001 : pin));
          tOut[st.id] = i === bIdx && bMode === 'before' ? Math.max(0, pin) : Math.max(0, pin + boost);
          if (i > 0 && !boost && P[st.id].in > tIn[st.id]) tIn[st.id] = Math.max(tIn[st.id], P[st.id].in - 0.1 * dtMin);
          pl = tOut[st.id];
        } else {
          // aguas abajo del bloqueo: se despresuriza hasta la columna estática
          const elev0 = sorted[0].elevationMsnm || 0;
          const dz = (st.elevationMsnm || 0) - elev0;
          const pH = Math.max(0.3, 4 - elevLossKg(Math.max(0, dz)) * 0.12);
          tIn[st.id] = pH; tOut[st.id] = pH;
        }
      }
      for (let i = 0; i < sorted.length; i++) {
        const st = sorted[i];
        const c = P[st.id] || (P[st.id] = { in: state.pressuresIn[st.id] || 0, out: state.pressuresOut[st.id] || 0 });
        const step = (cur, tgt) => (tgt > cur ? Math.min(tgt, cur + 4 * dtMin) : Math.max(tgt, cur - 3 * dtMin));
        c.in = step(c.in, tIn[st.id]);
        c.out = step(c.out, tOut[st.id]);
        const upstream = i < bIdx || (i === bIdx && bMode !== 'line');
        if (upstream && st.pumps && st.pumps.length) {
          const prevId = i > 0 ? sorted[i - 1].id : null, nextId = i < sorted.length - 1 ? sorted[i + 1].id : null;
          const pshh = pshhFor(st, prevId, nextId);
          const pAm = st.pAspMinKgCm2 != null ? Number(st.pAspMinKgCm2) : 2;
          if (i > 0 && c.in < pAm - 0.5 && !state.failedStations[st.id] && (st.pumps || []).some((p) => p.online && !isBoosterRole(p.role))) {
            state.tripCause[st.id] = `Disparo por baja presión de aspiración (${c.in.toFixed(1)} kg/cm²)`;
            logEvent(`TRIP P_asp ${st.shortName || st.id}: ${c.in.toFixed(1)} kg/cm² con la línea bloqueada`, 'alarm');
            failStation(st.id);
          }
          if (!st._pshhInhibit && c.out >= pshh && !state.failedStations[st.id] && (st.pumps || []).some((p) => p.online)) {
            state.tripCause[st.id] = `Disparo por alta presión de descarga (PSHH ${pshh} kg/cm²)`;
            logEvent(`TRIP PSHH ${st.shortName || st.id}: ${c.out.toFixed(1)} ≥ ${pshh} kg/cm² con la línea bloqueada (${bWhy})`, 'alarm');
            failStation(st.id);
          }
          c.out = relieve(st, i, c.out, psvFor(st, prevId));
        }
        state.pressuresIn[st.id] = c.in;
        state.pressuresOut[st.id] = c.out;
        state.pressures[st.id] = i === 0 ? c.out : c.in;
        state.hgl[st.id] = (st.elevationMsnm || 0) + (c.out * KGCM2_PA) / (density() * G);
        state.segmentFlows[st.id] = 0;
      }
    }

    function closedValveBlocking(pkA, pkB) {
      for (const v of state.valves) {
        if (v.open) continue;
        const pk = Number(v.pkKm) || 0;
        if (pk > pkA && pk < pkB) return v;
      }
      return null;
    }

    function injectionInstantRate(inj) {
      if (!inj || inj.enabled === false) return 0;
      if (inj.manualOverride) {
        return Math.max(0, Number(inj.manualRateM3h) || 0);
      }
      if (inj.mode === 'continuous') {
        const prefer =
          inj.datosBombeoRateM3h != null ? Number(inj.datosBombeoRateM3h) : Number(inj.rateM3h) || 0;
        return Math.max(0, prefer);
      }
      const sch = inj.schedule;
      if (!sch || sch.enabled === false) {
        return Math.max(0, Number(inj.rateM3h) || 0);
      }
      if (sch.model === 'duty_cycle' || sch.dutyCycle != null) {
        const periodH = Number(sch.periodHours) || 24;
        let duty = Math.max(0, Math.min(1, Number(sch.dutyCycle) || 0));
        let rateOn =
          Number(sch.rateWhenOnM3h) != null && !Number.isNaN(Number(sch.rateWhenOnM3h))
            ? Number(sch.rateWhenOnM3h)
            : Number(inj.rateM3h) || 0;
        if (state.useExcelDuty && sch.excelDutyCycle != null) {
          duty = Number(sch.excelDutyCycle);
          if (sch.excelRateWhenOnM3h != null) rateOn = Number(sch.excelRateWhenOnM3h);
        } else if (sch.preferDatosBombeo && inj.datosBombeoRateM3h != null) {
          rateOn = Number(inj.datosBombeoRateM3h);
        }
        // CD temp head: limit injection
        if (state.cdTempHead && inj.id && String(inj.id).indexOf('cd-') === 0) {
          rateOn = Math.min(rateOn, 25);
        }
        const onH = sch.onHours != null && !state.useExcelDuty ? Number(sch.onHours) : periodH * duty;
        const tH = state.timeSec / 3600;
        const offH = Number(sch.phaseOffsetHours) || 0;
        const phase = (((tH + offH) % periodH) + periodH) % periodH;
        const on = phase < onH;
        state.injectionActive[inj.id] = on;
        return on ? Math.max(0, rateOn) : 0;
      }
      return Math.max(0, Number(inj.rateM3h) || 0);
    }

    function stationInjectionTotal(st) {
      if (!st) return 0;
      let total = 0;
      if (st.injections && st.injections.length) {
        for (const inj of st.injections) total += injectionInstantRate(inj);
        return total;
      }
      if (st.injection && st.injection.enabled) total += Number(st.injection.rateM3h) || 0;
      return total;
    }

    function pumpBoostKg(st) {
      if (!st.pumps || !st.pumps.length) return 0;
      if (state.failedStations[st.id]) return 0;
      // Only MAIN pumps contribute discharge head; boosters are suction-assist only
      let boost = 0;
      for (const p of st.pumps) {
        if (!p.online) continue;
        if (isBoosterRole(p.role)) continue;
        const frac = p.powerFraction != null ? p.powerFraction : 1;
        const b = p.boostKgCm2 != null ? p.boostKgCm2 : 20;
        boost += b * frac;
      }
      return boost;
    }

    function phDischargeKg(st) {
      if (state.phFailed || state.failedStations.ph) return 0;
      const raw = pumpBoostKg(st) * stationRampF('ph');
      const cap = Math.min(phMaxDisc(), st && st.pDescSpKgCm2 != null ? Number(st.pDescSpKgCm2) : 999);
      const softCap = cap;
      return Math.min(softCap, raw);
    }

    function frictionLossKg(Q_m3h, L_km, fOverride) {
      if (Q_m3h <= 0 || L_km <= 0) return 0;
      const Q = Q_m3h / 3600;
      const D = diameterM();
      const A = areaM2();
      const v = Q / A;
      const L = L_km * 1000;
      const f = fOverride != null ? fOverride : frictionFDefault();
      const rho = density();
      return (f * (L / D) * (rho * v * v * 0.5)) / KGCM2_PA;
    }

    function elevLossKg(dz_m) {
      return (density() * G * dz_m) / KGCM2_PA;
    }

    function velocityKmH(Q_m3h) {
      if (Q_m3h <= 0) return 0;
      const v = Q_m3h / 3600 / areaM2(); // m/s
      return v * 3.6; // km/h
    }

    function updateLinepack() {
      const segs = state.config.segments || [];
      state.linepack = {};
      for (const s of segs) {
        const base = Number(s.linepackM3) || 0;
        // rough pressure factor vs nominal 40 kg
        let pAvg = 40;
        const a = stationById(s.from);
        const b = stationById(s.to);
        if (a && b) {
          const pa = state.pressuresOut[a.id] || state.pressures[a.id] || 40;
          const pb = state.pressuresIn[b.id] || state.pressures[b.id] || 20;
          pAvg = 0.5 * (pa + pb);
        }
        // v6: crudo casi incompresible: compresibilidad del crudo + expansión del acero ≈ 1,2e-4 por kg/cm²
        const factor = 1 + 0.00012 * Math.max(0, pAvg);
        state.linepack[s.id] = {
          m3: base * factor,
          baseM3: base,
          sustainHintH:
            s.id === 'ph-cd' && state.phFailed
              ? state.cdAutonomyRemainH
              : base > 0 && (state.lineFlow || 1)
                ? (base * 0.15) / Math.max(50, state.lineFlow || 50)
                : null,
        };
      }
    }


    /** Max Q so AC (or next EB) aspiración stays above P_asp_mín given PH disc. */
    function maxQBySuctionHeadroom() {
      if (state.globalFlowSetpoint <= 0) return 0;
      if (state.phFailed || state.allStationsOff) return maxFlow();
      const ph = stationById('ph');
      const ac = isCustom
        ? sortedStations().slice().sort((a, b) => (a.pkKm || 0) - (b.pkKm || 0)).find((x) => x.id !== 'ph' && x.pumps && x.pumps.length && !state.failedStations[x.id])
        : stationById('ac');
      if (!ph || !ac) return maxFlow();
      const pDisc = phDischargeKg(ph) || phMaxDisc();
      const pMinRaw = ac.pAspMinKgCm2 != null ? ac.pAspMinKgCm2 : thr().pAspMinKgCm2_default || 4;
      // v4: el despacho mantiene margen sobre la alarma de aspiración (no opera pegado al mínimo)
      const pAlarmAc = thr().pAspAlarmKgCm2 != null ? thr().pAspAlarmKgCm2 : 5;
      const pMin = ac.pAspSpKgCm2 != null ? Number(ac.pAspSpKgCm2) : Math.max(pMinRaw, pAlarmAc + 1);
      const dL = Math.max(0.01, (ac.pkKm || 65) - (ph.pkKm || 0));
      const dPe = elevLossAlong(ph.pkKm || 0, ac.pkKm || 65);
      const budget = pDisc - pMin - dPe; // available for friction
      if (budget <= 1) return Math.min(maxFlow(), Math.max(0, state.globalFlowSetpoint));
      const f = isCustom ? frictionFFor('ph', ac.id) : frictionFFor('ph', 'ac');
      const D = diameterM();
      const A = areaM2();
      const L = dL * 1000;
      const rho = density();
      // ΔP_fric = f*(L/D)*(ρ v²/2)/1e5 = budget → v² = budget*1e5*2 / (f*(L/D)*ρ)
      const v2 = (budget * KGCM2_PA * 2) / (f * (L / D) * rho);
      if (v2 <= 0) return Math.min(maxFlow(), Math.max(0, state.globalFlowSetpoint * 0.25));
      const v = Math.sqrt(v2);
      const Q = (v * A * 3600) / Math.sqrt(draFrictionMul('ph')) - stationInjectionTotal(ph); // m³/h (DRA ↑ capacidad)
      return Math.max(0, Math.min(maxFlow(), state.globalFlowSetpoint, Q));
    }

    function effectiveThroughputCapacity() {
      if (state.allStationsOff) return 0;
      const casc = cascadeReachability();
      state.cascadeBlock = casc;
      state.oilReachablePkKm = casc.maxPkKm;
      if (casc.qFactor <= 0 && casc.reason === 'sin_PH') return 0;
      let factor = Math.max(0, casc.qFactor);
      for (const st of pumpingStations()) {
        if (state.failedStations[st.id]) {
          factor = Math.min(factor, 0.35);
          continue;
        }
        const m = mainsOnline(st);
        if (m.n === 0) continue;
        const nAct = Math.max(1, (st.pumps || []).filter((p) => !isBoosterRole(p.role) && !p.reserve).length);
        const local = Math.max(0.15, Math.min(1, m.on / nAct));
        factor = Math.min(factor, 0.35 + 0.65 * local);
        const need = minMainsRequired(st);
        if (m.on < Math.min(need, m.n || need)) {
          factor = Math.min(factor, 0.2);
        }
        const pIn = state.pressuresIn[st.id];
        const tAsp = thr();
        const alarmP = tAsp.pAspAlarmKgCm2 != null ? tAsp.pAspAlarmKgCm2 : 5;
        const strongP = tAsp.pAspStrongKgCm2 != null ? tAsp.pAspStrongKgCm2 : 4;
        const tripP = tAsp.pAspTripKgCm2 != null ? tAsp.pAspTripKgCm2 : 3;
        const derateFrac = tAsp.pAspAlarmDerateFrac != null ? tAsp.pAspAlarmDerateFrac : 0.15;
        let pEff = pIn;
        if (st.id === 'ph') {
          pEff = (pIn != null ? pIn : alarmP) + suctionAssistKg(st);
          if (suctionAssistKg(st) < 0.5 && pEff < alarmP) {
            factor = Math.min(factor, 0.75);
          }
        }
        if (pEff != null && st.id !== 'ph') {
          if (pEff < tripP) factor = Math.min(factor, 0.05);
          else if (pEff < strongP) factor = Math.min(factor, 0.45);
          else if (pEff < alarmP) factor = Math.min(factor, 1 - derateFrac);
        }
      }
      if (state.phFailed && state.cdTempHead) {
        // CD as temp head — limited throughput
        const remain = state.cdAutonomyRemainH;
        const frac = Math.max(0, Math.min(1, remain / Math.max(0.1, state.cdAutonomyTotalH)));
        factor = Math.min(factor, 0.45 + 0.4 * frac);
      }
      if (state.coldStart) factor = Math.min(factor, 0.4);
      let inj = 0;
      for (const st of state.stations) inj += stationInjectionTotal(st);
      let q = state.globalFlowSetpoint * factor + inj * 0.05;
      // DRA / segment caps — choke by tightest segment
      const segs = state.config.segments || [];
      for (const s of segs) {
        q = Math.min(q, segmentQMax(s));
      }
      q = Math.min(q, maxQBySuctionHeadroom());
      // v6: caudal máximo de línea (750 m³/h) contando las inyecciones aguas abajo de PH
      const maxLine = (state.config._meta && state.config._meta.maxLineFlowM3h) || 750;
      // v7: el máximo de 750 m³/h es el caudal de cabecera PH (LC recibe además las inyecciones)
      q = Math.min(q, maxLine);
      return Math.min(maxFlow(), Math.max(0, q));
    }

    function midPumpId() {
      const ps = pumpingStations().filter((x) => x.id !== 'ph').sort((a, b) => (a.pkKm || 0) - (b.pkKm || 0));
      return ps.length ? ps[Math.floor(ps.length / 2)].id : 'ph';
    }
    function lastPumpId() {
      const ps = sortedStations().filter((x) => x.id !== 'lc' && x.pumps && x.pumps.length);
      ps.sort((a, b) => (a.pkKm || 0) - (b.pkKm || 0));
      return ps.length ? ps[ps.length - 1].id : null;
    }

    function requiredDischargeKg(i, flow) {
      // Recorre la polilínea de altimetría (incluye el peak) hasta el próximo punto de control
      // y devuelve la P de descarga mínima que mantiene P ≥ P_mín en todo el tramo
      // y P_asp objetivo en la próxima EB (o llegada objetivo en LC).
      const sorted = hydraulicStations();
      const t = thr();
      const alarmP = t.pAspAlarmKgCm2 != null ? t.pAspAlarmKgCm2 : 5;
      const pLineMin = (t.pMinLineKgCm2 != null ? t.pMinLineKgCm2 : 2) + 1;
      const from = sorted[i];
      let end = null;
      let target = null;
      for (let j = i + 1; j < sorted.length; j++) {
        const b = sorted[j];
        if (b.id === 'lc') { end = b; target = (t.lcArrivalTargetKgCm2 != null ? t.lcArrivalTargetKgCm2 : 6.5) + 0.4; break; }
        if (b.pumps && b.pumps.length && !state.failedStations[b.id]) {
          end = b;
          // si la EB siguiente no alcanza sola, esta estación debe entregarle más aspiración
          const downstream = requiredDischargeKg(j, flow);
          const avail = pumpBoostKg(b);
          const spNext = b.pAspSpKgCm2 != null ? Number(b.pAspSpKgCm2) + 0.3 : alarmP + 3;
          target = Math.max(spNext, downstream != null ? downstream - avail : 0);
          break;
        }
      }
      if (!end) return null;
      const pk0 = from.pkKm || 0;
      const pk1 = end.pkKm || 0;
      const pts = [pk1];
      for (const p of altimetry()) if (p.pkKm > pk0 && p.pkKm < pk1) pts.push(p.pkKm);
      pts.sort((x, y) => x - y);
      let need = 0;
      let cum = 0;
      let prevPk = pk0;
      for (const pk of pts) {
        // fricción con f del tramo de estaciones que contiene este sub-tramo
        let a = from;
        for (const st of sorted) if ((st.pkKm || 0) <= prevPk + 1e-6) a = st;
        let bb = end;
        for (let k = sorted.length - 1; k >= 0; k--) if ((sorted[k].pkKm || 0) >= pk - 1e-6) bb = sorted[k];
        // v8: en ductos a medida, el caudal del sub-tramo suma las inyecciones aguas arriba
        let qSeg = flow;
        if (isCustom) for (const st of sorted) if ((st.pkKm || 0) > pk0 + 1e-6 && (st.pkKm || 0) <= prevPk + 1e-6) qSeg += stationInjectionTotal(st);
        cum += frictionLossKg(Math.max(qSeg, 1), Math.max(0.001, pk - prevPk), frictionFFor(a.id, bb.id));
        cum += elevLossKg(elevAtPk(pk) - elevAtPk(prevPk));
        const minHere = pk === pk1 ? target : pLineMin;
        need = Math.max(need, cum + minHere);
        prevPk = pk;
      }
      return need;
    }

    function computeHydraulics() {
      const rho = density();
      const sorted = hydraulicStations();
      if (!sorted.length) return;

      state.pressures = {};
      state.pressuresIn = {};
      state.pressuresOut = {};
      state.segmentLoss = {};
      state.hgl = {};
      state.segmentFlows = {};
      state.segmentPMin = {};
      state.segmentPMax = {};

      let flow = Math.max(0, effectiveThroughputCapacity());
      const casc = state.cascadeBlock || cascadeReachability();
      // PH cabecera contribution
      const ph = stationById('ph');
      let pLine = 0;

      if (state.allStationsOff) {
        // Full cascade: Q=0, pressures → hydrostatic/linepack residual only
        flow = 0;
        for (let i = 0; i < sorted.length; i++) {
          const st = sorted[i];
          const elev0 = sorted[0].elevationMsnm || 0;
          const dz = (st.elevationMsnm || 0) - elev0;
          // residual linepack ~ few kg decaying with elevation head
          const pHydro = Math.max(0.5, 8 - elevLossKg(Math.max(0, dz)) * 0.15);
          state.pressuresIn[st.id] = pHydro;
          state.pressuresOut[st.id] = pHydro;
          state.pressures[st.id] = pHydro;
          state.hgl[st.id] = (st.elevationMsnm || 0) + (pHydro * KGCM2_PA) / (rho * G);
          state.segmentFlows[st.id] = 0;
        }
        applyBlockage(sorted);
        state.lineFlow = 0;
        updateLinepack();
        return { flow: 0, pressures: state.pressures, hgl: state.hgl };
      }


      if (state.phFailed && state.cdTempHead) {
        // Column depressurized upstream of CD; CD becomes temporary head
        flow = Math.min(flow, 420);
      }

      if (ph && ph.pumps && ph.pumps.length && !state.phFailed) {
        pLine = phDischargeKg(ph);
      } else if (state.phFailed && state.cdTempHead) {
        pLine = 0; // until CD
      } else {
        pLine = 5;
      }
      pLine += state.overpressureBoost;

      for (let i = 0; i < sorted.length; i++) {
        const st = sorted[i];
        let pIn = pLine;
        let pOut = pLine;

        if (i === 0) {
          pIn = Math.max(0, state.phFailed ? 0 : pLine * 0.12);
          pOut = state.phFailed ? 0 : pLine;
          if (state.phFailed && !state.cdTempHead) {
            flow = 0;
          } else if (!state.phFailed) {
            // keep flow from effectiveThroughputCapacity (already suction+DRA capped)
            flow = Math.min(flow, maxQBySuctionHeadroom());
            flow += stationInjectionTotal(st);
            for (const s of state.config.segments || []) flow = Math.min(flow, segmentQMax(s));
            // v7: la presión de cabecera es la necesaria para el caudal (no la máxima de bombas)
            if (st._manualCv != null) {
              pOut = pumpBoostKg(st) * stationRampF('ph') * Math.max(0, Math.min(1, Number(st._manualCv) / 100)); pLine = pOut;
            } else if (!state.scenarioActive && !st._spLocal) {
              const needPh = requiredDischargeKg(0, flow);
              if (needPh != null) { pOut = Math.min(pOut, Math.max(needPh, 2)); pLine = pOut; }
            }
            // v16: golpe del controlador al volver a automático con SP lejos del PV
            if (st._bumpKg) { pOut = Math.max(0, pOut + Number(st._bumpKg)); pLine = pOut; }
          }
        } else {
          const prev = sorted[i - 1];
          const dL = Math.max(0.01, (st.pkKm || 0) - (prev.pkKm || 0));
          const blocked = closedValveBlocking(prev.pkKm || 0, st.pkKm || 0);
          if (blocked) {
            flow = 0;
            state.segmentLoss[st.id] = {
              from: prev.id,
              dL_km: dL,
              friction_kgcm2: 0,
              elev_kgcm2: 0,
              blockedValve: blocked.id,
            };
            pIn = 0;
            pOut = 0;
            pLine = 0;
          } else {
            // PH failure: depressurize until CD, then CD head
            if (state.phFailed && !state.cdTempHead) {
              pIn = Math.max(0, pLine * 0.1);
              pOut = pIn;
              flow = 0;
            } else if (state.phFailed && state.cdTempHead && stationById('cd') && (prev.pkKm || 0) < (stationById('cd').pkKm || 160)) {
              // upstream of CD still low
              pIn = Math.max(0, 2);
              pOut = pIn;
              flow = Math.max(0, flow * 0.05);
              if (st.id === 'cd') {
                // CD takes head from tank
                const remainFrac = Math.max(0, state.cdAutonomyRemainH / Math.max(0.1, state.cdAutonomyTotalH));
                const cdBoost = pumpBoostKg(st) * (0.55 + 0.45 * remainFrac);
                pIn = Math.max(3, 8 * remainFrac);
                pOut = pIn + cdBoost;
                flow = Math.min(380, 280 + 100 * remainFrac) + stationInjectionTotal(st);
                // limit CD inj when temp head
                if (state.cdTempHead) {
                  /* already limited in injectionInstantRate */
                }
              }
            } else {
              const fSeg = frictionFFor(prev.id, st.id);
              const dPfric = frictionLossKg(Math.max(flow, 1), dL, fSeg);
              const dPelev = elevLossAlong(prev.pkKm || 0, st.pkKm || 0);
              pIn = pLine - dPfric - dPelev;
              state.segmentLoss[st.id] = {
                from: prev.id,
                dL_km: dL,
                friction_kgcm2: dPfric,
                elev_kgcm2: dPelev,
                f: fSeg,
              };

              if (state.failedStations[st.id]) {
                flow = Math.min(flow, flow * 0.7);
              }
              flow = Math.min(maxFlow(), flow + stationInjectionTotal(st));
              const cap = capacitySegmentFor(prev.pkKm || 0, st.pkKm || 0);
              if (cap) flow = Math.min(flow, segmentQMax(cap));

              let boost = 0;
              if (st.pumps && st.pumps.length && !state.failedStations[st.id] && !state.tripFlags[st.id]) {
                boost = pumpBoostKg(st);
                // P_asp trip / derate
                const pMin = st.pAspMinKgCm2 != null ? st.pAspMinKgCm2 : thr().pAspMinKgCm2_default || 4;
                if (pIn < pMin) {
                  boost *= 0.35;
                }
              }
              boost *= stationRampF(st.id);
              pOut = pIn + boost;
              // v12: control en manual: la salida del controlador (CV %) fija cuánto aporta la estación, sin SP
              const manCv = st._manualCv != null ? Math.max(0, Math.min(1, Number(st._manualCv) / 100)) : null;
              if (manCv != null) pOut = pIn + boost * manCv;
              // v5: lazo de descarga de la estación (PID con selector): nunca supera el SP de descarga
              if (manCv == null && st.pDescSpKgCm2 != null) pOut = Math.min(pOut, Number(st.pDescSpKgCm2));
              // v7: cada EB entrega la presión necesaria para el caudal (PID con selector):
              // más caudal o menos DRA → más presión; tope en el SP del PID.
              // v16: con SP local (liberado del maestro) la estación sostiene su propio SP y deja de balancear la línea
              if (!state.scenarioActive && boost > 0 && manCv == null && !st._spLocal) {
                const need = requiredDischargeKg(i, flow);
                if (need != null) {
                  const floor = st.id === 'rt' || (isCustom && st.id === lastPumpId()) ? 0 : pIn; // RT puede estrangular para entregar el SP de LC
                  pOut = Math.min(pOut, Math.max(floor, need));
                }
              }
              if (st._bumpKg && boost > 0) pOut = Math.max(pIn, pOut + Number(st._bumpKg));

              // MAOP: alarm at 90%, clamp/trip at 100% — keep disc at MAOP (no full collapse)
              const maop = maopForStations(prev.id, st.id);
              const tripF = thr().maopTripFraction != null ? thr().maopTripFraction : 1;
              if (pOut > maop * tripF && st.pumps && st.pumps.length) {
                state.tripFlags[st.id] = true;
                pOut = maop * tripF; // clamp at MAOP (entrenamiento)
              } else {
                delete state.tripFlags[st.id];
              }
            }
          }
        }

        if ((state.surgeBoostKg > 0 || state.overpressureBoost > 0) && st.pumps && st.pumps.length) {
          const spike = Math.max(state.surgeBoostKg || 0, state.overpressureBoost || 0);
          state.pressuresOut[st.id] = (state.pressuresOut[st.id] || 0) + spike;
          state.pressures[st.id] = state.pressuresOut[st.id];
        }
        if (state.rupture && state.rupture.active && state.rupture.pkKm != null) {
          const rpk = state.rupture.pkKm;
          const d = Math.abs((st.pkKm || 0) - rpk);
          if (d < 40) {
            const cut = state.rupture.isolated ? 0.15 : Math.max(0.2, 1 - (40 - d) / 40 * 0.85);
            state.pressuresIn[st.id] = (state.pressuresIn[st.id] || 0) * cut;
            state.pressuresOut[st.id] = (state.pressuresOut[st.id] || 0) * cut;
            state.pressures[st.id] = state.pressuresOut[st.id];
          }
        }
        // DRA on: soft clamp / derate so P_desc ≤ pDescMaxKgCm2 (default 85)
        if (stationDraActive(st)) {
          const capP = pDescMax();
          if (pOut > capP) {
            pOut = capP;
          }
        } else if (state.draEnabled) {
          // global DRA still protects discharge ceiling even if local L/h=0
          const capP = pDescMax();
          if (pOut > capP) pOut = capP;
        }

        if (state.scenarioActive === 'sobrepresion' && (st.id === 'mg' || st.id === 'mal' || (isCustom && st.id === midPumpId()))) {
          pOut += 25;
        }

        pLine = pOut;
        state.pressuresIn[st.id] = Math.max(0, pIn);
        state.pressuresOut[st.id] = Math.max(0, pOut);
        // Show both; primary panel: PH=disc, others prefer showing both in UI
        const pShow = i === 0 ? Math.max(0, pOut) : Math.max(0, pIn);
        state.pressures[st.id] = pShow;
        state.hgl[st.id] =
          (st.elevationMsnm || 0) + (Math.max(0, pOut) * KGCM2_PA) / (rho * G);
        state.segmentFlows[st.id] = flow;
      }

      // Training soft-repair: if mid EB aspiración colapsó, derate Q once
      let needDerate = false;
      for (const st of sorted) {
        if (!st.pumps || !st.pumps.length || st.id === 'ph') continue;
        const spA = !state.scenarioActive && st.pAspSpKgCm2 != null ? Number(st.pAspSpKgCm2) - 0.3 : 1;
        if ((state.pressuresIn[st.id] || 0) < spA && flow > 300) needDerate = true;
      }
      {
        const lcS = stationById('lc');
        const rupt = state.rupture && state.rupture.active;
        const lcSp = lcS && lcS.pAspSpKgCm2 != null ? Number(lcS.pAspSpKgCm2) - 0.3 : 3;
        if (lcS && !rupt && !state.scenarioActive && flow > 300 && (state.pressuresIn.lc || 0) < lcSp) needDerate = true;
      }
      if (needDerate && !state._hydRepair) {
        // v4: buscar el máximo caudal hidráulicamente sostenible (pasos de 4 %) en lugar de un recorte fijo
        state._hydRepair = true;
        const saved = state.globalFlowSetpoint;
        let r = null;
        for (let k = 0.985; k >= 0.3; k -= 0.015) {
          state.globalFlowSetpoint = Math.max(150, saved * k);
          r = computeHydraulics();
          let ok = true;
          for (const st2 of hydraulicStations()) {
            if (!st2.pumps || !st2.pumps.length || st2.id === 'ph') continue;
            const sp2 = !state.scenarioActive && st2.pAspSpKgCm2 != null ? Number(st2.pAspSpKgCm2) - 0.3 : 1;
            if ((state.pressuresIn[st2.id] || 0) < sp2) { ok = false; break; }
          }
          const lc2 = stationById('lc');
          const lcSp2 = lc2 && lc2.pAspSpKgCm2 != null ? Number(lc2.pAspSpKgCm2) - 0.3 : 3;
          if (!state.scenarioActive && (state.pressuresIn.lc || 0) < lcSp2) ok = false;
          if (ok) break;
        }
        state.globalFlowSetpoint = saved;
        state._hydRepair = false;
        return r;
      }

      // Cascade: zero / collapse flow beyond reachable PK
      const maxPk = (state.cascadeBlock && state.cascadeBlock.maxPkKm != null)
        ? state.cascadeBlock.maxPkKm
        : lengthKm();
      let qAtLc = flow;
      for (const st of sorted) {
        if ((st.pkKm || 0) > maxPk + 0.5) {
          state.segmentFlows[st.id] = 0;
          // residual hydrostatic beyond front
          const elev0 = sorted[0].elevationMsnm || 0;
          const dz = (st.elevationMsnm || 0) - elev0;
          const pHydro = Math.max(0.3, 4 - elevLossKg(Math.max(0, dz)) * 0.12);
          if ((state.pressuresIn[st.id] || 0) > pHydro * 1.5) {
            state.pressuresIn[st.id] = pHydro;
            state.pressuresOut[st.id] = pHydro;
            state.pressures[st.id] = pHydro;
          }
        }
      }
      applyBlockage(sorted);
      const lc = stationById('lc');
      if (lc && (lc.pkKm || lengthKm()) > maxPk + 0.5) qAtLc = 0;
      // line flow = flow at farthest pressurized reachable station
      let qLine = 0;
      for (const st of sorted) {
        if ((st.pkKm || 0) <= maxPk + 0.5) {
          qLine = state.segmentFlows[st.id] != null ? state.segmentFlows[st.id] : flow;
        }
      }
      if ((state.cascadeBlock && state.cascadeBlock.qFactor <= 0) || state.allStationsOff) qLine = 0;
      if (state.rupture && state.rupture.active) {
        qLine = Math.max(0, qLine - (state.rupture.qLeakM3h || 0) * (state.rupture.isolated ? 0.2 : 0.7));
        if (state.segmentFlows.lc != null) {
          state.segmentFlows.lc = Math.max(0, state.segmentFlows.lc - (state.rupture.qLeakM3h || 0) * 0.8);
        }
      }
      state.lineFlow = qLine;
      updateDuctMotionFlag();
      if (lc) state.segmentFlows.lc = (lc.pkKm || lengthKm()) <= maxPk + 0.5 ? qLine : 0;

      // Track P min / max along live stations
      let pMin = Infinity;
      let pMax = -Infinity;
      for (const st of sorted) {
        const a = state.pressuresIn[st.id];
        const b = state.pressuresOut[st.id];
        if (a != null) {
          pMin = Math.min(pMin, a);
          pMax = Math.max(pMax, a);
        }
        if (b != null) {
          pMin = Math.min(pMin, b);
          pMax = Math.max(pMax, b);
        }
        state.segmentPMin[st.id] = a != null && b != null ? Math.min(a, b) : a != null ? a : b;
        state.segmentPMax[st.id] = a != null && b != null ? Math.max(a, b) : a != null ? a : b;
      }
      state.linePMin = pMin === Infinity ? null : pMin;
      state.linePMax = pMax === -Infinity ? null : pMax;

      computeDraSegmentDeltas(qLine > 0 ? qLine : Math.max(flow, 1));
      updateLinepack();
      return { flow: qLine, pressures: state.pressures, hgl: state.hgl };
    }

    function activatePlaybook(keys, opts) {
      const pb = state.config.playbook || {};
      const merge = opts && opts.merge;
      const steps = merge ? (state.playbookActive || []).slice() : [];
      const seen = {};
      for (const s of steps) seen[s.id] = true;
      for (const k of keys) {
        const list = pb[k] || [];
        for (const s of list) {
          const id = k + '::' + s;
          if (seen[id]) continue;
          seen[id] = true;
          steps.push({ id, group: k, text: s, done: !!state.playbookChecks[id] });
        }
      }
      state.playbookActive = steps;
    }

    function ensureEstrategiaGlobal(extraKeys) {
      const keys = ['estrategia_global'].concat(extraKeys || []);
      activatePlaybook(keys, { merge: true });
    }

    function togglePlaybookCheck(id) {
      state.playbookChecks[id] = !state.playbookChecks[id];
      for (const s of state.playbookActive) {
        if (s.id === id) s.done = !!state.playbookChecks[id];
      }
    }

    function checkAlarms() {
      const h = hyd();
      const t = thr();
      const maxP = h.maxPressureKgCm2 || 95;
      const minP = h.minPressureKgCm2 != null ? h.minPressureKgCm2 : 2;
      const next = [];
      const alarmFrac = t.maopAlarmFraction != null ? t.maopAlarmFraction : 0.9;

      for (const st of state.stations) {
        const pIn = state.pressuresIn[st.id];
        const pOut = state.pressuresOut[st.id];
        const pMinAsp = st.pAspMinKgCm2 != null ? st.pAspMinKgCm2 : t.pAspMinKgCm2_default || 4;

        if (pOut != null && pOut > maxP) {
          next.push({
            id: 'hi-p-' + st.id,
            severity: 'critical',
            text: `Sobrepresión en ${st.name}: disc ${pOut.toFixed(1)} kg/cm² (>${maxP})`,
          });
        }
        const pMaxLim = t.pMaxLineKgCm2 != null ? t.pMaxLineKgCm2 : maxP;
        const pMinLim = t.pMinLineKgCm2 != null ? t.pMinLineKgCm2 : minP;
        if (pOut != null && pOut > pMaxLim) {
          next.push({
            id: 'pmax-' + st.id,
            severity: 'warn',
            text: `P_máx excedida en ${st.shortName || st.name}: ${pOut.toFixed(1)} > ${pMaxLim} kg/cm²`,
          });
        }
        const pSegMin = state.segmentPMin[st.id];
        if (pSegMin != null && pSegMin < pMinLim && (state.segmentFlows[st.id] || 0) > 5) {
          next.push({
            id: 'pmin-' + st.id,
            severity: 'critical',
            text: `P_mín tramo ${st.shortName || st.name}: ${pSegMin.toFixed(1)} < ${pMinLim} kg/cm²`,
          });
        }

        // MAOP segment
        if (pOut != null && st.pumps && st.pumps.length) {
          const sorted = sortedStations();
          const idx = sorted.findIndex((x) => x.id === st.id);
          const prev = idx > 0 ? sorted[idx - 1] : null;
          const maop = maopForStations(prev ? prev.id : 'ph', st.id);
          if (pOut >= maop * (t.maopTripFraction || 1)) {
            next.push({
              id: 'maop-trip-' + st.id,
              severity: 'critical',
              text: `TRIP MAOP ${st.shortName}: disc ${pOut.toFixed(1)} ≥ MAOP ${maop} (estim. entrenamiento)`,
            });
          } else if (pOut >= maop * alarmFrac) {
            next.push({
              id: 'maop-alarm-' + st.id,
              severity: 'warn',
              text: `Alarma 90% MAOP ${st.shortName}: ${pOut.toFixed(1)} / ${maop} kg/cm² (operativo / no contractual)`,
            });
          }
        }

        const alarmP = t.pAspAlarmKgCm2 != null ? t.pAspAlarmKgCm2 : 5;
        const strongP = t.pAspStrongKgCm2 != null ? t.pAspStrongKgCm2 : 4;
        const tripP = t.pAspTripKgCm2 != null ? t.pAspTripKgCm2 : 3;
        let pAspEff = pIn;
        if (st.id === 'ph') pAspEff = (pIn != null ? pIn : alarmP) + suctionAssistKg(st);
        if (
          pAspEff != null &&
          state.lineFlow > 20 &&
          (st.type === 'pumping' || st.type === 'cabecera') &&
          st.pumps &&
          st.pumps.length
        ) {
          if (pAspEff < tripP) {
            next.push({
              id: 'asp-trip-' + st.id,
              severity: 'critical',
              text: `TRIP P_asp ${st.shortName || st.name}: ${pAspEff.toFixed(1)} < ${tripP} kg/cm² → parar EB + estrategia global`,
            });
            state.aspAlarmStations[st.id] = 'trip';
            // Alarm + soft derate only — do NOT auto-flip pump.online (Raúl toggles manually).
            // Hard fail/offline only via CAÍDA / apagar / pump-rule / escenarios.
            if (state.timeSec > 30 && st.id !== 'ph') {
              state.tripFlags[st.id] = true;
              ensureEstrategiaGlobal([]);
              if (!state.knownAlarmIds['asp-trip-log-' + st.id]) {
                state.knownAlarmIds['asp-trip-log-' + st.id] = true;
                logEvent(
                  'TRIP aspiración ' + (st.shortName || st.id) +
                    ' — derate Q (bombas siguen como las dejó el operador)',
                  'alarm'
                );
              }
            }
          } else if (pAspEff < strongP) {
            next.push({
              id: 'asp-strong-' + st.id,
              severity: 'critical',
              text: `P_asp fuerte ${st.shortName || st.name}: ${pAspEff.toFixed(1)} < ${strongP} → cortar inyecciones no críticas`,
            });
            state.aspAlarmStations[st.id] = 'strong';
            if (st.injections) {
              for (const inj of st.injections) {
                if (inj.mode === 'intermittent') state.injectionActive[inj.id] = false;
              }
            }
            ensureEstrategiaGlobal([]);
          } else if (pAspEff < alarmP) {
            next.push({
              id: 'asp-alarm-' + st.id,
              severity: 'warn',
              text: `Alarma P_asp ${st.shortName || st.name}: ${pAspEff.toFixed(1)} < ${alarmP} kg/cm² → derate Q 10–20%`,
            });
            state.aspAlarmStations[st.id] = 'alarm';
          } else if (state.aspAlarmStations[st.id]) {
            delete state.aspAlarmStations[st.id];
          }
        }
        if (
          pIn != null &&
          pIn < pMinAsp &&
          state.lineFlow > 30 &&
          st.type === 'pumping' &&
          st.id !== 'ph' &&
          !state.aspAlarmStations[st.id]
        ) {
          next.push({
            id: 'lo-asp-' + st.id,
            severity: 'critical',
            text: `P_asp baja ${st.name}: ${pIn.toFixed(1)} < mín ${pMinAsp} kg/cm² → derate/trip`,
          });
        }

        // NPSH / cavitation proxy
        const npsh = t.npshProxy || {};
        const qHigh = (st.qMaxM3h || maxFlow()) * (npsh.qHighFraction || 0.85);
        const flow = state.segmentFlows[st.id] || 0;
        if (
          pIn != null &&
          pIn < (npsh.pAspWarnKgCm2 || 5) &&
          flow > qHigh &&
          st.pumps &&
          st.pumps.length
        ) {
          next.push({
            id: 'npsh-' + st.id,
            severity: 'warn',
            text: `Proxy cavitación/NPSH ${st.shortName}: P_asp ${pIn.toFixed(1)} + Q alto ${flow.toFixed(0)}`,
          });
        }

        if (st.pumps && st.pumps.length) {
          // v15: la reserva no es fija; se compara la cantidad en marcha con la cantidad de servicio
          const mainsAll = st.pumps.filter((pu) => !isBoosterRole(pu.role));
          const onN = mainsAll.filter((pu) => pu.online).length;
          const nServ = Math.max(1, mainsAll.filter((pu) => !pu.reserve).length);
          if (state.failedStations[st.id]) {
            next.push({ id: 'pumps-off-' + st.id, severity: 'critical', text: `Falla / bombas fuera: ${st.name}` });
          } else if (onN === 0) {
            next.push({ id: 'pumps-idle-' + st.id, severity: 'warn', text: `${st.name}: sin bombas en marcha` });
          } else if (onN < nServ) {
            next.push({ id: 'pump-off-' + st.id, severity: 'warn', text: `${nServ - onN} bomba(s) menos que las de servicio en ${st.name}` });
          }
        }

        // Q band
        if (st.qMinM3h != null && flow > 0 && flow < st.qMinM3h && st.type === 'pumping') {
          next.push({
            id: 'q-lo-' + st.id,
            severity: 'warn',
            text: `Q bajo ${st.shortName}: ${flow.toFixed(0)} < mín ${st.qMinM3h} m³/h`,
          });
        }
        if (st.qMaxM3h != null && flow > st.qMaxM3h) {
          next.push({
            id: 'q-hi-' + st.id,
            severity: 'warn',
            text: `Q alto ${st.shortName}: ${flow.toFixed(0)} > máx ${st.qMaxM3h} m³/h`,
          });
        }
      }

      // LC arrival / receipt
      const lc = stationById('lc');
      if (lc) {
        const pLc = state.pressuresIn.lc != null ? state.pressuresIn.lc : state.pressures.lc;
        const pLcHi = isCustom ? Math.max(15, (meta.opMaxKgCm2 || 80) * 0.9) : 15;
        if (pLc != null && (pLc < 3 || pLc > pLcHi)) {
          next.push({
            id: 'lc-arrival',
            severity: pLc < 3 ? 'critical' : 'warn',
            text: `Llegada ${lc.shortName || 'LC'} ${pLc.toFixed(1)} kg/cm² (tip. entrenamiento 5–8)`,
          });
        }
        const qLc = state.segmentFlows.lc || state.lineFlow || 0;
        const tgt = state.lcReceiptTarget || 800;
        const band = t.lcReceiptBandM3h != null ? t.lcReceiptBandM3h : 50;
        if (Math.abs(qLc - tgt) > band) {
          next.push({
            id: 'lc-receipt',
            severity: 'warn',
            text: `Recibo ${lc.shortName || 'LC'} ${qLc.toFixed(0)} fuera de banda ${tgt}±${band} m³/h`,
          });
        }
      }

      if (state.cascadeBlock && state.cascadeBlock.reason && state.cascadeBlock.reason !== 'ok' && state.cascadeBlock.reason !== 'PA_throttle') {
        next.push({
          id: 'cascade-' + state.cascadeBlock.reason,
          severity: 'critical',
          text: `Alcance hidráulico limitado (${state.cascadeBlock.reason}) · frente ~PK ${Number(state.oilReachablePkKm).toFixed(0)} — no sostiene hasta ${(stationById('lc') || {}).shortName || 'LC'}`,
        });
      }

      // Water slug / batch quality
      const wLim = t.waterSlugOosPct != null ? t.waterSlugOosPct : 0.75;
      const wWarn = t.waterSlugWarnPct != null ? t.waterSlugWarnPct : 0.5;
      if (state.waterSlugPct >= wLim) {
        next.push({
          id: 'water-oos',
          severity: 'critical',
          text: `Calidad OOS: agua ${state.waterSlugPct.toFixed(2)}% en LC (≥${wLim}%) — reducir inyecciones upstream`,
        });
        activatePlaybook(['calidad_agua']);
      } else if (state.waterSlugPct >= wWarn) {
        next.push({
          id: 'water-warn',
          severity: 'warn',
          text: `Agua en batch ${state.waterSlugPct.toFixed(2)}% (umbral aviso ${wWarn}%)`,
        });
      }

      if (state.allStationsOff) {
        next.push({
          id: 'all-off',
          severity: 'critical',
          text: 'CASCADA TOTAL: todas las estaciones apagadas — P hidrostática/linepack · Q→0 · notificar CILC',
        });
      }

      if (state.phFailed) {
        next.push({
          id: 'ph-fail',
          severity: 'critical',
          text: state.cdTempHead
            ? `Falla PH — CD cabecera temporal · autonomía ${state.cdAutonomyRemainH.toFixed(2)} h`
            : 'Falla PH — columna despresurizada aguas abajo',
        });
        if (state.cdTempHead && state.cdAutonomyRemainH <= 0) {
          next.push({
            id: 'cd-cascade',
            severity: 'critical',
            text: 'Cascada: CD sin autonomía — no puede sostener cabecera temporal',
          });
        }
      }

      if (state.pig.active && !state.pig.stuck) {
        const pk = state.pig.pkKm;
        const sorted = sortedStations();
        for (let i = 0; i < sorted.length - 1; i++) {
          const a = sorted[i];
          const b = sorted[i + 1];
          if (pk >= a.pkKm && pk < b.pkKm) {
            if (a.pumps && a.pumps.length && pumpsOnlineCount(a) === 0) {
              next.push({
                id: 'pig-pump-seg',
                severity: 'critical',
                text: `Pig en tránsito (PK ${pk.toFixed(1)}) — bombas offline ${a.shortName}→${b.shortName}`,
              });
            }
          }
        }
      }
      if (state.pig.stuck) {
        next.push({
          id: 'pig-stuck',
          severity: 'critical',
          text: `Pig atascado PK ${state.pig.pkKm.toFixed(1)} · v<vmin`,
        });
      }

      const ldc = stationById('lc');
      if (ldc && ldc.tanks) {
        for (const tk of ldc.tanks) {
          if (tk.levelPct >= 95) {
            next.push({
              id: 'tk-hi-' + tk.id,
              severity: 'critical',
              text: `Tanque ${tk.name} casi lleno (${tk.levelPct.toFixed(0)}%)`,
            });
          } else if (tk.maxOpM3 && tk.mode === 'recibe' && tk.volumeM3 >= tk.maxOpM3) {
            next.push({
              id: 'tk-maxop-' + tk.id,
              severity: 'warn',
              text: `Terminal ${ldc.shortName || 'LC'}: ${tk.name} sobre máximo operativo (${Math.round(tk.volumeM3)} m³) · sin tanque libre, reducir bombeo`,
            });
          } else if (tk.levelPct <= 5) {
            next.push({
              id: 'tk-lo-' + tk.id,
              severity: 'warn',
              text: `Tanque ${tk.name} casi vacío (${tk.levelPct.toFixed(0)}%)`,
            });
          }
        }
      }

      const currentIds = {};
      for (const a of next) {
        currentIds[a.id] = true;
        if (!state.knownAlarmIds[a.id]) logAlarm(a.text, a.severity);
      }
      state.knownAlarmIds = currentIds;
      const aspKeys = Object.keys(state.aspAlarmStations || {});
      const aspSerious = aspKeys.filter((k) => {
        const lvl = state.aspAlarmStations[k];
        return lvl === 'alarm' || lvl === 'strong' || lvl === 'trip';
      });
      if (aspSerious.length >= 2 && !state.allStationsOff) {
        next.push({
          id: 'asp-multi',
          severity: 'critical',
          text: 'Múltiples EB en alarma de aspiración (' + aspSerious.join(',') + ') → parada ordenada del ducto',
        });
        if (state.timeSec > 15 && aspSerious.filter((k) => state.aspAlarmStations[k] === 'trip' || state.aspAlarmStations[k] === 'strong').length >= 2) {
          ensureEstrategiaGlobal(['falla_eb']);
          state.globalFlowSetpoint = Math.min(state.globalFlowSetpoint, 150);
          logEvent('Parada ordenada: multi-EB aspiración — Q↓', 'alarm');
        }
      }

      state.alarms = next;
    }

    // v8: terminal con N tanques — uno recibe, uno entrega, el resto en reposo o espera
    function tanksGeneric(tks, inlet, outRate, dtHours, ref, tName) {
      const cap = (t) => t.capacityM3 || 20000;
      const mx = (t) => t.maxOpM3 || cap(t) * 0.875;
      const mn = (t) => t.minOpM3 || cap(t) * 0.2;
      for (const t of tks) { if (t.volumeM3 == null) t.volumeM3 = ((t.levelPct || 50) / 100) * cap(t); t.flowM3h = 0; }
      // reposo
      for (const t of tks) if (t.mode === 'reposo') {
        t.settleLeftH = Math.max(0, (t.settleLeftH || 0) - dtHours);
        if (t.settleLeftH <= 0) { t.mode = 'espera'; t.ready = true; }
      }
      // recepción
      let rx = tks.find((t) => t.mode === 'recibe');
      if (!rx) {
        rx = tks.filter((t) => t.mode === 'espera' && t.volumeM3 < mx(t) * 0.7).sort((a, b) => a.volumeM3 - b.volumeM3)[0];
        if (rx) { rx.mode = 'recibe'; rx.ready = false; }
      }
      if (rx) {
        rx.volumeM3 += inlet * dtHours;
        rx.flowM3h = inlet;
        if (rx.volumeM3 >= mx(rx)) {
          const nx = tks.filter((t) => t !== rx && t.mode === 'espera' && t.volumeM3 < mx(t) * 0.7).sort((a, b) => a.volumeM3 - b.volumeM3)[0];
          if (nx) {
            rx.mode = 'reposo'; rx.settleLeftH = ref.settleHours || 6; rx.ready = false;
            nx.mode = 'recibe'; nx.ready = false;
            logEvent(`Terminal ${tName}: ${rx.name} lleno (${Math.round(rx.volumeM3)} m³) → reposo; ${nx.name} pasa a recibir`, 'ops');
          } else if (rx.volumeM3 >= cap(rx) * 0.97) rx.volumeM3 = cap(rx) * 0.97;
        }
      }
      // entrega
      let tx = tks.find((t) => t.mode === 'entrega');
      if (!tx && outRate > 0) {
        tx = tks.filter((t) => t.mode === 'espera' && t.ready && t.volumeM3 > mn(t) + 500).sort((a, b) => b.volumeM3 - a.volumeM3)[0];
        if (tx) { tx.mode = 'entrega'; logEvent(`Terminal ${tName}: ${tx.name} drenado y liberado → entrega`, 'ops'); }
      }
      let delivered = 0;
      if (tx) {
        const dv = Math.min(outRate * dtHours, Math.max(0, tx.volumeM3 - mn(tx)));
        tx.volumeM3 -= dv; delivered = dv;
        tx.flowM3h = -outRate;
        if (tx.volumeM3 <= mn(tx) + 0.5) { tx.mode = 'espera'; tx.ready = false; logEvent(`Terminal ${tName}: ${tx.name} en fondo operativo (${Math.round(tx.volumeM3)} m³)`, 'ops'); }
      }
      if (state.port) { state.port.deliveredM3h = dtHours > 0 ? delivered / dtHours : 0; }
      for (const t of tks) t.levelPct = (t.volumeM3 / cap(t)) * 100;
      return delivered;
    }

    function updateTanks(dtHours) {
      // v6: terminal LC con dos tanques: uno recibe del ducto, otro entrega a refinería según programa
      const ldc = stationById('lc');
      if (!ldc || !ldc.tanks || !ldc.tanks.length) return;
      const ref = state.config.refinery || { programM3d: 16500, settleHours: 6 };
      const inlet = state.segmentFlows.lc || 0;
      let outRate = (Number(ref.programM3d) || 0) / 24;
      const tks = ldc.tanks;
      const tName = ldc.shortName || 'LC';
      // v8: puerto de carga — buques con lote, caudal de carga e intervalo de arribo
      if (ref.mode === 'puerto') {
        const P = state.port || (state.port = { berthed: false, loadedM3: 0, nextShipH: Number(ref.firstShipH != null ? ref.firstShipH : 6), ships: 0 });
        const shipM3 = Number(ref.shipM3) || 50000;
        if (!P.berthed) {
          P.nextShipH -= dtHours;
          outRate = 0;
          if (P.nextShipH <= 0) { P.berthed = true; P.loadedM3 = 0; P.ships++; logEvent(`Puerto ${ldc.name}: buque ${P.ships} amarrado · lote ${Math.round(shipM3)} m³`, 'ops'); }
        }
        if (P.berthed) outRate = Math.min(Number(ref.loadRateM3h) || 3000, Math.max(0, shipM3 - P.loadedM3) / Math.max(1e-6, dtHours));
        P.rateM3h = outRate;
      }
      if (isCustom) {
        const dv = tanksGeneric(tks, inlet, outRate, dtHours, ref, tName);
        const P = state.port;
        if (ref.mode === 'puerto' && P && P.berthed) {
          P.loadedM3 += dv;
          if (P.loadedM3 >= (Number(ref.shipM3) || 50000) - 1) { P.berthed = false; P.nextShipH = Number(ref.shipIntervalH) || 72; logEvent(`Puerto ${ldc.name}: buque ${P.ships} cargado (${Math.round(P.loadedM3)} m³) y zarpa`, 'ops'); }
        }
        return;
      }
      for (const tk of tks) {
        if (tk.volumeM3 == null) tk.volumeM3 = (tk.levelPct / 100) * (tk.capacityM3 || 20000);
        const max = tk.maxOpM3 || tk.capacityM3 * 0.875, min = tk.minOpM3 || tk.capacityM3 * 0.2;
        if (tk.mode === 'recibe') {
          tk.volumeM3 += inlet * dtHours;
          tk.flowM3h = inlet;
          if (tk.volumeM3 >= max) {
            const other = tks.find((x) => x !== tk && x.mode === 'espera' && x.volumeM3 < (x.maxOpM3 || x.capacityM3 * 0.875) * 0.7) || tks.find((x) => x !== tk && x.mode !== 'recibe');
            if (other && other.mode !== 'recibe' && (other.volumeM3 <= (other.minOpM3 || 4000) + 50 || (other.mode === 'espera' && other.volumeM3 < (other.maxOpM3 || other.capacityM3 * 0.875) * 0.7))) {
              tk.mode = 'reposo'; tk.settleLeftH = ref.settleHours || 6;
              other.mode = 'recibe';
              logEvent(`Terminal ${tName}: ${tk.name} lleno (${Math.round(tk.volumeM3)} m³) → reposo; ${other.name} pasa a recibir`, 'ops');
            } else if (tk.volumeM3 >= (tk.capacityM3 || 20000) * 0.97) {
              tk.volumeM3 = (tk.capacityM3 || 20000) * 0.97;
            }
          }
        } else if (tk.mode === 'reposo') {
          tk.flowM3h = 0;
          tk.settleLeftH = Math.max(0, (tk.settleLeftH || 0) - dtHours);
          const delivering = tks.find((x) => x.mode === 'entrega');
          if (tk.settleLeftH <= 0 && !delivering) { tk.mode = 'entrega'; logEvent(`Terminal ${tName}: ${tk.name} drenado y liberado → entrega`, 'ops'); }
        } else if (tk.mode === 'entrega') {
          const dv = Math.min(outRate * dtHours, Math.max(0, tk.volumeM3 - min));
          tk.volumeM3 -= dv;
          tk.flowM3h = -outRate;
          if (tk.volumeM3 <= min + 0.5) {
            const next = tks.find((x) => x !== tk && x.mode === 'reposo' && (x.settleLeftH || 0) <= 0);
            const recv = tks.find((x) => x.mode === 'recibe');
            tk.mode = recv ? 'espera' : 'recibe';
            if (next) next.mode = 'entrega';
            logEvent(`Terminal ${tName}: ${tk.name} en fondo operativo (${Math.round(tk.volumeM3)} m³)`, 'ops');
          }
        } else if (tk.mode === 'espera') {
          tk.flowM3h = 0;
          if (!tks.some((x) => x.mode === 'recibe')) tk.mode = 'recibe';
        }
        tk.levelPct = (tk.volumeM3 / (tk.capacityM3 || 20000)) * 100;
      }
      // si ninguno entrega y hay uno en reposo listo, que entregue
      if (!tks.some((x) => x.mode === 'entrega')) {
        const r = tks.find((x) => x.mode === 'reposo' && (x.settleLeftH || 0) <= 0);
        if (r) r.mode = 'entrega';
      }
    }

    function updatePig(dtHours) {
      if (!state.pig.active || state.pig.stuck) return;
      const L = lengthKm();
      // v6: velocidad con el caudal del tramo donde está el pig
      let Q = state.lineFlow || 0;
      for (const st of sortedStations().slice().sort((a, b) => (a.pkKm || 0) - (b.pkKm || 0))) {
        if ((st.pkKm || 0) > state.pig.pkKm) { Q = state.segmentFlows[st.id] != null ? state.segmentFlows[st.id] : Q; break; }
      }
      const ptype = pigTypeById(state.pig.type);
      const vKmH = velocityKmH(Q) * (ptype.speedFactor || 1);
      state.pig.speedKmPerHour = vKmH;
      if (state.pig.vMinMs && (vKmH / 3.6 < state.pig.vMinMs || vKmH / 3.6 > (ptype.vMaxMs || 9))) state.pig.vOut = (state.pig.vOut || 0) + dtHours;
      if (state.pig.willStick != null && state.pig.pkKm >= state.pig.willStick - 0.5) {
        state.pig.stuck = true; state.pig.status = 'stuck'; state.pig.pkKm = state.pig.willStick; state.pig.willStick = null;
        logEvent(`Pig ${ptype.name} detenido en el punto alto PK ${Math.round(peakPk())} (acumulación de parafina)`, 'alarm');
        activatePlaybook(['pig', 'pig_stuck_peak']);
        return;
      }
      // ΔP fore/aft proxy ~ 0.8–2.5 kg depending on speed
      state.pig.dPForeAft = Math.min(4, (ptype.dP || 1) * (0.6 + vKmH * 0.08));

      const vmin = thr().pigVminKmH != null ? thr().pigVminKmH : 1.5;
      const stuckMin = thr().pigStuckMinutes != null ? thr().pigStuckMinutes : 15;
      if (vKmH < vmin) {
        state.pig.lowSpeedSec += dtHours * 3600;
        if (state.pig.lowSpeedSec >= stuckMin * 60) {
          state.pig.stuck = true;
          state.pig.status = 'stuck';
          logEvent(`Pig stuck: v=${vKmH.toFixed(2)} km/h < ${vmin} por ${stuckMin} min`, 'alarm');
          activatePlaybook(['pig']);
          return;
        }
      } else {
        state.pig.lowSpeedSec = 0;
      }

      state.pig.pkKm += vKmH * dtHours;

      // ETA next station
      const sorted = sortedStations().filter((s) => s.type !== 'valve' || s.id === 'pa');
      let nextSt = null;
      for (const st of sorted) {
        if ((st.pkKm || 0) > state.pig.pkKm + 0.05) {
          nextSt = st;
          break;
        }
      }
      state.pig.nextStationId = nextSt ? nextSt.id : 'lc';
      if (nextSt && vKmH > 0.05) {
        state.pig.etaNextHours = (nextSt.pkKm - state.pig.pkKm) / vKmH;
      } else {
        state.pig.etaNextHours = null;
      }

      // pig in segment adds slight ΔP signature already in dPForeAft
      const mal = isCustom ? null : stationById('mg') || stationById('mal');
      const malPk = mal ? Number(mal.pkKm) || 0 : peakPk();
      if (
        state.scenarioActive === 'pig_stuck' &&
        state.pig.pkKm >= malPk - 8 &&
        state.pig.pkKm < malPk + 8
      ) {
        state.pig.stuck = true;
        state.pig.status = 'stuck';
        state.pig.pkKm = malPk;
        logEvent('Pig atascado cerca de Malargüe (escenario)', 'alarm');
        return;
      }

      const dest = stationById(state.pig.toId || 'lc');
      const destPk = dest ? dest.pkKm || L : L;
      if (state.pig.pkKm >= destPk) {
        state.pig.pkKm = destPk;
        state.pig.active = false;
        state.pig.status = 'received';
        state.pig.atId = dest.id;
        if (dest.pigTrap) { dest.pigTrap.status = 'received'; dest.pigTrap.occupied = true; }
        const from = stationById(state.pig.fromId);
        if (from && from.pigTrap) { from.pigTrap.status = 'ready'; from.pigTrap.occupied = false; }
        const hrs = (state.timeSec - (state.pig.launchedAt != null ? state.pig.launchedAt : state.timeSec)) / 3600;
        const t = pigTypeById(state.pig.type);
        let result = '';
        if (t.id === 'limpieza') {
          const seg = segmentKey(state.pig.fromId, dest.id);
          result = 'Barrido de parafina: fricción del tramo −2 %';
          const sf = hyd().segmentFriction || {};
          for (const k of Object.keys(sf)) {
            const [fa, fb] = k.split('-');
            const pa = stationById(fa), pb = stationById(fb);
            if (pa && pb && (pa.pkKm || 0) >= (stationById(state.pig.fromId).pkKm || 0) && (pb.pkKm || 0) <= destPk && typeof sf[k] === 'number') sf[k] = +(sf[k] * 0.98).toFixed(5);
          }
        } else if (t.id === 'calibrador') result = Math.random() < 0.12 ? 'Placa con marca: posible abolladura, revisar antes del instrumentado' : 'Placa sana: apto para instrumentado';
        else if (t.id === 'instrumentado') result = (state.pig.vOut || 0) > 0.5 ? `Datos incompletos: ${(state.pig.vOut).toFixed(1)} h fuera de la ventana de velocidad` : `Inspección válida · ${1 + Math.floor(Math.random() * 6)} anomalías a evaluar`;
        else result = 'Corrida sin novedades';
        if (!state.pigRuns) state.pigRuns = [];
        state.pigRuns.unshift({ type: t.name, from: state.pig.fromId, to: dest.id, hours: hrs, result, when: new Date(state.simDate.getTime()) });
        if (state.pigRuns.length > 30) state.pigRuns.pop();
        logEvent(`Pig ${t.name} recibido en ${dest.shortName} (${hrs.toFixed(1)} h) · ${result}`, 'pig');
        const traps = trapStations();
        const more = traps.findIndex((x) => x.id === dest.id) < traps.length - 1;
        state.pig.relaunchInH = state.pig.auto && more ? 1.0 : null; // 1 h de maniobra en la trampa
      } else {
        state.pig.status = 'in_transit';
      }
    }

    function updatePhFailure(dtHours) {
      if (!state.phFailed) return;
      if (state.cdTempHead) {
        state.cdAutonomyRemainH = Math.max(0, state.cdAutonomyRemainH - dtHours);
        if (state.cdAutonomyRemainH <= 0) {
          state.cdTempHead = false;
          logEvent('CD autonomía agotada — cascada alarma', 'alarm');
          activatePlaybook(['falla_ph']);
        }
      }
    }


    function dailyPlanM3h() {
      return state.lcReceiptTarget || thr().lcReceiptTargetM3h || 800;
    }

    function updateImpact(dtHours) {
      const plan = dailyPlanM3h();
      const qLc = state.segmentFlows.lc != null ? state.segmentFlows.lc : (state.lineFlow || 0);
      const lost = Math.max(0, plan - qLc);
      state.impact.baselineLcM3h = plan;
      state.impact.lostM3h = lost;
      if (lost > 1 && (state.phFailed || state.allStationsOff || Object.keys(state.failedStations).length)) {
        state.impact.cumulativeLostM3 += lost * dtHours;
        if (state.failureStartedAt == null) state.failureStartedAt = state.timeSec;
      }
      // hours to normalize estimate: remaining autonomy or heuristic
      if (state.phFailed && state.cdTempHead) {
        state.impact.hoursToNormalize = state.cdAutonomyRemainH + 1.5;
      } else if (state.allStationsOff) {
        state.impact.hoursToNormalize = 4 + state.operatorResponseDelayMin / 60;
      } else if (Object.keys(state.failedStations).length) {
        state.impact.hoursToNormalize = 2 + state.operatorResponseDelayMin / 60;
      } else if (state.coldStart) {
        state.impact.hoursToNormalize = 1.5;
      } else {
        state.impact.hoursToNormalize = lost > 20 ? 0.5 : 0;
      }
      const deliveredFrac = plan > 0 ? Math.max(0, Math.min(1.5, qLc / plan)) : 1;
      state.impact.pctDailyPlan = deliveredFrac * 100;
      state.impact.cilcQuotaPct = deliveredFrac * 100;
      // traffic light
      if (deliveredFrac >= 0.95 && !state.allStationsOff && !state.phFailed) state.impact.traffic = 'green';
      else if (deliveredFrac >= 0.7) state.impact.traffic = 'amber';
      else state.impact.traffic = 'red';
      const usd = Number(state.impact.usdPerM3) || 0;
      state.impact.opportunityUsd = state.impact.cumulativeLostM3 * usd;
      // uptime: fraction of time without critical station fail
      const fail = state.allStationsOff || state.phFailed || Object.keys(state.failedStations).length > 0;
      if (!state._uptimeSamples) state._uptimeSamples = { ok: 0, n: 0 };
      state._uptimeSamples.n += 1;
      if (!fail) state._uptimeSamples.ok += 1;
      state.impact.uptimePct = state._uptimeSamples.n
        ? (100 * state._uptimeSamples.ok) / state._uptimeSamples.n
        : 100;
    }

    function setUsdPerM3(v) {
      state.impact.usdPerM3 = Math.max(0, Number(v) || 0);
      state.impact.opportunityUsd = state.impact.cumulativeLostM3 * state.impact.usdPerM3;
      logEvent('Costo oportunidad → USD ' + state.impact.usdPerM3 + '/m³ (editable gerencia)', 'edit');
    }

    function computeStationCriticality() {
      // Kill-one-by-one ranking by m³/h lost at LC (snapshot model, non-destructive)
      const plan = dailyPlanM3h();
      const savedFail = deepClone(state.failedStations);
      const savedPumps = state.stations.map((s) => ({
        id: s.id,
        pumps: s.pumps ? s.pumps.map((p) => ({ id: p.id, online: p.online })) : null,
      }));
      const savedPh = state.phFailed;
      const savedCd = state.cdTempHead;
      const savedAll = state.allStationsOff;
      const savedFlow = state.globalFlowSetpoint;
      const ranking = [];
      const ebs = isCustom ? pumpingStations().map((x) => x.id) : ['ph', 'ac', 'cd', 'mg', 'sos', 'rt', 'ug'];
      // baseline
      state.allStationsOff = false;
      state.phFailed = false;
      state.cdTempHead = false;
      state.failedStations = {};
      for (const st of state.stations) {
        if (st.pumps) for (const p of st.pumps) p.online = true;
      }
      computeHydraulics();
      const baseLc = state.segmentFlows.lc != null ? state.segmentFlows.lc : state.lineFlow || 0;
      for (const id of ebs) {
        state.failedStations = {};
        state.phFailed = false;
        state.cdTempHead = false;
        state.allStationsOff = false;
        for (const st of state.stations) {
          if (st.pumps) for (const p of st.pumps) p.online = true;
        }
        const st = stationById(id);
        if (!st || !st.pumps) continue;
        state.failedStations[id] = true;
        for (const p of st.pumps) p.online = false;
        if (id === 'ph') {
          state.phFailed = true;
          state.cdTempHead = !!stationById('cd');
          state.cdAutonomyRemainH = state.cdAutonomyTotalH;
        }
        computeHydraulics();
        const qLc = state.segmentFlows.lc != null ? state.segmentFlows.lc : state.lineFlow || 0;
        const lost = Math.max(0, baseLc - qLc);
        ranking.push({
          id,
          name: st.shortName || st.name,
          lostM3h: lost,
          qLc,
          pctPlan: plan > 0 ? (qLc / plan) * 100 : 0,
        });
      }
      ranking.sort((a, b) => b.lostM3h - a.lostM3h);
      // restore
      state.failedStations = savedFail;
      state.phFailed = savedPh;
      state.cdTempHead = savedCd;
      state.allStationsOff = savedAll;
      state.globalFlowSetpoint = savedFlow;
      for (const sp of savedPumps) {
        const st = stationById(sp.id);
        if (!st || !sp.pumps) continue;
        for (const pp of sp.pumps) {
          const p = st.pumps.find((x) => x.id === pp.id);
          if (p) p.online = pp.online;
        }
      }
      computeHydraulics();
      state.impact.ranking = ranking;
      logEvent('Ranking criticidad estaciones actualizado (m³/h perdidos en LC)', 'ops');
      return ranking;
    }

    function runDraComparator() {
      const savedDra = state.draEnabled;
      const savedSp = state.globalFlowSetpoint;
      const savedInject = state.stations.map((s) => !!s.draInjectOn);
      const plan = dailyPlanM3h();
      function avgDisc() {
        let n = 0, s = 0;
        for (const st of pumpingStations()) {
          const p = state.pressuresOut[st.id];
          if (p != null) { s += p; n++; }
        }
        return n ? s / n : 0;
      }
      state.globalFlowSetpoint = maxFlow();
      state.draEnabled = false;
      for (const st of state.stations) st.draInjectOn = false;
      computeHydraulics();
      const qOff = state.segmentFlows.lc != null ? state.segmentFlows.lc : state.lineFlow || 0;
      const pDescOff = avgDisc();
      const energyOff = qOff * 0.12;
      state.draEnabled = true;
      for (const st of state.stations) {
        st.draInjectOn = true;
        if (!st.draInjectionLph || Number(st.draInjectionLph) <= 0) {
          st.draInjectionLph = thr().draDefaultLph != null ? thr().draDefaultLph : 6;
        }
      }
      computeHydraulics();
      const qOn = state.segmentFlows.lc != null ? state.segmentFlows.lc : state.lineFlow || 0;
      const pDescOn = avgDisc();
      const energyOn = qOn * 0.105;
      state.draEnabled = savedDra;
      state.stations.forEach((st, i) => { st.draInjectOn = savedInject[i]; });
      state.globalFlowSetpoint = savedSp;
      computeHydraulics();
      const row = {
        qLcOff: qOff,
        qLcOn: qOn,
        qOff: qOff,
        qOn: qOn,
        deltaQ: qOn - qOff,
        pDescOff,
        pDescOn,
        deltaPDesc: pDescOff - pDescOn,
        energyProxyOff: energyOff,
        energyProxyOn: energyOn,
        deltaEnergy: energyOn - energyOff,
        m3_24h_off: qOff * 24,
        m3_24h_on: qOn * 24,
        deltaM3_24h: (qOn - qOff) * 24,
        plan,
        note: 'A/B · DRA 6–10 L/h baja ΔP / sube entregabilidad · sin DRA más cerca MAOP',
      };
      state.impact.draCompare = row;
      state.draBoard.deltaQLc = row.deltaQ;
      state.draBoard.deltaPDesc = row.deltaPDesc;
      updateDraBoard();
      logEvent(
        'Comparador DRA: ΔQ_LC=' + row.deltaQ.toFixed(0) +
          ' m³/h · ΔP_desc=' + row.deltaPDesc.toFixed(1) + ' kg/cm²',
        'ops'
      );
      return row;
    }

    function applyCrisisMode(mode) {
      state.impact.crisisMode = mode;
      if (mode === 'contener') {
        // Contener / reduce rates
        state.globalFlowSetpoint = Math.min(state.globalFlowSetpoint, 350);
        state.draEnabled = false;
        for (const st of state.stations) {
          if (!st.injections) continue;
          for (const inj of st.injections) {
            inj.manualOverride = true;
            inj.manualRateM3h = Math.min(inj.manualRateM3h || inj.rateM3h || 0, 10);
          }
        }
        logEvent('Crisis (a) CONTENER — reducir caudales / inyecciones', 'scenario');
      } else if (mode === 'redistribuir') {
        // Redistribuir / CD as head
        if (state.phFailed || state.failedStations.ph || state.allStationsOff) {
          state.allStationsOff = false;
          // restore CD pumps only if were all-off
          const cd = stationById('cd');
          if (cd && cd.pumps) {
            delete state.failedStations.cd;
            for (const p of cd.pumps) p.online = true;
          }
          // keep PH failed
          state.phFailed = true;
          state.failedStations.ph = true;
          const ph = stationById('ph');
          if (ph && ph.pumps) for (const p of ph.pumps) p.online = false;
          state.cdTempHead = !!stationById('cd');
          state.cdAutonomyRemainH = state.cdAutonomyTotalH;
        } else {
          // force PH fail + CD head as strategy demo
          failStation('ph');
        }
        state.draEnabled = true;
        state.globalFlowSetpoint = Math.max(300, Math.min(450, state.globalFlowSetpoint));
        logEvent('Crisis (b) REDISTRIBUIR — CD cabecera temporal + DRA', 'scenario');
        activatePlaybook(['falla_ph']);
      } else if (mode === 'parar_seguro') {
        state.globalFlowSetpoint = 0;
        for (const st of state.stations) {
          if (st.pumps) for (const p of st.pumps) p.online = false;
          state.failedStations[st.id] = true;
        }
        state.allStationsOff = true;
        updateDuctMotionFlag();
        state.phFailed = true;
        state.cdTempHead = false;
        // isolate a few VBs
        for (const v of state.valves.slice(0, 4)) v.open = false;
        logEvent('Crisis (c) PARAR SEGURO — Q→0 · aislar VBs · notificar CILC', 'scenario');
        activatePlaybook(['falla_ph', 'falla_eb']);
      }
      computeHydraulics();
      checkAlarms();
      const qLc = state.segmentFlows.lc != null ? state.segmentFlows.lc : state.lineFlow || 0;
      const outcome = {
        mode,
        qLc,
        lostM3h: Math.max(0, dailyPlanM3h() - qLc),
        hoursToNormalize: state.impact.hoursToNormalize,
        cumulativeLostM3: state.impact.cumulativeLostM3,
      };
      state.impact.lastCrisisOutcome = outcome;
      return outcome;
    }

    // ---- v6: rampas de caudal y de arranque de estaciones ----
    function stationRampF(id) {
      const r = state.stationRamp && state.stationRamp[id];
      return r == null ? 1 : Math.max(0, Math.min(1, r));
    }
    function rampFlowTo(q) {
      const maxLine = (state.config._meta && state.config._meta.maxLineFlowM3h) || 750;
      state.flowTarget = Math.max(0, Math.min(maxLine, Number(q) || 0));
    }
    function updateRamps(simDt) {
      const meta = state.config._meta || {};
      if (state.flowTarget != null) {
        const rate = (meta.rampFlowM3hPerMin || 15) * simDt / 60;
        const d = state.flowTarget - state.globalFlowSetpoint;
        if (Math.abs(d) <= rate) { state.globalFlowSetpoint = state.flowTarget; state.flowTarget = null; }
        else state.globalFlowSetpoint += Math.sign(d) * rate;
      }
      for (const st of state.stations) {
        if (st.pDescSpTarget == null) continue;
        const r = 3 * simDt / 60; // 3 kg/cm² por minuto
        const d = st.pDescSpTarget - (st.pDescSpKgCm2 || 0);
        if (Math.abs(d) <= r) { st.pDescSpKgCm2 = st.pDescSpTarget; delete st.pDescSpTarget; }
        else st.pDescSpKgCm2 = (st.pDescSpKgCm2 || 0) + Math.sign(d) * r;
      }
      if (!state.stationRamp) state.stationRamp = {};
      if (!state._runPrev) state._runPrev = {};
      const tRamp = (meta.rampStationMin || 8) * 60;
      for (const st of state.stations) {
        if (!st.pumps || !st.pumps.length) continue;
        const run = !state.failedStations[st.id] && !(st.id === 'ph' && state.phFailed) && st.pumps.some((p) => p.online && !isBoosterRole(p.role));
        if (run && state._runPrev[st.id] === false) state.stationRamp[st.id] = 0;
        state._runPrev[st.id] = run;
        if (state.stationRamp[st.id] != null) {
          state.stationRamp[st.id] += simDt / tRamp;
          if (state.stationRamp[st.id] >= 1) delete state.stationRamp[st.id];
        }
      }
    }
    function setStationPidSp(id, v) {
      const st = stationById(id);
      if (!st) return;
      const maxP = thr().pMaxLineKgCm2 || 90;
      st.pDescSpTarget = Math.max(5, Math.min(maxP, Number(v) || 0));
      logEvent(`${st.shortName || id}: SP del PID de descarga → ${st.pDescSpTarget.toFixed(1)} kg/cm² (rampa)`, 'ops');
    }
    function pigEtas() {
      if (!state.pig || !state.pig.active) return [];
      const sorted = sortedStations().slice().sort((a, b) => (a.pkKm || 0) - (b.pkKm || 0));
      const out = [];
      let t = 0, pk = state.pig.pkKm;
      const destPk = (stationById(state.pig.toId) || {}).pkKm || lengthKm();
      for (const st of sorted) {
        if ((st.pkKm || 0) <= pk + 0.01) continue;
        if (!state.pig.auto && (st.pkKm || 0) > destPk + 0.01) break;
        const q = state.segmentFlows[st.id] || 0;
        const v = velocityKmH(q);
        if (v < 0.05 || state.pig.stuck) { out.push({ id: st.id, pk: st.pkKm, etaH: null }); pk = st.pkKm; t = Infinity; continue; }
        t += ((st.pkKm || 0) - pk) / (v * (pigTypeById(state.pig.type).speedFactor || 1));
        if (state.pig.auto && st.pigTrap && (st.pkKm || 0) > destPk + 0.01) t += 1.0;
        pk = st.pkKm;
        out.push({ id: st.id, pk: st.pkKm, etaH: isFinite(t) ? t : null, trap: !!st.pigTrap, dest: st.id === state.pig.toId });
      }
      return out;
    }

    function tick(nowMs) {
      if (!state.running) {
        state.lastTickMs = nowMs;
        return;
      }
      const rawDt = Math.min(0.25, (nowMs - state.lastTickMs) / 1000);
      state.lastTickMs = nowMs;
      const simDt = rawDt * state.speed;
      state.timeSec += simDt;
      // advance sim datetime
      state.simDate = new Date(state.simDate.getTime() + simDt * 1000);

      // water quality auto-reduce inj if OOS
      if (state.waterSlugPct >= (thr().waterSlugOosPct || 0.75)) {
        for (const st of state.stations) {
          if (!st.injections) continue;
          for (const inj of st.injections) {
            if (inj.manualOverride) {
              inj.manualRateM3h = Math.min(inj.manualRateM3h || 0, (inj.maxM3h || 50) * 0.3);
            }
          }
        }
      }

      updateRamps(simDt);
      computeHydraulics();
      updateOilFront(simDt / 3600);
      updateTanks(simDt / 3600);
      pigScheduler(simDt / 3600);
      updatePig(simDt / 3600);
      updatePhFailure(simDt / 3600);
      updateImpact(simDt / 3600);
      updateSurge(simDt);
      updateRupture(simDt / 3600);
      checkAlarms();
      updateDuctMotionFlag();
      updateDraBoard();
    }

    function updateSurge(dtSec) {
      if (state.surgeRemainSec > 0) {
        state.surgeRemainSec = Math.max(0, state.surgeRemainSec - dtSec);
        state.surgeBoostKg = state.surgeRemainSec > 0
          ? Math.max(2, state.overpressureBoost || state.surgeBoostKg || 8) * (state.surgeRemainSec / Math.max(1, state.surgeRemainSec + dtSec))
          : 0;
        if (state.surgeRemainSec <= 0) {
          state.surgeBoostKg = 0;
          state.overpressureBoost = 0;
          logEvent('Sobrepresión/surge normalizada', 'ops');
        }
      }
    }

    function updateRupture(dtHours) {
      const r = state.rupture;
      if (!r || !r.active) return;
      if (!r.isolated) {
        r.qLeakM3h = Math.max(20, 80 * (r.severity || 0.5));
        for (const k of Object.keys(state.linepack || {})) {
          const lpk = state.linepack[k];
          if (lpk && typeof lpk === 'object') lpk.m3 = Math.max(0, lpk.m3 - r.qLeakM3h * dtHours * 0.25);
        }
      } else {
        r.qLeakM3h = r.integrityOk ? 0 : Math.max(5, (r.qLeakM3h || 10) * 0.5);
      }
    }

    function startRuptureAtPk(pkKm, severity) {
      const pk = Math.max(1, Math.min(lengthKm() - 1, Number(pkKm) || 100));
      state.rupture = {
        active: true, pkKm: pk,
        severity: severity != null ? Number(severity) : 0.7,
        isolated: false, integrityOk: false, qLeakM3h: 60,
      };
      state.scenarioActive = 'fuga_rotura_pk';
      state.globalFlowSetpoint = Math.max(100, state.globalFlowSetpoint * 0.55);
      ensureEstrategiaGlobal(['fuga_rotura']);
      activatePlaybook(['fuga_rotura'], { merge: true });
      logEvent('FUGA/ROTURA en PK ' + pk.toFixed(0) + ' — P↓ local, Q_LC↓, linepack imbalance', 'scenario');
      computeHydraulics();
      checkAlarms();
      updateDuctMotionFlag();
      return state.rupture;
    }

    function isolateRuptureSegment() {
      const r = state.rupture;
      if (!r || !r.active) return false;
      r.isolated = true;
      const pk = r.pkKm;
      const vs = state.valves.slice().sort((a, b) => Math.abs((a.pkKm || 0) - pk) - Math.abs((b.pkKm || 0) - pk));
      let closed = 0;
      for (const v of vs) {
        if (closed >= 2) break;
        v.open = false;
        closed++;
        logEvent(v.name + ' CERRADA (aislar fuga PK ' + pk.toFixed(0) + ')', 'ops');
      }
      for (const st of pumpingStations()) {
        if ((st.pkKm || 0) <= pk && (st.pkKm || 0) > pk - 80) {
          for (const p of st.pumps || []) p.online = false;
          state.failedStations[st.id] = true;
        }
      }
      state.globalFlowSetpoint = 0;
      logEvent('Tramo aislado — bombas afectadas paradas · no rearrancar hasta integridad OK', 'scenario');
      ensureEstrategiaGlobal(['fuga_rotura']);
      computeHydraulics();
      updateDuctMotionFlag();
      return true;
    }

    function setRuptureIntegrityOk(ok) {
      if (!state.rupture) return;
      state.rupture.integrityOk = !!ok;
      logEvent(ok ? 'Integridad OK — habilitado rearranque controlado' : 'Integridad NO OK — rearranque bloqueado', ok ? 'ops' : 'alarm');
    }

    function setSpeed(s) {
      state.speed = s;
      logEvent('Velocidad sim → ' + s + 'x', 'ops');
    }
    function setPaused(paused) {
      state.running = !paused;
      logEvent(state.running ? 'Simulación reanudada' : 'Simulación pausada', 'ops');
    }
    function togglePause() {
      setPaused(state.running);
      return state.running;
    }
    function setFlowSetpoint(q) {
      state.globalFlowSetpoint = Math.max(0, Math.min(maxFlow(), q));
      computeHydraulics();
      updateDuctMotionFlag();
    }
    function setDra(on) {
      state.draEnabled = !!on;
      const defL = thr().draDefaultLph != null ? thr().draDefaultLph : 6;
      const maxL = thr().draMaxLph != null ? thr().draMaxLph : 10;
      if (state.draEnabled) {
        for (const st of state.stations) {
          st.draInjectOn = true;
          if (st.draInjectionLph == null || Number(st.draInjectionLph) <= 0) {
            st.draInjectionLph = defL;
          }
          st.draInjectionLph = Math.min(maxL, Math.max(0, Number(st.draInjectionLph) || defL));
        }
        logEvent(
          'DRA/polímero ON — tip. ' + defL + '–' + maxL +
            ' L/h/estación · f↓ + P_desc soft-clamp ≤' + pDescMax() + ' kg/cm²',
          'ops'
        );
      } else {
        for (const st of state.stations) st.draInjectOn = false;
        logEvent('DRA OFF (todas las estaciones)', 'ops');
      }
      computeHydraulics();
      updateDraBoard();
      try { runDraComparator(); } catch (e) {}
    }
    function setStationDraInject(stationId, on) {
      const st = stationById(stationId);
      if (!st) return;
      st.draInjectOn = !!on;
      const defL = thr().draDefaultLph != null ? thr().draDefaultLph : 6;
      if (st.draInjectOn && (!st.draInjectionLph || Number(st.draInjectionLph) <= 0)) {
        st.draInjectionLph = defL;
      }
      logEvent(
        (st.shortName || st.id) + ' DRA inyección ' + (st.draInjectOn ? 'SÍ' : 'NO') +
          (st.draInjectOn ? ' @ ' + stationDraLph(st) + ' L/h' : ''),
        'ops'
      );
      computeHydraulics();
      updateDraBoard();
    }
    function setStationDraLph(stationId, lph) {
      const st = stationById(stationId);
      if (!st) return;
      const maxL = thr().draMaxLph != null ? Number(thr().draMaxLph) : 10;
      const v = Math.max(0, Math.min(maxL, Number(lph)));
      if (Number.isNaN(v)) return;
      st.draInjectionLph = v;
      logEvent(
        (st.shortName || st.id) + ' DRA → ' + v + ' L/h · 24h=' + (v * 24).toFixed(0) + ' L' +
          (stationDraActive(st) ? '' : ' (inyección off)'),
        'ops'
      );
      computeHydraulics();
      updateDraBoard();
    }
    function setWaterSlug(pct) {
      state.waterSlugPct = Math.max(0, Math.min(5, Number(pct) || 0));
    }
    function setThreshold(key, value) {
      if (key in state.thresholds || true) {
        state.thresholds[key] = value;
        if (key === 'cdAutonomyHours') state.cdAutonomyTotalH = Number(value) || 2;
        if (key === 'lcReceiptTargetM3h') state.lcReceiptTarget = Number(value) || 800;
        if (key === 'operatorResponseDelayMin') state.operatorResponseDelayMin = Number(value) || 5;
        if (key === 'pDescMaxKgCm2') state.thresholds.pDescMaxKgCm2 = Number(value) || 85;
        if (key === 'draDefaultLph') state.thresholds.draDefaultLph = Number(value) || 10;
        logEvent('Umbral ' + key + ' → ' + value + ' (operativo / no contractual)', 'edit');
      }
    }
    function setValve(id, open) {
      const v = state.valves.find((x) => x.id === id);
      if (!v) return;
      v.open = !!open;
      logEvent(`${v.name} → ${v.open ? 'ABIERTA' : 'CERRADA (aislar)'}`, 'ops');
      computeHydraulics();
      checkAlarms();
    }

    function evaluatePumpRuleAndStrategy(st, starting) {
      if (!st || !st.pumps) return;
      const mains = mainsOnline(st);
      // v15: en un arranque las bombas se suman de a una: no se aplica la regla de N bombas (solo al parar)
      if (starting) {
        if (mains.on >= 1 && (state.failedStations[st.id] || (st.id === 'ph' && state.phFailed)) && !(state.tripCause && state.tripCause[st.id])) {
          delete state.failedStations[st.id];
          if (st.id === 'ph') { state.phFailed = false; state.cdTempHead = false; }
        }
        return;
      }
      const need = minMainsRequired(st);
      const mainsOffRule = mains.on < Math.min(need, mains.n || need);
      const allMainsOff = mains.on === 0;
      if (allMainsOff || mainsOffRule) {
        if (allMainsOff) state.failedStations[st.id] = true;
        if (st.id === 'ph' && mains.on < need) {
          state.phFailed = true;
          state.cdTempHead = true;
          state.cdAutonomyRemainH = state.cdAutonomyTotalH;
        }
        ensureEstrategiaGlobal(st.id === 'ph' ? ['falla_ph'] : ['falla_eb']);
        logEvent(
          'Estrategia global: ' + (st.shortName || st.id) +
            ' rompe regla ' + need + ' en línea (main online=' + mains.on + '/' + mains.n + ')',
          'scenario'
        );
      } else if (state.failedStations[st.id] && mains.on >= need) {
        delete state.failedStations[st.id];
        if (st.id === 'ph') {
          state.phFailed = false;
          state.cdTempHead = false;
        }
      }
    }

    function togglePump(stationId, pumpId) {
      const st = stationById(stationId);
      if (!st || !st.pumps) return;
      const p = st.pumps.find((x) => x.id === pumpId);
      if (!p) return;
      p.online = !p.online;
      logEvent(
        `${st.shortName || st.name}: ${p.name} → ${p.online ? 'EN MARCHA' : 'PARADA'}` +
          (isBoosterRole(p.role) ? ' (booster aspiración)' : ''),
        'pump'
      );
      evaluatePumpRuleAndStrategy(st, p.online);
      if (st.id === 'ph' && isBoosterRole(p.role) && !p.online) {
        const assist = suctionAssistKg(st);
        if (assist < 0.5) {
          logAlarm('PH sin boosters de aspiración — P_succión post-PIPH/UM baja → derate', 'warn');
          ensureEstrategiaGlobal([]);
        }
      }
      computeHydraulics();
      checkAlarms();
      updateDuctMotionFlag();
    }
    function setPump(stationId, pumpId, online) {
      const st = stationById(stationId);
      if (!st || !st.pumps) return;
      const p = st.pumps.find((x) => x.id === pumpId);
      if (!p) return;
      const prev = p.online;
      p.online = !!online;
      if (prev !== p.online) {
        logEvent(
          `${st.shortName || st.name}: ${p.name} → ${p.online ? 'EN MARCHA' : 'PARADA'}`,
          'pump'
        );
        evaluatePumpRuleAndStrategy(st, p.online);
        computeHydraulics();
        checkAlarms();
        updateDuctMotionFlag();
      }
    }

    function setPaThrottle(pct) {
      const pa = stationById('pa');
      if (!pa) return;
      pa.flowThrottlePct = Math.max(0, Math.min(100, Number(pct) || 0));
      logEvent('Pareditas throttle → ' + pa.flowThrottlePct + '% (regulación altimétrica)', 'ops');
      computeHydraulics();
    }

    function setInjection(stationId, rate, injectionId) {
      const st = stationById(stationId);
      if (!st) return;
      const r = Number(rate);
      if (Number.isNaN(r)) return;
      if (injectionId && st.injections && st.injections.length) {
        const inj = st.injections.find((x) => x.id === injectionId);
        if (!inj) return;
        inj.manualOverride = true;
        inj.manualRateM3h = Math.max(0, Math.min(inj.maxM3h || 200, r));
        inj.rateM3h = inj.manualRateM3h;
        return;
      }
      if (!st.injection) return;
      st.injection.rateM3h = Math.max(0, Math.min(st.injection.maxM3h || 200, r));
    }

    function setInjectionSchedule(stationId, injectionId, fields) {
      const st = stationById(stationId);
      if (!st || !st.injections) return false;
      const inj = st.injections.find((x) => x.id === injectionId);
      if (!inj) return false;
      if (!inj.schedule) inj.schedule = { enabled: true, model: 'duty_cycle' };
      const sch = inj.schedule;
      if (fields.enabled != null) sch.enabled = !!fields.enabled;
      if (fields.dutyCycle != null) {
        sch.dutyCycle = Math.max(0, Math.min(1, Number(fields.dutyCycle)));
        sch.onHours = (sch.periodHours || 24) * sch.dutyCycle;
        sch.model = 'duty_cycle';
      }
      if (fields.rateWhenOnM3h != null) sch.rateWhenOnM3h = Math.max(0, Number(fields.rateWhenOnM3h));
      if (fields.manualOverride != null) inj.manualOverride = !!fields.manualOverride;
      inj.mode = inj.mode || 'intermittent';
      logEvent(`Scheduler ${inj.name}`, 'edit');
      return true;
    }

    // v7: corridas de pig tramo a tramo entre trampas lanzadoras/receptoras, con tipos de pig
    function trapStations() {
      return sortedStations().slice().sort((a, b) => (a.pkKm || 0) - (b.pkKm || 0)).filter((x) => x.pigTrap);
    }
    function pigTypeById(id) {
      const list = state.config.pigTypes || [];
      return list.find((t) => t.id === id) || list[0] || { id: 'limpieza', name: 'Limpieza', speedFactor: 0.95, dP: 1.8, stuckRisk: 0.1 };
    }
    function launchPig(opts) {
      if (state.pig.active) return false;
      opts = opts || {};
      const traps = trapStations();
      let from = stationById(opts.from || (state.pig.status === 'received' && state.pig.atId ? state.pig.atId : 'ph'));
      if (!from || !from.pigTrap) from = traps[0];
      let idx = traps.findIndex((x) => x.id === from.id);
      if (idx >= traps.length - 1) { from = traps[0]; idx = 0; } // desde LC no hay receptora: nueva corrida desde PH
      const to = traps[idx + 1];
      if (!to) { logEvent(`No hay trampa receptora aguas abajo de ${from.shortName}`, 'pig'); return false; }
      const type = pigTypeById(opts.type || state.pig.type || 'limpieza');
      state.pig.active = true;
      state.pig.stuck = false;
      state.pig.pkKm = from.pkKm || 0;
      state.pig.status = 'in_transit';
      state.pig.launchedAt = state.timeSec;
      state.pig.lowSpeedSec = 0;
      state.pig.type = type.id;
      state.pig.typeName = type.name;
      state.pig.fromId = from.id;
      state.pig.toId = to.id;
      state.pig.atId = null;
      state.pig.auto = opts.auto != null ? !!opts.auto : !!state.pig.auto;
      state.pig.vMinMs = type.vMinMs || null;
      state.pig.vOut = 0;
      state.pig.willStick = Math.random() < (type.stuckRisk || 0) * 0.3 && (from.pkKm || 0) < peakPk() && (to.pkKm || 0) > peakPk() ? peakPk() : null;
      from.pigTrap.status = 'launched';
      to.pigTrap.status = 'awaiting';
      logEvent(`Pig ${type.name} lanzado desde ${from.shortName} hacia ${to.shortName}`, 'pig');
      activatePlaybook(['pig']);
      return true;
    }
    function pigScheduler(dtHours) {
      const p = state.pig;
      if (p.active || p.status !== 'received' || !p.auto || p.relaunchInH == null) return;
      p.relaunchInH -= dtHours;
      if (p.relaunchInH <= 0) {
        p.relaunchInH = null;
        launchPig({ from: p.atId, type: p.type, auto: true });
      }
    }

    function resetPig() {
      state.pig = {
        active: false,
        stuck: false,
        pkKm: 0,
        speedKmPerHour: 0,
        launchedAt: null,
        status: 'idle',
        dPForeAft: 0,
        etaNextHours: null,
        nextStationId: null,
        lowSpeedSec: 0,
      };
      const ph = stationById('ph');
      const lc = stationById('lc');
      if (ph && ph.pigTrap) {
        ph.pigTrap.status = 'ready';
        ph.pigTrap.occupied = false;
      }
      if (lc && lc.pigTrap) {
        lc.pigTrap.status = 'ready';
        lc.pigTrap.occupied = false;
      }
      logEvent('Pig reseteado', 'pig');
    }

    function failStation(id) {
      const st = stationById(id);
      if (!st) return;
      state.failedStations[id] = true;
      if (st.pumps) for (const p of st.pumps) p.online = false;
      if (id === 'ph') {
        state.phFailed = true;
        state.cdTempHead = !!stationById('cd') && !state.failedStations.cd;
        state.cdAutonomyRemainH = state.cdAutonomyTotalH;
        const cdS = stationById('cd');
        logEvent(
          state.cdTempHead
            ? `Falla ${st.shortName || 'PH'} / para bombeo — ${(cdS && cdS.shortName) || 'CD'} cabecera temporal hasta ${state.cdAutonomyTotalH} h (linepack/tanque)`
            : `Falla de la cabecera ${st.shortName || 'PH'}: se detiene el bombeo de la línea`,
          'scenario'
        );
        ensureEstrategiaGlobal(['falla_ph']);
      } else {
        logEvent(`Falla estación ${st.shortName || st.name}`, 'scenario');
        ensureEstrategiaGlobal(['falla_eb']);
        // rate redistrib: lower setpoint slightly
        state.globalFlowSetpoint = Math.max(200, state.globalFlowSetpoint * 0.85);
      }
      computeHydraulics();
      checkAlarms();
    }

    function clearStationFail(id) {
      delete state.failedStations[id];
      delete state.tripFlags[id];
      if (state.tripCause) delete state.tripCause[id];
      const st = stationById(id);
      if (st && st.pumps) for (const p of st.pumps) p.online = true;
      if (id === 'ph') {
        state.phFailed = false;
        state.cdTempHead = false;
        state.cdAutonomyRemainH = state.cdAutonomyTotalH;
      }
    }


    function apagarTodasEstaciones() {
      state.allStationsOff = true;
      state.phFailed = true;
      state.cdTempHead = false; // no CD cabecera si CD también off
      state.cdAutonomyRemainH = 0;
      for (const st of state.stations) {
        if (st.pumps && st.pumps.length) {
          state.failedStations[st.id] = true;
          for (const p of st.pumps) p.online = false;
        }
      }
      state.globalFlowSetpoint = 0;
      // Pig freezes / stuck risk
      if (state.pig.active) {
        state.pig.speedKmPerHour = 0;
        state.pig.lowSpeedSec = Math.max(state.pig.lowSpeedSec, (thr().pigStuckMinutes || 15) * 60 * 0.5);
        logEvent('Pig congelado / riesgo stuck — caudal → 0', 'alarm');
      }
      ensureEstrategiaGlobal(['falla_ph', 'falla_eb']);
      // Extra playbook steps for full cascade
      const extra = [
        'Cascada total: todas las EB apagadas',
        'Presiones → hidrostática / linepack solamente',
        'Caudal línea → 0',
        'Opcional: aislar VBs',
        'Notificar CILC (prioridad máxima)',
        'NO activar CD cabecera (CD también off)',
        'Evaluar pig: freeze / stuck',
      ];
      for (const s of extra) {
        const id = 'cascada_total::' + s;
        if (!state.playbookActive.find((x) => x.id === id)) {
          state.playbookActive.push({ id, group: 'cascada_total', text: s, done: !!state.playbookChecks[id] });
        }
      }
      logEvent('APAGAR TODAS LAS ESTACIONES — cascada total (demo gerencia)', 'scenario');
      computeHydraulics();
      checkAlarms();
    }

    function restablecerTodasEstaciones() {
      state.allStationsOff = false;
      state.phFailed = false;
      state.cdTempHead = false;
      state.cdAutonomyRemainH = state.cdAutonomyTotalH;
      state.failedStations = {};
      state.tripFlags = {};
      state.coldStart = false;
      state.scenarioActive = null;
      state.overpressureBoost = 0;
      state.playbookActive = [];
      state.rupture = { active: false, pkKm: null, severity: 0, isolated: false, integrityOk: false, qLeakM3h: 0 };
      state.surgeBoostKg = 0;
      state.surgeRemainSec = 0;
      state.aspAlarmStations = {};
      // v15: el reinicio deja todas las bombas paradas; el operador elige cuáles arrancar
      for (const st of state.stations) {
        if (!st.pumps) continue;
        for (const p of st.pumps) p.online = false;
      }
      const meta = state.config._meta || {};
      state.globalFlowSetpoint = state.startupQ != null ? state.startupQ : Math.max(150, Math.round((meta.defaultPhCabeceraM3h || 650) * 0.4 / 10) * 10);
      state.flowTarget = null;
      if (state.tripCause) state.tripCause = {};
      if (state.pig.stuck) {
        state.pig.stuck = false;
        state.pig.lowSpeedSec = 0;
        if (state.pig.status === 'stuck') state.pig.status = 'in_transit';
      }
      state.impact.cumulativeLostM3 = 0;
      state.impact.lostM3h = 0;
      state.impact.opportunityUsd = 0;
      state.impact.crisisMode = null;
      state.failureStartedAt = null;
      state.impact.traffic = 'green';
      for (const v of state.valves) v.open = true;
      logEvent('RESTABLECER TODAS LAS ESTACIONES — operación normal', 'scenario');
      computeHydraulics();
      updateImpact(0);
      checkAlarms();
    }

    function applyScenario(name) {
      state.scenarioActive = name;
      state.overpressureBoost = 0;

      if (name === 'falla_ph' || name === 'parada_ph') {
        failStation('ph');
      } else if (name === 'falla_ac' || name === 'falla_cd' || name === 'falla_mg' || name === 'falla_sos' || name === 'falla_rt' || name === 'falla_ug') {
        const id = name.replace('falla_', '');
        failStation(id);
      } else if (name === 'parada_malargue') {
        failStation('mg');
      } else if (name === 'eb_down_redistrib') {
        failStation('sos');
        state.globalFlowSetpoint = Math.max(250, state.globalFlowSetpoint * 0.75);
        logEvent('1 EB down + redistribución de caudal', 'scenario');
        activatePlaybook(['falla_eb']);
      } else if (name === 'cold_start') {
        state.coldStart = true;
        state.globalFlowSetpoint = Math.min(state.globalFlowSetpoint, 280);
        logEvent('Arranque en frío — Q limitado', 'scenario');
      } else if (name === 'sobrepresion' || name === 'sobrepresion_surge') {
        state.overpressureBoost = 12;
        state.surgeBoostKg = 12;
        state.surgeRemainSec = 90;
        state.globalFlowSetpoint = Math.max(0, state.globalFlowSetpoint * 0.3);
        activatePlaybook(['sobrepresion_surge'], { merge: true });
        ensureEstrategiaGlobal(['sobrepresion_surge']);
        logEvent('Sobrepresión post-parada (surge) — soft stop / esperar normalización P', 'scenario');
      } else if (name === 'pig_run') {
        if (!state.pig.active) launchPig();
        logEvent('Escenario: Pig run', 'scenario');
      } else if (name === 'pig_stuck' || name === 'pig_stuck_peak') {
        if (!state.pig.active) launchPig();
        state.pig.pkKm = Math.min(peakPk(), lengthKm() - 1);
        state.pig.stuck = true;
        state.pig.status = 'stuck';
        state.pig.speedKmPerHour = 0;
        state.pig.dPForeAft = 18;
        state.pig.lowSpeedSec = (thr().pigStuckMinutes || 15) * 60;
        state.globalFlowSetpoint = Math.max(120, state.globalFlowSetpoint * 0.55);
        activatePlaybook(['pig', 'pig_stuck_peak'], { merge: true });
        ensureEstrategiaGlobal(['pig_stuck_peak']);
        logEvent('Pig STUCK ~PK' + Math.round(peakPk()) + ' (punto alto) — v≈0 · ΔP detrás↑ · Q↓ · empuje controlado / vigilar MAOP', 'scenario');
      } else if (name === 'fuga_rotura_pk' || name === 'fuga_rotura') {
        const pk = state._pendingRupturePk != null ? state._pendingRupturePk : 120;
        startRuptureAtPk(pk, 0.75);
        state._pendingRupturePk = null;
      } else if (name === 'perdida_electrica_eb' || name === 'perdida_electrica') {
        const eid = state._pendingElectricEb || 'sos';
        const st = stationById(eid);
        if (st) {
          state.failedStations[eid] = true;
          if (st.pumps) for (const p of st.pumps) p.online = false;
          if (eid === 'ph') {
            state.phFailed = true;
            state.cdTempHead = true;
            state.cdAutonomyRemainH = state.cdAutonomyTotalH;
            activatePlaybook(['falla_ph', 'perdida_electrica'], { merge: true });
          } else {
            activatePlaybook(['perdida_electrica', 'falla_eb'], { merge: true });
            state.globalFlowSetpoint = Math.max(200, state.globalFlowSetpoint * 0.7);
          }
          ensureEstrategiaGlobal(eid === 'ph' ? ['falla_ph'] : ['falla_eb']);
          logEvent('Pérdida eléctrica ' + (st.shortName || eid) + ' — P_desc→0 · redistribuir / limitar Q', 'scenario');
        }
        state._pendingElectricEb = null;
      } else if (name === 'falla_ph_cd_cabecera' || name === 'cd_inj_limit') {
        state.phFailed = true;
        state.cdTempHead = !!stationById('cd');
        state.cdAutonomyRemainH = state.cdAutonomyTotalH;
        state.failedStations.ph = true;
        const ph = stationById('ph');
        if (ph && ph.pumps) for (const p of ph.pumps) p.online = false;
        const cd = stationById('cd');
        if (cd && cd.pumps) {
          let on = 0;
          for (const p of cd.pumps) {
            if (isBoosterRole(p.role)) continue;
            p.online = on < 3;
            on++;
          }
        }
        state.globalFlowSetpoint = Math.max(280, Math.min(400, state.globalFlowSetpoint));
        activatePlaybook(['falla_ph'], { merge: true });
        ensureEstrategiaGlobal(['falla_ph']);
        logEvent('Falla PH + CD cabecera temporal ' + state.cdAutonomyTotalH + ' h — reloj autonomía + Q mín hacia LC', 'scenario');
      } else if (name === null || name === 'clear') {
        state.scenarioActive = null;
        state.overpressureBoost = 0;
        state.surgeBoostKg = 0;
        state.surgeRemainSec = 0;
        state.coldStart = false;
        state.phFailed = false;
        state.cdTempHead = false;
        state.cdAutonomyRemainH = state.cdAutonomyTotalH;
        state.failedStations = {};
        state.tripFlags = {};
        state.aspAlarmStations = {};
        state.allStationsOff = false;
        state.playbookActive = [];
        state.rupture = { active: false, pkKm: null, severity: 0, isolated: false, integrityOk: false, qLeakM3h: 0 };
        for (const st of state.stations) {
          if (!st.pumps) continue;
          for (const p of st.pumps) {
            if (p.reserve) p.online = false;
            else p.online = true;
          }
        }
        for (const v of state.valves) v.open = true;
        if (state.pig.stuck) {
          state.pig.stuck = false;
          state.pig.status = 'in_transit';
        }
        logEvent('Escenario limpiado', 'scenario');
      }
      computeHydraulics();
      checkAlarms();
      updateDuctMotionFlag();
    }

    function selectStation(id) {
      state.selectedStationId = id;
    }

    function updateStationMeta(stationId, fields) {
      const st = stationById(stationId);
      if (!st) return false;
      if (fields.name != null) st.name = String(fields.name).trim() || st.name;
      if (fields.shortName != null) st.shortName = String(fields.shortName).trim() || st.shortName;
      if (fields.pkKm != null) {
        const pk = Number(fields.pkKm);
        if (!Number.isNaN(pk) && pk >= 0) {
          st.pkKm = pk;
          st.pkIsPlaceholder = false;
        }
      }
      if (fields.elevationMsnm != null) {
        const e = Number(fields.elevationMsnm);
        if (!Number.isNaN(e)) st.elevationMsnm = e;
      }
      if (fields.pAspMinKgCm2 != null) st.pAspMinKgCm2 = Number(fields.pAspMinKgCm2);
      if (fields.qMinM3h != null) st.qMinM3h = Number(fields.qMinM3h);
      if (fields.qMaxM3h != null) st.qMaxM3h = Number(fields.qMaxM3h);
      if (fields.injectionRate != null && st.injection) setInjection(stationId, Number(fields.injectionRate));
      if (st.id === 'lc' && fields.pkKm != null) state.config._meta.lengthKm = st.pkKm;
      computeHydraulics();
      checkAlarms();
      logEvent(`Estación editada: ${st.shortName || st.name}`, 'edit');
      return true;
    }

    function updateSegmentMaop(segId, maop) {
      const seg = (state.config.segments || []).find((s) => s.id === segId);
      if (!seg) return false;
      seg.maopKgCm2 = Number(maop);
      logEvent(`MAOP ${segId} → ${maop} (operativo / no contractual)`, 'edit');
      checkAlarms();
      return true;
    }

    function persistStationsOverride() {
      try {
        const payload = {
          _meta: {
            lengthKm: state.config._meta.lengthKm,
            maxFlowM3h: state.config._meta.maxFlowM3h,
          },
          thresholds: state.thresholds,
          draEnabled: state.draEnabled,
          waterSlugPct: state.waterSlugPct,
          segments: (state.config.segments || []).map((s) => ({
            id: s.id,
            maopKgCm2: s.maopKgCm2,
            qMaxM3h: s.qMaxM3h,
            qMaxDraM3h: s.qMaxDraM3h,
            linepackM3: s.linepackM3,
          })),
          valves: state.valves.map((v) => ({ id: v.id, open: v.open })),
          stations: state.stations.map((s) => ({
            id: s.id,
            name: s.name,
            shortName: s.shortName,
            pkKm: s.pkKm,
            pkIsPlaceholder: !!s.pkIsPlaceholder,
            elevationMsnm: s.elevationMsnm,
            pAspMinKgCm2: s.pAspMinKgCm2,
            draInjectionLph: s.draInjectionLph,
            qMinM3h: s.qMinM3h,
            qMaxM3h: s.qMaxM3h,
            injectionRate: s.injection ? s.injection.rateM3h : null,
            injections: s.injections
              ? s.injections.map((inj) => ({
                  id: inj.id,
                  rateM3h: inj.rateM3h,
                  enabled: inj.enabled,
                  manualOverride: inj.manualOverride,
                  manualRateM3h: inj.manualRateM3h,
                  schedule: inj.schedule
                    ? {
                        enabled: inj.schedule.enabled,
                        dutyCycle: inj.schedule.dutyCycle,
                        rateWhenOnM3h: inj.schedule.rateWhenOnM3h,
                        periodHours: inj.schedule.periodHours,
                        onHours: inj.schedule.onHours,
                      }
                    : null,
                }))
              : null,
          })),
        };
        localStorage.setItem(lsKey, JSON.stringify(payload));
        logEvent('Override guardado (v8)', 'edit');
        return true;
      } catch (e) {
        return false;
      }
    }

    function applyStationsOverride(payload) {
      if (!payload) return false;
      if (payload.thresholds) Object.assign(state.thresholds, payload.thresholds);
      if (payload.draEnabled != null) state.draEnabled = !!payload.draEnabled;
      if (payload.waterSlugPct != null) state.waterSlugPct = Number(payload.waterSlugPct);
      if (payload._meta) {
        if (payload._meta.lengthKm != null) state.config._meta.lengthKm = payload._meta.lengthKm;
        if (payload._meta.maxFlowM3h != null) state.config._meta.maxFlowM3h = payload._meta.maxFlowM3h;
      }
      if (payload.segments && state.config.segments) {
        for (const os of payload.segments) {
          const seg = state.config.segments.find((s) => s.id === os.id);
          if (!seg) continue;
          if (os.maopKgCm2 != null) seg.maopKgCm2 = os.maopKgCm2;
          if (os.qMaxM3h != null) seg.qMaxM3h = os.qMaxM3h;
          if (os.qMaxDraM3h != null) seg.qMaxDraM3h = os.qMaxDraM3h;
          if (os.linepackM3 != null) seg.linepackM3 = os.linepackM3;
        }
      }
      if (payload.valves) {
        for (const ov of payload.valves) {
          const v = state.valves.find((x) => x.id === ov.id);
          if (v && ov.open != null) v.open = !!ov.open;
        }
      }
      if (payload.stations) {
        for (const ov of payload.stations) {
          const st = stationById(ov.id);
          if (!st) continue;
          if (ov.name != null) st.name = ov.name;
          if (ov.shortName != null) st.shortName = ov.shortName;
          if (ov.pkKm != null) st.pkKm = ov.pkKm;
          if (ov.pkIsPlaceholder != null) st.pkIsPlaceholder = !!ov.pkIsPlaceholder;
          if (ov.elevationMsnm != null) st.elevationMsnm = ov.elevationMsnm;
          if (ov.pAspMinKgCm2 != null) st.pAspMinKgCm2 = ov.pAspMinKgCm2;
          if (ov.draInjectionLph != null) st.draInjectionLph = ov.draInjectionLph;
          if (ov.qMinM3h != null) st.qMinM3h = ov.qMinM3h;
          if (ov.qMaxM3h != null) st.qMaxM3h = ov.qMaxM3h;
          if (ov.injectionRate != null && st.injection) st.injection.rateM3h = ov.injectionRate;
          if (ov.injections && st.injections) {
            for (const oi of ov.injections) {
              const inj = st.injections.find((x) => x.id === oi.id);
              if (!inj) continue;
              if (oi.rateM3h != null) inj.rateM3h = oi.rateM3h;
              if (oi.enabled != null) inj.enabled = oi.enabled;
              if (oi.manualOverride != null) inj.manualOverride = oi.manualOverride;
              if (oi.manualRateM3h != null) inj.manualRateM3h = oi.manualRateM3h;
              if (oi.schedule && inj.schedule) Object.assign(inj.schedule, oi.schedule);
            }
          }
        }
      }
      computeHydraulics();
      checkAlarms();
      return true;
    }

    function loadStationsOverride() {
      try {
        const raw = localStorage.getItem(lsKey);
        if (!raw) return false;
        return applyStationsOverride(JSON.parse(raw));
      } catch (e) {
        return false;
      }
    }

    function resetStationsToJson(baseConfig) {
      try {
        localStorage.removeItem(lsKey);
      } catch (e) {
        /* ignore */
      }
      const fresh = deepClone(baseConfig || state.config);
      state.config = deepClone(fresh);
      state.stations = deepClone(fresh.stations);
      state.thresholds = deepClone(fresh.thresholds || {});
      state.valves = deepClone(fresh.valves || []);
      state.draEnabled = false;
      state.waterSlugPct = 0.2;
      computeHydraulics();
      checkAlarms();
      logEvent('Estaciones reseteadas a JSON base v3', 'edit');
    }

    function getAltimetrySeries() {
      const poly = altimetry();
      const sorted = sortedStations();
      if (poly.length) {
        // densify with HGL at stations
        return poly.map((p) => {
          let hgl = p.elevMsnm;
          let pressure = 0;
          // interpolate pressure/hgl from stations
          for (let i = 0; i < sorted.length - 1; i++) {
            const a = sorted[i];
            const b = sorted[i + 1];
            if (p.pkKm >= a.pkKm && p.pkKm <= b.pkKm) {
              const t = (p.pkKm - a.pkKm) / (b.pkKm - a.pkKm || 1);
              const ha = state.hgl[a.id] != null ? state.hgl[a.id] : a.elevationMsnm;
              const hb = state.hgl[b.id] != null ? state.hgl[b.id] : b.elevationMsnm;
              hgl = ha + t * (hb - ha);
              const pa = state.pressuresOut[a.id] != null ? state.pressuresOut[a.id] : 0;
              const pb = state.pressuresIn[b.id] != null ? state.pressuresIn[b.id] : 0;
              pressure = pa + t * (pb - pa);
              break;
            }
          }
          const stMatch = sorted.find((s) => Math.abs(s.pkKm - p.pkKm) < 0.2);
          return {
            id: stMatch ? stMatch.id : 'p' + p.pkKm,
            name: p.label || (stMatch ? stMatch.shortName : ''),
            pkKm: p.pkKm,
            elev: p.elevMsnm,
            hgl,
            pressure,
            pkIsPlaceholder: stMatch ? !!stMatch.pkIsPlaceholder : !!p.profileOnly,
            profileOnly: !!p.profileOnly,
          };
        });
      }
      return sorted.map((st) => ({
        id: st.id,
        name: st.shortName || st.name,
        pkKm: st.pkKm,
        elev: st.elevationMsnm,
        hgl: state.hgl[st.id] != null ? state.hgl[st.id] : st.elevationMsnm,
        pressure: state.pressures[st.id] != null ? state.pressures[st.id] : 0,
        pkIsPlaceholder: !!st.pkIsPlaceholder,
      }));
    }

    function formatSimTime() {
      const t = Math.floor(state.timeSec);
      const h = Math.floor(t / 3600);
      const m = Math.floor((t % 3600) / 60);
      const s = t % 60;
      return (
        String(h).padStart(2, '0') +
        ':' +
        String(m).padStart(2, '0') +
        ':' +
        String(s).padStart(2, '0')
      );
    }

    function formatSimDateTime() {
      try {
        return state.simDate.toLocaleString('es-AR', {
          timeZone: 'America/Buenos_Aires',
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hour12: false,
        });
      } catch (e) {
        return formatSimTime();
      }
    }

    function hourOfDayProgress() {
      try {
        const h = state.simDate.getHours() + state.simDate.getMinutes() / 60;
        return { hour: h, pct: (h / 24) * 100 };
      } catch (e) {
        const h = (state.timeSec / 3600) % 24;
        return { hour: h, pct: (h / 24) * 100 };
      }
    }

    computeHydraulics();
    state.oilFrontPkKm = lengthKm();
    updateOilFront(0);
    checkAlarms();
    

    return {
      state,
      tick,
      setSpeed,
      setPaused,
      togglePause,
      setFlowSetpoint,
      rampFlowTo,
      setStationPidSp,
      pigEtas,
      trapStations,
      pigTypeById,
      stationRampF,
      setDra,
      setStationDraLph,
      setStationDraInject,
      stationDraLph,
      stationDraActive,
      draConsumption24h,
      updateDraBoard,
      pDescMax,
      setPaThrottle,
      cascadeReachability,
      isDuctMotionRunning,
      updateDuctMotionFlag,
      minMainsRequired,
      mainsOnline,
      startRuptureAtPk,
      isolateRuptureSegment,
      setRuptureIntegrityOk,
      suctionAssistKg,
      setWaterSlug,
      setThreshold,
      setValve,
      togglePump,
      setPump,
      setInjection,
      setInjectionSchedule,
      launchPig,
      resetPig,
      applyScenario,
      failStation,
      clearStationFail,
      apagarTodasEstaciones,
      restablecerTodasEstaciones,
      setUsdPerM3,
      computeStationCriticality,
      runDraComparator,
      applyCrisisMode,
      updateImpact,
      dailyPlanM3h,
      selectStation,
      updateStationMeta,
      updateSegmentMaop,
      persistStationsOverride,
      loadStationsOverride,
      resetStationsToJson,
      getAltimetrySeries,
      formatSimTime,
      formatSimDateTime,
      hourOfDayProgress,
      stationById,
      sortedStations,
      stationInjectionTotal,
      injectionInstantRate,
      computeHydraulics,
      frictionLossKg,
      elevLossKg,
      velocityKmH,
      activatePlaybook,
      togglePlaybookCheck,
      maxFlow,
      lengthKm,
      logEvent,
      clearAlarmLog,
      clearEventLog,
      LS_KEY,
    };
  }

  global.PHLDC = { createSim, LS_KEY };
})(typeof window !== 'undefined' ? window : globalThis);
