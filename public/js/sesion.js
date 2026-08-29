// Sesión en el frontend: quién eres, cómo salir, y qué pasa cuando caduca.
//
// Lo cargan las TRES pantallas de la aplicación, y siempre PRIMERO, antes que
// logica.js / edit.js / orden.js. El orden importa: este archivo envuelve
// `window.fetch`, y sólo cubre a quien pida después de que la envoltura esté
// puesta.
//
// EN IIFE POR OBLIGACIÓN, igual que devolucion.js. Los classic scripts comparten
// el ámbito global: `edit.js` y `logica.js` declaran los dos `const buscarInput`
// en el nivel superior, así que repetir aquí un nombre suyo no rompería una
// línea, rompería el archivo entero al parsear — antes de ejecutar nada.
(() => {
  'use strict';

  // Las tres claves del contrato entre la Principal y la Orden del día. Están
  // documentadas en CLAUDE.md; se repiten aquí porque cerrar sesión tiene que
  // borrarlas TODAS y hacerlo sin importar en qué pantalla se pulse.
  const CLAVES_DE_ORDEN = ['ordenSeleccion', 'ordenAplicada', 'ordenId'];

  // -------------------------------------------------------------------------
  // Caducidad de la sesión
  // -------------------------------------------------------------------------

  // Se envuelve `fetch` en vez de tocar los doce sitios que lo llaman en los
  // cuatro archivos de esta carpeta. No es magia gratuita: la regla es una sola
  // —un 401 de nuestra API significa que la sesión murió, y quien la ve tiene
  // que ir al login— y repetirla doce veces garantiza que alguna se quede sin
  // ella. Cada uno de esos flujos ya trata sus propios errores; esto se limita
  // a interceptar el caso en el que ya no hay nada que tratar.
  const fetchOriginal = window.fetch;

  window.fetch = async function (recurso, opciones) {
    const respuesta = await fetchOriginal.call(this, recurso, opciones);

    if (respuesta.status === 401) {
      const url = new URL(
        typeof recurso === 'string' ? recurso : recurso.url,
        window.location.origin
      );
      // Sólo nuestra API y sólo el 401. Un 403 NO manda al login: significa
      // "tu sesión vale, pero esto no es para ti", y echar a alguien de la
      // pantalla por eso sería mentirle sobre lo que pasó.
      if (url.origin === window.location.origin && url.pathname.startsWith('/api/')) {
        window.location.replace('/login');
      }
    }

    return respuesta;
  };

  // -------------------------------------------------------------------------
  // Barra de sesión
  // -------------------------------------------------------------------------

  function limpiarOrdenEnCurso() {
    // try/catch por el mismo motivo que en orden.js: sessionStorage LANZA en
    // modo privado. Y aquí saltar la excepción sería peor que en ningún sitio,
    // porque dejaría a alguien dentro de una sesión que cree haber cerrado.
    try {
      for (const clave of CLAVES_DE_ORDEN) sessionStorage.removeItem(clave);
    } catch {
      /* sin almacenamiento no hay nada que limpiar */
    }
  }

  async function salir() {
    // Se borra ANTES de la petición y pase lo que pase con ella: si el servidor
    // no responde, lo último que puede quedar es la selección del turno
    // anterior esperando a quien entre después en la misma tablet — y con
    // `ordenId` heredado, devolvería una orden ajena, que no se deshace.
    limpiarOrdenEnCurso();

    try {
      await fetchOriginal('/api/auth/salir', { method: 'POST' });
    } catch {
      /* la cookie caduca sola; irse al login es lo que importa */
    }

    window.location.replace('/login');
  }

  function pintarBarra(cuenta) {
    const nav = document.querySelector('.barra-app__nav');
    if (!nav) return;

    const bloque = document.createElement('div');
    bloque.className = 'barra-app__sesion';

    const quien = document.createElement('span');
    quien.className = 'barra-app__usuario';
    // textContent y no innerHTML: el nombre de usuario lo eligió una persona.
    quien.textContent = cuenta.usuario;
    // El rol tal cual, sin traducirlo: ya no son dos valores conocidos que se
    // puedan mapear a "Administrador" y "Superadministrador" — quien gestiona
    // cuentas puede crear `bodega` o `taquilla`, y el nombre que eligió es
    // justo el que hay que enseñar.
    quien.title = `Rol: ${cuenta.rol}`;

    const boton = document.createElement('button');
    boton.type = 'button';
    boton.className = 'barra-app__salir';
    boton.textContent = 'Salir';
    boton.addEventListener('click', salir);

    bloque.append(quien, boton);
    nav.after(bloque);
  }

  // El enlace al centro de gestión se INYECTA en vez de escribirse en el HTML de
  // cada pantalla: así las tres de siempre no se tocan, y ninguna se queda con
  // un enlace visible que lleva a una redirección.
  function pintarEnlaceCuentas() {
    const nav = document.querySelector('.barra-app__nav');
    if (!nav || nav.querySelector('[href="/html/cuentas.html"]')) return;

    const enlace = document.createElement('a');
    enlace.className = 'barra-app__enlace';
    enlace.href = '/html/cuentas.html';
    enlace.textContent = 'Cuentas';
    if (window.location.pathname === '/html/cuentas.html') {
      enlace.setAttribute('aria-current', 'page');
    }

    nav.append(enlace);
  }

  async function iniciar() {
    let cuenta;

    try {
      const respuesta = await fetchOriginal('/api/auth/yo');
      if (!respuesta.ok) return; // el 401 ya lo trata la envoltura de arriba
      cuenta = await respuesta.json();
    } catch {
      return; // sin red no se pinta la barra, pero la pantalla sigue usable
    }

    // Una clase en <html> y no en <body>: se aplica antes de que el navegador
    // pinte el cuerpo, así que lo que esta cuenta no puede hacer no llega a
    // parpadear en pantalla antes de esconderse.
    //
    // UNA CLASE POR PERMISO, y ya no una por rol. No es un cambio de estilo: con
    // roles que se crean desde la pantalla, `rol-bodega` no le dice nada al CSS
    // —no existía cuando se escribió— y la regla que escondía el botón de
    // eliminar dejaría de aplicarse justo donde debía. El permiso sí se puede
    // preguntar sin conocer el rol de antemano.
    //
    // Esto es MAQUILLAJE, y conviene decirlo: esconder el botón de eliminar no
    // impide borrar nada. La frontera de verdad es `exigirPermiso` en el
    // servidor, y así lo comprueban los tests — quien llame a la API a mano
    // recibe 403 igual. Aquí sólo se evita ofrecer lo que va a fallar.
    for (const permiso of cuenta.permisos || []) {
      document.documentElement.classList.add(`permiso-${permiso.replace('.', '-')}`);
    }

    pintarBarra(cuenta);
    if ((cuenta.permisos || []).includes('cuentas.gestionar')) pintarEnlaceCuentas();
  }

  // La barra vive dentro del <body>, así que hay que esperar a tenerlo. La
  // envoltura de `fetch`, en cambio, ya está puesta desde la primera línea.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', iniciar);
  } else {
    iniciar();
  }
})();
