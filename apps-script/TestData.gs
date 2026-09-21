// ============================================================
// Dataset de verificación — OC 579-2025.
// Mismos datos que scripts/test-excel.ts, para comparar la hoja
// generada aquí contra el Excel de referencia del área.
// ============================================================

function datosDemo() {
  return {
    nombre_oc: '579-2025',
    factura: {
      proveedor: 'Guangzhou Guangtong Educational Equipment Co.,LTD',
      pais_proveedor: '',
      numero_factura: '',
      fecha_factura: '',
      incoterm: 'EXW',
      moneda: 'USD',
      numero_oc: '579-2025',
      proyecto: '',
      descuento_porcentaje: 0,
      total_exw: 0,
      notas: ''
    },
    dua: { numero: '118-2026-10-128982-01-0-00', tc_usd: 3.85 },
    tc_eur: 4.081,
    tc_eur_gemini: 4.081,
    proyecto: 'TALLERES ESPECIALIZADOS',
    periodo: 2025,
    tipo_carga: 'TOTAL',
    oc_titulo: 'OC- GASTOS DESADUANAJE 579-2025',
    productos: [
      { codigo: 'ESP-264', nombre: 'MÓDULO DE SISTEMA EDUCATIVO DE MOTOR DIESEL (ELECTRÓNICO)', cantidad: 3, precio_unit: 0, exw_total: 24000 },
      { codigo: 'ESP-266', nombre: 'MÓDULO EDUCATIVO DE MONTAJE Y DESMONTAJE DE MOTOR DE GASOLINA', cantidad: 3, precio_unit: 0, exw_total: 15000 },
      { codigo: 'ESP-270', nombre: 'MÓDULO EDUCATIVO DE SISTEMA DE ENCENDIDO (ELECTRÓNICO)', cantidad: 3, precio_unit: 0, exw_total: 9000 }
    ],
    gastos: [
      { seccion: 'DEPOSITO', concepto: 'RECEPCIÓN DE VACIOS DEPOT', fecha: '', proveedor: '', tipo_comprobante: '', serie_numero: '', moneda: 'DÓLARES', monto: 0.0 },
      { seccion: 'DEPOSITO', concepto: 'SERVICIO DE REFERENCIAMIENTO LOGÍSTICO', fecha: '26/03/2026', proveedor: 'DP WORLD LOGISTICS', tipo_comprobante: 'FACTURA', serie_numero: 'F004-00362699', moneda: 'DÓLARES', monto: 178.0 },
      { seccion: 'AG. ADU.', concepto: 'GASTOS OPERATIVOS', fecha: '31/03/2026', proveedor: 'TRANSMODAL ADUANAS', tipo_comprobante: 'FACTURA', serie_numero: 'F001-11233', moneda: 'DÓLARES', monto: 30.0 },
      { seccion: 'AG. ADU.', concepto: 'COMISIÓN AGENCIAMIENTO', fecha: '31/03/2026', proveedor: 'TRANSMODAL ADUANAS', tipo_comprobante: 'FACTURA', serie_numero: 'F001-11233', moneda: 'DÓLARES', monto: 153.91 },
      { seccion: 'AG. ADU.', concepto: 'TRANSPORTE INTERNO', fecha: '31/03/2026', proveedor: 'TRANSMODAL ADUANAS', tipo_comprobante: 'FACTURA', serie_numero: 'F001-11234', moneda: 'DÓLARES', monto: 271.82 },
      { seccion: 'AG. ADU.', concepto: 'VUCE TRAMITE', fecha: '', proveedor: '', tipo_comprobante: '', serie_numero: '', moneda: 'DÓLARES', monto: 0.0 },
      { seccion: 'AG. ADU.', concepto: 'CUADRILLA', fecha: '06/04/2026', proveedor: 'TRANSMODAL ADUANAS', tipo_comprobante: 'FACTURA', serie_numero: 'F001-11235', moneda: 'DÓLARES', monto: 37.2 },
      { seccion: 'AG. CARGA', concepto: 'FLETE MARITIMO', fecha: '12/03/2026', proveedor: 'HEYSEN', tipo_comprobante: 'FACTURA', serie_numero: 'F001-33392', moneda: 'DÓLARES', monto: 1200.0 },
      { seccion: 'AG. CARGA', concepto: 'INLAND PICK UP', fecha: '12/03/2026', proveedor: 'HEYSEN', tipo_comprobante: 'FACTURA', serie_numero: 'F001-33392', moneda: 'DÓLARES', monto: 570.0 },
      { seccion: 'AG. CARGA', concepto: 'COSTOS EXW', fecha: '12/03/2026', proveedor: 'HEYSEN', tipo_comprobante: 'FACTURA', serie_numero: 'F001-33392', moneda: 'DÓLARES', monto: 550.0 },
      { seccion: 'AG. CARGA', concepto: 'VB', fecha: '13/03/2026', proveedor: 'HEYSEN', tipo_comprobante: 'FACTURA', serie_numero: 'F001-33421', moneda: 'DÓLARES', monto: 328.0 },
      { seccion: 'DEPOSITO', concepto: 'ALMACENAJE', fecha: '24/03/2026', proveedor: 'DINET S.A.', tipo_comprobante: 'FACTURA', serie_numero: 'F012-2005', moneda: 'DÓLARES', monto: 620.98 }
    ]
  };
}

// Genera la hoja de prueba. Sin argumento la deja en la raíz de Drive;
// con un folderId la guarda en esa carpeta.
// Se ejecuta desde el editor de Apps Script (Ejecutar → testCosteoDemo).
function testCosteoDemo(folderId) {
  var hoja = construirHoja(datosDemo(), folderId || null);
  Logger.log('Hoja generada: ' + hoja.url);
  return hoja;
}
