// Casos límite: EUR, datos faltantes, gasto desmarcado, muchos productos,
// carpeta sin gastos.
const { construir } = require('./construir');
const { crearEvaluador } = require('./evaluador');

const col = n => { let s = ''; while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); } return s; };

// Calcula las filas/columnas clave igual que hojaCosteo(), para no fijarlas a mano.
function mapa(nProd, nGas) {
  const EXW = 15, GST = 16;
  const GEND = GST + nGas - 1, TG = GEND + 1, VT = TG + 1;
  const FAC_START = VT + 4, FAC_TOT = FAC_START + nProd, IMP = FAC_TOT + 3;
  return {
    EXW, TG, VT, FAC_START,
    rowV: IMP + 4, rowF: IMP + 5, rowU: IMP + 7, ALERT: IMP + 8 + 2,
    prodS: i => col(10 + i * 2), prodD: i => col(10 + i * 2 + 1),
    totD: col(10 + nProd * 2 + 1)
  };
}

function base() {
  return {
    nombre_oc: 'TEST',
    factura: {
      proveedor: 'PROVEEDOR X', pais_proveedor: '', numero_factura: '', fecha_factura: '',
      incoterm: 'EXW', moneda: 'USD', numero_oc: 'TEST', proyecto: '',
      descuento_porcentaje: 0, total_exw: 0, notas: ''
    },
    dua: { numero: 'DUA-1', tc_usd: 3.85 },
    tc_eur: 4.081, tc_eur_gemini: 4.081,
    proyecto: 'P', periodo: 2026, tipo_carga: 'TOTAL', oc_titulo: 'OC TEST',
    productos: [
      { codigo: 'A-1', nombre: 'Producto uno', cantidad: 2, precio_unit: 0, exw_total: 24000 },
      { codigo: 'A-2', nombre: 'Producto dos', cantidad: 4, precio_unit: 0, exw_total: 16000 }
    ],
    gastos: [
      { seccion: 'AG. CARGA', concepto: 'FLETE', fecha: '', proveedor: 'H', tipo_comprobante: 'FACTURA', serie_numero: 'F-1', moneda: 'DÓLARES', monto: 1000 },
      { seccion: 'AG. ADU.', concepto: 'COMISIÓN', fecha: '', proveedor: 'T', tipo_comprobante: 'FACTURA', serie_numero: 'F-2', moneda: 'DÓLARES', monto: 200 }
    ]
  };
}

let fallos = 0;
function chequear(titulo, real, esperado, tol) {
  const ok = typeof esperado === 'number'
    ? Math.abs(Number(real) - esperado) < (tol || 1e-9)
    : String(real) === String(esperado);
  if (!ok) fallos++;
  console.log(`  ${ok ? '✓' : '✗'} ${titulo}: ${real}${ok ? '' : '   ← esperado ' + esperado}`);
}

// ── 1. Factura en euros ────────────────────────────────────────────
console.log('\n1. Factura en EUR — la conversión es fórmula, no valor congelado');
{
  const d = base();
  d.factura.moneda = 'EUR';
  const { hojas } = construir(d);
  const m = mapa(2, 2);
  const ev = crearEvaluador(hojas);
  // 4.081 / 3.85 = 1.06 exacto
  chequear('EXW USD producto 1 (24000 × 1.06)', ev.celda('EXTRACCION', 'F18'), 25440);
  chequear('EXW USD producto 2 (16000 × 1.06)', ev.celda('EXTRACCION', 'F19'), 16960);
  chequear('total EXW $ en COSTEO', ev.celda('COSTEO', m.totD + m.EXW), 42400);

  hojas.EXTRACCION[13][1] = 7.70; // B14 = TC EUR corregido a mano en la hoja
  chequear('tras corregir el TC EUR a 7.70, recalcula',
    crearEvaluador(hojas).celda('EXTRACCION', 'F18'), 48000);
}

// ── 2. Datos faltantes ─────────────────────────────────────────────
console.log('\n2. Producto sin EXW y gasto sin monto — el panel debe contarlos');
{
  const d = base();
  d.productos[1].exw_total = null;
  d.gastos[1].monto = null;
  const { hojas } = construir(d);
  const m = mapa(2, 2);
  const ev = crearEvaluador(hojas);
  chequear('EXW USD del producto sin dato', ev.celda('EXTRACCION', 'F19'), 'FALTA');
  chequear('el costeo lo trata como 0', ev.celda('COSTEO', m.prodD(1) + m.EXW), 0);
  const alerta = String(ev.celda('COSTEO', 'B' + m.ALERT));
  chequear('panel de alertas cuenta los 2 faltantes',
    alerta.indexOf('FALTAN 2') !== -1 ? 'FALTAN 2' : alerta, 'FALTAN 2');
}

// ── 3. Gasto desmarcado ────────────────────────────────────────────
console.log('\n3. Desmarcar "Incluir" saca el gasto del costeo');
{
  const { hojas } = construir(base());
  const m = mapa(2, 2);
  chequear('total gastos $ con ambos', crearEvaluador(hojas).celda('COSTEO', m.totD + m.TG), 1200);
  hojas.EXTRACCION[22][10] = false; // K23 = primera fila de gastos
  chequear('total gastos $ sin el flete', crearEvaluador(hojas).celda('COSTEO', m.totD + m.TG), 200);
}

// ── 4. Muchos productos (la hoja nace con 26 columnas) ─────────────
console.log('\n4. Diez productos — la hoja se amplía más allá de la columna Z');
{
  const d = base();
  d.productos = [];
  for (let i = 0; i < 10; i++) {
    d.productos.push({ codigo: 'P-' + i, nombre: 'Producto ' + i, cantidad: 1, precio_unit: 0, exw_total: 1000 });
  }
  const { hojas, sheets } = construir(d);
  const m = mapa(10, 2);
  const ev = crearEvaluador(hojas);
  const costeo = sheets.filter(h => h.getName() === 'COSTEO')[0];
  chequear('columnas de la hoja', costeo.getMaxColumns() >= 31 ? 'ampliada' : 'sin ampliar', 'ampliada');
  chequear('total EXW $ en ' + m.totD, ev.celda('COSTEO', m.totD + m.EXW), 10000);
  chequear('factor de cada producto', ev.celda('COSTEO', 'D' + m.FAC_START), 0.1);
  chequear('costo unitario del último', ev.celda('COSTEO', m.prodS(9) + m.rowU), (1000 + 120) * 3.85);
}

// ── 5. Sin gastos ──────────────────────────────────────────────────
console.log('\n5. Carpeta sin comprobantes de gasto — sin referencias circulares');
{
  const d = base();
  d.gastos = [];
  const { hojas } = construir(d);
  const m = mapa(2, 0);
  const ev = crearEvaluador(hojas);
  chequear('total gastos $', ev.celda('COSTEO', m.totD + m.TG), 0);
  chequear('valor total S/ = EXW S/', ev.celda('COSTEO', m.prodS(0) + m.rowV), 24000 * 3.85);
  chequear('F.I. = 1', ev.celda('COSTEO', m.prodS(0) + m.rowF), 1);
  chequear('panel de alertas',
    String(ev.celda('COSTEO', 'B' + m.ALERT)).indexOf('✓') === 0 ? 'completo' : 'otro', 'completo');
}

console.log('\n' + (fallos === 0 ? '✅ Todos los casos límite pasan.' : `❌ ${fallos} fallo(s).`));
process.exit(fallos === 0 ? 0 : 1);
