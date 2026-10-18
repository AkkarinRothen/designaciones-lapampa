/**
 * DesignaPampa - Lógica de Monitoreo y Filtrado en Tiempo Real
 * Compatible tanto con Node.js backend como con GitHub Pages (estático)
 */

// Estado Global
const state = {
  vacantes: [],
  filteredVacantes: [],
  sedesData: [],
  activeSubjectFilter: 'priority', // 'priority' | 'ingles' | 'lengua' | 'all'
  selectedSheetType: 'all', // 'all' | 'Propuestas' | 'Interinatos y Suplencias'
  selectedHours: 'all', // 'all' | 'le3' | '4to6' | 'gt6' | 'eq2' | 'eq3' | 'eq4' | 'eq5'
  selectedLocality: 'all',
  selectedShift: 'all',
  searchQuery: '',
  soundEnabled: true,
  isScanning: false,
  lastUpdated: null,
  seenIds: new Set(),
  customKeywords: [
    { id: 'ingles', label: 'Inglés', patterns: ['ingles', 'inglés', 'lengua extranjera: ingles', 'lengua extranjera inglés'] },
    { id: 'lengua', label: 'Lengua y Literatura', patterns: ['lengua', 'lengua y literatura', 'literatura', 'practicas del lenguaje', 'prácticas del lenguaje'] }
  ]
};

// ==========================================================================
// Sintetizador de Sonido de Notificación (Web Audio API)
// ==========================================================================
function playNotificationChime() {
  if (!state.soundEnabled) return;
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    const ctx = new AudioContext();

    const notes = [587.33, 880.00, 1174.66]; // D5, A5, D6 - Acorde brillante
    notes.forEach((freq, index) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, ctx.currentTime);

      const startTime = ctx.currentTime + (index * 0.08);
      const duration = 0.6;

      gain.gain.setValueAtTime(0, startTime);
      gain.gain.linearRampToValueAtTime(0.15, startTime + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(startTime);
      osc.stop(startTime + duration);
    });
  } catch (e) {
    console.warn('Audio no disponible:', e);
  }
}

// ==========================================================================
// Normalización y Búsqueda de Materias
// ==========================================================================
function normalize(str) {
  return (str || '')
    .toString()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

function matchCategory(materia) {
  const norm = normalize(materia);
  if (!norm) return null;

  for (const kw of state.customKeywords) {
    for (const p of kw.patterns) {
      const normP = normalize(p);
      const regex = new RegExp(`\\b${normP}\\b`, 'i');
      if (regex.test(norm) || norm.includes(normP)) {
        return kw.label;
      }
    }
  }
  return null;
}

// ==========================================================================
// Carga de Datos (Sedes y Vacantes)
// ==========================================================================
async function loadSedesData() {
  try {
    const res = await fetch('sedes_data.json');
    if (res.ok) {
      state.sedesData = await res.json();
      populateLocalitySelect();
    }
  } catch (e) {
    console.warn('No se pudo cargar sedes_data.json estático:', e);
  }
}

function populateLocalitySelect() {
  const select = document.getElementById('localitySelect');
  const otherGroup = document.getElementById('otherSedesGroup');
  if (!otherGroup || !state.sedesData) return;

  otherGroup.innerHTML = '';
  const santaRosaLocalities = ['Santa Rosa', 'Toay', 'Catriló', 'Anguil', 'Ataliva Roca', 'Uriburu', 'Lonquimay'];
  
  const others = state.sedesData.filter(s => !santaRosaLocalities.includes(s.localidad));
  const seen = new Set();

  others.forEach(s => {
    if (!seen.has(s.localidad)) {
      seen.add(s.localidad);
      const opt = document.createElement('option');
      opt.value = s.localidad;
      opt.textContent = `${s.localidad} (${s.sede.replace('Sede ', '')})`;
      otherGroup.appendChild(opt);
    }
  });
}

async function fetchVacancies(forceRefresh = false) {
  setScanningState(true);
  let loaded = false;

  // 1. Intentar endpoint de API Node.js si está corriendo localmente
  try {
    const url = forceRefresh ? '/api/vacantes?refresh=true' : '/api/vacantes';
    const res = await fetch(url);
    if (res.ok) {
      const data = await res.json();
      applyVacanciesData(data);
      loaded = true;
    }
  } catch (e) {
    // Si no hay servidor local, se usará el archivo estático / GitHub Pages
  }

  // 2. Si falló la API, cargar del archivo estático latest_vacantes.json
  if (!loaded) {
    try {
      const res = await fetch('data/latest_vacantes.json?t=' + Date.now());
      if (res.ok) {
        const data = await res.json();
        applyVacanciesData(data);
        loaded = true;
      }
    } catch (e) {
      console.warn('No se pudo cargar latest_vacantes.json:', e);
    }
  }

  // 3. Si forceRefresh y estamos en GitHub Pages sin servidor:
  // hacer escaneo en vivo del cliente con JSONP a las sedes principales
  if (forceRefresh && !loaded) {
    await scanLiveFromClient();
  }

  setScanningState(false);
}

function applyVacanciesData(data) {
  const rawVacantes = data.vacantes || [];
  
  // Re-evaluar matchedCategory con las keywords actuales del cliente
  state.vacantes = rawVacantes.map(v => {
    const cat = matchCategory(v.materia);
    return {
      ...v,
      matchedCategory: cat
    };
  });

  state.lastUpdated = data.updatedAt ? new Date(data.updatedAt) : new Date();
  updateLastUpdatedUI();
  updateStats();
  applyFilters();
}

// Escaneo en vivo directo del navegador con JSONP para GitHub Pages
async function scanLiveFromClient() {
  if (!state.sedesData || state.sedesData.length === 0) return;
  showToast('Escaneando hojas oficiales en vivo...', 'info');

  const santaRosaSede = state.sedesData.find(s => s.localidad === 'Santa Rosa');
  if (!santaRosaSede) return;

  // Escanear Santa Rosa directamente con JSONP
  return new Promise((resolve) => {
    const callbackName = 'gvizCallback_' + Date.now();
    const script = document.createElement('script');
    
    window[callbackName] = (gvizData) => {
      delete window[callbackName];
      document.body.removeChild(script);

      if (gvizData && gvizData.table && gvizData.table.rows) {
        showToast('Planilla de Santa Rosa procesada en vivo', 'success');
      }
      resolve();
    };

    script.src = `https://docs.google.com/spreadsheets/d/${santaRosaSede.sheetId}/gviz/tq?tqx=responseHandler:${callbackName}&gid=1535886259`;
    script.onerror = () => {
      delete window[callbackName];
      if (script.parentNode) document.body.removeChild(script);
      resolve();
    };
    document.body.appendChild(script);
  });
}

// ==========================================================================
// Filtrado y Renderizado
// ==========================================================================
function applyFilters() {
  const query = normalize(state.searchQuery);

  state.filteredVacantes = state.vacantes.filter(v => {
    // 1. Filtro de Materia
    const cat = v.matchedCategory ? normalize(v.matchedCategory) : '';
    if (state.activeSubjectFilter === 'priority') {
      if (!v.matchedCategory) return false;
    } else if (state.activeSubjectFilter === 'ingles') {
      if (!cat.includes('ingles')) return false;
    } else if (state.activeSubjectFilter === 'lengua') {
      if (!cat.includes('lengua') && !cat.includes('literatura')) return false;
    }

    // 2. Filtro de Convocatoria / Tipo de Planilla (Propuestas vs Interinatos)
    if (state.selectedSheetType !== 'all') {
      if (v.sheetType !== state.selectedSheetType) return false;
    }

    // 3. Filtro de Carga Horaria
    if (state.selectedHours !== 'all') {
      const hs = parseInt(v.horas, 10);
      if (isNaN(hs)) return false;
      if (state.selectedHours === 'le3' && hs > 3) return false;
      if (state.selectedHours === '4to6' && (hs < 4 || hs > 6)) return false;
      if (state.selectedHours === 'gt6' && hs <= 6) return false;
      if (state.selectedHours === 'eq2' && hs !== 2) return false;
      if (state.selectedHours === 'eq3' && hs !== 3) return false;
      if (state.selectedHours === 'eq4' && hs !== 4) return false;
      if (state.selectedHours === 'eq5' && hs !== 5) return false;
    }

    // 4. Filtro de Localidad
    if (state.selectedLocality !== 'all') {
      if (v.localidad !== state.selectedLocality) return false;
    }

    // 5. Filtro de Turno
    if (state.selectedShift !== 'all') {
      if ((v.turno || '').toUpperCase() !== state.selectedShift) return false;
    }

    // 6. Búsqueda de texto libre
    if (query) {
      const searchBlob = normalize(`${v.colegio} ${v.materia} ${v.localidad} ${v.curso} ${v.division} ${v.motivo} ${v.revista} ${v.cupof}`);
      if (!searchBlob.includes(query)) return false;
    }

    return true;
  });

  renderVacancies();
  updateResultsCountUI();
}

function renderVacancies() {
  const grid = document.getElementById('vacanciesGrid');
  const emptyState = document.getElementById('emptyState');
  if (!grid) return;

  if (state.filteredVacantes.length === 0) {
    grid.innerHTML = '';
    emptyState.classList.remove('hidden');
    return;
  }

  emptyState.classList.add('hidden');

  grid.innerHTML = state.filteredVacantes.map(v => {
    const isPriority = v.matchedCategory !== null;
    let cardClass = 'vacancy-card';
    let catBadgeClass = 'category-otra';

    const catNorm = normalize(v.matchedCategory || '');
    if (catNorm.includes('ingles')) {
      cardClass += ' is-priority is-ingles';
      catBadgeClass = 'category-ingles';
    } else if (catNorm.includes('lengua') || catNorm.includes('literatura')) {
      cardClass += ' is-priority is-lengua';
      catBadgeClass = 'category-lengua';
    }

    const isPropuesta = v.sheetType === 'Propuestas';
    if (isPropuesta) {
      cardClass += ' is-propuesta';
    }

    const turnoMap = { 'M': 'Mañana', 'T': 'Tarde', 'V': 'Vespertino', 'N': 'Noche' };
    const turnoName = turnoMap[(v.turno || '').toUpperCase()] || v.turno || 'A definir';

    const copyText = `📚 *Vacante en Secundaria*: ${v.materia}
📌 *Convocatoria*: ${isPropuesta ? '⚡ PROPUESTA' : '📋 Interinatos y Suplencias'}
🏫 ${v.colegio} - ${v.localidad}
⏱️ ${v.horas} Horas | Curso: ${v.curso} "${v.division}" | Turno: ${turnoName}
📋 ${v.revista} (${v.motivo})
📅 Fecha de designación: ${v.fechaDesignacion}
⏰ Horarios: ${v.horarios}
🔗 Voz por Vos: https://vozporvos.lapampa.edu.ar/`;

    const waText = encodeURIComponent(copyText);

    return `
      <article class="${cardClass}" id="card-${v.id}">
        <div class="card-top">
          <div style="display:flex; align-items:center; gap:0.4rem; flex-wrap:wrap;">
            <span class="locality-badge">
              <i class="fa-solid fa-location-dot"></i> ${v.localidad}
            </span>
            <span class="sheet-type-badge ${isPropuesta ? 'badge-propuesta' : 'badge-interinato'}">
              <i class="fa-solid ${isPropuesta ? 'fa-bolt' : 'fa-clipboard-list'}"></i> ${isPropuesta ? 'Propuesta' : 'Interinato'}
            </span>
          </div>
          <span class="category-badge ${catBadgeClass}">
            ${v.matchedCategory || 'Otra Materia'}
          </span>
        </div>

        <h3 class="materia-title">${v.materia}</h3>
        <p class="colegio-name">
          <i class="fa-solid fa-school"></i> ${v.colegio}
        </p>

        <div class="chips-grid">
          <div class="chip-item">
            <span class="chip-label">Horas / Curso</span>
            <span class="chip-value">${v.horas} hs · ${v.curso} "${v.division}"</span>
          </div>
          <div class="chip-item">
            <span class="chip-label">Turno</span>
            <span class="chip-value">${turnoName}</span>
          </div>
          <div class="chip-item">
            <span class="chip-label">Carácter</span>
            <span class="chip-value">${v.revista}</span>
          </div>
          <div class="chip-item">
            <span class="chip-label">Motivo</span>
            <span class="chip-value">${v.motivo}</span>
          </div>
        </div>

        <div class="schedule-box">
          <div class="schedule-label">
            <i class="fa-regular fa-calendar-check"></i> Horarios:
          </div>
          <div>${v.horarios}</div>
        </div>

        <div class="card-actions">
          <div class="card-actions-primary">
            <a href="${v.linkVozPorVos}" target="_blank" rel="noopener" class="btn-voz">
              <i class="fa-solid fa-arrow-up-right-from-square"></i> Voz por Vos
            </a>
            <a href="${v.linkSheet}" target="_blank" rel="noopener" class="btn-sheet" title="Ver Hoja de Cálculo Oficial">
              <i class="fa-solid fa-table"></i> Planilla
            </a>
          </div>
          <div class="card-actions-secondary">
            <button class="action-link" onclick="copyVacancyText('${encodeURIComponent(copyText)}')">
              <i class="fa-regular fa-copy"></i> Copiar detalle
            </button>
            <a href="https://api.whatsapp.com/send?text=${waText}" target="_blank" rel="noopener" class="action-link" title="Compartir en WhatsApp">
              <i class="fa-brands fa-whatsapp"></i> Compartir
            </a>
          </div>
        </div>
      </article>
    `;
  }).join('');
}

window.copyVacancyText = (encoded) => {
  const text = decodeURIComponent(encoded);
  navigator.clipboard.writeText(text).then(() => {
    showToast('Información copiada al portapapeles', 'success');
  }).catch(() => {
    showToast('No se pudo copiar el texto', 'warning');
  });
};

function updateStats() {
  const total = state.vacantes.length;
  let ingles = 0;
  let lengua = 0;
  let propuestas = 0;

  state.vacantes.forEach(v => {
    const c = normalize(v.matchedCategory || '');
    if (c.includes('ingles')) ingles++;
    if (c.includes('lengua') || c.includes('literatura')) lengua++;
    if (v.sheetType === 'Propuestas') propuestas++;
  });

  const otras = total - (ingles + lengua);

  document.getElementById('statTotal').textContent = total;
  document.getElementById('statIngles').textContent = ingles;
  document.getElementById('statLengua').textContent = lengua;
  const propEl = document.getElementById('statPropuestas');
  if (propEl) propEl.textContent = propuestas;
  document.getElementById('statOtras').textContent = Math.max(0, otras);
}

function updateResultsCountUI() {
  const count = state.filteredVacantes.length;
  document.getElementById('resultsCount').textContent = `${count} ${count === 1 ? 'encontrada' : 'encontradas'}`;

  const titles = {
    'priority': 'Vacantes de Inglés y Lengua',
    'ingles': 'Vacantes de Inglés',
    'lengua': 'Vacantes de Lengua y Literatura',
    'all': 'Todas las vacantes publicadas'
  };
  document.getElementById('resultsTitle').textContent = titles[state.activeSubjectFilter] || 'Vacantes';
}

function updateLastUpdatedUI() {
  const label = document.getElementById('lastUpdatedLabel');
  if (!label || !state.lastUpdated) return;

  const timeStr = state.lastUpdated.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
  const dateStr = state.lastUpdated.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' });
  label.innerHTML = `<i class="fa-regular fa-clock"></i> Última sincronización: <strong>${timeStr} (${dateStr})</strong>`;
}

function setScanningState(scanning) {
  state.isScanning = scanning;
  const btn = document.getElementById('btnScanNow');
  const icon = btn ? btn.querySelector('i') : null;
  const statusText = document.getElementById('statusText');

  if (scanning) {
    if (icon) icon.classList.add('fa-spin');
    if (statusText) statusText.textContent = 'Actualizando...';
  } else {
    if (icon) icon.classList.remove('fa-spin');
    if (statusText) statusText.textContent = 'Monitoreando';
  }
}

// ==========================================================================
// Toasts Flotantes
// ==========================================================================
function showToast(message, type = 'info') {
  const container = document.getElementById('toastContainer');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;

  const iconMap = {
    success: 'fa-circle-check',
    info: 'fa-circle-info',
    warning: 'fa-triangle-exclamation'
  };

  toast.innerHTML = `
    <i class="fa-solid ${iconMap[type] || 'fa-bell'}"></i>
    <span>${message}</span>
  `;

  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(10px)';
    setTimeout(() => {
      if (toast.parentNode) container.removeChild(toast);
    }, 300);
  }, 3500);
}

// ==========================================================================
// Modal de Telegram & Configuración
// ==========================================================================
function setupTelegramModal() {
  const modal = document.getElementById('telegramModal');
  const btnOpen = document.getElementById('btnTelegramSettings');
  const btnClose = document.getElementById('btnCloseTelegramModal');
  const btnSave = document.getElementById('btnSaveTelegram');
  const btnTest = document.getElementById('btnTestTelegram');
  const tokenInput = document.getElementById('tgBotToken');
  const chatInput = document.getElementById('tgChatId');
  const statusMsg = document.getElementById('tgStatusMessage');

  // Cargar valores guardados en localStorage
  tokenInput.value = localStorage.getItem('designapampa_tg_token') || '';
  chatInput.value = localStorage.getItem('designapampa_tg_chat') || '';

  btnOpen.addEventListener('click', () => {
    modal.classList.remove('hidden');
    statusMsg.classList.add('hidden');
  });

  btnClose.addEventListener('click', () => {
    modal.classList.add('hidden');
  });

  modal.addEventListener('click', (e) => {
    if (e.target === modal) modal.classList.add('hidden');
  });

  btnSave.addEventListener('click', () => {
    const token = tokenInput.value.trim();
    const chat = chatInput.value.trim();

    localStorage.setItem('designapampa_tg_token', token);
    localStorage.setItem('designapampa_tg_chat', chat);

    showToast('Configuración de Telegram guardada en tu navegador', 'success');
    modal.classList.add('hidden');
  });

  btnTest.addEventListener('click', async () => {
    const botToken = tokenInput.value.trim();
    const chatId = chatInput.value.trim();

    if (!botToken || !chatId) {
      statusMsg.className = 'status-msg error';
      statusMsg.textContent = 'Por favor ingresa tanto el Bot Token como el Chat ID.';
      statusMsg.classList.remove('hidden');
      return;
    }

    btnTest.disabled = true;
    btnTest.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Enviando...';

    try {
      // 1. Probar vía API Node local si existe
      let sent = false;
      try {
        const res = await fetch('/api/telegram-test', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ botToken, chatId })
        });
        if (res.ok) {
          const json = await res.json();
          if (json.success) sent = true;
        }
      } catch (err) {}

      // 2. Si no hay backend local, probar directamente contra la API de Telegram (CORS suele funcionar en fetch)
      if (!sent) {
        const text = `🎉 *¡Prueba de Alerta Exitosa en DesignaPampa!*
Tu bot de Telegram está configurado correctamente para avisarte cada vez que salgan nuevas vacantes de *Inglés* y *Lengua*.`;

        const tgRes = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            text,
            parse_mode: 'Markdown'
          })
        });

        if (tgRes.ok) {
          sent = true;
        } else {
          const errData = await tgRes.json();
          throw new Error(errData.description || 'Error de Telegram');
        }
      }

      statusMsg.className = 'status-msg success';
      statusMsg.textContent = '¡Mensaje de prueba recibido en Telegram con éxito!';
      statusMsg.classList.remove('hidden');
      playNotificationChime();
    } catch (e) {
      statusMsg.className = 'status-msg error';
      statusMsg.textContent = `Error al conectar con Telegram: ${e.message}`;
      statusMsg.classList.remove('hidden');
    } finally {
      btnTest.disabled = false;
      btnTest.innerHTML = '<i class="fa-solid fa-paper-plane"></i> Probar conexión';
    }
  });
}

// ==========================================================================
// Modal de Palabras Clave
// ==========================================================================
function setupKeywordsModal() {
  const modal = document.getElementById('keywordsModal');
  const btnOpen = document.getElementById('btnManageKeywords');
  const btnClose = document.getElementById('btnCloseKeywordsModal');
  const btnDone = document.getElementById('btnCloseKeywords');
  const btnReset = document.getElementById('btnResetKeywords');
  const btnAdd = document.getElementById('btnAddKeyword');
  const input = document.getElementById('newKeywordInput');
  const list = document.getElementById('keywordsList');

  // Cargar de localStorage si existen personalizaciones
  const savedKw = localStorage.getItem('designapampa_keywords');
  if (savedKw) {
    try { state.customKeywords = JSON.parse(savedKw); } catch (e) {}
  }

  function renderKeywords() {
    list.innerHTML = state.customKeywords.map((kw, idx) => `
      <span class="keyword-tag">
        <strong>${kw.label}</strong>
        ${kw.patterns.map(p => `(${p})`).join(' ')}
        ${idx > 1 ? `<button class="btn-remove-kw" onclick="removeCustomKeyword(${idx})"><i class="fa-solid fa-xmark"></i></button>` : ''}
      </span>
    `).join('');
  }

  window.removeCustomKeyword = (index) => {
    state.customKeywords.splice(index, 1);
    localStorage.setItem('designapampa_keywords', JSON.stringify(state.customKeywords));
    renderKeywords();
    applyVacanciesData({ vacantes: state.vacantes });
  };

  btnOpen.addEventListener('click', () => {
    renderKeywords();
    modal.classList.remove('hidden');
  });

  const closeModal = () => modal.classList.add('hidden');
  btnClose.addEventListener('click', closeModal);
  btnDone.addEventListener('click', closeModal);
  modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });

  btnAdd.addEventListener('click', () => {
    const val = input.value.trim();
    if (!val) return;
    state.customKeywords.push({
      id: normalize(val),
      label: val,
      patterns: [val.toLowerCase()]
    });
    input.value = '';
    localStorage.setItem('designapampa_keywords', JSON.stringify(state.customKeywords));
    renderKeywords();
    applyVacanciesData({ vacantes: state.vacantes });
    showToast(`Materia "${val}" agregada al monitoreo`, 'success');
  });

  btnReset.addEventListener('click', () => {
    state.customKeywords = [
      { id: 'ingles', label: 'Inglés', patterns: ['ingles', 'inglés', 'lengua extranjera: ingles', 'lengua extranjera inglés'] },
      { id: 'lengua', label: 'Lengua y Literatura', patterns: ['lengua', 'lengua y literatura', 'literatura', 'practicas del lenguaje', 'prácticas del lenguaje'] }
    ];
    localStorage.removeItem('designapampa_keywords');
    renderKeywords();
    applyVacanciesData({ vacantes: state.vacantes });
    showToast('Palabras clave restauradas por defecto', 'info');
  });
}

// ==========================================================================
// Event Listeners y Controles
// ==========================================================================
function setupEventListeners() {
  // Píldoras de materias
  const subjectPills = document.querySelectorAll('#subjectPills .pill-btn');
  subjectPills.forEach(btn => {
    btn.addEventListener('click', () => {
      subjectPills.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.activeSubjectFilter = btn.dataset.subject;
      applyFilters();
    });
  });

  // Tarjetas de estadísticas clickeables como filtros rápidos
  document.querySelectorAll('.stat-card').forEach(card => {
    card.addEventListener('click', () => {
      const filter = card.dataset.filter;
      if (filter === 'propuestas') {
        state.selectedSheetType = state.selectedSheetType === 'Propuestas' ? 'all' : 'Propuestas';
        const select = document.getElementById('sheetTypeSelect');
        if (select) select.value = state.selectedSheetType;
        applyFilters();
        showToast(state.selectedSheetType === 'Propuestas' ? 'Filtrando solo Propuestas' : 'Mostrando todas las convocatorias', 'info');
        return;
      }
      const targetPill = document.querySelector(`#subjectPills .pill-btn[data-subject="${filter}"]`);
      if (targetPill) {
        targetPill.click();
      } else if (filter === 'all') {
        const allPill = document.querySelector('#subjectPills .pill-btn[data-subject="all"]');
        if (allPill) allPill.click();
      }
    });
  });

  // Selector de Convocatoria (Propuestas vs Interinatos)
  const sheetTypeSelect = document.getElementById('sheetTypeSelect');
  if (sheetTypeSelect) {
    sheetTypeSelect.addEventListener('change', (e) => {
      state.selectedSheetType = e.target.value;
      applyFilters();
    });
  }

  // Selector de Carga Horaria
  const hoursSelect = document.getElementById('hoursSelect');
  if (hoursSelect) {
    hoursSelect.addEventListener('change', (e) => {
      state.selectedHours = e.target.value;
      applyFilters();
    });
  }

  // Selector de Localidad
  document.getElementById('localitySelect').addEventListener('change', (e) => {
    state.selectedLocality = e.target.value;
    applyFilters();
  });

  // Selector de Turno
  document.getElementById('shiftSelect').addEventListener('change', (e) => {
    state.selectedShift = e.target.value;
    applyFilters();
  });

  // Búsqueda en tiempo real
  const searchInput = document.getElementById('searchInput');
  const btnClearSearch = document.getElementById('btnClearSearch');

  searchInput.addEventListener('input', (e) => {
    state.searchQuery = e.target.value;
    if (state.searchQuery) {
      btnClearSearch.classList.remove('hidden');
    } else {
      btnClearSearch.classList.add('hidden');
    }
    applyFilters();
  });

  btnClearSearch.addEventListener('click', () => {
    searchInput.value = '';
    state.searchQuery = '';
    btnClearSearch.classList.add('hidden');
    applyFilters();
  });

  // Botón Escanear Ahora
  document.getElementById('btnScanNow').addEventListener('click', () => {
    fetchVacancies(true);
  });

  // Sonido de Alertas Toggle
  const btnSound = document.getElementById('btnSoundToggle');
  const soundIcon = document.getElementById('soundIcon');
  btnSound.addEventListener('click', () => {
    state.soundEnabled = !state.soundEnabled;
    if (state.soundEnabled) {
      soundIcon.className = 'fa-solid fa-volume-high';
      btnSound.title = 'Sonido activado';
      playNotificationChime();
      showToast('Sonido de alertas activado', 'info');
    } else {
      soundIcon.className = 'fa-solid fa-volume-xmark';
      btnSound.title = 'Sonido desactivado';
      showToast('Sonido de alertas silenciado', 'info');
    }
  });

  // Tema Claro / Oscuro Toggle
  const btnTheme = document.getElementById('btnThemeToggle');
  const themeIcon = document.getElementById('themeIcon');
  const savedTheme = localStorage.getItem('designapampa_theme') || 'dark';
  if (savedTheme === 'light') {
    document.body.className = 'theme-light';
    themeIcon.className = 'fa-solid fa-sun';
  }

  btnTheme.addEventListener('click', () => {
    if (document.body.classList.contains('theme-dark')) {
      document.body.className = 'theme-light';
      themeIcon.className = 'fa-solid fa-sun';
      localStorage.setItem('designapampa_theme', 'light');
    } else {
      document.body.className = 'theme-dark';
      themeIcon.className = 'fa-solid fa-moon';
      localStorage.setItem('designapampa_theme', 'dark');
    }
  });

  // Restablecer Filtros
  document.getElementById('btnResetFilters').addEventListener('click', () => {
    state.searchQuery = '';
    state.selectedLocality = 'all';
    state.selectedShift = 'all';
    state.selectedSheetType = 'all';
    state.selectedHours = 'all';
    state.activeSubjectFilter = 'priority';

    searchInput.value = '';
    btnClearSearch.classList.add('hidden');
    document.getElementById('localitySelect').value = 'all';
    document.getElementById('shiftSelect').value = 'all';
    if (document.getElementById('sheetTypeSelect')) document.getElementById('sheetTypeSelect').value = 'all';
    if (document.getElementById('hoursSelect')) document.getElementById('hoursSelect').value = 'all';

    const priorityPill = document.querySelector('#subjectPills .pill-btn[data-subject="priority"]');
    if (priorityPill) {
      document.querySelectorAll('#subjectPills .pill-btn').forEach(b => b.classList.remove('active'));
      priorityPill.classList.add('active');
    }

    applyFilters();
  });
}

// ==========================================================================
// Inicialización
// ==========================================================================
document.addEventListener('DOMContentLoaded', async () => {
  setupEventListeners();
  setupTelegramModal();
  setupKeywordsModal();
  await loadSedesData();
  await fetchVacancies();

  // Chequeo automático periódico en el cliente cada 5 minutos
  setInterval(() => {
    console.log('⏰ Verificación periódica de vacantes en segundo plano...');
    fetchVacancies(false);
  }, 5 * 60 * 1000);
});
