
// 🌐 Fuente de datos: API real (antes era un array hardcodeado).
// Los productos se recargan desde el backend después de cada
// create/update/delete/activar-desactivar en vez de mutar un array local.
let productos = [];
let productosFiltrados = [];
let areas = [];

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
const selectArea = document.getElementById('itemArea');

// 🔧 Helper: procesa una respuesta fetch. Si no fue ok, extrae el
// mensaje de error del backend (o uno genérico) y lanza una excepción.
// Así ningún flujo reporta éxito cuando la petición realmente falló.
async function manejarRespuesta(res) {
    let data = null;
    try {
        data = await res.json();
    } catch (e) {
        data = null;
    }

    if (!res.ok) {
        const mensaje = (data && data.error) ? data.error : `Error ${res.status} al comunicarse con el servidor`;
        throw new Error(mensaje);
    }

    return data;
}

// 🌐 Carga la lista de áreas desde la API y puebla el <select> del formulario
async function cargarAreas() {
    try {
        const res = await fetch('/api/areas');
        areas = await manejarRespuesta(res);

        selectArea.innerHTML = '<option value="">Elige el área</option>';
        areas.forEach(area => {
            const option = document.createElement('option');
            option.value = area.id_area;
            option.textContent = area.nombre;
            selectArea.appendChild(option);
        });
    } catch (error) {
        alert('No se pudieron cargar las áreas: ' + error.message);
    }
}

// 🌐 Carga TODO el catálogo desde la API y refresca la tabla.
// Sin filtro `?activo=1` a propósito: el CRUD es la única pantalla desde
// donde se puede reactivar un producto desactivado. Filtrar aquí lo
// volvería invisible para siempre. El filtro es de la Principal.
async function cargarProductos() {
    try {
        const res = await fetch('/api/productos');
        productos = await manejarRespuesta(res);
        productosFiltrados = [...productos];
        renderizarTabla();
    } catch (error) {
        alert('No se pudieron cargar los productos: ' + error.message);
        tablaInventario.innerHTML = `
            <tr>
                <td colspan="8" class="no-results">Error al cargar el inventario</td>
            </tr>
        `;
    }
}

// 📋 Renderiza la tabla con los datos del inventario
function renderizarTabla(datos = productosFiltrados) {
    tablaInventario.innerHTML = ''; // Limpia la tabla

    if (datos.length === 0) {
        tablaInventario.innerHTML = `
            <tr>
                <td colspan="8" class="no-results">No se encontraron productos</td>
            </tr>
        `;
        return;
    }

    // Recorre los ítems y crea las filas dinámicamente
    datos.forEach(item => {
        const row = document.createElement('tr');
        const activo = Number(item.activo) === 1;
        if (!activo) row.classList.add('fila-inactiva');

        row.innerHTML = `
            <td>${item.id_producto}</td>
            <td><strong>${item.nombre}</strong></td>
            <td>${item.marca ?? ''}</td>
            <td>${item.descripcion ?? ''}</td>
            <td>${item.area ?? ''}</td>
            <td>${item.cantidad}</td>
            <td><span class="badge ${
                  activo ? 'badge-success' : 'badge-danger'
            }">${activo ? 'Activo' : 'Inactivo'}</span></td>
            <td>
                <div class="actions">
                    <button class="btn-action btn-detail" onclick="verDetalle(${item.id_producto})">👁️</button>
                    <button class="btn-action btn-edit" onclick="editarItem(${item.id_producto})">✏️</button>
                    <button class="btn-action btn-toggle" title="${
                          activo ? 'Desactivar' : 'Reactivar'
                    }" onclick="alternarActivo(${item.id_producto})">${activo ? '🔌' : '⚡'}</button>
                    <button class="btn-action btn-delete" onclick="eliminarItem(${item.id_producto})">🗑️</button>
                </div>
            </td>
        `;

        tablaInventario.appendChild(row);
    });
}

// 🔍 Función para filtrar los productos al buscar
function filtrarInventario() {
    const termino = buscarInput.value.toLowerCase();
    productosFiltrados = productos.filter(item =>
        item.nombre.toLowerCase().includes(termino) ||
        (item.marca ?? '').toLowerCase().includes(termino) ||
        (item.descripcion ?? '').toLowerCase().includes(termino)
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
    const item = productos.find(i => i.id_producto === id);
    if (item) {
        modoEdicion = true;
        itemEditando = item;

        // Rellena el formulario con los datos existentes
        document.getElementById('itemNombre').value = item.nombre;
        document.getElementById('itemMarca').value = item.marca ?? '';
        document.getElementById('itemDescripcion').value = item.descripcion ?? '';
        document.getElementById('itemCantidad').value = item.cantidad;
        selectArea.value = item.id_area ?? '';

        abrirModal('Editar Item');
    }
}

// 🔍 Modal de Detalles
const modalDetalle = document.getElementById('modalDetalle');

function verDetalle(id) {
  const item = productos.find(i => i.id_producto === id);
  if (item) {
    document.getElementById('detalleNombre').textContent = item.nombre;
    document.getElementById('detalleMarca').textContent = item.marca ?? '';
    document.getElementById('detalleDescripcion').textContent = item.descripcion ?? '';
    document.getElementById('detalleArea').textContent = item.area ?? '';
    document.getElementById('detalleCantidad').textContent = item.cantidad;
    document.getElementById('detalleEstado').textContent = Number(item.activo) === 1 ? 'Activo' : 'Inactivo';

    modalDetalle.style.display = 'flex';
  }
}

function cerrarModalDetalle() {
  modalDetalle.style.display = 'none';
}

// 🔌 Alterna activo/inactivo. No borra nada: `activo` sólo decide si el
// producto aparece en la Principal. Manda lo contrario de lo que tiene hoy,
// así el mismo botón sirve para desactivar y para reactivar.
async function alternarActivo(id) {
    const item = productos.find(i => i.id_producto === id);
    if (!item) return;

    const estabaActivo = Number(item.activo) === 1;
    const nuevoValor = estabaActivo ? 0 : 1;

    const pregunta = estabaActivo
        ? `¿Desactivar "${item.nombre}"? Dejará de aparecer en la pantalla principal, pero seguirá en el inventario.`
        : `¿Reactivar "${item.nombre}"? Volverá a aparecer en la pantalla principal.`;

    if (!confirm(pregunta)) {
        return;
    }

    try {
        const res = await fetch(`/api/productos/${id}/activo`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ activo: nuevoValor })
        });
        await manejarRespuesta(res);
        alert(estabaActivo ? 'Item desactivado correctamente' : 'Item reactivado correctamente');
        await cargarProductos();
    } catch (error) {
        alert('No se pudo cambiar el estado del item: ' + error.message);
    }
}

// ❌ Modal de Confirmación de Eliminación
const modalEliminar = document.getElementById('modalEliminar');
const textoConfirmacionEliminar = document.getElementById('textoConfirmacionEliminar');
let itemAEliminar = null;

function eliminarItem(id) {
  const item = productos.find(i => i.id_producto === id);
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

async function confirmarEliminar() {
  if (itemAEliminar) {
    try {
      const res = await fetch(`/api/productos/${itemAEliminar.id_producto}`, {
        method: 'DELETE'
      });
      await manejarRespuesta(res);
      alert('Item eliminado correctamente');
      await cargarProductos();
    } catch (error) {
      alert('No se pudo eliminar el item: ' + error.message);
    }
  }
  cerrarModalEliminar();
}


// 💾 Descargar inventario como archivo CSV (datos reales de la API)
function descargarCSV() {
    const headers = ['ID', 'Nombre', 'Marca', 'Descripción', 'Área', 'Cantidad', 'Estado'];
    const csvContent = [
        headers.join(','),
        ...productos.map(item =>
            [
                item.id_producto,
                item.nombre,
                item.marca ?? '',
                item.descripcion ?? '',
                item.area ?? '',
                item.cantidad,
                Number(item.activo) === 1 ? 'Activo' : 'Inactivo'
            ].join(',')
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


// 📦 Envío del formulario (agrega o actualiza ítems contra la API real)
formItem.addEventListener('submit', async (e) => {
    e.preventDefault();

    const nombre = document.getElementById('itemNombre').value;
    const marca = document.getElementById('itemMarca').value;
    const descripcion = document.getElementById('itemDescripcion').value;
    const cantidad = Number(document.getElementById('itemCantidad').value);
    const id_area = parseInt(selectArea.value, 10);

    if (!id_area || Number.isNaN(id_area)) {
        alert('Selecciona un área para el producto');
        return;
    }

    const body = { nombre, marca, descripcion, cantidad, id_area };

    try {
        if (modoEdicion && itemEditando) {
            // 🔄 Actualiza el ítem existente
            const res = await fetch(`/api/productos/${itemEditando.id_producto}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });
            await manejarRespuesta(res);
            alert('Item actualizado correctamente');
        } else {
            // ➕ Agrega nuevo ítem
            const res = await fetch('/api/productos', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });
            await manejarRespuesta(res);
            alert('Item agregado correctamente');
        }

        cerrarModal();
        await cargarProductos();
    } catch (error) {
        alert('No se pudo guardar el item: ' + error.message);
    }
});

// 🔁 Inicializa la tabla y el select de áreas al cargar la página
cargarAreas();
cargarProductos();
