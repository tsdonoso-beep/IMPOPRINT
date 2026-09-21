// ============================================================
// Filtro por nombre + consolidación de la OC.
// Port de src/lib/consolidar.ts
// ============================================================

function facturaVacia() {
  return {
    proveedor: '',
    pais_proveedor: '',
    numero_factura: '',
    fecha_factura: '',
    incoterm: 'EXW',
    moneda: 'USD',
    numero_oc: '',
    proyecto: '',
    descuento_porcentaje: 0,
    total_exw: 0,
    notas: ''
  };
}

// Decide si un documento se salta por su nombre.
function clasificarPorNombre(nombre) {
  var nom = String(nombre || '').toLowerCase();
  var forzar = FORCE_INCLUDE.some(function (k) { return nom.indexOf(k) !== -1; });
  if (forzar) return 'force';
  var saltar = SKIP_NOMBRES.some(function (k) { return nom.indexOf(k) !== -1; });
  return saltar ? 'skip' : 'normal';
}

// Consolida los resultados de los documentos procesados en un único DatosOC.
// `docs` = [{ incluido, resultado }]
function consolidar(docs, nombreOC) {
  var datos = {
    nombre_oc: nombreOC,
    factura: facturaVacia(),
    productos: [],
    dua: {},
    gastos: [],
    tc_eur: 0,
    tc_eur_gemini: 0,
    proyecto: '',
    periodo: new Date().getFullYear(),
    tipo_carga: 'TOTAL',
    oc_titulo: ''
  };

  for (var i = 0; i < docs.length; i++) {
    var doc = docs[i];
    if (!doc || !doc.incluido || !doc.resultado) continue;
    var r = doc.resultado;

    if (r.tipo === 'FACTURA_COMERCIAL') {
      var nProds = (r.productos || []).length;
      var nActual = datos.productos.length;
      var totalNuevo = r.total_exw || 0;
      var totalActual = datos.factura.total_exw || 0;
      // Acepta la factura si aporta más productos o mayor total EXW.
      if (nProds > nActual || totalNuevo > totalActual) {
        datos.factura = r.factura || facturaVacia();
        datos.productos = r.productos || [];
        if (datos.factura.proyecto) datos.proyecto = datos.factura.proyecto;
      }
    } else if (r.tipo === 'DUA') {
      if (!datos.dua.numero && r.dua && r.dua.numero) {
        datos.dua = r.dua;
        if ((r.dua.tc_eur || 0) > 0) datos.tc_eur_gemini = r.dua.tc_eur;
      }
    } else if (r.tipo === 'GASTO') {
      var docGastos = (r.gastos || []).map(function (g) {
        g.incluido = g.incluido !== false;
        g.origen = 'documento';
        return g;
      });
      datos.gastos = datos.gastos.concat(docGastos);
    }
  }

  datos.gastos = deduplicarGastos(datos.gastos);

  // No perder los montos que Gemini extrajo de la DUA: se convierten en filas
  // de gasto (origen "dua"), salvo que ya exista un gasto equivalente.
  datos.gastos = datos.gastos.concat(gastosDesdeDua(datos));

  datos.tc_eur = datos.tc_eur_gemini;
  return datos;
}

// Deriva filas de gasto desde los campos de la DUA (flete, seguro, tributos).
function gastosDesdeDua(datos) {
  var d = datos.dua || {};
  var existentes = datos.gastos.map(function (g) { return String(g.concepto || '').toUpperCase(); });
  var yaHay = function (palabras) {
    return existentes.some(function (c) {
      return palabras.some(function (p) { return c.indexOf(p) !== -1; });
    });
  };

  var candidatos = [
    { monto: d.flete_usd || 0, seccion: 'AG. CARGA', concepto: 'FLETE (DUA)', claves: ['FLETE'] },
    { monto: d.seguro_usd || 0, seccion: 'AG. CARGA', concepto: 'SEGURO (DUA)', claves: ['SEGURO'] },
    { monto: d.ad_valorem_usd || 0, seccion: 'SUNAT', concepto: 'AD-VALOREM', claves: ['AD-VALOREM', 'AD VALOREM', 'ADVALOREM'] },
    { monto: d.ipm_usd || 0, seccion: 'SUNAT', concepto: 'IPM', claves: ['IPM'] },
    { monto: d.igv_usd || 0, seccion: 'SUNAT', concepto: 'IGV', claves: ['IGV'] }
  ];

  var derivados = [];
  for (var i = 0; i < candidatos.length; i++) {
    var c = candidatos[i];
    if (c.monto > 0 && !yaHay(c.claves)) {
      derivados.push({
        seccion: c.seccion,
        concepto: c.concepto,
        fecha: d.fecha || '',
        proveedor: 'SUNAT / DUA ' + (d.numero || ''),
        tipo_comprobante: 'DUA',
        serie_numero: d.numero || '',
        moneda: 'DÓLARES',
        monto: c.monto,
        igv: 0,
        confianza: 'alta',
        incluido: true,
        origen: 'dua'
      });
    }
  }
  return derivados;
}
