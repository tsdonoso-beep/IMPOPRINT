// ============================================================
// Superficie que consume la interfaz (google.script.run).
// Port de la orquestación de src/app/page.tsx.
//
// Todas las funciones devuelven un string JSON y reciben los objetos
// complejos como string JSON: el serializador de google.script.run no
// transporta `undefined` de forma confiable, y el parseo genera campos
// opcionales por todos lados.
// ============================================================

function doGet() {
  return HtmlService.createTemplateFromFile('Index')
    .evaluate()
    .setTitle('Costeo OC — INROPRIN')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function include(nombre) {
  return HtmlService.createHtmlOutputFromFile(nombre).getContent();
}

function respuesta(obj) {
  return JSON.stringify(obj);
}

// ---------- API Key ----------

function apiEstado() {
  var key = obtenerApiKey();
  var correo = '';
  // Solo se muestra para dejar claro de qué cuenta es la clave en uso.
  try { correo = Session.getActiveUser().getEmail(); } catch (e) { correo = ''; }
  return respuesta({
    tieneKey: !!key,
    keyMask: enmascararKey(key),
    modelo: GEMINI_MODELO,
    pausaMs: PAUSA_MS,
    maxMB: MAX_MB,
    usuario: correo
  });
}

function apiGuardarKey(key) {
  var limpia = String(key || '').trim();
  if (!limpia) return respuesta({ ok: false, error: 'La key está vacía.' });
  guardarApiKey(limpia);
  return respuesta({ ok: true, keyMask: enmascararKey(limpia) });
}

function apiBorrarKey() {
  borrarApiKey();
  return respuesta({ ok: true });
}

function apiProbarKey() {
  return respuesta(probarConexion(obtenerApiKey()));
}

// ---------- Carpeta ----------

function apiListarCarpeta(urlOId) {
  try {
    return respuesta(Object.assign({ ok: true }, listarCarpeta(urlOId)));
  } catch (e) {
    return respuesta({ ok: false, error: e.message });
  }
}

// ---------- Extracción ----------
// Un documento por llamada: cada llamada es su propia ejecución, así
// ninguna se acerca al límite de 6 minutos de Apps Script.

function apiProcesarDoc(fileId, nombre) {
  try {
    var key = obtenerApiKey();
    if (!key) return respuesta({ ok: false, error: 'Configura tu Gemini API Key (botón ⚙).' });

    var archivo = DriveApp.getFileById(fileId);
    if (archivo.getSize() > MAX_MB * 1024 * 1024) {
      return respuesta({ ok: false, error: 'El archivo supera los ' + MAX_MB + ' MB.' });
    }

    var base64 = Utilities.base64Encode(archivo.getBlob().getBytes());
    var salida = extraerDocumento(nombre, base64, archivo.getMimeType(), key);

    return respuesta({
      ok: true,
      tipo: salida.resultado.tipo,
      resultado: salida.resultado
    });
  } catch (e) {
    return respuesta({ ok: false, error: e.message });
  }
}

// ---------- Costeo ----------

function apiGenerarCosteo(docsJSON, folderId, nombreOC) {
  try {
    var docs = JSON.parse(docsJSON || '[]');
    if (!docs.length) return respuesta({ ok: false, error: 'No hay documentos procesados.' });

    var datos = consolidar(docs, String(nombreOC || 'OC').trim() || 'OC');
    if (!datos.productos.length) {
      return respuesta({
        ok: false,
        error: 'No se encontró ninguna factura comercial con productos. Revisa que la carpeta incluya el invoice del proveedor.'
      });
    }

    var hoja = construirHoja(datos, folderId);
    return respuesta({
      ok: true,
      url: hoja.url,
      nombre: hoja.nombre,
      productos: datos.productos.length,
      gastos: datos.gastos.length
    });
  } catch (e) {
    return respuesta({ ok: false, error: e.message });
  }
}
