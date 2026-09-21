// ============================================================
// Cálculo del costeo — port de src/lib/costeo.ts.
// MISMA lógica que las fórmulas de la hoja: todo gasto incluido se
// prorratea en dólares por factor EXW, y la conversión a soles es
// global con el TC de la DUA. Así el preview en pantalla coincide
// con lo que después calcula la hoja.
// ============================================================

// ¿La factura está en euros y se puede convertir a dólares?
function facturaEnEurConvertible(datos) {
  var moneda = ((datos.factura && datos.factura.moneda) || 'USD').toUpperCase();
  var tcUsd = Number(datos.dua && datos.dua.tc_usd) || 0;
  var tcEur = Number(datos.tc_eur) || 0;
  return moneda === 'EUR' && tcUsd > 0 && tcEur > 0;
}

// Convierte un EXW a dólares. Con factura en euros y ambos tipos de cambio,
// aplica EUR→USD = TC_EUR / TC_USD (los dos en soles por unidad).
function exwEnUSD(exw, datos) {
  if (!facturaEnEurConvertible(datos)) return exw;
  var tcUsd = Number(datos.dua.tc_usd) || 0;
  var tcEur = Number(datos.tc_eur) || 0;
  return exw * (tcEur / tcUsd);
}

function calcularCosteo(datos) {
  var productos = datos.productos || [];
  var dua = datos.dua || {};
  var tcUsd = Number(dua.tc_usd) || 0;

  var exwUSD = productos.map(function (p) {
    return exwEnUSD(Number(p.exw_total) || 0, datos);
  });
  var totalEXW = exwUSD.reduce(function (s, v) { return s + v; }, 0);
  var factor = function (exw) { return totalEXW > 0 ? exw / totalEXW : 0; };

  // Solo cuentan los gastos marcados como incluidos.
  var gastosIncluidos = (datos.gastos || []).filter(function (g) { return g.incluido !== false; });
  var totalGastos = gastosIncluidos.reduce(function (s, g) { return s + (Number(g.monto) || 0); }, 0);

  var cprods = productos.map(function (p, i) {
    var exw = exwUSD[i];
    var fct = factor(exw);
    var gastosUSD = totalGastos * fct;
    var valorTotalUSD = exw + gastosUSD;
    var valorTotalSoles = valorTotalUSD * tcUsd;
    var cantidad = Number(p.cantidad) || 0;

    return {
      nombre: p.nombre,
      codigo: p.codigo,
      cantidad: cantidad,
      factor: fct,
      exw: exw,
      gastosUSD: gastosUSD,
      valorTotalUSD: valorTotalUSD,
      valorTotalSoles: valorTotalSoles,
      costoUnitUSD: cantidad > 0 ? valorTotalUSD / cantidad : 0,
      costoUnitSoles: cantidad > 0 ? valorTotalSoles / cantidad : 0,
      fi: exw > 0 ? valorTotalUSD / exw : 0
    };
  });

  return {
    moneda: (datos.factura && datos.factura.moneda) || 'USD',
    tcUsd: tcUsd,
    tcEur: Number(datos.tc_eur) || 0,
    totalEXW: totalEXW,
    totalGastosUSD: totalGastos,
    productos: cprods,
    gastos: gastosIncluidos.length,
    totalGeneralUSD: cprods.reduce(function (s, p) { return s + p.valorTotalUSD; }, 0),
    totalGeneralSoles: cprods.reduce(function (s, p) { return s + p.valorTotalSoles; }, 0)
  };
}
