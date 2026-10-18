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
  activeTab: 'designaciones', // 'designaciones' | 'redpam'
  redpamCourses: [],
  filteredRedpamCourses: [],
  redpamFilters: {
    category: 'all', // 'all' | 'ingles' | 'lengua' | 'esi' | 'inclusion'
    level: 'all',    // 'all' | 'Secundario' | 'Primario' | 'Inicial' | 'Superior'
    modality: 'all', // 'all' | 'Virtual' | 'Presencial' | 'Semipresencial'
    cost: 'all',     // 'all' | 'Gratuito' | 'Arancelado'
    search: ''
  },
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
  const badgeDesig = document.getElementById('badgeDesignacionesCount');
  if (badgeDesig) badgeDesig.textContent = total;
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
// Módulo RedPam: Carga, Filtrado y Renderizado
// ==========================================================================
async function fetchRedPamCourses(forceRefresh = false) {
  let loaded = false;

  // 1. Intentar endpoint de API Node.js si está corriendo el servidor
  try {
    const url = forceRefresh ? '/api/redpam?refresh=true' : '/api/redpam';
    const res = await fetch(url);
    if (res.ok) {
      const data = await res.json();
      applyRedPamData(data);
      loaded = true;
    }
  } catch (e) {
    // Si no hay API backend, usar archivo estático
  }

  // 2. Si falló la API, cargar del archivo estático data/latest_redpam.json
  if (!loaded) {
    try {
      const res = await fetch('data/latest_redpam.json?t=' + Date.now());
      if (res.ok) {
        const data = await res.json();
        applyRedPamData(data);
        loaded = true;
      }
    } catch (e) {
      console.warn('No se pudo cargar data/latest_redpam.json:', e);
    }
  }
}

function applyRedPamData(data) {
  state.redpamCourses = data.courses || [];
  updateRedPamStats();
  applyRedPamFilters();
}

function updateRedPamStats() {
  const total = state.redpamCourses.length;
  let gratis = 0;
  let virtual = 0;
  let secundario = 0;

  state.redpamCourses.forEach(c => {
    const oferta = normalize(c.tipoOferta || '');
    const mod = normalize(c.modalidad || '');
    const niv = normalize(c.niveles || '');

    if (oferta.includes('gratis') || oferta.includes('gratuito')) gratis++;
    if (mod.includes('virtual') || mod.includes('distancia')) virtual++;
    if (niv.includes('secundari')) secundario++;
  });

  const statTotal = document.getElementById('statRedpamTotal');
  if (statTotal) statTotal.textContent = total;
  const statGratis = document.getElementById('statRedpamGratis');
  if (statGratis) statGratis.textContent = gratis;
  const statVirtual = document.getElementById('statRedpamVirtual');
  if (statVirtual) statVirtual.textContent = virtual;
  const statSecundario = document.getElementById('statRedpamSecundario');
  if (statSecundario) statSecundario.textContent = secundario;

  const badgeRedpam = document.getElementById('badgeRedpamCount');
  if (badgeRedpam) badgeRedpam.textContent = total;
}

function applyRedPamFilters() {
  const q = normalize(state.redpamFilters.search);

  state.filteredRedpamCourses = state.redpamCourses.filter(c => {
    // 1. Filtro temático de pills
    if (state.redpamFilters.category !== 'all') {
      const target = state.redpamFilters.category;
      const titleNorm = normalize(c.title);
      const destNorm = normalize(c.destinatarios);

      if (target === 'ingles' && !titleNorm.includes('ingles') && !destNorm.includes('ingles')) return false;
      if (target === 'lengua' && !titleNorm.includes('lengua') && !titleNorm.includes('literatura')) return false;
      if (target === 'esi' && !titleNorm.includes('esi') && !titleNorm.includes('sexualidad') && !titleNorm.includes('genero')) return false;
      if (target === 'inclusion' && !titleNorm.includes('inclusi') && !titleNorm.includes('diversidad')) return false;
    }

    // 2. Filtro de Nivel
    if (state.redpamFilters.level !== 'all') {
      const nivNorm = normalize(c.niveles);
      if (!nivNorm.includes(normalize(state.redpamFilters.level))) return false;
    }

    // 3. Filtro de Modalidad
    if (state.redpamFilters.modality !== 'all') {
      const modNorm = normalize(c.modalidad);
      if (!modNorm.includes(normalize(state.redpamFilters.modality))) return false;
    }

    // 4. Filtro de Costo
    if (state.redpamFilters.cost !== 'all') {
      const costNorm = normalize(c.tipoOferta);
      if (state.redpamFilters.cost === 'Gratuito' && !costNorm.includes('gratuito') && !costNorm.includes('gratis')) return false;
      if (state.redpamFilters.cost === 'Arancelado' && !costNorm.includes('arancelado')) return false;
    }

    // 5. Búsqueda por texto libre
    if (q) {
      const fullText = normalize(`${c.title} ${c.oferente} ${c.niveles} ${c.destinatarios} ${c.modalidad}`);
      if (!fullText.includes(q)) return false;
    }

    return true;
  });

  renderRedPamCourses();
  updateRedPamCountUI();
}

function renderRedPamCourses() {
  const grid = document.getElementById('redpamGrid');
  const emptyState = document.getElementById('emptyStateRedpam');
  if (!grid) return;

  if (state.filteredRedpamCourses.length === 0) {
    grid.innerHTML = '';
    if (emptyState) emptyState.classList.remove('hidden');
    return;
  }

  if (emptyState) emptyState.classList.add('hidden');

  grid.innerHTML = state.filteredRedpamCourses.map(c => {
    const ofertaNorm = normalize(c.tipoOferta || '');
    const isGratis = ofertaNorm.includes('gratis') || ofertaNorm.includes('gratuito');
    const costBadgeClass = isGratis ? 'badge-cost-gratis' : 'badge-cost-arancelado';
    const isOficial = normalize(c.valoracion || '').includes('oficial');

    return `
      <article class="course-card" id="course-${c.id}">
        <div class="course-card-image-wrap">
          <img src="${c.img}" alt="${c.title}" class="course-card-image" loading="lazy" onerror="this.onerror=null;this.src='https://redpam.lapampa.edu.ar/images/Roles-V%C3%ADnculos-ESI.jpg';">
          <div class="course-card-badges">
            <span class="badge-cost ${costBadgeClass}">
              <i class="fa-solid ${isGratis ? 'fa-gift' : 'fa-tag'}"></i> ${c.tipoOferta || (isGratis ? 'Gratuito' : 'Arancelado')}
            </span>
            ${isOficial ? '<span class="badge-official"><i class="fa-solid fa-award"></i> Oficial</span>' : ''}
          </div>
        </div>

        <div class="course-card-body">
          <div class="course-oferente-tag">
            <i class="fa-solid fa-university"></i> ${c.oferente || 'RedPam'}
          </div>

          <h3 class="course-title" title="${c.title}">${c.title}</h3>

          <div class="course-meta-tags">
            <span class="course-tag course-tag-highlight">
              <i class="fa-solid fa-laptop"></i> ${c.modalidad || 'Virtual'}
            </span>
            <span class="course-tag">
              <i class="fa-solid fa-clock"></i> ${c.horas || 'Horas a certificar'}
            </span>
            ${c.fecha ? `<span class="course-tag"><i class="fa-regular fa-calendar"></i> ${c.fecha}</span>` : ''}
          </div>

          <div class="course-details-box">
            <div class="course-detail-row">
              <strong><i class="fa-solid fa-school"></i> Niveles:</strong>
              <span title="${c.niveles}">${c.niveles || 'Todos'}</span>
            </div>
            <div class="course-detail-row">
              <strong><i class="fa-solid fa-users"></i> Destinatarios:</strong>
              <span title="${c.destinatarios}">${c.destinatarios || 'Docentes en general'}</span>
            </div>
          </div>

          <div class="course-card-footer">
            <a href="${c.link}" target="_blank" rel="noopener" class="btn-enroll">
              <span>Ver detalles e inscripción</span>
              <i class="fa-solid fa-arrow-up-right-from-square"></i>
            </a>
          </div>
        </div>
      </article>
    `;
  }).join('');
}

function updateRedPamCountUI() {
  const count = state.filteredRedpamCourses.length;
  const countEl = document.getElementById('redpamResultsCount');
  if (countEl) {
    countEl.textContent = `${count} ${count === 1 ? 'propuesta encontrada' : 'propuestas encontradas'}`;
  }
}

function switchTab(tabName) {
  state.activeTab = tabName;
  const tabBtnDesig = document.getElementById('tabDesignaciones');
  const tabBtnRedpam = document.getElementById('tabRedpam');
  const secDesig = document.getElementById('sectionDesignaciones');
  const secRedpam = document.getElementById('sectionRedpam');

  if (tabName === 'designaciones') {
    if (tabBtnDesig) tabBtnDesig.classList.add('active');
    if (tabBtnRedpam) tabBtnRedpam.classList.remove('active');
    if (secDesig) secDesig.classList.remove('hidden');
    if (secRedpam) secRedpam.classList.add('hidden');
  } else {
    if (tabBtnRedpam) tabBtnRedpam.classList.add('active');
    if (tabBtnDesig) tabBtnDesig.classList.remove('active');
    if (secRedpam) secRedpam.classList.remove('hidden');
    if (secDesig) secDesig.classList.add('hidden');
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

  // Enviar vacantes vigentes ahora
  const btnSendCurrent = document.getElementById('btnSendCurrentVacancies');
  if (btnSendCurrent) {
    btnSendCurrent.addEventListener('click', async () => {
      const botToken = tokenInput.value.trim();
      const chatId = chatInput.value.trim();

      if (!botToken || !chatId) {
        statusMsg.className = 'status-msg error';
        statusMsg.textContent = 'Por favor ingresa primero tu Bot Token y tu Chat ID.';
        statusMsg.classList.remove('hidden');
        return;
      }

      // Vacantes de interés (Inglés y Lengua)
      const vacantesToSend = state.vacantes.filter(v => v.matchedCategory !== null);
      if (vacantesToSend.length === 0) {
        statusMsg.className = 'status-msg error';
        statusMsg.textContent = 'No hay vacantes vigentes de Inglés o Lengua en este momento para enviar.';
        statusMsg.classList.remove('hidden');
        return;
      }

      btnSendCurrent.disabled = true;
      btnSendCurrent.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Enviando vacantes...';

      try {
        let sentCount = 0;
        for (const v of vacantesToSend) {
          const turnoMap = { 'M': 'Mañana', 'T': 'Tarde', 'V': 'Vespertino', 'N': 'Noche' };
          const turnoLabel = turnoMap[(v.turno || '').toUpperCase()] || v.turno;
          const isPropuesta = v.sheetType === 'Propuestas';
          const tipoHeader = isPropuesta ? '⚡ *¡PROPUESTA EN SECUNDARIA (Vigente)!*' : '🔔 *¡Designación Activa (Interinatos y Suplencias)!*';
          const tipoBadge = isPropuesta ? '🏷️ *PROPUESTA*' : '📋 *INTERINATOS Y SUPLENCIAS*';

          const text = `${tipoHeader}

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

          const tgRes = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: chatId,
              text,
              parse_mode: 'Markdown',
              disable_web_page_preview: true
            })
          });

          if (tgRes.ok) {
            sentCount++;
          } else {
            const errData = await tgRes.json();
            throw new Error(errData.description || 'Error al enviar a Telegram');
          }

          // Breve pausa para no saturar rate limit
          await new Promise(r => setTimeout(r, 400));
        }

        statusMsg.className = 'status-msg success';
        statusMsg.textContent = `¡Listo! Se enviaron las ${sentCount} vacantes vigentes con éxito a tu Telegram.`;
        statusMsg.classList.remove('hidden');
        playNotificationChime();
        showToast(`Se enviaron ${sentCount} vacantes a Telegram`, 'success');
      } catch (e) {
        statusMsg.className = 'status-msg error';
        statusMsg.textContent = `Error al enviar vacantes: ${e.message}`;
        statusMsg.classList.remove('hidden');
      } finally {
        btnSendCurrent.disabled = false;
        btnSendCurrent.innerHTML = '<i class="fa-solid fa-bolt"></i> Enviar vacantes vigentes ahora';
      }
    });
  }
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

  // Pestañas Principales (Secundaria vs RedPam)
  const tabDesig = document.getElementById('tabDesignaciones');
  const tabRedpam = document.getElementById('tabRedpam');
  if (tabDesig) tabDesig.addEventListener('click', () => switchTab('designaciones'));
  if (tabRedpam) tabRedpam.addEventListener('click', () => switchTab('redpam'));

  // RedPam: Filtro de Categoría (Pills)
  const redpamPills = document.querySelectorAll('#redpamCategoryPills .pill-btn');
  redpamPills.forEach(btn => {
    btn.addEventListener('click', () => {
      redpamPills.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.redpamFilters.category = btn.getAttribute('data-redpam-category');
      applyRedPamFilters();
    });
  });

  // RedPam: Filtro de Nivel
  const redpamLevel = document.getElementById('redpamLevelSelect');
  if (redpamLevel) {
    redpamLevel.addEventListener('change', (e) => {
      state.redpamFilters.level = e.target.value;
      applyRedPamFilters();
    });
  }

  // RedPam: Filtro de Modalidad
  const redpamModality = document.getElementById('redpamModalitySelect');
  if (redpamModality) {
    redpamModality.addEventListener('change', (e) => {
      state.redpamFilters.modality = e.target.value;
      applyRedPamFilters();
    });
  }

  // RedPam: Filtro de Costo
  const redpamCost = document.getElementById('redpamCostSelect');
  if (redpamCost) {
    redpamCost.addEventListener('change', (e) => {
      state.redpamFilters.cost = e.target.value;
      applyRedPamFilters();
    });
  }

  // RedPam: Búsqueda
  const redpamSearchInput = document.getElementById('redpamSearchInput');
  const btnClearRedpamSearch = document.getElementById('btnClearRedpamSearch');
  if (redpamSearchInput) {
    redpamSearchInput.addEventListener('input', (e) => {
      state.redpamFilters.search = e.target.value;
      if (btnClearRedpamSearch) {
        if (state.redpamFilters.search) {
          btnClearRedpamSearch.classList.remove('hidden');
        } else {
          btnClearRedpamSearch.classList.add('hidden');
        }
      }
      applyRedPamFilters();
    });
  }

  if (btnClearRedpamSearch) {
    btnClearRedpamSearch.addEventListener('click', () => {
      if (redpamSearchInput) redpamSearchInput.value = '';
      state.redpamFilters.search = '';
      btnClearRedpamSearch.classList.add('hidden');
      applyRedPamFilters();
    });
  }

  // RedPam: Tarjetas de estadísticas interactivas
  const redpamStatCards = document.querySelectorAll('[data-redpam-stat]');
  redpamStatCards.forEach(card => {
    card.addEventListener('click', () => {
      const statType = card.getAttribute('data-redpam-stat');
      redpamStatCards.forEach(c => c.classList.remove('stat-card-active'));
      card.classList.add('stat-card-active');

      if (statType === 'all') {
        state.redpamFilters.category = 'all';
        state.redpamFilters.cost = 'all';
        state.redpamFilters.modality = 'all';
        state.redpamFilters.level = 'all';
      } else if (statType === 'gratis') {
        state.redpamFilters.cost = 'Gratuito';
        if (redpamCost) redpamCost.value = 'Gratuito';
      } else if (statType === 'virtual') {
        state.redpamFilters.modality = 'Virtual';
        if (redpamModality) redpamModality.value = 'Virtual';
      } else if (statType === 'secundario') {
        state.redpamFilters.level = 'Secundario';
        if (redpamLevel) redpamLevel.value = 'Secundario';
      }
      applyRedPamFilters();
    });
  });

  // RedPam: Restablecer Filtros
  const btnResetRedpam = document.getElementById('btnResetRedpamFilters');
  if (btnResetRedpam) {
    btnResetRedpam.addEventListener('click', () => {
      state.redpamFilters = {
        category: 'all',
        level: 'all',
        modality: 'all',
        cost: 'all',
        search: ''
      };
      if (redpamSearchInput) redpamSearchInput.value = '';
      if (btnClearRedpamSearch) btnClearRedpamSearch.classList.add('hidden');
      if (redpamLevel) redpamLevel.value = 'all';
      if (redpamModality) redpamModality.value = 'all';
      if (redpamCost) redpamCost.value = 'all';

      redpamPills.forEach(b => {
        if (b.getAttribute('data-redpam-category') === 'all') b.classList.add('active');
        else b.classList.remove('active');
      });

      redpamStatCards.forEach(c => {
        if (c.getAttribute('data-redpam-stat') === 'all') c.classList.add('stat-card-active');
        else c.classList.remove('stat-card-active');
      });

      applyRedPamFilters();
    });
  }

  // Botón Escanear Ahora (Actualiza tanto vacantes como RedPam)
  document.getElementById('btnScanNow').addEventListener('click', async () => {
    setScanningState(true);
    await Promise.all([
      fetchVacancies(true),
      fetchRedPamCourses(true)
    ]);
    setScanningState(false);
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

  // Restablecer Filtros de Secundaria
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
  await Promise.all([
    fetchVacancies(),
    fetchRedPamCourses()
  ]);

  // Chequeo automático periódico en el cliente cada 5 minutos
  setInterval(() => {
    console.log('⏰ Verificación periódica en segundo plano...');
    fetchVacancies(false);
    fetchRedPamCourses(false);
  }, 5 * 60 * 1000);
});
