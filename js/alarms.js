/* Gestor de alarmas estilo ISA-18.2: prioridades, reconocimiento, retorno a normal, sonido. */
(function (global) {
  'use strict';

  function createAlarmManager(sim) {
    const list = new Map(); // id -> alarma
    const hist = [];
    function stampFull() {
      try { const d = sim.state.simDate; return d.toLocaleDateString('es-AR') + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0') + ':' + String(d.getSeconds()).padStart(2, '0'); } catch (e) { return ''; }
    }
    function log(ev, al) {
      hist.unshift({ when: stampFull(), ev, prio: al.prio, tag: al.tag, text: al.text });
      if (hist.length > 2000) hist.pop();
    }
    const listeners = [];
    let audioCtx = null;
    let soundOn = false;
    let lastBeep = 0;

    const TAGS = ['PH', 'AC', 'CD', 'ML', 'ES', 'PA', 'RT', 'UG', 'LC'];
    const NAMES = {
      'Puesto Hernández': 'PH', 'Aguas del Carrizo': 'AC', 'Cerro Divisadero': 'CD', 'Malargüe': 'ML',
      'El Sosneado': 'ES', 'Pareditas': 'PA', 'Río Tunuyán': 'RT', 'Ugarteche': 'UG', 'Luján de Cuyo': 'LC',
    };
    // v8: ductos a medida — nombres y siglas desde la configuración
    if (sim.state.config._meta && sim.state.config._meta.custom) {
      for (const k in NAMES) delete NAMES[k];
      TAGS.length = 0;
      for (const s of sim.state.stations) { NAMES[s.name] = s.shortName; TAGS.push(s.shortName); }
    }
    const sources = [];
    function addSource(fn) { sources.push(fn); }
    function tagOf(text) {
      for (const n in NAMES) if (text.indexOf(n) >= 0) return NAMES[n];
      for (const t of TAGS) if (new RegExp('(^|\\W)' + t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(\\W|$)').test(text)) return t;
      const m = text.match(/\b(PH|AC|CD|ML|ES|PA|RT|UG|LC)\b/);
      if (m) return m[1];
      if (/PK\s?\d+/.test(text)) return 'LÍNEA';
      return 'LÍNEA';
    }
    function prioOf(sev, text) {
      if (sev === 'critical') return 1;
      if (sev === 'warn') return /MAOP|P_asp|Llegada/.test(text) ? 2 : 3;
      return 3;
    }
    function clean(text) {
      return text
        .replace(/\s*\((?:operativo \/ no contractual|estim\. entrenamiento)\)/g, '')
        .replace(/tip\. entrenamiento/g, 'típico');
    }

    function simStamp() {
      try {
        const d = sim.state.simDate;
        return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
      } catch (e) { return '--:--'; }
    }

    function beep(prio) {
      if (!soundOn || !audioCtx) return;
      const now = performance.now();
      if (now - lastBeep < 900) return;
      lastBeep = now;
      const t0 = audioCtx.currentTime;
      const tones = prio === 1 ? [880, 660, 880, 660] : prio === 2 ? [660, 660] : [520];
      tones.forEach((f, i) => {
        const o = audioCtx.createOscillator();
        const g = audioCtx.createGain();
        o.type = prio === 1 ? 'square' : 'sine';
        o.frequency.value = f;
        g.gain.setValueAtTime(0.0001, t0 + i * 0.16);
        g.gain.exponentialRampToValueAtTime(prio === 1 ? 0.06 : 0.08, t0 + i * 0.16 + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + i * 0.16 + 0.14);
        o.connect(g).connect(audioCtx.destination);
        o.start(t0 + i * 0.16);
        o.stop(t0 + i * 0.16 + 0.15);
      });
    }

    function enableSound(on) {
      soundOn = !!on;
      if (soundOn && !audioCtx) {
        try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { soundOn = false; }
      }
      if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
      return soundOn;
    }

    function update() {
      let active = sim.state.alarms || [];
      for (const fn of sources) { try { active = active.concat(fn() || []); } catch (e) { /* fuente con error */ } }
      const seen = {};
      let newest = null;
      for (const a of active) {
        seen[a.id] = true;
        let al = list.get(a.id);
        if (!al) {
          const text = clean(a.text);
          al = {
            id: a.id, text, tag: a.tag || tagOf(a.text), prio: prioOf(a.severity, a.text),
            stamp: simStamp(), t: performance.now(), acked: false, active: true, shelved: false,
          };
          list.set(a.id, al);
          log('ALM', al);
          if (!newest || al.prio < newest.prio) newest = al;
        } else {
          al.active = true;
          al.text = clean(a.text);
        }
      }
      for (const [id, al] of list) {
        if (!seen[id]) {
          if (al.active) log('RTN', al);
          if (al.acked) list.delete(id);
          else al.active = false; // retorno a normal sin reconocer
        }
      }
      if (newest) {
        beep(newest.prio);
        listeners.forEach((fn) => fn(newest));
      }
    }

    function sorted() {
      return [...list.values()].sort((a, b) =>
        (a.acked - b.acked) || (a.prio - b.prio) || (b.t - a.t));
    }
    function ack(id) {
      const al = list.get(id);
      if (!al) return;
      if (al.acked) return;
      al.acked = true;
      al.ackT = performance.now();
      log('ACK', al);
      if (!al.active) list.delete(id);
      listeners.forEach((fn) => fn(null, al));
    }
    function ackAll() { [...list.keys()].forEach(ack); }
    function newestUnacked() {
      return sorted().find((a) => !a.acked) || null;
    }
    function counts() {
      const c = { p1: 0, p2: 0, p3: 0, total: list.size };
      for (const a of list.values()) if (!a.acked) c['p' + a.prio]++;
      return c;
    }
    function reset() { list.clear(); }
    function on(fn) { listeners.push(fn); }

    return { addSource, history: () => hist, update, sorted, ack, ackAll, newestUnacked, counts, enableSound, on, reset, get soundOn() { return soundOn; } };
  }

  global.createAlarmManager = createAlarmManager;
})(window);
