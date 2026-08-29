// Centro de gestión de cuentas. Sólo lo carga /html/cuentas.html, y
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
  // cambio en vez de parchear la copia local: son dos listas cortas, y una
  // copia que se va desincronizando del servidor en una pantalla de permisos es
  // exactamente el sitio donde no conviene tenerla.
  //
  // `roles` son las dos filas semilla de la base. La pantalla las lee para
  // llenar el <select> del alta, y no las escribe: no hay forma de crear ni
  // editar un rol desde aquí.
  const estado = {
    yo: null,
    cuentas: [],
    roles: [],
  };

  // La bitácora guardaba cuatro claves técnicas —'ok', 'clave', 'bloqueado',
  // 'salida'— y las pintaba tal cual. Quien lee esta tabla busca intentos raros
  // a las tres de la mañana, y "clave" no dice si alguien se equivocó al
  // teclear o si alguien estaba probando contraseñas.
  //
  // Si algún día se registra un resultado nuevo y se olvida esta línea, sale su
  // clave técnica en neutro: se ve peor, pero se ve.
  const RESULTADO_ACCESO = {
    ok: { texto: 'Entró', clase: 'badge-activo' },
    clave: { texto: 'Usuario o contraseña incorrectos', clase: 'badge-inactivo' },
    bloqueado: { texto: 'Frenado por intentos', clase: 'badge-aviso' },
    salida: { texto: 'Cerró sesión', clase: 'badge-inactivo' },
  };

  // ---------------------------------------------------------------------------
  // Utilidades
  // ---------------------------------------------------------------------------

  const $ = (id) => document.getElementById(id);

  // Mismo escapado que edit.js: lo que teclea una persona no entra en innerHTML
  // sin pasar por aquí. La CSP es la segunda capa, no la primera.
  //
  // Las comillas también: `div.innerHTML` no las escapa, y aquí hay texto de
  // persona dentro de atributos (`aria-label="Rol de ..."`, `data-usuario="..."`).
  // Hoy el validador del servidor no deja pasar una comilla en un usuario, pero
  // eso es una defensa que vive en otro archivo.
  function escapar(texto) {
    const div = document.createElement('div');
    div.textContent = texto ?? '';
    return div.innerHTML.replaceAll('"', '&quot;').replaceAll("'", '&#39;');
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
          <td><strong>${escapar(c.usuario)}</strong>${
            // La cuenta con la que estás dentro, dicha en su fila: en una lista
            // de nombres parecidos es fácil darse de baja a uno mismo, y el
            // servidor sólo lo impide si eres el último que gestiona cuentas.
            c.usuario === estado.yo?.usuario ? '<span class="marca-tu">Tu cuenta</span>' : ''
          }</td>
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

    // Las opciones se montan con el DOM y no dentro del innerHTML de arriba.
    // Hoy los dos nombres de rol vienen del esquema y no de nadie que teclee,
    // pero `textContent` no cuesta nada y no depende de que eso siga siendo
    // cierto el día que alguien meta un rol a mano en la base.
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
              .map((a) => {
                const r = RESULTADO_ACCESO[a.resultado];
                return `
                <tr>
                  <td class="dato-servicio">${fechaLarga(a.ocurrido_en)}</td>
                  <td><strong>${escapar(a.usuario)}</strong></td>
                  <td><span class="badge ${r ? r.clase : 'badge-inactivo'}">${
                    escapar(r ? r.texto : a.resultado)
                  }</span></td>
                  <td class="dato-servicio dato-ip">${escapar(a.ip)}</td>
                </tr>`;
              })
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
    } catch (err) {
      // El 401 lo trata sesion.js llevando al login; lo que llegue aquí es otra
      // cosa —la red, un 500— y la pantalla tiene que decirlo en vez de
      // quedarse en blanco fingiendo que no hay cuentas.
      tablaCuentas.innerHTML = `<tr><td colspan="5" class="no-results no-results--error">${escapar(
        err.message
      )}</td></tr>`;
      return;
    }

    pintarResumen();
    pintarCuentas();
    await pintarBitacora();
  }

  // Cuántas cuentas hay y en qué estado, en una frase. Misma primitiva que el
  // resumen del inventario: una línea de texto, no una rejilla de cifrones.
  //
  // No cuenta los roles: son dos y no cambian, así que la cifra sería un "2"
  // perpetuo — más ruido que dato.
  const resumenCuentas = $('resumenCuentas');

  function pintarResumen() {
    const activas = estado.cuentas.filter((c) => c.activa).length;
    const bajas = estado.cuentas.length - activas;

    const partes = [
      [estado.cuentas.length, estado.cuentas.length === 1 ? 'cuenta' : 'cuentas'],
      [activas, activas === 1 ? 'activa' : 'activas'],
    ];

    // El cero permanente se lee como un contador que hay que vaciar.
    if (bajas > 0) partes.push([bajas, 'de baja']);

    resumenCuentas.replaceChildren(
      ...partes.map(([n, palabra]) => {
        const span = document.createElement('span');
        const cifra = document.createElement('strong');
        cifra.textContent = String(n);
        span.append(cifra, document.createTextNode(` ${palabra}`));
        return span;
      })
    );

    resumenCuentas.hidden = false;
  }

  $('btnNuevaCuenta').addEventListener('click', abrirModalCuenta);
  $('btnCancelarCuenta').addEventListener('click', cerrarModalCuenta);
  $('btnCancelarClave').addEventListener('click', cerrarModalClave);

  // Clic en el fondo del modal = cancelar, igual que en el inventario.
  modalCuenta.addEventListener('click', (e) => {
    if (e.target === modalCuenta) cerrarModalCuenta();
  });
  modalClave.addEventListener('click', (e) => {
    if (e.target === modalClave) cerrarModalClave();
  });

  limpiarAviso();
  cargar();
})();
