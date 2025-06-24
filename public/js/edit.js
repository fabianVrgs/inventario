const buscarInput = document.getElementById("buscar");
const resultados = document.getElementById("resultados");
const lista = document.getElementById("lista");

const modal = document.getElementById("modalCantidad");
const modalItemNombre = document.getElementById("modalItemNombre");
const cantidadInput = document.getElementById("cantidadInput");
const btnAgregarCantidad = document.getElementById("btnAgregarCantidad");
const btnCancelarModal = document.getElementById("btnCancelarModal");
let modoOperacion = "agregar"; // Puede ser "agregar", "quitar" o "eliminar"

const modalDetalle = document.getElementById("modalDetalle");

let itemSeleccionado = null;

const inventarioFalso = [
  {
    id: 1,
    nombre: "Micrófono Inalámbrico",
    cantidad: 12,
    descripcion: "Micrófono inalámbrico profesional UHF",
    marca: "Shure",
    imagen: "https://www.audiocentro.com.co/wp-content/uploads/2020/06/BLX24-SM58-H9-2.jpg"
  },
  {
    id: 2,
    nombre: "Bocina rcf",
    cantidad: 8,
    descripcion: "Bocina de alto rendimiento para conciertos y eventos",
    marca: "YAMAHA",
    imagen: "https://centrodelsonido.net/wp-content/uploads/2025/05/cabina-activa-dbr15-yamaha-01-1.jpg"
  },
  {
    id: 3,
    nombre: "Cable XLR",
    cantidad: 40,
    descripcion: "Cable XLR profesional de 5 metros",
    marca: "Proel",
    imagen: "https://prod-s3-tienda-en-linea.s3.sa-east-1.amazonaws.com/public/images/models/202210/9616E822-8BB1-3AFF-FECB-5E97FC110182.jpg"
  }
];

buscarInput.addEventListener("input", mostrarResultados);

function mostrarResultados() {
  const texto = buscarInput.value.toLowerCase();
  resultados.innerHTML = "";

  const filtrados = inventarioFalso.filter(item =>
    item.nombre.toLowerCase().includes(texto)
  );

  if (filtrados.length === 0 && texto !== "") {
    resultados.innerHTML = "<div>No se encontraron resultados</div>";
    return;
  }

  filtrados.forEach(item => {
    const div = document.createElement("div");
    div.classList.add("item");

    div.innerHTML = `
      <strong class="nombre-item" data-id="${item.id}">${item.nombre}</strong>
      <div class="acciones">
        <button class="btn-detalle" data-id="${item.id}">🔍</button>
        <button class="btn-agregar" data-id="${item.id}">➕</button>
        <button class="btn-quitar" data-id="${item.id}">➖</button>
        <button class="btn-eliminar" data-id="${item.id}">❌</button>
      </div>
    `;

    resultados.appendChild(div);
  });

  agregarEventosBotones();
}

function itemPorId(id) {
  return inventarioFalso.find(i => i.id == id);
}

function agregarEventosBotones() {
  document.querySelectorAll(".btn-agregar").forEach(btn =>
    btn.addEventListener("click", () =>
      mostrarModal(itemPorId(btn.dataset.id))
    )
  );

  document.querySelectorAll(".btn-quitar").forEach(btn =>
    btn.addEventListener("click", () =>
      quitarCantidad(itemPorId(btn.dataset.id))
    )
  );

  document.querySelectorAll(".btn-eliminar").forEach(btn =>
    btn.addEventListener("click", () =>
      eliminarItem(itemPorId(btn.dataset.id))
    )
  );

  document.querySelectorAll(".btn-detalle").forEach(btn =>
    btn.addEventListener("click", () =>
      mostrarDetalle(itemPorId(btn.dataset.id))
    )
  );
}

function mostrarModal(item, modo = "agregar") {
  itemSeleccionado = item;
  modoOperacion = modo;

  modalItemNombre.textContent = item.nombre;
  cantidadInput.value = 1;

  document.getElementById("btnAgregarCantidad").textContent = 
    modo === "agregar" ? "Agregar" : "Quitar";

  modal.style.display = "flex";
}


btnAgregarCantidad.addEventListener("click", () => {
  const cantidad = parseInt(cantidadInput.value);
  if (cantidad <= 0 || isNaN(cantidad)) {
    alert("Cantidad inválida");
    return;
  }

  if (modoOperacion === "agregar") {
    itemSeleccionado.cantidad += cantidad;
  } else {
    if (itemSeleccionado.cantidad < cantidad) {
      alert("No hay suficiente cantidad para quitar");
      return;
    }
    itemSeleccionado.cantidad -= cantidad;
  }

  const li = document.createElement("li");
  li.textContent = `${itemSeleccionado.nombre} - Cantidad ${modoOperacion === "agregar" ? "agregada" : "quitada"}: ${cantidad}`;
  lista.appendChild(li);
  cerrarModal();
  mostrarResultados();
});


btnCancelarModal.addEventListener("click", cerrarModal);

function cerrarModal() {
  modal.style.display = "none";
  itemSeleccionado = null;
}

function quitarCantidad(item) {
  mostrarModal(item, "quitar");
}


function eliminarItem(item) {
  itemSeleccionado = item;
  modalEliminarTexto.textContent = `¿Estás seguro de eliminar "${item.nombre}" del inventario?`;
  modalEliminar.style.display = "flex";
}

btnConfirmarEliminar.addEventListener("click", () => {
  const index = inventarioFalso.findIndex(i => i.id === itemSeleccionado.id);
  if (index !== -1) inventarioFalso.splice(index, 1);
  itemSeleccionado = null;
  modalEliminar.style.display = "none";
  mostrarResultados();
});

btnCancelarEliminar.addEventListener("click", () => {
  modalEliminar.style.display = "none";
  itemSeleccionado = null;
});


function mostrarDetalle(item) {
  document.getElementById("detalleNombre").textContent = item.nombre;
  document.getElementById("detalleImagen").src = item.imagen;
  document.getElementById("detalleDescripcion").textContent = item.descripcion;
  document.getElementById("detalleMarca").textContent = item.marca;
  modalDetalle.style.display = "flex";
}

function cerrarModalDetalle() {
  modalDetalle.style.display = "none";
}

