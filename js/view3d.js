/* Vista 3D: terreno, ducto con crudo coloreado, estaciones, HGL, pig, rotura y cámaras. */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const $ = (id) => document.getElementById(id);

function start(app) {
  const sim = app.sim;
  const geo = app.geo;
  const host = $('v3d-canvas');
  let EXAG = 8; // exageración vertical
  const H = (m) => (m / 1000) * EXAG; // metros → unidades (1 unidad = 1 km)

  // ---------- renderer / escena ----------
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  host.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const sky = new THREE.Color('#8fb3cf');
  scene.background = sky.clone();
  scene.fog = new THREE.Fog(sky.clone(), 120, 620);

  const camera = new THREE.PerspectiveCamera(45, 1, 0.3, 3000);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.maxPolarAngle = Math.PI * 0.47;
  controls.minDistance = 4;
  controls.maxDistance = 900;

  const hemi = new THREE.HemisphereLight('#dfe9f2', '#5b4a36', 0.9);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight('#fff1dc', 2.2);
  scene.add(sun);
  scene.add(sun.target);

  // ---------- muestreo del corredor ----------
  const S = geo.samples; // {pk,x,z,e} cada 2 km
  const b = geo.bounds;
  // v8: ducto a medida → terreno real (grilla de cotas) y escala según el tamaño del trazado
  const CUST = !!geo.custom;
  const span = Math.max(b.maxX - b.minX, b.maxZ - b.minZ, 1);
  const K = CUST ? Math.max(0.04, Math.min(1.6, span / 420)) : 1;
  const mg = CUST ? span * 0.35 + 2 : 0;
  const PMAXC = CUST ? (app.config._meta.maopKgCm2 || 95) : 95;
  const QMAXC = CUST ? Math.max(50, (app.config._meta.defaultLcReceiptTargetM3h || 730) * 1.1) : 730;
  if (CUST) { controls.minDistance = Math.max(0.3, 4 * K); controls.maxDistance = Math.max(60, span * 3); }
  if (CUST) {
    // exageración vertical para que el relieve se lea igual que en Beta (~6 % del ancho del trazado)
    let a0 = Infinity, a1 = -Infinity;
    for (const s0 of S) { a0 = Math.min(a0, s0.e); a1 = Math.max(a1, s0.e); }
    let rel = a1 - a0;
    const tg0 = geo.terrain;
    if (tg0 && tg0.elev && tg0.elev.length) { let g0 = Infinity, g1 = -Infinity; for (const v of tg0.elev) { if (v < g0) g0 = v; if (v > g1) g1 = v; } rel = Math.max(rel, (g1 - g0) * 0.6); }
    EXAG = Math.round(Math.max(2, Math.min(30, (0.05 * span) / Math.max(0.03, rel / 1000))));
    const ex = $('v3d-exag');
    if (ex) { ex.max = String(Math.max(Number(ex.max) || 20, 40)); ex.value = String(EXAG); const ev = $('v3d-exag-v'); if (ev) ev.textContent = EXAG; }
  }
  // terreno: 150 km de cordillera al oeste, llanura amplia al este (donde mira la cámara)
  const tMinX = CUST ? b.minX - mg : b.minX - 150, tMaxX = CUST ? b.maxX + mg : b.maxX + 340;
  const tMinZ = CUST ? b.minZ - mg : b.minZ - 230, tMaxZ = CUST ? b.maxZ + mg : b.maxZ + 230;
  const W = tMaxX - tMinX, D = tMaxZ - tMinZ;
  const cx = (tMinX + tMaxX) / 2, cz = (tMinZ + tMaxZ) / 2;
  const vx = (b.minX + b.maxX) / 2, vz = (b.minZ + b.maxZ) / 2; // centro del corredor

  // ruido determinista
  function hash(x, y) { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s); }
  function vnoise(x, y) {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const a = hash(xi, yi), c = hash(xi + 1, yi), d = hash(xi, yi + 1), e = hash(xi + 1, yi + 1);
    return a + (c - a) * u + (d - a) * v + (a - c - d + e) * u * v;
  }
  function fbm(x, y) {
    let f = 0, amp = 0.5, fr = 1;
    for (let o = 0; o < 5; o++) { f += amp * vnoise(x * fr, y * fr); fr *= 2.03; amp *= 0.5; }
    return f;
  }
  function ridged(x, y) {
    let f = 0, amp = 0.5, fr = 1;
    for (let o = 0; o < 4; o++) { const n = 1 - Math.abs(vnoise(x * fr, y * fr) * 2 - 1); f += amp * n * n; fr *= 2.1; amp *= 0.5; }
    return f;
  }
  const smooth = (e0, e1, x) => { const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };

  function nearest(x, z) {
    let best = 1e9, bi = 0;
    for (let i = 0; i < S.length; i += 2) {
      const dx = S[i].x - x, dz = S[i].z - z, d2 = dx * dx + dz * dz;
      if (d2 < best) { best = d2; bi = i; }
    }
    // refinar con vecinos
    for (let i = Math.max(0, bi - 2); i <= Math.min(S.length - 1, bi + 2); i++) {
      const dx = S[i].x - x, dz = S[i].z - z, d2 = dx * dx + dz * dz;
      if (d2 < best) { best = d2; bi = i; }
    }
    return { d: Math.sqrt(best), s: S[bi] };
  }

  // cota del terreno en metros: valle del ducto, cordillera al oeste, llanura al este
  // grilla real de cotas (constructor): bilineal en lat/lon
  const TG = CUST && geo.terrain && geo.terrain.elev && geo.terrain.nx > 1 ? geo.terrain : null;
  let eMinP = Infinity, eMaxP = -Infinity;
  for (const s0 of S) { eMinP = Math.min(eMinP, s0.e); eMaxP = Math.max(eMaxP, s0.e); }
  if (TG) for (const v of TG.elev) { if (v != null && isFinite(v)) { eMinP = Math.min(eMinP, v); eMaxP = Math.max(eMaxP, v); } }
  function gridM(x, z) {
    const ll = geo.unproj(x, z);
    const fi = Math.max(0, Math.min(TG.nx - 1.0001, ((ll.lon - TG.lonMin) / (TG.lonMax - TG.lonMin)) * (TG.nx - 1)));
    const fj = Math.max(0, Math.min(TG.ny - 1.0001, ((ll.lat - TG.latMin) / (TG.latMax - TG.latMin)) * (TG.ny - 1)));
    const i = Math.floor(fi), j = Math.floor(fj), u = fi - i, v = fj - j;
    const g = (ii, jj) => { const e = TG.elev[jj * TG.nx + ii]; return e == null || !isFinite(e) ? 0 : e; };
    return g(i, j) * (1 - u) * (1 - v) + g(i + 1, j) * u * (1 - v) + g(i, j + 1) * (1 - u) * v + g(i + 1, j + 1) * u * v;
  }
  function terrainCustom(x, z) {
    const n = nearest(x, z);
    const relief = Math.max(30, eMaxP - eMinP);
    const far = TG ? gridM(x, z) : n.s.e + (fbm(x * 0.6 / K, z * 0.6 / K) - 0.5) * relief * 0.35 + (ridged(x * 0.25 / K, z * 0.25 / K) - 0.3) * relief * 0.25;
    const w = smooth(0.6 * K, 6 * K, n.d);
    const near = n.s.e - 2;
    return near * (1 - w) + far * w;
  }
  function terrainM(x, z) {
    if (CUST) return terrainCustom(x, z);
    const n = nearest(x, z);
    const valley = n.s.e;
    const dx = x - n.s.x;
    const west = smooth(-8, -95, dx), east = smooth(4, 90, dx);
    const base = valley + west * 1700 - east * Math.max(0, valley - 650) * 0.75;
    const amp = 180 + 2500 * west + 120 * (1 - east);
    const mount = (ridged(x * 0.03, z * 0.03) - 0.3) * amp + (fbm(x * 0.09, z * 0.09) - 0.5) * (120 + 300 * west);
    const w = smooth(1.2, 16, n.d);
    const near = valley - 6 + (fbm(x * 0.2, z * 0.2) - 0.5) * 30 * smooth(0.6, 3, n.d);
    return near * (1 - w) + (base + mount) * w;
  }

  // ---------- terreno ----------
  const SEGX = 300, SEGZ = 420;
  const tGeo = new THREE.PlaneGeometry(W, D, SEGX, SEGZ);
  tGeo.rotateX(-Math.PI / 2);
  const tPos = tGeo.attributes.position;
  const tElev = new Float32Array(tPos.count);
  const tCol = new Float32Array(tPos.count * 3);
  const cSand = new THREE.Color('#b49a6c'), cScrub = new THREE.Color('#8c7d57'), cOlive = new THREE.Color('#6d6a4b');
  const cRock = new THREE.Color('#7b736b'), cDark = new THREE.Color('#57524d'), cSnow = new THREE.Color('#eef1f3');
  const tmp = new THREE.Color();

  function buildTerrain() {
    for (let i = 0; i < tPos.count; i++) {
      const x = tPos.getX(i) + cx, z = tPos.getZ(i) + cz;
      tPos.setX(i, x); tPos.setZ(i, z);
      const m0 = terrainM(x, z);
      tElev[i] = m0;
      const jitter = (hash(x * 3.1, z * 2.7) - 0.5) * 0.08;
      // en ductos a medida el color sigue la cota relativa del lugar (y el mar en azul)
      const m = CUST && eMaxP < 2600 ? 450 + ((m0 - eMinP) / Math.max(150, eMaxP - eMinP)) * 2000 : m0;
      if (CUST && m0 <= 0.5 && TG) tmp.set('#2f5f7a');
      else if (m < 900) tmp.copy(cSand).lerp(cScrub, smooth(500, 900, m));
      else if (m < 1700) tmp.copy(cScrub).lerp(cOlive, smooth(900, 1700, m));
      else if (m < 2700) tmp.copy(cOlive).lerp(cRock, smooth(1700, 2500, m));
      else if (m < 3600) tmp.copy(cRock).lerp(cDark, smooth(2700, 3500, m));
      else tmp.copy(cDark).lerp(cSnow, smooth(3550, 4000, m));
      tCol[i * 3] = tmp.r + jitter; tCol[i * 3 + 1] = tmp.g + jitter; tCol[i * 3 + 2] = tmp.b + jitter;
    }
    tGeo.setAttribute('color', new THREE.BufferAttribute(tCol, 3));
    applyExag();
  }
  function applyExag() {
    for (let i = 0; i < tPos.count; i++) tPos.setY(i, H(tElev[i]));
    tPos.needsUpdate = true;
    tGeo.computeVertexNormals();
  }
  const terrain = new THREE.Mesh(tGeo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 }));
  scene.add(terrain);

  // ---------- ducto ----------
  const TUBE_SEG = 1060;
  let tube, tubeColors, tubeMat, stripeTex;
  function pipeCurve() {
    return new THREE.CatmullRomCurve3(S.map((s) => new THREE.Vector3(s.x, H(s.e) + 0.28 * K, s.z)));
  }
  function makeStripes() {
    const c = document.createElement('canvas'); c.width = 64; c.height = 8;
    const g = c.getContext('2d');
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, 64, 8);
    g.fillStyle = '#9a9a9a'; g.fillRect(0, 0, 14, 8);
    const t = new THREE.CanvasTexture(c);
    t.wrapS = THREE.RepeatWrapping; t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(geo.L / (3 * K), 1);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }
  function buildTube() {
    if (tube) { scene.remove(tube); tube.geometry.dispose(); }
    const g = new THREE.TubeGeometry(pipeCurve(), TUBE_SEG, 0.42 * K, 8, false);
    tubeColors = new Float32Array(g.attributes.position.count * 3).fill(1);
    g.setAttribute('color', new THREE.BufferAttribute(tubeColors, 3));
    if (!tubeMat) {
      stripeTex = makeStripes();
      tubeMat = new THREE.MeshBasicMaterial({ vertexColors: true, map: stripeTex });
    }
    tube = new THREE.Mesh(g, tubeMat);
    scene.add(tube);
  }

  // escalas de color
  const RAMP = ['#2c7bb6', '#00a6ca', '#00ccbc', '#90eb9d', '#ffff8c', '#f9d057', '#f29e2e', '#e76818', '#d7191c'];
  const rampC = RAMP.map((h) => new THREE.Color(h));
  function ramp(t) {
    t = Math.max(0, Math.min(1, t)) * (rampC.length - 1);
    const i = Math.floor(t), f = t - i;
    return tmp.copy(rampC[i]).lerp(rampC[Math.min(rampC.length - 1, i + 1)], f);
  }
  let colorMode = 'presion';
  const dead = new THREE.Color('#3a3f44');
  function colorTube() {
    const prof = app.profile;
    if (!prof || !prof.length || !tube) return;
    const st = sim.state;
    const front = st.oilReachablePkKm != null ? st.oilReachablePkKm : geo.L;
    const ring = 9; // radialSegments + 1
    for (let i = 0; i <= TUBE_SEG; i++) {
      const pk = (i / TUBE_SEG) * geo.L;
      const k = Math.min(prof.length - 1, Math.round(pk / 5));
      const p = prof[k];
      let c;
      if (pk > front + 0.5 || (p.q || 0) < 1 && p.p < 0.5) c = dead;
      else if (colorMode === 'presion') c = ramp(p.p / PMAXC);
      else if (colorMode === 'maop') c = ramp(p.p / p.maop);
      else c = ramp((p.q || 0) / QMAXC);
      for (let j = 0; j < ring; j++) {
        const o = (i * ring + j) * 3;
        tubeColors[o] = c.r; tubeColors[o + 1] = c.g; tubeColors[o + 2] = c.b;
      }
    }
    tube.geometry.attributes.color.needsUpdate = true;
  }
  function legend() {
    const lab = { presion: ['0', Math.round(PMAXC) + ' kg/cm²'], maop: ['0 %', '100 % MAOP'], caudal: ['0', Math.round(QMAXC) + ' m³/h'] }[colorMode];
    $('v3d-legend').innerHTML = `<span>${lab[0]}</span><i style="background:linear-gradient(90deg,${RAMP.join(',')})"></i><span>${lab[1]}</span>`;
  }

  // ---------- HGL (cortina) ----------
  const HSTEP = geo.profStep || 5;
  const hglN = Math.floor(geo.L / HSTEP) + 1;
  const hglGeo = new THREE.BufferGeometry();
  const hglPos = new Float32Array(hglN * 2 * 3);
  hglGeo.setAttribute('position', new THREE.BufferAttribute(hglPos, 3));
  const idx = [];
  for (let i = 0; i < hglN - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  hglGeo.setIndex(idx);
  const hglMesh = new THREE.Mesh(hglGeo, new THREE.MeshBasicMaterial({ color: '#59d2f0', transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false }));
  const hglLineGeo = new THREE.BufferGeometry();
  const hglLinePos = new Float32Array(hglN * 3);
  hglLineGeo.setAttribute('position', new THREE.BufferAttribute(hglLinePos, 3));
  const hglLine = new THREE.Line(hglLineGeo, new THREE.LineBasicMaterial({ color: '#8fe6ff' }));
  const hglGroup = new THREE.Group();
  hglGroup.add(hglMesh, hglLine);
  scene.add(hglGroup);
  function updateHgl() {
    const prof = app.profile;
    if (!prof || !prof.length) return;
    for (let i = 0; i < hglN; i++) {
      const pk = Math.min(geo.L, i * HSTEP);
      const p = prof[Math.min(prof.length - 1, i)];
      const pos = geo.posAt(pk);
      const y0 = H(geo.elevAt(pk)) + 0.3 * K;
      const y1 = Math.max(y0, H(p.hgl));
      hglPos.set([pos.x, y0, pos.z, pos.x, y1, pos.z], i * 6);
      hglLinePos.set([pos.x, y1, pos.z], i * 3);
    }
    hglGeo.attributes.position.needsUpdate = true;
    hglLineGeo.attributes.position.needsUpdate = true;
    hglGeo.computeBoundingSphere();
    hglLineGeo.computeBoundingSphere();
  }

  // ---------- etiquetas ----------
  function makeLabel() {
    const c = document.createElement('canvas'); c.width = 256; c.height = 112;
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true, sizeAttenuation: false }));
    sp.scale.set(0.15, 0.066, 1);
    sp.renderOrder = 10;
    return { sp, c, tex };
  }
  function drawLabel(L, title, line, sev) {
    const g = L.c.getContext('2d');
    g.clearRect(0, 0, 256, 112);
    g.fillStyle = 'rgba(12,16,19,0.82)';
    g.beginPath(); g.roundRect(4, 4, 248, 80, 10); g.fill();
    g.fillStyle = sev === 'crit' ? '#ff5a52' : sev === 'warn' ? '#f2b13d' : '#57d68d';
    g.fillRect(4, 4, 8, 80);
    g.fillStyle = '#f1efe8'; g.font = '600 34px "Barlow Condensed", sans-serif';
    g.fillText(title, 22, 40);
    g.fillStyle = '#b7c3c9'; g.font = '500 24px "IBM Plex Mono", monospace';
    g.fillText(line, 22, 72);
    g.fillStyle = 'rgba(12,16,19,0.82)';
    g.beginPath(); g.moveTo(118, 84); g.lineTo(138, 84); g.lineTo(128, 100); g.fill();
    L.tex.needsUpdate = true;
  }

  // ---------- estaciones ----------
  const stations = [];
  const pickables = [];
  const matPad = new THREE.MeshStandardMaterial({ color: '#9d9a93', roughness: 0.9 });
  const matTank = new THREE.MeshStandardMaterial({ color: '#d9d6cf', roughness: 0.6, metalness: 0.2 });
  const matRun = new THREE.MeshStandardMaterial({ color: '#4fbf7f', emissive: '#1d6b3f', emissiveIntensity: 0.6 });
  const matStop = new THREE.MeshStandardMaterial({ color: '#5a5f63', roughness: 0.8 });
  const matFail = new THREE.MeshStandardMaterial({ color: '#e5484d', emissive: '#a01818', emissiveIntensity: 1 });
  function buildStations() {
    for (const s of stations) scene.remove(s.group);
    stations.length = 0; pickables.length = 0;
    for (const n of geo.nodes) {
      const st = sim.stationById(n.id);
      if (!st) continue;
      const grp = new THREE.Group();
      const y = H(geo.elevAt(n.pk));
      grp.position.set(n.x, y, n.z);
      grp.scale.setScalar(K);
      const pad = new THREE.Mesh(new THREE.BoxGeometry(5, 0.25, 3.4), matPad);
      pad.position.y = 0.12; pad.userData.st = n.id;
      grp.add(pad); pickables.push(pad);
      const tanks = CUST ? (n.id === 'lc' ? Math.min(6, (st.tanks || []).length || 2) : st.tankBuffer ? 2 : st.pumps && st.pumps.length ? 1 : 0) : n.id === 'lc' ? 4 : n.id === 'ph' || n.id === 'cd' ? 2 : st.pumps && st.pumps.length ? 1 : 0;
      for (let k = 0; k < tanks; k++) {
        const t = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.75, 1.1, 20), matTank);
        t.position.set(-1.6 + (k % 2) * 1.7, 0.8, -0.9 + Math.floor(k / 2) * 1.7 + (tanks === 1 ? 0.9 : 0));
        if (n.id !== 'lc') t.position.x = 1.4;
        grp.add(t);
      }
      const pumps = [];
      (st.pumps || []).forEach((p, k) => {
        const booster = p.role && p.role.indexOf('booster') >= 0;
        const m = new THREE.Mesh(new THREE.BoxGeometry(booster ? 0.35 : 0.5, booster ? 0.35 : 0.5, 0.9), matStop);
        m.position.set(-1.9 + (k % 4) * 0.75, 0.5, -0.9 + Math.floor(k / 4) * 1.2);
        m.userData.st = n.id;
        grp.add(m); pickables.push(m);
        pumps.push({ m, p });
      });
      // baliza de estado visible a distancia
      const beaconMat = new THREE.MeshBasicMaterial({ color: '#57d68d' });
      const beacon = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 5, 8), beaconMat);
      beacon.position.y = 2.6; beacon.userData.st = n.id;
      grp.add(beacon); pickables.push(beacon);
      const L = makeLabel();
      L.sp.position.y = 7.6;
      L.sp.scale.set(0.15 / K, 0.066 / K, 1); // la etiqueta no hereda la escala del grupo
      grp.add(L.sp);
      scene.add(grp);
      stations.push({ id: n.id, st, n, group: grp, pumps, beaconMat, label: L, pad });
    }
  }

  // válvulas de bloqueo
  const valveGroup = new THREE.Group();
  scene.add(valveGroup);
  const valveMeshes = {};
  const matVOpen = new THREE.MeshStandardMaterial({ color: '#e7e3da' });
  const matVClosed = new THREE.MeshStandardMaterial({ color: '#e5484d', emissive: '#7a1010', emissiveIntensity: 1 });
  function buildValves() {
    valveGroup.clear();
    for (const v of sim.state.valves) {
      const p = geo.posAt(v.pkKm || 0);
      const m = new THREE.Mesh(new THREE.CylinderGeometry(0.22 * K, 0.22 * K, 1.4 * K, 10), matVOpen);
      m.position.set(p.x, H(geo.elevAt(v.pkKm || 0)) + 0.7 * K, p.z);
      valveGroup.add(m);
      valveMeshes[v.id] = m;
    }
  }

  // pig
  const pig = new THREE.Mesh(new THREE.SphereGeometry(0.75 * K, 20, 16), new THREE.MeshBasicMaterial({ color: '#ffb347' }));
  scene.add(pig);
  let pigLabel = null; // se crea después de makeLabel
  // trazador de recorrido (para la cámara "seguir")
  let tracerPk = 0;

  // rotura: chorro de partículas + mancha
  const PN = 420;
  const pGeo = new THREE.BufferGeometry();
  const pPos = new Float32Array(PN * 3), pVel = new Float32Array(PN * 3), pLife = new Float32Array(PN);
  pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
  const spray = new THREE.Points(pGeo, new THREE.PointsMaterial({ color: '#1b1510', size: 0.35, transparent: true, opacity: 0.9 }));
  spray.frustumCulled = false;
  scene.add(spray);
  const pool = new THREE.Mesh(new THREE.CircleGeometry(1, 40), new THREE.MeshBasicMaterial({ color: '#120e0a', transparent: true, opacity: 0.85 }));
  pool.rotation.x = -Math.PI / 2;
  scene.add(pool);
  let poolR = 0;

  function updateRupture(dt) {
    const r = sim.state.rupture;
    const on = r && r.active;
    spray.visible = !!on; pool.visible = !!on;
    if (!on) { poolR = 0; return; }
    const p = geo.posAt(r.pkKm || 0);
    const y = H(geo.elevAt(r.pkKm || 0)) + 0.3;
    const rate = r.isolated ? 0.15 : 1;
    poolR = Math.min(9 * K, poolR + dt * 0.25 * rate * K);
    pool.position.set(p.x, y - 0.2, p.z);
    pool.scale.setScalar(Math.max(0.5, poolR));
    for (let i = 0; i < PN; i++) {
      pLife[i] -= dt;
      if (pLife[i] <= 0) {
        if (Math.random() > rate) { pPos[i * 3 + 1] = -999; continue; }
        pLife[i] = 0.8 + Math.random() * 0.9;
        pPos[i * 3] = p.x; pPos[i * 3 + 1] = y; pPos[i * 3 + 2] = p.z;
        const a = Math.random() * Math.PI * 2, sp = 1 + Math.random() * 2.2;
        pVel[i * 3] = Math.cos(a) * sp; pVel[i * 3 + 1] = 6 + Math.random() * 5; pVel[i * 3 + 2] = Math.sin(a) * sp;
      }
      pVel[i * 3 + 1] -= 14 * dt;
      pPos[i * 3] += pVel[i * 3] * dt; pPos[i * 3 + 1] += pVel[i * 3 + 1] * dt; pPos[i * 3 + 2] += pVel[i * 3 + 2] * dt;
      if (pPos[i * 3 + 1] < y - 0.3) pPos[i * 3 + 1] = y - 0.3;
    }
    pGeo.attributes.position.needsUpdate = true;
  }

  // ---------- actualización de estaciones ----------
  function stSev(id) {
    const S = sim.state;
    if (S.failedStations[id] || (id === 'ph' && S.phFailed)) return 'crit';
    const tag = (sim.stationById(id) || {}).shortName;
    let sev = 'ok';
    for (const a of app.alarms.sorted()) {
      if (a.tag !== tag || !a.active) continue;
      if (a.prio === 1) return 'crit';
      sev = 'warn';
    }
    return sev;
  }
  let labelsOn = true;
  function updateStations(blink) {
    const S = sim.state;
    for (const s of stations) {
      const failed = !!S.failedStations[s.id] || (s.id === 'ph' && S.phFailed);
      for (const { m, p } of s.pumps) m.material = failed ? matFail : p.online ? matRun : matStop;
      const sev = stSev(s.id);
      s.beaconMat.color.set(sev === 'crit' ? (blink ? '#ff5a52' : '#5a1512') : sev === 'warn' ? '#f2b13d' : '#57d68d');
      s.label.sp.visible = labelsOn;
      const pin = S.pressuresIn[s.id], pout = S.pressuresOut[s.id], q = S.segmentFlows[s.id];
      const line = s.st.pumps && s.st.pumps.length
        ? `${(pin || 0).toFixed(0)}→${(pout || 0).toFixed(0)} kg · ${Math.round(q || 0)}`
        : `${(pin || 0).toFixed(1)} kg · ${Math.round(q || 0)} m³/h`;
      drawLabel(s.label, `${s.st.shortName} · PK ${s.st.pkKm}`, line, sev);
    }
    if (S.pig && S.pig.active) {
      if (!pigLabel) { pigLabel = makeLabel(); scene.add(pigLabel.sp); }
      const nx = sim.pigEtas().find((e) => e.etaH != null);
      const eta = nx ? `${sim.stationById(nx.id).shortName} en ${Math.floor(nx.etaH)}:${String(Math.round((nx.etaH % 1) * 60) % 60).padStart(2, '0')} h` : 'detenido';
      drawLabel(pigLabel, `PIG · PK ${S.pig.pkKm.toFixed(0)}`, eta, S.pig.stuck ? 'crit' : 'warn');
      pigLabel.sp.visible = labelsOn;
    } else if (pigLabel) pigLabel.sp.visible = false;
    for (const v of S.valves) {
      const m = valveMeshes[v.id];
      if (m) m.material = v.open ? matVOpen : matVClosed;
    }
  }

  // ---------- día y noche ----------
  const cNight = new THREE.Color('#0b1622'), cDawn = new THREE.Color('#d99a6c'), cDay = new THREE.Color('#9cc0dc');
  function updateSky() {
    const h = sim.hourOfDayProgress().hour;
    const el = Math.sin(((h - 6) / 12) * Math.PI); // -1..1
    const day = smooth(-0.12, 0.35, el);
    const dawn = Math.max(0, 1 - Math.abs(el) * 4) * 0.8;
    const c = new THREE.Color().copy(cNight).lerp(cDay, day).lerp(cDawn, dawn * (1 - day * 0.5));
    scene.background.copy(c);
    scene.fog.color.copy(c);
    sun.intensity = 0.15 + 2.3 * day;
    sun.color.set(dawn > 0.3 ? '#ffc58f' : '#fff1dc');
    hemi.intensity = 0.25 + 0.75 * day;
    const az = ((h - 6) / 12) * Math.PI;
    const tgt = controls.target;
    sun.position.set(tgt.x + Math.cos(az) * 200, Math.max(20, el * 300), tgt.z + 120);
    sun.target.position.copy(tgt);
    matRun.emissiveIntensity = 0.6 + (1 - day) * 1.2;
  }

  // ---------- cámaras ----------
  let camMode = 'corredor';
  let fly = null; // {fromP, toP, fromT, toT, t, dur}
  let selectedId = null;
  function flyTo(pos, tgt, dur) {
    fly = { fromP: camera.position.clone(), toP: pos.clone(), fromT: controls.target.clone(), toT: tgt.clone(), t: 0, dur: dur || 1.4 };
  }
  function corridorView(instant) {
    // desde el este (llanura) mirando a la cordillera, con todo el corredor en cuadro
    const mid = CUST ? new THREE.Vector3(vx, H((eMinP + eMaxP) / 2), vz) : new THREE.Vector3(vx - 10, H(1300), vz - 10);
    const pos = CUST ? new THREE.Vector3(vx + span * 0.5, H(eMaxP) + span * 0.5, vz + span * 0.55) : new THREE.Vector3(vx + 270, 210, vz + 150);
    if (instant) { camera.position.copy(pos); controls.target.copy(mid); }
    else flyTo(pos, mid, 1.6);
  }
  function stationView(id) {
    const s = stations.find((x) => x.id === id);
    if (!s) return;
    const p = s.group.position;
    flyTo(new THREE.Vector3(p.x + 14 * K, p.y + 10 * K, p.z + 16 * K), new THREE.Vector3(p.x, p.y + 1 * K, p.z), 1.6);
  }
  function setCam(mode) {
    camMode = mode;
    document.querySelectorAll('[data-cam]').forEach((b) => b.classList.toggle('active', b.dataset.cam === mode));
    document.body.classList.toggle('cine', mode === 'cine');
    $('v3d-cine-bar').hidden = mode !== 'cine';
    controls.enabled = mode !== 'cine';
    if (mode === 'corredor') corridorView(false);
    if (mode === 'estacion') stationView(selectedId || (stations.some((x) => x.id === 'cd') ? 'cd' : stations.length > 1 ? stations[1].id : 'ph'));
    if (mode === 'seguir') { tracerPk = sim.state.pig && sim.state.pig.active ? sim.state.pig.pkKm : 0; }
    if (mode === 'cine') cineT = 0;
  }
  let cineT = 0;
  const cineDur = 55;
  function cineUpdate(dt) {
    cineT = (cineT + dt) % cineDur;
    const f = cineT / cineDur;
    const pk = f * geo.L;
    const ah = 14 * K;
    const p = geo.posAt(pk), p2 = geo.posAt(Math.min(geo.L, pk + ah));
    const y = H(geo.elevAt(pk));
    const side = Math.sin(f * Math.PI * 6) * 10 * K;
    const dir = new THREE.Vector2(p2.x - p.x, p2.z - p.z).normalize();
    const pos = new THREE.Vector3(p.x - dir.x * 16 * K + -dir.y * (14 * K + side), y + (9 + Math.sin(f * 20) * 2) * K, p.z - dir.y * 16 * K + dir.x * (14 * K + side));
    camera.position.lerp(pos, Math.min(1, dt * 1.6));
    controls.target.lerp(new THREE.Vector3(p2.x, H(geo.elevAt(Math.min(geo.L, pk + ah))), p2.z), Math.min(1, dt * 2));
    let near = null;
    for (const n of geo.nodes) if (Math.abs(n.pk - pk) < 18 * K) near = n;
    const elev = Math.round(geo.elevAt(pk));
    $('v3d-cine-txt').textContent = `PK ${Math.round(pk)} · cota ${elev.toLocaleString('es-AR')} m` + (near ? ` · ${(sim.stationById(near.id) || {}).name || ''}` : '') + (CUST ? (Math.abs(pk - (app.config._meta.peakPkKm || -99)) < 10 * K ? ' · punto alto de la línea' : '') : pk > 185 && pk < 212 ? ' · peak de la línea' : '');
  }
  function followUpdate(dt) {
    const S = sim.state;
    let pk;
    if (S.pig && S.pig.active) pk = S.pig.pkKm;
    else {
      const q = S.segmentFlows.lc || S.lineFlow || 0;
      tracerPk = (tracerPk + dt * (4 + q / 650 * 6) * K) % geo.L;
      pk = tracerPk;
    }
    const p = geo.posAt(pk), p2 = geo.posAt(Math.min(geo.L, pk + 3 * K));
    const y = H(geo.elevAt(pk));
    const dir = new THREE.Vector2(p2.x - p.x, p2.z - p.z).normalize();
    const tgt = new THREE.Vector3(p.x, y, p.z);
    const want = new THREE.Vector3(p.x - dir.x * 9 * K - dir.y * 6 * K, y + 6 * K, p.z - dir.y * 9 * K + dir.x * 6 * K);
    controls.target.lerp(tgt, Math.min(1, dt * 3));
    camera.position.lerp(want, Math.min(1, dt * 1.5));
    tracer.position.set(p.x, y + 0.3, p.z);
  }
  const tracer = new THREE.Mesh(new THREE.TorusGeometry(0.6 * K, 0.12 * K, 8, 24), new THREE.MeshBasicMaterial({ color: '#ffffff' }));
  scene.add(tracer);

  // ---------- selección ----------
  const ray = new THREE.Raycaster();
  const mouse = new THREE.Vector2();
  let downAt = null;
  renderer.domElement.addEventListener('pointerdown', (e) => { downAt = [e.clientX, e.clientY]; });
  renderer.domElement.addEventListener('pointerup', (e) => {
    if (!downAt || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 6) return;
    const r = renderer.domElement.getBoundingClientRect();
    mouse.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(mouse, camera);
    const hit = ray.intersectObjects(pickables, false)[0];
    if (hit && hit.object.userData.st) selectStation(hit.object.userData.st, true);
    else {
      // también se puede tocar la etiqueta
      const sp = ray.intersectObjects(stations.map((s) => s.label.sp), false)[0];
      if (sp) { const s = stations.find((x) => x.label.sp === sp.object); if (s) selectStation(s.id, true); }
    }
  });
  function selectStation(id, fly) {
    selectedId = id;
    $('v3d-station').hidden = false;
    renderStationCard();
    if (fly) setCam('estacion');
  }
  function renderStationCard() {
    if (!selectedId) return;
    const S = sim.state, st = sim.stationById(selectedId);
    if (!st) return;
    $('v3d-st-pk').textContent = `PK ${st.pkKm} · cota ${Math.round(geo.elevAt(st.pkKm)).toLocaleString('es-AR')} m`;
    $('v3d-st-name').textContent = (st.name || '').replace(/\s*\(.*\)/, '');
    const rows = [
      ['P aspiración', (S.pressuresIn[st.id] || 0).toFixed(1) + ' kg/cm²'],
      ['P descarga', st.pumps && st.pumps.length ? (S.pressuresOut[st.id] || 0).toFixed(1) + ' kg/cm²' : '—'],
      ['Caudal', Math.round(S.segmentFlows[st.id] || 0) + ' m³/h'],
    ];
    $('v3d-st-vals').innerHTML = rows.map((r) => `<div><dt>${r[0]}</dt><dd>${r[1]}</dd></div>`).join('');
    const failed = !!S.failedStations[st.id] || (st.id === 'ph' && S.phFailed);
    $('v3d-st-pumps').innerHTML = (st.pumps || []).map((p) => `<span class="${failed ? 'fail' : p.online ? 'run' : 'stop'}" title="${p.name}">${p.role && p.role.indexOf('booster') >= 0 ? 'B' : 'M'}</span>`).join('') +
      (st.pumps && st.pumps.length ? `<em>${st.pumps.filter((p) => p.online && !failed).length} de ${st.pumps.length} bombas en marcha</em>` : '<em>Sin bombeo</em>');
  }
  $('v3d-st-close').addEventListener('click', () => { $('v3d-station').hidden = true; selectedId = null; });
  $('v3d-st-scada').addEventListener('click', () => { if (selectedId) app.scada.select(selectedId); app.go('scada'); });

  // ---------- controles de la vista ----------
  document.querySelectorAll('[data-cam]').forEach((b) => b.addEventListener('click', () => setCam(b.dataset.cam)));
  $('v3d-cine-exit').addEventListener('click', () => setCam('corredor'));
  $('v3d-pig').addEventListener('click', () => { if (!(sim.state.pig && sim.state.pig.active)) sim.launchPig({ auto: true }); setCam('seguir'); app.toast('Pig en línea · la cámara lo sigue'); });
  document.querySelectorAll('[data-color]').forEach((b) => b.addEventListener('click', () => {
    colorMode = b.dataset.color;
    document.querySelectorAll('[data-color]').forEach((x) => x.classList.toggle('active', x === b));
    legend(); colorTube();
  }));
  $('v3d-hgl').addEventListener('change', (e) => { hglGroup.visible = e.target.checked; });
  $('v3d-labels').addEventListener('change', (e) => { labelsOn = e.target.checked; });
  $('v3d-exag').addEventListener('change', (e) => {
    EXAG = Number(e.target.value);
    $('v3d-exag-v').textContent = EXAG;
    applyExag(); buildTube(); buildStations(); buildValves(); colorTube(); updateHgl();
    if (camMode === 'corredor') corridorView(false);
  });
  $('v3d-exag').addEventListener('input', (e) => { $('v3d-exag-v').textContent = e.target.value; });

  function resize() {
    const w = host.clientWidth, h = host.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize);

  // ---------- construir ----------
  buildTerrain();
  buildTube();
  buildStations();
  buildValves();
  legend();
  corridorView(true);
  resize();
  $('v3d-loading').hidden = true;

  let visible = app.view === 'vista-3d';
  let acc = 0, accSlow = 0, blinkT = 0, blink = false;
  const view = {
    onShow(v) { visible = v; if (v) setTimeout(resize, 0); },
    update(dt) {
      if (!visible) return;
      const S = sim.state;
      acc += dt; accSlow += dt; blinkT += dt;
      if (blinkT > 0.5) { blinkT = 0; blink = !blink; }
      if (acc > 0.15) { acc = 0; colorTube(); updateHgl(); }
      if (accSlow > 0.5) { accSlow = 0; updateStations(blink); updateSky(); renderStationCard(); }
      // flujo visible
      const q = S.segmentFlows.ph || 0;
      const running = S.running !== false;
      if (running) stripeTex.offset.x -= dt * (q / 650) * 1.4;
      // pig
      if (S.pig && S.pig.active) {
        const p = geo.posAt(S.pig.pkKm || 0);
        pig.visible = true;
        pig.position.set(p.x, H(geo.elevAt(S.pig.pkKm || 0)) + 0.35 * K, p.z);
        const s = 1 + Math.sin(performance.now() / 180) * 0.15;
        pig.scale.setScalar(s);
        pig.material.color.set(S.pig.stuck ? '#ff5a52' : '#ffb347');
        if (pigLabel) pigLabel.sp.position.set(pig.position.x, pig.position.y + 5 * K, pig.position.z);
      } else pig.visible = false;
      tracer.visible = camMode === 'seguir' && !(S.pig && S.pig.active);
      updateRupture(dt);
      if (fly) {
        fly.t += dt / fly.dur;
        const k = fly.t >= 1 ? 1 : 1 - Math.pow(1 - fly.t, 3);
        camera.position.lerpVectors(fly.fromP, fly.toP, k);
        controls.target.lerpVectors(fly.fromT, fly.toT, k);
        if (fly.t >= 1) fly = null;
      } else if (camMode === 'cine') cineUpdate(dt);
      else if (camMode === 'seguir') followUpdate(dt);
      controls.update();
      const dist = camera.position.distanceTo(controls.target);
      scene.fog.near = dist * 0.9;
      scene.fog.far = dist * 2.8 + 60;
      renderer.render(scene, camera);
    },
    selectStation,
  };
  updateStations(false);
  updateSky();
  colorTube();
  updateHgl();
  app.view3d = view;
  app.snapshot3d = () => { try { renderer.render(scene, camera); return renderer.domElement.toDataURL('image/jpeg', 0.85); } catch (e) { return null; } };
}

function boot() {
  const app = window.APP;
  try {
    start(app);
  } catch (err) {
    console.error(err);
    const l = $('v3d-loading');
    if (l) { l.hidden = false; l.textContent = 'No se pudo iniciar la vista 3D en este dispositivo (WebGL). La sala de control funciona igual.'; }
  }
}
if (window.APP && window.APP.sim) setTimeout(boot, 0);
else window.addEventListener('app-ready', () => setTimeout(boot, 0), { once: true });
