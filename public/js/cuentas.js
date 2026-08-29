// Centro de gestión de cuentas y roles. Sólo lo carga /html/cuentas.html, y
// sólo llega ahí quien tiene `cuentas.gestionar`: el servidor no sirve ni esta
// pantalla ni este archivo a nadie más.
//
// Que no se sirva NO es la frontera de seguridad. La de verdad está en
// `exigirPermiso` delante de cada ruta de /api/, y así lo comprueban los tests:
// quien llame a la API a mano recibe 403 aunque se haya guardado una copia de
// este archivo. Lo de aquí es interfaz.
//
// EN IIFE, igual que sesion.js y devolucion.js: los classic scripts comparten
// el ámbito global y repetir aquí un nombre de otro archivo no rompería una
// línea, rompería el archivo entero al parsear.
(() => {
  'use strict';

  // ---------------------------------------------------------------------------
  // Estado
  // ---------------------------------------------------------------------------

  // Todo lo que la pantalla sabe. Se vuelve a pedir entero después de cada
  // cambio en vez de parchear la copia local: son cuatro listas cortas, y una
  // copia que se va desincronizando del servidor en una pantalla de permisos es
  // exactamente el sitio donde no conviene tenerla.
  const estado = {
    yo: null,
    cuentas: [],
    roles: [],
    permisos: [],
  };

  // Los nombres legibles viven aquí y el catálogo en el servidor. Si algún día
  // se añade un permiso y se olvida esta línea, la casilla sale igual con su
  // clave técnica: se ve fea, pero se puede marcar. Al revés —que la pantalla
  // tuviera su propia lista de permisos— el permiso nuevo sería invisible.
  const NOMBRE_PERMISO = {
    'productos.eliminar': 'Borrar productos del catálogo',
    'cuentas.gestionar': 'Gestionar cuentas y roles',
    'accesos.ver': 'Ver la bitácora de accesos',
  };

  const AYUDA_PERMISO = {
    'productos.eliminar':
      'Lo irreversible del inventario: borrar deja huérfanas las líneas de las órdenes viejas.',
    'cuentas.gestionar': 'Entrar a esta pantalla: crear cuentas, cambiar roles y contraseñas.',
    'accesos.ver': 'Leer quién intentó entrar, cuándo y desde dónde.',
  };

  // ---------------------------------------------------------------------------
  // Utilidades
  // ---------------------------------------------------------------------------

  const $ = (id) => document.getElementById(id);

  // Mismo escapado que edit.js: lo que teclea una persona no entra en innerHTML
  // sin pasar por aquí. La CSP es la segunda capa, no la primera.
  function escapar(texto) {
    const div = document.createElement('div');
    div.textContent = texto ?? '';
    return div.innerHTML;
  }

  function fechaCorta(iso) {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('es-MX');
  }

  function fechaLarga(iso) {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('es-MX');
  }

  // Toda petición pasa por aquí para que ningún flujo cante victoria cuando el
  // servidor dijo que no. El mensaje del servidor se prefiere al genérico:
  // "Es la única cuenta activa que puede gestionar cuentas" explica mucho más
  // que "error 409".
  async function pedir(url, opciones) {
    const respuesta = await fetch(url, {
      headers: opciones?.cuerpo ? { 'Content-Type': 'application/json' } : undefined,
      method: opciones?.metodo || 'GET',
      body: opciones?.cuerpo ? JSON.stringify(opciones.cuerpo) : undefined,
    });

    let datos = null;
    try {
      datos = await respuesta.json();
    } catch {
      /* una respuesta sin JSON no es peor que una con JSON ilegible */
    }

    if (!respuesta.ok) {
      throw new Error(datos?.error || `No se pudo completar la operación (${respuesta.status}).`);
    }
    return datos;
  }

  const aviso = $('aviso');

  function avisar(texto, tipo) {
    aviso.textContent = texto;
    aviso.className = `aviso aviso--${tipo}`;
    aviso.hidden = false;
    aviso.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  function limpiarAviso() {
    aviso.hidden = true;
    aviso.textContent = '';
  }

  // Envuelve una operación que escribe: avisa, recarga y deja el estado bueno.
  // Recargar SIEMPRE, también tras un error, porque un 409 del invariante
  // significa que la pantalla mostraba algo que el servidor no acepta — y verlo
  // vuelto a su sitio explica el rechazo mejor que el texto.
  async function operar(hacer, exito) {
    try {
      const datos = await hacer();
      avisar(datos?.mensaje || exito, 'exito');
    } catch (err) {
      avisar(err.message, 'error');
    }
    await cargar();
  }

  // ---------------------------------------------------------------------------
  // Cuentas
  // ---------------------------------------------------------------------------

  const tablaCuentas = $('tablaCuentas');

  function pintarCuentas() {
    if (estado.cuentas.length === 0) {
      tablaCuentas.innerHTML = '<tr><td colspan="5" class="no-results">No hay ninguna cuenta.</td></tr>';
      return;
    }

    tablaCuentas.innerHTML = estado.cuentas
      .map(
        (c) => `
        <tr class="${c.activa ? '' : 'fila-inactiva'}">
          <td><strong>${escapar(c.usuario)}</strong></td>
          <td><select class="rol-select" data-id="${c.id_cuenta}"
                      aria-label="Rol de ${escapar(c.usuario)}"></select></td>
          <td><span class="badge ${c.activa ? 'badge-activo' : 'badge-inactivo'}">${
            c.activa ? 'Activa' : 'De baja'
          }</span></td>
          <td class="dato-servicio">${fechaCorta(c.creada_en)}</td>
          <td>
            <div class="actions">
              <button type="button" class="btn-action" data-accion="clave" data-id="${c.id_cuenta}">
                Contraseña
              </button>
              <button type="button" class="btn-action ${c.activa ? 'btn-action--peligro' : ''}"
                      data-accion="${c.activa ? 'baja' : 'alta'}" data-id="${c.id_cuenta}">
                ${c.activa ? 'Dar de baja' : 'Reactivar'}
              </button>
            </div>
          </td>
        </tr>`
      )
      .join('');

    // Las opciones se montan con el DOM y no dentro del innerHTML de arriba: el
    // nombre de un rol también lo eligió una persona, y `textContent` no deja
    // que se interprete nada.
    for (const select of tablaCuentas.querySelectorAll('.rol-select')) {
      const cuenta = estado.cuentas.find((c) => c.id_cuenta === Number(select.dataset.id));

      for (const rol of estado.roles) {
        const opcion = document.createElement('option');
        opcion.value = rol.nombre;
        opcion.textContent = rol.nombre;
        opcion.selected = rol.nombre === cuenta.rol;
        select.append(opcion);
      }
    }
  }

  const ACCIONES_DE_CUENTA = {
    clave: (cuenta) => abrirModalClave(cuenta),

    alta: (cuenta) =>
      operar(
        () =>
          pedir(`/api/cuentas/${cuenta.id_cuenta}/activa`, {
            metodo: 'PATCH',
            cuerpo: { activa: true },
          }),
        `"${cuenta.usuario}" vuelve a estar activa.`
      ),

    // La baja sí se pregunta: cierra las sesiones abiertas de esa persona, y si
    // está trabajando se entera de golpe.
    baja: (cuenta) =>
      confirmar({
        titulo: '¿Dar de baja esta cuenta?',
        texto: `"${cuenta.usuario}" dejará de poder entrar.`,
        nota: 'Sus sesiones abiertas se cierran ahora mismo. Se puede reactivar cuando quieras.',
        etiqueta: 'Sí, dar de baja',
        alConfirmar: () =>
          operar(
            () =>
              pedir(`/api/cuentas/${cuenta.id_cuenta}/activa`, {
                metodo: 'PATCH',
                cuerpo: { activa: false },
              }),
            `"${cuenta.usuario}" queda de baja.`
          ),
      }),
  };

  tablaCuentas.addEventListener('click', (evento) => {
    const boton = evento.target.closest('[data-accion]');
    if (!boton) return;

    const cuenta = estado.cuentas.find((c) => c.id_cuenta === Number(boton.dataset.id));
    if (cuenta) ACCIONES_DE_CUENTA[boton.dataset.accion](cuenta);
  });

  tablaCuentas.addEventListener('change', (evento) => {
    const select = evento.target.closest('.rol-select');
    if (!select) return;

    const cuenta = estado.cuentas.find((c) => c.id_cuenta === Number(select.dataset.id));
    operar(
      () =>
        pedir(`/api/cuentas/${cuenta.id_cuenta}/rol`, {
          metodo: 'PATCH',
          cuerpo: { rol: select.value },
        }),
      `"${cuenta.usuario}" pasa a ${select.value}.`
    );
  });

  // ---------------------------------------------------------------------------
  // Roles
  // ---------------------------------------------------------------------------

  const listaRoles = $('listaRoles');

  function pintarRoles() {
    listaRoles.innerHTML = estado.roles
      .map((rol) => {
        const permisos =
          rol.permisos.length > 0
            ? `<ul class="tarjeta-rol__permisos">${rol.permisos
                .map((p) => `<li class="chip">${escapar(NOMBRE_PERMISO[p] || p)}</li>`)
                .join('')}</ul>`
            : `<p class="tarjeta-rol__sin-permisos">
                 Sin permisos especiales: entra y trabaja en el almacén como cualquiera.
               </p>`;

        // El rol semilla no ofrece los botones en vez de mostrarlos apagados:
        // un botón deshabilitado invita a preguntarse qué hay que hacer para
        // encenderlo, y aquí la respuesta es "nada, y es a propósito".
        const acciones = rol.semilla
          ? `<p class="tarjeta-rol__sin-permisos">
               Rol protegido: es la vía de vuelta si otro queda mal configurado.
             </p>`
          : `<div class="tarjeta-rol__acciones">
               <button type="button" class="btn-action" data-accion="editar"
                       data-rol="${escapar(rol.nombre)}">Editar</button>
               <button type="button" class="btn-action btn-action--peligro" data-accion="borrar"
                       data-rol="${escapar(rol.nombre)}" ${rol.cuentas > 0 ? 'disabled' : ''}>
                 Eliminar
               </button>
             </div>`;

        return `
          <article class="tarjeta-rol">
            <div>
              <h3 class="tarjeta-rol__nombre">${escapar(rol.nombre)}</h3>
              <p class="tarjeta-rol__meta">${rol.cuentas} cuenta(s)</p>
            </div>
            ${
              rol.descripcion
                ? `<p class="tarjeta-rol__descripcion">${escapar(rol.descripcion)}</p>`
                : ''
            }
            ${permisos}
            ${acciones}
          </article>`;
      })
      .join('');
  }

  listaRoles.addEventListener('click', (evento) => {
    const boton = evento.target.closest('[data-accion]');
    if (!boton) return;

    const rol = estado.roles.find((r) => r.nombre === boton.dataset.rol);
    if (!rol) return;

    if (boton.dataset.accion === 'editar') return abrirModalRol(rol);

    confirmar({
      titulo: '¿Eliminar este rol?',
      texto: `El rol "${rol.nombre}" desaparecerá de la lista.`,
      nota: 'No se puede deshacer, pero se puede volver a crear con el mismo nombre.',
      etiqueta: 'Sí, eliminar',
      alConfirmar: () =>
        operar(
          () => pedir(`/api/roles/${encodeURIComponent(rol.nombre)}`, { metodo: 'DELETE' }),
          `Rol "${rol.nombre}" eliminado.`
        ),
    });
  });

  // ---------------------------------------------------------------------------
  // Bitácora
  // ---------------------------------------------------------------------------

  const bloqueBitacora = $('bloqueBitacora');
  const tablaAccesos = $('tablaAccesos');

  async function pintarBitacora() {
    // Se pide sólo si el permiso está: sin él la respuesta sería un 403 y el
    // bloque tiene que quedarse escondido de todas formas.
    if (!estado.yo.permisos.includes('accesos.ver')) {
      bloqueBitacora.hidden = true;
      return;
    }
    bloqueBitacora.hidden = false;

    try {
      const accesos = await pedir('/api/accesos');
      tablaAccesos.innerHTML =
        accesos.length === 0
          ? '<tr><td colspan="4" class="no-results">Todavía no hay accesos registrados.</td></tr>'
          : accesos
              .map(
                (a) => `
                <tr>
                  <td class="dato-servicio">${fechaLarga(a.ocurrido_en)}</td>
                  <td>${escapar(a.usuario)}</td>
                  <td>${escapar(a.resultado)}</td>
                  <td class="dato-servicio">${escapar(a.ip)}</td>
                </tr>`
              )
              .join('');
    } catch (err) {
      tablaAccesos.innerHTML = `<tr><td colspan="4" class="no-results no-results--error">${escapar(
        err.message
      )}</td></tr>`;
    }
  }

  // ---------------------------------------------------------------------------
  // Modal: crear cuenta
  // ---------------------------------------------------------------------------

  const modalCuenta = $('modalCuenta');
  const formCuenta = $('formCuenta');
  const cuentaRol = $('cuentaRol');

  function abrirModalCuenta() {
    formCuenta.reset();

    cuentaRol.innerHTML = '';
    for (const rol of estado.roles) {
      const opcion = document.createElement('option');
      opcion.value = rol.nombre;
      opcion.textContent = rol.nombre;
      cuentaRol.append(opcion);
    }

    modalCuenta.style.display = 'flex';
    $('cuentaUsuario').focus();
  }

  function cerrarModalCuenta() {
    modalCuenta.style.display = 'none';
  }

  formCuenta.addEventListener('submit', async (evento) => {
    evento.preventDefault();
    const usuario = $('cuentaUsuario').value.trim();

    cerrarModalCuenta();
    await operar(
      () =>
        pedir('/api/cuentas', {
          metodo: 'POST',
          cuerpo: { usuario, clave: $('cuentaClave').value, rol: cuentaRol.value },
        }),
      `Cuenta "${usuario}" creada. Entrégale la contraseña en persona.`
    );
  });

  // ---------------------------------------------------------------------------
  // Modal: restablecer contraseña
  // ---------------------------------------------------------------------------

  const modalClave = $('modalClave');
  const formClave = $('formClave');
  let cuentaDeLaClave = null;

  function abrirModalClave(cuenta) {
    cuentaDeLaClave = cuenta;
    formClave.reset();
    $('textoClave').textContent = `Vas a cambiar la contraseña de "${cuenta.usuario}".`;
    modalClave.style.display = 'flex';
    $('claveNueva').focus();
  }

  function cerrarModalClave() {
    modalClave.style.display = 'none';
    cuentaDeLaClave = null;
  }

  formClave.addEventListener('submit', async (evento) => {
    evento.preventDefault();

    const cuenta = cuentaDeLaClave;
    const clave = $('claveNueva').value;
    cerrarModalClave();

    await operar(
      () => pedir(`/api/cuentas/${cuenta.id_cuenta}/clave`, { metodo: 'POST', cuerpo: { clave } }),
      `Contraseña de "${cuenta.usuario}" cambiada.`
    );
  });

  // ---------------------------------------------------------------------------
  // Modal: crear o editar rol
  // ---------------------------------------------------------------------------

  const modalRol = $('modalRol');
  const formRol = $('formRol');
  const rolNombre = $('rolNombre');
  const listaPermisos = $('listaPermisos');
  // null = estamos creando; un nombre = estamos editando ese rol.
  let rolEnEdicion = null;

  function abrirModalRol(rol) {
    rolEnEdicion = rol ? rol.nombre : null;

    $('tituloModalRol').textContent = rol ? `Editar rol "${rol.nombre}"` : 'Crear rol';
    // El nombre es clave primaria y clave foránea desde `cuentas.rol`: al editar
    // no se enseña siquiera, para no ofrecer un campo que el servidor ignora.
    $('grupoNombreRol').hidden = Boolean(rol);
    rolNombre.required = !rol;
    rolNombre.value = '';
    $('rolDescripcion').value = rol?.descripcion || '';

    listaPermisos.innerHTML = estado.permisos
      .map(
        (permiso) => `
        <label class="permisos__opcion">
          <input type="checkbox" value="${escapar(permiso)}"
                 ${rol?.permisos.includes(permiso) ? 'checked' : ''}>
          <span>
            ${escapar(NOMBRE_PERMISO[permiso] || permiso)}
            ${AYUDA_PERMISO[permiso] ? `<code>${escapar(AYUDA_PERMISO[permiso])}</code>` : ''}
          </span>
        </label>`
      )
      .join('');

    modalRol.style.display = 'flex';
    (rol ? $('rolDescripcion') : rolNombre).focus();
  }

  function cerrarModalRol() {
    modalRol.style.display = 'none';
    rolEnEdicion = null;
  }

  formRol.addEventListener('submit', async (evento) => {
    evento.preventDefault();

    const permisos = [...listaPermisos.querySelectorAll('input:checked')].map((c) => c.value);
    const descripcion = $('rolDescripcion').value.trim();
    const editando = rolEnEdicion;
    const nombre = editando || rolNombre.value.trim().toLowerCase();

    cerrarModalRol();

    await operar(
      () =>
        editando
          ? pedir(`/api/roles/${encodeURIComponent(editando)}`, {
              metodo: 'PUT',
              cuerpo: { descripcion, permisos },
            })
          : pedir('/api/roles', { metodo: 'POST', cuerpo: { nombre, descripcion, permisos } }),
      editando ? `Rol "${editando}" actualizado.` : `Rol "${nombre}" creado.`
    );
  });

  // ---------------------------------------------------------------------------
  // Diálogo de confirmación
  // ---------------------------------------------------------------------------

  const dialogo = $('dialogoConfirmar');
  const btnConfirmar = $('btnConfirmar');
  let alConfirmar = null;

  function confirmar({ titulo, texto, nota, etiqueta, alConfirmar: accion }) {
    $('dialogoTitulo').textContent = titulo;
    $('dialogoTexto').textContent = texto;
    $('dialogoNota').textContent = nota;
    btnConfirmar.textContent = etiqueta;
    alConfirmar = accion;
    dialogo.showModal();
  }

  btnConfirmar.addEventListener('click', () => {
    const accion = alConfirmar;
    dialogo.close();
    alConfirmar = null;
    if (accion) accion();
  });

  $('btnCancelarConfirmar').addEventListener('click', () => dialogo.close());

  // ---------------------------------------------------------------------------
  // Carga y arranque
  // ---------------------------------------------------------------------------

  async function cargar() {
    try {
      const [yo, cuentas, roles] = await Promise.all([
        pedir('/api/auth/yo'),
        pedir('/api/cuentas'),
        pedir('/api/roles'),
      ]);

      estado.yo = yo;
      estado.cuentas = cuentas;
      estado.roles = roles.roles;
      estado.permisos = roles.permisos;
    } catch (err) {
      // El 401 lo trata sesion.js llevando al login; lo que llegue aquí es otra
      // cosa —la red, un 500— y la pantalla tiene que decirlo en vez de
      // quedarse en blanco fingiendo que no hay cuentas.
      tablaCuentas.innerHTML = `<tr><td colspan="5" class="no-results no-results--error">${escapar(
        err.message
      )}</td></tr>`;
      return;
    }

    pintarCuentas();
    pintarRoles();
    await pintarBitacora();
  }

  $('btnNuevaCuenta').addEventListener('click', abrirModalCuenta);
  $('btnCancelarCuenta').addEventListener('click', cerrarModalCuenta);
  $('btnCancelarClave').addEventListener('click', cerrarModalClave);
  $('btnNuevoRol').addEventListener('click', () => abrirModalRol(null));
  $('btnCancelarRol').addEventListener('click', cerrarModalRol);

  // Clic en el fondo del modal = cancelar, igual que en el inventario.
  modalCuenta.addEventListener('click', (e) => {
    if (e.target === modalCuenta) cerrarModalCuenta();
  });
  modalClave.addEventListener('click', (e) => {
    if (e.target === modalClave) cerrarModalClave();
  });
  modalRol.addEventListener('click', (e) => {
    if (e.target === modalRol) cerrarModalRol();
  });

  limpiarAviso();
  cargar();
})();
