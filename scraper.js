const { timeout } = require("puppeteer");

module.exports.run = async function(page, a_number) {
  // 1. Navegar a la página
  console.log('🏁 scraper.run INICIO para:', a_number);
  await page.goto('https://acis.eoir.justice.gov/es', { waitUntil: 'domcontentloaded' });
  console.log('✅ página cargada:', page.url());


  // 2. Aceptar modal de cookies si aparece
  try {
    await page.waitForSelector('#accept-cookie', { visible: true, timeout: 2000 });
    await page.click('#accept-cookie');
  } catch {
    // si no está, seguimos
  }

  // 3. Ingresar el A-Number dígito a dígito
  for (let i = 0; i < a_number.length; i++) {
    const selector = `input[id$="-${i}"]`;
    await page.waitForSelector(selector, { visible: true });
    await page.type(selector, a_number[i]);
  }

  // 4. Enviar formulario y esperar resultado
await page.click('#btn_submit'); // clic explícito
await page.waitForNavigation({ 
  waitUntil: 'networkidle0',
  timeout: 10000
 });
  await page.screenshot({ path: `output-${a_number}.png`, fullPage: true });
  await page.pdf({ path: `output-${a_number}.pdf`, format: 'A4' });
  // 5. Esperar que el bloque de resultados esté visible
  await page.waitForSelector('div.p-8', { visible: true });

  // 6. Extraer el texto bruto
  const resultText = await page.$eval('div.p-8', el => el.innerText.trim());

  // 7. Parseo a líneas y extracción de campos
    const lines = resultText
    .split('\n')
    .map(l => l.trim())
    .filter(Boolean);

  // 8. Inicializar variables
  let nombre = '';
  let fecha_causa = '';
  let prox_audiencia = '';
  let estado_caso = '';
  let apelacion = '';
  let direccion = '';
  let telefono = '';
 // 9. Recorrer líneas buscando cabeceras
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line === 'Nombre:') {
      nombre = lines[i + 1] || '';
    }

    if (line.startsWith('Fecha de la lista de causas')) {
      fecha_causa = lines[i + 1] || '';
    }

    if (line.startsWith('Información acerca de la próxima audiencia')) {
      prox_audiencia = lines[i + 1] || '';
    }

    if (line.startsWith('Información sobre Pedimentos y Fallos Judiciales')) {
      estado_caso = lines[i + 1] || '';
    }

    if (line.startsWith('Información de un caso ante la Junta de Apelaciones de Inmigración')) {
      apelacion = lines[i + 1] || '';
    }

    if (line === 'DIRECCIÓN DEL TRIBUNAL') {
      // Acumula todas las líneas siguientes hasta llegar a "NUMERO DE TELÉFONO"
      let addr = '';
      for (let j = i + 1; j < lines.length; j++) {
        if (lines[j] === 'NUMERO DE TELÉFONO') break;
        addr += (addr ? ' ' : '') + lines[j];
      }
      direccion = addr;
    }

    if (line === 'NUMERO DE TELÉFONO') {
      telefono = lines[i + 1] || '';
    }
  }

  return {
    nombre,
    fecha_causa,
    prox_audiencia,
    estado_caso,
    apelacion,
    direccion,
    telefono
  };
};
