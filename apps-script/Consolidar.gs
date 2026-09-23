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

  var facturas = []; // una entrada por documento FACTURA_COMERCIAL incluido

  for (var i = 0; i < docs.length; i++) {
    var doc = docs[i];
    if (!doc || !doc.incluido || !doc.resultado) continue;
    var r = doc.resultado;

    if (r.tipo === 'FACTURA_COMERCIAL') {
      facturas.push({
        factura: r.factura || facturaVacia(),
        productos: r.productos || [],
        total_exw: r.total_exw || 0
      });
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

  aplicarFacturas(datos, facturas);

  datos.gastos = deduplicarGastos(datos.gastos);

  // No perder los montos que Gemini extrajo de la DUA: se convierten en filas
  // de gasto (origen "dua"), salvo que ya exista un gasto equivalente.
  datos.gastos = datos.gastos.concat(gastosDesdeDua(datos));

  datos.tc_eur = datos.tc_eur_gemini;
  return datos;
}

// Agrupa las facturas comerciales leídas por número de factura: mismo número
// = el mismo documento escaneado más de una vez (se queda la lectura con más
// productos o mayor total EXW, se descarta la otra). Número distinto se
// trata como facturas reales separadas (embarques o proveedores distintos) y
// se SUMAN sus productos, en vez de perder los de todas menos una. Las que no
// traen número van a un único grupo aparte — como antes de esta corrección —
// porque sin número no hay forma de saber si son la misma factura repetida.
function aplicarFacturas(datos, facturas) {
  if (!facturas.length) return;

  var grupos = {};
  var orden = [];
  facturas.forEach(function (item) {
    var numero = String((item.factura && item.factura.numero_factura) || '').trim().toUpperCase();
    var clave = numero || '__sin_numero__';
    if (!grupos[clave]) orden.push(clave);
    var actual = grupos[clave];
    if (!actual || item.productos.length > actual.productos.length || item.total_exw > actual.total_exw) {
      grupos[clave] = item;
    }
  });

  // Los metadatos de cabecera (proveedor, moneda, incoterm...) son los de la
  // factura con más productos; el resto de facturas solo aporta sus líneas.
  var principal = orden.reduce(function (mejor, clave) {
    var item = grupos[clave];
    if (!mejor) return item;
    return (item.productos.length > mejor.productos.length || item.total_exw > mejor.total_exw) ? item : mejor;
  }, null);

  datos.factura = principal.factura;
  if (datos.factura.proyecto) datos.proyecto = datos.factura.proyecto;

  datos.productos = orden.reduce(function (acum, clave) {
    return acum.concat(grupos[clave].productos);
  }, []);
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
