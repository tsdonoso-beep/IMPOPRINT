// Prueba del recorrido de subcarpetas con un Drive simulado: rutas, filtro
// por ruta, atajos que forman ciclos, tope de profundidad y tope de volumen.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const DIR = path.join(__dirname, '..');
const codigo = ['Config.gs', 'Parse.gs', 'Consolidar.gs', 'Drive.gs']
  .map(f => fs.readFileSync(path.join(DIR, f), 'utf8')).join('\n');

// ---------- Drive simulado ----------
function carpeta(nombre, hijos, archivos, id) {
  return { tipo: 'dir', id: id || nombre, nombre, hijos: hijos || [], archivos: archivos || [] };
}
function doc(nombre, kb, mime) {
  return { tipo: 'file', id: nombre, nombre, kb: kb === undefined ? 100 : kb,
    mime: mime || 'application/pdf' };
}

function envolver(nodo) {
  return {
    getId: () => nodo.id,
    getName: () => nodo.nombre,
    getFiles: () => iterar(nodo.archivos.map(f => ({
      getId: () => f.id, getName: () => f.nombre,
      getSize: () => f.kb * 1024, getMimeType: () => f.mime
    }))),
    getFolders: () => iterar(nodo.hijos.map(envolver))
  };
}
function iterar(arr) {
  let i = 0;
  return { hasNext: () => i < arr.length, next: () => arr[i++] };
}

function correr(raiz) {
  const sandbox = {
    console,
    DriveApp: { getFolderById: () => envolver(raiz) },
    Utilities: {}, Logger: { log() {} }
  };
  vm.createContext(sandbox);
  vm.runInContext(codigo, sandbox);
  sandbox.__id = 'x'.repeat(28);
  return vm.runInContext('listarCarpeta(__id)', sandbox);
}

let fallos = 0;
function chequear(titulo, real, esperado) {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  if (!ok) fallos++;
  console.log(`  ${ok ? '✓' : '✗'} ${titulo}: ${JSON.stringify(real)}` +
    (ok ? '' : `\n      esperado ${JSON.stringify(esperado)}`));
}

// ── 1. Árbol con subcarpetas ───────────────────────────────────────
console.log('\n1. Documentos repartidos en subcarpetas');
{
  const raiz = carpeta('OC 579-2025', [
    carpeta('1. FACTURA', [], [doc('invoice.pdf')]),
    carpeta('2. DUA', [], [doc('dua 118.pdf')]),
    carpeta('3. GASTOS', [
      carpeta('AGENCIA', [], [doc('F001-11233.pdf')]),
      carpeta('FLETE', [], [doc('F001-33392.pdf')])
    ], [doc('resumen gastos.pdf')])
  ], [doc('caratula.pdf')]);

  const r = correr(raiz);
  chequear('documentos encontrados', r.archivos.length, 7 - 1);
  chequear('subcarpetas recorridas', r.subcarpetas, 5);
  chequear('rutas', r.archivos.map(a => (a.ruta ? a.ruta + '/' : '') + a.nombre), [
    'caratula.pdf',
    '1. FACTURA/invoice.pdf',
    '2. DUA/dua 118.pdf',
    '3. GASTOS/resumen gastos.pdf',
    '3. GASTOS/AGENCIA/F001-11233.pdf',
    '3. GASTOS/FLETE/F001-33392.pdf'
  ]);
  chequear('sin truncar', r.truncado, false);
}

// ── 2. El filtro mira la ruta completa ─────────────────────────────
console.log('\n2. Una subcarpeta irrelevante descarta lo que tiene dentro');
{
  const raiz = carpeta('OC', [
    carpeta('COTIZACIONES', [], [doc('propuesta A.pdf'), doc('propuesta B.pdf')]),
    carpeta('FACTURAS', [], [doc('doc escaneado 01.pdf')])
  ], []);

  const r = correr(raiz);
  const porNombre = {};
  r.archivos.forEach(a => { porNombre[a.nombre] = a; });
  chequear('archivo dentro de COTIZACIONES', porNombre['propuesta A.pdf'].motivo, 'skip');
  chequear('viene desmarcado', porNombre['propuesta A.pdf'].incluido, false);
  chequear('archivo dentro de FACTURAS', porNombre['doc escaneado 01.pdf'].motivo, 'force');
  chequear('viene marcado', porNombre['doc escaneado 01.pdf'].incluido, true);
}

// ── 3. Atajo que apunta a una carpeta ancestra ─────────────────────
console.log('\n3. Un atajo circular no debe colgar el recorrido');
{
  const raiz = carpeta('RAIZ', [], [doc('a.pdf')], 'RAIZ');
  const hija = carpeta('HIJA', [], [doc('b.pdf')], 'HIJA');
  raiz.hijos.push(hija);
  hija.hijos.push(raiz);          // el ciclo
  hija.hijos.push(hija);          // y una autorreferencia

  const r = correr(raiz);
  chequear('documentos, sin repetir', r.archivos.map(a => a.nombre).sort(), ['a.pdf', 'b.pdf']);
}

// ── 4. Tope de profundidad ─────────────────────────────────────────
console.log('\n4. Más allá de MAX_NIVELES se corta y se avisa');
{
  let nodo = carpeta('N7', [], [doc('hondo.pdf')]);
  for (let i = 6; i >= 1; i--) nodo = carpeta('N' + i, [nodo], [doc('n' + i + '.pdf')]);

  const r = correr(nodo);
  chequear('no baja más de 5 niveles', r.archivos.some(a => a.nombre === 'hondo.pdf'), false);
  chequear('avisa que truncó', r.truncado, true);
}

// ── 5. Tope de volumen ─────────────────────────────────────────────
console.log('\n5. Un árbol enorme se corta en MAX_ARCHIVOS');
{
  const hijos = [];
  for (let c = 0; c < 20; c++) {
    const docs = [];
    for (let i = 0; i < 40; i++) docs.push(doc('c' + c + '-doc' + i + '.pdf'));
    hijos.push(carpeta('SUB' + c, [], docs));
  }
  const r = correr(carpeta('GRANDE', hijos, []));
  chequear('se detiene en el tope', r.archivos.length, 300);
  chequear('avisa que truncó', r.truncado, true);
}

// ── 6. Lo que no se procesa ────────────────────────────────────────
console.log('\n6. Hojas de cálculo y archivos pesados');
{
  const raiz = carpeta('OC', [
    carpeta('HISTORICO', [], [
      { tipo: 'file', id: 'h', nombre: 'COSTEO 579-2025 2026-09-21', kb: 50,
        mime: 'application/vnd.google-apps.spreadsheet' }
    ])
  ], [doc('catalogo.pdf', 26000)]);

  const r = correr(raiz);
  chequear('la hoja de un costeo previo no se lista', r.archivos.length, 1);
  chequear('el pesado se marca', r.archivos[0].pesado, true);
  chequear('y viene desmarcado', r.archivos[0].incluido, false);
}

console.log('\n' + (fallos === 0 ? '✅ El recorrido de carpetas pasa.' : `❌ ${fallos} fallo(s).`));
process.exit(fallos === 0 ? 0 : 1);
