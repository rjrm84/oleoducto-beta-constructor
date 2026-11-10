/* Carga un ducto a medida (?ducto=ID) desde la biblioteca del navegador antes de iniciar el simulador. */
(function () {
  'use strict';
  var id = null;
  try { id = new URLSearchParams(location.search).get('ducto'); } catch (e) { id = null; }
  if (!id || !window.PIPEGEN) return;
  var spec = window.PIPEGEN.lib.get(id);
  if (!spec) { window.CUSTOM_ERROR = 'No se encontró el ducto "' + id + '" en este navegador. Abrilo desde el Constructor o importá su archivo .json.'; return; }
  try {
    spec = window.PIPEGEN.normalize(spec);
    var cfg = window.PIPEGEN.generateConfig(spec);
    cfg._meta.specVersion = spec.updatedAt || 0;
    window.CUSTOM_SPEC = spec;
    window.CUSTOM_CONFIG = cfg;
  } catch (e) {
    window.CUSTOM_ERROR = 'No se pudo generar el ducto: ' + e.message;
  }
})();
