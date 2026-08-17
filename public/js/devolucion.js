// Apartado "Recibir devolución" de la pantalla Inventario.
//
// Es la otra mitad del ciclo que abre la orden del día: allí el material sale y
// el stock baja; aquí vuelve y el stock sube. Se busca por el N.º que la orden
// lleva impreso y se repone de una vez TODO lo que salió — la devolución es todo
// o nada, igual que la salida.
//
// Vive en su propio archivo y no dentro de edit.js por dos razones. La primera
// es que edit.js ya hace cinco cosas. La segunda es de mecánica y es la que
// obliga al IIFE: los classic scripts comparten el ámbito léxico de nivel
// superior, así que declarar aquí un `const` que ya exista en edit.js rompería
// este archivo ENTERO al parsear, sin más señal que un error en consola.
//
// Este archivo NO escribe `ordenSeleccion`, `ordenAplicada` ni `ordenId`.
// Recibir el material no reabre la orden ni la devuelve a la selección: son
// claves del flujo de SALIDA y tocarlas desde aquí haría que la Principal
// rehidratara una orden ya consumida.

(function () {
  "use strict";

  const elForm = document.getElementById("formBuscarOrden");
  const elNumero = document.getElementById("numeroOrden");
  const elBtnBuscar = document.getElementById("btnBuscarOrden");
  const elAviso = document.getElementById("avisoDevolucion");
  const elPanel = document.getElementById("panelOrden");

  const elDialogo = document.getElementById("dialogoDevolucion");
  const elResumen = document.getElementById("resumenDevolucion");
  const elRecibidaPor = document.getElementById("recibidaPor");
  const elBtnConfirmar = document.getElementById("btnConfirmarDevolucion");
  const elBtnCancelar = document.getElementById("btnCancelarDevolucion");

  // La orden que se está mostrando. `null` = no hay ninguna en pantalla.
  let orden = null;
  let ocupado = false;

  // --------------------------------------------------------------- utilidades

  // El manejador de errores de server.js está registrado ANTES de las rutas, así
  // que un 500 puede llegar como HTML en vez de JSON. Nunca asumir que hay JSON.
  const leerJson = (respuesta) => respuesta.json().catch(() => ({}));

  // `creada_en` y `recibida_en` son ISO-8601 en UTC. Sin pasarlos a hora local,
  // una salida de las 20:00 en Colombia (UTC-5) se leería como del día
  // siguiente, y el operario buscaría el papel en la fecha equivocada.
  function formatearMomento(iso) {
    const fecha = new Date(iso);
    if (Number.isNaN(fecha.getTime())) return "—";
    return fecha.toLocaleString("es-CO", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  const pluralUnidades = (n) => `${n} ${n === 1 ? "unidad" : "unidades"}`;
  const pluralProductos = (n) => `${n} ${n === 1 ? "producto" : "productos"}`;
  const listar = (lineas) => lineas.map((l) => `«${l.nombre}» (${l.cantidad})`).join(", ");

  function mostrarAviso(texto, tono) {
    elAviso.textContent = texto;
    elAviso.className = `devolucion__aviso devolucion__aviso--${tono}`;
    elAviso.hidden = false;
  }

  function ocultarAviso() {
    elAviso.hidden = true;
    elAviso.textContent = "";
  }

  function ocultarPanel() {
    orden = null;
    elPanel.hidden = true;
    elPanel.replaceChildren();
  }

  // ------------------------------------------------------------------ búsqueda

  async function buscarOrden(evento) {
    evento.preventDefault();
    if (ocupado) return;

    const numero = elNumero.value.trim();
    if (!/^\d+$/.test(numero) || Number(numero) <= 0) {
      ocultarPanel();
      mostrarAviso("Escribe el N.º de orden que aparece en el papel impreso.", "error");
      return;
    }

    ocupado = true;
    elBtnBuscar.disabled = true;
    ocultarAviso();

    try {
      // `no-store` por el mismo motivo que en la Principal: volviendo con el
      // botón atrás, una respuesta cacheada diría que la orden sigue pendiente
      // cuando ya se recibió.
      const respuesta = await fetch(`/api/ordenes/${numero}`, { cache: "no-store" });

      if (respuesta.status === 404) {
        ocultarPanel();
        mostrarAviso(`No existe ninguna orden con el N.º ${numero}.`, "error");
        return;
      }

      if (!respuesta.ok) {
        const datos = await leerJson(respuesta);
        ocultarPanel();
        mostrarAviso(
          datos.error || `No se pudo consultar la orden (código ${respuesta.status}).`,
          "error"
        );
        return;
      }

      orden = await respuesta.json();
      pintarPanel();
    } catch (err) {
      ocultarPanel();
      mostrarAviso(`No se pudo conectar con el servidor: ${err.message}`, "error");
    } finally {
      ocupado = false;
      elBtnBuscar.disabled = false;
    }
  }

  async function recargarOrden(idOrden) {
    try {
      const respuesta = await fetch(`/api/ordenes/${idOrden}`, { cache: "no-store" });
      if (!respuesta.ok) return;
      orden = await respuesta.json();
      pintarPanel();
    } catch (e) {
      // El aviso principal ya se mostró; dejar el panel como está es aceptable.
    }
  }

  // --------------------------------------------------------------------- panel

  function describirSalida() {
    const partes = [`Salió el ${formatearMomento(orden.creada_en)}`];
    if (orden.evento) partes.push(`Evento: ${orden.evento}`);
    if (orden.responsable) partes.push(`Responsable: ${orden.responsable}`);
    return partes.join(" · ");
  }

  function describirDevolucion(devolucion) {
    const quien = devolucion.recibida_por ? ` · Recibió: ${devolucion.recibida_por}` : "";
    return `Ya recibida el ${formatearMomento(devolucion.recibida_en)}${quien}`;
  }

  // Tres cosas pueden haber cambiado desde que el material salió, y las tres
  // importan al recibirlo: que el producto ya no exista, que se haya renombrado
  // (el nombre de la línea es el histórico, a propósito) y que esté desactivado.
  function notaDeLinea(linea) {
    if (!linea.existe) {
      return "el producto ya no está en el catálogo: su stock no se puede reponer";
    }

    const notas = [];
    if (linea.nombre_actual && linea.nombre_actual !== linea.nombre) {
      notas.push(`ahora se llama «${linea.nombre_actual}»`);
    }
    if (!linea.activo) {
      notas.push("está desactivado: volverá al stock, pero no se podrá pedir");
    }
    return notas.join(" · ");
  }

  // Se construye con createElement y no con innerHTML: los nombres vienen de la
  // base y no se pueden concatenar en markup sin escaparlos.
  function construirLineas() {
    const lista = document.createElement("ul");
    lista.className = "devolucion__lineas";

    orden.lineas.forEach((linea) => {
      const item = document.createElement("li");
      item.className = "devolucion__linea";
      if (!linea.existe) item.classList.add("devolucion__linea--omitida");

      const info = document.createElement("span");
      info.className = "devolucion__info";

      const nombre = document.createElement("span");
      nombre.className = "devolucion__nombre";
      nombre.textContent = linea.nombre;
      info.appendChild(nombre);

      const nota = notaDeLinea(linea);
      if (nota) {
        const aviso = document.createElement("span");
        aviso.className = "devolucion__nota";
        aviso.textContent = nota;
        info.appendChild(aviso);
      }

      item.appendChild(info);

      const cantidad = document.createElement("span");
      cantidad.className = "devolucion__cantidad cifra";
      cantidad.textContent = String(linea.cantidad);
      item.appendChild(cantidad);

      lista.appendChild(item);
    });

    return lista;
  }

  function construirAcciones() {
    const acciones = document.createElement("div");
    acciones.className = "devolucion__acciones";

    const boton = document.createElement("button");
    boton.type = "button";
    boton.className = "btn btn--secundario";
    boton.textContent = "Recibir al inventario";
    // Una orden sin líneas no tiene nada que reponer: mejor deshabilitar el
    // botón que dejar que el usuario choque contra el 409.
    boton.disabled = orden.lineas.length === 0;
    boton.addEventListener("click", abrirConfirmacion);
    acciones.appendChild(boton);

    const reponibles = orden.lineas.filter((l) => l.existe).length;
    if (orden.lineas.length > 0 && reponibles === 0) {
      const nota = document.createElement("p");
      nota.className = "devolucion__nota";
      nota.textContent =
        "Ningún producto de esta orden sigue en el catálogo: la orden se cerrará, " +
        "pero no se repondrá stock.";
      acciones.appendChild(nota);
    }

    return acciones;
  }

  function pintarPanel() {
    elPanel.replaceChildren();

    const titulo = document.createElement("p");
    titulo.className = "devolucion__orden";
    titulo.textContent = `Orden N.º ${orden.id_orden}`;
    elPanel.appendChild(titulo);

    const meta = document.createElement("p");
    meta.className = "devolucion__meta";
    meta.textContent = describirSalida();
    elPanel.appendChild(meta);

    // Una orden ya recibida se muestra en modo lectura, sin botón: es la
    // trazabilidad de cuándo volvió el material.
    if (orden.devolucion) {
      const recibida = document.createElement("p");
      recibida.className = "devolucion__recibida";
      recibida.textContent = describirDevolucion(orden.devolucion);
      elPanel.appendChild(recibida);
    }

    elPanel.appendChild(construirLineas());

    if (!orden.devolucion) elPanel.appendChild(construirAcciones());

    elPanel.hidden = false;
  }

  // -------------------------------------------------------------- confirmación

  function abrirConfirmacion() {
    if (!orden) return;

    elResumen.replaceChildren();

    // La identidad completa de la orden, no sólo el número: reponer la orden
    // equivocada suma material a productos ajenos, no se deshace desde la app y
    // además deja bloqueada la devolución de la orden real. Que el operario
    // reconozca fecha y evento antes de confirmar es la única defensa que hay.
    const identidad = document.createElement("p");
    identidad.className = "devolucion__orden";
    identidad.textContent = `Orden N.º ${orden.id_orden}`;
    elResumen.appendChild(identidad);

    const meta = document.createElement("p");
    meta.className = "devolucion__meta";
    meta.textContent = describirSalida();
    elResumen.appendChild(meta);

    const unidades = orden.lineas.reduce((total, l) => total + l.cantidad, 0);
    const cuenta = document.createElement("p");
    cuenta.className = "devolucion__meta";
    cuenta.textContent = `Volverán ${pluralUnidades(unidades)} de ${pluralProductos(orden.lineas.length)}:`;
    elResumen.appendChild(cuenta);

    elResumen.appendChild(construirLineas());

    elRecibidaPor.value = "";
    elDialogo.showModal();
  }

  function mensajeDeExito(datos) {
    const devueltas = Array.isArray(datos.devueltas) ? datos.devueltas : [];
    const omitidas = Array.isArray(datos.omitidas) ? datos.omitidas : [];
    const unidades = devueltas.reduce((total, l) => total + l.cantidad, 0);

    const partes = [
      `Orden N.º ${datos.id_orden} recibida: ${pluralUnidades(unidades)} de vuelta en el inventario.`,
    ];

    // El stock sube igual, pero desde la Principal no se podrá volver a pedir:
    // decirlo aquí evita que el material quede invisible sin que nadie lo sepa.
    const desactivadas = devueltas.filter((l) => !l.activo);
    if (desactivadas.length > 0) {
      partes.push(
        `Ojo: ${listar(desactivadas)} ${desactivadas.length === 1 ? "está desactivado" : "están desactivados"}, ` +
          "así que el material volvió al stock pero no se podrá pedir hasta reactivarlo aquí."
      );
    }

    if (omitidas.length > 0) {
      partes.push(
        `No se pudo reponer ${listar(omitidas)}: el producto ya no está en el catálogo. ` +
          'Si el material volvió, dalo de alta con "Agregar producto".'
      );
    }

    return partes.join(" ");
  }

  function tonoDeExito(datos) {
    const omitidas = Array.isArray(datos.omitidas) ? datos.omitidas : [];
    const devueltas = Array.isArray(datos.devueltas) ? datos.devueltas : [];
    return omitidas.length > 0 || devueltas.some((l) => !l.activo) ? "aviso" : "exito";
  }

  async function confirmarDevolucion() {
    if (ocupado || !orden) return;

    const idOrden = orden.id_orden;
    const recibidaPor = elRecibidaPor.value.trim();

    elDialogo.close();
    ocupado = true;
    elBtnConfirmar.disabled = true;
    ocultarAviso();

    try {
      const respuesta = await fetch(`/api/ordenes/${idOrden}/devolucion`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recibida_por: recibidaPor }),
      });
      const datos = await leerJson(respuesta);

      if (!respuesta.ok) {
        mostrarAviso(
          datos.error || `No se pudo recibir la orden (código ${respuesta.status}).`,
          "error"
        );
        // Un 409 significa que ya estaba recibida: releer deja el panel diciendo
        // la verdad en vez de ofreciendo otra vez el botón.
        if (respuesta.status === 409) await recargarOrden(idOrden);
        return;
      }

      mostrarAviso(mensajeDeExito(datos), tonoDeExito(datos));

      // El stock que acaba de subir tiene que verse en la tabla de abajo sin
      // recargar la página. `cargarProductos` es de edit.js y relee desde la
      // API, que es el patrón de esa pantalla: nunca mutar el array local.
      if (typeof cargarProductos === "function") await cargarProductos();

      await recargarOrden(idOrden);
    } catch (err) {
      mostrarAviso(`No se pudo conectar con el servidor: ${err.message}`, "error");
    } finally {
      ocupado = false;
      elBtnConfirmar.disabled = false;
    }
  }

  // -------------------------------------------------------------------- inicio

  if (elForm) {
    elForm.addEventListener("submit", buscarOrden);
    elBtnConfirmar.addEventListener("click", confirmarDevolucion);
    elBtnCancelar.addEventListener("click", () => elDialogo.close());
  }
})();
