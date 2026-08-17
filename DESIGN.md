---
name: Inventario Ok-producciones
description: Herramienta de almacén con estética de documento — tinta sobre papel, filetes finos, cifras tabulares.
colors:
  papel: "oklch(98.2% 0.0035 338)"
  papel-hundido: "oklch(96.2% 0.005 338)"
  superficie: "oklch(99.6% 0.0015 338)"
  filete: "oklch(91.2% 0.006 338)"
  filete-fuerte: "oklch(84.5% 0.009 338)"
  borde-control: "oklch(64.5% 0.013 338)"
  tinta-tenue: "oklch(52.8% 0.016 338)"
  tinta-suave: "oklch(47.5% 0.017 338)"
  tinta: "oklch(32% 0.02 338)"
  tinta-fuerte: "oklch(20.5% 0.021 338)"
  marca: "oklch(53.9% 0.186 338)"
  marca-fuerte: "oklch(46% 0.17 338)"
  marca-lavado: "oklch(96% 0.022 338)"
  marca-filete: "oklch(88% 0.06 338)"
  peligro: "oklch(50.5% 0.185 27)"
  peligro-fuerte: "oklch(43.5% 0.165 27)"
  peligro-lavado: "oklch(95.2% 0.019 27)"
  peligro-texto: "oklch(37.5% 0.14 27)"
  exito: "oklch(52% 0.13 152)"
  exito-lavado: "oklch(96% 0.035 152)"
  exito-texto: "oklch(39% 0.1 152)"
  aviso-lavado: "oklch(95.2% 0.03 75)"
  aviso-texto: "oklch(44% 0.083 75)"
typography:
  display:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica Neue, Arial, sans-serif"
    fontSize: "1.5rem"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "-0.014em"
  headline:
    fontSize: "1.3125rem"
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: "-0.01em"
  title:
    fontSize: "1.125rem"
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "-0.006em"
  body:
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.55
    letterSpacing: "normal"
  label:
    fontSize: "0.75rem"
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: "0.07em"
  cifra:
    fontSize: "1rem"
    fontWeight: 500
    lineHeight: 1.4
    fontFeature: "tnum 1, lnum 1"
rounded:
  sm: "3px"
  md: "5px"
  lg: "8px"
  full: "9999px"
spacing:
  "1": "0.25rem"
  "2": "0.5rem"
  "3": "0.75rem"
  "4": "1rem"
  "5": "1.5rem"
  "6": "2rem"
  "7": "3rem"
  "8": "4rem"
components:
  button-primary:
    backgroundColor: "{colors.tinta-fuerte}"
    textColor: "{colors.superficie}"
    rounded: "{rounded.md}"
    padding: "0.5rem 1rem"
    height: "44px"
  button-primary-hover:
    backgroundColor: "{colors.tinta}"
  button-secondary:
    backgroundColor: "{colors.superficie}"
    textColor: "{colors.tinta}"
    rounded: "{rounded.md}"
    padding: "0.5rem 1rem"
    height: "44px"
  button-secondary-hover:
    backgroundColor: "{colors.papel-hundido}"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.tinta-suave}"
    rounded: "{rounded.md}"
    padding: "0.5rem 0.75rem"
    height: "44px"
  button-danger:
    backgroundColor: "{colors.peligro}"
    textColor: "{colors.superficie}"
    rounded: "{rounded.md}"
    padding: "0.5rem 1rem"
    height: "44px"
  input-field:
    backgroundColor: "{colors.superficie}"
    textColor: "{colors.tinta}"
    rounded: "{rounded.md}"
    padding: "0.5rem 0.75rem"
    height: "44px"
  badge-activo:
    backgroundColor: "{colors.exito-lavado}"
    textColor: "{colors.exito-texto}"
    typography: "{typography.label}"
    rounded: "{rounded.sm}"
    padding: "0.125rem 0.5rem"
  badge-inactivo:
    backgroundColor: "{colors.papel-hundido}"
    textColor: "{colors.tinta-suave}"
    typography: "{typography.label}"
    rounded: "{rounded.sm}"
    padding: "0.125rem 0.5rem"
  fila-seleccionable:
    backgroundColor: "{colors.superficie}"
    textColor: "{colors.tinta}"
    rounded: "{rounded.md}"
    padding: "0.75rem 0.75rem"
---

# Design System: Inventario Ok-producciones

## 1. Overview

**Creative North Star: "La hoja de despacho"**

Este producto termina en una impresora. El flujo entero — cargar catálogo, elegir qué sale,
revisar, imprimir — existe para producir un papel carta que alguien se lleva al almacén y
firma. El sistema visual asume eso literalmente: la pantalla es el **antecedente del
documento**, no un tablero de control que casualmente puede imprimir.

En la práctica eso significa tinta sobre papel. El fondo es un blanco cálido apenas tintado
hacia el morado de la marca; el texto es un casi-negro de la misma familia. La estructura la
llevan **filetes de 1px y espacio en blanco**, no tarjetas flotando con sombra. Las
cantidades van en cifras tabulares alineadas a la derecha, porque en un inventario el número
es el contenido y no un adorno del contenido. La única superficie que se permite parecer una
hoja levantada del escritorio es el formato de Orden del día, y se lo gana porque de verdad
es una hoja.

El morado #ae3592 del logo sigue vivo, pero deja de ser el color de los botones. La acción
primaria va en tinta —el movimiento de Stripe y Notion— y el morado queda reservado para
identidad, para la regla que abre cada sección de área, para el estado seleccionado y para
el anillo de foco. Un acento que aparece poco se lee como decisión; uno que aparece en todo
se lee como plantilla. Este sistema rechaza explícitamente sus tres anti-referencias:
el **dashboard de tarjetas y cifrones**, el **panel de admin genérico tipo Bootstrap** del
que este proyecto viene, y la **app de consumo llamativa**.

**Key Characteristics:**

- Documento antes que tablero: filetes y espacio, no tarjetas ni sombras.
- Tinta como color de acción; morado como marca, estado y foco, nunca como relleno de botón.
- Cifras tabulares en toda cantidad, existencia o total.
- Densidad elegida por contexto: Inventario denso para monitor, Principal holgada para pulgar.
- Plano en reposo; la elevación solo aparece cuando algo de verdad flota (modal, barra fija).
- Sin webfont: la tipografía del sistema, porque esto corre en un almacén.

## 2. Colors

Una escala de tinta sobre papel, toda tintada hacia el tono 338 de la marca, más un acento
de identidad y tres semánticos. Los valores canónicos son OKLCH; el hex que acompaña es su
resolución en sRGB, no una segunda fuente de verdad.

### Primary

- **Tinta de Imprenta** (`oklch(20.5% 0.021 338)` → #1e131a): el color de la acción. Fondo
  del botón primario, títulos, y el texto que tiene que leerse primero. Es un negro cálido
  con una gota de morado, nunca #000. 17.8:1 sobre superficie.
- **Tinta** (`oklch(32% 0.02 338)` → #3a2f36): texto de cuerpo y estado hover del botón
  primario. 12.6:1.

### Secondary

- **Morado Ok** (`oklch(53.9% 0.186 338)` → #ae3593): el morado del logo, al bit. Solo cuatro
  trabajos: la regla y el rótulo que abren cada sección de área, el estado seleccionado, el
  anillo de foco, y los enlaces dentro de texto. 5.6:1 sobre superficie.
- **Morado Profundo** (`oklch(46% 0.17 338)` → #8f2378): hover y `:active` de lo anterior. 7.8:1.
- **Lavado de Morado** (`oklch(96% 0.022 338)` → #fcecf7) y **Filete de Morado**
  (`oklch(88% 0.06 338)` → #f3c9e5): fondo y borde del estado seleccionado. Nunca como
  decoración de fondo de sección.

### Tertiary

- **Rojo de Corrección** (`oklch(50.5% 0.185 27)` → #b72121): solo destrucción y fallo.
  Eliminar, faltantes de stock, error de carga. Acompañado siempre de texto, jamás solo color.
- **Verde de Visto Bueno** (`oklch(52% 0.13 152)` → #137d41): solo el estado *Activo*. No es
  un color de acción; no hay ningún botón verde en este sistema.
- **Ámbar de Nota** (`oklch(95.2% 0.03 75)` / `oklch(44% 0.083 75)`): avisos que no bloquean.

### Neutral

- **Papel** (`oklch(98.2% 0.0035 338)` → #fbf8fa): el fondo de la aplicación. Blanco cálido,
  nunca #fff.
- **Superficie** (`oklch(99.6% 0.0015 338)` → #fefdfe): la hoja, el modal, la fila de tabla.
  Se separa del papel por tono, no por sombra.
- **Papel Hundido** (`oklch(96.2% 0.005 338)` → #f5f1f4): cabecera de tabla, fila inactiva,
  fondo de control secundario.
- **Filete** (`oklch(91.2% 0.006 338)` → #e5e0e3) y **Filete Fuerte**
  (`oklch(84.5% 0.009 338)` → #d0cace): los divisores de 1px que llevan toda la estructura.
- **Borde de Control** (`oklch(64.5% 0.013 338)` → #938b90): el borde de inputs y selects.
  Es notablemente más oscuro que un filete a propósito: WCAG 1.4.11 exige 3:1 en el borde que
  es la única señal de que algo es un campo. Mide 3.28:1 sobre superficie.
- **Tinta Suave** (`oklch(47.5% 0.017 338)` → #635960) y **Tinta Tenue**
  (`oklch(52.8% 0.016 338)` → #72686e): texto secundario y terciario. La tenue está calculada
  al filo: 4.80:1 sobre papel hundido, que es su fondo más oscuro. No aclararla.

### Named Rules

**La Regla del Acento Escaso.** El morado ocupa ≤10% de píxeles de cualquier pantalla. Si en
una captura el morado se lee como "el color de la app", está mal aplicado: el color de la
app es la tinta.

**La Regla de Ningún Botón de Color.** Ningún botón de acción normal lleva fondo saturado.
Primario = tinta. Secundario = superficie con borde. Solo *eliminar* lleva rojo, y lo lleva
precisamente porque nada más lo lleva.

**La Regla del Blanco Prohibido.** Ni #000 ni #fff aparecen en este sistema. Todo neutro está
tintado al tono 338. Si un valor sale en gris puro, viene de código viejo.

## 3. Typography

**Familia única:** la del sistema — `ui-sans-serif, system-ui, -apple-system, "Segoe UI",
Roboto, "Helvetica Neue", Arial, sans-serif`.
**Mono (solo datos):** `ui-monospace, "Cascadia Mono", Consolas, monospace`.

**Carácter:** una sola voz, sin emparejamiento de display y body. Un producto de tarea no
necesita dos tipografías; necesita una bien afinada que sostenga títulos, etiquetas, tabla y
formulario sin llamar la atención. **No hay webfont y no debe haberlo**: esto corre en un
almacén y el texto no puede depender de la red para dibujarse.

La escala es **fija en rem, no fluida**. El usuario mira a DPI constante; un `clamp()` en un
título de herramienta solo produce tamaños que nadie eligió. Razón entre pasos ≈1.15–1.2:
apretada a propósito, porque aquí hay muchos más elementos de texto que en una página de
marca y el contraste exagerado se vuelve ruido.

### Hierarchy

- **Display** (600, 1.5rem, 1.2, tracking -0.014em): el `h1` de cada pantalla. Uno por página.
- **Headline** (600, 1.3125rem, 1.25): título de sección — "Lista seleccionada",
  "Inventario de equipos".
- **Title** (600, 1.125rem, 1.3): encabezado de modal.
- **Body** (400, 1rem, 1.55): texto general. En prosa, 65–75ch; la tabla y las listas de datos
  pueden correr más densas.
- **Label** (600, 0.75rem, tracking 0.07em, MAYÚSCULAS): rótulo de área, cabecera de tabla,
  badge de estado. Es el elemento que más carácter de documento aporta.
- **Cifra** (500, 1rem, `font-variant-numeric: tabular-nums lining-nums`): toda cantidad.

### Named Rules

**La Regla de la Cifra Tabular.** Cualquier número que se lea en columna o que cambie en su
sitio —existencias, cantidad pedida, cantidad impresa— usa `tabular-nums`. Sin esto las
columnas bailan al actualizarse y el usuario deja de confiar en lo que lee.

**La Regla de los 16 Píxeles.** Todo `input` es `font-size: 16px` como mínimo. Por debajo,
iOS hace zoom automático al enfocar, y esto se usa desde el teléfono en el almacén.

**La Regla de la Sola Voz.** Una familia tipográfica. Añadir una segunda a esta interfaz
está prohibido; el peso y la escala ya llevan toda la jerarquía que hace falta.

## 4. Elevation

**Plano en reposo.** La profundidad la dan tono y filete, no sombra. Una fila de tabla se
distingue de su cabecera porque la cabecera es papel hundido y hay una línea entre ellas, no
porque la fila esté "levantada". Las secciones se separan con un filete de 1px y espacio.
Esto es deliberado: la sombra difusa bajo cada bloque es exactamente lo que hace que un
panel de administración parezca una plantilla de 2015.

La sombra queda para lo que de verdad flota sobre el contenido: el modal, la barra de acción
fija, y la hoja imprimible (que representa un papel físico sobre un escritorio).

### Shadow Vocabulary

- **Fija** (`0 -1px 0 var(--filete), 0 -8px 24px oklch(20.5% 0.021 338 / .05)`): la barra de
  acción pegada al borde inferior en móvil. El filete hace el trabajo; la sombra solo evita
  que el contenido parezca cortado.
- **Hoja** (`0 1px 2px oklch(20.5% 0.021 338 / .04), 0 8px 24px oklch(20.5% 0.021 338 / .05)`):
  el formato de Orden del día en pantalla. Desaparece por completo en `@media print`.
- **Modal** (`0 16px 48px oklch(20.5% 0.021 338 / .22)`): el único diálogo. Sombra franca,
  porque tapar el fondo es su función.

### Named Rules

**La Regla de Nada Flota.** Contenedores, secciones, filas y tarjetas van sin sombra. Si un
elemento necesita sombra para leerse como grupo, el problema es que le falta filete o espacio.
Prueba de auditoría en una frase: si al quitar todas las sombras la jerarquía sigue clara,
las sombras sobraban — y en esta interfaz sobran en todas partes menos en tres.

## 5. Components

### Buttons

- **Forma:** ligeramente redondeado (5px). Altura mínima 44px en todos, sin excepción.
- **Primario:** fondo tinta de imprenta, texto superficie, `0.5rem 1rem`. Uno por pantalla:
  "Agregar item" en Inventario, "Imprimir" en Orden del día, la barra de "Ver orden" en la
  Principal.
- **Secundario:** fondo superficie, texto tinta, borde interior de 1px en filete fuerte
  (`box-shadow: inset 0 0 0 1px`, no `border`, para que no desplace el layout al aparecer).
- **Fantasma:** sin fondo, texto tinta suave. Navegación y "Cancelar".
- **Peligro:** fondo rojo de corrección, texto superficie. Exclusivo de eliminar.
- **Hover / Focus:** el hover cambia solo el fondo, 180ms `cubic-bezier(0.25, 1, 0.5, 1)`.
  El foco es un anillo de 2px en morado Ok con 2px de offset, idéntico en todos los botones.
- **Icono solo:** cuadrado de 44×44 con SVG de 20px trazo 2px, `aria-label` obligatorio.

### Cards / Containers

No hay tarjetas. Las secciones se delimitan con un filete superior o inferior de 1px y
espacio vertical de la escala. El único contenedor con superficie propia y radio es la
**hoja** de Orden del día (8px, sombra Hoja) y el **modal** (8px, sombra Modal). Las tarjetas
anidadas están prohibidas y no existe ningún caso que las necesite.

### Inputs / Fields

- **Estilo:** borde de 1px en borde de control (no en filete: el filete no llega a 3:1),
  radio 5px, fondo superficie, altura 44px, `font-size: 16px`.
- **Etiqueta:** siempre visible o `visualmente-oculto` con `for`; nunca solo placeholder.
- **Foco:** el borde pasa a morado Ok y se añade un anillo de 3px al 30%. `outline: none`
  solo cuando hay sustituto visible, nunca a secas.
- **Error:** borde rojo de corrección más texto bajo el campo. El color nunca va solo.

### Navigation

Una barra superior compartida por las tres pantallas: marca a la izquierda, enlaces a la
derecha. Fondo superficie, filete inferior de 1px, sin sombra. El enlace de la pantalla
actual va en tinta de imprenta con peso 600 y una regla de 2px en morado bajo el texto; los
demás en tinta tenue con peso 500. En móvil los enlaces se envuelven, no se colapsan en un
menú: son dos, y esconderlos detrás de una hamburguesa costaría un toque de más.

### Tabla de inventario

El componente denso del sistema, pensado para monitor.

- Cabecera en papel hundido con tipografía de Label. **No es sticky, y no debe
  serlo**: el `overflow-x: auto` del contenedor lo vuelve scrollport en los dos
  ejes, así que `position: sticky` empuja la cabecera hacia abajo sobre la
  primera fila en vez de fijarla.
- Filas separadas por filete de 1px. **Sin rayado alterno**: el zebra es de Bootstrap y con
  filetes no hace falta.
- Hover de fila en papel hundido.
- Columna de cantidad alineada a la derecha con cifra tabular.
- Fila inactiva: fondo papel hundido, nombre tachado, texto en tinta suave. No se usa
  `opacity` para atenuar — bajar opacidad rompe el contraste medido.
- En móvil se ocultan por CSS ID, Marca, Descripción y Área; el dato sigue completo en el
  modal de detalle.

### Contador de fila (componente firma)

El control con el que se arma la orden: `−  [n]  +` en la propia fila del producto,
44×44 por paso, con el número como `input` escribible en cifra tabular para que pedir 25
no cuesten 25 pulsaciones. Segmentado con un borde interior de 1px; las esquinas se
redondean por extremo y **nunca** con `overflow: hidden`, que recortaría el anillo de foco.

Sustituye a un modal que solo servía para capturar un número. La regla que lo justifica:
un diálogo que pide un solo dato y no confirma nada irreversible es un paso de más.
Cuando el contador está por encima de cero, la fila entera pasa a lavado de morado con
filete de morado: el estado se ve donde está el producto, sin bajar a la lista.

El repintado es **parcial y obligatoriamente parcial**: cada `+` parchea su fila en vez de
reconstruir la lista. Reconstruirla mandaría el foco del teclado a `<body>` en cada
pulsación.

### Línea de producto imprimible (componente firma)

La línea de la Orden del día: nombre a la izquierda, cantidad a la derecha, y entre ambos un
`<span>` vacío que crece con `flex: 1` y lleva `border-bottom: 1px dotted`. La línea de
puntos que guía el ojo del nombre a la cantidad en el papel es **100% CSS**. Es el
componente más importante del sistema porque es el que se imprime.

## 6. Do's and Don'ts

### Do:

- **Do** usar tinta de imprenta (`oklch(20.5% 0.021 338)`) como fondo del botón primario, y
  morado Ok solo en regla de sección, estado seleccionado, foco y enlaces.
- **Do** separar secciones con un filete de 1px y espacio de la escala.
- **Do** poner `font-variant-numeric: tabular-nums` en toda cantidad.
- **Do** mantener 44×44 px de objetivo táctil y `font-size: 16px` en inputs.
- **Do** acompañar todo color semántico con texto: "Activo", "Inactivo", "Faltan 3".
- **Do** dejar la escala tipográfica fija en rem.
- **Do** conservar intacto el bloque `@media print` de la Orden del día: es contrato
  funcional, no decoración.

### Don't:

- **Don't** construir un **dashboard de tarjetas y cifrones**: nada de cuadrículas de
  tarjetas idénticas, números gigantes con etiqueta chica, ni acentos en degradado.
- **Don't** volver al **panel de admin genérico tipo Bootstrap**: nada de botones
  azul/verde/rojo saturados en la misma fila, tabla rayada, ni badges de colores por todas
  partes.
- **Don't** derivar hacia una **app de consumo llamativa**: nada de ilustraciones, esquinas
  por encima de 8px, ni animación decorativa.
- **Don't** usar `border-left` o `border-right` de más de 1px como franja de color en
  tarjetas, filas o avisos. Nunca es intencional; se resuelve con fondo lavado o con rótulo.
- **Don't** usar `background-clip: text` con degradado. Jamás.
- **Don't** poner sombra a un contenedor, sección o fila. Solo modal, barra fija y hoja.
- **Don't** usar #000 ni #fff.
- **Don't** atenuar con `opacity` lo que debe seguir siendo legible; usar un token de texto
  medido.
- **Don't** animar `width`, `height`, `top` ni `left`; solo `transform`, `opacity` y color.
- **Don't** añadir una segunda familia tipográfica ni cargar un webfont.
- **Don't** abrir un modal para capturar un solo dato. Se resuelve en línea, en la fila.
- **Don't** dejar los colores solo en OKLCH: el bloque `@supports not (color: oklch(...))`
  de `base.css` los repite en hex. Sin él, un WebView viejo del almacén perdería la paleta
  entera de golpe.
