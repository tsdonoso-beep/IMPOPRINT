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

// Lista los archivos de la carpeta aplicando el filtro por nombre.
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

  var archivos = [];
  var it = carpeta.getFiles();
  while (it.hasNext()) {
    var f = it.next();
    var mime = f.getMimeType();
    if (!esDocumentoProcesable(mime)) continue;

    var nombre = f.getName();
    var kb = Math.round(f.getSize() / 1024);
    var motivo = clasificarPorNombre(nombre);
    var pesado = kb > MAX_MB * 1024;

    archivos.push({
      id: f.getId(),
      nombre: nombre,
      tamanoKB: kb,
      mimeType: mime,
      motivo: motivo,
      pesado: pesado,
      // Se excluyen por defecto los saltados por nombre y los demasiado pesados.
      incluido: motivo !== 'skip' && !pesado
    });
  }

  // getFiles() no garantiza orden: se ordena por nombre para que cada corrida
  // procese los documentos en la misma secuencia.
  archivos.sort(function (a, b) { return a.nombre.localeCompare(b.nombre); });

  return {
    folderId: folderId,
    folderNombre: carpeta.getName(),
    archivos: archivos
  };
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
