const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const cron = require('node-cron');
const { scrapeAll, sendTelegramNotification, DEFAULT_KEYWORDS } = require('./scraper');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
// También servir la raíz para compatibilidad directa con GitHub Pages
app.use(express.static(path.join(__dirname)));

const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

let isScanning = false;
let lastScanTime = null;
let cachedVacantes = [];

// Cargar caché inicial si existe
const latestPath = path.join(dataDir, 'latest_vacantes.json');
if (fs.existsSync(latestPath)) {
  try {
    const raw = JSON.parse(fs.readFileSync(latestPath, 'utf8'));
    cachedVacantes = raw.vacantes || [];
    lastScanTime = raw.updatedAt || null;
  } catch (e) {}
}

async function runScan(triggerSource = 'manual') {
  if (isScanning) return { scanning: true, vacantes: cachedVacantes };
  isScanning = true;
  console.log(`[${new Date().toLocaleTimeString()}] Iniciando escaneo (${triggerSource})...`);

  try {
    const vacantes = await scrapeAll();
    cachedVacantes = vacantes;
    lastScanTime = new Date().toISOString();

    fs.writeFileSync(latestPath, JSON.stringify({
      updatedAt: lastScanTime,
      total: vacantes.length,
      vacantes
    }, null, 2), 'utf8');

    // Verificar Telegram si hay variables o configuración
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;
    const cacheFile = path.join(dataDir, 'seen_ids.json');
    let seenIds = [];
    if (fs.existsSync(cacheFile)) {
      try { seenIds = JSON.parse(fs.readFileSync(cacheFile, 'utf8')); } catch (e) {}
    }

    const deInteres = vacantes.filter(v => v.matchedCategory !== null);
    const nuevas = deInteres.filter(v => !seenIds.includes(v.id));

    if (nuevas.length > 0) {
      console.log(`📢 ${nuevas.length} nuevas vacantes detectadas de Inglés/Lengua`);
      if (botToken && chatId) {
        await sendTelegramNotification(botToken, chatId, nuevas);
      }
      const updatedIds = Array.from(new Set([...seenIds, ...nuevas.map(v => v.id)]));
      fs.writeFileSync(cacheFile, JSON.stringify(updatedIds, null, 2), 'utf8');
    }

    console.log(`[${new Date().toLocaleTimeString()}] Escaneo completado. Total: ${vacantes.length}`);
  } catch (err) {
    console.error('Error durante el escaneo:', err);
  } finally {
    isScanning = false;
  }

  return { scanning: false, lastScanTime, vacantes: cachedVacantes };
}

// Rutas de API
app.get('/api/sedes', (req, res) => {
  const sedesPath = path.join(__dirname, 'sedes_data.json');
  if (fs.existsSync(sedesPath)) {
    res.json(JSON.parse(fs.readFileSync(sedesPath, 'utf8')));
  } else {
    res.json([]);
  }
});

app.get('/api/vacantes', async (req, res) => {
  if (req.query.refresh === 'true' || cachedVacantes.length === 0) {
    const result = await runScan('api_request');
    return res.json({
      updatedAt: lastScanTime,
      total: result.vacantes.length,
      vacantes: result.vacantes
    });
  }

  res.json({
    updatedAt: lastScanTime,
    total: cachedVacantes.length,
    vacantes: cachedVacantes
  });
});

app.post('/api/telegram-test', async (req, res) => {
  const { botToken, chatId } = req.body;
  if (!botToken || !chatId) {
    return res.status(400).json({ success: false, error: 'Falta Bot Token o Chat ID' });
  }

  const testVacante = [{
    sede: 'Sede Santa Rosa',
    localidad: 'Santa Rosa',
    colegio: 'Colegio de Prueba Antigravity',
    materia: 'INGLÉS / LENGUA (Prueba de Configuración)',
    horas: '4',
    curso: '1º',
    division: 'I',
    turno: 'M',
    revista: 'INTERINO',
    sheetType: 'Propuestas',
    motivo: 'PRUEBA DE ALERTA',
    fechaDesignacion: new Date().toLocaleDateString('es-AR'),
    horarios: 'LU: 0800 0920 | MI: 1000 1120',
    linkSheet: 'https://educacion.lapampa.edu.ar/docentes/designaciones',
    linkVozPorVos: 'https://vozporvos.lapampa.edu.ar/'
  }];

  try {
    const ok = await sendTelegramNotification(botToken, chatId, testVacante);
    res.json({ success: ok, message: 'Mensaje de prueba enviado exitosamente a Telegram' });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.get('/api/status', (req, res) => {
  res.json({
    isScanning,
    lastScanTime,
    totalVacantes: cachedVacantes.length,
    defaultKeywords: DEFAULT_KEYWORDS
  });
});

// Cron programado: Cada 10 minutos de lunes a viernes entre las 07:00 y las 19:00 hs (hora local)
cron.schedule('*/10 7-19 * * 1-5', () => {
  console.log('⏰ Ejecutando escaneo automático programado...');
  runScan('cron_auto');
});

app.listen(PORT, () => {
  console.log(`🌐 Servidor de Designaciones iniciado en http://localhost:${PORT}`);
  // Si no hay vacantes en caché, correr primer escaneo en segundo plano
  if (cachedVacantes.length === 0) {
    runScan('startup');
  }
});
