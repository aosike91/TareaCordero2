// Vercel publica dist/ y genera la configuración del navegador en cada despliegue.
import { cpSync, mkdirSync, writeFileSync } from 'node:fs';

const apiBase = process.env.API_BASE?.replace(/\/$/, '');
const subscriptionKey = process.env.SUBSCRIPTION_KEY;
if (!apiBase?.startsWith('https://') || !subscriptionKey) {
  throw new Error('Configura API_BASE (https://...) y SUBSCRIPTION_KEY en Vercel.');
}

mkdirSync('dist', { recursive: true });
for (const name of ['index.html', 'styles.css', 'flujo.js', 'app.js']) {
  cpSync(name, `dist/${name}`);
}
writeFileSync('dist/config.js', `window.APP_CONFIG = ${JSON.stringify({
  apiBase,
  subscriptionKey,
  ciclo: process.env.CICLO || '2026-II',
  alumno: process.env.ALUMNO_DEMO || '20200123',
})};\n`);
