// ============================================================
// Lectura de la carpeta de la OC en Drive.
// Reemplaza la subida manual de PDFs de la versión web.
// ============================================================

// Acepta la URL completa de la carpeta o el ID pelado.
function extraerFolderId(urlOId) {
  var s = String(urlOId || '').trim();
  if (!s) throw new Error('Pega el enlace de la carpeta de la OC.');
  var m = s.match(/[-\w]{25,}/);
  if (!m) throw new Error('No se reconoce un ID de carpeta en ese enlace.');
  return m[0];
}

// Solo se mandan a Gemini documentos con contenido escaneable.
function esDocumentoProcesable(mimeType) {
  return mimeType === 'application/pdf' ||
    mimeType === 'image/jpeg' ||
    mimeType === 'image/png';
}

// Lista los documentos de la carpeta y de todas sus subcarpetas.
// Los Google Docs/Sheets nativos quedan fuera: así un costeo generado en una
// corrida anterior no se re-escanea como si fuera un documento de la OC.
function listarCarpeta(urlOId) {
  var folderId = extraerFolderId(urlOId);
  var carpeta;
  try {
    carpeta = DriveApp.getFolderById(folderId);
  } catch (e) {
    throw new Error('No se pudo abrir la carpeta. Verifica el enlace y que tengas acceso.');
  }

  var acum = { archivos: [], vistas: {}, subcarpetas: 0, truncado: false };
  recorrerCarpeta(carpeta, '', 0, acum);

  // Los iteradores de Drive no garantizan orden: se ordena por ruta y nombre
  // para que cada corrida procese los documentos en la misma secuencia.
  acum.archivos.sort(function (a, b) {
    return a.ruta.localeCompare(b.ruta) || a.nombre.localeCompare(b.nombre);
  });

  return {
    folderId: folderId,
    folderNombre: carpeta.getName(),
    subcarpetas: acum.subcarpetas,
    truncado: acum.truncado,
    archivos: acum.archivos
  };
}

// Recorre la carpeta en profundidad. `ruta` es la ubicación relativa que se
// muestra en la lista para saber de dónde salió cada documento.
function recorrerCarpeta(carpeta, ruta, nivel, acum) {
  // Un atajo de Drive puede apuntar a una carpeta ya visitada (incluso a una
  // ancestra): sin este registro, el recorrido giraría en redondo.
  var id = carpeta.getId();
  if (acum.vistas[id]) return;
  acum.vistas[id] = true;

  var archivos = carpeta.getFiles();
  while (archivos.hasNext()) {
    if (acum.archivos.length >= MAX_ARCHIVOS) {
      acum.truncado = true;
      return;
    }
    var f = archivos.next();
    var mime = f.getMimeType();
    if (!esDocumentoProcesable(mime)) continue;

    var nombre = f.getName();
    var kb = Math.round(f.getSize() / 1024);
    var pesado = kb > MAX_MB * 1024;
    // El filtro mira la ruta completa: una subcarpeta "COTIZACIONES" descarta
    // lo que tiene dentro aunque los archivos se llamen de cualquier manera.
    var motivo = clasificarPorNombre(ruta ? ruta + '/' + nombre : nombre);

    acum.archivos.push({
      id: f.getId(),
      nombre: nombre,
      ruta: ruta,
      tamanoKB: kb,
      mimeType: mime,
      motivo: motivo,
      pesado: pesado,
      // Se excluyen por defecto los saltados por nombre y los demasiado pesados.
      incluido: motivo !== 'skip' && !pesado
    });
  }

  var subcarpetas = carpeta.getFolders();
  while (subcarpetas.hasNext()) {
    var sub = subcarpetas.next();
    if (nivel + 1 > MAX_NIVELES) {
      acum.truncado = true;
      continue;
    }
    acum.subcarpetas += 1;
    var nombreSub = sub.getName();
    recorrerCarpeta(sub, ruta ? ruta + '/' + nombreSub : nombreSub, nivel + 1, acum);
    if (acum.archivos.length >= MAX_ARCHIVOS) {
      acum.truncado = true;
      return;
    }
  }
}

function leerBase64(fileId) {
  var blob = DriveApp.getFileById(fileId).getBlob();
  return Utilities.base64Encode(blob.getBytes());
}

// Mueve la hoja recién creada a la carpeta de origen de la OC.
function moverACarpeta(spreadsheetId, folderId) {
  var archivo = DriveApp.getFileById(spreadsheetId);
  archivo.moveTo(DriveApp.getFolderById(folderId));
  return archivo;
}
