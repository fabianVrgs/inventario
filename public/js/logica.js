const buscarInput = document.getElementById("buscar");
const resultados = document.getElementById("resultados");
const lista = document.getElementById("lista");

const modal = document.getElementById("modalCantidad");
const modalItemNombre = document.getElementById("modalItemNombre");
const cantidadInput = document.getElementById("cantidadInput");
const btnAgregarCantidad = document.getElementById("btnAgregarCantidad");
const btnCancelarModal = document.getElementById("btnCancelarModal");

let itemSeleccionado = null; // producto sobre el que está abierto el modal
let productos = [];          // productos disponibles, tal como vienen de la API (+ cantidadDisponible visual)
let seleccion = [];          // lista seleccionada: [{ id_producto, nombre, marca, area, cantidad }]

// ✅ Agrupar los productos por área
function agruparPorArea(data) {
  const agrupado = {};
  data.forEach(item => {
    if (!agrupado[item.area]) {
      agrupado[item.area] = [];
    }
    agrupado[item.area].push(item);
  });
  return agrupado;
}

// ✅ Mostrar resultados agrupados por área
function mostrarResultados() {
  const texto = buscarInput.value.toLowerCase();
  resultados.innerHTML = "";

  const agrupado = agruparPorArea(productos);

  for (const area in agrupado) {
    const items = agrupado[area].filter(p =>
      p.nombre.toLowerCase().includes(texto)
    );

    if (items.length > 0) {
      const filtrar = document.createElement("div");
      filtrar.innerHTML = `<h3>🔹 ${area}</h3>`;

      items.forEach(item => {
        const div = document.createElement("div");
        div.innerHTML = `<strong>${item.nombre}</strong> - Cantidad disponible: ${item.cantidadDisponible}`;
        div.addEventListener("click", () => mostrarModal(item));
        filtrar.appendChild(div);
      });

      resultados.appendChild(filtrar);
    }
  }

  if (resultados.innerHTML.trim() === "") {
    resultados.innerHTML = "<div>No se encontraron resultados</div>";
  }
}

// ✅ Modal
function mostrarModal(item) {
  itemSeleccionado = item;
  modalItemNombre.textContent = item.nombre;
  cantidadInput.value = 1;
  modal.style.display = "flex";
}

btnAgregarCantidad.addEventListener("click", () => {
  const cantidadElegida = parseInt(cantidadInput.value, 10);

  const esValida =
    Number.isInteger(cantidadElegida) &&
    cantidadElegida > 0 &&
    cantidadElegida <= itemSeleccionado.cantidadDisponible;

  if (!esValida) {
    alert("Cantidad no válida");
    return;
  }

  itemSeleccionado.cantidadDisponible -= cantidadElegida;
  agregarASeleccion(itemSeleccionado, cantidadElegida);

  cerrarModal();
  mostrarResultados();
  renderLista();
  guardarSeleccion();
});

btnCancelarModal.addEventListener("click", cerrarModal);

function cerrarModal() {
  modal.style.display = "none";
  itemSeleccionado = null;
}

modal.addEventListener("click", (event) => {
  if (event.target === modal) {
    cerrarModal();
  }
});

// ✅ Agrega un producto a la lista seleccionada, sumando cantidades si ya estaba
function agregarASeleccion(producto, cantidad) {
  const idProducto = Number(producto.id_producto);
  const existente = seleccion.find(i => i.id_producto === idProducto);

  if (existente) {
    existente.cantidad += Number(cantidad);
  } else {
    seleccion.push({
      id_producto: idProducto,
      nombre: producto.nombre,
      marca: producto.marca,
      area: producto.area,
      cantidad: Number(cantidad)
    });
  }
}

// ✅ Quita un producto de la lista seleccionada y le devuelve la cantidad a lo disponible
function quitarDeSeleccion(idProducto) {
  const index = seleccion.findIndex(i => i.id_producto === idProducto);
  if (index === -1) return;

  const item = seleccion[index];
  const producto = productos.find(p => Number(p.id_producto) === idProducto);
  if (producto) {
    producto.cantidadDisponible += item.cantidad;
  }

  seleccion.splice(index, 1);

  renderLista();
  mostrarResultados();
  guardarSeleccion();
}

// ✅ Pinta la lista seleccionada
function renderLista() {
  lista.innerHTML = "";

  seleccion.forEach(item => {
    const li = document.createElement("li");

    const texto = document.createElement("span");
    texto.textContent = `${item.nombre} - Cantidad: ${item.cantidad}`;

    const btnQuitar = document.createElement("button");
    btnQuitar.type = "button";
    btnQuitar.className = "btn-quitar";
    btnQuitar.textContent = "✕";
    btnQuitar.addEventListener("click", () => quitarDeSeleccion(item.id_producto));

    li.appendChild(texto);
    li.appendChild(btnQuitar);
    lista.appendChild(li);
  });
}

// ✅ Guarda la selección en sessionStorage para que "Orden del día" la recoja.
// Borrar `ordenAplicada` es parte del contrato, no un extra: esa clave dice
// "el descuento de ESTA orden ya se hizo". Si la selección cambia, la orden
// es otra y su descuento está pendiente. Sin este borrado, Orden del día
// imprimiría papel por material que nunca se descontó.
function guardarSeleccion() {
  sessionStorage.setItem("ordenSeleccion", JSON.stringify(seleccion));
  sessionStorage.removeItem("ordenAplicada");
}

// ✅ Recupera la selección guardada, ajustándola al stock que hay AHORA.
// La selección puede llevar horas en sessionStorage: un producto pudo
// desactivarse, borrarse o quedarse sin existencias mientras tanto. Se
// descarta lo que ya no existe y se recorta lo que ya no alcanza, en vez de
// arrastrar una selección imposible hasta el 409 de la impresión.
function restaurarSeleccion() {
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

// ✅ Cargar datos desde la API al cargar la página
window.addEventListener("DOMContentLoaded", () => {
  fetch("/api/productos?activo=1")
    .then(res => res.json())
    .then(data => {
      productos = data.map(p => ({ ...p, cantidadDisponible: p.cantidad }));

      const { ajustada } = restaurarSeleccion();

      mostrarResultados();
      renderLista();

      if (ajustada) {
        // Sólo se reescribe si algo cambió: guardarSeleccion() borra
        // `ordenAplicada`, y una recarga sin cambios no debe invalidar
        // un descuento que ya se aplicó.
        guardarSeleccion();
        alert("Algunos productos de tu selección ya no están disponibles y se ajustaron a lo que hay en inventario.");
      }
    })
    .catch(err => {
      resultados.innerHTML = `<p style="color:red;">Error cargando datos: ${err.message}</p>`;
    });
});

// Buscar mientras escribes
buscarInput.addEventListener("input", mostrarResultados);
