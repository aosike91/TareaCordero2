#!/bin/sh
# Genera config.js desde variables de entorno (útil al desplegar en la nube).
# Si API_BASE no está definido, se conserva el config.js por defecto (gateway local).
set -e
if [ -n "$API_BASE" ]; then
  cat > /usr/share/nginx/html/config.js <<CFG
window.APP_CONFIG = {
  apiBase: "${API_BASE}",
  subscriptionKey: "${SUBSCRIPTION_KEY}",
  ciclo: "${CICLO:-2026-II}",
  alumno: "${ALUMNO_DEMO:-20200123}"
};
CFG
fi
