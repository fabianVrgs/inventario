
// 🌐 Fuente de datos: API real (antes era un array hardcodeado).
// Los productos se recargan desde el backend después de cada
// create/update/delete/activar-desactivar en vez de mutar un array local.
let productos = [];
let productosFiltrados = [];
let areas = [];

// Estados para control de edición
let modoEdicion = false;
let itemEditando = null;

// Orden de la tabla. Arranca por nombre ascendente y no por lo que devuelva
// Postgres, que es el orden físico de las filas: con productos que se llaman
// igual —hay dos "BT3" y dos "Array"— salían separados por media tabla.
let ordenColumna = 'nombre';
let ordenAscendente = true;

// 🧩 Referencias a elementos del DOM
const buscarInput = document.getElementById('buscar');
const tablaInventario = document.getElementById('tablaInventario');
const modalItem = document.getElementById('modalItem');
const formItem = document.getElementById('formItem');
const btnNuevoItem = document.getElementById('btnNuevoItem');
const btnCancelar = document.getElementById('btnCancelar');
const btnDescargarCSV = document.getElementById('btnDescargarCSV');
const selectArea = document.getElementById('itemArea');
const resumenCatalogo = document.getElementById('resumenCatalogo');
const cabeceraTabla = document.querySelector('.table thead');

// 🔧 Helper: convierte texto en algo que se puede meter dentro de innerHTML sin
// que el navegador lo interprete como marcado.
//
// Las filas de esta tabla se arman con plantillas de texto, y `nombre`, `marca`
// y `descripcion` los escribe una persona en un formulario. Sin esto, guardar un
// producto llamado `<img src=x onerror="...">` deja código ajeno almacenado en la
// base que se ejecuta en el navegador de quien abra Inventario después — un XSS
// almacenado, que es el peor de los tres tipos porque no hace falta engañar a
// nadie para que pulse un enlace: basta con esperar.
//
// El mismo helper existe en orden.js con este nombre. La Content-Security-Policy
// es la red por si algún día se escapa uno; esto es el suelo.
//
// LAS COMILLAS TAMBIÉN, y no es celo: `div.innerHTML` escapa `&`, `<` y `>`,
// pero NO `"` ni `'`. Con eso basta dentro de un texto, y no basta dentro de un
// atributo — y aquí el nombre del producto va en los `aria-label` de los cuatro
// botones de cada fila. Un producto llamado `x" onmouseover="algo` cerraría el
// atributo y abriría otro. La CSP no ejecutaría ese manejador, pero la CSP es la
// segunda capa; ésta es la primera. En un nodo de texto `&quot;` se dibuja como
// una comilla normal, así que escaparlas siempre no cuesta nada.
function escapar(texto) {
    const div = document.createElement('div');
    div.textContent = texto ?? '';
    return div.innerHTML.replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

// 🔧 Helper: una celda que no tiene dato. Una celda en blanco se lee igual que
// "esto todavía no ha cargado"; un guion dice que el producto no lo tiene.
// Devuelve marcado ya escapado, para meterlo dentro de innerHTML.
function sinDato(valor, texto = '—') {
    const limpio = valor == null ? '' : String(valor).trim();
    return limpio ? escapar(limpio) : `<span class="sin-dato">${texto}</span>`;
}

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
        pintarResumen();
        renderizarTabla();
    } catch (error) {
        alert('No se pudieron cargar los productos: ' + error.message);
        resumenCatalogo.hidden = true;
        tablaInventario.innerHTML = `
            <tr>
                <td colspan="8" class="no-results no-results--error">Error al cargar el inventario</td>
            </tr>
        `;
    }
}

// 📊 Qué hay en el catálogo, en una frase.
//
// Es una línea de texto y NO una rejilla de tarjetas con cifrones: el sistema
// visual rechaza ese tablero por su nombre. Aquí el número va dentro de la
// frase, con la unidad al lado, y los separa el mismo filete de 1px que separa
// todo lo demás.
//
// Se arma con nodos y no con innerHTML por costumbre de este archivo, aunque
// aquí todo sean números calculados: la excepción es justo lo que un día se
// copia y pega con un nombre de producto dentro.
function pintarResumen() {
    const activos = productos.filter(p => Number(p.activo) === 1).length;
    const bajas = productos.length - activos;
    const unidades = productos.reduce((total, p) => total + Number(p.cantidad), 0);
    const areas = new Set(productos.map(p => p.area).filter(Boolean)).size;

    const partes = [
        [productos.length, productos.length === 1 ? 'producto' : 'productos'],
        [activos, activos === 1 ? 'activo' : 'activos'],
        [unidades, unidades === 1 ? 'unidad en total' : 'unidades en total'],
        [areas, areas === 1 ? 'área' : 'áreas'],
    ];

    // "1 desactivado" sólo aparece si hay alguno: un cero permanente en la
    // línea invita a leerlo como un contador que hay que vaciar.
    if (bajas > 0) partes.splice(2, 0, [bajas, bajas === 1 ? 'desactivado' : 'desactivados']);

    resumenCatalogo.replaceChildren(...partes.map(([n, palabra]) => {
        const span = document.createElement('span');
        const cifra = document.createElement('strong');
        cifra.textContent = String(n);
        span.append(cifra, document.createTextNode(` ${palabra}`));
        return span;
    }));

    resumenCatalogo.hidden = productos.length === 0;
}

// ↕️ Ordena una copia, nunca `productos`: ése es el catálogo tal como vino de
// la API y lo leen el CSV, el detalle y el formulario de edición.
function ordenar(datos) {
    const signo = ordenAscendente ? 1 : -1;

    return [...datos].sort((a, b) => {
        if (ordenColumna === 'cantidad') {
            const diferencia = Number(a.cantidad) - Number(b.cantidad);
            // Empate a cantidad —hay muchos ceros— se rompe por nombre, para
            // que la tabla no baile entre repintados.
            if (diferencia !== 0) return diferencia * signo;
            return a.nombre.localeCompare(b.nombre, 'es');
        }
        // localeCompare con 'es': sin él la Ñ y los acentos caen detrás de la Z.
        return a.nombre.localeCompare(b.nombre, 'es') * signo;
    });
}

// Marca en la cabecera por qué columna se ordena. `aria-sort` va en el <th>,
// que es donde lo espera ARIA, y sólo puede haber uno en la tabla.
function pintarCabeceraOrden() {
    for (const boton of cabeceraTabla.querySelectorAll('.orden')) {
        const th = boton.closest('th');
        if (boton.dataset.ordenar === ordenColumna) {
            th.setAttribute('aria-sort', ordenAscendente ? 'ascending' : 'descending');
        } else {
            th.removeAttribute('aria-sort');
        }
    }
}

cabeceraTabla.addEventListener('click', (evento) => {
    const boton = evento.target.closest('[data-ordenar]');
    if (!boton) return;

    const columna = boton.dataset.ordenar;
    // Pulsar la columna que ya ordena invierte el sentido; cambiar de columna
    // empieza por ascendente, que es lo que espera cualquiera.
    if (columna === ordenColumna) {
        ordenAscendente = !ordenAscendente;
    } else {
        ordenColumna = columna;
        ordenAscendente = true;
    }

    renderizarTabla();
});

// 🎨 Iconos SVG en línea, estilo Lucide: trazo 2px, heredan currentColor.
// Antes eran emoji (👁️ ✏️ 🔌 ⚡ 🗑️). Como eran el único contenido del botón,
// los cuatro botones de acción no tenían nombre accesible, y además cada
// sistema operativo los dibujaba distinto. Van en línea a propósito: este
// proyecto no tiene build step ni debe depender de la red para pintar iconos.
const svgIcono = (trazos) =>
    `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${trazos}</svg>`;

const ICONOS = {
    ver: svgIcono('<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>'),
    editar: svgIcono('<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/>'),
    desactivar: svgIcono('<path d="M12 2v10"/><path d="M18.4 6.6a9 9 0 1 1-12.77.04"/>'),
    reactivar: svgIcono('<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>'),
    eliminar: svgIcono('<path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/>')
};

// 📋 Renderiza la tabla con los datos del inventario
function renderizarTabla(datos = productosFiltrados) {
    tablaInventario.innerHTML = ''; // Limpia la tabla
    pintarCabeceraOrden();
    datos = ordenar(datos);

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

        const cantidad = Number(item.cantidad);

        row.innerHTML = `
            <td>${item.id_producto}</td>
            <td><strong>${escapar(item.nombre)}</strong></td>
            <td>${sinDato(item.marca)}</td>
            <td>${sinDato(item.descripcion)}</td>
            <td>${sinDato(item.area, 'Sin área')}</td>
            <td class="${cantidad === 0 ? 'agotado' : ''}">${cantidad}</td>
            <td><span class="badge ${
                  activo ? 'badge-activo' : 'badge-inactivo'
            }">${activo ? 'Activo' : 'Inactivo'}</span></td>
            <td>
                <div class="actions">
                    <button class="btn-action btn-detail" title="Ver detalle" aria-label="Ver detalle de ${escapar(item.nombre)}" data-accion="ver" data-id="${item.id_producto}">${ICONOS.ver}</button>
                    <button class="btn-action btn-edit" title="Editar" aria-label="Editar ${escapar(item.nombre)}" data-accion="editar" data-id="${item.id_producto}">${ICONOS.editar}</button>
                    <button class="btn-action btn-toggle" title="${
                          activo ? 'Desactivar' : 'Reactivar'
                    }" aria-label="${
                          activo ? 'Desactivar' : 'Reactivar'
                    } ${escapar(item.nombre)}" data-accion="alternar" data-id="${item.id_producto}">${activo ? ICONOS.desactivar : ICONOS.reactivar}</button>
                    <span class="actions__separador" aria-hidden="true"></span>
                    <button class="btn-action btn-delete" title="Eliminar" aria-label="Eliminar ${escapar(item.nombre)}" data-accion="eliminar" data-id="${item.id_producto}">${ICONOS.eliminar}</button>
                </div>
            </td>
        `;

        tablaInventario.appendChild(row);
    });
}

// Un solo listener en el <tbody> para las cuatro acciones de todas las filas,
// en vez de un `onclick=` por botón.
//
// El motivo es la Content-Security-Policy: `script-src 'self'` no ejecuta
// JavaScript escrito dentro de un atributo del HTML, y esa prohibición es justo
// la mitad útil de la cabecera — es lo que hace que un `<img onerror=...>` que
// se cuele en un campo de texto no llegue a ejecutarse. Permitir los manejadores
// en línea exigiría 'unsafe-inline', que los devuelve a los dos.
//
// Delegar también sale gratis en corrección: las filas se repintan enteras en
// cada búsqueda, y los listeners por botón habría que volver a colgarlos cada
// vez. Éste sobrevive a los repintados porque cuelga del contenedor.
const ACCIONES_DE_FILA = {
    ver: verDetalle,
    editar: editarItem,
    alternar: alternarActivo,
    eliminar: eliminarItem,
};

tablaInventario.addEventListener('click', (evento) => {
    const boton = evento.target.closest('[data-accion]');
    if (!boton || !tablaInventario.contains(boton)) return;

    const accion = ACCIONES_DE_FILA[boton.dataset.accion];
    if (accion) accion(Number(boton.dataset.id));
});

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
function abrirModal(titulo = 'Agregar producto') {
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

        abrirModal('Editar producto');
    }
}

// 🔍 Modal de Detalles
const modalDetalle = document.getElementById('modalDetalle');
const btnDetalleAlternar = document.getElementById('btnDetalleAlternar');

// Qué producto se está mirando. En el teléfono esta ventana es el único sitio
// desde el que se puede editar, desactivar o borrar, así que las tres acciones
// necesitan saber sobre cuál operan.
let itemDelDetalle = null;

function verDetalle(id) {
  const item = productos.find(i => i.id_producto === id);
  if (item) {
    itemDelDetalle = item;
    const activo = Number(item.activo) === 1;

    document.getElementById('detalleNombre').textContent = item.nombre;
    document.getElementById('detalleMarca').textContent = item.marca || '—';
    document.getElementById('detalleDescripcion').textContent = item.descripcion || '—';
    document.getElementById('detalleArea').textContent = item.area || 'Sin área';
    document.getElementById('detalleCantidad').textContent = item.cantidad;
    document.getElementById('detalleEstado').textContent = activo ? 'Activo' : 'Inactivo';

    // El mismo botón sirve para las dos direcciones, igual que el de la fila.
    btnDetalleAlternar.textContent = activo ? 'Desactivar' : 'Reactivar';

    modalDetalle.style.display = 'flex';
  }
}

function cerrarModalDetalle() {
  modalDetalle.style.display = 'none';
  itemDelDetalle = null;
}

// Las tres acciones cierran el detalle ANTES de actuar: las dos primeras abren
// otra ventana encima —el formulario y la confirmación de borrado—, y dos
// modales superpuestos dejan al de abajo atrapando los clics que caen fuera
// del de arriba. La tercera pregunta con `confirm()`, que tampoco tiene
// sentido tras una ventana que ya no hace falta leer.
function conElDetalle(hacer) {
  return () => {
    const item = itemDelDetalle;
    cerrarModalDetalle();
    if (item) hacer(item.id_producto);
  };
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

// Los botones de los dos modales de esta pantalla. Antes llevaban `onclick=` en
// el HTML; la Content-Security-Policy no ejecuta eso, así que ahora se cuelgan
// aquí. Es también la razón por la que estas funciones ya no necesitan ser
// globales para funcionar.
document.getElementById('btnCerrarDetalle').addEventListener('click', cerrarModalDetalle);
document.getElementById('btnDetalleEditar').addEventListener('click', conElDetalle(editarItem));
btnDetalleAlternar.addEventListener('click', conElDetalle(alternarActivo));
document.getElementById('btnDetalleEliminar').addEventListener('click', conElDetalle(eliminarItem));
document.getElementById('btnCancelarEliminar').addEventListener('click', cerrarModalEliminar);
document.getElementById('btnConfirmarEliminar').addEventListener('click', confirmarEliminar);

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
