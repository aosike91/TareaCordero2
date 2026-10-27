// Web del demo: consume 2 APIs (Catálogo y Matrícula) exclusivamente a través del API Gateway.
const CFG = window.APP_CONFIG;
const $ = (sel) => document.querySelector(sel);
const estado = { alumno: CFG.alumno, matricula: null, cursos: [], filtro: "", seleccion: new Map(), procesando: false };

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

// ---------- Selección y confirmación en lote ----------
const creditosSeleccion = () => [...estado.seleccion.values()].reduce((s, c) => s + c.creditos, 0);
const maxCreditos = () => estado.matricula?.max_creditos ?? 22;
const creditosActuales = () => estado.matricula?.total_creditos ?? 0;
const plural = (n, uno, varios) => `${n} ${n === 1 ? uno : varios}`;

function alternar(curso, marcado) {
  if (marcado) estado.seleccion.set(curso.codigo, curso);
  else estado.seleccion.delete(curso.codigo);
  pintarCursos();
  pintarSeleccion();
}

function pintarSeleccion() {
  const n = estado.seleccion.size;
  const cr = creditosSeleccion();
  $("#resumen-seleccion").innerHTML = n
    ? `<strong>${plural(n, "asignatura seleccionada", "asignaturas seleccionadas")}</strong> · ${cr} créditos`
    : "No has seleccionado asignaturas.";
  $("#resumen-creditos").textContent = n
    ? `Total del periodo al matricularte: ${creditosActuales() + cr} de ${maxCreditos()} créditos`
    : "Marca las casillas de la oferta para armar tu matrícula.";
  const boton = $("#matricularme");
  boton.disabled = n === 0;
  boton.textContent = n ? `Matricularme en ${plural(n, "asignatura", "asignaturas")}` : "Matricularme";
  $("#limpiar-seleccion").hidden = n === 0;
  $("#barra-accion").classList.toggle("barra-accion--activa", n > 0);
  const registrada = (estado.matricula?.cursos.length ?? 0) > 0;
  $("#pasos-tramite").dataset.paso = n ? 2 : registrada ? 3 : 1;
}

function abrirConfirmacion() {
  if (!estado.seleccion.size) return;
  const lista = $("#dlg-lista");
  lista.innerHTML = "";
  for (const c of estado.seleccion.values()) {
    const li = document.createElement("li");
    li.dataset.codigo = c.codigo;
    li.innerHTML = `<span class="mono codigo"></span><span class="dlg-lista__nombre"></span>
      <span class="dlg-lista__cr">${c.creditos} cr.</span><span class="dlg-lista__estado"></span>`;
    li.querySelector(".codigo").textContent = c.codigo;
    li.querySelector(".dlg-lista__nombre").textContent = c.nombre;
    lista.append(li);
  }
  $("#dlg-sub").textContent = `Alumno ${estado.alumno} · Periodo ${CFG.ciclo}`;
  $("#dlg-actuales").textContent = creditosActuales();
  $("#dlg-nuevos").textContent = creditosSeleccion();
  $("#dlg-total").textContent = `${creditosActuales() + creditosSeleccion()} / ${maxCreditos()}`;
  $("#dlg-resultado").hidden = true;
  const confirmar = $("#dlg-confirmar-btn");
  confirmar.hidden = false;
  confirmar.disabled = false;
  confirmar.textContent = `Confirmar ${plural(estado.seleccion.size, "asignatura", "asignaturas")}`;
  $("#dlg-cancelar").textContent = "Cancelar";
  $("#dlg-cancelar").disabled = false;
  $("#dlg-confirmar").showModal();
}

async function confirmarMatricula() {
  estado.procesando = true;
  $("#dlg-confirmar-btn").disabled = true;
  $("#dlg-confirmar-btn").textContent = "Registrando…";
  $("#dlg-cancelar").disabled = true;
  pintarCursos();
  let exitos = 0;
  const fallos = [];
  // El backend registra una asignatura por petición; se envían en orden para que valide créditos y cruces.
  for (const c of [...estado.seleccion.values()]) {
    const li = $(`#dlg-lista li[data-codigo="${CSS.escape(c.codigo)}"]`);
    const marca = li.querySelector(".dlg-lista__estado");
    li.className = "procesando";
    marca.textContent = "Registrando…";
    try {
      estado.matricula = await api("POST", `${rutaMatricula()}/cursos`, { codigo_curso: c.codigo });
      estado.seleccion.delete(c.codigo);
      li.className = "ok";
      marca.textContent = "Matriculado";
      exitos++;
    } catch (err) {
      li.className = "mal";
      marca.textContent = err.message;
      fallos.push(c.codigo);
    }
  }
  estado.procesando = false;

  const resultado = $("#dlg-resultado");
  resultado.hidden = false;
  resultado.className = fallos.length ? "dlg-resultado mal" : "dlg-resultado ok";
  resultado.textContent = fallos.length
    ? `Se registraron ${exitos} de ${exitos + fallos.length} asignaturas. Las que fallaron siguen en tu selección: ${fallos.join(", ")}.`
    : `Tu matrícula quedó registrada con ${plural(exitos, "asignatura", "asignaturas")}.`;
  $("#dlg-confirmar-btn").hidden = true;
  const cerrar = $("#dlg-cancelar");
  cerrar.disabled = false;
  cerrar.textContent = fallos.length ? "Cerrar" : "Ver constancia";
  cerrar.focus();
  if (exitos) avisar(`Matrícula registrada: ${plural(exitos, "asignatura agregada", "asignaturas agregadas")}.`, true);

  pintarMatricula();
  await cargarCursos().catch(() => {});
}

function cerrarConfirmacion() {
  if (estado.procesando) return;
  const verConstancia = $("#dlg-cancelar").textContent === "Ver constancia";
  $("#dlg-confirmar").close();
  if (verConstancia) $("#constancia").scrollIntoView({ behavior: "smooth", block: "start" });
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
  const libres = maxCreditos() - creditosActuales() - creditosSeleccion();
  for (const c of visibles) {
    const fila = document.createElement("label");
    fila.className = "tabla__fila";
    fila.setAttribute("role", "row");
    const lleno = c.vacantes_disponibles === 0;
    const yaInscrito = inscritos.has(c.codigo);
    const elegido = estado.seleccion.has(c.codigo);
    const excede = !elegido && !yaInscrito && !lleno && c.creditos > libres;
    const ocupacion = c.capacidad ? (c.capacidad - c.vacantes_disponibles) / c.capacidad : 0;
    const [etiqueta, clase] = yaInscrito ? ["Matriculado", "ok"] : elegido ? ["Seleccionado", "sel"]
      : lleno ? ["Sin vacantes", "mal"] : excede ? ["Excede créditos", "aviso"] : ["Disponible", "libre"];
    fila.classList.toggle("tabla__fila--elegida", elegido);
    fila.classList.toggle("tabla__fila--bloqueada", yaInscrito || lleno || excede);
    fila.innerHTML = `
      <span role="cell" class="marca"><input type="checkbox"></span>
      <span role="cell" class="mono codigo"></span>
      <span role="cell" class="nombre"></span>
      <span role="cell" class="num">${c.creditos}</span>
      <span role="cell" class="vacantes ${lleno ? "vacantes--llenas" : ""}">
        <span class="vacantes__barra"><span style="width:${(ocupacion * 100).toFixed(0)}%"></span></span>
        <span class="vacantes__txt">${lleno ? "Sin vacantes" : `${c.vacantes_disponibles} de ${c.capacidad}`}</span>
      </span>
      <span role="cell" class="estado-curso"><span class="insignia insignia--${clase}">${etiqueta}</span></span>`;
    fila.querySelector(".codigo").textContent = c.codigo;
    fila.querySelector(".nombre").textContent = c.nombre;
    const casilla = fila.querySelector("input");
    casilla.checked = elegido || yaInscrito;
    casilla.disabled = yaInscrito || lleno || excede || estado.procesando;
    casilla.setAttribute("aria-label", `Seleccionar ${c.codigo} ${c.nombre}`);
    if (excede) fila.title = `Superarías el máximo de ${maxCreditos()} créditos`;
    casilla.addEventListener("change", () => alternar(c, casilla.checked));
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
    lista.innerHTML = '<p class="vacio">Aún no tienes asignaturas matriculadas. Selecciónalas en la oferta y presiona «Matricularme».</p>';
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
  pintarSeleccion();
}

function avisar(texto, ok = false) {
  const el = $("#aviso");
  el.textContent = texto;
  el.className = ok ? "aviso ok" : "aviso";
  el.hidden = false;
}

// ---------- Monitor de arquitectura (se puede ocultar para ver solo la intranet) ----------
function mostrarMonitor(visible) {
  $("#pagina").classList.toggle("pagina--sin-monitor", !visible);
  $("#monitor").inert = !visible;
  $("#trafico").hidden = !visible;
  try { localStorage.setItem("verMonitor", visible ? "1" : "0"); } catch {}
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
  document.title = `Matrícula ${CFG.ciclo} · Intranet Académica`;
  $("#titulo-ciclo").textContent = CFG.ciclo;
  $("#api-base").textContent = CFG.apiBase;
  $("#alumno").value = estado.alumno;

  let verMonitor = true;
  try { verMonitor = localStorage.getItem("verMonitor") !== "0"; } catch {}
  $("#ver-monitor").checked = verMonitor;
  mostrarMonitor(verMonitor);
  $("#ver-monitor").addEventListener("change", (ev) => mostrarMonitor(ev.target.checked));

  $("#form-alumno").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    estado.alumno = $("#alumno").value.trim();
    estado.seleccion.clear();
    $("#aviso").hidden = true;
    await cargarMatricula().catch((err) => avisar(err.message));
  });
  $("#buscar").addEventListener("input", (ev) => { estado.filtro = ev.target.value.trim(); pintarCursos(); });
  $("#recargar").addEventListener("click", () => cargarCursos().catch((err) => avisar(err.message)));
  $("#matricularme").addEventListener("click", abrirConfirmacion);
  $("#limpiar-seleccion").addEventListener("click", () => { estado.seleccion.clear(); pintarCursos(); pintarSeleccion(); });
  $("#dlg-confirmar-btn").addEventListener("click", confirmarMatricula);
  $("#dlg-cancelar").addEventListener("click", cerrarConfirmacion);
  $("#dlg-confirmar").addEventListener("cancel", (ev) => { if (estado.procesando) ev.preventDefault(); });
  $("#imprimir").addEventListener("click", () => window.print());
  $("#probar-limite").addEventListener("click", probarLimite);
  $("#probar-sin-clave").addEventListener("click", probarSinClave);
  $("#probar-invalido").addEventListener("click", probarInvalido);
  $("#limpiar").addEventListener("click", () => { $("#log").innerHTML = ""; });

  pintarMatricula();
  await Promise.all([cargarCursos(), cargarMatricula()]).catch((err) => avisar(err.message));
}

iniciar();
