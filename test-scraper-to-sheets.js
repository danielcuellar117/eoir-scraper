require('dotenv').config();

const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT }               = require('google-auth-library');
const puppeteer             = require('puppeteer-extra');
const Stealth               = require('puppeteer-extra-plugin-stealth');
const { run }               = require('./scraper');
const fs = require('fs');
const path = require('path');
const { executablePath } = require('puppeteer');


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

  await resultados.loadHeaderRow();
  console.log('🗂️ Headers de "Resultados":', resultados.headerValues);

  const rowsIn = await entradas.getRows();
  console.log(`✅ Filas leídas en "Entradas": ${rowsIn.length}`);
  console.log('🗂️ Encabezados de "Entradas":', entradas.headerValues);
  const aColIndex = entradas.headerValues.findIndex(h => /^(A[#_ ]?number|A#)$/i.test(h));
  if (aColIndex === -1) {
    console.error('❌ No encontré columna "A_Number" o "A#" en los encabezados de Entradas');
    process.exit(1);
  }
  console.log('✅ A-Number en column index:', aColIndex, 'header:', entradas.headerValues[aColIndex]);

  // ──────────────────────────────────────────────────────────────────────────
  // 4) Lanzamos Puppeteer (modo no-headless en entorno Linux con XVFB)
  // ──────────────────────────────────────────────────────────────────────────
  console.log('🚀 Iniciando navegador…');
  console.log('🔍 Chromium executable path:', executablePath());


  const browser = await puppeteer.launch({
    headless: false,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--disable-infobars',
      '--disable-accelerated-2d-canvas',
      '--disable-features=IsolateOrigins,site-per-process',
      '--window-size=3000,3000',
      '--start-maximized',
      '--disable-blink-features=AutomationControlled'
    ],
    ignoreDefaultArgs: ['--enable-automation'],
    defaultViewport: null
  });

  const [page] = await browser.pages();

  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36');
  await page.setExtraHTTPHeaders({ 'Accept-Language': 'en-US,en;q=0.9' });

  const version = await browser.version();
  console.log('🌐 Versión de Chromium lanzada:', version);


  // ──────────────────────────────────────────────────────────────────────────
  // 5) Scrapeamos cada A-Number
  // ──────────────────────────────────────────────────────────────────────────
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
      console.error(`❌ Error en scraper.run() fila ${i+1} (${aNumber}):`, err.message);
      await resultados.addRow({
        A_Number:    rawANum,
        Estado_Caso: 'No hay información de caso para este número de extranjero',
        Fecha_Consulta: new Date().toISOString().split('T')[0]
      });
      console.log(`💾 Fila ${i+1} agregada con mensaje de error`);
    }
  }
  
  if (process.env.GITHUB_ACTIONS) {
  const outputDir = './artifacts';
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir);

  // Mueve todos los archivos que empiecen por "output-" al directorio "artifacts"
  const files = fs.readdirSync('.').filter(name => name.startsWith('output-'));
  for (const file of files) {
    fs.renameSync(file, path.join(outputDir, file));
  }
}

  await browser.close();
  console.log('🏁 Test completado, navegador cerrado');
})();
