// Pantalla principal: elegir qué sale hoy del almacén y en qué cantidad.
//
// La cantidad se ajusta con un contador EN LA PROPIA FILA (− n +). Antes esto
// era un modal que solo servía para capturar un número: tres toques y una capa
// encima de la pantalla para escribir "2". El contador en línea deja el estado
// visible donde está el producto y no tapa el resto de la lista.
//
// El DOM de los resultados se construye una sola vez por búsqueda; los +/−
// parchean la fila afectada en vez de repintar todo. Eso no es una optimización
// prematura: repintar movería el foco del teclado a <body> en cada pulsación.

const buscarInput = document.getElementById("buscar");
const resultados = document.getElementById("resultados");
const lista = document.getElementById("lista");
const listaVacia = document.getElementById("listaVacia");
const barraSeleccion = document.getElementById("barraSeleccion");
const ctaOrden = document.getElementById("ctaOrden");
const pistaOrden = document.getElementById("pistaOrden");
const conteoResultados = document.getElementById("conteoResultados");
const filtrosArea = document.getElementById("filtrosArea");
// El mismo recuento se pinta en dos sitios: el panel lateral (escritorio) y la
// barra inferior (móvil). Solo uno de los dos es visible en cada tamaño.
const resumenes = document.querySelectorAll("[data-resumen]");

let productos = [];  // catálogo activo tal como viene de la API (+ cantidadDisponible)
let seleccion = [];  // [{ id_producto, nombre, marca, area, cantidad }] — números, no strings

// Área elegida en los filtros, o null para "todas". Es sólo de la vista: no se
// guarda ni viaja a la orden.
let areaActiva = null;

// Cuando quedan estas unidades o menos, la existencia se rotula en ámbar. No es
// un umbral de negocio (nadie ha pedido un "stock mínimo"): es el punto donde
// conviene que la cifra deje de leerse como una más de la columna.
const UMBRAL_POCAS = 2;

// ---------------------------------------------------------------------------
// Consultas sobre el estado
// ---------------------------------------------------------------------------

function cantidadSeleccionada(idProducto) {
  const item = seleccion.find(i => i.id_producto === Number(idProducto));
  return item ? item.cantidad : 0;
}

// Un producto sale de la Principal si no hay nada que pedir. Se queda si ya
// está en la selección aunque su disponible haya llegado a cero: si no, la
// fila desaparecería bajo el dedo justo al tomar la última unidad y no habría
// forma de devolverla desde aquí.
function hayQueMostrar(item) {
  return item.cantidadDisponible > 0 || cantidadSeleccionada(item.id_producto) > 0;
}

function agruparPorArea(data) {
  const agrupado = {};
  data.forEach(item => {
    const area = nombreDeArea(item);
    if (!agrupado[area]) agrupado[area] = [];
    agrupado[area].push(item);
  });
  return agrupado;
}

// Un solo sitio decide cómo se llama el área de un producto sin área. Estaba
// escrito en tres archivos con dos textos distintos ("Sin área" aquí, "Sin
// área" en orden.js, la cadena vacía en la tabla del inventario).
function nombreDeArea(item) {
  return item.area && String(item.area).trim() ? item.area : "Sin área";
}

// Lo que distingue a un producto de otro que se llama igual. En el catálogo hay
// dos "BT3" y dos "Array": sin esto, elegir uno u otro es adivinar.
function senasDe(item) {
  return [item.marca, item.descripcion]
    .map(t => (t == null ? "" : String(t).trim()))
    .filter(Boolean);
}

// ---------------------------------------------------------------------------
// Pintado de resultados
// ---------------------------------------------------------------------------

function mostrarResultados() {
  const consulta = buscarInput.value.trim();
  const texto = consulta.toLowerCase();
  resultados.replaceChildren();

  const agrupado = agruparPorArea(productos.filter(hayQueMostrar));
  let encontrados = 0;

  Object.keys(agrupado)
    .sort((a, b) => a.localeCompare(b, "es"))
    .forEach(area => {
      // El filtro de área no oculta el rótulo: oculta el grupo entero, para
      // que no quede una regla morada presidiendo una lista vacía.
      if (areaActiva !== null && area !== areaActiva) return;

      // La búsqueda mira también marca y descripción: son las señas por las
      // que se distinguen los productos que se llaman igual, así que teclear
      // "monitor de salida" tiene que llevar a uno de los dos "BT3".
      const items = agrupado[area].filter(p => coincide(p, texto));
      if (items.length === 0) return;
      encontrados += items.length;
      resultados.appendChild(construirGrupo(area, items));
    });

  actualizarConteo(encontrados, consulta);
  actualizarConteosDeArea();

  if (encontrados === 0) {
    const aviso = document.createElement("p");
    aviso.className = "mensaje-vacio";
    // textContent y no innerHTML: la consulta la escribe el usuario.
    aviso.textContent = consulta
      ? `Ningún producto disponible coincide con "${consulta}".`
      : areaActiva !== null
        ? `No queda nada disponible en ${areaActiva}.`
        : "No hay productos disponibles en este momento.";
    resultados.appendChild(aviso);
  }
}

// Recalcula la cabecera de cada área a partir de las filas que tiene dentro,
// no de la última búsqueda: así el recuento sigue al stock sin repintar nada.
function actualizarConteosDeArea() {
  for (const grupo of resultados.querySelectorAll(".grupo-area")) {
    const cuenta = grupo.querySelector(".titulo-area__n");
    if (!cuenta) continue;

    const ids = new Set(
      [...grupo.querySelectorAll(".producto")].map(fila => Number(fila.dataset.id))
    );
    const items = productos.filter(p => ids.has(p.id_producto));
    const unidades = items.reduce((total, p) => total + p.cantidadDisponible, 0);

    cuenta.textContent =
      `${items.length} ${items.length === 1 ? "producto" : "productos"} · ` +
      `${unidades} ${unidades === 1 ? "unidad" : "unidades"}`;
  }
}

function coincide(item, texto) {
  if (!texto) return true;
  return [item.nombre, ...senasDe(item)]
    .some(campo => String(campo).toLowerCase().includes(texto));
}

// Cuántos productos hay debajo. Sin este número, con el catálogo filtrado no
// hay forma de saber si el filtro se aplicó o si de verdad no queda nada.
function actualizarConteo(encontrados, consulta) {
  const productoS = encontrados === 1 ? "producto" : "productos";

  conteoResultados.textContent = (consulta || areaActiva !== null)
    ? `${encontrados} ${productoS}`
    : `${encontrados} ${productoS} disponibles`;
}

function construirGrupo(area, items) {
  const grupo = document.createElement("section");
  grupo.className = "grupo-area";

  const titulo = document.createElement("h3");
  titulo.className = "titulo-area";
  titulo.textContent = area;

  // Qué hay en el área, colgado de su propio rótulo. Ahorra recorrer la lista
  // para saber si merece la pena bajar hasta ella. Lo rellena
  // actualizarConteosDeArea(), que es también quien lo mantiene al día: tomar
  // unidades cambia lo disponible sin repintar el grupo, y una cabecera que
  // dijera "4 unidades" sobre una fila que dice "Queda 1" es peor que ninguna.
  const cuenta = document.createElement("span");
  cuenta.className = "titulo-area__n";
  titulo.appendChild(cuenta);

  grupo.appendChild(titulo);

  const rejilla = document.createElement("ul");
  rejilla.className = "rejilla-productos";
  items.forEach(item => rejilla.appendChild(construirProducto(item)));
  grupo.appendChild(rejilla);

  return grupo;
}

function construirProducto(item) {
  const fila = document.createElement("li");
  fila.className = "producto";
  fila.dataset.id = String(item.id_producto);

  const info = document.createElement("div");
  info.className = "producto__info";

  const nombre = document.createElement("span");
  nombre.className = "producto__nombre";
  nombre.textContent = item.nombre;

  // Marca y descripción, no sólo marca: son las señas que separan los dos
  // "BT3" del catálogo. Se montan con nodos y no con innerHTML porque las
  // teclea una persona en el formulario del inventario.
  const meta = document.createElement("span");
  meta.className = "producto__meta";
  const senas = senasDe(item);
  if (senas.length > 0) {
    const marca = document.createElement("span");
    marca.className = "producto__marca";
    marca.textContent = senas[0];
    meta.appendChild(marca);
    if (senas[1]) meta.append(document.createTextNode(` · ${senas[1]}`));
  }

  info.append(nombre, meta);

  // La existencia ya no vive dentro de la meta: es hermana de la identidad y
  // del contador, y el CSS le da columna propia. Leída dentro de la frase de
  // la marca, el dato que decide si se puede pedir se perdía.
  const disponible = document.createElement("span");
  disponible.className = "producto__disponible cifra";

  const contador = document.createElement("div");
  contador.className = "contador";

  const menos = construirPaso("−", `Quitar una unidad de ${item.nombre}`);
  const mas = construirPaso("+", `Agregar una unidad de ${item.nombre}`);

  // Campo escribible para no obligar a 25 pulsaciones cuando hacen falta 25.
  const campo = document.createElement("input");
  campo.type = "number";
  campo.className = "contador__campo cifra";
  campo.min = "0";
  campo.step = "1";
  campo.inputMode = "numeric";
  campo.setAttribute("aria-label", `Cantidad de ${item.nombre}`);

  contador.append(menos, campo, mas);
  fila.append(info, disponible, contador);

  menos.addEventListener("click", () => fijarCantidad(item, cantidadSeleccionada(item.id_producto) - 1));
  mas.addEventListener("click", () => fijarCantidad(item, cantidadSeleccionada(item.id_producto) + 1));
  campo.addEventListener("change", () => fijarCantidad(item, parseInt(campo.value, 10)));

  sincronizarProducto(item, fila);
  return fila;
}

function construirPaso(signo, etiqueta) {
  const boton = document.createElement("button");
  boton.type = "button";
  boton.className = "contador__btn";
  boton.textContent = signo;
  boton.setAttribute("aria-label", etiqueta);
  return boton;
}

// Deja la fila coherente con el estado sin volver a construirla, para no
// perder el foco del teclado en cada pulsación del contador.
function sincronizarProducto(item, nodo) {
  const fila = nodo || resultados.querySelector(`.producto[data-id="${item.id_producto}"]`);
  if (!fila) return;

  const elegida = cantidadSeleccionada(item.id_producto);
  const tope = item.cantidadDisponible + elegida;

  const campo = fila.querySelector(".contador__campo");
  const pasos = fila.querySelectorAll(".contador__btn");
  const disponible = fila.querySelector(".producto__disponible");

  campo.value = String(elegida);
  campo.max = String(tope);
  pasos[0].disabled = elegida === 0;
  pasos[1].disabled = item.cantidadDisponible === 0;

  // "Quedan 3" y no "3 disponibles" cuando queda poco: el verbo es lo que
  // convierte una cifra más de la columna en un aviso. El color va SIEMPRE
  // acompañado del texto, nunca solo.
  const quedan = item.cantidadDisponible;
  const pocas = quedan <= UMBRAL_POCAS;

  disponible.textContent =
    quedan === 0 ? "No queda ninguna"
    : quedan === 1 ? "Queda 1"
    : pocas ? `Quedan ${quedan}`
    : `${quedan} disponibles`;

  disponible.classList.toggle("producto__disponible--bajo", pocas);

  fila.classList.toggle("producto--elegido", elegida > 0);
}

// ---------------------------------------------------------------------------
// Filtro por área
// ---------------------------------------------------------------------------

// Los botones se construyen UNA vez, al cargar el catálogo, y después sólo se
// les parchea el recuento. Reconstruirlos en cada +/− mandaría el foco del
// teclado a <body> si el foco estuviera en uno de ellos — el mismo motivo por
// el que las filas se parchean en vez de repintarse.
function pintarFiltros() {
  filtrosArea.replaceChildren();

  const areas = Object.keys(agruparPorArea(productos)).sort((a, b) => a.localeCompare(b, "es"));

  // Con una sola área los botones no filtran nada: sobran.
  if (areas.length < 2) return;

  filtrosArea.appendChild(construirFiltro(null, "Todas las áreas"));
  areas.forEach(area => filtrosArea.appendChild(construirFiltro(area, area)));

  actualizarConteosDeFiltro();
}

function construirFiltro(area, etiqueta) {
  const boton = document.createElement("button");
  boton.type = "button";
  boton.className = "filtro";
  // aria-pressed y no una clase de autor: es un interruptor, y así lo anuncia
  // un lector de pantalla sin que haya que escribir nada más. El CSS se cuelga
  // del mismo atributo, así que no pueden desincronizarse.
  boton.setAttribute("aria-pressed", String(areaActiva === area));
  if (area !== null) boton.dataset.area = area;

  boton.append(document.createTextNode(etiqueta));

  const n = document.createElement("span");
  n.className = "filtro__n cifra";
  boton.appendChild(n);

  boton.addEventListener("click", () => {
    areaActiva = area;
    for (const otro of filtrosArea.querySelectorAll(".filtro")) {
      otro.setAttribute("aria-pressed", String((otro.dataset.area ?? null) === area));
    }
    mostrarResultados();
  });

  return boton;
}

function actualizarConteosDeFiltro() {
  const agrupado = agruparPorArea(productos.filter(hayQueMostrar));
  const total = Object.values(agrupado).reduce((suma, items) => suma + items.length, 0);

  for (const boton of filtrosArea.querySelectorAll(".filtro")) {
    const area = boton.dataset.area ?? null;
    const cuantos = area === null ? total : (agrupado[area]?.length ?? 0);
    boton.querySelector(".filtro__n").textContent = String(cuantos);
  }
}

// ---------------------------------------------------------------------------
// Selección
// ---------------------------------------------------------------------------

// Fija la cantidad de un producto en un valor absoluto, recortada a lo que hay.
function fijarCantidad(item, solicitada) {
  const actual = cantidadSeleccionada(item.id_producto);
  const tope = item.cantidadDisponible + actual;

  let nueva = Number.isFinite(solicitada) ? Math.trunc(solicitada) : actual;
  nueva = Math.max(0, Math.min(nueva, tope));

  if (nueva === actual) {
    sincronizarProducto(item);  // revierte lo tecleado si estaba fuera de rango
    return;
  }

  item.cantidadDisponible = tope - nueva;
  escribirEnSeleccion(item, nueva);

  sincronizarProducto(item);
  renderLista();
  actualizarResumen();
  guardarSeleccion();
}

function escribirEnSeleccion(producto, cantidad) {
  const idProducto = Number(producto.id_producto);
  const index = seleccion.findIndex(i => i.id_producto === idProducto);

  if (cantidad <= 0) {
    if (index !== -1) seleccion.splice(index, 1);
    return;
  }

  if (index === -1) {
    seleccion.push({
      id_producto: idProducto,
      nombre: producto.nombre,
      marca: producto.marca,
      // Viaja con la línea para que la orden del día pueda imprimir de qué
      // "BT3" habla. Es un campo más en sessionStorage; orden.js filtra por
      // forma (id y cantidad), así que añadirlo no rompe el contrato.
      descripcion: producto.descripcion,
      area: producto.area,
      cantidad: Number(cantidad)
    });
  } else {
    seleccion[index].cantidad = Number(cantidad);
  }
}

// Suma cantidades sobre lo que ya hubiera. La usa restaurarSeleccion().
function agregarASeleccion(producto, cantidad) {
  escribirEnSeleccion(producto, cantidadSeleccionada(producto.id_producto) + Number(cantidad));
}

// Quita un producto entero y le devuelve la cantidad a lo disponible.
function quitarDeSeleccion(idProducto) {
  const index = seleccion.findIndex(i => i.id_producto === idProducto);
  if (index === -1) return;

  const item = seleccion[index];
  const producto = productos.find(p => Number(p.id_producto) === idProducto);
  if (producto) producto.cantidadDisponible += item.cantidad;

  seleccion.splice(index, 1);

  if (producto) sincronizarProducto(producto);
  renderLista();
  actualizarResumen();
  guardarSeleccion();
}

// ---------------------------------------------------------------------------
// Resumen de la selección
// ---------------------------------------------------------------------------

function renderLista() {
  lista.replaceChildren();

  seleccion.forEach(item => {
    const li = document.createElement("li");

    const info = document.createElement("span");
    info.className = "lista__info";

    const nombre = document.createElement("span");
    nombre.className = "lista__nombre";
    nombre.textContent = item.nombre;
    info.appendChild(nombre);

    // Las mismas señas que en la fila del catálogo: en la lista de lo elegido
    // puede haber dos "BT3", y sin esto no hay forma de saber cuál se quita.
    const senas = senasDe(item);
    if (senas.length > 0) {
      const marca = document.createElement("span");
      marca.className = "lista__marca";
      marca.textContent = senas.join(" · ");
      info.appendChild(marca);
    }

    const cantidad = document.createElement("span");
    cantidad.className = "lista__cantidad cifra";
    cantidad.textContent = String(item.cantidad);

    const quitar = document.createElement("button");
    quitar.type = "button";
    quitar.className = "btn-quitar";
    quitar.textContent = "✕";
    quitar.setAttribute("aria-label", `Quitar ${item.nombre} de la selección`);
    quitar.addEventListener("click", () => quitarDeSeleccion(item.id_producto));

    li.append(info, cantidad, quitar);
    lista.appendChild(li);
  });

  listaVacia.hidden = seleccion.length > 0;
}

function actualizarResumen() {
  const unidades = seleccion.reduce((total, i) => total + i.cantidad, 0);
  const nProductos = seleccion.length;

  const texto =
    `${nProductos} ${nProductos === 1 ? "producto" : "productos"} · ` +
    `${unidades} ${unidades === 1 ? "unidad" : "unidades"}`;

  resumenes.forEach(nodo => { nodo.textContent = texto; });

  const vacia = nProductos === 0;
  barraSeleccion.hidden = vacia;
  ctaOrden.hidden = vacia;
  // La pista acompaña al botón: sin botón no explica nada.
  pistaOrden.hidden = vacia;

  // Tomar unidades cambia lo disponible, y con ello los dos recuentos.
  actualizarConteosDeFiltro();
  actualizarConteosDeArea();
}

// ---------------------------------------------------------------------------
// sessionStorage — contrato con "Orden del día"
// ---------------------------------------------------------------------------

// Borrar `ordenAplicada` es parte del contrato, no un extra: esa clave dice
// "el descuento de ESTA orden ya se hizo". Si la selección cambia, la orden
// es otra y su descuento está pendiente. Sin este borrado, Orden del día
// imprimiría papel por material que nunca se descontó.
//
// `ordenId` va en el mismo paquete y por el mismo motivo: es el número que se
// imprime en el papel y que luego se teclea en Inventario para devolver el
// material. Si sobreviviera a un cambio de selección, el papel de la orden nueva
// llevaría el número de la anterior y alguien devolvería una orden equivocada
// —irreversible— en vez de simplemente quedarse sin número.
function guardarSeleccion() {
  sessionStorage.setItem("ordenSeleccion", JSON.stringify(seleccion));
  sessionStorage.removeItem("ordenAplicada");
  sessionStorage.removeItem("ordenId");
}

// Recupera la selección guardada, ajustándola al stock que hay AHORA.
// La selección puede llevar horas en sessionStorage: un producto pudo
// desactivarse, borrarse o quedarse sin existencias mientras tanto. Se
// descarta lo que ya no existe y se recorta lo que ya no alcanza, en vez de
// arrastrar una selección imposible hasta el 409 de la impresión.
function restaurarSeleccion() {
  // Una orden ya aplicada está consumida: su material salió del almacén y su
  // descuento ya se hizo. Rehidratarla aquí la metería de nuevo en la siguiente
  // orden y se descontaría dos veces. La clave `ordenSeleccion` se deja intacta
  // a propósito, para que Orden del día pueda reimprimir el mismo papel sin
  // volver a descontar; lo que arranca en limpio es la Principal.
  let aplicada;
  try {
    aplicada = sessionStorage.getItem("ordenAplicada") === "true";
  } catch (e) {
    aplicada = false;
  }
  if (aplicada) return { ajustada: false };

  let crudo;
  try {
    crudo = sessionStorage.getItem("ordenSeleccion");
  } catch (e) {
    return { ajustada: false };
  }
  if (!crudo) return { ajustada: false };

  let datos;
  try {
    datos = JSON.parse(crudo);
  } catch (e) {
    return { ajustada: false };
  }
  if (!Array.isArray(datos)) return { ajustada: false };

  let ajustada = false;

  datos.forEach(item => {
    if (!item || typeof item.id_producto !== "number" || typeof item.cantidad !== "number") {
      ajustada = true;
      return;
    }

    const producto = productos.find(p => Number(p.id_producto) === item.id_producto);
    if (!producto) {
      // Se desactivó o se borró del catálogo desde que se seleccionó.
      ajustada = true;
      return;
    }

    const cantidad = Math.min(item.cantidad, producto.cantidadDisponible);
    if (cantidad !== item.cantidad) ajustada = true;
    if (cantidad <= 0) {
      ajustada = true;
      return;
    }

    producto.cantidadDisponible -= cantidad;
    agregarASeleccion(producto, cantidad);
  });

  return { ajustada };
}

// ---------------------------------------------------------------------------
// Arranque
// ---------------------------------------------------------------------------

window.addEventListener("DOMContentLoaded", () => {
  // `no-store` no es paranoia: volviendo con el botón atrás del navegador,
  // Chrome servía este GET desde su caché y la pantalla pintaba las
  // existencias de ANTES del último descuento (16 donde ya quedaban 13).
  fetch("/api/productos?activo=1", { cache: "no-store" })
    .then(res => res.json())
    .then(data => {
      productos = data.map(p => ({
        ...p,
        id_producto: Number(p.id_producto),
        cantidadDisponible: Number(p.cantidad)
      }));

      const { ajustada } = restaurarSeleccion();

      pintarFiltros();
      mostrarResultados();
      renderLista();
      actualizarResumen();

      if (ajustada) {
        // Sólo se reescribe si algo cambió: guardarSeleccion() borra
        // `ordenAplicada`, y una recarga sin cambios no debe invalidar
        // un descuento que ya se aplicó.
        guardarSeleccion();
        alert("Algunos productos de tu selección ya no están disponibles y se ajustaron a lo que hay en inventario.");
      }
    })
    .catch(err => {
      const aviso = document.createElement("p");
      aviso.className = "mensaje-error";
      aviso.textContent = `Error cargando datos: ${err.message}`;
      resultados.replaceChildren(aviso);
    });
});

buscarInput.addEventListener("input", mostrarResultados);
