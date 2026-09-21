// ============================================================
// Configuración — port de src/lib/config.ts
// ============================================================

var GEMINI_MODELO = 'gemini-3.1-flash-lite-preview';

// Pausa entre documentos (ms). La aplica el cliente, no el servidor.
var PAUSA_MS = 2500;

// Tamaño máximo de PDF que se manda a Gemini (base64 infla ~1.33x).
var MAX_MB = 20;

// Hasta dónde baja el escaneo de subcarpetas, y cuántos documentos como
// máximo se listan. Son topes de cordura: sin ellos, un enlace a una unidad
// entera dejaría la exploración corriendo hasta agotar el tiempo de ejecución.
var MAX_NIVELES = 5;
var MAX_ARCHIVOS = 300;

// Nombres que, si aparecen, hacen que el documento se salte por defecto.
var SKIP_NOMBRES = [
  'swift',
  'datos bancarios',
  'correo validacion',
  'correo de validacion',
  'validacion tecnica',
  'req ',
  'requerimiento',
  'cotizacion',
  'canal verde',
  'packing list',
  'bl draft'
];

// Nombres que fuerzan la inclusión aunque coincidan con SKIP.
var FORCE_INCLUDE = [
  'invoice',
  'factura',
  'dua',
  'dam',
  'liquidac',
  'flete',
  'almacen',
  'deposito',
  'comision',
  'transporte',
  'cuadrilla',
  'sunat',
  'pago oc',
  'igv',
  'ipm',
  'dhl',
  'f200-',
  'f205-',
  '0160-',
  '20101128'
];

var EMPRESA = {
  razon_social: 'INDUSTRIAS ROLAND PRINT S.A.C.',
  ruc: '20512201611'
};

// ---------- Paleta de la hoja (idéntica al generador del área) ----------
var AZUL = '1F4E79';
var CELESTE = 'DDEBF7';
var ROSA = 'FCE4EC';
var VERDE = 'E2EFDA';
var AMAR = 'FFFF00';
var AMARS = 'FFF2CC';
var ROJO = 'F8CBAD';
var GRIS = 'F2F2F2';
var VERDE_HDR = '548235';
var BLANCO = 'FFFFFF';

// ---------- Formatos numéricos ----------
var NF = '#,##0.00';
var PF = '0.00%';
// Excel escapa el símbolo (\$#,##0.00); Sheets lo quiere entre comillas.
var FMT_USD = '"$"#,##0.00';
