// Configuración por defecto para docker compose (gateway local).
// En la nube, el contenedor la regenera desde variables de entorno (ver docker-entrypoint).
window.APP_CONFIG = {
  apiBase: "http://localhost:8080",
  subscriptionKey: "demo-key-local",
  ciclo: "2026-II",
  alumno: "20200123"
};
