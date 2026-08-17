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
// El mismo recuento se pinta en dos sitios: el panel lateral (escritorio) y la
// barra inferior (móvil). Solo uno de los dos es visible en cada tamaño.
const resumenes = document.querySelectorAll("[data-resumen]");

let productos = [];  // catálogo activo tal como viene de la API (+ cantidadDisponible)
let seleccion = [];  // [{ id_producto, nombre, marca, area, cantidad }] — números, no strings

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
    const area = item.area || "Sin área";
    if (!agrupado[area]) agrupado[area] = [];
    agrupado[area].push(item);
  });
  return agrupado;
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
      const items = agrupado[area].filter(p => p.nombre.toLowerCase().includes(texto));
      if (items.length === 0) return;
      encontrados += items.length;
      resultados.appendChild(construirGrupo(area, items));
    });

  if (encontrados === 0) {
    const aviso = document.createElement("p");
    aviso.className = "mensaje-vacio";
    // textContent y no innerHTML: la consulta la escribe el usuario.
    aviso.textContent = consulta
      ? `Ningún producto disponible coincide con "${consulta}".`
      : "No hay productos disponibles en este momento.";
    resultados.appendChild(aviso);
  }
}

function construirGrupo(area, items) {
  const grupo = document.createElement("section");
  grupo.className = "grupo-area";

  const titulo = document.createElement("h3");
  titulo.className = "titulo-area";
  titulo.textContent = area;
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

  const meta = document.createElement("span");
  meta.className = "producto__meta";
  if (item.marca) {
    const marca = document.createElement("span");
    marca.className = "producto__marca";
    marca.textContent = item.marca;
    meta.append(marca, document.createTextNode(" · "));
  }
  const disponible = document.createElement("span");
  disponible.className = "producto__disponible cifra";
  meta.appendChild(disponible);

  info.append(nombre, meta);

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
  fila.append(info, contador);

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

  disponible.textContent = item.cantidadDisponible === 1
    ? "1 disponible"
    : `${item.cantidadDisponible} disponibles`;

  fila.classList.toggle("producto--elegido", elegida > 0);
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

    const nombre = document.createElement("span");
    nombre.className = "lista__nombre";
    nombre.textContent = item.nombre;

    const cantidad = document.createElement("span");
    cantidad.className = "lista__cantidad cifra";
    cantidad.textContent = String(item.cantidad);

    const quitar = document.createElement("button");
    quitar.type = "button";
    quitar.className = "btn-quitar";
    quitar.textContent = "✕";
    quitar.setAttribute("aria-label", `Quitar ${item.nombre} de la selección`);
    quitar.addEventListener("click", () => quitarDeSeleccion(item.id_producto));

    li.append(nombre, cantidad, quitar);
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
