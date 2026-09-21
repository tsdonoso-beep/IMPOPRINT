// Ejecuta los .gs en Node con los servicios de Apps Script simulados
// y devuelve las grillas resultantes.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const DIR = path.join(__dirname, '..');
const ARCHIVOS = ['Config.gs', 'Parse.gs', 'Consolidar.gs', 'Costeo.gs', 'Hoja.gs', 'TestData.gs'];

class FakeRange {
  constructor(sheet, f, c, nf, nc) { Object.assign(this, { sheet, f, c, nf, nc }); }
  setValues(v) {
    if (v.length !== this.nf) throw new Error(`setValues: filas ${v.length} != ${this.nf}`);
    v.forEach((fila, i) => {
      if (fila.length !== this.nc) throw new Error(`setValues: cols ${fila.length} != ${this.nc}`);
      fila.forEach((val, j) => { this.sheet.grid[this.f - 1 + i][this.c - 1 + j] = val; });
    });
    return this;
  }
  merge() { this.sheet.merges.push(`${this.f},${this.c}`); return this; }
  setFontFamily() { return this; }
  setDataValidation() { this.sheet.checkboxes++; return this; }
}

class FakeRangeList {
  constructor(sheet, rangos) { this.sheet = sheet; this.rangos = rangos; sheet.rangeListCalls++; }
  setFontSize() { return this; } setFontWeight() { return this; } setFontStyle() { return this; }
  setFontColor() { return this; } setBackground() { return this; }
  setNumberFormat(f) { this.sheet.formatos.add(f); return this; }
  setNote() { return this; } setBorder() { return this; }
  setHorizontalAlignment() { return this; } setVerticalAlignment() { return this; } setWrap() { return this; }
}

class FakeSheet {
  constructor(nombre) {
    this.nombre = nombre; this.maxCols = 26; this.maxRows = 1000;
    this.merges = []; this.checkboxes = 0; this.rangeListCalls = 0; this.formatos = new Set();
    this.grid = Array.from({ length: this.maxRows }, () => Array(this.maxCols).fill(''));
  }
  setName(n) { this.nombre = n; return this; }
  getName() { return this.nombre; }
  getMaxColumns() { return this.maxCols; }
  getMaxRows() { return this.maxRows; }
  insertColumnsAfter(_, n) {
    this.maxCols += n;
    this.grid.forEach(f => { for (let i = 0; i < n; i++) f.push(''); });
    return this;
  }
  insertRowsAfter(_, n) {
    this.maxRows += n;
    for (let i = 0; i < n; i++) this.grid.push(Array(this.maxCols).fill(''));
    return this;
  }
  getRange(a, b, c, d) {
    if (typeof a === 'string') {
      const m = a.match(/^([A-Z]+)(\d+)(?::([A-Z]+)(\d+))?$/);
      if (!m) throw new Error('Rango A1 inválido: ' + a);
      const col = s => [...s].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);
      const c1 = col(m[1]), f1 = +m[2];
      const c2 = m[3] ? col(m[3]) : c1, f2 = m[4] ? +m[4] : f1;
      if (c2 > this.maxCols || f2 > this.maxRows) throw new Error(`Rango fuera de hoja: ${a}`);
      return new FakeRange(this, f1, c1, f2 - f1 + 1, c2 - c1 + 1);
    }
    return new FakeRange(this, a, b, c, d);
  }
  getRangeList(rangos) {
    rangos.forEach(r => {
      if (!/^[A-Z]+\d+(:[A-Z]+\d+)?$/.test(r)) throw new Error('RangeList inválido: ' + r);
    });
    return new FakeRangeList(this, rangos);
  }
  setColumnWidth(c, px) {
    if (!(px > 0)) throw new Error('Ancho inválido: ' + px);
    if (c > this.maxCols) throw new Error('setColumnWidth fuera de hoja: col ' + c);
    return this;
  }
  setHiddenGridlines() { return this; }
}

class FakeSpreadsheet {
  constructor(nombre) { this.nombre = nombre; this.hojas = [new FakeSheet('Hoja 1')]; }
  getSheets() { return this.hojas; }
  insertSheet(n) { const h = new FakeSheet(n); this.hojas.push(h); return h; }
  setActiveSheet() { return this; }
  getId() { return 'FAKE_ID'; }
  getUrl() { return 'https://docs.google.com/spreadsheets/d/FAKE_ID/edit'; }
}

function construir(datosPersonalizados) {
  let ultimoSS = null;
  const sandbox = {
    console,
    SpreadsheetApp: {
      create(n) { ultimoSS = new FakeSpreadsheet(n); return ultimoSS; },
      newDataValidation: () => ({ requireCheckbox: () => ({ build: () => ({}) }) }),
      BorderStyle: { SOLID: 'SOLID' },
      flush() {}
    },
    Utilities: { formatDate: () => '2026-09-21' },
    Session: { getScriptTimeZone: () => 'America/Lima' },
    Logger: { log: () => {} },
    DriveApp: {}
  };
  vm.createContext(sandbox);
  const codigo = ARCHIVOS.map(f => fs.readFileSync(path.join(DIR, f), 'utf8')).join('\n');
  vm.runInContext(codigo, sandbox, { filename: 'apps-script.js' });

  const datos = datosPersonalizados || vm.runInContext('datosDemo()', sandbox);
  sandbox.__datos = datos;
  vm.runInContext('construirHoja(__datos, null)', sandbox);

  const hojas = {};
  ultimoSS.getSheets().forEach(h => { hojas[h.nombre] = h.grid; });
  return { hojas, datos, sheets: ultimoSS.getSheets(), sandbox };
}

module.exports = { construir };
