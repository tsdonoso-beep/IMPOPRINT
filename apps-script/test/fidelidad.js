// Evalúa las fórmulas de la hoja generada y las compara contra el cálculo
// independiente de src/lib/costeo.ts. Verificación de fidelidad (§9 del plan).
const vm = require('vm');
const { construir } = require('./construir');

const { hojas, datos, sandbox } = construir();
const ERR = { error: true };

const colNum = s => [...s].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0);
const col = n => { let s = ''; while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); } return s; };

function crudo(hoja, f, c) {
  const g = hojas[hoja];
  if (!g || f > g.length || c > (g[0] || []).length) return '';
  const v = g[f - 1][c - 1];
  return v === undefined ? '' : v;
}

const cache = new Map();
const enCurso = new Set();

function valor(hoja, f, c) {
  const k = `${hoja}!${f},${c}`;
  if (cache.has(k)) return cache.get(k);
  if (enCurso.has(k)) throw new Error('Referencia circular en ' + k);
  enCurso.add(k);
  const v = crudo(hoja, f, c);
  const out = (typeof v === 'string' && v.startsWith('=')) ? evaluar(v.slice(1), hoja) : v;
  enCurso.delete(k);
  cache.set(k, out);
  return out;
}

const mapear = (v, f) => Array.isArray(v) ? v.map(f) : f(v);
const truthy = v => v === true || (typeof v === 'number' && v !== 0);
const texto = v => typeof v === 'number' ? String(Math.round(v * 1e10) / 1e10) : String(v);
function num(v) {
  if (typeof v === 'number') return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (v === ERR) return NaN;
  if (v === '' || v == null) return 0;
  const n = parseFloat(v);
  return isNaN(n) ? 0 : n;
}

function evaluar(src, hojaActual) {
  let i = 0;
  const saltar = () => { while (i < src.length && src[i] === ' ') i++; };

  function expr() { return comparacion(); }

  function comparacion() {
    let izq = concat();
    saltar();
    while (i < src.length && (src[i] === '=' || src[i] === '>' || src[i] === '<')) {
      const op = src[i++];
      const der = concat();
      if (op === '=') izq = izq === der;
      else if (op === '>') izq = num(izq) > num(der);
      else izq = num(izq) < num(der);
      saltar();
    }
    return izq;
  }

  function concat() {
    let izq = aditivo();
    saltar();
    while (src[i] === '&') { i++; izq = texto(izq) + texto(aditivo()); saltar(); }
    return izq;
  }

  function aditivo() {
    let izq = multiplicativo();
    saltar();
    while (src[i] === '+' || src[i] === '-') {
      const op = src[i++];
      const der = multiplicativo();
      izq = op === '+' ? num(izq) + num(der) : num(izq) - num(der);
      saltar();
    }
    return izq;
  }

  function multiplicativo() {
    let izq = unario();
    saltar();
    while (src[i] === '*' || src[i] === '/') {
      const op = src[i++];
      const der = unario();
      if (op === '/') izq = num(der) === 0 ? ERR : num(izq) / num(der);
      else izq = num(izq) * num(der);
      saltar();
    }
    return izq;
  }

  function unario() {
    saltar();
    if (src[i] === '-') { i++; return mapear(unario(), x => -num(x)); }
    return primario();
  }

  function primario() {
    saltar();
    if (src[i] === '(') { i++; const v = expr(); saltar(); i++; return v; }
    if (src[i] === '"') {
      i++; let s = '';
      while (i < src.length && src[i] !== '"') s += src[i++];
      i++;
      return s;
    }
    if (/[0-9.]/.test(src[i])) {
      let s = '';
      while (i < src.length && /[0-9.]/.test(src[i])) s += src[i++];
      return parseFloat(s);
    }
    let s = '';
    while (i < src.length && /[A-Za-zÀ-ÿ0-9_$!.:]/.test(src[i])) s += src[i++];
    saltar();
    if (src[i] === '(') {
      i++;
      const args = [];
      saltar();
      if (src[i] !== ')') {
        args.push(expr()); saltar();
        while (src[i] === ',') { i++; args.push(expr()); saltar(); }
      }
      i++;
      return fn(s.toUpperCase(), args);
    }
    if (s.toUpperCase() === 'TRUE') return true;
    if (s.toUpperCase() === 'FALSE') return false;
    return referencia(s);
  }

  function referencia(s) {
    let hoja = hojaActual;
    let ref = s;
    if (ref.includes('!')) { const p = ref.split('!'); hoja = p[0]; ref = p[1]; }
    ref = ref.replace(/\$/g, '');
    if (ref.includes(':')) {
      const [a, b] = ref.split(':');
      const ma = a.match(/^([A-Z]+)(\d+)$/), mb = b.match(/^([A-Z]+)(\d+)$/);
      const c1 = colNum(ma[1]), f1 = +ma[2], c2 = colNum(mb[1]), f2 = +mb[2];
      const arr = [];
      for (let f = f1; f <= f2; f++) for (let c = c1; c <= c2; c++) arr.push(valor(hoja, f, c));
      return arr;
    }
    const m = ref.match(/^([A-Z]+)(\d+)$/);
    if (!m) throw new Error('Referencia inválida: ' + s);
    return valor(hoja, +m[2], colNum(m[1]));
  }

  function fn(nombre, args) {
    switch (nombre) {
      case 'IF': return truthy(args[0]) ? args[1] : args[2];
      case 'AND': return args.every(truthy);
      case 'NOT': return mapear(args[0], x => !truthy(x));
      case 'ISNUMBER': return mapear(args[0], x => typeof x === 'number');
      case 'IFERROR': return args[0] === ERR ? args[1] : args[0];
      case 'SUM': return args.flat().reduce((a, v) => a + num(v), 0);
      case 'SUMPRODUCT': return args[0].reduce((a, v) => a + num(v), 0);
      default: throw new Error('Función no soportada: ' + nombre);
    }
  }

  return expr();
}

const celda = (hoja, a1) => {
  const m = a1.match(/^([A-Z]+)(\d+)$/);
  return valor(hoja, +m[2], colNum(m[1]));
};

// ---------- referencia independiente (misma lógica que src/lib/costeo.ts) ----------
const tc = datos.dua.tc_usd;
const exw = datos.productos.map(p => p.exw_total);
const totalEXW = exw.reduce((a, b) => a + b, 0);
const totalGastos = datos.gastos.reduce((a, g) => a + g.monto, 0);

const esperado = datos.productos.map((p, i) => {
  const factor = exw[i] / totalEXW;
  const valorTotalUSD = exw[i] + totalGastos * factor;
  const valorTotalSoles = valorTotalUSD * tc;
  return {
    codigo: p.codigo,
    factor: factor,
    exwSoles: exw[i] * tc,
    valorTotalSoles: valorTotalSoles,
    fi: valorTotalUSD / exw[i],
    costoUnitSoles: valorTotalSoles / p.cantidad,
    pct: valorTotalUSD / exw[i] - 1
  };
});

console.log('Producto     campo               hoja COSTEO         costeo.ts        ');
console.log('─'.repeat(76));
let fallos = 0;

esperado.forEach((e, i) => {
  const sc = col(10 + i * 2);
  [
    ['factor', `D${33 + i}`, e.factor],
    ['EXW S/', `${sc}40`, e.exwSoles],
    ['valor total S/', `${sc}43`, e.valorTotalSoles],
    ['F.I.', `${sc}44`, e.fi],
    ['costo unitario S/', `${sc}46`, e.costoUnitSoles],
    ['% importación', `${sc}47`, e.pct]
  ].forEach(([campo, ref, esp]) => {
    const real = num(celda('COSTEO', ref));
    const ok = Math.abs(real - esp) < 1e-9;
    if (!ok) fallos++;
    console.log(
      `${e.codigo.padEnd(12)} ${campo.padEnd(19)} ${real.toFixed(6).padStart(15)} ` +
      `${esp.toFixed(6).padStart(16)}  ${ok ? '✓' : '✗'}`
    );
  });
  console.log('');
});

const totD = col(10 + esperado.length * 2 + 1);
const pares = [
  ['TOTAL EXW $', `${totD}15`, totalEXW],
  ['TOTAL GASTOS $', `${totD}28`, totalGastos]
];
pares.forEach(([n, ref, esp]) => {
  const real = num(celda('COSTEO', ref));
  const ok = Math.abs(real - esp) < 1e-9;
  if (!ok) fallos++;
  console.log(`${n.padEnd(17)} ${real.toFixed(2).padStart(12)} ${esp.toFixed(2).padStart(16)}  ${ok ? '✓' : '✗'}`);
});

console.log('\nPanel de alertas :', celda('COSTEO', 'B49'));
console.log('EXW USD (prod 1) :', celda('EXTRACCION', 'F18'), '(fórmula de conversión EUR→USD)');

// ---------- el preview debe dar lo mismo que la hoja ----------
// Es lo que promete la pantalla: "los mismos números que va a tener la hoja".
console.log('\nPreview en pantalla (Costeo.gs) vs. fórmulas de la hoja');
console.log('─'.repeat(76));

sandbox.__datos = datos;
const preview = vm.runInContext('calcularCosteo(__datos)', sandbox);

preview.productos.forEach((p, i) => {
  const sc = col(10 + i * 2);
  [
    ['factor', `D${33 + i}`, p.factor],
    ['valor total S/', `${sc}43`, p.valorTotalSoles],
    ['F.I.', `${sc}44`, p.fi],
    ['costo unitario S/', `${sc}46`, p.costoUnitSoles]
  ].forEach(([campo, ref, esp]) => {
    const real = num(celda('COSTEO', ref));
    const ok = Math.abs(real - esp) < 1e-9;
    if (!ok) fallos++;
    console.log(
      `${p.codigo.padEnd(12)} ${campo.padEnd(19)} ${real.toFixed(6).padStart(15)} ` +
      `${esp.toFixed(6).padStart(16)}  ${ok ? '✓' : '✗'}`
    );
  });
});

const okGastos = Math.abs(preview.totalGastosUSD - totalGastos) < 1e-9;
if (!okGastos) fallos++;
console.log(`total gastos $   ${preview.totalGastosUSD.toFixed(2).padStart(15)} ` +
  `${totalGastos.toFixed(2).padStart(16)}  ${okGastos ? '✓' : '✗'}`);

console.log('\n' + (fallos === 0 ? '✅ Sin diferencias.' : `❌ ${fallos} diferencia(s).`));
process.exit(fallos === 0 ? 0 : 1);
