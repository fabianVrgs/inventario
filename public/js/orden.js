// Lógica de la pantalla "Orden del Día" (formato imprimible).
// Lee la selección hecha en index.html desde sessionStorage, arma el
// formato agrupado por área y controla la impresión + descuento real
// de inventario contra la API.
//
// Esta pantalla también AJUSTA la orden, no solo la muestra. Antes era un
// callejón sin salida: una vez armado el formato, devolver material obligaba
// a volver a la Principal y bajar contadores uno a uno, y una orden ya
// impresa se quedaba pegada en sessionStorage hasta cerrar la pestaña
// (la Principal arranca en limpio, así que no tenía nada que quitar y nunca
// reescribía la clave). Ahora cada línea trae − + ✕, y una orden aplicada
// se declara cerrada con una salida explícita: "Empezar una nueva orden".
//
// El botón de imprimir vive en la .barra-app compartida con las otras dos
// pantallas, así que aquí se oculta el BOTÓN en el estado vacío, nunca la
// barra: la navegación no puede desaparecer.
//
// Antes de emitir hay un <dialog> de confirmación, porque el descuento es
// inmediato y no se deshace desde aquí. Después NO se pregunta nada: el aviso
// previo ya lo dijo, y volver a preguntar sobre algo ya aplicado confunde.

(function () {
  "use strict";

  const CLAVE_SELECCION = "ordenSeleccion";
  const CLAVE_APLICADA = "ordenAplicada";

  // Referencias a elementos del DOM.
  const elEstadoVacio = document.getElementById("estadoVacio");
  const elFormato = document.getElementById("formatoOrden");
  const elFecha = document.getElementById("fechaHoy");
  const elContenidoAreas = document.getElementById("contenidoAreas");
  const elAviso = document.getElementById("avisoFaltantes");
  const elBtnImprimir = document.getElementById("btnImprimirOrden");

  const elAvisoAplicada = document.getElementById("avisoOrdenAplicada");
  const elBtnNuevaOrden = document.getElementById("btnNuevaOrden");

  const elDialogo = document.getElementById("dialogoEmitir");
  const elResumenDescuento = document.getElementById("resumenDescuento");
  const elBtnConfirmarEmision = document.getElementById("btnConfirmarEmision");
  const elBtnCancelarEmision = document.getElementById("btnCancelarEmision");

  const elInputEvento = document.getElementById("inputEvento");
  const elValorEvento = document.getElementById("valorEventoImpreso");
  const elInputResponsable = document.getElementById("inputResponsable");
  const elValorResponsable = document.getElementById("valorResponsableImpreso");

  // La orden ya se aplicó en esta sesión: no se debe volver a descontar.
  // Se guarda tanto en memoria como en sessionStorage por si la página se recarga.
  let ordenAplicada = sessionStorage.getItem(CLAVE_APLICADA) === "true";
  let enviando = false;

  // Selección leída de sessionStorage. Puede venir mal formada o ausente;
  // nunca debe reventar la pantalla.
  let seleccion = leerSeleccion();

  // Tope por producto (id -> existencias reales). `null` mientras la API no
  // haya respondido: sin saber cuánto hay, el + no puede subir nada.
  let topes = null;

  function leerSeleccion() {
    let crudo;
    try {
      crudo = sessionStorage.getItem(CLAVE_SELECCION);
    } catch (e) {
      return [];
    }
    if (!crudo) return [];
    let datos;
    try {
      datos = JSON.parse(crudo);
    } catch (e) {
      return [];
    }
    if (!Array.isArray(datos)) return [];
    // Filtra líneas mal formadas en vez de romper toda la pantalla.
    return datos.filter((item) => {
      return (
        item &&
        typeof item.id_producto === "number" &&
        typeof item.cantidad === "number" &&
        item.cantidad > 0
      );
    });
  }

  // Mismo contrato que la Principal (logica.js): quien escribe la selección
  // borra `ordenAplicada`. Si las líneas cambian, la orden es otra y su
  // descuento sigue pendiente; dejar la marca en "true" haría imprimir papel
  // por material que nunca se descontó.
  function guardarSeleccion() {
    ordenAplicada = false;
    try {
      sessionStorage.setItem(CLAVE_SELECCION, JSON.stringify(seleccion));
      sessionStorage.removeItem(CLAVE_APLICADA);
    } catch (e) {
      // Modo privado o storage lleno: seguimos con el estado en memoria.
    }
  }

  // Cierra la orden actual del todo. Es la única salida del estado "aplicada":
  // mientras `ordenSeleccion` siga escrita, esta pantalla la sigue mostrando.
  function empezarNuevaOrden() {
    try {
      sessionStorage.removeItem(CLAVE_SELECCION);
      sessionStorage.removeItem(CLAVE_APLICADA);
    } catch (e) {
      // Si no se puede limpiar, al menos la Principal arranca en blanco.
    }
    window.location.href = "/";
  }

  // El + no puede pedir más de lo que hay en el almacén. Esta pantalla vivía
  // solo de sessionStorage; ahora consulta el catálogo para conocer el tope.
  // `no-store` es deliberado: volviendo con el botón atrás del navegador, la
  // respuesta cacheada mostraba las existencias de ANTES del último descuento.
  async function cargarTopes() {
    try {
      const respuesta = await fetch("/api/productos?activo=1", { cache: "no-store" });
      if (!respuesta.ok) return;
      const datos = await respuesta.json();
      if (!Array.isArray(datos)) return;
      topes = new Map(datos.map((p) => [Number(p.id_producto), Number(p.cantidad)]));
    } catch (e) {
      // Sin catálogo se puede bajar y quitar, que nunca deja el stock corto.
      return;
    } finally {
      seleccion.forEach(sincronizarLinea);
    }
  }

  // `null` = no se sabe (no se puede subir). Un producto ausente del catálogo
  // activo se desactivó o se borró: su tope es 0.
  function topeDe(item) {
    if (!topes) return null;
    return topes.has(item.id_producto) ? topes.get(item.id_producto) : 0;
  }

  function formatearFechaHoy() {
    const hoy = new Date();
    // dd/mm/aaaa, coherente con es-CO / es-MX.
    return hoy.toLocaleDateString("es-CO", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });
  }

  function agruparPorArea(lista) {
    const areas = new Map(); // conserva el orden de aparición
    for (const item of lista) {
      const nombreArea = item.area && String(item.area).trim() ? item.area : "Sin área";
      if (!areas.has(nombreArea)) areas.set(nombreArea, []);
      areas.get(nombreArea).push(item);
    }
    return areas;
  }

  function renderizarAreas(lista) {
    elContenidoAreas.replaceChildren();
    const areas = agruparPorArea(lista);

    areas.forEach((items, nombreArea) => {
      const seccion = document.createElement("div");
      seccion.className = "seccion-area";

      const titulo = document.createElement("h2");
      titulo.className = "titulo-area";
      titulo.textContent = nombreArea.toUpperCase();
      seccion.appendChild(titulo);

      items.forEach((item) => {
        const linea = document.createElement("div");
        linea.className = "linea-producto";
        linea.dataset.id = String(item.id_producto);

        const nombre = document.createElement("span");
        nombre.className = "nombre-prod";
        nombre.textContent = item.nombre;

        const puntos = document.createElement("span");
        puntos.className = "puntos";

        const cantidad = document.createElement("span");
        cantidad.className = "cantidad-prod";
        cantidad.textContent = item.cantidad;

        linea.appendChild(nombre);
        linea.appendChild(puntos);
        linea.appendChild(cantidad);

        // Una orden aplicada ya salió del almacén: editarla y reimprimir
        // descontaría el material dos veces. Se muestra, no se toca.
        if (!ordenAplicada) linea.appendChild(construirAcciones(item));

        seccion.appendChild(linea);
      });

      elContenidoAreas.appendChild(seccion);
    });

    seleccion.forEach(sincronizarLinea);
  }

  function construirAcciones(item) {
    const acciones = document.createElement("span");
    acciones.className = "acciones-linea no-imprimir";

    const menos = construirBoton("−", `Quitar una unidad de ${item.nombre}`, "acciones-linea__paso");
    const mas = construirBoton("+", `Agregar una unidad de ${item.nombre}`, "acciones-linea__paso");
    const quitar = construirBoton("✕", `Quitar ${item.nombre} de la orden`, "acciones-linea__quitar");

    menos.addEventListener("click", () => fijarCantidad(item, item.cantidad - 1));
    mas.addEventListener("click", () => fijarCantidad(item, item.cantidad + 1));
    quitar.addEventListener("click", () => fijarCantidad(item, 0));

    acciones.append(menos, mas, quitar);
    return acciones;
  }

  function construirBoton(signo, etiqueta, clase) {
    const boton = document.createElement("button");
    boton.type = "button";
    boton.className = clase;
    boton.textContent = signo;
    boton.setAttribute("aria-label", etiqueta);
    return boton;
  }

  // Fija la cantidad de una línea en un valor absoluto. En 0 la línea sale de
  // la orden: el material vuelve a estar disponible en la Principal, que
  // recalcula sus existencias a partir de esta misma clave.
  function fijarCantidad(item, solicitada) {
    if (ordenAplicada) return;

    const tope = topeDe(item);
    let nueva = Math.trunc(Number(solicitada));
    if (!Number.isFinite(nueva)) return;

    nueva = Math.max(0, nueva);
    if (tope !== null) nueva = Math.min(nueva, tope);
    if (nueva === item.cantidad) return;

    // Un aviso de faltantes se calculó sobre las cantidades anteriores.
    ocultarAviso();

    if (nueva === 0) {
      seleccion = seleccion.filter((linea) => linea !== item);
      guardarSeleccion();
      // Quitar una línea puede vaciar un área entera: hay que rehacer el
      // formato, no parchear la línea.
      if (seleccion.length === 0) {
        mostrarEstadoVacio();
        return;
      }
      renderizarAreas(seleccion);
      return;
    }

    item.cantidad = nueva;
    guardarSeleccion();
    sincronizarLinea(item);
  }

  // Deja la línea coherente con el estado sin rehacer el formato, para no
  // mover el foco del teclado en cada pulsación.
  function sincronizarLinea(item) {
    const linea = elContenidoAreas.querySelector(`.linea-producto[data-id="${item.id_producto}"]`);
    if (!linea) return;

    linea.querySelector(".cantidad-prod").textContent = String(item.cantidad);

    const pasos = linea.querySelectorAll(".acciones-linea__paso");
    if (pasos.length !== 2) return; // orden aplicada: no hay controles

    const tope = topeDe(item);
    // Bajar siempre se puede: en 0 la línea se quita.
    pasos[0].disabled = false;
    pasos[1].disabled = tope === null || item.cantidad >= tope;
    pasos[1].title = tope === null
      ? "No se pudieron consultar las existencias"
      : item.cantidad >= tope
        ? `Sólo hay ${tope} en inventario`
        : "";
  }

  // Sin orden que imprimir se esconde el botón, no la barra entera: la
  // navegación tiene que seguir ahí. Antes esta pantalla ocultaba su única
  // barra y dejaba al usuario en un cuarto vacío con un solo enlace.
  function mostrarEstadoVacio() {
    elEstadoVacio.hidden = false;
    elFormato.hidden = true;
    elAvisoAplicada.hidden = true;
    elBtnImprimir.hidden = true;
  }

  function mostrarFormato() {
    elEstadoVacio.hidden = true;
    elFormato.hidden = false;
    elBtnImprimir.hidden = false;
  }

  function sincronizarValorImpreso(input, spanImpreso) {
    const texto = input.value.trim();
    spanImpreso.textContent = texto || "__________________";
  }

  function ocultarAviso() {
    elAviso.hidden = true;
    elAviso.replaceChildren();
  }

  function mostrarAvisoFaltantes(faltantes) {
    // Arma un mapa id_producto -> nombre a partir de la selección para que
    // el mensaje sea legible (la API sólo conoce el id).
    const nombresPorId = new Map(seleccion.map((it) => [it.id_producto, it.nombre]));

    const items = faltantes
      .map((f) => {
        const nombre = nombresPorId.get(f.id_producto) || `Producto #${f.id_producto}`;
        return `<li><strong>${escaparHtml(nombre)}</strong>: se pidieron ${f.pedido}, sólo hay ${f.disponible} disponibles.</li>`;
      })
      .join("");

    elAviso.innerHTML =
      `<p>No se pudo imprimir: el inventario cambió desde que se hizo la selección. Ajusta las cantidades aquí mismo con − o ✕.</p><ul>${items}</ul>`;
    elAviso.hidden = false;
  }

  function mostrarAvisoGenerico(mensaje) {
    elAviso.innerHTML = `<p>${escaparHtml(mensaje)}</p>`;
    elAviso.hidden = false;
  }

  function escaparHtml(texto) {
    const div = document.createElement("div");
    div.textContent = String(texto);
    return div.innerHTML;
  }

  function marcarOrdenAplicada() {
    ordenAplicada = true;
    try {
      sessionStorage.setItem(CLAVE_APLICADA, "true");
    } catch (e) {
      // Si sessionStorage falla (modo privado, etc.) seguimos con el flag en memoria.
    }
  }

  // Una orden aplicada es un documento cerrado: se reimprime, no se edita.
  // `ordenSeleccion` se conserva a propósito para poder reimprimir el mismo
  // papel sin volver a llamar a /api/ordenes; el botón de nueva orden es lo
  // que la borra.
  function cerrarOrdenEnPantalla() {
    elAvisoAplicada.hidden = false;
    elBtnImprimir.textContent = "Reimprimir";
    elContenidoAreas.querySelectorAll(".acciones-linea").forEach((nodo) => nodo.remove());
  }

  // No se pregunta si el papel salió, aunque el navegador tampoco sepa
  // decirlo: el aviso previo ya avisó de que el descuento es inmediato, y una
  // segunda pregunta invita a dudar de algo que ya está hecho. Si la impresora
  // falló, "Reimprimir" está a la vista y no vuelve a descontar.

  // Pulsar imprimir descuenta de verdad y eso no se deshace desde aquí: se
  // avisa antes, con el número delante.
  function alPulsarImprimir() {
    if (enviando) return;

    // Ya se aplicó el descuento antes: sólo reimprime, sin volver a llamar la
    // API y sin confirmar nada — no hay nada que descontar.
    if (ordenAplicada) {
      window.print();
      return;
    }

    const unidades = seleccion.reduce((total, i) => total + i.cantidad, 0);
    const productos = seleccion.length;
    elResumenDescuento.textContent =
      `${unidades} ${unidades === 1 ? "unidad" : "unidades"} ` +
      `de ${productos} ${productos === 1 ? "producto" : "productos"}`;

    elDialogo.showModal();
  }

  async function emitirOrden() {
    if (enviando) return;

    ocultarAviso();
    enviando = true;
    elBtnImprimir.disabled = true;

    const lineas = seleccion.map((item) => ({
      id_producto: Number(item.id_producto),
      cantidad: Number(item.cantidad),
    }));

    try {
      const respuesta = await fetch("/api/ordenes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lineas,
          // Quedan en el registro de la orden, no sólo en el papel.
          evento: elInputEvento.value.trim(),
          responsable: elInputResponsable.value.trim(),
        }),
      });

      if (respuesta.status === 200) {
        marcarOrdenAplicada();
        cerrarOrdenEnPantalla();
        window.print();
        return;
      }

      if (respuesta.status === 409) {
        const datos = await respuesta.json().catch(() => ({ faltantes: [] }));
        mostrarAvisoFaltantes(Array.isArray(datos.faltantes) ? datos.faltantes : []);
        // Las existencias acaban de cambiar bajo los pies: relee los topes
        // para que el + no vuelva a ofrecer lo que ya no hay.
        cargarTopes();
        return;
      }

      if (respuesta.status === 400) {
        const datos = await respuesta.json().catch(() => ({}));
        mostrarAvisoGenerico(datos.error || "No se pudo registrar la orden. Verifica los datos e intenta de nuevo.");
        return;
      }

      // Cualquier otro código (500, etc.): puede ser que la migración de la
      // base de datos aún no se haya aplicado en el servidor.
      const datos = await respuesta.json().catch(() => ({}));
      mostrarAvisoGenerico(
        datos.error
          ? `Error del servidor: ${datos.error}`
          : `Error del servidor (código ${respuesta.status}). Intenta de nuevo más tarde.`
      );
    } catch (err) {
      mostrarAvisoGenerico(`No se pudo conectar con el servidor: ${err.message}`);
    } finally {
      enviando = false;
      elBtnImprimir.disabled = false;
    }
  }

  function iniciar() {
    elBtnNuevaOrden.addEventListener("click", empezarNuevaOrden);

    elBtnConfirmarEmision.addEventListener("click", () => {
      elDialogo.close();
      emitirOrden();
    });
    elBtnCancelarEmision.addEventListener("click", () => elDialogo.close());

    if (seleccion.length === 0) {
      mostrarEstadoVacio();
      return;
    }

    mostrarFormato();
    elFecha.textContent = formatearFechaHoy();
    renderizarAreas(seleccion);

    if (ordenAplicada) {
      cerrarOrdenEnPantalla();
    } else {
      // Sin await: el formato ya está en pantalla y se puede bajar o quitar
      // desde el primer momento. Al llegar, los topes sólo habilitan el +.
      cargarTopes();
    }

    sincronizarValorImpreso(elInputEvento, elValorEvento);
    sincronizarValorImpreso(elInputResponsable, elValorResponsable);

    elInputEvento.addEventListener("input", () => sincronizarValorImpreso(elInputEvento, elValorEvento));
    elInputResponsable.addEventListener("input", () => sincronizarValorImpreso(elInputResponsable, elValorResponsable));

    elBtnImprimir.addEventListener("click", alPulsarImprimir);
  }

  document.addEventListener("DOMContentLoaded", iniciar);
})();
