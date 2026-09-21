# Plan de migración a Google Apps Script

Objetivo: reemplazar el flujo actual (subir PDFs a mano en una web Next.js →
descargar `.xlsx`) por una app de Apps Script con interfaz HTML donde **el único
input es el enlace de la carpeta de Drive de la OC**, y el resultado es una
**Hoja de Cálculo de Google guardada en esa misma carpeta**.

Este documento es la referencia de implementación. El código actual
(`src/lib/*.ts`) es la fuente de verdad de la lógica: se porta, no se reinventa.

---

## 1. Flujo final

```
[1] Pegar enlace de la carpeta OC          →  apiListarCarpeta()
[2] Revisar la lista de documentos          →  filtro por nombre (SKIP/FORCE) ya aplicado
[3] Procesar                                →  apiProcesarDoc() × N, uno por llamada
[4] Generar costeo                          →  apiGenerarCosteo() → hoja creada y movida
                                               a la carpeta origen → link al usuario
```

La corrección de datos **ya no vive en la interfaz**: vive en la hoja generada.
Ver §5.

---

## 2. Hallazgo principal (reduce el esfuerzo estimado)

Toda la dependencia de ExcelJS en `src/lib/excel.ts` (624 líneas) está
embudada en **cuatro puntos**:

| Punto | Ubicación | Reemplazo en Apps Script |
|---|---|---|
| `put(ws, coord, opts)` | `excel.ts:157-175` | mismo `put()` contra un escritor bufferizado |
| `ws.mergeCells(a1)` | 8 usos | `sheet.getRange(a1).merge()` |
| `ws.getColumn(c).width` | 6 usos | `sheet.setColumnWidth(i, px)` — ojo: px, no caracteres |
| `ws.views = [{showGridLines:false}]` | 2 usos | `sheet.setHiddenGridlines(true)` |

Consecuencia: **`hojaExtraccion()` (`excel.ts:195-347`) y `hojaCosteo()`
(`excel.ts:352-579`) se portan casi textuales** — se les quitan los tipos de
TypeScript y nada más. No es una reescritura de 600 líneas; son ~80 líneas de
infraestructura nueva (el escritor) y ~450 líneas de layout que se conservan.

---

## 3. Estructura del proyecto

Apps Script tiene espacio de nombres plano (todos los `.gs` comparten el scope
global, sin `import`). Archivos propuestos, bajo `apps-script/` en este repo:

| Archivo | Origen | Contenido |
|---|---|---|
| `appsscript.json` | — | manifest: scopes, V8, config del web app |
| `Config.gs` | `src/lib/config.ts` | `GEMINI_MODELO`, `PAUSA_MS`, `SKIP_NOMBRES`, `FORCE_INCLUDE`, `EMPRESA`, paleta |
| `Prompt.gs` | `src/lib/prompt.ts` | `promptMaestro()` — textual |
| `Parse.gs` | `src/lib/parse.ts` | `limpiarJSON`, `parsearRespuestaMaestra`, `deduplicarGastos` — textual |
| `Consolidar.gs` | `src/lib/consolidar.ts` | `clasificarPorNombre`, `consolidar`, `gastosDesdeDua` — textual |
| `Gemini.gs` | `src/lib/gemini-client.ts` | `fetch` → `UrlFetchApp` (§6) |
| `Drive.gs` | nuevo | `extraerFolderId`, listar carpeta, leer blob, mover archivo |
| `Hoja.gs` | `src/lib/excel.ts` | escritor bufferizado + `hojaExtraccion` + `hojaCosteo` (§7) |
| `Api.gs` | `src/app/page.tsx` | `doGet` + funciones expuestas a `google.script.run` |
| `Index.html` / `Estilos.html` / `Cliente.html` | componentes React | UI y orquestación cliente (§4) |
| `TestData.gs` | `scripts/test-excel.ts` | dataset OC 579-2025 para la verificación (§9) |

`src/lib/costeo.ts` solo se porta si se quiere un resumen en pantalla antes de
generar la hoja. En v1 **no hace falta**: el cálculo vive en las fórmulas de la
hoja. Dejarlo fuera.

### Manifest

```json
{
  "timeZone": "America/Lima",
  "runtimeVersion": "V8",
  "oauthScopes": [
    "https://www.googleapis.com/auth/drive",
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/script.external_request"
  ],
  "webapp": { "executeAs": "USER_ACCESSING", "access": "DOMAIN" }
}
```

`executeAs: USER_ACCESSING` es obligatorio para el modelo de la herramienta: cada
usuario lee las carpetas a las que **él** tiene acceso y usa **su** API Key.
El scope amplio de Drive es necesario porque la carpeta llega como enlace pegado
(no vía Picker), y hay que escribir en ella.

---

## 4. Contrato cliente ↔ servidor

Todas las funciones expuestas devuelven **un string JSON** y reciben objetos
complejos como string JSON. Motivo: el serializador de `google.script.run` no
transporta `undefined` ni tipos exóticos de forma confiable, y `parse.ts` /
`consolidar.ts` generan campos opcionales. Serializar a mano elimina esa clase
de bugs entera.

| Función | Entrada | Salida |
|---|---|---|
| `doGet(e)` | — | HTML del web app |
| `apiEstado()` | — | `{ tieneKey, keyMask, modelo }` |
| `apiGuardarKey(key)` | string | `{ ok, mask }` |
| `apiProbarKey()` | — | `{ ok, modelo, respuesta }` / `{ ok:false, error }` |
| `apiListarCarpeta(url)` | enlace o ID | `{ folderId, folderNombre, archivos:[{id,nombre,tamanoKB,mimeType,motivo,incluido}] }` |
| `apiProcesarDoc(fileId, nombre)` | ids | `{ ok, tipo, resultado, raw }` / `{ ok:false, error }` |
| `apiGenerarCosteo(resultadosJSON, folderId, nombreOC)` | JSON | `{ id, url, nombre }` |

### Estado y bucle del cliente

El estado vive **en el navegador**, igual que hoy en React (`page.tsx:26-34`):
`{ folderId, folderNombre, archivos[], resultados{}, cancelado }`. El servidor es
sin estado. Esto evita `CacheService`/`PropertiesService` para datos de trabajo y
mantiene la arquitectura actual.

El bucle es la traducción directa de `page.tsx:66-123`:

```js
function procesarSiguiente(i) {
  if (cancelado || i >= pendientes.length) return finalizar();
  google.script.run
    .withSuccessHandler(function (json) { guardar(json); esperarYSeguir(i + 1); })
    .withFailureHandler(function (err) { marcarError(err); esperarYSeguir(i + 1); })
    .apiProcesarDoc(pendientes[i].id, pendientes[i].nombre);
}
```

- **Un documento = una llamada = una ejecución.** Así ninguna ejecución se acerca
  al límite de 6 minutos de Apps Script (§8.1).
- La **pausa anti-429** (`PAUSA_MS = 2500`) es un `setTimeout` del cliente, no un
  `Utilities.sleep` del servidor: no consume tiempo de ejecución.
- **Cancelar** = bandera que corta la cadena, igual que `cancelRef` hoy.

---

## 5. Dónde se corrigen los datos (decisión de diseño)

Hoy existe un paso 3 en la UI (`ExtraccionEditor.tsx`) para corregir la
extracción antes de exportar. **En la versión Sheets ese paso desaparece de la
interfaz**: la hoja `EXTRACCION` ya es el editor, porque `COSTEO` está 100 %
formulada contra ella (`=EXTRACCION!...`). Se corrige en la hoja y COSTEO
recalcula solo — que es exactamente para lo que se diseñó el formato de dos
hojas.

Esto elimina el port de `ExtraccionEditor.tsx` y `CosteoView.tsx`, los dos
componentes más pesados después de `excel.ts`.

Dos consecuencias que hay que resolver **dentro de la hoja**:

**a) Conversión EUR → USD.** Hoy `adaptar()` (`excel.ts:72-120`) convierte el EXW
en tiempo de construcción con `tc_eur`. Si `tc_eur` queda como celda editable
pero la conversión está quemada en el valor, editarla no recalcularía nada →
rompe la promesa "edita y recalcula".
→ **Recomendación:** que EXTRACCION guarde el EXW crudo + la moneda, y que la
columna `EXW USD` sea una fórmula:
`=IF(E<r>="EUR", D<r>*$B$<tc_eur>/$B$<tc_usd>, D<r>)`. Es una columna más y una
fórmula; queda más correcto que hoy.

**b) Excluir gastos.** Hoy es un checkbox de React filtrado en `excel.ts:105`
(`g.incluido !== false`).
→ **Recomendación:** columna `INCLUIR` en EXTRACCION con checkbox nativo de
Sheets (`setDataValidation`), y que COSTEO lea
`=IF(EXTRACCION!$K$<r>=TRUE, EXTRACCION!$H$<r>, 0)`. Se escriben todos los
gastos y el costeador desmarca en la hoja.

---

## 6. Gemini desde Apps Script

`src/lib/gemini-client.ts` se porta 1:1; solo cambia el transporte:

| Hoy (navegador) | Apps Script |
|---|---|
| `fetch(url, {method,headers,body})` | `UrlFetchApp.fetch(url, {method:'post', contentType:'application/json', payload, muteHttpExceptions:true})` |
| `res.status` / `await res.text()` | `res.getResponseCode()` / `res.getContentText()` |
| `await sleep(8000)` en 429/503 | `Utilities.sleep(8000)` (3 intentos, igual que hoy) |
| base64 del `File` | `Utilities.base64Encode(file.getBlob().getBytes())` |
| API Key en `localStorage` | `PropertiesService.getUserProperties()` |

El payload (`contents[].parts[]` con `inlineData`), el modelo
(`gemini-3.1-flash-lite-preview`) y `generationConfig` quedan idénticos:
misma API REST, misma respuesta, mismo `parsearRespuestaMaestra()`.

`UserProperties` es estrictamente mejor que `localStorage`: la key queda por
usuario, del lado del servidor, y nunca viaja al navegador (solo su máscara).

---

## 7. El port de `excel.ts` → SpreadsheetApp

### 7.1 Escritor bufferizado (obligatorio)

Escribir celda por celda con `setValue()` es inviable en Apps Script: una hoja
COSTEO con N productos y M gastos son cientos de celdas y cada llamada es un
viaje de red. El escritor acumula en memoria y hace **una sola descarga** al
final:

```js
function Escritor(sheet) { /* celdas{}, merges[], anchos{} */ }
Escritor.prototype.put   = function (coord, o) { /* misma firma que excel.ts:157 */ };
Escritor.prototype.merge = function (a1) { };
Escritor.prototype.ancho = function (colLetra, chars) { };
Escritor.prototype.flush = function () { /* ~10 llamadas batch */ };
```

`flush()` arma matrices 2D sobre el rango usado y aplica:

| Propiedad | Llamada batch |
|---|---|
| valores y fórmulas | `setValues` — una fórmula es `"=" + f` dentro de la misma matriz |
| fuente | `setFontFamilies`, `setFontSizes`, `setFontWeights`, `setFontStyles`, `setFontColors` |
| fondo | `setBackgrounds` (`null` = sin fondo) |
| alineación | `setHorizontalAlignments`, `setVerticalAlignments`, `setWraps` |
| formato numérico | `setNumberFormats` |
| notas | `setNotes` |
| bordes | `setBorder` **no acepta matriz**: agrupar por bloques rectangulares contiguos (las tablas ya lo son) |
| merges / anchos | uno por uno; son pocas decenas |

### 7.2 Diferencias a cuidar (fidelidad)

| # | Detalle | Excel / ExcelJS | Sheets |
|---|---|---|---|
| 1 | Fórmulas | sin `=` (`{formula:"SUM(...)"}`) | **con `=`** — lo antepone `put()` |
| 2 | Ancho de columna | caracteres (`width = 22`) | **píxeles**: `px ≈ chars * 7 + 5` |
| 3 | Color | ARGB `"FF"+hex` | `"#"+hex` |
| 4 | Formato moneda | `\$#,##0.00` (`excel.ts:498,502`) | `"$"#,##0.00` |
| 5 | Gridlines | `views:[{showGridLines:false}]` | `setHiddenGridlines(true)` |
| 6 | Hoja activa | `activeTab: 1` | `ss.setActiveSheet(hojaCosteo)` |
| 7 | Celda vacía | no escribir (`excel.ts:161`) | `""` en `setValues` |

El resto (`#,##0.00`, `0.00%`, `0`, `0.00`, `0.000`) es idéntico, y las funciones
usadas — `IF`, `ISNUMBER`, `IFERROR`, `SUM`, `SUMPRODUCT`, `NOT`, `--`, `&` — y
las referencias `EXTRACCION!$B$5` funcionan igual en Sheets. El panel de alertas
(`excel.ts:561-573`) no necesita cambios.

---

## 8. Riesgos y límites reales

1. **6 min por ejecución.** Mitigado por diseño: un documento por llamada
   (~10-40 s de Gemini + hasta 2 reintentos de 8 s). Sin riesgo práctico.
2. **Tiempo total de ejecución diario** ⚠️ *el límite que sí importa*: 90 min/día
   en cuenta gratuita, 6 h/día en Workspace. Cada llamada a Gemini bloquea la
   ejecución mientras espera → ≈150-300 documentos/día en cuenta gratuita, ~10×
   con Workspace. Con volumen alto, conviene Workspace.
3. **Pantalla "Google no ha verificado esta app"** si se usa con cuentas Gmail
   personales. Con Workspace y despliegue interno al dominio, no aparece.
4. **Tamaño de PDF**: `getBytes()` carga a memoria y base64 lo infla ~1.33×.
   Poner guard a ~20 MB y avisar en la lista en vez de fallar.
5. **La hoja generada se re-escanearía** en una segunda corrida sobre la misma
   carpeta. Filtrar por MIME (`application/pdf` y excluir
   `application/vnd.google-apps.*`) y por prefijo `COSTEO `.
6. **Orden de `getFiles()` no garantizado** → ordenar por nombre para que el
   proceso sea determinista.
7. **Subcarpetas**: v1 solo el nivel raíz de la carpeta (recursivo es trivial de
   agregar después si aparece el caso).

---

## 9. Verificación de fidelidad

La regresión actual compara el `.xlsx` generado contra un Excel de referencia a
nivel binario. Eso **no aplica** a una hoja nativa de Google: hay que redefinirla
como fidelidad *funcional*.

Plan: copiar el dataset OC 579-2025 de `scripts/test-excel.ts:7-41` (3 productos,
12 gastos, TC 3.85) a `TestData.gs` con una función `testCosteoDemo()` que
genere la hoja desde ese mismo dataset. Criterio de aceptación, comparando
contra `/tmp/generado_ts.xlsx` (`npm run test:excel`):

- mismos valores de F.I., costo unitario, % importación y totales por producto;
- mismas fórmulas en las celdas clave (factor, prorrateo, VALOR TOTAL, bloque
  IMPORTACIONES);
- mismo layout de filas/columnas y mismo panel de alertas;
- semáforo de EXTRACCION coherente (rojo/verde/amarillo).

---

## 10. Fases

| Fase | Alcance | Hecho cuando… |
|---|---|---|
| **F0** | Manifest, `doGet`, `Index.html` mínimo, despliegue | el web app abre con la cuenta del usuario |
| **F1** | API Key: `UserProperties`, guardar / probar / estado + `Gemini.gs` | "Probar conexión" responde OK contra Gemini |
| **F2** | `Drive.gs`: pegar enlace → listar archivos con filtro por nombre | la lista muestra los PDFs con SKIP/FORCE ya aplicado |
| **F3** | `Prompt.gs`, `Parse.gs`, `apiProcesarDoc` + bucle cliente | los N documentos se procesan con progreso, pausa y cancelar |
| **F4** | `Hoja.gs` (escritor + 2 hojas) + `Consolidar.gs` + guardar en carpeta | la hoja aparece en la carpeta origen y COSTEO recalcula al editar EXTRACCION |
| **F5** | Checkbox INCLUIR, EUR por fórmula, guards de tamaño, nombres, pulido | §5 y §8 resueltos |

**F4 es aproximadamente la mitad del esfuerzo total.** F0-F3 son en su mayoría
código ya escrito que se traslada.

---

## 11. Decisiones abiertas

| # | Decisión | Recomendación |
|---|---|---|
| 1 | ¿Hoja nativa de Google o también copia `.xlsx`? | Nativa en v1; el `.xlsx` sale con "Descargar como" cuando haga falta |
| 2 | Nombre del archivo de salida | `COSTEO <OC> <AAAA-MM-DD>` — no pisa corridas anteriores |
| 3 | ¿Sobrescribir un costeo existente o versionar? | Versionar (fecha en el nombre); nunca borrar |
| 4 | Conversión EUR | Por fórmula en la hoja (§5a) |
| 5 | Exclusión de gastos | Checkbox nativo en EXTRACCION (§5b) |
| 6 | Cómo se publica el código | Los archivos viven en este repo; se suben con `clasp push` o copiando al editor |
| 7 | ¿Se retira la app Next.js? | Mantenerla mientras F0-F5 no esté validado; retirarla después |
