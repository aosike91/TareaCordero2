// Web del demo: consume 2 APIs (Catálogo y Matrícula) exclusivamente a través del API Gateway.
const CFG = window.APP_CONFIG;
const $ = (sel) => document.querySelector(sel);
const estado = { alumno: CFG.alumno, matricula: null, cursos: [] };

// ---------- Cliente HTTP: todas las llamadas pasan por aquí y quedan registradas ----------
async function api(metodo, ruta, cuerpo, { sinClave = false, silencioso = false } = {}) {
  const headers = { "Accept": "application/json" };
  if (!sinClave) headers["Ocp-Apim-Subscription-Key"] = CFG.subscriptionKey;
  if (cuerpo) headers["Content-Type"] = "application/json";

  const inicio = performance.now();
  let resp;
  try {
    resp = await fetch(CFG.apiBase + ruta, { method: metodo, headers, body: cuerpo ? JSON.stringify(cuerpo) : undefined });
  } catch (err) {
    registrar({ metodo, ruta, status: "ERR", ms: performance.now() - inicio });
    throw new Error(`No se pudo contactar al gateway en ${CFG.apiBase}. Revisa que esté levantado y la configuración CORS.`);
  }
  registrar({
    metodo, ruta, status: resp.status, ms: performance.now() - inicio,
    correlacion: resp.headers.get("X-Correlation-Id"),
    restante: resp.headers.get("X-RateLimit-Remaining"),
  });

  const datos = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    const err = new Error(mensajeDeError(resp.status, datos));
    err.status = resp.status;
    if (!silencioso) throw err;
    return { error: resp.status };
  }
  return datos;
}

function mensajeDeError(status, datos) {
  if (status === 401) return "El gateway rechazó la llamada: falta la clave de suscripción o no es válida.";
  if (status === 429) return "El gateway limitó las peticiones. Espera unos segundos e inténtalo de nuevo.";
  return datos.mensaje || datos.message || `El servicio respondió ${status}.`;
}

// ---------- Registro de tráfico ----------
function registrar({ metodo, ruta, status, ms, correlacion, restante }) {
  const fila = document.createElement("tr");
  fila.className = "nuevo";
  const clase = status === 429 ? "s429" : String(status)[0] === "2" ? "s2" : String(status)[0] === "5" || status === "ERR" ? "s5" : "s4";
  const hora = new Date().toLocaleTimeString("es-PE", { hour12: false });
  fila.innerHTML = `<td>${hora}</td><td>${metodo}</td><td></td><td><span class="estado ${clase}">${status}</span></td>
    <td>${Math.round(ms)}</td><td>${correlacion ?? "—"}</td><td>${restante ?? "—"}</td>`;
  fila.children[2].textContent = ruta;
  $("#log").prepend(fila);
}

// ---------- API 1: Catálogo de cursos ----------
async function cargarCursos() {
  estado.cursos = await api("GET", "/catalogo/cursos");
  pintarCursos();
}

// ---------- API 2: Matrícula ----------
const rutaMatricula = () => `/matricula/matriculas/${estado.alumno}/${CFG.ciclo}`;

async function cargarMatricula() {
  estado.matricula = await api("GET", rutaMatricula());
  pintarMatricula();
}

async function agregar(codigo, boton) {
  boton.disabled = true;
  try {
    estado.matricula = await api("POST", `${rutaMatricula()}/cursos`, { codigo_curso: codigo });
    avisar(`Agregaste ${codigo} a tu matrícula.`, true);
  } catch (err) {
    avisar(err.message);
  } finally {
    pintarMatricula();
    await cargarCursos().catch(() => {});
  }
}

async function retirar(codigo) {
  try {
    estado.matricula = await api("DELETE", `${rutaMatricula()}/cursos/${codigo}`);
    avisar(`Retiraste ${codigo} de tu matrícula.`, true);
  } catch (err) {
    avisar(err.message);
  } finally {
    pintarMatricula();
    await cargarCursos().catch(() => {});
  }
}

// ---------- Pintado ----------
function pintarCursos() {
  const lista = $("#lista-cursos");
  lista.innerHTML = "";
  const inscritos = new Set((estado.matricula?.cursos ?? []).map((c) => c.codigo));
  for (const c of estado.cursos) {
    const li = document.createElement("li");
    li.className = "curso";
    const lleno = c.vacantes_disponibles === 0;
    const yaInscrito = inscritos.has(c.codigo);
    li.innerHTML = `
      <span class="curso__codigo"></span>
      <span class="curso__nombre"></span>
      <span class="curso__detalle">${c.creditos} créditos · ${lleno
        ? '<span class="lleno">Sin vacantes</span>'
        : `${c.vacantes_disponibles} de ${c.capacidad} vacantes`}</span>
      <button class="btn ${yaInscrito ? "btn--sec" : "btn--pri"}">${yaInscrito ? "Matriculado" : "Agregar"}</button>`;
    li.querySelector(".curso__codigo").textContent = c.codigo;
    li.querySelector(".curso__nombre").textContent = c.nombre;
    const btn = li.querySelector("button");
    btn.disabled = yaInscrito;
    btn.setAttribute("aria-label", `Agregar ${c.nombre}`);
    btn.addEventListener("click", () => agregar(c.codigo, btn));
    lista.append(li);
  }
}

function pintarMatricula() {
  const m = estado.matricula ?? { cursos: [], total_creditos: 0, max_creditos: 22 };
  $("#total-creditos").textContent = m.total_creditos;
  $("#max-creditos").textContent = m.max_creditos;
  const barra = $("#barra-creditos");
  barra.innerHTML = "";
  barra.style.gridTemplateColumns = `repeat(${m.max_creditos}, 1fr)`;
  for (let i = 0; i < m.max_creditos; i++) {
    const s = document.createElement("span");
    if (i < m.total_creditos) s.className = "lleno";
    barra.append(s);
  }
  barra.setAttribute("aria-label", `${m.total_creditos} de ${m.max_creditos} créditos`);

  const lista = $("#lista-matricula");
  lista.innerHTML = "";
  if (m.cursos.length === 0) {
    lista.innerHTML = '<li class="vacio">Aún no tienes cursos. Agrega uno desde la lista de cursos ofertados.</li>';
  }
  for (const c of m.cursos) {
    const li = document.createElement("li");
    li.className = "inscrito";
    li.innerHTML = `<div><strong></strong><small></small></div><button class="btn-texto">Retirar</button>`;
    li.querySelector("strong").textContent = c.nombre;
    li.querySelector("small").textContent = `${c.codigo} · ${c.creditos} créditos`;
    li.querySelector("button").addEventListener("click", () => retirar(c.codigo));
    lista.append(li);
  }
  pintarCursos();
}

function avisar(texto, ok = false) {
  const el = $("#aviso");
  el.textContent = texto;
  el.className = ok ? "aviso ok" : "aviso";
  el.hidden = false;
}

// ---------- Pruebas del gateway ----------
async function probarLimite() {
  const boton = $("#probar-limite");
  boton.disabled = true;
  const llamadas = Array.from({ length: 25 }, () => api("GET", "/catalogo/cursos", null, { silencioso: true }));
  const resultados = await Promise.all(llamadas);
  const bloqueadas = resultados.filter((r) => r?.error === 429).length;
  avisar(bloqueadas
    ? `El gateway bloqueó ${bloqueadas} de 25 peticiones con 429 (rate limiting).`
    : "Las 25 peticiones pasaron. Repite la prueba para superar el límite.", bloqueadas === 0);
  boton.disabled = false;
}

async function probarSinClave() {
  try {
    await api("GET", "/catalogo/cursos", null, { sinClave: true });
    avisar("La llamada sin clave pasó: revisa que la suscripción sea obligatoria en el gateway.");
  } catch (err) {
    avisar(err.message);
  }
}

// ---------- Arranque ----------
async function iniciar() {
  $("#ciclo").textContent = CFG.ciclo;
  $("#api-base").textContent = CFG.apiBase;
  $("#alumno").value = estado.alumno;

  $("#form-alumno").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    estado.alumno = $("#alumno").value.trim();
    $("#aviso").hidden = true;
    await cargarMatricula().catch((err) => avisar(err.message));
  });
  $("#recargar").addEventListener("click", () => cargarCursos().catch((err) => avisar(err.message)));
  $("#probar-limite").addEventListener("click", probarLimite);
  $("#probar-sin-clave").addEventListener("click", probarSinClave);
  $("#limpiar").addEventListener("click", () => { $("#log").innerHTML = ""; });

  pintarMatricula();
  await Promise.all([cargarCursos(), cargarMatricula()]).catch((err) => avisar(err.message));
}

iniciar();
