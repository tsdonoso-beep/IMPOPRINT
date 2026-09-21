// ============================================================
// Cliente de Gemini — port de src/lib/gemini-client.ts.
// Cambia el transporte (fetch → UrlFetchApp); el payload, el modelo
// y el parseo de la respuesta son los mismos.
// ============================================================

var PROP_KEY = 'GEMINI_API_KEY';

function endpointGemini(modelo, apiKey) {
  return 'https://generativelanguage.googleapis.com/v1beta/models/' +
    modelo + ':generateContent?key=' + encodeURIComponent(apiKey);
}

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

  // Reintentos ante 429/503 (API saturada), igual que la versión web.
  for (var intentos = 0; intentos < 3; intentos++) {
    var res = UrlFetchApp.fetch(url, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });
    var code = res.getResponseCode();
    var text = res.getContentText();

    if (code === 429 || code === 503) {
      if (intentos >= 2) throw new Error('Error ' + code + ': API saturada. Espera y reintenta.');
      Utilities.sleep(8000);
      continue;
    }
    if (code !== 200) {
      throw new Error('Gemini [' + code + ']: ' + text.substring(0, 300));
    }
    try {
      var json = JSON.parse(text);
      respText = (((json.candidates || [])[0] || {}).content || {}).parts || [];
      respText = (respText[0] || {}).text || '';
    } catch (e) {
      respText = '';
    }
    break;
  }

  return { resultado: parsearRespuestaMaestra(respText), raw: respText };
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
