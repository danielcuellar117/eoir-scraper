// test-scraper-to-sheets.js
require('dotenv').config();

const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT }               = require('google-auth-library');
const chromium              = require('chrome-aws-lambda');
const puppeteer             = require('puppeteer-extra');
const Stealth               = require('puppeteer-extra-plugin-stealth');
const { run }               = require('./scraper');

puppeteer.use(Stealth());

;(async () => {
  // ──────────────────────────────────────────────────────────────────────────
  // 1) Autenticación manual con JWT
  // ──────────────────────────────────────────────────────────────────────────
  console.log('🔑 Autenticando en Google Sheets con JWT…');
const creds = JSON.parse(Buffer.from(process.env.SHEETS_CREDENTIALS).toString());
  const jwtClient = new JWT({
    email: creds.client_email,
    key:   creds.private_key.replace(/\\n/g, '\n'),
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  await jwtClient.authorize();

  // 2) Instanciamos el doc y le inyectamos nuestro cliente JWT
  const doc = new GoogleSpreadsheet(process.env.SHEET_ID);
  doc.auth = jwtClient;
  await doc.loadInfo();
  console.log(`🏷️ Hoja cargada: "${doc.title}"`);
  console.log('📑 Pestañas disponibles:', Object.keys(doc.sheetsByTitle));

  const entradas   = doc.sheetsByTitle['Entradas'];
  const resultados = doc.sheetsByTitle['Resultados'];
  if (!entradas || !resultados) {
    console.error('❌ No existe pestaña "Entradas" o "Resultados"');
    process.exit(1);
  }

  // 2.a) Aseguramos headers en “Resultados”
  await resultados.loadHeaderRow();
  console.log('🗂️ Headers de "Resultados":', resultados.headerValues);

  // 3) Leemos las filas de “Entradas” y averiguamos columna A_Number
  const rowsIn = await entradas.getRows();
  console.log(`✅ Filas leídas en "Entradas": ${rowsIn.length}`);
  console.log('🗂️ Encabezados de "Entradas":', entradas.headerValues);
  const aColIndex = entradas.headerValues.findIndex(h => /^(A[#_ ]?number|A#)$/i.test(h));
  if (aColIndex === -1) {
    console.error('❌ No encontré columna "A_Number" o "A#" en los encabezados de Entradas');
    process.exit(1);
  }
  console.log('✅ A-Number en column index:', aColIndex, 'header:', entradas.headerValues[aColIndex]);

// 4) Arrancamos Puppeteer (local vs GH Actions - Windows con Chrome)
console.log('🚀 Iniciando navegador…');
const isGH = Boolean(process.env.GITHUB_ACTIONS);

let executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
let args = [
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-dev-shm-usage',
  '--disable-gpu',
  '--disable-infobars',
  '--disable-accelerated-2d-canvas',
  '--disable-features=IsolateOrigins,site-per-process',
  '--window-size=1920,1080',
  '--start-maximized',
  '--disable-blink-features=AutomationControlled',
  '--headless=new'
];

// Si no se define PUPPETEER_EXECUTABLE_PATH, usamos el default de Chrome local
if (!executablePath) {
  executablePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'; // Windows local
}

if (isGH) {
  // GitHub Actions en Windows usa esta misma ruta, ya viene preinstalado
  executablePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
 
}

console.log('⚙️ Usando executablePath:', executablePath);

const browser = await puppeteer.launch({
  executablePath,
  args,
  ignoreDefaultArgs: ['--enable-automation'],
  headless: true,
  defaultViewport: null
});

const [page] = await browser.pages();


  // 5) Iteramos cada A-Number, scrapeamos y volcamos en “Resultados”
  for (let i = 0; i < rowsIn.length; i++) {
    const rawANum = String(rowsIn[i]._rawData[aColIndex] || '').trim();
    const aNumber = rawANum.replace(/\D/g, '');
    if (!/^\d{9}$/.test(aNumber)) {
      console.log(`⚠️ A-Number inválido fila ${i+1}: "${rawANum}" → "${aNumber}" (skip)`);
      continue;
    }

    console.log(`\n🔍 Procesando A-Number ${aNumber} (fila ${i+1})`);
    let data;
    try {
      console.log('▶️ Llamando a scraper.run()');
      data = await run(page, aNumber);
      console.log('📋 Raw extraído:\n', await page.$eval('div.p-8', el => el.innerText.trim()));
      console.log('  Objeto parseado:', data);

      // 6.a) Si OK, agregamos fila completa
      await resultados.addRow({
        A_Number:       rawANum,
        Nombre:         data.nombre,
        Fecha_Causa:    data.fecha_causa,
        Prox_Audiencia: data.prox_audiencia,
        Estado_Caso:    data.estado_caso,
        Apelacion:      data.apelacion,
        Direccion:      data.direccion,
        Telefono:       data.telefono,
        Fecha_Consulta: new Date().toISOString().split('T')[0]
      });
      console.log(`✅ Fila ${i+1} agregada con datos`);

    } catch (err) {
      // 6.b) Si hay error (p. ej. timeout), volcamos sólo A_Number + mensaje en Estado_Caso
      console.error(`❌ Error en scraper.run() fila ${i+1} (${aNumber}):`, err.message);
      await resultados.addRow({
        A_Number:    rawANum,
        Estado_Caso: 'No hay información de caso para este número de extranjero'
      });
      console.log(`💾 Fila ${i+1} agregada con mensaje de error`);
    }
  }

  await browser.close();
  console.log('🏁 Test completado, navegador cerrado');
})();
