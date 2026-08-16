// Lógica de la pantalla "Orden del Día" (formato imprimible).
// Lee la selección hecha en index.html desde sessionStorage, arma el
// formato agrupado por área y controla la impresión + descuento real
// de inventario contra la API.

(function () {
  "use strict";

  const CLAVE_SELECCION = "ordenSeleccion";
  const CLAVE_APLICADA = "ordenAplicada";

  // Referencias a elementos del DOM.
  const elEstadoVacio = document.getElementById("estadoVacio");
  const elFormato = document.getElementById("formatoOrden");
  const elBarraAcciones = document.querySelector(".barra-acciones");
  const elFecha = document.getElementById("fechaHoy");
  const elContenidoAreas = document.getElementById("contenidoAreas");
  const elAviso = document.getElementById("avisoFaltantes");
  const elBtnImprimir = document.getElementById("btnImprimirOrden");

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
    elContenidoAreas.innerHTML = "";
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
        seccion.appendChild(linea);
      });

      elContenidoAreas.appendChild(seccion);
    });
  }

  function mostrarEstadoVacio() {
    elEstadoVacio.hidden = false;
    elFormato.hidden = true;
    if (elBarraAcciones) elBarraAcciones.hidden = true;
  }

  function mostrarFormato() {
    elEstadoVacio.hidden = true;
    elFormato.hidden = false;
    if (elBarraAcciones) elBarraAcciones.hidden = false;
  }

  function sincronizarValorImpreso(input, spanImpreso) {
    const texto = input.value.trim();
    spanImpreso.textContent = texto || "__________________";
  }

  function ocultarAviso() {
    elAviso.hidden = true;
    elAviso.innerHTML = "";
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
      `<p>No se pudo imprimir: el inventario cambió desde que se hizo la selección.</p><ul>${items}</ul>`;
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

  async function alPulsarImprimir() {
    if (enviando) return;

    // Ya se aplicó el descuento antes: sólo reimprime, sin volver a llamar la API.
    if (ordenAplicada) {
      window.print();
      return;
    }

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
        body: JSON.stringify({ lineas }),
      });

      if (respuesta.status === 200) {
        marcarOrdenAplicada();
        window.print();
        return;
      }

      if (respuesta.status === 409) {
        const datos = await respuesta.json().catch(() => ({ faltantes: [] }));
        mostrarAvisoFaltantes(Array.isArray(datos.faltantes) ? datos.faltantes : []);
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
    if (seleccion.length === 0) {
      mostrarEstadoVacio();
      return;
    }

    mostrarFormato();
    elFecha.textContent = formatearFechaHoy();
    renderizarAreas(seleccion);

    sincronizarValorImpreso(elInputEvento, elValorEvento);
    sincronizarValorImpreso(elInputResponsable, elValorResponsable);

    elInputEvento.addEventListener("input", () => sincronizarValorImpreso(elInputEvento, elValorEvento));
    elInputResponsable.addEventListener("input", () => sincronizarValorImpreso(elInputResponsable, elValorResponsable));

    elBtnImprimir.addEventListener("click", alPulsarImprimir);
  }

  document.addEventListener("DOMContentLoaded", iniciar);
})();
