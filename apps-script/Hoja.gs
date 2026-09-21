// ============================================================
// Generador del costeo — port de src/lib/excel.ts a SpreadsheetApp.
// Produce DOS hojas vinculadas por fórmula:
//   1) EXTRACCION : datos crudos con semáforo de calidad.
//   2) COSTEO     : réplica del formato del área, TODO formulado
//                   (=EXTRACCION!...). Se edita en EXTRACCION y COSTEO
//                   recalcula solo.
// Se adapta a N productos y M gastos.
// ============================================================

function colLetra(n) {
  var s = '';
  while (n > 0) {
    var r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function colNum(letras) {
  var n = 0;
  for (var i = 0; i < letras.length; i++) n = n * 26 + (letras.charCodeAt(i) - 64);
  return n;
}

// Agrupa celdas sueltas en rangos A1 por tramos contiguos de cada fila,
// para que cada propiedad se aplique en pocas llamadas y no una por celda.
function comprimirRuns(claves) {
  var porFila = {};
  claves.forEach(function (k) {
    var p = k.split(',');
    if (!porFila[p[0]]) porFila[p[0]] = [];
    porFila[p[0]].push(Number(p[1]));
  });

  var rangos = [];
  for (var f in porFila) {
    var cols = porFila[f].sort(function (a, b) { return a - b; });
    var ini = cols[0];
    var prev = cols[0];
    for (var i = 1; i <= cols.length; i++) {
      var c = cols[i];
      if (c !== prev + 1) {
        rangos.push(ini === prev
          ? colLetra(ini) + f
          : colLetra(ini) + f + ':' + colLetra(prev) + f);
        ini = c;
      }
      prev = c;
    }
  }
  return rangos;
}

// ═══════════════════════════════════════════════════════════
//  ESCRITOR BUFFERIZADO
//  Acumula todo en memoria y baja a la hoja en una sola pasada.
//  Escribir celda por celda contra SpreadsheetApp sería inviable:
//  el costeo son cientos de celdas y cada llamada es un viaje de red.
// ═══════════════════════════════════════════════════════════
function Escritor(hoja) {
  this.hoja = hoja;
  this.celdas = {};
  this.maxF = 1;
  this.maxC = 1;
  this.merges = [];
  this.anchos = [];
  this.checks = [];
}

// Misma firma que el put() de excel.ts: así el layout se porta textual.
Escritor.prototype.put = function (coord, o) {
  var m = String(coord).match(/^([A-Z]+)(\d+)$/);
  var c = colNum(m[1]);
  var f = parseInt(m[2], 10);
  this.celdas[f + ',' + c] = o || {};
  if (f > this.maxF) this.maxF = f;
  if (c > this.maxC) this.maxC = c;
};

Escritor.prototype.merge = function (a1) { this.merges.push(a1); };

Escritor.prototype.ancho = function (letra, chars) {
  this.anchos.push({ c: colNum(letra), chars: chars });
};

Escritor.prototype.checkbox = function (a1) { this.checks.push(a1); };

Escritor.prototype.flush = function () {
  var nf = this.maxF;
  var nc = this.maxC;

  // Una hoja nueva trae 26 columnas: con muchos productos hay que ampliarla.
  var colsActuales = this.hoja.getMaxColumns();
  if (colsActuales < nc) this.hoja.insertColumnsAfter(colsActuales, nc - colsActuales);
  var filasActuales = this.hoja.getMaxRows();
  if (filasActuales < nf) this.hoja.insertRowsAfter(filasActuales, nf - filasActuales);

  var valores = [];
  for (var f = 1; f <= nf; f++) {
    var fila = [];
    for (var c = 1; c <= nc; c++) fila.push('');
    valores.push(fila);
  }

  var grupos = {};
  function agrupar(prop, valor, f, c) {
    var k = prop + '\u0000' + valor;
    if (!grupos[k]) grupos[k] = { prop: prop, valor: valor, celdas: [] };
    grupos[k].celdas.push(f + ',' + c);
  }

  for (var key in this.celdas) {
    var p = key.split(',');
    var ff = Number(p[0]);
    var cc = Number(p[1]);
    var o = this.celdas[key];

    // En Sheets la fórmula se escribe con "=" (ExcelJS la guarda sin él).
    if (o.formula !== undefined && o.formula !== null) valores[ff - 1][cc - 1] = '=' + o.formula;
    else if (o.val !== undefined && o.val !== null && o.val !== '') valores[ff - 1][cc - 1] = o.val;

    if (o.size) agrupar('size', o.size, ff, cc);
    if (o.bold) agrupar('bold', 1, ff, cc);
    if (o.italic) agrupar('italic', 1, ff, cc);
    if (o.color) agrupar('color', '#' + o.color, ff, cc);
    if (o.bg) agrupar('bg', '#' + o.bg, ff, cc);
    if (o.align) agrupar('align', o.align, ff, cc);
    if (o.fmt) agrupar('fmt', o.fmt, ff, cc);
    if (o.border) agrupar('border', 1, ff, cc);
    if (o.note) agrupar('note', o.note, ff, cc);
  }

  var rango = this.hoja.getRange(1, 1, nf, nc);
  rango.setValues(valores);
  rango.setFontFamily('Calibri');

  for (var k in grupos) {
    var g = grupos[k];
    var lista = this.hoja.getRangeList(comprimirRuns(g.celdas));
    if (g.prop === 'size') lista.setFontSize(Number(g.valor));
    else if (g.prop === 'bold') lista.setFontWeight('bold');
    else if (g.prop === 'italic') lista.setFontStyle('italic');
    else if (g.prop === 'color') lista.setFontColor(g.valor);
    else if (g.prop === 'bg') lista.setBackground(g.valor);
    else if (g.prop === 'fmt') lista.setNumberFormat(g.valor);
    else if (g.prop === 'note') lista.setNote(g.valor);
    else if (g.prop === 'border') {
      lista.setBorder(true, true, true, true, true, true, '#BFBFBF', SpreadsheetApp.BorderStyle.SOLID);
    } else if (g.prop === 'align') {
      lista.setHorizontalAlignment(g.valor);
      lista.setVerticalAlignment('middle');
      if (g.valor !== 'right') lista.setWrap(true);
    }
  }

  // ExcelJS mide el ancho en caracteres; Sheets en píxeles.
  for (var i = 0; i < this.anchos.length; i++) {
    this.hoja.setColumnWidth(this.anchos[i].c, Math.round(this.anchos[i].chars * 7 + 5));
  }

  // Los merges van al final: fusionar antes descartaría lo ya escrito.
  for (var j = 0; j < this.merges.length; j++) this.hoja.getRange(this.merges[j]).merge();

  if (this.checks.length) {
    var regla = SpreadsheetApp.newDataValidation().requireCheckbox().build();
    for (var q = 0; q < this.checks.length; q++) {
      this.hoja.getRange(this.checks[q]).setDataValidation(regla);
    }
  }

  this.hoja.setHiddenGridlines(true);
};

// ═══════════════════════════════════════════════════════════
//  ADAPTADOR
// ═══════════════════════════════════════════════════════════
function adaptar(datos) {
  var oc = datos.factura.numero_oc || datos.nombre_oc || '';
  return {
    generales: {
      razon_social: EMPRESA.razon_social,
      ruc: EMPRESA.ruc,
      periodo: datos.periodo || new Date().getFullYear(),
      tipo_carga: datos.tipo_carga || 'TOTAL',
      dua: (datos.dua && datos.dua.numero) || '',
      proyecto: datos.proyecto || '',
      oc: oc,
      oc_titulo: datos.oc_titulo || (oc ? 'OC- GASTOS DESADUANAJE ' + oc : ''),
      proveedor: datos.factura.proveedor || '',
      tc_usd: (datos.dua && datos.dua.tc_usd) || '',
      tc_eur: datos.tc_eur || ''
    },
    productos: (datos.productos || []).map(function (p) {
      var vacio = p.exw_total === null || p.exw_total === undefined || p.exw_total === '';
      return {
        codigo: p.codigo || '',
        nombre: p.nombre || '',
        cantidad: p.cantidad || 0,
        // EXW crudo: la conversión EUR→USD es una fórmula en la hoja, para que
        // corregir el tipo de cambio recalcule en vez de quedar congelado.
        exw: vacio ? '' : p.exw_total,
        moneda: (datos.factura.moneda || 'USD').toUpperCase(),
        partida: p.partida || '',
        peso: p.peso || '',
        confianza: p.confianza || 'alta'
      };
    }),
    // Se escriben TODOS los gastos: excluir uno es desmarcar su casilla.
    gastos: (datos.gastos || []).map(function (g) {
      return {
        seccion: g.seccion || '',
        concepto: g.concepto || '',
        fecha: g.fecha || '',
        proveedor: g.proveedor || '',
        tipo: g.tipo_comprobante || '',
        serie: g.serie_numero || '',
        moneda: g.moneda || 'DÓLARES',
        monto: (g.monto === null || g.monto === undefined) ? '' : g.monto,
        igv: g.igv || '',
        confianza: g.confianza || 'alta',
        incluido: g.incluido !== false
      };
    })
  };
}

// ═══════════════════════════════════════════════════════════
//  HOJA 1: EXTRACCION
// ═══════════════════════════════════════════════════════════
function hojaExtraccion(hoja, d) {
  var e = new Escritor(hoja);
  e.ancho('A', 22);
  e.ancho('B', 42);
  ['C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K'].forEach(function (c) { e.ancho(c, 16); });

  var refs = { gen: {}, genLocal: {}, productos: [], gastos: [] };
  var g = d.generales;

  e.merge('A1:K1');
  e.put('A1', { val: 'EXTRACCIÓN DE DATOS (OCR / PARSER)  —  fuente cruda para el costeo', size: 8, bold: true, color: BLANCO, bg: AZUL, align: 'center', border: true });
  e.put('A2', { val: 'Leyenda:', size: 9, bold: true });
  e.put('B2', { val: '■ Verde = se usa en el cálculo', size: 7, italic: true, color: '808080', bg: VERDE, align: 'left', border: true });
  e.put('C2', { val: '■ Rojo = dato faltante (obligatorio)', size: 7, italic: true, color: '808080', bg: ROJO, align: 'left', border: true });
  e.put('D2', { val: '■ Amarillo = baja confianza (revisar)', size: 7, italic: true, color: '808080', bg: AMARS, align: 'left', border: true });

  // ---------- DATOS GENERALES ----------
  var r = 4;
  e.merge('A' + r + ':B' + r);
  e.put('A' + r, { val: 'DATOS GENERALES', size: 8, bold: true, color: BLANCO, bg: AZUL, align: 'left', border: true });
  r += 1;

  var generalesMap = [
    ['razon_social', 'Razón social', false],
    ['ruc', 'RUC', false],
    ['periodo', 'Periodo', false],
    ['tipo_carga', 'Tipo de carga', false],
    ['dua', 'DUA', true],
    ['proyecto', 'Proyecto', false],
    ['oc', 'OC', true],
    ['proveedor', 'Proveedor', true],
    ['tc_usd', 'Tipo de cambio USD', true],
    ['tc_eur', 'Tipo de cambio EUR', false]
  ];

  for (var i = 0; i < generalesMap.length; i++) {
    var key = generalesMap[i][0];
    var label = generalesMap[i][1];
    var usado = generalesMap[i][2];
    var val = g[key];
    var falta = val === null || val === undefined || val === '';

    e.put('A' + r, { val: label, size: 9, bold: true, align: 'left', border: true });
    e.put('B' + r, {
      val: falta ? 'FALTA' : val,
      size: 9,
      color: usado ? '0000FF' : '000000',
      bg: falta ? ROJO : (usado ? VERDE : undefined),
      align: 'left',
      border: true,
      note: falta
        ? 'Dato obligatorio ausente en el OCR. Completar manualmente.'
        : (usado ? 'Campo usado en el costeo.' : undefined)
    });
    refs.gen[key] = 'EXTRACCION!$B$' + r;
    refs.genLocal[key] = '$B$' + r;
    r += 1;
  }

  // ---------- PRODUCTOS ----------
  r += 1;
  e.merge('A' + r + ':K' + r);
  e.put('A' + r, { val: 'PRODUCTOS (código, cantidad y EXW alimentan el costeo)', size: 8, bold: true, color: BLANCO, bg: AZUL, align: 'left', border: true });
  r += 1;

  var cols = [
    ['A', 'Código', true],
    ['B', 'Nombre', false],
    ['C', 'Cantidad', true],
    ['D', 'EXW origen', false],
    ['E', 'Moneda', false],
    ['F', 'EXW USD', true],
    ['G', 'Partida arancel.', false],
    ['H', 'Peso (kg)', false],
    ['I', 'Confianza', false]
  ];
  for (var ci = 0; ci < cols.length; ci++) {
    e.put(cols[ci][0] + r, { val: cols[ci][1], size: 8, bold: true, color: BLANCO, bg: cols[ci][2] ? VERDE_HDR : AZUL, align: 'center', border: true });
  }
  r += 1;

  var tcEur = refs.genLocal.tc_eur;
  var tcUsd = refs.genLocal.tc_usd;

  for (var pi = 0; pi < d.productos.length; pi++) {
    var p = d.productos[pi];
    var conf = p.confianza || 'alta';
    var faltaCod = !p.codigo;
    var faltaExw = p.exw === null || p.exw === undefined || p.exw === '';

    // EXW en dólares: si la factura vino en euros y hay ambos tipos de cambio,
    // convierte; si no, deja el valor tal cual. Al ser fórmula, corregir el TC
    // en esta misma hoja recalcula todo el costeo.
    var conversion = 'IF(AND(E' + r + '="EUR",ISNUMBER(' + tcEur + '),ISNUMBER(' + tcUsd + '),' + tcUsd + '>0),' +
      'D' + r + '*' + tcEur + '/' + tcUsd + ',D' + r + ')';
    var formulaExw = 'IF(NOT(ISNUMBER(D' + r + ')),"FALTA",' + conversion + ')';

    e.put('A' + r, { val: faltaCod ? 'FALTA' : p.codigo, size: 9, bg: faltaCod ? ROJO : VERDE, align: 'center', border: true });
    e.put('B' + r, { val: p.nombre, size: 9, align: 'left', border: true });
    e.put('C' + r, { val: p.cantidad || 1, size: 9, color: '0000FF', bg: VERDE, align: 'right', fmt: '0', border: true });
    e.put('D' + r, { val: faltaExw ? 'FALTA' : p.exw, size: 9, color: '0000FF', bg: faltaExw ? ROJO : VERDE, align: 'right', fmt: NF, border: true });
    e.put('E' + r, { val: p.moneda || 'USD', size: 9, align: 'center', border: true });
    e.put('F' + r, { formula: formulaExw, size: 9, bold: true, bg: faltaExw ? ROJO : VERDE, align: 'right', fmt: NF, border: true, note: 'Convierte a dólares si la factura está en euros. Alimenta el costeo.' });
    e.put('G' + r, { val: p.partida || '', size: 9, align: 'center', border: true });
    e.put('H' + r, { val: p.peso || '', size: 9, align: 'right', border: true });
    e.put('I' + r, { val: conf, size: 7, italic: true, color: '808080', bg: conf !== 'alta' ? AMARS : undefined, align: 'center', border: true });

    refs.productos.push({
      codigo: 'EXTRACCION!$A$' + r,
      cantidad: 'EXTRACCION!$C$' + r,
      exw: 'EXTRACCION!$F$' + r,
      nombre: 'EXTRACCION!$B$' + r
    });
    r += 1;
  }

  // ---------- GASTOS ----------
  r += 1;
  e.merge('A' + r + ':K' + r);
  e.put('A' + r, { val: 'GASTOS DE NACIONALIZACIÓN (monto alimenta el costeo)', size: 8, bold: true, color: BLANCO, bg: AZUL, align: 'left', border: true });
  r += 1;

  var gcols = [
    ['A', 'Sección', false],
    ['B', 'Concepto', false],
    ['C', 'Fecha', false],
    ['D', 'Proveedor', false],
    ['E', 'Tipo', false],
    ['F', 'Serie/Número', false],
    ['G', 'Moneda', false],
    ['H', 'Monto', true],
    ['I', 'IGV', false],
    ['J', 'Confianza', false],
    ['K', 'Incluir', true]
  ];
  for (var gi = 0; gi < gcols.length; gi++) {
    e.put(gcols[gi][0] + r, { val: gcols[gi][1], size: 8, bold: true, color: BLANCO, bg: gcols[gi][2] ? VERDE_HDR : AZUL, align: 'center', border: true });
  }
  r += 1;

  var primeraGasto = r;
  for (var gj = 0; gj < d.gastos.length; gj++) {
    var gto = d.gastos[gj];
    var gconf = gto.confianza || 'alta';
    var faltaMonto = gto.monto === null || gto.monto === undefined || gto.monto === '';

    e.put('A' + r, { val: gto.seccion || '', size: 9, align: 'center', border: true });
    e.put('B' + r, { val: gto.concepto || '', size: 9, align: 'left', border: true });
    e.put('C' + r, { val: gto.fecha || '', size: 9, align: 'center', border: true });
    e.put('D' + r, { val: gto.proveedor || '', size: 9, align: 'left', border: true });
    e.put('E' + r, { val: gto.tipo || '', size: 9, align: 'center', border: true });
    e.put('F' + r, { val: gto.serie || '', size: 9, align: 'center', border: true });
    e.put('G' + r, { val: gto.moneda || 'DÓLARES', size: 9, align: 'center', border: true });
    e.put('H' + r, { val: faltaMonto ? 'FALTA' : gto.monto, size: 9, color: '0000FF', bg: faltaMonto ? ROJO : VERDE, align: 'right', fmt: NF, border: true });
    e.put('I' + r, { val: gto.igv || '', size: 9, align: 'right', fmt: NF, border: true });
    e.put('J' + r, { val: gconf, size: 7, italic: true, color: '808080', bg: gconf !== 'alta' ? AMARS : undefined, align: 'center', border: true });
    e.put('K' + r, { val: gto.incluido !== false, size: 9, align: 'center', border: true, note: 'Desmarca para dejar este gasto fuera del costeo.' });

    refs.gastos.push({
      seccion: 'EXTRACCION!$A$' + r,
      concepto: 'EXTRACCION!$B$' + r,
      fecha: 'EXTRACCION!$C$' + r,
      proveedor: 'EXTRACCION!$D$' + r,
      tipo: 'EXTRACCION!$E$' + r,
      serie: 'EXTRACCION!$F$' + r,
      moneda: 'EXTRACCION!$G$' + r,
      // El monto pasa por la casilla: desmarcarla lo saca del costeo.
      monto: 'IF(EXTRACCION!$K$' + r + '=TRUE,EXTRACCION!$H$' + r + ',0)'
    });
    r += 1;
  }
  if (d.gastos.length) e.checkbox('K' + primeraGasto + ':K' + (r - 1));

  e.flush();
  return refs;
}

// ═══════════════════════════════════════════════════════════
//  HOJA 2: COSTEO
// ═══════════════════════════════════════════════════════════
function hojaCosteo(hoja, d, ref) {
  var e = new Escritor(hoja);
  var g = d.generales;
  var N = d.productos.length;

  var baseW = { A: 11, B: 30, C: 13, D: 20, E: 13, F: 14, G: 6, H: 10, I: 11 };
  for (var kw in baseW) e.ancho(kw, baseW[kw]);

  // 2 columnas por producto (S/, $) desde J (col 10).
  var START = 10;
  var pair = [];
  for (var i = 0; i < N; i++) {
    var s = colLetra(START + i * 2);
    var dcol = colLetra(START + i * 2 + 1);
    pair.push([s, dcol]);
    e.ancho(s, 13);
    e.ancho(dcol, 13);
  }
  var totS = colLetra(START + N * 2);
  var totD = colLetra(START + N * 2 + 1);
  e.ancho(totS, 13);
  e.ancho(totD, 13);

  // ---------- CABECERA ----------
  e.put('B1', { val: 'COSTEO DE IMPORTACIONES :', size: 12, bold: true });
  e.put('B2', { val: 'RAZÓN SOCIAL :', size: 9, bold: true });
  e.put('D2', { formula: ref.gen.razon_social, size: 9, color: AZUL, align: 'left' });
  e.put('B3', { val: 'RUC :', size: 9, bold: true });
  e.put('D3', { formula: ref.gen.ruc, size: 9, color: AZUL });
  e.put('B4', { val: 'PERIODO:', size: 9, bold: true });
  e.put('D4', { formula: ref.gen.periodo, size: 9, color: AZUL });
  e.put('B5', { val: 'TIPO DE CARGA:', size: 9, bold: true });
  e.put('D5', { formula: ref.gen.tipo_carga, size: 9, color: AZUL });
  e.put('B6', { val: 'DUA:', size: 9, bold: true });
  e.put('D6', { formula: ref.gen.dua, size: 9, color: AZUL });
  e.put('B7', { val: 'PROYECTO :', size: 9, bold: true });
  e.put('D7', { formula: ref.gen.proyecto, size: 9, color: AZUL, align: 'left' });

  // Caja tipo de cambio
  e.merge('F1:G1');
  e.put('F1', { val: 'Tipo de cambio', size: 8, bold: true, bg: GRIS, align: 'center', border: true });
  var TC = '$F$2';
  e.put('F2', { formula: ref.gen.tc_usd, size: 9, color: AZUL, bg: GRIS, align: 'right', fmt: '0.00', border: true });
  e.put('G2', { val: 'USD', size: 9, align: 'left', border: true });
  e.put('F3', { formula: ref.gen.tc_eur, size: 9, color: AZUL, bg: GRIS, align: 'right', fmt: '0.000', border: true });
  e.put('G3', { val: 'EUR', size: 9, align: 'left', border: true });

  // Título OC
  e.merge('D9:H9');
  e.put('D9', { val: g.oc_titulo || ('OC ' + g.oc), size: 9, bold: true, bg: ROSA, align: 'center', border: true });

  // ---------- ENCABEZADOS DE PRODUCTO ----------
  e.put('B10', { val: 'PROVEEDOR', size: 9, bold: true, align: 'center', border: true });
  e.put('B11', { val: 'CÓDIGO', size: 9, bold: true, align: 'center', border: true });
  e.put('B12', { val: 'PRODUCTO', size: 9, bold: true, align: 'center', border: true });
  e.put('B13', { val: 'ORDEN DE COMPRA', size: 9, bold: true, align: 'center', border: true });
  for (var pi = 0; pi < N; pi++) {
    var sc = pair[pi][0];
    var dc = pair[pi][1];
    e.merge(sc + '10:' + dc + '10');
    e.put(sc + '10', { formula: ref.gen.proveedor, size: 9, bg: CELESTE, align: 'center', border: true });
    e.merge(sc + '11:' + dc + '11');
    e.put(sc + '11', { formula: ref.productos[pi].codigo, size: 9, bg: CELESTE, align: 'center', border: true });
    e.merge(sc + '12:' + dc + '12');
    e.put(sc + '12', { formula: ref.productos[pi].nombre, size: 9, bg: CELESTE, align: 'center', border: true });
    e.merge(sc + '13:' + dc + '13');
    e.put(sc + '13', { formula: ref.gen.oc, size: 9, bg: CELESTE, align: 'center', border: true });
  }
  e.merge(totS + '10:' + totD + '12');
  e.put(totS + '10', { val: 'TOTAL', size: 9, bold: true, bg: GRIS, align: 'center', border: true });

  // ---------- ENCABEZADO DE TABLA ----------
  var H = 14;
  var hdrs = [
    ['A', 'SEC'], ['B', 'Descripción'], ['C', 'Fecha de Emision'], ['D', 'PROVEEDOR'],
    ['E', 'Tipo/Comprob.'], ['F', 'Serie/Número'], ['G', 'TC'], ['H', 'MONEDA'], ['I', 'MONTO']
  ];
  for (var hi = 0; hi < hdrs.length; hi++) {
    e.put(hdrs[hi][0] + H, { val: hdrs[hi][1], size: 8, bold: true, color: BLANCO, bg: AZUL, align: 'center', border: true });
  }
  for (var hj = 0; hj < N; hj++) {
    e.put(pair[hj][0] + H, { val: 'Importe S/', size: 8, bold: true, color: BLANCO, bg: AZUL, align: 'center', border: true });
    e.put(pair[hj][1] + H, { val: 'Importe $', size: 8, bold: true, color: BLANCO, bg: AZUL, align: 'center', border: true });
  }
  e.put(totS + H, { val: 'Importe S/.', size: 8, bold: true, color: BLANCO, bg: AZUL, align: 'center', border: true });
  e.put(totD + H, { val: 'Importe $', size: 8, bold: true, color: BLANCO, bg: AZUL, align: 'center', border: true });

  // ---------- VALOR EXW ----------
  var EXW = 15;
  e.put('B' + EXW, { val: 'VALOR EXW', size: 9, bold: true, bg: GRIS, align: 'left', border: true });
  e.put('H' + EXW, { val: 'DÓLARES', size: 7, italic: true, color: '808080', align: 'center', border: true });
  var sumaExw = [];
  for (var xi = 0; xi < N; xi++) {
    e.put(pair[xi][1] + EXW, { formula: 'IF(ISNUMBER(' + ref.productos[xi].exw + '),' + ref.productos[xi].exw + ',0)', size: 9, color: AZUL, align: 'right', fmt: NF, border: true });
    e.put(pair[xi][0] + EXW, { size: 9, align: 'right', fmt: NF, border: true });
    sumaExw.push(pair[xi][1] + EXW);
  }
  e.put(totD + EXW, { formula: sumaExw.join('+') || '0', size: 9, bold: true, align: 'right', fmt: NF, border: true });

  // ---------- FILAS DE GASTOS ----------
  var GST = EXW + 1;
  var GEND = GST + d.gastos.length - 1;
  var TG = GEND + 1;
  var VT = TG + 1;
  var FAC_HDR = VT + 3;
  var FAC_START = FAC_HDR + 1;
  var FAC_TOT = FAC_START + N;
  var factorCell = function (i) { return '$D$' + (FAC_START + i); };

  var r = GST;
  var secPrev = null;
  for (var idx = 0; idx < d.gastos.length; idx++) {
    var gto = d.gastos[idx];
    var gr = ref.gastos[idx];
    var secVal = gto.seccion || '';
    var nuevaSec = secVal !== secPrev;

    e.put('A' + r, {
      formula: nuevaSec ? gr.seccion : undefined,
      size: 8,
      bold: nuevaSec,
      color: nuevaSec ? BLANCO : '000000',
      bg: nuevaSec ? AZUL : undefined,
      align: 'center',
      border: true
    });
    secPrev = secVal;
    e.put('B' + r, { formula: gr.concepto, size: 9, color: AZUL, align: 'left', border: true });
    e.put('C' + r, { formula: gr.fecha, size: 9, color: AZUL, align: 'center', border: true });
    e.put('D' + r, { formula: gr.proveedor, size: 9, color: AZUL, align: 'left', border: true });
    e.put('E' + r, { formula: gr.tipo, size: 9, color: AZUL, align: 'center', border: true });
    e.put('F' + r, { formula: gr.serie, size: 9, color: AZUL, align: 'center', border: true });
    e.put('G' + r, { size: 9, align: 'center', border: true });
    e.put('H' + r, { formula: gr.moneda, size: 9, color: AZUL, align: 'center', border: true });
    e.put('I' + r, { formula: gr.monto, size: 9, color: AZUL, align: 'right', fmt: NF, border: true });
    r += 1;
  }

  e.put('B' + TG, { val: 'TOTAL GASTOS', size: 9, bold: true, bg: ROSA, align: 'right', border: true });
  e.put('B' + VT, { val: 'VALOR TOTAL', size: 9, bold: true, bg: ROSA, align: 'right', border: true });

  // ---------- BLOQUE FACTOR ----------
  e.put('D' + FAC_HDR, { val: 'FACTOR:', size: 9, bold: true, bg: GRIS, align: 'center', border: true });
  for (var fi = 0; fi < N; fi++) {
    var rr = FAC_START + fi;
    e.put('B' + rr, { formula: ref.productos[fi].nombre, size: 9, color: AZUL, align: 'left', border: true });
    e.put('C' + rr, { formula: 'IF(ISNUMBER(' + ref.productos[fi].exw + '),' + ref.productos[fi].exw + ',0)', size: 9, color: AZUL, align: 'right', fmt: FMT_USD, border: true });
    e.put('D' + rr, { formula: 'IFERROR(C' + rr + '/$C$' + FAC_TOT + ',0)', size: 9, align: 'right', fmt: PF, border: true });
  }
  e.put('B' + FAC_TOT, { val: 'TOTAL', size: 9, bold: true, align: 'left', border: true });
  e.put('C' + FAC_TOT, { formula: 'SUM(C' + FAC_START + ':C' + (FAC_TOT - 1) + ')', size: 9, bold: true, align: 'right', fmt: FMT_USD, border: true });

  // ---------- DISTRIBUCIÓN DE GASTOS ----------
  for (var gr2 = GST; gr2 <= GEND; gr2++) {
    var sumaFila = [];
    for (var di = 0; di < N; di++) {
      var scd = pair[di][0];
      var dcd = pair[di][1];
      e.put(dcd + gr2, { formula: 'IF(ISNUMBER($I' + gr2 + '),$I' + gr2 + '*' + factorCell(di) + ',0)', size: 9, align: 'right', fmt: NF, border: true });
      e.put(scd + gr2, { formula: 'IF($G' + gr2 + '="","",' + dcd + gr2 + '*$G' + gr2 + ')', size: 9, align: 'right', fmt: NF, border: true });
      sumaFila.push(dcd + gr2);
    }
    e.put(totD + gr2, { formula: sumaFila.join('+') || '0', size: 9, align: 'right', fmt: NF, border: true });
    e.put(totS + gr2, { formula: 'IF($G' + gr2 + '="","",' + totD + gr2 + '*$G' + gr2 + ')', size: 9, align: 'right', fmt: NF, border: true });
  }

  // ---------- TOTAL GASTOS POR COLUMNA ----------
  // Sin gastos, GEND queda por encima de GST: el rango invertido que saldría
  // (SUM(K16:K15)) lo normaliza Sheets e incluiría la propia celda del total,
  // creando una referencia circular. En ese caso el total es simplemente 0.
  var sumaGastos = function (columna) {
    return d.gastos.length ? 'SUM(' + columna + GST + ':' + columna + GEND + ')' : '0';
  };
  for (var ti = 0; ti < N; ti++) {
    e.put(pair[ti][1] + TG, { formula: sumaGastos(pair[ti][1]), size: 9, bold: true, bg: ROSA, align: 'right', fmt: NF, border: true });
    e.put(pair[ti][0] + TG, { formula: sumaGastos(pair[ti][0]), size: 9, bold: true, bg: ROSA, align: 'right', fmt: NF, border: true });
  }
  e.put(totD + TG, { formula: sumaGastos(totD), size: 9, bold: true, bg: ROSA, align: 'right', fmt: NF, border: true });
  e.put(totS + TG, { formula: sumaGastos(totS), size: 9, bold: true, bg: ROSA, align: 'right', fmt: NF, border: true });

  // VALOR TOTAL = EXW + total gastos
  for (var vi = 0; vi < N; vi++) {
    var dcv = pair[vi][1];
    e.put(dcv + VT, { formula: dcv + EXW + '+' + dcv + TG, size: 9, bold: true, bg: ROSA, align: 'right', fmt: NF, border: true });
  }

  // ---------- BLOQUE IMPORTACIONES (soles) ----------
  var IMP = FAC_TOT + 3;
  e.merge('B' + IMP + ':H' + IMP);
  e.put('B' + IMP, { val: 'IMPORTACIONES', size: 8, bold: true, color: BLANCO, bg: AZUL, align: 'center', border: true });

  var rowE = IMP + 1, rowG = IMP + 2, rowS = IMP + 3, rowV = IMP + 4;
  var rowF = IMP + 5, rowC = IMP + 6, rowU = IMP + 7, rowP = IMP + 8;
  var labels = [
    [rowE, 'VALOR EXW S/'], [rowG, 'TOTAL GASTOS'], [rowS, 'SUMA $ + S/'], [rowV, 'VALOR TOTAL'],
    [rowF, 'F.I.'], [rowC, 'CANTIDAD'], [rowU, 'COSTO UNITARIO'], [rowP, '% IMPORTACIÓN']
  ];
  for (var li = 0; li < labels.length; li++) {
    var rr2 = labels[li][0];
    var txt = labels[li][1];
    var bgl = txt === 'F.I.' ? VERDE : (txt === 'COSTO UNITARIO' ? AMAR : GRIS);
    e.merge('B' + rr2 + ':H' + rr2);
    e.put('B' + rr2, { val: txt, size: 9, bold: true, bg: bgl, align: 'right', border: true });
  }

  for (var ii = 0; ii < N; ii++) {
    var sci = pair[ii][0];
    var dci = pair[ii][1];
    e.put(sci + rowE, { formula: dci + EXW + '*' + TC, size: 9, bold: true, align: 'right', fmt: NF, border: true });
    e.put(sci + rowG, { formula: sci + TG, size: 9, align: 'right', fmt: NF, border: true });
    e.put(dci + rowG, { formula: dci + TG + '*' + TC, size: 9, align: 'right', fmt: NF, border: true });
    e.put(sci + rowS, { formula: sci + rowG + '+' + dci + rowG, size: 9, bold: true, align: 'right', fmt: NF, border: true });
    e.put(sci + rowV, { formula: sci + rowE + '+' + sci + rowS, size: 9, bold: true, align: 'right', fmt: NF, border: true });
    e.put(sci + rowF, { formula: 'IFERROR(' + sci + rowV + '/' + sci + rowE + ',0)', size: 9, bold: true, bg: VERDE, align: 'right', fmt: '0.00', border: true });
    e.put(sci + rowC, { formula: ref.productos[ii].cantidad, size: 9, color: AZUL, align: 'right', fmt: '0', border: true });
    e.put(sci + rowU, { formula: 'IFERROR((' + sci + rowE + '/' + sci + rowC + ')*' + sci + rowF + ',0)', size: 9, bold: true, bg: AMAR, align: 'right', fmt: NF, border: true });
    e.put(sci + rowP, { formula: sci + rowF + '-1', size: 9, align: 'right', fmt: PF, border: true });
  }

  // ---------- PANEL DE ALERTAS ----------
  var ALERT = rowP + 2;
  e.merge('B' + ALERT + ':H' + ALERT);
  var faltanGastos = d.gastos.length
    ? 'SUMPRODUCT(--NOT(ISNUMBER(I' + GST + ':I' + GEND + ')))'
    : '0';
  // Se mira la celda de EXTRACCION, no la de COSTEO: esta última ya pasa por
  // IF(ISNUMBER(...),...,0), así que siempre es numérica y nunca acusaría el
  // dato faltante que el panel promete señalar.
  var faltanExwArr = [];
  for (var fe = 0; fe < N; fe++) faltanExwArr.push('--NOT(ISNUMBER(' + ref.productos[fe].exw + '))');
  var faltanExw = faltanExwArr.join('+') || '0';

  e.put('B' + ALERT, {
    formula: 'IF((' + faltanGastos + ')+(' + faltanExw + ')=0,"✓ Datos completos — costeo confiable",' +
      '"⚠ FALTAN "&((' + faltanGastos + ')+(' + faltanExw + '))&" dato(s) — revisar hoja EXTRACCION (celdas rojas)")',
    size: 9, bold: true, bg: GRIS, align: 'center', border: true,
    note: 'Semáforo automático: verde si todo está completo, rojo si falta algún monto o EXW.'
  });

  var LEG = ALERT + 2;
  e.put('B' + LEG, { val: 'Datos traídos de la hoja EXTRACCION (azul). Corrige ahí y aquí se recalcula.', size: 7, italic: true, color: '808080', align: 'left' });
  e.put('B' + (LEG + 1), { val: 'Desmarca la casilla "Incluir" en EXTRACCION para dejar un gasto fuera del costeo.', size: 7, italic: true, color: '808080', align: 'left' });
  e.put('B' + (LEG + 2), { val: 'F.I. = Valor total ÷ Valor EXW. El costo unitario incluye todos los gastos prorrateados.', size: 7, italic: true, color: '808080', align: 'left' });
  e.put('B' + (LEG + 3), { val: 'Si el panel de arriba marca FALTAN datos, el costeo trata esos montos como 0 hasta completarlos.', size: 7, italic: true, color: '808080', align: 'left' });

  e.flush();
}

// ═══════════════════════════════════════════════════════════
//  ORQUESTADOR
// ═══════════════════════════════════════════════════════════
function construirHoja(datos, folderId) {
  var oc = datos.nombre_oc || (datos.factura && datos.factura.numero_oc) || 'OC';
  var fecha = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  var nombre = 'COSTEO ' + oc + ' ' + fecha;

  var ss = SpreadsheetApp.create(nombre);
  var hExt = ss.getSheets()[0];
  hExt.setName('EXTRACCION');
  var hCos = ss.insertSheet('COSTEO');

  var d = adaptar(datos);
  var refs = hojaExtraccion(hExt, d);
  hojaCosteo(hCos, d, refs);

  // COSTEO queda como hoja activa al abrir.
  ss.setActiveSheet(hCos);
  SpreadsheetApp.flush();

  if (folderId) moverACarpeta(ss.getId(), folderId);

  return { id: ss.getId(), url: ss.getUrl(), nombre: nombre };
}
