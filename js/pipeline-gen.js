/* Oleoducto Beta · Constructor de ductos a medida.
   Tablas de caño (ASME B36.10), cálculo de MAOP (Barlow + clase ANSI B16.5), hidráulica de diseño
   (Darcy-Weisbach + Swamee-Jain), propuesta automática de estaciones, bombas, válvulas y trampas,
   y generación de la configuración que usa el motor del simulador. */
(function (global) {
  'use strict';

  // ---------- tablas ----------
  const NPS = {
    6: { od: 168.3, w: { '40 / STD': 7.11, '80 / XS': 10.97, '120': 14.27, '160': 18.26 } },
    8: { od: 219.1, w: { '20': 6.35, '30': 7.04, '40 / STD': 8.18, '60': 10.31, '80 / XS': 12.7, '100': 15.09, '120': 18.26 } },
    10: { od: 273.1, w: { '20': 6.35, '30': 7.8, '40 / STD': 9.27, '60 / XS': 12.7, '80': 15.09, '100': 18.26 } },
    12: { od: 323.9, w: { '20': 6.35, '30': 8.38, 'STD': 9.53, '40': 10.31, 'XS': 12.7, '60': 14.27, '80': 17.48 } },
    14: { od: 355.6, w: { '10': 6.35, '20': 7.92, '30 / STD': 9.53, '40': 11.13, 'XS': 12.7, '60': 15.09, '80': 19.05 } },
    16: { od: 406.4, w: { '10': 6.35, '20': 7.92, '30 / STD': 9.53, '40 / XS': 12.7, '60': 16.66, '80': 21.44 } },
    18: { od: 457.2, w: { '10': 6.35, '20': 7.92, 'STD': 9.53, '30': 11.13, 'XS': 12.7, '40': 14.27, '60': 19.05, '80': 23.83 } },
    20: { od: 508.0, w: { '10': 6.35, '20 / STD': 9.53, '30 / XS': 12.7, '40': 15.09, '60': 20.62, '80': 26.19 } },
    22: { od: 558.8, w: { '10': 6.35, '20 / STD': 9.53, '30 / XS': 12.7 } },
    24: { od: 609.6, w: { '10': 6.35, '20 / STD': 9.53, 'XS': 12.7, '30': 14.27, '40': 17.48, '60': 24.61, '80': 30.96 } },
    26: { od: 660.4, w: { '10': 7.92, 'STD': 9.53, '20 / XS': 12.7 } },
    30: { od: 762.0, w: { '10': 7.92, 'STD': 9.53, '20 / XS': 12.7, '30': 15.88 } },
    36: { od: 914.4, w: { '10': 7.92, 'STD': 9.53, '20 / XS': 12.7, '30': 15.88, '40': 19.05 } },
    42: { od: 1066.8, w: { 'STD': 9.53, '20 / XS': 12.7, '30': 15.88 } },
  };
  // SMYS en MPa (API 5L)
  const GRADES = { B: 241, X42: 290, X46: 317, X52: 359, X56: 386, X60: 414, X65: 448, X70: 483, X80: 552 };
  // Presión máxima de bridas ASME B16.5 (grupo 1.1, acero al carbono, hasta 38 °C), en bar
  const ANSI = { 150: 19.6, 300: 51.1, 400: 68.1, 600: 102.1, 900: 153.2, 1500: 255.3, 2500: 425.5 };
  const BAR_TO_KG = 1 / 0.980665;
  const G = 9.81;
  const PA_PER_KG = 1e5; // mismo criterio que el motor

  const DRIVES = { directa: 'Motor eléctrico directo', variador: 'Motor con variador', turbina: 'Turbina a gas', diesel: 'Motor diésel' };
  const KINDS = { cabecera: 'Cabecera', bombeo: 'Estación de bombeo', reductora: 'Reductora de presión', inyeccion: 'Nodo de inyección', terminal: 'Terminal' };
  const DEST = { refineria: 'Refinería', parque: 'Parque de tanques', puerto: 'Puerto de carga' };

  // ---------- utilidades ----------
  const R = 6371.0088;
  function hav(a, b) {
    const t = Math.PI / 180;
    const dLat = (b[0] - a[0]) * t, dLon = (b[1] - a[1]) * t;
    const s = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * t) * Math.cos(b[0] * t) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
  }
  function routeLength(route) {
    let L = 0;
    for (let i = 1; i < route.length; i++) L += hav(route[i - 1], route[i]);
    return L;
  }
  /** Punto (lat, lon) a una progresiva pk (km) sobre la poligonal. */
  function pointAt(route, pk) {
    if (!route.length) return [0, 0];
    let acc = 0;
    for (let i = 1; i < route.length; i++) {
      const d = hav(route[i - 1], route[i]);
      if (acc + d >= pk || i === route.length - 1) {
        const f = d > 0 ? Math.max(0, Math.min(1, (pk - acc) / d)) : 0;
        return [route[i - 1][0] + (route[i][0] - route[i - 1][0]) * f, route[i - 1][1] + (route[i][1] - route[i - 1][1]) * f];
      }
      acc += d;
    }
    return route[route.length - 1].slice();
  }
  /** Puntos equiespaciados para pedir altimetría. */
  function samplePoints(route, stepKm) {
    const L = routeLength(route);
    const n = Math.max(2, Math.ceil(L / stepKm) + 1);
    const out = [];
    for (let i = 0; i < n; i++) {
      const pk = Math.min(L, (i * L) / (n - 1));
      const p = pointAt(route, pk);
      out.push({ pk: +pk.toFixed(3), lat: +p[0].toFixed(6), lon: +p[1].toFixed(6) });
    }
    return out;
  }
  function elevAt(profile, pk) {
    if (!profile || !profile.length) return 0;
    if (pk <= profile[0].pk) return profile[0].elev;
    for (let i = 1; i < profile.length; i++) {
      if (pk <= profile[i].pk) {
        const a = profile[i - 1], b = profile[i];
        const f = (pk - a.pk) / Math.max(1e-9, b.pk - a.pk);
        return a.elev + (b.elev - a.elev) * f;
      }
    }
    return profile[profile.length - 1].elev;
  }
  /** Reduce la polilínea conservando picos y valles (Douglas-Peucker en el plano PK–cota). */
  function simplifyProfile(profile, tolM, maxPts) {
    if (profile.length <= 3) return profile.slice();
    const keep = new Uint8Array(profile.length);
    keep[0] = keep[profile.length - 1] = 1;
    const stack = [[0, profile.length - 1]];
    while (stack.length) {
      const [a, b] = stack.pop();
      let worst = -1, wi = -1;
      for (let i = a + 1; i < b; i++) {
        const f = (profile[i].pk - profile[a].pk) / Math.max(1e-9, profile[b].pk - profile[a].pk);
        const e = profile[a].elev + (profile[b].elev - profile[a].elev) * f;
        const d = Math.abs(profile[i].elev - e);
        if (d > worst) { worst = d; wi = i; }
      }
      if (worst > tolM && wi > 0) { keep[wi] = 1; stack.push([a, wi], [wi, b]); }
    }
    let out = profile.filter((_, i) => keep[i]);
    if (maxPts && out.length > maxPts) return simplifyProfile(profile, tolM * 1.6, maxPts);
    return out;
  }

  // ---------- caño ----------
  function pipeCalc(pipe) {
    const nps = NPS[pipe.nps];
    const od = nps && !pipe.customOd ? nps.od : Number(pipe.odMm) || 406.4;
    const t = Number(pipe.wallMm) || 9.53;
    const smys = GRADES[pipe.grade] || Number(pipe.smysMPa) || 359;
    const F = Number(pipe.designFactor) || 0.72;
    const E = Number(pipe.jointFactor) || 1;
    const barlowMPa = (2 * smys * t * F * E) / od;
    const barlowKg = barlowMPa * 10.1972;
    const flangeKg = (ANSI[pipe.ansiClass] || ANSI[600]) * BAR_TO_KG;
    const maop = Math.floor(Math.min(barlowKg, flangeKg) * 10) / 10;
    const idMm = od - 2 * t;
    return { od, t, idMm, idM: idMm / 1000, smys, barlowKg, flangeKg, maop, limitedBy: barlowKg < flangeKg ? 'caño (Barlow)' : 'bridas (clase ' + pipe.ansiClass + ')' };
  }
  function frictionF(Qm3h, idM, viscCst, roughMm) {
    const A = Math.PI * idM * idM / 4;
    const v = Qm3h / 3600 / A;
    const nu = Math.max(0.5, Number(viscCst) || 10) * 1e-6;
    const Re = Math.max(1, (v * idM) / nu);
    if (Re < 2300) return { f: 64 / Re, Re, v };
    const eps = (Number(roughMm) || 0.045) / 1000;
    const f = 0.25 / Math.pow(Math.log10(eps / (3.7 * idM) + 5.74 / Math.pow(Re, 0.9)), 2);
    return { f, Re, v };
  }
  function hyd(spec) {
    const pc = pipeCalc(spec.pipe);
    const rho = Number(spec.fluid.densityKgM3) || 860;
    const fr = frictionF(spec.ops.qDesignM3h, pc.idM, spec.fluid.viscCst, spec.pipe.roughnessMm);
    const calib = Number(spec.pipe.calib) || 1;
    const draMul = spec.ops.draEnabled ? 1 - (Number(spec.ops.draReduction) || 0.35) * Math.min(1, (Number(spec.ops.draLph) || 0) / 10) : 1;
    const f = fr.f * calib;
    const A = Math.PI * pc.idM * pc.idM / 4;
    const kgPerKm = (Q) => {
      const v = Q / 3600 / A;
      return (f * draMul * (1000 / pc.idM) * (rho * v * v / 2)) / PA_PER_KG;
    };
    const kgPerM = (rho * G) / PA_PER_KG; // presión por metro de desnivel
    return { pc, rho, f, fBase: fr.f, Re: fr.Re, v: fr.v, draMul, A, kgPerKm, kgPerM };
  }

  // ---------- propuesta automática ----------
  function opLimit(spec) {
    const pc = pipeCalc(spec.pipe);
    const lim = Number(spec.pipe.opMaxKg);
    return Math.min(pc.maop, lim > 0 ? lim : Math.floor(pc.maop * 0.9));
  }
  /** Recorre el perfil a caudal de diseño y propone estaciones de bombeo y reductoras. */
  function autoStations(spec) {
    const H = hyd(spec);
    const prof = spec.profile;
    const L = spec.lengthKm;
    const pDisc = opLimit(spec) * 0.97;
    const pAsp = Number(spec.ops.pAspSpKg) || 5;
    const pArr = Number(spec.ops.pArrivalKg) || 8;
    const maop = H.pc.maop;
    const injs = (spec.stations || []).filter((x) => x.injection && Number(x.injection.rate) > 0).map((x) => ({ pk: x.pk, q: Number(x.injection.rate) }));
    const gradAt = (pk) => H.kgPerKm((Number(spec.ops.qDesignM3h) || 0) + injs.filter((j) => j.pk <= pk).reduce((a, j) => a + j.q, 0));
    const grad = gradAt(0);
    const step = Math.max(0.1, Math.min(0.5, L / 2000));
    const found = [];
    const warn = [];
    let P = pDisc, pk = 0, lastSt = 0;
    while (pk < L - 1e-6) {
      const pk2 = Math.min(L, pk + step);
      const dz = elevAt(prof, pk2) - elevAt(prof, pk);
      const P2 = P - gradAt(pk) * (pk2 - pk) - H.kgPerM * dz;
      const tgt = pAsp + 0.5;
      if (P2 < tgt) {
        if (pk - lastSt < step * 2) {
          warn.push(`Cerca del PK ${pk.toFixed(1)} la pendiente supera lo que puede dar una estación: aumentá el diámetro, el espesor o el límite de operación.`);
          P = pDisc; pk = pk2; lastSt = pk; continue;
        }
        found.push({ kind: 'bombeo', pk: +pk.toFixed(1) });
        lastSt = pk;
        P = pDisc;
        continue;
      }
      if (P2 > maop * 0.97) {
        found.push({ kind: 'reductora', pk: +pk2.toFixed(1), sp: +(Math.max(pAsp + 10, pDisc * 0.55)).toFixed(1) });
        P = Math.max(pAsp + 10, pDisc * 0.55);
        pk = pk2; lastSt = pk;
        continue;
      }
      P = P2; pk = pk2;
    }
    if (P < pArr) warn.push(`Con la cabecera al límite, la llegada a la terminal queda en ${P.toFixed(1)} kg/cm² (objetivo ${pArr}). Bajá el caudal de diseño o agregá una estación cerca del final.`);
    return { stations: found, warnings: warn, arrivalKg: P, gradKgKm: grad };
  }
  /** Bombas en serie para levantar dP kg/cm². */
  function sizePumps(dP, maxHeadKg, drive) {
    const maxH = Math.max(10, Number(maxHeadKg) || 40);
    const online = Math.max(1, Math.ceil((dP * 1.08) / maxH));
    const head = +((dP * 1.12) / online).toFixed(1);
    return { mains: online + 1, online, headKg: head, drive: drive || 'directa', boosters: 0, boostersOnline: 0, boosterKg: 5 };
  }
  let uidN = 0;
  const uid = () => 's' + Date.now().toString(36) + (uidN++).toString(36);
  function letters(n) { let s = ''; n += 1; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; }
  function newStation(kind, pk, k) {
    const nm = kind === 'cabecera' ? 'Cabecera' : kind === 'terminal' ? 'Terminal' : kind === 'reductora' ? 'Reductora ' + k : kind === 'inyeccion' ? 'Inyección ' + k : 'Estación ' + k;
    const sh = kind === 'cabecera' ? 'CAB' : kind === 'terminal' ? 'TER' : kind === 'reductora' ? 'RD' + k : kind === 'inyeccion' ? 'IN' + k : 'EB' + k;
    return {
      uid: uid(), name: nm, short: sh, pk: +(+pk).toFixed(1), kind, altHead: false,
      pumps: null, pAspSp: null, pDescSp: null,
      meters: { usm: kind === 'reductora' ? 0 : 2, pd: kind === 'reductora' ? 0 : 1, prover: kind !== 'reductora', lact: kind === 'cabecera' || kind === 'terminal' || kind === 'inyeccion' },
      pigTrap: kind === 'cabecera' || kind === 'terminal' || kind === 'bombeo',
      tankM3: kind === 'cabecera' ? 15000 : 0,
      injection: kind === 'inyeccion' ? { name: 'Yacimiento ' + k, rate: 30, owner: 'Tercero' } : null,
      dra: kind === 'cabecera' || kind === 'bombeo',
    };
  }
  /** Completa bombas y set points de cada estación según la hidráulica de diseño. */
  function sizeAll(spec) {
    const pDisc = opLimit(spec);
    const pAsp = Number(spec.ops.pAspSpKg) || 5;
    const maxHead = Number(spec.ops.maxPumpHeadKg) || 40;
    for (const st of spec.stations) {
      if (st.kind === 'cabecera') {
        st.pumps = Object.assign(sizePumps(pDisc - 3, maxHead, st.pumps && st.pumps.drive), { boosters: 2, boostersOnline: 1, boosterKg: 5 });
        st.pDescSp = pDisc; st.pAspSp = null;
      } else if (st.kind === 'bombeo') {
        st.pumps = sizePumps(pDisc - pAsp, maxHead, st.pumps && st.pumps.drive);
        st.pDescSp = pDisc; st.pAspSp = pAsp;
      } else if (st.kind === 'reductora') {
        st.pumps = null; st.pAspSp = null;
        if (st.pDescSp == null) st.pDescSp = Math.round(pDisc * 0.55);
      } else if (st.kind === 'terminal') {
        st.pumps = null; st.pDescSp = null; st.pAspSp = Number(spec.ops.pArrivalKg) || 8;
      } else { st.pumps = null; st.pDescSp = null; st.pAspSp = null; }
    }
  }
  function autoDesign(spec, keepUser) {
    const res = autoStations(spec);
    const L = spec.lengthKm;
    const user = keepUser ? spec.stations.filter((s) => s.kind === 'inyeccion') : [];
    const head = spec.stations.find((s) => s.kind === 'cabecera') || newStation('cabecera', 0, 0);
    const term = spec.stations.find((s) => s.kind === 'terminal') || newStation('terminal', L, 0);
    head.pk = 0; term.pk = +L.toFixed(1);
    let kb = 0, kr = 0;
    const mids = res.stations.map((x) => {
      const s = newStation(x.kind, x.pk, x.kind === 'reductora' ? ++kr : ++kb);
      if (x.sp) s.pDescSp = x.sp;
      return s;
    });
    spec.stations = [head, ...mids, ...user, term].sort((a, b) => a.pk - b.pk);
    sizeAll(spec);
    return res;
  }
  function autoValves(spec, spacingKm) {
    const sp = Math.max(2, Number(spacingKm) || 25);
    const L = spec.lengthKm;
    const out = [];
    const near = (pk) => spec.stations.some((s) => Math.abs(s.pk - pk) < Math.min(2, sp * 0.2));
    let n = 0;
    for (let pk = sp; pk < L - 1; pk += sp) {
      if (near(pk)) continue;
      out.push({ pk: +pk.toFixed(1), name: 'VB' + String(++n).padStart(2, '0') });
    }
    // aguas arriba y abajo del punto más alto y del más bajo (aislación de tramos con columna)
    const prof = spec.profile;
    if (prof && prof.length > 5) {
      let hi = prof[0], lo = prof[0];
      for (const p of prof) { if (p.elev > hi.elev) hi = p; if (p.elev < lo.elev) lo = p; }
      for (const p of [lo]) {
        const pk = +p.pk.toFixed(1);
        if (pk > 1 && pk < L - 1 && !near(pk) && !out.some((v) => Math.abs(v.pk - pk) < sp * 0.3)) out.push({ pk, name: 'VB punto bajo' });
      }
    }
    out.sort((a, b) => a.pk - b.pk);
    out.forEach((v, i) => { v.name = v.name === 'VB punto bajo' ? 'VB' + String(i + 1).padStart(2, '0') + ' · bajo' : 'VB' + String(i + 1).padStart(2, '0'); });
    return out;
  }

  // ---------- spec por defecto ----------
  function defaultSpec() {
    return {
      v: 1,
      id: 'd' + Date.now().toString(36),
      name: 'Oleoducto nuevo',
      client: '',
      notes: '',
      fluid: { name: 'Crudo', densityKgM3: 860, viscCst: 12, tempC: 30 },
      route: [],
      profile: [],
      terrain: null,
      lengthKm: 0,
      pipe: { nps: 16, odMm: 406.4, schedule: '30 / STD', wallMm: 9.53, grade: 'X52', ansiClass: 600, designFactor: 0.72, jointFactor: 1, roughnessMm: 0.045, opMaxKg: 0, calib: 1 },
      ops: { qDesignM3h: 650, qMaxHeadM3h: 750, pAspSpKg: 5, pArrivalKg: 8, pMinLineKg: 2, draEnabled: true, draLph: 6, draReduction: 0.35, maxPumpHeadKg: 40 },
      stations: [],
      valves: [],
      valveSpacingKm: 25,
      dest: { kind: 'refineria', name: 'Refinería', tanks: 2, tankM3: 20000, programM3d: 0, settleHours: 6, shipM3: 50000, loadRateM3h: 3000, shipIntervalH: 0 },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
  }

  // ---------- generación de la configuración del motor ----------
  function slug(s) { return String(s || '').toUpperCase().replace(/[^A-Z0-9]+/g, '').slice(0, 4) || 'EST'; }

  function generateConfig(spec) {
    const H = hyd(spec);
    const pc = H.pc;
    const L = +spec.lengthKm.toFixed(2);
    const opMax = opLimit(spec);
    const ops = spec.ops;
    const sts = spec.stations.slice().sort((a, b) => a.pk - b.pk);
    const hasAlt = sts.some((s) => s.altHead && s.kind === 'bombeo');
    // ids internos que entiende el motor
    let nb = 0, nr = 0, ni = 0;
    const idOf = new Map();
    for (const s of sts) {
      let id;
      if (s.kind === 'cabecera') id = 'ph';
      else if (s.kind === 'terminal') id = 'lc';
      else if (s.altHead && s.kind === 'bombeo' && !idOf.has('__cd')) { id = 'cd'; idOf.set('__cd', true); }
      else if (s.kind === 'reductora') id = 'r' + (++nr);
      else if (s.kind === 'inyeccion') id = 'i' + (++ni);
      else id = 'e' + (++nb);
      idOf.set(s.uid, id);
    }
    const injTotal = sts.reduce((a, s) => a + (s.injection && s.injection.rate > 0 ? Number(s.injection.rate) : 0), 0);
    const qRecv = (Number(ops.qDesignM3h) || 0) + injTotal;
    const prof = spec.profile && spec.profile.length ? spec.profile : [{ pk: 0, elev: 0 }, { pk: L, elev: 0 }];
    const simp = simplifyProfile(prof, Math.max(3, (Math.max(...prof.map((p) => p.elev)) - Math.min(...prof.map((p) => p.elev))) / 200), 420);
    let peak = prof[0];
    for (const p of prof) if (p.elev > peak.elev && p.pk > L * 0.02 && p.pk < L * 0.98) peak = p;
    const draLph = ops.draEnabled ? Number(ops.draLph) || 6 : 0;
    const tagBase = (i) => (i + 1) * 100;

    const stations = sts.map((s, i) => {
      const id = idOf.get(s.uid);
      const ll = spec.route && spec.route.length > 1 ? pointAt(spec.route, s.pk) : [0, 0];
      const st = {
        id,
        name: s.name,
        shortName: s.short || slug(s.name),
        layoutOrder: i + 1,
        pkKm: +(+s.pk).toFixed(1),
        elevationMsnm: Math.round(elevAt(prof, s.pk)),
        lat: +ll[0].toFixed(5), lon: +ll[1].toFixed(5),
        type: s.kind === 'cabecera' ? 'cabecera' : s.kind === 'terminal' ? 'terminal' : s.kind === 'reductora' ? 'regulating' : s.kind === 'inyeccion' ? 'injection' : 'pumping',
        kind: s.kind,
        roles: [],
        pAspMinKgCm2: Math.max(1, (Number(ops.pAspSpKg) || 5) - 1),
        qMinM3h: 0,
        qMaxM3h: Math.round(Math.max(Number(ops.qMaxHeadM3h) || 750, qRecv) * 1.15),
        pumps: [],
        pigTrap: s.pigTrap ? { type: s.kind === 'cabecera' ? 'lanzadora' : s.kind === 'terminal' ? 'receptora' : 'receptora/lanzadora', status: 'ready', occupied: false } : null,
        injections: [],
        draInjectionLph: draLph || 6,
        draCapable: !!s.dra,
        draInjectOn: false,
        meters: s.meters || null,
        tagBase: tagBase(i),
      };
      if (s.altHead && id === 'cd') st.roles.push('temp_head');
      if (s.pumps && (s.kind === 'cabecera' || s.kind === 'bombeo')) {
        const p = s.pumps;
        const tb = tagBase(i) + 1;
        for (let k = 0; k < (p.mains || 1); k++) {
          st.pumps.push({ id: `${id}-p${k + 1}`, name: `B-${tb}${letters(k)}`, role: 'main', online: k < (p.online || 1), reserve: k >= (p.online || 1), powerFraction: 1, boostKgCm2: Number(p.headKg) || 30, drive: p.drive || 'directa' });
        }
        for (let k = 0; k < (p.boosters || 0); k++) {
          st.pumps.push({ id: `${id}-b${k + 1}`, name: `B-${tb + 1}${letters(k)} (booster)`, role: 'booster_suction', online: k < (p.boostersOnline || 0), reserve: k >= (p.boostersOnline || 0), powerFraction: 1, boostKgCm2: 0, suctionAssistKgCm2: Number(p.boosterKg) || 5 });
        }
        st.minMainsOnline = Math.max(1, p.online || 1);
        if (id === 'cd') st.minTurbosForPeak = st.minMainsOnline;
      }
      if (s.pDescSp != null && s.kind !== 'terminal') st.pDescSpKgCm2 = Number(s.pDescSp);
      if (s.pAspSp != null) st.pAspSpKgCm2 = Number(s.pAspSp);
      if (s.kind === 'reductora') st.flowThrottlePct = 100;
      if (s.injection && Number(s.injection.rate) > 0) {
        const r = Number(s.injection.rate);
        st.injections.push({ id: `${id}-iny`, name: s.injection.name || ('Inyección ' + st.shortName), owner: s.injection.owner || 'Tercero', enabled: true, mode: 'continuous', rateM3h: r, maxM3h: Math.round(r * 1.5 + 5), manualOverride: false, manualRateM3h: r, datosBombeoRateM3h: r });
        st.injection = { enabled: true, rateM3h: r, maxM3h: Math.round(r * 1.5 + 5), label: s.injection.name };
      }
      if (s.tankM3 > 0 && s.kind !== 'terminal') {
        st.tankBuffer = { id: 'TK-' + tagBase(i), name: 'TK-' + tagBase(i), capacityM3: Number(s.tankM3) };
        if (id === 'cd') st.tankAutonomyHours = Math.max(0.5, +(Number(s.tankM3) * 0.6 / Math.max(50, Number(ops.qDesignM3h) || 600)).toFixed(1));
      }
      if (s.kind === 'terminal') {
        const d = spec.dest || {};
        const n = Math.max(1, Number(d.tanks) || 2);
        const cap = Math.max(500, Number(d.tankM3) || 20000);
        st.receiptTargetM3h = Math.round(qRecv);
        st.tanks = [];
        for (let k = 0; k < n; k++) {
          const v = k === 0 ? cap * 0.5 : k === 1 ? cap * 0.45 : cap * 0.3;
          st.tanks.push({ id: 'tk-' + (k + 1), name: 'TK-' + String(k + 1).padStart(2, '0'), capacityM3: cap, maxOpM3: Math.round(cap * 0.875), minOpM3: Math.round(cap * 0.2), volumeM3: Math.round(v), mode: k === 0 ? 'recibe' : k === 1 ? 'entrega' : 'espera', ready: k !== 0, levelPct: (v / cap) * 100 });
        }
      }
      return st;
    });

    const segments = [];
    const segFric = {};
    for (let i = 1; i < stations.length; i++) {
      const a = stations[i - 1], b = stations[i];
      const len = Math.max(0.01, b.pkKm - a.pkKm);
      segFric[a.id + '-' + b.id] = +H.f.toFixed(5);
      segments.push({ id: a.id + '-' + b.id, from: a.id, to: b.id, via: [], lengthKm: +len.toFixed(1), qMaxM3h: Math.round(Math.max(Number(ops.qMaxHeadM3h) || 750, qRecv) * 1.3), qMaxDraM3h: Math.round(Math.max(Number(ops.qMaxHeadM3h) || 750, qRecv) * 1.3), maopKgCm2: pc.maop, linepackM3: Math.round(H.A * len * 1000) });
    }

    const t = Number(ops.pAspSpKg) || 5;
    const d = spec.dest || {};
    const head = stations[0], term = stations[stations.length - 1];
    const config = {
      _meta: {
        custom: true,
        specId: spec.id,
        pipelineId: spec.id,
        name: `${spec.name} · ${head.shortName} → ${term.shortName}`,
        shortTitle: spec.name,
        client: spec.client || '',
        operator: spec.client || 'Ducto a medida',
        disclaimer: `${spec.name} · ducto generado con el constructor de Oleoducto Beta. Simulación de entrenamiento con valores de diseño estimados; no reemplaza un estudio hidráulico.`,
        lengthKm: L,
        diameterInch: Number(spec.pipe.nps),
        maxFlowM3h: Math.round(Math.max(Number(ops.qMaxHeadM3h) || 750, qRecv) * 1.25),
        defaultPhCabeceraM3h: Number(ops.qDesignM3h) || 600,
        defaultLcReceiptTargetM3h: Math.round(qRecv),
        maxLineFlowM3h: Number(ops.qMaxHeadM3h) || 750,
        rampFlowM3hPerMin: Math.max(5, Math.round((Number(ops.qMaxHeadM3h) || 750) / 50)),
        rampStationMin: 8,
        dailyPlanM3d: Math.round(qRecv * 24),
        peakPkKm: +peak.pk.toFixed(1),
        peakElevM: Math.round(peak.elev),
        pipeSpec: `${spec.pipe.nps} in · sch ${spec.pipe.schedule} · ${pc.t} mm · API 5L ${spec.pipe.grade} · clase ${spec.pipe.ansiClass} · MAOP ${pc.maop} kg/cm² · operación hasta ${opMax} kg/cm²`,
        maopKgCm2: pc.maop,
        opMaxKgCm2: opMax,
        fluidName: spec.fluid.name,
        destKind: d.kind || 'refineria',
        destName: d.name || DEST[d.kind] || 'Destino',
        geoRoute: (spec.profile || []).filter((_, i, arr) => i % Math.max(1, Math.ceil(arr.length / 700)) === 0 || i === arr.length - 1).map((p) => [+p.pk.toFixed(2), p.lat, p.lon]),
        terrain: spec.terrain || null,
        pressureUnit: 'kg/cm²',
        demo24h: { simHoursPerRealSec: 0.2, speedFactor: 720 },
      },
      hydraulics: {
        model: 'darcy_weisbach_plus_elevation_segment_f',
        diameterM: +pc.idM.toFixed(4),
        diameterInch: Number(spec.pipe.nps),
        frictionFactor_f: +H.f.toFixed(5),
        segmentFriction: segFric,
        fluidDensity_kg_m3: Number(spec.fluid.densityKgM3) || 860,
        fluidDensity_sg: (Number(spec.fluid.densityKgM3) || 860) / 1000,
        viscosityCst: Number(spec.fluid.viscCst) || 12,
        minPressureKgCm2: Number(ops.pMinLineKg) || 2,
        maxPressureKgCm2: pc.maop,
        phMaxDischargeKgCm2: opMax,
        pressureUnit: 'kg/cm²',
        draFrictionReduction: Number(ops.draReduction) || 0.35,
        draRefLph: 10,
      },
      thresholds: {
        label: 'operativo / no contractual — UI editable',
        pAspMinKgCm2_default: Math.max(1, t - 1),
        maopAlarmFraction: 0.9,
        maopTripFraction: 1,
        lcReceiptTargetM3h: Math.round(qRecv),
        lcReceiptBandM3h: Math.round(Math.max(30, qRecv * 0.12)),
        lcArrivalTargetKgCm2: Number(ops.pArrivalKg) || 8,
        waterSlugOosPct: 0.75,
        waterSlugWarnPct: 0.5,
        pigVminKmH: 1.5,
        pigStuckMinutes: 15,
        operatorResponseDelayMin: 5,
        cdAutonomyHours: (stations.find((x) => x.id === 'cd') || {}).tankAutonomyHours || 2,
        pDescMaxKgCm2: pc.maop,
        draDefaultLph: draLph || 6,
        pMinLineKgCm2: Number(ops.pMinLineKg) || 2,
        pMaxLineKgCm2: pc.maop,
        pAspAlarmKgCm2: Math.max(1, t - 0.5),
        pAspStrongKgCm2: Math.max(0.8, t - 1.5),
        pAspTripKgCm2: Math.max(0.5, t - 2.5),
        pAspAlarmDerateFrac: 0.15,
        draMaxLph: 10,
      },
      segments,
      altimetryPolyline: simp.map((p) => ({ pkKm: +p.pk.toFixed(2), elevMsnm: Math.round(p.elev) })),
      valves: (spec.valves || []).map((v, i) => ({ id: 'vb' + String(i + 1).padStart(2, '0'), name: v.name || 'VB' + (i + 1), pkKm: +(+v.pk).toFixed(1), open: true })),
      playbook: playbook(head, term, stations.find((x) => x.id === 'cd')),
      stations,
      refinery: {
        name: d.name || DEST[d.kind] || 'Destino',
        mode: d.kind || 'refineria',
        programM3d: d.kind === 'puerto' ? 0 : Number(d.programM3d) || Math.round(qRecv * 24),
        firstShipH: 8,
        settleHours: Number(d.settleHours) || 6,
        shipM3: Number(d.shipM3) || 50000,
        loadRateM3h: Number(d.loadRateM3h) || 3000,
        shipIntervalH: Number(d.shipIntervalH) || Math.max(4, Math.round(((Number(d.shipM3) || 50000) / Math.max(10, qRecv)) * 0.92 - (Number(d.shipM3) || 50000) / Math.max(100, Number(d.loadRateM3h) || 3000))),
      },
      pigTypes: PIG_TYPES,
    };
    return config;
  }

  const PIG_TYPES = [
    { id: 'limpieza', name: 'Limpieza (discos y cepillos)', speedFactor: 0.95, dP: 1.8, stuckRisk: 0.25, note: 'Remueve parafina y sedimentos: baja la fricción del tramo recorrido' },
    { id: 'espuma', name: 'Espuma (foam)', speedFactor: 1.0, dP: 0.6, stuckRisk: 0.02, note: 'Baja exigencia: primera corrida o tramos con dudas de diámetro' },
    { id: 'copas', name: 'Copas (separador de batch)', speedFactor: 0.98, dP: 1.2, stuckRisk: 0.08, note: 'Separa productos o empuja agua y sedimentos' },
    { id: 'calibrador', name: 'Calibrador (placa)', speedFactor: 0.97, dP: 1.4, stuckRisk: 0.1, note: 'Verifica que no haya abolladuras antes de un instrumentado' },
    { id: 'instrumentado', name: 'Instrumentado (MFL / geómetra)', speedFactor: 0.9, dP: 2.2, stuckRisk: 0.15, note: 'Inspección en línea: pide velocidad estable de 1 a 4 m/s', vMinMs: 1.0, vMaxMs: 4.0 },
  ];

  function playbook(head, term, alt) {
    const H = head.shortName, T = term.shortName, A = alt ? alt.shortName : null;
    return {
      falla_ph: ['Reducir el set point de caudal de la línea', A ? `Confirmar autonomía del tanque de ${A}` : 'Confirmar inventario en tanques de cabecera', A ? `Activar ${A} como cabecera temporal` : 'Parada ordenada de la línea', 'Aislar VB aguas abajo de la cabecera si hay despresurización', 'Notificar a la sala de control', 'Monitorear la aspiración de las estaciones intermedias'],
      falla_eb: ['Evaluar aspiración y descarga de la estación afectada', 'Bajar caudal o redistribuir', 'Verificar alarma de baja aspiración', 'Abrir DRA si el tramo aguas abajo lo requiere', 'Aislar VB adyacentes si hay fuga', 'Notificar a la sala de control'],
      pig: ['Completar el procedimiento de lanzamiento', 'Seguir PK, ETA y ΔP del pig', 'Si la velocidad cae bajo el mínimo por más de 15 min: pig detenido', `Coordinar la recepción en ${T}`],
      calidad_agua: [`Si el agua supera 0,5–1 % en ${T}: fuera de especificación`, 'Reducir inyecciones aguas arriba', 'Notificar al laboratorio'],
      estrategia_global: ['Activar estrategia global por falla o parada de estación', `Evaluar el alcance hidráulico (${H} → ${T})`, 'Verificar bombas mínimas en línea por estación', 'Ajustar set point, DRA y reductoras', 'Monitorear aspiración, descarga y presión mínima del tramo', 'Notificar a la sala de control'],
      fuga_rotura: ['Confirmar el PK de la fuga y la caída local de presión', 'Aislar las VB del tramo afectado', 'Parar las bombas afectadas y no rearrancar sin OK de integridad', 'Evaluar desbalance de linepack y recibo', 'Notificar a integridad y medio ambiente'],
      perdida_electrica: ['Confirmar la pérdida eléctrica en la estación', 'Redistribuir o limitar caudal', A ? `Si cae ${H}: ${A} como cabecera temporal` : `Si cae ${H}: parada ordenada`, 'Notificar a mantenimiento eléctrico'],
      pig_stuck_peak: ['Confirmar pig detenido en el punto alto', 'v≈0 · ΔP detrás sube · caudal baja', 'Empuje controlado vigilando MAOP', 'No forzar si P > 90 % MAOP', 'Coordinar rescate'],
      sobrepresion_surge: ['Sobrepresión tras parada (golpe de ariete)', 'Parada suave y rampas: no rearrancar en frío', 'Esperar normalización de presión', 'Verificar MAOP', 'Notificar a la sala de control'],
    };
  }

  // ---------- biblioteca (navegador) ----------
  const LIB_KEY = 'oleoductos-a-medida-v1';
  const lib = {
    all() {
      try { return JSON.parse(localStorage.getItem(LIB_KEY) || '{}') || {}; } catch (e) { return {}; }
    },
    list() { return Object.values(lib.all()).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)); },
    get(id) { return lib.all()[id] || null; },
    save(spec) {
      const all = lib.all();
      spec.updatedAt = Date.now();
      all[spec.id] = spec;
      try { localStorage.setItem(LIB_KEY, JSON.stringify(all)); return true; } catch (e) { return false; }
    },
    remove(id) {
      const all = lib.all();
      delete all[id];
      try { localStorage.setItem(LIB_KEY, JSON.stringify(all)); } catch (e) { /* nada */ }
    },
  };

  /** Valida una spec importada y completa campos faltantes. */
  function normalize(spec) {
    const d = defaultSpec();
    const s = Object.assign({}, d, spec || {});
    s.fluid = Object.assign({}, d.fluid, s.fluid || {});
    s.pipe = Object.assign({}, d.pipe, s.pipe || {});
    s.ops = Object.assign({}, d.ops, s.ops || {});
    s.dest = Object.assign({}, d.dest, s.dest || {});
    s.stations = Array.isArray(s.stations) ? s.stations : [];
    s.valves = Array.isArray(s.valves) ? s.valves : [];
    s.route = Array.isArray(s.route) ? s.route : [];
    s.profile = Array.isArray(s.profile) ? s.profile : [];
    for (const st of s.stations) if (!st.uid) st.uid = uid();
    return s;
  }

  global.PIPEGEN = {
    NPS, GRADES, ANSI, DRIVES, KINDS, DEST, BAR_TO_KG,
    hav, routeLength, pointAt, samplePoints, elevAt, simplifyProfile,
    pipeCalc, frictionF, hyd, opLimit, autoStations, autoDesign, sizeAll, sizePumps, autoValves,
    newStation, defaultSpec, normalize, generateConfig, lib, LIB_KEY, PIG_TYPES,
  };
})(typeof window !== 'undefined' ? window : globalThis);
