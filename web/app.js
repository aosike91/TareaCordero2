// Web del demo: consume 2 APIs (Catálogo y Matrícula) exclusivamente a través del API Gateway.
const CFG = window.APP_CONFIG;
const $ = (sel) => document.querySelector(sel);
const estado = { alumno: CFG.alumno, matricula: null, cursos: [], filtro: "" };

// ---------- Cliente HTTP: todas las llamadas pasan por aquí, se registran y se animan ----------
async function api(metodo, ruta, cuerpo, { sinClave = false, silencioso = false } = {}) {
  const headers = { "Accept": "application/json" };
  if (!sinClave) headers["Ocp-Apim-Subscription-Key"] = CFG.subscriptionKey;
  if (cuerpo) headers["Content-Type"] = "application/json";

  const peticion = Flujo.salir(metodo, ruta, cuerpo, sinClave);
  const inicio = performance.now();
  let resp;
  try {
    resp = await fetch(CFG.apiBase + ruta, { method: metodo, headers, body: cuerpo ? JSON.stringify(cuerpo) : undefined });
  } catch (err) {
    const datos = { status: "ERR", ms: performance.now() - inicio };
    Flujo.llegar(peticion, datos);
    registrar(peticion);
    throw new Error(`No se pudo contactar al gateway en ${CFG.apiBase}. Revisa que esté levantado y la configuración CORS.`);
  }
  const gatewayMs = Number.parseFloat(resp.headers.get("X-Gateway-Ms"));
  Flujo.llegar(peticion, {
    status: resp.status,
    ms: performance.now() - inicio,
    correlacion: resp.headers.get("X-Correlation-Id"),
    restante: resp.headers.get("X-RateLimit-Remaining"),
    gatewayMs: Number.isFinite(gatewayMs) ? gatewayMs : null,
    traza: leerTraza(resp),
  });
  registrar(peticion);

  const datos = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    const err = new Error(mensajeDeError(resp.status, datos));
    err.status = resp.status;
    if (!silencioso) throw err;
    return { error: resp.status };
  }
  return datos;
}

function leerTraza(resp) {
  try {
    return JSON.parse(resp.headers.get("X-Traza"));
  } catch {
    return null;
  }
}

function mensajeDeError(status, datos) {
  if (status === 401) return "El gateway rechazó la llamada: falta la clave de suscripción o no es válida.";
  if (status === 429) return "El gateway limitó las peticiones. Espera unos segundos e inténtalo de nuevo.";
  return datos.mensaje || datos.message || `El servicio respondió ${status}.`;
}

// ---------- Registro de tráfico ----------
function registrar(p) {
  const fila = document.createElement("tr");
  fila.className = "nuevo";
  fila.tabIndex = 0;
  fila.title = "Ver de nuevo el recorrido";
  const hora = new Date().toLocaleTimeString("es-PE", { hour12: false });
  fila.innerHTML = `<td>${hora}</td><td>${p.metodo}</td><td></td><td><span class="estado ${Flujo.claseLog(p.status)}">${p.status}</span></td>
    <td>${Math.round(p.ms)}</td><td></td><td></td>`;
  fila.children[2].textContent = p.ruta;
  fila.children[5].textContent = p.correlacion ?? "—";
  fila.children[6].textContent = p.restante ?? "—";
  const repetir = () => Flujo.repetir(p);
  fila.addEventListener("click", repetir);
  fila.addEventListener("keydown", (ev) => { if (ev.key === "Enter") repetir(); });
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

async function retirar(codigo, boton) {
  boton.disabled = true;
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
  const filtro = estado.filtro.toLowerCase();
  const visibles = estado.cursos.filter((c) =>
    !filtro || c.codigo.toLowerCase().includes(filtro) || c.nombre.toLowerCase().includes(filtro));

  if (visibles.length === 0) {
    lista.innerHTML = `<p class="vacio">${estado.cursos.length ? "Ninguna asignatura coincide con la búsqueda." : "Cargando la oferta…"}</p>`;
    return;
  }
  for (const c of visibles) {
    const fila = document.createElement("div");
    fila.className = "tabla__fila";
    fila.setAttribute("role", "row");
    const lleno = c.vacantes_disponibles === 0;
    const yaInscrito = inscritos.has(c.codigo);
    const ocupacion = c.capacidad ? (c.capacidad - c.vacantes_disponibles) / c.capacidad : 0;
    fila.innerHTML = `
      <span role="cell" class="mono codigo"></span>
      <span role="cell" class="nombre"></span>
      <span role="cell" class="num">${c.creditos}</span>
      <span role="cell" class="vacantes ${lleno ? "vacantes--llenas" : ""}">
        <span class="vacantes__barra"><span style="width:${(ocupacion * 100).toFixed(0)}%"></span></span>
        <span class="vacantes__txt">${lleno ? "Sin vacantes" : `${c.vacantes_disponibles} de ${c.capacidad}`}</span>
      </span>
      <span role="cell" class="accion"><button class="btn ${yaInscrito ? "btn--hecho" : "btn--pri"}"></button></span>`;
    fila.querySelector(".codigo").textContent = c.codigo;
    fila.querySelector(".nombre").textContent = c.nombre;
    const btn = fila.querySelector("button");
    btn.textContent = yaInscrito ? "Matriculado" : lleno ? "Lleno" : "Agregar";
    btn.disabled = yaInscrito;
    btn.setAttribute("aria-label", `${btn.textContent}: ${c.nombre}`);
    btn.addEventListener("click", () => agregar(c.codigo, btn));
    lista.append(fila);
  }
}

function pintarMatricula() {
  const m = estado.matricula ?? { id: null, cursos: [], total_creditos: 0, max_creditos: 22 };
  $("#dato-alumno").textContent = estado.alumno;
  $("#dato-ciclo").textContent = CFG.ciclo;
  const registrada = m.cursos.length > 0;
  const est = $("#dato-estado");
  est.textContent = registrada ? "Matrícula registrada" : "Sin matrícula";
  est.classList.toggle("estado-matricula--ok", registrada);

  $("#total-creditos").textContent = m.total_creditos;
  $("#max-creditos").textContent = m.max_creditos;
  $("#total-ficha").textContent = m.total_creditos;
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
    lista.innerHTML = '<p class="vacio">Aún no tienes asignaturas. Agrégalas desde la oferta.</p>';
  }
  for (const c of m.cursos) {
    const fila = document.createElement("div");
    fila.className = "tabla__fila";
    fila.setAttribute("role", "row");
    fila.innerHTML = `<span role="cell" class="mono codigo"></span><span role="cell" class="nombre"></span>
      <span role="cell" class="num"></span><span role="cell" class="accion"><button class="btn-texto">Retirar</button></span>`;
    fila.querySelector(".codigo").textContent = c.codigo;
    fila.querySelector(".nombre").textContent = c.nombre;
    fila.querySelector(".num").textContent = c.creditos;
    const btn = fila.querySelector("button");
    btn.setAttribute("aria-label", `Retirar ${c.nombre}`);
    btn.addEventListener("click", () => retirar(c.codigo, btn));
    lista.append(fila);
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

async function probarInvalido() {
  try {
    await api("GET", `/matricula/matriculas/123/${CFG.ciclo}`);
    avisar("El gateway dejó pasar un código inválido.");
  } catch (err) {
    avisar(`${err.message} (rechazado por la validación del gateway)`);
  }
}

// ---------- Arranque ----------
async function iniciar() {
  Flujo.iniciar();
  document.title = `Matrícula ${CFG.ciclo} · Demo API Management`;
  $("#api-base").textContent = CFG.apiBase;
  $("#alumno").value = estado.alumno;

  $("#form-alumno").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    estado.alumno = $("#alumno").value.trim();
    $("#aviso").hidden = true;
    await cargarMatricula().catch((err) => avisar(err.message));
  });
  $("#buscar").addEventListener("input", (ev) => { estado.filtro = ev.target.value.trim(); pintarCursos(); });
  $("#recargar").addEventListener("click", () => cargarCursos().catch((err) => avisar(err.message)));
  $("#imprimir").addEventListener("click", () => window.print());
  $("#probar-limite").addEventListener("click", probarLimite);
  $("#probar-sin-clave").addEventListener("click", probarSinClave);
  $("#probar-invalido").addEventListener("click", probarInvalido);
  $("#limpiar").addEventListener("click", () => { $("#log").innerHTML = ""; });

  pintarMatricula();
  await Promise.all([cargarCursos(), cargarMatricula()]).catch((err) => avisar(err.message));
}

iniciar();
