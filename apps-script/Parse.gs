// ============================================================
// Parsers — port de src/lib/parse.ts
// Normalizan la respuesta cruda de Gemini a un resultado por documento.
// ============================================================

function normConfianza(v) {
  var s = String(v || '').toLowerCase();
  return s === 'media' || s === 'baja' ? s : 'alta';
}

function num(v) {
  var n = typeof v === 'number' ? v : parseFloat(String(v));
  return isNaN(n) ? 0 : n;
}

function entero(v) {
  var n = parseInt(String(v), 10);
  return isNaN(n) ? 0 : n;
}

function limpiarJSON(texto) {
  var s = String(texto || '').trim();
  var match = s.match(/```json\s*([\s\S]*?)```/i) || s.match(/```\s*([\s\S]*?)```/i);
  if (match) return match[1].trim();
  s = s.replace(/```json/gi, '').replace(/```/gi, '');
  return s.trim();
}

function parsearRespuestaMaestra(texto) {
  try {
    var obj = JSON.parse(limpiarJSON(texto));
    var tipo = obj.tipo || 'IRRELEVANTE';

    if (tipo === 'FACTURA_COMERCIAL') {
      var f = obj.factura || {};
      return {
        tipo: tipo,
        factura: {
          proveedor: f.proveedor || '',
          pais_proveedor: f.pais_proveedor || '',
          numero_factura: f.numero_factura || '',
          fecha_factura: f.fecha_factura || '',
          incoterm: f.incoterm || 'EXW',
          moneda: f.moneda || 'USD',
          numero_oc: f.numero_oc || '',
          proyecto: f.proyecto || '',
          descuento_porcentaje: num(f.descuento_porcentaje),
          total_exw: num(f.total_exw),
          notas: f.notas || ''
        },
        productos: (obj.productos || []).map(function (p) {
          return {
            nombre: p.nombre || '',
            codigo: p.codigo || '',
            cantidad: entero(p.cantidad),
            precio_unit: num(p.precio_unitario),
            exw_total: num(p.exw_total),
            partida: p.partida || '',
            peso: p.peso !== undefined && p.peso !== null ? String(p.peso) : '',
            confianza: normConfianza(p.confianza)
          };
        }),
        total_exw: num(obj.total_exw) || num(f.total_exw)
      };
    }

    if (tipo === 'DUA') {
      var d = obj.dua || {};
      return {
        tipo: tipo,
        dua: {
          numero: d.numero || '',
          fecha: d.fecha || '',
          tc_usd: num(d.tc_usd),
          tc_eur: num(d.tc_eur),
          fob_usd: num(d.fob_usd),
          flete_usd: num(d.flete_usd),
          seguro_usd: num(d.seguro_usd),
          cif_usd: num(d.cif_usd),
          ad_valorem_usd: num(d.ad_valorem_usd),
          ipm_usd: num(d.ipm_usd),
          igv_usd: num(d.igv_usd),
          total_tributos_usd: num(d.total_tributos_usd)
        }
      };
    }

    if (tipo === 'GASTO') {
      return {
        tipo: tipo,
        gastos: (obj.gastos || []).map(function (g) {
          return {
            seccion: g.seccion || '',
            concepto: g.concepto || '',
            fecha: g.fecha || '',
            proveedor: g.proveedor || '',
            tipo_comprobante: g.tipo_comprobante || 'FACTURA',
            serie_numero: g.serie_numero || '',
            moneda: g.moneda || 'DÓLARES',
            monto: num(g.monto),
            igv: num(g.igv),
            confianza: normConfianza(g.confianza)
          };
        })
      };
    }

    return { tipo: 'IRRELEVANTE' };
  } catch (e) {
    // JSON inválido o incompleto (respuesta vacía, bloqueada o cortada por el
    // límite de tokens): NO es lo mismo que "el documento es irrelevante".
    // Se distingue para que el documento se pueda reintentar en vez de
    // perderse silenciosamente como IRRELEVANTE.
    return { tipo: 'ERROR_LECTURA', motivo: 'La respuesta de Gemini no es JSON válido o quedó incompleta.' };
  }
}

function deduplicarGastos(gastos) {
  var vistos = {};
  return gastos.filter(function (g) {
    if (!g.serie_numero || g.serie_numero === '0' || g.serie_numero === 'N/A') return true;
    var clave = String(g.serie_numero).trim().toUpperCase() + '|' + String(g.concepto).trim().toUpperCase();
    if (vistos[clave]) return false;
    vistos[clave] = true;
    return true;
  });
}
