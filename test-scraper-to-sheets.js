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
  // 1) Autenticación con JWT
  console.log('🔑 Autenticando en Google Sheets con JWT...');
  const creds = JSON.parse(process.env.SHEETS_CREDENTIALS);
  const client = new JWT({
    email: creds.client_email,
    key: creds.private_key.replace(/\\n/g, '\n'),
    scopes: ['https://www.googleapis.com/auth/spreadsheets']
  });

  // 2) Cargar documento y pestañas
  const doc = new GoogleSpreadsheet(process.env.SHEET_ID, client);
  await doc.loadInfo();
  console.log(`🏷️ Hoja cargada: "${doc.title}"`);
  console.log('📑 Pestañas disponibles:', Object.keys(doc.sheetsByTitle));

  const entradas   = doc.sheetsByTitle['Entradas'];
  const resultados = doc.sheetsByTitle['Resultados'];
  if (!entradas || !resultados) {
    console.error('❌ No existe pestaña "Entradas" o "Resultados"');
    process.exit(1);
  }

  // 2.a) Cargar headers de Resultados (para asegurar nombres de columnas)
  await resultados.loadHeaderRow();
  console.log('🗂️ Headers de "Resultados":', resultados.headerValues);

  // 3) Leer filas de Entradas
  const rowsIn = await entradas.getRows();
  console.log(`✅ Filas leídas en "Entradas": ${rowsIn.length}`);
  console.log('🗂️ Encabezados de "Entradas":', entradas.headerValues);

  // 3.b) Indice de la columna A-Number en _rawData
  const aColIndex = entradas.headerValues.findIndex(h => /^(A[#_ ]?number|A#)$/i.test(h));
  if (aColIndex === -1) {
    console.error('❌ No encontré columna "A_Number" o "A#" en los encabezados');
    process.exit(1);
  }
  console.log('✅ A-Number en column index:', aColIndex, 'header:', entradas.headerValues[aColIndex]);

  // 4) Iniciar Puppeteer
  console.log('🚀 Iniciando navegador…');
  const isGH = Boolean(process.env.GITHUB_ACTIONS);
  let executablePath = process.env.PUPPETEER_EXECUTABLE_PATH || null;
  const args = ['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage'];
  if (isGH) {
    executablePath = '/usr/bin/chromium-browser';
    args.push('--headless=new');
  } else if (!executablePath) {
    executablePath = await chromium.executablePath;
  }
  if (!executablePath) {
    console.error('❌ No pude determinar executablePath de Chromium');
    process.exit(1);
  }
  console.log('⚙️ Usando executablePath:', executablePath);

  const browser = await puppeteer.launch({
    executablePath,
    args,
    headless: isGH,
    defaultViewport: chromium.defaultViewport
  });
  const [page] = await browser.pages();

  // 5) Iterar y scrapear cada A-Number
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

      // 6) Si todo va bien, agregamos fila normal:
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
      console.log(`✅ Fila ${i+1} agregada a "Resultados" con datos`);

    } catch (err) {
      // 7) En caso de error (timeout u otro), registramos sólo A_Number + mensaje en Estado_Caso
      console.error(`❌ Error en scraper.run() fila ${i+1} (${aNumber}):`, err.message);
      await resultados.addRow({
        A_Number:    rawANum,
        Estado_Caso: 'No hay información de caso para este número de extranjero'
      });
      console.log(`💾 Fila ${i+1} agregada con mensaje “No hay información de caso…”`);
    }
  }

  await browser.close();
  console.log('🏁 Test completado, navegador cerrado');
})();
