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
  const aviso = document.getElementById('avisoAcceso');

  function mostrarAviso(texto) {
    aviso.textContent = texto;
    aviso.hidden = false;
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
      return mostrarAviso('Escribe tu usuario y tu contraseña.');
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
        return mostrarAviso(datos?.error || 'No se pudo entrar. Inténtalo de nuevo.');
      }

      entrar();
    } catch {
      mostrarAviso('No se pudo conectar con el servidor.');
    } finally {
      ocupado(btnEntrar, false, 'Entrar');
    }
  });
})();
