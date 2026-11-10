/* Geometría del corredor: PK ↔ posición (km) y cota. Coordenadas aproximadas, uso ilustrativo. */
(function (global) {
  'use strict';
  // lat, lon aproximados de cada nodo (trazado estilizado sobre el corredor real de la Ruta 40)
  const LL = {
    ph: [-37.40, -68.95],
    ac: [-36.92, -69.33],
    cd: [-36.22, -69.52],
    mg: [-35.47, -69.58],
    sos: [-35.08, -69.58],
    pa: [-34.80, -69.40],
    rt: [-33.55, -68.98],
    ug: [-33.29, -68.89],
    lc: [-33.06, -68.87],
  };
  const LAT0 = -35.2, LON0 = -69.2;
  const KX = 91.2, KZ = 111.0;
  function project(lat, lon) {
    return { x: (lon - LON0) * KX, z: -(lat - LAT0) * KZ };
  }

  // v8: ducto a medida con trazado real (lat/lon por PK)
  function buildCustom(config) {
    const meta = config._meta;
    const R = meta.geoRoute; // [[pk, lat, lon], ...]
    let la0 = 0, lo0 = 0, laMin = 90, laMax = -90, loMin = 180, loMax = -180;
    for (const r of R) { laMin = Math.min(laMin, r[1]); laMax = Math.max(laMax, r[1]); loMin = Math.min(loMin, r[2]); loMax = Math.max(loMax, r[2]); }
    la0 = (laMin + laMax) / 2; lo0 = (loMin + loMax) / 2;
    const kx = 111.32 * Math.cos((la0 * Math.PI) / 180), kz = 110.57;
    const proj = (lat, lon) => ({ x: (lon - lo0) * kx, z: -(lat - la0) * kz });
    const unproj = (x, z) => ({ lat: la0 - z / kz, lon: lo0 + x / kx });
    const pts = R.map((r) => Object.assign({ pk: r[0] }, proj(r[1], r[2])));
    const L = meta.lengthKm || (pts.length ? pts[pts.length - 1].pk : 1);
    const alt = (config.altimetryPolyline || []).slice().sort((a, b) => a.pkKm - b.pkKm);
    function elevAt(pk) {
      if (!alt.length) return 0;
      if (pk <= alt[0].pkKm) return alt[0].elevMsnm;
      for (let i = 1; i < alt.length; i++) {
        const a = alt[i - 1], b = alt[i];
        if (pk <= b.pkKm) { const f = (pk - a.pkKm) / Math.max(1e-6, b.pkKm - a.pkKm); return a.elevMsnm + (b.elevMsnm - a.elevMsnm) * f; }
      }
      return alt[alt.length - 1].elevMsnm;
    }
    function posAt(pk) {
      pk = Math.max(0, Math.min(L, pk));
      if (!pts.length) return { x: 0, z: 0 };
      let lo = 0, hi = pts.length - 1;
      while (hi - lo > 1) { const m = (lo + hi) >> 1; if (pts[m].pk <= pk) lo = m; else hi = m; }
      const a = pts[lo], b = pts[hi];
      const f = Math.max(0, Math.min(1, (pk - a.pk) / Math.max(1e-6, b.pk - a.pk)));
      return { x: a.x + (b.x - a.x) * f, z: a.z + (b.z - a.z) * f };
    }
    const nodes = config.stations.slice().sort((a, b) => (a.pkKm || 0) - (b.pkKm || 0)).map((s) => {
      const p = s.lat != null && s.lat !== 0 ? proj(s.lat, s.lon) : posAt(s.pkKm || 0);
      return { id: s.id, pk: s.pkKm || 0, x: p.x, z: p.z };
    });
    const step = Math.max(0.1, L / 265);
    const samples = [];
    for (let pk = 0; pk <= L + 1e-6; pk += step) { const p = posAt(pk); samples.push({ pk, x: p.x, z: p.z, e: elevAt(pk) }); }
    if (samples[samples.length - 1].pk < L - 1e-6) { const p = posAt(L); samples.push({ pk: L, x: p.x, z: p.z, e: elevAt(L) }); }
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const s of samples) { minX = Math.min(minX, s.x); maxX = Math.max(maxX, s.x); minZ = Math.min(minZ, s.z); maxZ = Math.max(maxZ, s.z); }
    return { L, nodes, samples, elevAt, posAt, bounds: { minX, maxX, minZ, maxZ }, profStep: Math.max(0.1, L / 106), custom: true, proj, unproj, terrain: meta.terrain || null };
  }

  function build(config) {
    if (config._meta && config._meta.custom && config._meta.geoRoute && config._meta.geoRoute.length > 1) return buildCustom(config);
    const stations = config.stations.slice().sort((a, b) => (a.pkKm || 0) - (b.pkKm || 0));
    const nodes = stations.filter((s) => LL[s.id]).map((s) => {
      const p = project(LL[s.id][0], LL[s.id][1]);
      return { id: s.id, pk: s.pkKm || 0, x: p.x, z: p.z };
    });
    const alt = (config.altimetryPolyline || []).slice().sort((a, b) => a.pkKm - b.pkKm);
    const L = (config._meta && config._meta.lengthKm) || 530;

    function elevAt(pk) {
      if (!alt.length) return 1000;
      if (pk <= alt[0].pkKm) return alt[0].elevMsnm;
      for (let i = 1; i < alt.length; i++) {
        const a = alt[i - 1], b = alt[i];
        if (pk <= b.pkKm) {
          const f = (pk - a.pkKm) / Math.max(1e-6, b.pkKm - a.pkKm);
          // suavizado coseno para que el relieve no se vea quebrado
          const g = (1 - Math.cos(Math.PI * f)) / 2;
          return a.elevMsnm + (b.elevMsnm - a.elevMsnm) * g;
        }
      }
      return alt[alt.length - 1].elevMsnm;
    }

    // ondulación determinista por tramo para un trazado orgánico
    function wiggle(i, f) {
      const amp = [3.5, -4, 2.5, -2, 3, -3.5, 2, -1.5][i % 8];
      return Math.sin(Math.PI * f) * amp + Math.sin(Math.PI * 3 * f) * amp * 0.25;
    }

    function posAt(pk) {
      pk = Math.max(0, Math.min(L, pk));
      for (let i = 1; i < nodes.length; i++) {
        const a = nodes[i - 1], b = nodes[i];
        if (pk <= b.pk || i === nodes.length - 1) {
          const f = Math.max(0, Math.min(1, (pk - a.pk) / Math.max(1e-6, b.pk - a.pk)));
          const dx = b.x - a.x, dz = b.z - a.z;
          const len = Math.hypot(dx, dz) || 1;
          const nx = -dz / len, nz = dx / len;
          const w = wiggle(i, f);
          return { x: a.x + dx * f + nx * w, z: a.z + dz * f + nz * w };
        }
      }
      return { x: nodes[0].x, z: nodes[0].z };
    }

    const samples = [];
    for (let pk = 0; pk <= L + 1e-6; pk += 2) {
      const p = posAt(pk);
      samples.push({ pk, x: p.x, z: p.z, e: elevAt(pk) });
    }

    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const s of samples) {
      minX = Math.min(minX, s.x); maxX = Math.max(maxX, s.x);
      minZ = Math.min(minZ, s.z); maxZ = Math.max(maxZ, s.z);
    }

    return { L, nodes, samples, elevAt, posAt, bounds: { minX, maxX, minZ, maxZ }, profStep: 5 };
  }

  // Presión a lo largo del ducto: HGL lineal entre la descarga de una estación y la aspiración de la siguiente
  function pressureProfile(sim, geo, stepKm) {
    const st = sim.state;
    const sorted = sim.sortedStations().slice().sort((a, b) => (a.pkKm || 0) - (b.pkKm || 0));
    const rho = (st.config.hydraulics && st.config.hydraulics.fluidDensity_kg_m3) || 860;
    const kgToM = 1e5 / (rho * 9.81);
    const out = [];
    for (let pk = 0; pk <= geo.L + 1e-6; pk += stepKm) {
      let a = sorted[0], b = sorted[sorted.length - 1];
      for (let i = 1; i < sorted.length; i++) {
        if (pk <= (sorted[i].pkKm || 0)) { a = sorted[i - 1]; b = sorted[i]; break; }
      }
      const pa = st.pressuresOut[a.id] != null ? st.pressuresOut[a.id] : 0;
      const pb = st.pressuresIn[b.id] != null ? st.pressuresIn[b.id] : 0;
      const ea = geo.elevAt(a.pkKm || 0), eb = geo.elevAt(b.pkKm || 0);
      const ha = ea + pa * kgToM, hb = eb + pb * kgToM;
      const f = Math.max(0, Math.min(1, (pk - (a.pkKm || 0)) / Math.max(1e-6, (b.pkKm || 0) - (a.pkKm || 0))));
      const h = ha + (hb - ha) * f;
      const e = geo.elevAt(pk);
      const p = Math.max(0, (h - e) / kgToM);
      // MAOP del tramo
      let maop = 95;
      for (const seg of st.config.segments || []) {
        const s0 = sim.stationById(seg.from), s1 = sim.stationById(seg.to);
        if (s0 && s1 && pk >= (s0.pkKm || 0) && pk <= (s1.pkKm || 0)) { maop = seg.maopKgCm2 || maop; break; }
      }
      const q = st.segmentFlows[b.id] != null ? st.segmentFlows[b.id] : (st.lineFlow || 0);
      out.push({ pk, p, hgl: h, elev: e, maop, q });
    }
    return out;
  }

  global.GEO = { build, pressureProfile, project };
})(window);
