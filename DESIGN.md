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
  tinta-panel: "oklch(21.5% 0.023 338)"
  tinta-panel-alta: "oklch(27% 0.025 338)"
  filete-tinta: "oklch(34% 0.025 338)"
  borde-control-tinta: "oklch(52% 0.02 338)"
  sobre-tinta: "oklch(97% 0.005 338)"
  sobre-tinta-suave: "oklch(82% 0.012 338)"
  sobre-tinta-tenue: "oklch(69% 0.015 338)"
  marca-clara: "oklch(76% 0.145 338)"
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
  sm: "4px"
  md: "7px"
  lg: "12px"
  xl: "16px"
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
hacia el morado de la marca; el texto es un casi-negro de la misma familia. Las cantidades
van en cifras tabulares alineadas a la derecha, porque en un inventario el número es el
contenido y no un adorno del contenido.

**Y la tinta no es sólo el color del texto: también es una superficie.** La barra superior de
las cuatro pantallas de la aplicación y la columna de marca del acceso van en tinta, y son
literalmente la misma superficie (`--tinta-panel`). Es la mitad que faltaba de la metáfora:
si el contenido es papel, la herramienta que lo sostiene es el escritorio sobre el que se
apoya. Antes la barra iba en superficie clara y el resultado era honesto pero inerte — dos
blancos casi idénticos separados por una raya de 1px, sin decir cuál era mueble y cuál
documento. En tinta se distingue de un vistazo, y el morado de marca por fin tiene un fondo
donde destacar en vez de competir.

Eso tiene una consecuencia que se ve al entrar: quien abre el login ve la tinta a la
izquierda; al pasar, esa misma tinta se queda arriba. El acceso y la aplicación se leen como
un solo producto.

La estructura del CONTENIDO la siguen llevando **filetes de 1px y espacio en blanco**. Lo que
cambió es que un contenedor con superficie propia ya puede apoyarse en el papel con una
sombra de nivel 2: iba plano y se leía como un rectángulo dibujado encima, porque papel y
superficie se diferencian en 1.4% de luminosidad y el filete solo no llegaba. Filas, celdas y
secciones siguen planas.

El morado #ae3592 del logo sigue vivo, pero deja de ser el color de los botones. La acción
primaria va en tinta —el movimiento de Stripe y Notion— y el morado queda reservado para
identidad, para la regla que abre cada sección de área, para el estado seleccionado y para
el anillo de foco. Un acento que aparece poco se lee como decisión; uno que aparece en todo
se lee como plantilla. Este sistema rechaza explícitamente sus tres anti-referencias:
el **dashboard de tarjetas y cifrones**, el **panel de admin genérico tipo Bootstrap** del
que este proyecto viene, y la **app de consumo llamativa**.

**Key Characteristics:**

- Documento antes que tablero: el contenido lo estructuran filetes y espacio, no tarjetas.
- Tinta como color de acción **y como superficie**: el mueble es oscuro, el documento claro.
- Morado como marca, estado y foco, nunca como relleno de botón.
- Cifras tabulares en toda cantidad, existencia o total.
- Densidad elegida por contexto: Inventario denso para monitor, Principal holgada para pulgar.
- Elevación en escala de cuatro pasos, todas de dos capas, y se gana: sólo la tienen los
  objetos que descansan o flotan, nunca una fila ni una sección.
- Radios anidados: cuanto mayor la caja, mayor su radio, para que las curvas se vean
  concéntricas.
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
  fondo de control secundario y la columna de marca del acceso. En los cuatro casos hace el
  mismo trabajo: separar lo que se lee de lo que se opera, por tono y no por sombra.
- **Filete** (`oklch(91.2% 0.006 338)` → #e5e0e3) y **Filete Fuerte**
  (`oklch(84.5% 0.009 338)` → #d0cace): los divisores de 1px que llevan toda la estructura.
- **Borde de Control** (`oklch(64.5% 0.013 338)` → #938b90): el borde de inputs y selects.
  Es notablemente más oscuro que un filete a propósito: WCAG 1.4.11 exige 3:1 en el borde que
  es la única señal de que algo es un campo. Mide 3.28:1 sobre superficie.
- **Tinta Suave** (`oklch(47.5% 0.017 338)` → #635960) y **Tinta Tenue**
  (`oklch(52.8% 0.016 338)` → #72686e): texto secundario y terciario. La tenue está calculada
  al filo: 4.80:1 sobre papel hundido, que es su fondo más oscuro. No aclararla.

### Sobre tinta

Siete tokens que sólo existen dentro de una superficie oscura: la barra superior y la columna
de marca del acceso. **Ninguno de los colores de papel vale ahí** —están medidos contra papel
y sobre tinta se caen—, así que esto no es una paleta alternativa: es la misma medida repetida
contra el otro fondo. Los contrastes de abajo están medidos contra `--tinta-panel`.

- **Panel de Tinta** (`oklch(21.5% 0.023 338)` → #21151d): la superficie. Un pelo más clara
  que Tinta de Imprenta a propósito — el texto y el botón primario invertido necesitan un
  fondo que no sea su mismo valor.
- **Panel Alto** (`oklch(27% 0.025 338)` → #2f222b): el hover de lo que se pulsa ahí dentro.
- **Filete de Tinta** (`oklch(34% 0.025 338)` → #41333c): el divisor. 1.48:1 — es decorativo
  y no pretende otra cosa.
- **Borde de Control sobre Tinta** (`oklch(52% 0.02 338)` → #71656d): el borde del botón
  "Salir", el único control con borde que vive sobre tinta. 3.18:1, porque WCAG 1.4.11 pide
  3:1 en el borde que es la única señal de que algo se pulsa. Va aparte del filete por
  exactamente la misma razón que `--borde-control` en el papel.
- **Sobre Tinta** (16.16:1), **Suave** (10.06:1) y **Tenue** (6.33:1): la escala de texto.
- **Morado Claro** (`oklch(76% 0.145 338)` → #eb8bd1): el morado de marca **no sirve sobre
  tinta** — mide 2.4:1 y desaparece. Éste es el mismo tono subido de luminosidad hasta
  7.69:1, y hace los mismos trabajos que su hermano oscuro: la regla de sección, el subrayado
  de la pantalla actual y el anillo de foco.

### Named Rules

**La Regla del Contexto que se Declara.** Un componente que puede vivir sobre papel Y sobre
tinta no lleva sus colores escritos dentro: los lee de variables que la superficie redefine.
Hoy son cuatro — `--color-foco` y los tres `--btn-primario-*`. El coste de saltársela ya se
pagó una vez: al pasar la barra a tinta, "Imprimir y descontar" —un `.btn--primario`, es
decir, fondo de tinta— se volvió **invisible** sobre el fondo de tinta de la barra. El botón
seguía ahí; sólo se leía su rótulo. Con tokens, la barra declara su inversión una vez y
cualquier primario que caiga dentro se ajusta solo.

Corolario, también aprendido a golpes: quien saque un elemento de una superficie oscura
**visualmente** sin sacarlo del DOM tiene que devolver los tokens a mano. Es lo que hace
`.btn-imprimir` por debajo de 1060px, cuando se va al pulgar con `position: fixed` pero sigue
siendo hijo de la barra.

**La Regla del Acento Escaso.** El morado ocupa ≤10% de píxeles de cualquier pantalla. Si en
una captura el morado se lee como "el color de la app", está mal aplicado: el color de la
app es la tinta.

**La Regla de Ningún Botón de Color.** Ningún botón de acción normal lleva fondo saturado.
Primario = tinta. Secundario = superficie con borde. Solo *eliminar* lleva rojo, y lo lleva
precisamente porque nada más lo lleva.

**La Regla del Blanco Prohibido.** Ni #000 ni #fff aparecen en este sistema. Todo neutro está
tintado al tono 338. Si un valor sale en gris puro, viene de código viejo.

### Radios anidados

La escala es una **progresión**, no un valor único: `sm 4` (badge, chip) → `md 7` (botón,
campo, control) → `lg 12` (contenedor con superficie) → `xl 16` (hoja, modal, panel de
acceso). Un control de 7px dentro de una hoja de 16px se ve concéntrico; los dos al mismo
valor hacen que la hoja parezca una caja con las esquinas limadas.

El sistema tenía antes un techo de 8px "para no parecer una app de consumo". El techo estaba
mal puesto: lo que abarata una interfaz es el radio grande en el CONTROL, no en la superficie
que lo contiene. Un botón de 16px parece un juguete; una hoja de 16px con botones de 7px
dentro parece material.

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

**La elevación se gana, no se reparte.** Filas, celdas y secciones van planas: las separa el
filete y el tono, no la sombra. Una fila de tabla se distingue de su cabecera porque la
cabecera es papel hundido y hay una línea entre ellas, no porque esté "levantada". La sombra
difusa bajo CADA bloque es exactamente lo que hace que un panel de administración parezca una
plantilla de 2015, y eso no ha cambiado.

Lo que cambió: **un contenedor con superficie propia sí llega al nivel 2.** Antes iba
completamente plano, y el resultado no era sobriedad: era un rectángulo dibujado encima del
papel. Papel (98.2% L) y superficie (99.6% L) se diferencian en 1.4%, y un filete de 1px no
basta para que eso se lea como un objeto. El nivel 2 no lo hace flotar; lo apoya.

**Todas las sombras son de dos capas**, y ésa es la diferencia entre material y mancha: una
capa de contacto corta y opaca que ancla el objeto al plano, más una difusa y larga que le da
el aire. Con una sola capa siempre se acaba viendo el rectángulo gris debajo.

### Shadow Vocabulary

Una escala numerada de cuatro pasos. El CSS de las pantallas usa los ALIAS con nombre y no los
números: nombran la intención ("esto es una hoja"), no una medida.

| Nivel | Para qué | Quién lo usa |
|---|---|---|
| `--sombra-1` | El roce mínimo. Reservado. | — |
| `--sombra-2` | Lo que **descansa** sobre el papel. | Barra superior, contenedor de tabla, panel de Selección |
| `--sombra-3` = **Hoja** | Un papel suelto sobre el escritorio. | Formato de Orden del día, hoja de acceso |
| `--sombra-4` = **Modal** | Lo que **flota** y tapa. | Los cuatro diálogos, el botón fijo al pulgar |

Más **Fija** (`0 -1px 0 var(--filete)` y una difusa hacia arriba), que es su propio caso: la
barra de acción pegada al borde inferior en móvil. Ahí el filete hace el trabajo y la sombra
sólo evita que el contenido parezca cortado.

La sombra Hoja desaparece por completo en `@media print`, igual que el radio y el borde: un
papel real no tiene las esquinas redondeadas.

### Named Rules

**La Regla de la Elevación Ganada.** Secciones, filas y celdas van sin sombra, siempre. Un
contenedor con superficie propia puede llegar al nivel 2, y a ninguno más. Si un elemento
necesita sombra para leerse como GRUPO, lo que le falta es filete o espacio: la sombra dice
que algo está en otro plano, no que unas cosas van juntas.

Prueba de auditoría en una frase: cuenta las sombras de una pantalla. Si pasan de tres,
alguna está agrupando en vez de elevar.

**La Regla de las Dos Capas.** Ninguna sombra del sistema es de una sola capa. Una sombra
suelta y difusa se ve como una mancha gris debajo de la caja; lo que la convierte en material
es la capa de contacto de 1–8px que la ancla al plano.

## 5. Motion

**Todo movimiento informa de un cambio de estado. Ninguno entretiene.** Cuatro duraciones y
una sola curva —`cubic-bezier(.25, 1, .5, 1)`, un ease-out-quart— para que todo el sistema
tenga el mismo ritmo. Sin rebote ni elástico: esto es una herramienta de trabajo.

| Token | Valor | Para qué |
|---|---|---|
| `--dur-pulsado` | 80ms | El hundido de un botón bajo el dedo |
| `--dur-rapida` | 120ms | Cambios pequeños de color |
| `--dur-media` | 180ms | Hover, foco, transiciones de estado |
| `--dur-lenta` | 260ms | Entrada de modal y diálogo |

**El hundido al pulsar** (`transform: scale(.97)` en `:active`) es la única respuesta táctil
del sistema y está en la primitiva `.btn`, así que la heredan los botones de las cinco
pantallas. Va en `transform` y no en `padding` ni en `top` a propósito: escala sobre su
propio centro y no mueve nada de alrededor, de modo que una fila de botones no tiembla cuando
se pulsa uno. El `.97` está medido sobre el objetivo táctil de 44px — por debajo se percibe
como un salto, por encima no se percibe.

Los 80ms no son un número redondo elegido al azar: por encima de ~100ms la respuesta deja de
sentirse causada por el dedo y empieza a sentirse como una animación que le sigue.

### Named Rules

**La Regla del Estado que Sobrevive.** El bloque `prefers-reduced-motion` de `base.css` anula
todas las duraciones, y eso NO desactiva el hundido: lo que anula es el tiempo que tarda, no
el estado en sí. Quien pide menos movimiento sigue necesitando saber que su pulsación llegó.
Al escribir una interacción nueva, separa siempre las dos cosas — el estado se queda, la
transición se va.

**La Regla de la Animación que se Gana.** Sólo hay dos animaciones con `@keyframes` en todo
el proyecto, y las dos son la entrada de un modal. Cualquier tercera tiene que justificar qué
cambio de estado está explicando.

## 6. Components

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

No hay tarjetas, y una sección nunca es una caja. Las secciones se delimitan con un filete
superior o inferior de 1px y espacio vertical de la escala. Las tarjetas anidadas están
prohibidas y no existe ningún caso que las necesite.

Los contenedores con superficie propia son cinco, y cada uno con su nivel:

| Contenedor | Radio | Sombra |
|---|---|---|
| Contenedor de tabla (Inventario, Cuentas) | 12px | nivel 2 |
| Panel de Selección (Principal, escritorio) | 12px | nivel 2 |
| Hoja de Orden del día | 16px | Hoja |
| Hoja de acceso | 16px | Hoja |
| Modal / diálogo | 16px | Modal |

"Recibir devolución", en Inventario, es el caso de prueba de esta regla: es una sección con
su propio título, formulario, panel de resultado y aviso, y aun así **no lleva caja**. Se
delimita con un filete inferior y espacio, como todo lo demás. Un bloque así es exactamente
donde la tentación de la tarjeta aparece; ceder ahí es empezar el dashboard. Y va en UNA
sola fila —rótulo y ayuda a la izquierda, campo y botón a la derecha—, no apilada: el
trabajo principal de esa pantalla es el catálogo, y apilada se llevaba el tercio superior de
la ventana antes de que se viera un producto.

**La hoja de acceso es la excepción con nombre.** El login es la única pantalla que se sirve
sin sesión y la única que no tiene nada alrededor contra lo que apoyarse: un filete de 1px
sobre papel casi del mismo tono no llega a leerse como objeto cuando es lo ÚNICO que hay en
la ventana. Por eso lleva sombra Hoja —la del papel impreso, no la de modal— y por eso la
lleva **una sola caja**: la hoja entera, con sus dos columnas dentro. Partirla en dos
tarjetas, una de marca y otra de formulario, añadiría una segunda superficie flotante y
convertiría la excepción en costumbre.

Dentro, la columna de marca va **en tinta** — la misma superficie que la barra superior de
las otras cuatro pantallas — y la del formulario en papel. No hace falta filete entre ellas:
las separa el salto de superficie. Las tres líneas de uso las abre un rótulo con la regla de
morado CLARO debajo (el de papel no se vería sobre tinta), el mismo gesto que `.titulo-area`
en la Principal, no uno nuevo. Se probó una franja vertical de 2px a la izquierda de la lista
y se descartó por el Don't del `border-left` de color: la salida que ese Don't propone es
precisamente el rótulo. En el teléfono el rótulo, las tres líneas y la nota de la bitácora no
se sirven — empujarían el formulario, que es a lo que se viene, por debajo del pliegue.

**Las dos cajas de nivel 2, y por qué ya no van planas.** El panel de Selección (Principal,
sólo en escritorio) y el contenedor de la tabla (Inventario y Cuentas) llevan superficie,
radio de 12px, filete de 1px y sombra de nivel 2. Iban completamente planos, y ahí el sistema
se equivocaba en la dirección contraria a la habitual: papel y superficie se diferencian en
1.4% de luminosidad, así que sin sombra esas cajas no se leían como objetos apoyados sino
como rectángulos dibujados sobre el papel. El nivel 2 no las hace flotar.

Hubo una tercera, la tarjeta de rol de Cuentas, y se fue con la rejilla de roles que la
pantalla ya no tiene. Llevaba sombra Hoja, que es dos niveles por encima de lo que le tocaba:
una tarjeta dentro de una rejilla no es un papel suelto sobre el escritorio.

### Diálogo de confirmación

La primitiva `.dialogo` vive en `base.css`, no en la hoja de una pantalla, porque la
comparten **las dos acciones irreversibles que escriben stock**: emitir la orden (descuenta)
y recibir la devolución (repone).

Es `<dialog>` nativo y **no** el `.modal` de Inventario, que se abre conmutando
`style.display`. Dos razones, y las dos son funcionales: el nativo da backdrop, Escape y
trampa de foco sin JS, y no toca `display`, que es justo lo que pelearía con el
`[hidden] { display: none !important }` del que depende `orden.js`.

Regla de contenido, no de forma: **cuando la acción se aplica a un registro concreto, el
diálogo muestra cuál.** El de la devolución enumera número, fecha, evento, responsable y
líneas — no "¿devolver la orden 21?". Confirmar la acción correcta sobre el registro
equivocado es el error que ningún diálogo genérico atrapa.

### Inputs / Fields

- **Estilo:** borde de 1px en borde de control (no en filete: el filete no llega a 3:1),
  radio 5px, fondo superficie, altura 44px, `font-size: 16px`.
- **Etiqueta:** siempre visible o `visualmente-oculto` con `for`; nunca solo placeholder.
- **Foco:** el borde pasa a morado Ok y se añade un anillo de 3px al 30%. `outline: none`
  solo cuando hay sustituto visible, nunca a secas.
- **Error:** borde rojo de corrección más texto bajo el campo. El color nunca va solo, y el
  foco se lleva al campo que hay que corregir: sin eso, tras un fallo el foco se queda en el
  botón de enviar y quien navega con teclado tiene que volver a subir a ciegas.
- **Ver / ocultar contraseña:** botón de icono de 44px DENTRO de la caja del campo, con el
  padding derecho del input reservándole el hueco. Va dentro y no en la fila de la etiqueta
  porque ahí los 44px de objetivo táctil harían la fila tan alta como el propio campo.
  Alterna `type` en su sitio —dos `<input>` distintos le enseñarían al gestor de contraseñas
  dos credenciales en la misma página—, lleva `aria-pressed`, cambia su `aria-label`, y
  cuando está pulsado se pinta en morado: la contraseña a la vista es un estado, y el estado
  es uno de los cuatro trabajos del morado.

### Navigation

Una barra superior compartida por las cuatro pantallas: marca a la izquierda, enlaces a la
derecha. **Va en tinta** (`--tinta-panel`), con sombra de nivel 2 y sin filete inferior — la
sombra ya la separa del papel. El enlace de la pantalla actual va en `--sobre-tinta` con peso
600 y una regla de 2px en **morado claro** bajo el texto; los demás en `--sobre-tinta-tenue`
con peso 500, y su hover pasa a Panel Alto.

**El porqué de la tinta.** Esta barra no es contenido, es el mueble donde se apoya el
contenido. En superficie clara competía con el papel que tiene debajo —dos blancos casi
iguales separados por una raya de 1px— y no se leía como otra capa. Es además la MISMA
superficie que la columna de marca del acceso, y eso hace que el login y la aplicación se
lean como un solo producto: la tinta que estaba a la izquierda al entrar se queda arriba al
pasar.

Tres cosas que arrastra ese cambio, y que hay que respetar al editarla:

- **El primario se invierte dentro** (papel sobre tinta), vía los tokens `--btn-primario-*`.
  Ver "La Regla del Contexto que se Declara".
- **El anillo de foco pasa a morado claro** (`--color-foco`), porque el de papel mide 2.4:1
  sobre tinta y WCAG 1.4.11 pide 3:1 en un indicador de foco.
- **El alto no cambia.** `--alto-barra` son 60px, y el `thead` pegajoso de Inventario y el
  panel de Selección de la Principal se paran justo debajo de ese número.

`@media print` la oculta entera, así que la tinta nunca llega al papel ni gasta un cartucho.

**En móvil el nav baja a una fila propia, y sigue sin colapsarse en un menú.** La regla
original decía "son dos, y esconderlos detrás de una hamburguesa costaría un toque de más".
Ya son cuatro —"Cuentas" lo inyecta `sesion.js` cuando la cuenta tiene el permiso— y
envolviéndose caían en tres filas: 155px de barra pegados arriba en un teléfono de 390px,
antes de ver un solo producto. La segunda mitad de la regla sigue en pie, así que no se
esconde ninguno: por debajo de 640px el `<nav>` ocupa el ancho entero en una fila bajo la
marca, repartido con `space-between`. Dos filas, ~112px, los cuatro destinos a la vista.
Los 44px de objetivo táctil no se tocan; lo que se recorta es el padding lateral.

### El paso del ciclo (Principal)

Bajo la cabecera de la Principal va una línea de tres pasos —elegir, imprimir (descuenta),
recibir (repone)— en tipografía de Label, con el número del paso actual en lavado de morado.
Las tres pantallas son un mismo recorrido y nada lo decía: cada una se presentaba como una
herramienta suelta y había que deducir que la de al lado era el paso siguiente.

**No es un asistente por pasos.** No se completa, no guarda progreso y no bloquea nada:
sólo dice dónde estás y qué viene después. Por eso va en tipografía de etiqueta y sin
iconos ni colores de estado — si se pareciera a una barra de progreso, prometería algo que
no hace.

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
- **Cabecera ordenable en dos columnas**: Nombre (para encontrar algo) y Cantidad (para ver
  qué se está acabando). Es un `<button>` dentro del `<th>`, no un manejador en la celda, así
  que se llega con el tabulador; `aria-sort` va en el `<th>`, y la columna activa es el único
  morado de la tabla. Arranca por nombre ascendente y no por lo que devuelva Postgres, que es
  el orden físico de las filas: con dos productos llamados "BT3" salían separados por media
  tabla.
- **Un filete entre las tres acciones reversibles y la que no lo es.** Cuatro botones del
  mismo tamaño, el mismo color y pegados, y el cuarto borra un producto del catálogo. El
  filete desaparece con el botón cuando la cuenta no tiene `productos.eliminar`.
- **En móvil la fila conserva UN solo botón: el del detalle.** A 390px los cuatro objetivos
  de 44px se llevaban 176 del ancho útil y el nombre —lo único por lo que se reconoce una
  fila— se partía en tres líneas. Las otras tres acciones viven en el modal de detalle, que
  ya era la ventana que traía los datos que el móvil oculta. **Ese modal no puede volver a
  quedarse sólo con "Cerrar"**: sería la única pantalla donde desde un teléfono no se puede
  editar nada.
- Encima de la tabla, una **línea de resumen** (`.resumen-linea`, en `base.css`): cuántos
  productos, cuántos activos, cuántas unidades. Es una frase, no una rejilla de tarjetas con
  cifrones — ese tablero es la primera anti-referencia del sistema. La comparte la pantalla
  de Cuentas.

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

**El nombre lleva la marca detrás** (`vim2 · Clay Paky`). En el catálogo hay dos productos
llamados "BT3" y dos llamados "Array": un papel que dice `BT3 ....... 4` no le sirve a quien
tiene que ir a buscarlo al almacén.

**Al pie de las áreas, el total de unidades**, alineado sobre la misma columna que las
cantidades y en cifra tabular. Quien recibe el material cuenta bultos contra el papel y
hasta ahora los sumaba a mano. Se recalcula en cada `−`/`+`: un total impreso que se quedara
con la suma anterior sería peor que no imprimir ninguno.

### Estado de la orden (sólo pantalla)

Sobre la hoja, una línea con el rótulo **BORRADOR** en morado, la frase "Todavía no se ha
descontado nada del inventario" y el recuento de áreas, productos y unidades. Lleva
`.no-imprimir`: es información de la aplicación, no del papel.

Existe porque el borrador y la orden ya descontada **se veían exactamente igual**: la única
diferencia era el recuadro verde, que sólo aparece después de descontar. Quien volvía a esa
pestaña no tenía forma de saber si el material ya había salido del almacén, y el botón decía
"Imprimir y descontar" en los dos casos. Al aplicarse la orden, esta línea se esconde: ahí
habla el recuadro verde, que dice algo distinto y más importante.

## 7. Do's and Don'ts

### Do:

- **Do** usar tinta de imprenta (`oklch(20.5% 0.021 338)`) como fondo del botón primario, y
  morado Ok solo en regla de sección, estado seleccionado, foco y enlaces.
- **Do** leer el color de un token cuando el componente pueda caer sobre papel o sobre tinta
  (`--color-foco`, `--btn-primario-*`), en vez de escribirlo dentro del componente.
- **Do** usar el morado CLARO sobre superficie oscura: el de papel mide 2.4:1 ahí.
- **Do** subir el radio con el tamaño de la caja: control 7px, contenedor 12px, hoja 16px.
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
- **Don't** derivar hacia una **app de consumo llamativa**: nada de ilustraciones, ni
  animación decorativa, ni radios de contenedor en un control — un botón de 16px parece un
  juguete. El techo por elemento lo fija la escala de radios anidados, no un número único.
- **Don't** usar `border-left` o `border-right` de más de 1px como franja de color en
  tarjetas, filas o avisos. Nunca es intencional; se resuelve con fondo lavado o con rótulo.
- **Don't** usar `background-clip: text` con degradado. Jamás.
- **Don't** poner sombra a una sección, fila o celda. Un contenedor con superficie propia
  llega al nivel 2 y a ninguno más; el resto de la escala es para lo que descansa o flota.
- **Don't** escribir una sombra de una sola capa. Todas las del sistema son de dos.
- **Don't** poner un color de papel sobre tinta ni al revés sin volver a medirlo: las dos
  escalas están calculadas contra su propio fondo y ninguna vale en el otro.
- **Don't** usar #000 ni #fff.
- **Don't** atenuar con `opacity` lo que debe seguir siendo legible; usar un token de texto
  medido.
- **Don't** animar `width`, `height`, `top` ni `left`; solo `transform`, `opacity` y color.
- **Don't** añadir una segunda familia tipográfica ni cargar un webfont.
- **Don't** abrir un modal para capturar un solo dato. Se resuelve en línea, en la fila.
- **Don't** dejar los colores solo en OKLCH: el bloque `@supports not (color: oklch(...))`
  de `base.css` los repite en hex. Sin él, un WebView viejo del almacén perdería la paleta
  entera de golpe.
