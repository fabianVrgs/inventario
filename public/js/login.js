// Pantalla de acceso. El único JavaScript que se sirve sin sesión.
//
// En IIFE como devolucion.js, y por el mismo motivo: los classic scripts
// comparten el ámbito global. Aquí hoy no coincide con nadie, pero el día que
// alguien añada un segundo <script> a esta página, un nombre repetido rompería
// el archivo entero al parsear, no sólo la línea del choque.
(() => {
  'use strict';

  const formAcceso = document.getElementById('formAcceso');
  const campoUsuario = document.getElementById('usuario');
  const campoClave = document.getElementById('clave');
  const btnEntrar = document.getElementById('btnEntrar');
  const btnVerClave = document.getElementById('btnVerClave');
  const iconoVer = document.getElementById('iconoVer');
  const iconoOcultar = document.getElementById('iconoOcultar');
  const aviso = document.getElementById('avisoAcceso');

  // `campo` no es opcional por comodidad: sin llevar el foco al campo que hay
  // que corregir, tras un fallo el foco se queda en el botón de enviar y quien
  // navega con teclado tiene que volver a subir a ciegas hasta el formulario.
  function mostrarAviso(texto, campo) {
    aviso.textContent = texto;
    aviso.hidden = false;
    if (campo) campo.focus();
  }

  function limpiarAviso() {
    aviso.hidden = true;
    aviso.textContent = '';
  }

  // Deshabilitar mientras se espera evita el doble envío: dos POST idénticos
  // cuentan como dos intentos fallidos si la contraseña estaba mal, y acercan
  // al usuario legítimo al retraso por fuerza bruta sin que haya hecho nada.
  function ocupado(boton, activo, textoOriginal) {
    boton.disabled = activo;
    boton.textContent = activo ? 'Un momento…' : textoOriginal;
  }

  // Ver la contraseña que se está tecleando. En el almacén se escribe desde un
  // teléfono, de pie y con una mano: la contraseña se entrega en papel y se
  // teclea mal con más frecuencia de la que se olvida.
  //
  // El tipo del input se cambia en su sitio en vez de tener dos campos: un
  // segundo <input> haría que el gestor de contraseñas del navegador viera dos
  // credenciales distintas en la misma página.
  function alternarClave() {
    const visible = campoClave.type === 'text';
    // Cambiar `type` descoloca el cursor, así que se guarda y se repone: quien
    // pulsa "ver" casi siempre va a seguir escribiendo donde estaba.
    const desde = campoClave.selectionStart;
    const hasta = campoClave.selectionEnd;

    campoClave.type = visible ? 'password' : 'text';
    btnVerClave.setAttribute('aria-pressed', String(!visible));
    btnVerClave.setAttribute(
      'aria-label',
      visible ? 'Mostrar la contraseña' : 'Ocultar la contraseña'
    );
    iconoVer.hidden = !visible;
    iconoOcultar.hidden = visible;

    campoClave.focus();
    if (desde !== null) {
      campoClave.setSelectionRange(desde, hasta);
    }
  }

  btnVerClave.addEventListener('click', alternarClave);

  async function leerRespuesta(respuesta) {
    try {
      return await respuesta.json();
    } catch {
      return null;
    }
  }

  function entrar() {
    // `replace` y no `href`: así el botón "atrás" del navegador no devuelve a
    // la pantalla de login de una sesión que ya está abierta.
    window.location.replace('/');
  }

  formAcceso.addEventListener('submit', async (evento) => {
    evento.preventDefault();
    limpiarAviso();

    const usuario = campoUsuario.value.trim();
    const clave = campoClave.value;

    if (!usuario || !clave) {
      return mostrarAviso(
        'Escribe tu usuario y tu contraseña.',
        usuario ? campoClave : campoUsuario
      );
    }

    ocupado(btnEntrar, true, 'Entrar');

    try {
      const respuesta = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ usuario, clave }),
      });

      const datos = await leerRespuesta(respuesta);

      if (!respuesta.ok) {
        // Al campo de la contraseña y no al de usuario: el nombre casi siempre
        // estaba bien, y volver a teclearlo es trabajo de más.
        return mostrarAviso(
          datos?.error || 'No se pudo entrar. Inténtalo de nuevo.',
          campoClave
        );
      }

      entrar();
    } catch {
      mostrarAviso('No se pudo conectar con el servidor.');
    } finally {
      ocupado(btnEntrar, false, 'Entrar');
    }
  });
})();
