// Arquitectura en vivo: anima el recorrido de cada petición sobre el diagrama.
// La salida del navegador se dibuja en tiempo real; lo que pasa dentro de Azure se
// reproduce con la traza real que devuelven los servicios (X-Traza) y APIM (X-Gateway-Ms).
const Flujo = (() => {
  const NS = "http://www.w3.org/2000/svg";
  const svg = document.querySelector("#diagrama");
  const capa = svg.querySelector("#capa-paquetes");
  const NOMBRE = {
    nav: "Navegador", apim: "APIM", cursos: "cursos-service", matricula: "matricula-service",
    db_cursos: "SQLite cursos", db_matricula: "SQLite matrículas",
  };
  const SERVICIO_DE_RUTA = { catalogo: "cursos", matricula: "matricula" };
  const reducido = matchMedia("(prefers-reduced-motion: reduce)").matches;

  let velocidad = 1;
  let enVuelo = 0;
  const cola = [];
  let reproduciendo = false;
  let omitir = false;

  // ---------- Primitivas de animación ----------
  const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
  // Con varias peticiones en cola se acelera para no quedar atrás (p. ej., la prueba de límite).
  const ritmo = (base) => (reducido || omitir ? 0 : base / velocidad / Math.min(1 + cola.length * 0.8, 8));

  function arista(de, a) {
    const ida = svg.querySelector(`#e-${de}-${a}`);
    return ida ? [ida, 1] : [svg.querySelector(`#e-${a}-${de}`), -1];
  }

  function viajar(de, a, { tipo = "ida", texto = "", tiempoReal = false } = {}) {
    const [camino, sentido] = arista(de, a);
    const largo = camino.getTotalLength();
    const paquete = document.createElementNS(NS, "g");
    paquete.setAttribute("class", `paquete paquete--${tipo}`);
    paquete.innerHTML = `<circle r="7"/><text y="-12" text-anchor="middle"></text>`;
    paquete.querySelector("text").textContent = texto;
    capa.append(paquete);
    camino.classList.add("activa");
    const total = tiempoReal ? (reducido ? 0 : 450) : ritmo(650);
    return new Promise((listo) => {
      const t0 = performance.now();
      const cuadro = (ahora) => {
        const p = total ? Math.min((ahora - t0) / total, 1) : 1;
        const e = p < 0.5 ? 2 * p * p : 1 - (-2 * p + 2) ** 2 / 2;
        const punto = camino.getPointAtLength((sentido > 0 ? e : 1 - e) * largo);
        paquete.setAttribute("transform", `translate(${punto.x} ${punto.y})`);
        if (p < 1) return requestAnimationFrame(cuadro);
        paquete.remove();
        camino.classList.remove("activa");
        listo();
      };
      requestAnimationFrame(cuadro);
    });
  }

  const nodo = (id) => svg.querySelector(`#n-${id}`);
  const encender = (id, clase = "activo") => nodo(id)?.classList.add(clase);

  function chip(id, estado) {
    const el = svg.querySelector(`#chip-${id}`);
    el.classList.remove("ok", "mal");
    if (estado) el.classList.add(estado);
  }

  async function operarDb(db, paso) {
    const etiqueta = svg.querySelector(`#op-${db}`);
    const texto = `${paso.op} · ${paso.ms} ms`;
    etiqueta.textContent = texto.length > 36 ? texto.slice(0, 35) + "…" : texto;
    etiqueta.classList.toggle("mal", paso.ok === false);
    encender(db, "escribiendo");
    await esperar(ritmo(550));
    nodo(db).classList.remove("escribiendo");
  }

  function limpiarDiagrama() {
    svg.querySelectorAll(".nodo").forEach((n) => n.classList.remove("activo", "escribiendo", "fallo"));
    ["clave", "limite", "ruta", "cors"].forEach((c) => chip(c, null));
    svg.querySelectorAll(".db__op").forEach((t) => { t.textContent = ""; });
  }

  // ---------- Guion: lista de pasos narrados, cada uno con su animación ----------
  const claseDeEstado = (st) =>
    st === "ERR" || st >= 500 ? "error" : st === 429 ? "limite" : st >= 400 ? "error" : "vuelta";

  function pasosDeServicio(guion, traza, servicio, nivel) {
    guion.push({
      txt: `${NOMBRE[servicio]} atiende la petición`, ms: traza.ms, nivel,
      hacer: () => encender(servicio),
    });
    for (const paso of [...traza.pasos].sort((a, b) => a.t - b.t)) {
      if (paso.a === "db") {
        const db = `db_${servicio}`;
        guion.push({
          txt: `${NOMBRE[servicio]} → ${NOMBRE[db]}`, det: paso.op, ms: paso.ms, nivel: nivel + 1,
          error: paso.ok === false,
          hacer: async () => {
            await viajar(servicio, db, { texto: "SQL" });
            await operarDb(db, paso);
            await viajar(db, servicio, { tipo: paso.ok === false ? "error" : "vuelta" });
          },
        });
      } else {
        const destino = paso.a;
        guion.push({
          txt: `${NOMBRE[servicio]} → ${NOMBRE[destino]} (este-oeste, no pasa por APIM)`, det: paso.op,
          ms: paso.ms, nivel: nivel + 1,
          hacer: () => viajar(servicio, destino, { texto: paso.op.split(" ")[0] }),
        });
        if (paso.sub) pasosDeServicio(guion, paso.sub, destino, nivel + 2);
        const st = paso.st ?? "ERR";
        guion.push({
          txt: `${NOMBRE[destino]} → ${NOMBRE[servicio]}: ${st}`, nivel: nivel + 1, error: st === "ERR" || st >= 400,
          hacer: () => viajar(destino, servicio, { tipo: claseDeEstado(st), texto: String(st) }),
        });
      }
    }
  }

  function armarGuion(p) {
    const guion = [];
    const servicio = SERVICIO_DE_RUTA[p.ruta.split("/")[1]];
    const cuerpo = p.cuerpo ? ` ${JSON.stringify(p.cuerpo)}` : "";
    guion.push({
      txt: `Navegador → APIM: ${p.metodo} ${p.ruta}${cuerpo}`,
      det: p.sinClave ? "sin Ocp-Apim-Subscription-Key" : "con Ocp-Apim-Subscription-Key",
      hacer: () => encender("apim"),
    });

    const responder = (desde, nota) => guion.push({
      txt: `${desde === "apim" ? "APIM" : NOMBRE[desde]} → Navegador: ${p.status}`, det: nota,
      error: p.status >= 400, ms: p.ms,
      hacer: async () => {
        if (desde !== "apim") await viajar(desde, "apim", { tipo: claseDeEstado(p.status), texto: String(p.status) });
        chip("cors", "ok");
        await viajar("apim", "nav", { tipo: claseDeEstado(p.status), texto: String(p.status) });
      },
    });

    if (p.status === "ERR") {
      guion.push({
        txt: "El navegador no recibió respuesta legible", det: "Gateway caído o bloqueo CORS", error: true,
        hacer: () => encender("apim", "fallo"),
      });
      return guion;
    }
    if (p.status === 401) {
      guion.push({
        txt: "APIM rechaza: falta la clave de suscripción", det: "política de producto · 401", error: true,
        hacer: () => { chip("clave", "mal"); encender("apim", "fallo"); },
      });
      responder("apim", "La petición nunca llegó a los microservicios");
      return guion;
    }
    if (p.status === 429) {
      guion.push({
        txt: "APIM rechaza: límite de 20 llamadas/min superado", det: "rate-limit · 429", error: true,
        hacer: () => { chip("clave", "ok"); chip("limite", "mal"); encender("apim", "fallo"); },
      });
      responder("apim", "La petición nunca llegó a los microservicios");
      return guion;
    }

    guion.push({
      txt: "APIM valida la clave y el límite de peticiones",
      det: p.restante != null ? `quedan ${p.restante} llamadas este minuto` : "políticas del producto",
      hacer: async () => { chip("clave", "ok"); await esperar(ritmo(200)); chip("limite", "ok"); await esperar(ritmo(200)); },
    });

    if (!p.traza || !servicio) {
      guion.push({
        txt: `APIM responde ${p.status} sin llamar al servicio`,
        det: p.status === 400 ? "validación de parámetros en el borde" : "respuesta del gateway",
        error: p.status >= 400,
        hacer: () => { chip("ruta", "mal"); encender("apim", "fallo"); },
      });
      responder("apim");
      return guion;
    }

    guion.push({
      txt: `APIM → ${NOMBRE[servicio]}`, det: "añade X-Gateway-Secret y X-Correlation-Id; quita la clave",
      ms: p.gatewayMs, nivel: 0,
      hacer: async () => { chip("ruta", "ok"); await viajar("apim", servicio, { texto: p.metodo }); },
    });
    pasosDeServicio(guion, p.traza, servicio, 1);
    responder(servicio, "APIM agrega cabeceras CORS y X-Correlation-Id");
    return guion;
  }

  // ---------- Panel de detalle ----------
  const $ = (sel) => document.querySelector(sel);

  function pintarDetalle(p, guion) {
    const estadoTxt = p.status === "ERR" ? "sin respuesta" : p.status;
    $("#detalle-titulo").innerHTML = `<span class="mono"></span> <span class="estado ${claseLog(p.status)}"></span> <span class="tenue"></span>`;
    const [ruta, estado, ms] = $("#detalle-titulo").children;
    ruta.textContent = `${p.metodo} ${p.ruta}`;
    estado.textContent = estadoTxt;
    ms.textContent = `${Math.round(p.ms)} ms en total`;

    const tiempos = $("#tiempos");
    if (p.traza) {
      const servicioMs = p.traza.ms;
      const apimMs = p.gatewayMs != null ? Math.max(p.gatewayMs - servicioMs, 0) : null;
      const redMs = Math.max(p.ms - (p.gatewayMs ?? servicioMs), 0);
      const tramos = [["Internet", redMs, "red"], ...(apimMs != null ? [["APIM", apimMs, "apim"]] : []), ["Microservicios", servicioMs, "svc"]];
      const suma = tramos.reduce((s, t) => s + t[1], 0) || 1;
      tiempos.innerHTML = `<div class="tiempos__barra">${tramos.map(([, v, c]) =>
        `<span class="t-${c}" style="flex-grow:${Math.max(v / suma, 0.015)}"></span>`).join("")}</div>
        <ul class="tiempos__leyenda">${tramos.map(([n, v, c]) =>
          `<li><i class="t-${c}"></i>${n} <b>${v.toFixed(1)} ms</b></li>`).join("")}</ul>`;
      tiempos.hidden = false;
    } else {
      tiempos.hidden = true;
    }

    const lista = $("#pasos");
    lista.innerHTML = "";
    guion.forEach((g) => {
      const li = document.createElement("li");
      li.style.setProperty("--nivel", g.nivel ?? 0);
      if (g.error) li.classList.add("mal");
      li.innerHTML = `<span class="pasos__txt"></span><span class="pasos__ms"></span><small></small>`;
      li.children[0].textContent = g.txt;
      li.children[1].textContent = g.ms != null ? `${Number(g.ms).toFixed(1)} ms` : "";
      li.children[2].textContent = g.det ?? "";
      lista.append(li);
      g.li = li;
    });
  }

  function claseLog(status) {
    return status === 429 ? "s429" : String(status)[0] === "2" ? "s2" : String(status)[0] === "5" || status === "ERR" ? "s5" : "s4";
  }

  function actualizarCola() {
    $("#pendientes").textContent = cola.length;
    $("#omitir").hidden = cola.length < 2;
  }

  // ---------- Reproducción ----------
  async function reproducir(p) {
    await p.salida;
    limpiarDiagrama();
    const guion = armarGuion(p);
    pintarDetalle(p, guion);
    for (const g of guion) {
      g.li.classList.add("actual");
      const lista = g.li.parentElement; // solo se desplaza la lista, no la página
      lista.scrollTop = g.li.offsetTop - lista.clientHeight / 2;
      await g.hacer();
      await esperar(ritmo(160));
      g.li.classList.replace("actual", "hecho");
    }
    await esperar(ritmo(500));
  }

  async function bucle() {
    reproduciendo = true;
    while (cola.length) {
      const p = cola.shift();
      if (!cola.length) omitir = false; // la última petición se muestra completa
      actualizarCola();
      await reproducir(p);
    }
    reproduciendo = false;
    limpiarDiagrama();
    if (enVuelo) encender("apim");
  }

  function encolar(p) {
    cola.push(p);
    actualizarCola();
    if (!reproduciendo) bucle();
  }

  // ---------- API pública ----------
  return {
    /** Se llama justo antes del fetch: el paquete sale del navegador en tiempo real. */
    salir(metodo, ruta, cuerpo, sinClave) {
      enVuelo++;
      encender("apim");
      const p = { metodo, ruta, cuerpo, sinClave };
      p.salida = viajar("nav", "apim", { texto: metodo, tiempoReal: true });
      return p;
    },
    /** Se llama al recibir la respuesta con lo que reportaron gateway y servicios. */
    llegar(p, datos) {
      enVuelo--;
      Object.assign(p, datos);
      encolar(p);
    },
    repetir(p) {
      encolar({ ...p, salida: viajar("nav", "apim", { texto: p.metodo, tiempoReal: true }) });
    },
    iniciar() {
      $("#n-nav-sub").textContent = location.host || "web local";
      document.querySelectorAll('input[name="vel"]').forEach((r) =>
        r.addEventListener("change", () => { velocidad = Number(r.value); }));
      $("#omitir").addEventListener("click", () => {
        omitir = true;
        cola.splice(0, Math.max(cola.length - 1, 0));
        actualizarCola();
      });
    },
    claseLog,
  };
})();
