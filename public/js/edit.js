
const inventarioData = [
    { id: 1, nombre: "Micrófono Inalámbrico", marca: "Shure", descripcion: "Micrófono inalámbrico profesional UHF", cantidad: 12 , estado: "Disponible"},
    { id: 2, nombre: "Bocina RCF", marca: "YAMAHA", descripcion: "Bocina de alto rendimiento para conciertos", cantidad: 8, estado: "Disponible"},
    { id: 3, nombre: "Cable XLR", marca: "Proel", descripcion: "Cable XLR profesional de 5 metros", cantidad: 40, estado: "Disponible"},
    { id: 4, nombre: "Consola de Mezcla", marca: "Behringer", descripcion: "Consola de mezcla digital de 16 canales", cantidad: 5, estado: "No disponible"},
    { id: 5, nombre: "Soporte para Micrófono", marca: "K&M", descripcion: "Soporte ajustable para micrófono de pie", cantidad: 20, estado: "Disponible"},
];

// Copia filtrada para búsqueda
let inventarioFiltrado = [...inventarioData];
// Estados para control de edición
let modoEdicion = false;
let itemEditando = null;

// 🧩 Referencias a elementos del DOM
const buscarInput = document.getElementById('buscar');
const tablaInventario = document.getElementById('tablaInventario');
const modalItem = document.getElementById('modalItem');
const formItem = document.getElementById('formItem');
const btnNuevoItem = document.getElementById('btnNuevoItem');
const btnCancelar = document.getElementById('btnCancelar');
const btnDescargarCSV = document.getElementById('btnDescargarCSV');



// 📋 Renderiza la tabla con los datos del inventario
function renderizarTabla(datos = inventarioFiltrado) {
    tablaInventario.innerHTML = ''; // Limpia la tabla

    if (datos.length === 0) {
        tablaInventario.innerHTML = `
            <tr>
                <td colspan="7" class="no-results">No se encontraron productos</td>
            </tr>
        `;
        return;
    }

    // Recorre los ítems y crea las filas dinámicamente
    datos.forEach(item => {
        const row = document.createElement('tr');

        row.innerHTML = `
            <td>${item.id}</td>
            <td><strong>${item.nombre}</strong></td>
            <td>${item.marca}</td>
            <td>${item.descripcion}</td>
            <td>${item.cantidad}</td>
            <td><span class="badge ${
                  item.estado === 'Disponible' ? 'badge-success' : 'badge-danger'
            }">${item.estado}</span></td>
            <td>
                <div class="actions">
                    <button class="btn-action btn-detail" onclick="verDetalle(${item.id})">👁️</button>
                    <button class="btn-action btn-edit" onclick="editarItem(${item.id})">✏️</button>
                    <button class="btn-action btn-delete" onclick="eliminarItem(${item.id})">🗑️</button>
                </div>
            </td>
        `;

        tablaInventario.appendChild(row);
    });
}

// 🔍 Función para filtrar los productos al buscar
function filtrarInventario() {
    const termino = buscarInput.value.toLowerCase();
    inventarioFiltrado = inventarioData.filter(item =>
        item.nombre.toLowerCase().includes(termino) ||
        item.marca.toLowerCase().includes(termino) ||
        item.descripcion.toLowerCase().includes(termino)
    );
    renderizarTabla();
}

// 🧱 Modal: abrir con título personalizado
function abrirModal(titulo = 'Agregar Nuevo Item') {
    document.getElementById('modalTitle').textContent = titulo;
    modalItem.style.display = 'flex';
}

// ❌ Cierra el modal y resetea el formulario
function cerrarModal() {
    modalItem.style.display = 'none';
    formItem.reset();
    modoEdicion = false;
    itemEditando = null;
}

// ✏️ Editar un ítem del inventario
function editarItem(id) {
    const item = inventarioData.find(i => i.id === id);
    if (item) {
        modoEdicion = true;
        itemEditando = item;

        // Rellena el formulario con los datos existentes
        document.getElementById('itemNombre').value = item.nombre;
        document.getElementById('itemMarca').value = item.marca;
        document.getElementById('itemDescripcion').value = item.descripcion;
        document.getElementById('itemCantidad').value = item.cantidad;
        document.getElementById("itemestado").value = item.estado;

        abrirModal('Editar Item');
    }
}

// 🔍 Modal de Detalles
const modalDetalle = document.getElementById('modalDetalle');

function verDetalle(id) {
  const item = inventarioData.find(i => i.id === id);
  if (item) {
    document.getElementById('detalleNombre').textContent = item.nombre;
    document.getElementById('detalleMarca').textContent = item.marca;
    document.getElementById('detalleDescripcion').textContent = item.descripcion;
    document.getElementById('detalleCantidad').textContent = item.cantidad;
    document.getElementById('detalleEstado').textContent = item.estado;

    modalDetalle.style.display = 'flex';
  }
}

function cerrarModalDetalle() {
  modalDetalle.style.display = 'none';
}

// ❌ Modal de Confirmación de Eliminación
const modalEliminar = document.getElementById('modalEliminar');
const textoConfirmacionEliminar = document.getElementById('textoConfirmacionEliminar');
let itemAEliminar = null;

function eliminarItem(id) {
  const item = inventarioData.find(i => i.id === id);
  if (item) {
    itemAEliminar = item;
    textoConfirmacionEliminar.textContent = `¿Seguro que deseas eliminar "${item.nombre}"?`;
    modalEliminar.style.display = 'flex';
  }
}

function cerrarModalEliminar() {
  modalEliminar.style.display = 'none';
  itemAEliminar = null;
}

function confirmarEliminar() {
  if (itemAEliminar) {
    const index = inventarioData.findIndex(i => i.id === itemAEliminar.id);
    if (index !== -1) {
      inventarioData.splice(index, 1);
      filtrarInventario();
      alert('Item eliminado correctamente');
    }
  }
  cerrarModalEliminar();
}


// 💾 Descargar inventario como archivo CSV
function descargarCSV() {
    const headers = ['ID', 'Nombre', 'Marca', 'Descripción', 'Cantidad'];
    const csvContent = [
        headers.join(','),
        ...inventarioData.map(item => 
            [item.id, item.nombre, item.marca, item.descripcion, item.cantidad].join(',')
        )
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'inventario.csv';
    a.click();
    window.URL.revokeObjectURL(url);
}

// 🎧 Eventos de interacción
buscarInput.addEventListener('input', filtrarInventario);
btnNuevoItem.addEventListener('click', () => abrirModal());
btnCancelar.addEventListener('click', cerrarModal);
btnDescargarCSV.addEventListener('click', descargarCSV);

// Cierra el modal al hacer clic fuera del contenido
modalItem.addEventListener('click', (e) => {
    if (e.target === modalItem) {
        cerrarModal();
    }
});

modalDetalle.addEventListener('click', e => {
  if (e.target === modalDetalle) cerrarModalDetalle();
});

modalEliminar.addEventListener('click', e => {
  if (e.target === modalEliminar) cerrarModalEliminar();
});


// 📦 Envío del formulario (agrega o actualiza ítems)
formItem.addEventListener('submit', (e) => {
    e.preventDefault();

    const nombre = document.getElementById('itemNombre').value;
    const marca = document.getElementById('itemMarca').value;
    const descripcion = document.getElementById('itemDescripcion').value;
    const cantidad = parseInt(document.getElementById('itemCantidad').value);
    const estado = document.getElementById("itemestado").value;

    if (modoEdicion && itemEditando) {
        // 🔄 Actualiza el ítem existente
        itemEditando.nombre = nombre;
        itemEditando.marca = marca;
        itemEditando.descripcion = descripcion;
        itemEditando.cantidad = cantidad;
        alert('Item actualizado correctamente');
    } else {
        // ➕ Agrega nuevo ítem
        const nuevoId = Math.max(...inventarioData.map(i => i.id)) + 1;
        inventarioData.push({
            id: nuevoId,
            nombre,
            marca,
            descripcion,
            cantidad
        });
        alert('Item agregado correctamente');
    }

    filtrarInventario();
    cerrarModal();
});

// 🔁 Inicializa la tabla al cargar la página
renderizarTabla();
