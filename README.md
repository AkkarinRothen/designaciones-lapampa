# 🏫 DesignaPampa Secundaria (Zona Centro - La Pampa)

> Monitor inteligente y sistema de alertas en tiempo real de designaciones docentes de Educación Secundaria para la **Zona Centro** de la Provincia de La Pampa (Santa Rosa, Toay, Victorica, General Acha, Catriló, etc.), enfocado en vacantes de **Inglés** y **Lengua y Literatura**.

![DesignaPampa Preview](https://img.shields.io/badge/Estado-Activo-10b981?style=for-the-badge)
![La Pampa](https://img.shields.io/badge/Ministerio_Educaci%C3%B3n-La_Pampa-6366f1?style=for-the-badge)
![Telegram Alerts](https://img.shields.io/badge/Telegram-Alertas_en_vivo-229ed9?style=for-the-badge)

---

## 🌟 Características Principales

- 🔍 **Monitoreo Automático de Planillas Oficiales:** Conexión directa con las hojas de cálculo oficiales de *Interinatos y Suplencias* y *Propuestas* de las 37 localidades de la Zona Centro.
- 🎯 **Filtro Inteligente de Materias:** Detecta automáticamente publicaciones para:
  - **Inglés** (ej: *Lengua Extranjera: Inglés*, *Inglés*).
  - **Lengua** (ej: *Lengua y Literatura*, *Literatura*, *Prácticas del Lenguaje*).
  - Panel visual interactivo para agregar o editar materias y palabras clave adicionales bajo demanda.
- 📊 **Visualización Dual (Tarjetas vs Tabla Compacta):** Conmuta al instante entre vista de tarjetas detalladas y una tabla interactiva de alta densidad con ordenamiento por columnas (Horas, Materia, Colegio, Turno, etc.).
- 📌 **Barra de Herramientas Sticky Glassmorphism:** Filtros y buscador inteligente fijados en la parte superior con efecto de desenfoque translúcido que acompaña el scroll sin invadir la pantalla.
- 📈 **Panel de Analítica y Gráficos (Chart.js):** Métricas y gráficos interactivos colapsables de distribución de vacantes por materia (Doughnut), top localidades (Barras) y turnos/carga horaria.
- 🔎 **Búsqueda Inteligente Difusa (Fuse.js):** Algoritmo de búsqueda tolerante a errores tipográficos, tildes y variaciones de texto en colegios, materias y CUPOFs.
- 📥 **Exportación Profesional (SheetJS & jsPDF):** Descarga con un solo clic de las vacantes filtradas en formato Excel (.xlsx) limpio o en PDF oficial listo para imprimir.
- 💬 **Tooltips Avanzados (Tippy.js):** Previsualizaciones elegantes al pasar el mouse por horarios, CUPOFs y notas.
- 🕒 **Tiempos Relativos Inteligentes (Dayjs):** Monitoreo con marcas temporales en tiempo real ("hace 3 minutos", "actualizado hoy").
- 📚 **Catálogo de Cursos y Capacitaciones RedPam:** Integración directa con el portal [RedPam](https://redpam.lapampa.edu.ar/propuestas).
  - Pestañas superiores para alternar entre *Designaciones Secundarias* y *Cursos RedPam*.
  - Filtros por temática (Inglés, Lengua, ESI, Inclusión), nivel educativo (Secundario, Primario, Inicial, Superior), modalidad (Virtual, Presencial) y costo (Gratuito vs Arancelado).
  - Notificaciones inteligentes por Telegram cuando surgen propuestas para Inglés/Lengua o gratuitas para Secundaria.
- 📲 **Alertas Instantáneas por Telegram:** Notificaciones directas a tu celular con todos los detalles de la vacante o curso.
- 🔔 **Alertas en la Web:** Notificaciones visuales emergentes y timbre sonoro sintetizado (Web Audio API).
- 🚀 **Acceso Rápido Oficial:** Botones de acceso directo en cada vacante para postularse en [Voz por Vos](https://vozporvos.lapampa.edu.ar/), planillas originales y páginas de inscripción de cursos.
- 📤 **Compartir y Copiar:** Copia al portapapeles o comparte directamente en grupos de WhatsApp de colegas docentes.
- 🌓 **Diseño Moderno:** Interfaz ultra-rápida, responsive (móvil y escritorio) con modo oscuro y modo claro.

---

## 🌐 Despliegue en GitHub Pages

La aplicación está lista para funcionar de forma 100% estática en **GitHub Pages**:

1. En el repositorio de GitHub, ve a **Settings** > **Pages**.
2. En **Build and deployment** > **Source**, selecciona `Deploy from a branch`.
3. Selecciona la rama `main` y la carpeta `/ (root)`.
4. ¡Listo! La web estará disponible en tu URL de GitHub Pages:
   ```
   https://<tu-usuario>.github.io/<tu-repositorio>/
   ```

---

## 🤖 Configurar Alertas Automáticas por Telegram en GitHub Actions

Para que GitHub revise las planillas automáticamente en segundo plano (cada 20 minutos de lunes a viernes en horario laboral escolar) y te envíe los avisos a Telegram sin que tengas que tener la computadora encendida:

1. **Crear tu bot de Telegram:**
   - Abre Telegram y busca `@BotFather`.
   - Envía `/newbot`, ponle un nombre y usuario a tu bot.
   - Guarda el **Token** que te proporciona (ej: `123456789:ABCdefGh...`).
   - Envía cualquier mensaje a tu nuevo bot para activarlo (ej: `/start`).

2. **Obtener tu Chat ID:**
   - Busca en Telegram a `@userinfobot` y presiona *Iniciar*.
   - Te responderá con tu **Id** numérico (ej: `987654321`).

3. **Guardar los Secrets en GitHub:**
   - En tu repositorio de GitHub, ve a **Settings** > **Secrets and variables** > **Actions**.
   - Presiona **New repository secret**:
     - `TELEGRAM_BOT_TOKEN`: Pega el token de BotFather.
     - `TELEGRAM_CHAT_ID`: Pega tu Chat ID numérico.

A partir de ese momento, la GitHub Action (`.github/workflows/monitor.yml`) monitoreará las planillas automáticamente y te notificará ante cualquier nueva vacante.

---

## 💻 Ejecución Local (Node.js)

Si prefieres correr el servidor y monitor de forma local en tu máquina:

```bash
# 1. Clonar el repositorio
git clone https://github.com/AkkarinRothen/designaciones-lapampa.git
cd designaciones-lapampa

# 2. Instalar dependencias
npm install

# 3. Iniciar el servidor local
npm start
```

Abre tu navegador en [http://localhost:3000](http://localhost:3000).

Para correr un escaneo puntual desde la terminal:
```bash
node scraper.js
```

---

## 📍 Sedes y Localidades Monitoreadas (Zona Centro)

- **Sede Santa Rosa:** Santa Rosa, Toay, Catriló, Anguil, Ataliva Roca, Uriburu, Lonquimay.
- **Sede General Acha:** General Acha, Doblas, Quehué, La Adela, Chacharramendi, Cuchillo Có, Gobernador Duval, Puelches, Colonia Santa María.
- **Sede Victorica:** Victorica, Telén, Luan Toro, Santa Isabel, Algarrobo del Águila, La Humada.
- **Sede 25 de Mayo:** 25 de Mayo, Casa de Piedra.
- **Sede Jacinto Aráuz:** Jacinto Aráuz, Alpachiri, Anchorena, General Campos, Guatraché, Rolón, Macachín, Bernasconi, General San Martín, Santa Teresa, Miguel Riglos.

---

## 📜 Licencia

Desarrollado bajo licencia MIT con fines informativos y de apoyo a la comunidad docente de La Pampa.
