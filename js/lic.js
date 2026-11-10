/* Oleoducto Beta · planes y licencias.
   La licencia es un token firmado (ECDSA P-256 / SHA-256): "payload.firma" en base64url.
   La app solo tiene la clave pública: verifica la firma y la fecha de vencimiento sin servidor.
   Los tokens se generan con el generador privado (no se publica). */
(function (global) {
  'use strict';
  // ---------- configuración comercial (editable) ----------
  const CFG = {
    contacto: { wa: '5492996112271', waTxt: '+54 9 299 611-2271', mail: 'raul.rodriguez@vacamuertaen3d.com' },
    tc: 'Tipo de cambio de referencia: dólar oficial BNA venta del día. Se puede pagar en pesos.',
    individual: [
      { id: 'm1', label: '1 mes', meses: 1, precio: '$ 10.000', nota: '' },
      { id: 'm3', label: '3 meses', meses: 3, precio: '$ 27.000', nota: '≈ $ 9.000/mes' },
      { id: 'm6', label: '6 meses', meses: 6, precio: '$ 51.000', nota: '≈ $ 8.500/mes' },
      { id: 'm12', label: '1 año', meses: 12, precio: '$ 96.000', nota: '≈ $ 8.000/mes · ahorrás 20 %' },
    ],
    institucional: [
      { id: 'm1', label: '1 mes', meses: 1, precio: 'USD 69', nota: '' },
      { id: 'm3', label: '3 meses', meses: 3, precio: 'USD 192', nota: '≈ USD 64/mes' },
      { id: 'm6', label: '6 meses', meses: 6, precio: 'USD 354', nota: '≈ USD 59/mes' },
      { id: 'm12', label: '1 año', meses: 12, precio: 'USD 640', nota: '≈ USD 53/mes · ahorrás 23 %' },
    ],
    empresa: [
      { id: 'm1', label: '1 mes', meses: 1, precio: 'USD 149', nota: '' },
      { id: 'm3', label: '3 meses', meses: 3, precio: 'USD 399', nota: '≈ USD 133/mes' },
      { id: 'm6', label: '6 meses', meses: 6, precio: 'USD 749', nota: '≈ USD 125/mes' },
      { id: 'm12', label: '1 año', meses: 12, precio: 'USD 1.390', nota: '≈ USD 116/mes · ahorrás 22 %' },
    ],
    // links de pago opcionales (Mercado Pago u otro). Vacío = se contrata por WhatsApp o mail.
    pago: { individual: {}, institucional: {}, empresa: {} },
  };
  const PUB = { kty: 'EC', crv: 'P-256', x: 'TXvUHT1tElEG9iFDPvE_lcSuF7zefnvTz6R2N0tFLeY', y: 'wuWtHBdT5EOnXEDA9gBWxKW2rA8cwaVvuigfm0rTI6Q', ext: true, key_ops: ['verify'] };
  const K = { lic: 'ob.lic', al: 'ob.lic.alumnos' };
  const store = {
    get: (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* sin almacenamiento */ } },
    del: (k) => { try { localStorage.removeItem(k); } catch (e) { /* idem */ } },
  };
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const b64u = (t) => Uint8Array.from(atob(t.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((t.length + 3) % 4)), (c) => c.charCodeAt(0));
  const fdate = (sec) => new Date(sec * 1000).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' });

  async function verify(tok) {
    try {
      const [a, b] = String(tok || '').trim().split('.');
      if (!a || !b || !global.crypto || !crypto.subtle) return null;
      const key = await crypto.subtle.importKey('jwk', PUB, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
      const ok = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, b64u(b), new TextEncoder().encode(a));
      if (!ok) return null;
      const p = JSON.parse(new TextDecoder().decode(b64u(a)));
      if (!p || p.p !== 'ob' || !(p.exp * 1000 > Date.now())) return null;
      return p;
    } catch (e) { return null; }
  }

  // ---------- qué incluye cada plan ----------
  const PAID = ['individual', 'institucional', 'empresa', 'curso', 'admin'];
  const FEAT = {
    'scada:control': 'pro', 'scada:equipos': 'pro', 'scada:arranque': 'pro', 'scada:cierres': 'pro', 'scada:custody': 'pro',
    'fallas': 'pro', 'turno': 'pro', 'certificado': 'pro', 'constructor:simular': 'pro',
    'docente': 'inst',
  };
  const FNAME = {
    'scada:control': 'Control PID (faceplate)', 'scada:equipos': 'SCADA de equipos', 'scada:arranque': 'Reinicio y arranque de línea',
    'scada:cierres': 'Cierres OMNI', 'scada:custody': 'Custody transfer', fallas: 'Catálogo de fallas programables', turno: 'Turno de 12 horas',
    certificado: 'Certificado con tu nombre', 'constructor:simular': 'Simular ductos propios', docente: 'Panel docente',
  };
  const L = {
    lic: null, alumnos: null, ready: false, CFG, verify,
    plan() { return this.lic ? this.lic.plan : 'gratis'; },
    planName() { return ({ gratis: 'Gratis', individual: 'Individual', institucional: 'Institucional', empresa: 'Empresa', curso: this.lic && this.lic.via === 'empresa' ? 'Personal' : 'Alumno', admin: 'Administrador' })[this.plan()]; },
    can(f) {
      const need = FEAT[f];
      if (!need) return true;
      const p = this.plan();
      if (need === 'inst') return p === 'institucional' || p === 'empresa' || p === 'admin';
      return PAID.includes(p);
    },
    async activate(code) {
      const raw = String(code || '').trim();
      const m = raw.match(/[?&#]licencia=([^&#\s]+)/);
      const parts = decodeURIComponent(m ? m[1] : raw).split('~');
      const p = await verify(parts[0]);
      if (!p) return { ok: false, error: 'El código no es válido o ya venció. Copialo completo, sin espacios.' };
      if (p.plan === 'curso' && this.lic && this.lic.plan !== 'curso') return { ok: true, lic: this.lic, kept: true };
      this.lic = p; store.set(K.lic, parts[0]);
      if (parts[1] && await verify(parts[1])) { this.alumnos = parts[1]; store.set(K.al, parts[1]); } else if (p.plan !== 'institucional' && p.plan !== 'empresa') { this.alumnos = null; store.del(K.al); }
      emit();
      return { ok: true, lic: p };
    },
    remove() { this.lic = null; this.alumnos = null; store.del(K.lic); store.del(K.al); emit(); },
    lockHtml(f, extra) {
      const inst = FEAT[f] === 'inst';
      return `<div class="lic-lock"><div class="lic-lock-i">🔒</div><h3>${esc(FNAME[f] || 'Función')} · ${inst ? 'licencia Institucional o Empresa' : 'licencia Individual, Institucional o Empresa'}</h3><p>${extra ? esc(extra) + ' ' : ''}En la versión gratuita podés usar la vista 3D, la sala de control, el desafío del día y las pantallas principales del SCADA.</p><button type="button" class="x-btn x-btn-hot" data-licplans="1">Ver planes</button></div>`;
    },
    openPlans() { openModal(); },
  };
  const subs = [];
  L.on = (fn) => subs.push(fn);
  function emit() { paintChip(); subs.forEach((fn) => { try { fn(L); } catch (e) { console.error(e); } }); }

  // ---------- interfaz ----------
  function paintChip() {
    let c = document.getElementById('lic-chip');
    if (!c) {
      const host = document.querySelector('.x-clock') || document.querySelector('.b-topnav');
      if (!host) return;
      c = document.createElement('button'); c.type = 'button'; c.id = 'lic-chip'; c.className = 'lic-chip';
      c.addEventListener('click', openModal);
      host.insertBefore(c, host.firstChild);
    }
    const p = L.plan();
    c.dataset.plan = p;
    c.innerHTML = p === 'gratis' ? '<b>Gratis</b><span>Ver planes</span>' : `<b>${esc(L.planName())}</b><span>hasta ${fdate(L.lic.exp)}</span>`;
  }
  const ROWS = [
    ['Vista 3D, sala de control y desafío del día', '✔', '✔', '✔', '✔'],
    ['SCADA: principal, P&ID, integridad, terminal, medición, alarmas', '✔', '✔', '✔', '✔'],
    ['Eventos rápidos de ejemplo', '✔', '✔', '✔', '✔'],
    ['Catálogo de fallas programables con pasos del supervisor', '—', '✔', '✔', '✔'],
    ['Control PID: SP tracking, A/M, rampas, variadores', '—', '✔', '✔', '✔'],
    ['SCADA de equipos: eléctrica, filtros, lubricación, sumideros', '—', '✔', '✔', '✔'],
    ['Reinicio y arranque automático de línea', '—', '✔', '✔', '✔'],
    ['Constructor: ductos propios con plantas, tanques y entregas', '—', '✔', '✔', '✔'],
    ['Rendir evaluaciones', '✔', '✔', '✔', '✔'],
    ['Licencia para alumnos o personal con un link', '—', '—', '✔', '✔'],
    ['Panel de evaluación: preguntas, desafíos, reportes y Excel', '—', '—', '✔', '✔'],
    ['Su ducto real modelado por nosotros (servicio)', '—', '—', '—', '✔'],
    ['Acompañamiento y soporte', '—', '—', 'Primera clase', 'Prioritario'],
  ];
  function planCards(list, kind) {
    return `<div class="lic-plist">${list.map((x) => { const pay = CFG.pago[kind] && CFG.pago[kind][x.id]; return `<div class="lic-pl${x.meses === 12 ? ' best' : ''}"><b>${esc(x.label)}</b><span class="lic-pp">${esc(x.precio)}</span>${x.nota ? `<small>${esc(x.nota)}</small>` : ''}${pay ? `<a class="lic-pay" href="${esc(pay)}" target="_blank" rel="noopener">Pagar</a>` : ''}</div>`; }).join('')}</div>`;
  }
  function openModal() {
    let m = document.getElementById('lic-modal');
    if (!m) { m = document.createElement('div'); m.id = 'lic-modal'; m.className = 'lic-modal'; document.body.appendChild(m); m.addEventListener('click', onModalClick); }
    const p = L.plan(), C = CFG.contacto;
    const PROD = global.OB_LINKS ? 'Oleoducto Constructor' : 'Oleoducto Beta';
    const wa = (t) => `https://wa.me/${C.wa}?text=${encodeURIComponent(t)}`;
    m.innerHTML = `<div class="lic-card" role="dialog" aria-label="Planes"><button type="button" class="lic-x" data-licclose="1" aria-label="Cerrar">✕</button>
      <h2>Elegí tu plan</h2><p class="lic-sub">${PROD} · ${global.OB_LINKS ? 'diseñá tu oleoducto sobre el mapa, simulalo y entrená a tu personal' : 'simulador de entrenamiento de oleoductos con SCADA'}</p>
      ${L.lic ? `<div class="lic-cur">Licencia activa: <b>${esc(L.planName())}</b>${L.lic.sub ? ' · ' + esc(L.lic.sub) : ''} · vence el <b>${fdate(L.lic.exp)}</b>${L.lic.cod ? ` · código ${esc(L.lic.cod)}` : ''}</div>` : ''}
      <div class="lic-grid">
        <div class="lic-col${p === 'gratis' ? ' cur' : ''}"><p class="lic-pn">Gratis</p><p class="lic-pp">$ 0</p><ul><li>Vista 3D y sala de control</li><li>Desafío del día</li><li>Pantallas principales del SCADA</li><li>Eventos rápidos de ejemplo</li><li>Rendir evaluaciones del docente</li></ul>${p === 'gratis' ? '<p class="lic-tag">Tu plan actual</p>' : ''}</div>
        <div class="lic-col hot${p === 'individual' ? ' cur' : ''}"><p class="lic-badge">Para estudiantes y operadores</p><p class="lic-pn">⭐ Individual</p>${planCards(CFG.individual, 'individual')}<p class="lic-m">Todo lo gratis, más:</p><ul><li>Catálogo completo de fallas programables</li><li>Control PID con SP tracking y rampas</li><li>SCADA de equipos y tanques sumidero</li><li>Reinicio y arranque automático de línea</li><li>Turno de 12 h y constructor de ductos</li></ul><a class="x-btn x-btn-hot lic-btn" href="${wa('Hola, quiero la licencia Individual de ' + PROD)}" target="_blank" rel="noopener">Contratar por WhatsApp</a></div>
        <div class="lic-col${p === 'institucional' ? ' cur' : ''}"><p class="lic-pn">🏫 Institucional</p>${planCards(CFG.institucional, 'institucional')}<p class="lic-m">Todo lo de Individual, más:</p><ul><li><b>Licencia para todos los alumnos</b> con un link</li><li><b>Panel docente</b>: banco de preguntas, desafíos en el simulador y evaluaciones</li><li>Reportes por alumno y exportación a Excel</li><li>Acompañamiento en la primera clase</li></ul><a class="x-btn lic-btn" href="${wa('Hola, quiero la licencia Institucional de ' + PROD + ' para mi institución')}" target="_blank" rel="noopener">Contratar por WhatsApp</a><p class="lic-m">Valores desde, según cantidad de alumnos y sedes.</p></div>
        <div class="lic-col${p === 'empresa' ? ' cur' : ''}"><p class="lic-badge">Para operadoras y contratistas</p><p class="lic-pn">🏭 Empresa</p>${planCards(CFG.empresa, 'empresa')}<p class="lic-m">Todo lo de Institucional, más:</p><ul><li><b>Su ducto y sus plantas</b> sobre el mapa real, modelados por nosotros</li><li>Capacitación y evaluación del personal con un link</li><li>Simulacros de fallas y arranques con su propia línea</li><li>Soporte prioritario</li></ul><a class="x-btn lic-btn" href="${wa('Hola, quiero la licencia Empresa de ' + PROD + ' para simular nuestro ducto')}" target="_blank" rel="noopener">Contratar por WhatsApp</a><p class="lic-m">Valores desde, por sitio. El modelado del ducto real se cotiza aparte según su complejidad.</p></div>
      </div>
      <details class="lic-cmp"><summary>Comparar todo en una tabla</summary><table><tr><th></th><th>Gratis</th><th>Individual</th><th>Institucional</th><th>Empresa</th></tr>${ROWS.map((r) => `<tr><td>${esc(r[0])}</td><td>${r[1]}</td><td><b>${r[2]}</b></td><td><b>${r[3]}</b></td><td><b>${r[4]}</b></td></tr>`).join('')}</table></details>
      <p class="lic-m">${esc(CFG.tc)} Para contratar: <a href="${wa('Hola, quiero información de ' + PROD)}" target="_blank" rel="noopener">WhatsApp ${esc(C.waTxt)}</a> o <a href="mailto:${esc(C.mail)}">${esc(C.mail)}</a>. Al confirmar el pago te enviamos el código de licencia o un link que la activa.</p>
      ${L.lic ? '<button type="button" class="x-btn" data-licrm="1">Quitar la licencia de este dispositivo</button>' : ''}
      <details class="lic-act" ${L.lic ? '' : 'open'}><summary>Ya pagué: activar la licencia en este dispositivo</summary><div class="lic-row"><textarea id="lic-code" rows="2" placeholder="Pegá el código de licencia o el link que recibiste"></textarea><button type="button" class="x-btn x-btn-hot" data-licact="1">Activar</button></div><p class="lic-msg" id="lic-msg"></p></details>
    </div>`;
    m.hidden = false; m.scrollTop = 0;
  }
  async function onModalClick(e) {
    const m = document.getElementById('lic-modal');
    if (e.target === m || e.target.closest('[data-licclose]')) { m.hidden = true; return; }
    if (e.target.closest('[data-licrm]')) { L.remove(); toast('Licencia quitada de este dispositivo'); openModal(); return; }
    const a = e.target.closest('[data-licact]');
    if (a) {
      a.disabled = true;
      const r = await L.activate(document.getElementById('lic-code').value);
      a.disabled = false;
      const msg = document.getElementById('lic-msg');
      if (!r.ok) { msg.textContent = r.error; msg.className = 'lic-msg bad'; return; }
      toast(`Licencia ${L.planName()} activada hasta el ${fdate(r.lic.exp)}`);
      openModal();
    }
  }
  function toast(t) { if (global.APP && global.APP.toast) global.APP.toast(t); else { const msg = document.getElementById('lic-msg'); if (msg) msg.textContent = t; } }
  document.addEventListener('click', (e) => { if (e.target.closest && e.target.closest('[data-licplans]')) { e.preventDefault(); openModal(); } });

  // ---------- arranque ----------
  L.whenReady = (async () => {
    const t = store.get(K.lic);
    if (t) { L.lic = await verify(t); if (!L.lic) store.del(K.lic); }
    const al = store.get(K.al);
    if (al && L.lic && (L.lic.plan === 'institucional' || L.lic.plan === 'empresa') && await verify(al)) L.alumnos = al;
    try {
      const u = new URL(location.href), q = u.searchParams.get('licencia');
      if (q) {
        const r = await L.activate(q);
        setTimeout(() => toast(r.ok ? (r.kept ? 'Ya tenés una licencia activa en este dispositivo' : `✔ Licencia ${L.planName()} activada hasta el ${fdate(r.lic.exp)}`) : 'Ese link de licencia no es válido o venció'), 900);
        u.searchParams.delete('licencia');
        history.replaceState(null, '', u.pathname + (u.search || '') + u.hash);
      }
    } catch (e) { /* sin URL */ }
    L.ready = true;
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', emit, { once: true }); else emit();
    return L;
  })();
  global.OBLIC = L;
})(window);
