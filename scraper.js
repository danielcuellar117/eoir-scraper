const fs = require('fs');

module.exports.run = async function (page, a_number) {
  const prefix = `output-${a_number}`;

  console.log('🏁 scraper.run INICIO para:', a_number);

  // 1. Navegar a la página
  await page.goto('https://acis.eoir.justice.gov/es', { waitUntil: 'domcontentloaded', timeout: 10000 });
  console.log('✅ página cargada:', page.url());
  await page.screenshot({ path: `${prefix}-01_home.png`, fullPage: true });

 // 2. Aceptar el modal de descargo de responsabilidad (botón “ACEPTO”)
try {
  await page.waitForSelector('#accept', { visible: true, timeout: 5000 });
  await page.click('#accept');
  await page.waitForTimeout(500);
  await page.screenshot({ path: `output-${a_number}-02_accepted_modal.png`, fullPage: true });
  console.log('✅ Modal de bienvenida aceptado');
} catch {
  console.warn('⚠️ No se encontró el modal de bienvenida (probablemente ya se aceptó antes).');
}

  // 3. Ingresar el A-Number dígito a dígito
  for (let i = 0; i < a_number.length; i++) {
    const selector = `input[id$="-${i}"]`;
    await page.waitForSelector(selector, { visible: true });
    await page.click(selector);
    await page.type(selector, a_number[i], { delay: 50 });
  }
  await page.screenshot({ path: `${prefix}-03_a_number_filled.png`, fullPage: true });

  // 4. Enviar formulario
  await page.click('#btn_submit');
  try {
    await page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 10000 });
  } catch (e) {
    console.warn(`⚠️ Timeout esperando navegación tras submit (${a_number})`);
  }
  await page.screenshot({ path: `${prefix}-04_after_submit.png`, fullPage: true });

  // 5. Esperar que el bloque de resultados esté visible
  try {
    await page.waitForSelector('div.p-8', { visible: true, timeout: 30000 });
    await page.screenshot({ path: `${prefix}-05_result_loaded.png`, fullPage: true });
  } catch (err) {
    await page.screenshot({ path: `${prefix}-error_no_results.png`, fullPage: true });
    throw new Error('❌ No se encontró el bloque de resultados (div.p-8). Posible error de red o CAPTCHA.');
  }

  // 6. Extraer el texto bruto
  const resultText = await page.$eval('div.p-8', el => el.innerText.trim());

  // 7. Parseo de texto
  const lines = resultText.split('\n').map(l => l.trim()).filter(Boolean);

  let nombre = '';
  let fecha_causa = '';
  let prox_audiencia = '';
  let estado_caso = '';
  let apelacion = '';
  let direccion = '';
  let telefono = '';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line === 'Nombre:') nombre = lines[i + 1] || '';
    if (line.startsWith('Fecha de la lista de causas')) fecha_causa = lines[i + 1] || '';
    if (line.startsWith('Información acerca de la próxima audiencia')) prox_audiencia = lines[i + 1] || '';
    if (line.startsWith('Información sobre Pedimentos y Fallos Judiciales')) estado_caso = lines[i + 1] || '';
    if (line.startsWith('Información de un caso ante la Junta de Apelaciones de Inmigración')) apelacion = lines[i + 1] || '';

    if (line === 'DIRECCIÓN DEL TRIBUNAL') {
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

  // 8. Captura final
  await page.screenshot({ path: `${prefix}-06_final.png`, fullPage: true });

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
