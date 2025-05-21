const fs = require('fs');
const { timeout } = require('puppeteer');

module.exports.run = async function(page, a_number) {
  const prefix = `output-${a_number}`;

  // 1. Navegar a la página
  console.log('🏁 scraper.run INICIO para:', a_number);
  await page.goto('https://acis.eoir.justice.gov/es', { waitUntil: 'domcontentloaded' });
  console.log('✅ página cargada:', page.url());
  await page.screenshot({ path: `${prefix}-01_pagina_cargada.png`, fullPage: true });

// 2. Aceptar modal de bienvenida si aparece (clic directo desde el DOM)
try {
  await page.waitForSelector('button.btn', { timeout: 5000 });

  // Hacer clic directo en el primer botón con clase .btn que diga "ACEPTO"
  await page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll('button.btn'));
    const acceptBtn = buttons.find(btn => btn.innerText.trim().toUpperCase() === 'ACEPTO');
    if (acceptBtn) acceptBtn.click();
  });

  await page.waitForTimeout(500);
  await page.screenshot({ path: `output-${a_number}-02_modal_aceptado.png`, fullPage: true });
  console.log('✅ Botón ACEPTO clickeado vía evaluación directa');
} catch {
  console.warn('⚠️ No se encontró el botón ACEPTO o ya fue aceptado');
}

// 3. Ingresar el A-Number dígito a dígito
for (let i = 0; i < a_number.length; i++) {
  const selector = `input[id$="-${i}"]`;
  await page.waitForSelector(selector, { visible: true });

  if (i === a_number.length - 1) {
    // Último dígito: escribimos y presionamos Enter
    await page.focus(selector);
    await page.keyboard.type(a_number[i]);
    await page.keyboard.press('Enter');
  } else {
    await page.type(selector, a_number[i]);
  }
}
await page.screenshot({ path: `${prefix}-03_a_number_ingresado.png`, fullPage: true });

// 4. Enviar formulario y esperar resultado
await page.screenshot({ path: `${prefix}-04_antes_de_enviar.png`, fullPage: true });
await page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 10000 });
await page.screenshot({ path: `${prefix}-05_despues_de_enviar.png`, fullPage: true });

  // 5. Esperar que el bloque de resultados esté visible
  await page.waitForSelector('div.p-8', { visible: true });
  await page.screenshot({ path: `${prefix}-06_resultado_visible.png`, fullPage: true });

  // 6. Extraer el texto bruto
  const resultText = await page.$eval('div.p-8', el => el.innerText.trim());
  fs.writeFileSync(`${prefix}-07_raw_result.txt`, resultText, 'utf8');

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

  await page.screenshot({ path: `${prefix}-08_resultado_parseado.png`, fullPage: true });

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
