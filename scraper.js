const fs = require('fs');
const path = require('path');
const https = require('https');

// Configuración por defecto
const DEFAULT_KEYWORDS = [
  { id: 'ingles', label: 'Inglés', patterns: ['ingles', 'inglés', 'lengua extranjera: ingles', 'lengua extranjera inglés'] },
  { id: 'lengua', label: 'Lengua y Literatura', patterns: ['lengua', 'lengua y literatura', 'literatura', 'practicas del lenguaje', 'prácticas del lenguaje'] }
];

function fetchText(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchText(res.headers.location).then(resolve).catch(reject);
      }
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

function parseGvizJson(raw) {
  try {
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start === -1 || end === -1) return null;
    const jsonStr = raw.substring(start, end + 1);
    return JSON.parse(jsonStr);
  } catch (e) {
    return null;
  }
}

function normalize(text) {
  return (text || '')
    .toString()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

function matchesKeywords(materia, customKeywords = DEFAULT_KEYWORDS) {
  const normMat = normalize(materia);
  if (!normMat) return null;

  for (const kw of customKeywords) {
    for (const p of kw.patterns) {
      const normP = normalize(p);
      // Palabra exacta o contenida como término
      const regex = new RegExp(`\\b${normP}\\b`, 'i');
      if (regex.test(normMat) || normMat.includes(normP)) {
        return kw.label;
      }
    }
  }
  return null;
}

function extractRowsFromGviz(gvizData, localityInfo, sheetType) {
  if (!gvizData || !gvizData.table || !gvizData.table.rows) return [];

  const rows = gvizData.table.rows;
  let headerIndex = -1;
  let colMap = {};
  let fechaDesignacion = '';

  // Buscar fila de fecha y fila de cabecera
  for (let i = 0; i < Math.min(rows.length, 10); i++) {
    const r = rows[i].c;
    if (!r) continue;
    const firstCell = r[0] ? (r[0].v || '') + '' : '';
    // Chequear si es una fecha (ej: 19/10/2026)
    if (firstCell.match(/\d{1,2}\/\d{1,2}\/\d{2,4}/)) {
      fechaDesignacion = firstCell.trim();
    }

    const candidateColMap = {};
    for (let c = 0; c < r.length; c++) {
      const val = normalize(r[c] ? r[c].v : '');
      if (val.includes('colegio')) candidateColMap.colegio = c;
      if (val.includes('espacio') || val.includes('curricular')) candidateColMap.materia = c;
      if (val.includes('curso')) candidateColMap.curso = c;
      if (val.includes('division') || val.includes('div')) candidateColMap.division = c;
      if (val.includes('turno')) candidateColMap.turno = c;
      if (val.includes('motivo')) candidateColMap.motivo = c;
      if (val.includes('revista')) candidateColMap.revista = c;
      if (val.includes('cupof')) candidateColMap.cupof = c;
      if (!val.includes('horario') && (val.includes('hs') || val.includes('hora') || val === 'h')) candidateColMap.horas = c;
    }

    if (candidateColMap.colegio !== undefined && candidateColMap.materia !== undefined) {
      headerIndex = i;
      colMap = candidateColMap;
      break;
    }
  }

  // Fallbacks si las cabeceras están divididas
  if (colMap.colegio === undefined) colMap.colegio = 0;
  if (colMap.materia === undefined) colMap.materia = 1;
  if (colMap.horas === undefined) colMap.horas = 2;
  if (colMap.curso === undefined) colMap.curso = 3;
  if (colMap.division === undefined) colMap.division = 4;
  if (colMap.ciclo === undefined) colMap.ciclo = 5;
  if (colMap.orientacion === undefined) colMap.orientacion = 6;
  if (colMap.turno === undefined) colMap.turno = 7;
  if (colMap.motivo === undefined) colMap.motivo = 13;
  if (colMap.revista === undefined) colMap.revista = 14;
  if (colMap.cupof === undefined) colMap.cupof = 15;

  const startIndex = headerIndex >= 0 ? headerIndex + 1 : 3;
  const vacantes = [];

  for (let i = startIndex; i < rows.length; i++) {
    const cells = rows[i].c;
    if (!cells) continue;

    const getVal = (idx) => {
      if (idx === undefined || !cells[idx]) return '';
      const cell = cells[idx];
      return (cell.f || cell.v || '').toString().trim();
    };

    const colegio = getVal(colMap.colegio);
    const materia = getVal(colMap.materia);

    // Si no hay colegio o materia, ignorar fila
    if (!colegio || !materia) continue;
    if (normalize(colegio).includes('colegio') || normalize(materia).includes('espacio curricular')) continue;

    // Horarios días de la semana
    const dias = ['LU', 'MA', 'MI', 'JU', 'VIE'];
    const horarios = [];
    for (let d = 0; d < 5; d++) {
      const colIdx = 8 + d; // Columnas 8 a 12 suelen ser LU a VIE
      const hVal = getVal(colIdx);
      if (hVal && hVal !== '-' && hVal !== 'null') {
        horarios.push(`${dias[d]}: ${hVal}`);
      }
    }

    const matchedCategory = matchesKeywords(materia);
    const id = `${localityInfo.localidad}_${colegio}_${materia}_${getVal(colMap.curso)}_${getVal(colMap.division)}_${getVal(colMap.cupof)}`.replace(/\s+/g, '_');

    vacantes.push({
      id,
      sede: localityInfo.sede,
      localidad: localityInfo.localidad,
      sheetId: localityInfo.sheetId,
      sheetType,
      fechaDesignacion: fechaDesignacion || 'Publicada recientemente',
      colegio,
      materia,
      horas: getVal(colMap.horas) || 'N/D',
      curso: getVal(colMap.curso) || 'N/D',
      division: getVal(colMap.division) || 'N/D',
      ciclo: getVal(colMap.ciclo) || '',
      orientacion: getVal(colMap.orientacion) || '',
      turno: getVal(colMap.turno) || 'N/D',
      horarios: horarios.join(' | ') || 'A confirmar',
      motivo: getVal(colMap.motivo) || 'Vacante / Reemplazo',
      revista: getVal(colMap.revista) || 'INTERINO/SUPLENTE',
      cupof: getVal(colMap.cupof) || '',
      linkSheet: localityInfo.edit || localityInfo.interinatos,
      linkVozPorVos: 'https://vozporvos.lapampa.edu.ar/',
      matchedCategory: matchedCategory || null,
      detectedAt: new Date().toISOString()
    });
  }

  return vacantes;
}

async function scrapeLocality(loc) {
  const results = [];
  if (!loc.sheetId) return results;

  // Interinatos
  try {
    const interinatosUrl = `https://docs.google.com/spreadsheets/d/${loc.sheetId}/gviz/tq?tqx=out:json&gid=1535886259`;
    const raw = await fetchText(interinatosUrl);
    const parsed = parseGvizJson(raw);
    if (parsed) {
      const rows = extractRowsFromGviz(parsed, loc, 'Interinatos y Suplencias');
      results.push(...rows);
    }
  } catch (err) {
    // console.warn(`Error en Interinatos para ${loc.localidad}:`, err.message);
  }

  // Propuestas
  try {
    const propuestasUrl = `https://docs.google.com/spreadsheets/d/${loc.sheetId}/gviz/tq?tqx=out:json&gid=1652036399`;
    const raw = await fetchText(propuestasUrl);
    const parsed = parseGvizJson(raw);
    if (parsed) {
      const rows = extractRowsFromGviz(parsed, loc, 'Propuestas');
      results.push(...rows);
    }
  } catch (err) {
    // console.warn(`Error en Propuestas para ${loc.localidad}:`, err.message);
  }

  return results;
}

async function scrapeAll(options = {}) {
  const sedesPath = path.join(__dirname, 'sedes_data.json');
  if (!fs.existsSync(sedesPath)) {
    throw new Error('No se encontró sedes_data.json');
  }
  const sedes = JSON.parse(fs.readFileSync(sedesPath, 'utf8'));

  const localitiesToScrape = options.localidades && options.localidades.length > 0
    ? sedes.filter(s => options.localidades.includes(s.localidad))
    : sedes;

  const allVacantes = [];
  // Procesar en lotes concurrentes para no saturar
  const chunkSize = 5;
  for (let i = 0; i < localitiesToScrape.length; i += chunkSize) {
    const chunk = localitiesToScrape.slice(i, i + chunkSize);
    const chunkResults = await Promise.all(chunk.map(scrapeLocality));
    for (const res of chunkResults) {
      allVacantes.push(...res);
    }
  }

  return allVacantes;
}

async function sendTelegramNotification(botToken, chatId, vacantes) {
  if (!botToken || !chatId || vacantes.length === 0) return false;

  for (const v of vacantes) {
    const turnoMap = { 'M': 'Mañana', 'T': 'Tarde', 'V': 'Vespertino', 'N': 'Noche' };
    const turnoLabel = turnoMap[v.turno.toUpperCase()] || v.turno;

    const isPropuesta = v.sheetType === 'Propuestas';
    const tipoHeader = isPropuesta ? '⚡ *¡NUEVA PROPUESTA EN SECUNDARIA!*' : '🔔 *¡Nueva Designación (Interinatos y Suplencias)!*';
    const tipoBadge = isPropuesta ? '🏷️ *PROPUESTA*' : '📋 *INTERINATOS Y SUPLENCIAS*';

    const message = `${tipoHeader}

📌 *Convocatoria:* ${tipoBadge}
📍 *Localidad:* ${v.localidad} (${v.sede})
🏫 *Colegio:* ${v.colegio}
📚 *Materia:* *${v.materia}*
⏱️ *Horas:* *${v.horas} hs* | *Curso:* ${v.curso} "${v.division}" | *Turno:* ${turnoLabel}
📋 *Carácter:* ${v.revista} | *Motivo:* ${v.motivo}
📅 *Fecha:* ${v.fechaDesignacion}
⏰ *Horarios:* ${v.horarios}

🔗 [Abrir en Voz por Vos](https://vozporvos.lapampa.edu.ar/)
📑 [Ver Hoja de Cálculo Oficial](${v.linkSheet})`;

    const postData = JSON.stringify({
      chat_id: chatId,
      text: message,
      parse_mode: 'Markdown',
      disable_web_page_preview: true
    });

    await new Promise((resolve) => {
      const req = https.request({
        hostname: 'api.telegram.org',
        path: `/bot${botToken}/sendMessage`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData)
        }
      }, (res) => {
        res.on('data', () => {});
        res.on('end', resolve);
      });
      req.on('error', () => resolve());
      req.write(postData);
      req.end();
    });
  }
  return true;
}

// Si se ejecuta directamente desde línea de comandos
if (require.main === module) {
  (async () => {
    const isForce = process.argv.includes('--force') || process.argv.includes('-f');
    const args = process.argv.slice(2).filter(a => !a.startsWith('-'));
    const botToken = args[0] || process.env.TELEGRAM_BOT_TOKEN;
    const chatId = args[1] || process.env.TELEGRAM_CHAT_ID;

    const vacantes = await scrapeAll();
    const filtradas = vacantes.filter(v => v.matchedCategory !== null);

    console.log(`✅ Escaneo finalizado. Total vacantes: ${vacantes.length}. De interés (Inglés/Lengua): ${filtradas.length}`);

    // Asegurar directorio data/
    const dataDir = path.join(__dirname, 'data');
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

    // Guardar último resultado para GitHub Pages / frontend estático
    fs.writeFileSync(path.join(dataDir, 'latest_vacantes.json'), JSON.stringify({
      updatedAt: new Date().toISOString(),
      total: vacantes.length,
      vacantes: vacantes
    }, null, 2), 'utf8');

    // Manejo de caché para evitar notificaciones repetidas
    const cacheFile = path.join(dataDir, 'seen_ids.json');
    let seenIds = [];
    if (fs.existsSync(cacheFile) && !isForce) {
      try {
        seenIds = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
      } catch (e) {}
    }

    const nuevasParaAvisar = isForce ? filtradas : filtradas.filter(v => !seenIds.includes(v.id));

    if (nuevasParaAvisar.length > 0) {
      console.log(`📢 ¡Se encontraron ${nuevasParaAvisar.length} nuevas vacantes para notificar!`);
      if (botToken && chatId) {
        await sendTelegramNotification(botToken, chatId, nuevasParaAvisar);
        console.log('📲 Notificaciones enviadas por Telegram exitosamente.');
      } else {
        console.log('ℹ️ No se configuraron TELEGRAM_BOT_TOKEN y TELEGRAM_CHAT_ID en las variables de entorno.');
      }

      // Actualizar seen_ids
      const updatedIds = Array.from(new Set([...seenIds, ...nuevasParaAvisar.map(v => v.id)]));
      fs.writeFileSync(cacheFile, JSON.stringify(updatedIds, null, 2), 'utf8');
    } else {
      console.log('✨ No hay nuevas vacantes desde el último escaneo.');
    }
  })();
}

module.exports = {
  scrapeAll,
  scrapeLocality,
  sendTelegramNotification,
  DEFAULT_KEYWORDS
};
