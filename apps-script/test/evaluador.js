// Evaluador mínimo de fórmulas de Sheets: IF, AND, NOT, ISNUMBER, IFERROR,
// SUM, SUMPRODUCT, aritmética, comparación, concatenación y rangos.
const ERR = { error: true };
const colNum = s => [...s].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0);

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

function crearEvaluador(hojas) {
  const cache = new Map();
  const enCurso = new Set();

  function crudo(hoja, f, c) {
    const g = hojas[hoja];
    if (!g || f > g.length || c > (g[0] || []).length) return '';
    const v = g[f - 1][c - 1];
    return v === undefined ? '' : v;
  }

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
        let c1 = colNum(ma[1]), f1 = +ma[2], c2 = colNum(mb[1]), f2 = +mb[2];
        // Sheets normaliza los rangos invertidos (A5:A3 → A3:A5).
        if (f1 > f2) { const t = f1; f1 = f2; f2 = t; }
        if (c1 > c2) { const t = c1; c1 = c2; c2 = t; }
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

  return {
    celda(hoja, a1) {
      const m = a1.match(/^([A-Z]+)(\d+)$/);
      return valor(hoja, +m[2], colNum(m[1]));
    },
    num
  };
}

module.exports = { crearEvaluador, num };
