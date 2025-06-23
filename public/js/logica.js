const buscarInput = document.getElementById("buscar");
const resultados = document.getElementById("resultados");
const lista = document.getElementById("lista");

const modal = document.getElementById("modalCantidad");
const modalItemNombre = document.getElementById("modalItemNombre");
const cantidadInput = document.getElementById("cantidadInput");
const btnAgregarCantidad = document.getElementById("btnAgregarCantidad");
const btnCancelarModal = document.getElementById("btnCancelarModal");

let itemSeleccionado = null;
let inventario = {};

// ✅ Agrupar los productos por subproceso
function agruparPorSubproceso(data) {
  const agrupado = {};
  data.forEach(item => {
    if (!agrupado[item.subproceso]) {
      agrupado[item.subproceso] = [];
    }
    agrupado[item.subproceso].push({
      nombre: item.producto,
      cantidad: item.cantidad
    });
  });
  return agrupado;
}

// ✅ Mostrar resultados agrupados por subproceso
function mostrarResultados() {
  const texto = buscarInput.value.toLowerCase();
  resultados.innerHTML = "";

  for (const subproceso in inventario) {
    const productos = inventario[subproceso].filter(p =>
      p.nombre.toLowerCase().includes(texto)
    );

    if (productos.length > 0) {
      const filtrar = document.createElement("div");
      filtrar.innerHTML = `<h3>🔹 ${subproceso}</h3>`;

      productos.forEach(item => {
        const div = document.createElement("div");
         div.innerHTML = `<strong>${item.nombre}</strong> - Cantidad disponible: ${item.cantidad}`;
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
  const cantidadElegida = parseInt(cantidadInput.value);

  if (cantidadElegida > 0 && cantidadElegida <= itemSeleccionado.cantidad) {
    itemSeleccionado.cantidad -= cantidadElegida;

    const li = document.createElement("li");
    li.textContent = `${itemSeleccionado.nombre} - Cantidad: ${cantidadElegida}`;
    lista.appendChild(li);

    cerrarModal();
    mostrarResultados();
  } else {
    alert("Cantidad no válida");
  }
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

// ✅ Cargar datos desde la API al cargar la página
window.addEventListener("DOMContentLoaded", () => {
  fetch("/api/productoSubproceso")
    .then(res => res.json())
    .then(data => {
      inventario = agruparPorSubproceso(data);
      mostrarResultados();
    })
    .catch(err => {
      resultados.innerHTML = `<p style="color:red;">Error cargando datos: ${err.message}</p>`;
    });
});

// Buscar mientras escribes
buscarInput.addEventListener("input", mostrarResultados);
