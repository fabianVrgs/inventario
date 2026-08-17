# Product

## Register

product

## Users

Dos personas, dos contextos físicos distintos, y el diseño tiene que servir a los dos:

- **El almacenista.** De pie entre estanterías, teléfono en una mano, luz fluorescente,
  a veces con guantes. Usa la **Principal** y la **Orden del día**. Su trabajo es elegir
  qué equipo sale hoy y en qué cantidad, y salir con el papel impreso. No administra el
  catálogo, no quiere ver columnas que no le importan, y cada toque que falla le cuesta
  volver a empezar.
- **El administrador.** Sentado, monitor grande, oficina iluminada. Usa **Inventario**.
  Mantiene el catálogo: da de alta, corrige, desactiva lo que ya no sale, exporta. Quiere
  densidad y ver muchas filas de un vistazo, no tarjetas espaciadas.

El trabajo a realizar es siempre el mismo y termina fuera de la pantalla: **producir una
hoja de papel correcta que alguien se lleva al almacén.**

## Product Purpose

Inventario de almacén de Ok-producciones. El catálogo se administra en Inventario, se
selecciona en la Principal, y en Orden del día se revisa y se imprime. **Al imprimir, el
stock baja de verdad**: `POST /api/ordenes` es el único camino que escribe existencias.

Dos reglas de negocio explican casi toda la interfaz:

- `activo` separa "existe en el catálogo" de "se puede pedir hoy".
- Imprimir dos veces descuenta una sola vez. Sacar dos copias del mismo papel es normal;
  descontar dos veces deja el inventario mal y no hay forma de devolver material.

Éxito es que el papel salga bien a la primera y que la cifra de la pantalla sea la del
estante. Un error aquí se paga en el evento, no en la pantalla.

## Brand Personality

**Preciso, sobrio, sin ceremonia.** El tono de un formato de despacho bien impreso: dice
lo que hay, en qué cantidad, y quién firma. Nada más.

La voz de la interfaz es directa y en español llano — "Agregar", "Desactivar",
"No hay productos seleccionados" — sin jerga de software y sin entusiasmo impostado. No
felicita al usuario por hacer su trabajo.

La emoción buscada no es deleite: es **confianza en la cifra**. El usuario debe poder
creerle al número que ve sin ir a contarlo al estante.

## Anti-references

- **Dashboard de tarjetas y cifrones.** Cuadrícula de tarjetas idénticas, números gigantes
  con etiqueta chica, acentos en degradado. Este producto no tiene métricas que contemplar;
  tiene una lista que ejecutar.
- **Panel de admin genérico tipo Bootstrap.** Botones azul/verde/rojo saturados compitiendo
  en la misma fila, tabla rayada, badges de colores por todas partes. Es literalmente de
  donde viene este proyecto y a donde no debe volver.
- **App de consumo llamativa.** Colores vivos, ilustraciones, esquinas muy redondeadas,
  animación decorativa. Esto es una herramienta de trabajo que se usa con prisa.

## Design Principles

1. **La pantalla es el antecedente del papel.** El producto termina en `window.print()`.
   La interfaz se parece al documento que produce: filetes finos, cifras alineadas,
   jerarquía por tipografía y espacio. No se parece a un dashboard.

2. **El número es el contenido.** Cantidades, existencias y totales son el dato que la
   gente vino a leer. Van en cifras tabulares, alineados, sin adorno y sin competir con
   nada de color a su lado.

3. **La densidad se elige por contexto, no por gusto.** Inventario es denso porque su
   usuario está sentado frente a un monitor. La Principal es holgada porque su usuario
   está de pie con el pulgar. La misma tabla no sirve para los dos.

4. **Una acción principal por pantalla.** Elegir en la Principal, administrar en
   Inventario, imprimir en Orden del día. Lo demás se subordina visualmente, sin excepción.

5. **Lo irreversible se ve venir.** Imprimir descuenta stock y eliminar borra el producto.
   Esas acciones se marcan como distintas antes de pulsarlas, no solo después.

## Accessibility & Inclusion

- **WCAG 2.1 AA como piso medible**, no como aspiración: 4.5:1 en texto normal, 3:1 en
  texto grande y en bordes de control (1.4.11). Los pares se verifican con números, no a ojo.
- **Objetivo táctil de 44×44 px** en todo lo pulsable. Se usa de pie y con prisa.
- **Operable solo con teclado**, con foco visible en cada elemento interactivo. El
  administrador trabaja con las manos en el teclado.
- **`prefers-reduced-motion` se respeta** en todas las transiciones.
- **El color nunca es el único portador de significado**: activo/inactivo lleva texto,
  no solo un punto de color.
- **Sin webfont, a propósito.** Esto corre en un almacén; el texto no debe depender de la
  red para renderizarse.
