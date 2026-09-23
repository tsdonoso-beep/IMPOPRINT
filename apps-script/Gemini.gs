// ============================================================
// Cliente de Gemini — port de src/lib/gemini-client.ts.
// Cambia el transporte (fetch → UrlFetchApp); el payload, el modelo
// y el parseo de la respuesta son los mismos.
// ============================================================

var PROP_KEY = 'GEMINI_API_KEY';

// Esperas crecientes entre reintentos (4 intentos, ~50 s en el peor caso).
var ESPERAS_MS = [5000, 15000, 30000];

// 429 y 503 se parecen en pantalla pero se arreglan distinto: uno es tu cuota,
// el otro es capacidad de Google.
function mensajeSaturacion(code) {
  return code === 429
    ? 'Límite de tu clave alcanzado (429). Esperá unos minutos o usa otra clave.'
    : 'Gemini sin capacidad en este momento (503). Reintenta los documentos que fallaron.';
}

function endpointGemini(modelo, apiKey) {
  return 'https://generativelanguage.googleapis.com/v1beta/models/' +
    modelo + ':generateContent?key=' + encodeURIComponent(apiKey);
}

// finishReason distinto de STOP explica por qué la respuesta puede venir
// vacía o cortada, en vez de dejar que el documento caiga como IRRELEVANTE
// sin explicación.
var MOTIVOS_FINISH = {
  SAFETY: 'Gemini bloqueó el documento por su filtro de seguridad.',
  RECITATION: 'Gemini bloqueó la respuesta (coincide con contenido protegido).',
  MAX_TOKENS: 'La respuesta se cortó por exceder el límite de tokens (factura con demasiados productos).',
  OTHER: 'Gemini no completó la respuesta por un motivo no especificado.'
};

// La key vive por usuario, del lado del servidor: nunca viaja al navegador.
function obtenerApiKey() {
  return PropertiesService.getUserProperties().getProperty(PROP_KEY) || '';
}

function guardarApiKey(key) {
  PropertiesService.getUserProperties().setProperty(PROP_KEY, String(key || '').trim());
}

function borrarApiKey() {
  PropertiesService.getUserProperties().deleteProperty(PROP_KEY);
}

function enmascararKey(key) {
  if (!key) return '';
  if (key.length <= 10) return key;
  return key.slice(0, 4) + '…' + key.slice(-4);
}

// Extrae y clasifica un documento llamando a Gemini.
function extraerDocumento(nombre, base64, mimeType, apiKey) {
  if (!apiKey) throw new Error('Falta la API Key.');

  var payload = {
    contents: [{
      parts: [
        { text: promptMaestro() },
        { text: '\n\n=== DOCUMENTO: ' + nombre + ' ===' },
        { inlineData: { mimeType: mimeType || 'application/pdf', data: base64 } }
      ]
    }],
    generationConfig: { temperature: 0.1, maxOutputTokens: 4096 }
  };

  var url = endpointGemini(GEMINI_MODELO, apiKey);
  var respText = '';
  var finishReason = '';

  // Reintentos ante 429/503. La espera crece entre intentos: cuando Gemini
  // está sin capacidad, volver a golpear a los 8 segundos suele fallar otra vez.
  for (var intento = 0; intento <= ESPERAS_MS.length; intento++) {
    var res = UrlFetchApp.fetch(url, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });
    var code = res.getResponseCode();
    var text = res.getContentText();

    if (code === 429 || code === 503) {
      if (intento === ESPERAS_MS.length) throw new Error(mensajeSaturacion(code));
      Utilities.sleep(ESPERAS_MS[intento]);
      continue;
    }
    if (code !== 200) {
      throw new Error('Gemini [' + code + ']: ' + text.substring(0, 300));
    }
    try {
      var json = JSON.parse(text);
      var candidato = (json.candidates || [])[0] || {};
      finishReason = candidato.finishReason || '';
      var partes = (candidato.content || {}).parts || [];
      respText = (partes[0] || {}).text || '';
    } catch (e) {
      respText = '';
    }
    break;
  }

  var resultado = parsearRespuestaMaestra(respText);
  // Motivo específico (bloqueo, corte por tokens...) cuando la lectura falló
  // y Gemini dejó una pista en finishReason; si no hay pista, se queda el
  // motivo genérico de parsearRespuestaMaestra.
  if (resultado.tipo === 'ERROR_LECTURA' && MOTIVOS_FINISH[finishReason]) {
    resultado.motivo = MOTIVOS_FINISH[finishReason];
  }

  return { resultado: resultado, raw: respText };
}

// Prueba de conexión con la key guardada.
function probarConexion(apiKey) {
  if (!apiKey) return { ok: false, error: 'Falta la API Key.' };
  try {
    var res = UrlFetchApp.fetch(endpointGemini(GEMINI_MODELO, apiKey), {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify({ contents: [{ parts: [{ text: 'Responde solo: OK' }] }] }),
      muteHttpExceptions: true
    });
    var code = res.getResponseCode();
    var text = res.getContentText();
    if (code !== 200) return { ok: false, error: 'Error [' + code + ']: ' + text.substring(0, 200) };
    var json = JSON.parse(text);
    var partes = (((json.candidates || [])[0] || {}).content || {}).parts || [];
    return { ok: true, modelo: GEMINI_MODELO, respuesta: (partes[0] || {}).text || '' };
  } catch (e) {
    return { ok: false, error: 'Error de red: ' + e.message };
  }
}
