# Costeo OC — App de Apps Script

Aplicación web de Apps Script: se pega el enlace de la carpeta de Drive de una
OC, se escanean y extraen los documentos con Gemini, y se genera una Hoja de
Cálculo de costeo guardada en esa misma carpeta.

El plan de implementación está en [`../docs/PLAN-APPSCRIPT.md`](../docs/PLAN-APPSCRIPT.md).
Este repositorio es la fuente de verdad del código; el proyecto de Apps Script
es solo el destino donde se despliega.

---

## Pasos manuales (los que no se pueden hacer desde el repo)

### 1. Crear el proyecto de Apps Script

1. Entrar a <https://script.google.com> con la cuenta de Workspace.
2. **Nuevo proyecto** → renombrarlo a `Costeo OC — INROPRIN`.
3. ⚙ **Configuración del proyecto** → marcar
   **"Mostrar el archivo de manifiesto `appsscript.json` en el editor"**
   (hace falta para pegar el manifiesto con los permisos correctos).
4. En esa misma pantalla, copiar el **ID de la secuencia de comandos**.

### 2. Subir el código

**Opción A — `clasp` (recomendada, permite versionar desde el repo):**

```bash
npm install -g @google/clasp
clasp login
cd apps-script
# crear .clasp.json con el ID del paso 1 (ver .clasp.json.ejemplo)
clasp push
```

**Opción B — copiar y pegar:** crear cada archivo en el editor de Apps Script
con el mismo nombre y pegar su contenido. El manifiesto `appsscript.json` se
pega sobre el que ya existe.

### 3. Obtener una Gemini API Key

Cada persona usa **su propia** key, para consumir su propio límite de
requests/día. Se genera en <https://aistudio.google.com/apikey> y se configura
dentro de la app (botón ⚙), no en el código. **Nunca** se escribe una key
compartida en los archivos del proyecto.

### 4. Desplegar como aplicación web

En el editor: **Implementar → Nueva implementación → Aplicación web**

| Campo | Valor |
|---|---|
| Ejecutar como | **Usuario que accede a la aplicación web** |
| Quién tiene acceso | **Cualquier usuario de INROPRIN** (el dominio) |

Copiar la URL resultante: esa es la app.

> `Ejecutar como: usuario que accede` es obligatorio. Es lo que hace que cada
> persona lea solo las carpetas a las que **ella** tiene acceso y use **su**
> API Key.

La primera vez pide autorizar los permisos (Drive, Hojas de Cálculo, servicios
externos). Al ser un despliegue interno al dominio, **no** aparece la pantalla
de "Google no ha verificado esta app".

### 5. Para probar

Hace falta el enlace de una **carpeta de OC real** en Drive con sus PDFs
(factura comercial, DUA, gastos). Sirve cualquier OC ya costeada a mano: así se
compara el resultado de la app contra el costeo conocido.

---

## Archivos

| Archivo | Rol |
|---|---|
| `Api.gs` | `doGet` + funciones que consume la interfaz (`google.script.run`) |
| `Drive.gs` | Lee la carpeta de la OC y guarda la hoja generada en ella |
| `Gemini.gs` | Llamada a Gemini y la API Key por usuario |
| `Prompt.gs` | Prompt maestro de clasificación y extracción |
| `Parse.gs` | Normaliza la respuesta de Gemini |
| `Consolidar.gs` | Filtro por nombre y consolidación de la OC |
| `Hoja.gs` | Escritor bufferizado + las hojas EXTRACCION y COSTEO |
| `Config.gs` | Modelo, filtros por nombre, paleta y formatos |
| `Index/Estilos/Cliente.html` | Interfaz y orquestación del navegador |
| `TestData.gs` | Dataset OC 579-2025 y `testCosteoDemo()` |

## Verificación

```bash
npm run test:hoja
```

Ejecuta los `.gs` en Node con los servicios de Google simulados, evalúa las
fórmulas de la hoja y las compara contra el cálculo de `src/lib/costeo.ts`.
Correrlo después de tocar `Hoja.gs`.

## Volver a desplegar tras un cambio

Un `clasp push` actualiza el código, pero **no** la implementación que usa la
gente. Para publicar: **Implementar → Gestionar implementaciones →** editar
(✏) la existente → **Versión: Nueva versión** → Implementar. Así la URL no
cambia.
