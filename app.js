/**
 * Mission Log Book — Application Logic & Controller
 * Mobile-First Offline-Ready Pilot and Drone Logbook
 */

(function () {
  'use strict';

  // Application State
  const state = {
    flights: [],
    batteries: [],
    settings: {
      cycleMode: 'simple', // 'simple' | 'advanced'
      durationFormat: 'hm', // 'hm' | 'minutes'
      theme: 'minimal' // 'minimal' | 'daylight' | 'stealth' | 'tactical'
    },
    activeView: 'dashboard',
    filters: {
      search: '',
      dateFrom: '',
      dateTo: '',
      batteryId: '',
      status: '',
      incident: '',
      sort: 'date-desc'
    },
    confirmCallback: null
  };

  /* =========================================================================
     INITIALIZATION & SERVICE WORKER
     ========================================================================= */

  document.addEventListener('DOMContentLoaded', async () => {
    initServiceWorker();
    initNetworkListeners();
    initEventListeners();
    await loadSettings();
    await loadData();
    applyTheme(state.settings.theme);
    switchView('dashboard');
  });

  function initServiceWorker() {
    if ('serviceWorker' in navigator) {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('./service-worker.js')
          .then((reg) => {
            console.log('Mission Log Service Worker registered:', reg.scope);
          })
          .catch((err) => {
            console.warn('Service Worker registration failed:', err);
          });
      });
    }
  }

  function initNetworkListeners() {
    const updateNetworkStatus = () => {
      const isOnline = navigator.onLine;
      const connDot = document.getElementById('conn-dot');
      const connText = document.getElementById('conn-text');
      const offlineBanner = document.getElementById('offline-banner');

      if (connDot && connText) {
        if (isOnline) {
          connDot.className = 'conn-dot online';
          connText.textContent = 'Online';
          if (offlineBanner) offlineBanner.style.display = 'none';
        } else {
          connDot.className = 'conn-dot offline';
          connText.textContent = 'Offline Ready';
          if (offlineBanner) offlineBanner.style.display = 'flex';
        }
      }
    };

    window.addEventListener('online', () => {
      updateNetworkStatus();
      showToast('Network restored. Local database synchronized.', 'info');
    });

    window.addEventListener('offline', () => {
      updateNetworkStatus();
      showToast('You are offline. Full flight logging and battery tracking remain active.', 'warning');
    });

    updateNetworkStatus();
  }

  /* =========================================================================
     SETTINGS & DATA LOADING
     ========================================================================= */

  async function loadSettings() {
    try {
      const savedSettings = await window.missionDB.getAllSettings();
      if (savedSettings.cycleMode) state.settings.cycleMode = savedSettings.cycleMode;
      if (savedSettings.durationFormat) state.settings.durationFormat = savedSettings.durationFormat;
      
      // Ensure theme defaults to clean minimal white and migrates legacy stealth/tactical
      if (savedSettings.theme === 'stealth' || savedSettings.theme === 'tactical' || !savedSettings.theme) {
        state.settings.theme = 'minimal';
        await window.missionDB.setSetting('theme', 'minimal');
      } else {
        state.settings.theme = savedSettings.theme;
      }

      // Update UI settings elements
      const simpleRadio = document.getElementById('mode-simple-radio');
      const advancedRadio = document.getElementById('mode-advanced-radio');
      if (simpleRadio && advancedRadio) {
        if (state.settings.cycleMode === 'advanced') {
          advancedRadio.checked = true;
        } else {
          simpleRadio.checked = true;
        }
      }

      const durSelect = document.getElementById('setting-duration-format');
      if (durSelect) durSelect.value = state.settings.durationFormat;

      const themeSelect = document.getElementById('setting-theme');
      if (themeSelect) themeSelect.value = state.settings.theme;

    } catch (err) {
      console.error('Error loading settings from IndexedDB:', err);
    }
  }

  async function saveSetting(key, value) {
    state.settings[key] = value;
    await window.missionDB.setSetting(key, value);
    renderAllViews();
  }

  async function loadData() {
    try {
      state.flights = await window.missionDB.getAllFlights();
      state.batteries = await window.missionDB.getAllBatteries();

      // Check if first-time user (empty DB)
      if (state.batteries.length === 0 && state.flights.length === 0) {
        // Leave clean or ready for demo data
      }

      renderAllViews();
    } catch (err) {
      console.error('Error loading data:', err);
      showToast('Failed to load local data: ' + err.message, 'error');
    }
  }

  function applyTheme(themeName) {
    const active = (themeName === 'stealth' || themeName === 'tactical') ? 'minimal' : (themeName || 'minimal');
    document.body.setAttribute('data-theme', active);
    const themeSelect = document.getElementById('setting-theme');
    if (themeSelect) themeSelect.value = active;
  }

  /* =========================================================================
     NAVIGATION & VIEW SWITCHING
     ========================================================================= */

  function switchView(viewName) {
    state.activeView = viewName;

    // View sections
    document.querySelectorAll('.view-section').forEach(sec => sec.classList.remove('active'));
    const targetSection = document.getElementById(`view-${viewName}`);
    if (targetSection) targetSection.classList.add('active');

    // Page title
    const titles = {
      dashboard: 'Mission Dashboard',
      flights: 'Flight Missions Logbook',
      batteries: 'Battery Hangar Fleet',
      settings: 'Settings & Data Backup'
    };
    const titleEl = document.getElementById('page-title');
    if (titleEl) titleEl.textContent = titles[viewName] || 'Mission Log Book';

    // Nav active states
    document.querySelectorAll('.nav-item, .bottom-nav-item').forEach(btn => {
      if (btn.dataset.view === viewName) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    });

    // Render targeted view
    if (viewName === 'dashboard') renderDashboard();
    if (viewName === 'flights') renderFlightsView();
    if (viewName === 'batteries') renderBatteriesView();
    if (viewName === 'settings') renderSettingsView();

    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  /* =========================================================================
     BATTERY CYCLE & STATS CALCULATIONS
     ========================================================================= */

  /**
   * Computes authoritative telemetry and cycle counts for a given battery.
   * Eliminates duplicate counting and ensures real-time recalculation on add/edit/delete.
   */
  function calculateBatteryStats(battery) {
    if (!battery) return null;

    const batteryFlights = state.flights.filter(f => f.batteryId === battery.id);
    const flightCount = batteryFlights.length;
    const totalDurationMinutes = batteryFlights.reduce((acc, f) => acc + (Number(f.duration) || 0), 0);

    const initialCycles = Number(battery.initialCycles) || 0;
    const maxCycles = Number(battery.maxCycles) || 300;
    let additionalCycles = 0;
    let fallbackFlightsCount = 0;

    if (state.settings.cycleMode === 'simple') {
      // Simple usage cycle: 1 recorded flight = 1.0 usage cycle
      additionalCycles = flightCount;
    } else {
      // Advanced Equivalent Full Cycles (EFC):
      // Delta = (Pre-Flight % - Post-Flight %) / 100
      batteryFlights.forEach(f => {
        const pre = Number(f.preFlightPct);
        const post = Number(f.postFlightPct);
        if (!isNaN(pre) && !isNaN(post) && pre >= post && pre >= 0 && post >= 0) {
          const discharge = pre - post;
          additionalCycles += discharge / 100.0;
        } else {
          // Fallback if percentage telemetry omitted or invalid
          additionalCycles += 1.0;
          fallbackFlightsCount++;
        }
      });
    }

    const currentCycles = initialCycles + additionalCycles;
    const cycleRatio = maxCycles > 0 ? currentCycles / maxCycles : 0;
    const percentageUsed = Math.min(100, Math.round(cycleRatio * 100));

    // Health condition evaluation
    let healthStatus = 'Optimal';
    let healthClass = 'health-good';
    if (cycleRatio >= 0.65 && cycleRatio <= 0.85) {
      healthStatus = 'Moderate Wear';
      healthClass = 'health-warn';
    } else if (cycleRatio > 0.85 && cycleRatio <= 1.0) {
      healthStatus = 'Near End of Life';
      healthClass = 'health-warn';
    } else if (cycleRatio > 1.0) {
      healthStatus = 'Exceeded Rating';
      healthClass = 'health-danger';
    }

    // Latest flight used
    let lastUsedDate = 'Never Flown';
    if (batteryFlights.length > 0) {
      const sortedFlights = [...batteryFlights].sort((a, b) => new Date(b.date) - new Date(a.date));
      lastUsedDate = formatDateString(sortedFlights[0].date);
    }

    return {
      battery,
      flightCount,
      totalDurationMinutes,
      initialCycles,
      additionalCycles,
      currentCycles,
      maxCycles,
      percentageUsed,
      healthStatus,
      healthClass,
      lastUsedDate,
      fallbackFlightsCount,
      cyclesFormatted: state.settings.cycleMode === 'simple'
        ? currentCycles.toFixed(0)
        : currentCycles.toFixed(1)
    };
  }

  function formatDuration(minutes) {
    const mins = Number(minutes) || 0;
    if (state.settings.durationFormat === 'minutes') {
      return `${mins} min`;
    }
    if (mins === 0) return '0h 0m';
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    if (h === 0) return `${m}m`;
    return `${h}h ${m}m`;
  }

  function formatDateString(isoString) {
    if (!isoString) return '—';
    try {
      const d = new Date(isoString);
      if (isNaN(d.getTime())) return isoString;
      return d.toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch {
      return isoString;
    }
  }

  function renderAllViews() {
    renderCounters();
    if (state.activeView === 'dashboard') renderDashboard();
    if (state.activeView === 'flights') renderFlightsView();
    if (state.activeView === 'batteries') renderBatteriesView();
    if (state.activeView === 'settings') renderSettingsView();
  }

  function renderCounters() {
    const flightsCountEl = document.getElementById('desktop-flights-count');
    const batteriesCountEl = document.getElementById('desktop-batteries-count');
    if (flightsCountEl) flightsCountEl.textContent = state.flights.length;
    if (batteriesCountEl) batteriesCountEl.textContent = state.batteries.length;
  }

  /* =========================================================================
     VIEW RENDERING: DASHBOARD
     ========================================================================= */

  function renderDashboard() {
    // KPI 1: Total Flights
    const kpiFlights = document.getElementById('kpi-total-flights');
    if (kpiFlights) kpiFlights.textContent = state.flights.length;

    // KPI 2: Total Duration
    const totalMinutes = state.flights.reduce((acc, f) => acc + (Number(f.duration) || 0), 0);
    const kpiDuration = document.getElementById('kpi-total-duration');
    if (kpiDuration) kpiDuration.textContent = formatDuration(totalMinutes);

    // KPI 3: Batteries Registered
    const kpiBatteries = document.getElementById('kpi-total-batteries');
    if (kpiBatteries) kpiBatteries.textContent = state.batteries.length;

    // KPI 4: Total Cycles across all batteries
    let totalAllCycles = 0;
    state.batteries.forEach(b => {
      const stats = calculateBatteryStats(b);
      if (stats) totalAllCycles += stats.currentCycles;
    });
    const kpiCycles = document.getElementById('kpi-total-cycles');
    if (kpiCycles) {
      kpiCycles.textContent = state.settings.cycleMode === 'simple'
        ? totalAllCycles.toFixed(0)
        : totalAllCycles.toFixed(1);
    }
    const kpiCyclesSub = document.getElementById('kpi-cycles-sub');
    if (kpiCyclesSub) {
      kpiCyclesSub.textContent = state.settings.cycleMode === 'simple'
        ? 'Mode: Simple (1:1)'
        : 'Mode: Advanced (EFC)';
    }

    // KPI 5: Completed this month
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth();
    const monthFlights = state.flights.filter(f => {
      const d = new Date(f.date);
      return !isNaN(d.getTime()) && d.getFullYear() === currentYear && d.getMonth() === currentMonth;
    }).length;
    const kpiMonth = document.getElementById('kpi-month-flights');
    if (kpiMonth) kpiMonth.textContent = monthFlights;

    // KPI 6: Mission Reliability (Completed flights with no incident / total)
    const kpiReliability = document.getElementById('kpi-reliability');
    if (kpiReliability) {
      if (state.flights.length === 0) {
        kpiReliability.textContent = '100%';
      } else {
        const successful = state.flights.filter(f => f.status === 'completed' && !f.hasIncident).length;
        const rate = Math.round((successful / state.flights.length) * 100);
        kpiReliability.textContent = `${rate}%`;
      }
    }

    // Cycle Mode Banner Info
    const modeTitle = document.getElementById('dash-cycle-mode-name');
    const modeDesc = document.getElementById('dash-cycle-mode-desc');
    if (modeTitle && modeDesc) {
      if (state.settings.cycleMode === 'simple') {
        modeTitle.textContent = 'Simple Usage Count (1:1)';
        modeDesc.textContent = 'Each recorded flight increments battery usage by 1.0 cycle. Straightforward operational metric.';
      } else {
        modeTitle.textContent = 'Advanced Equivalent Full Cycles (EFC)';
        modeDesc.textContent = 'Calculates cycle wear from depth of discharge: (Pre% - Post%) / 100. Accurate battery wear accumulation.';
      }
    }

    // Top Workhorse Battery Card
    renderTopBatteryCard();

    // Recent Flights List
    renderDashboardRecentFlights();
  }

  function renderTopBatteryCard() {
    const container = document.getElementById('top-battery-content');
    if (!container) return;

    if (state.batteries.length === 0) {
      container.innerHTML = `
        <div class="empty-state-small">
          <p>No batteries registered yet.</p>
          <button type="button" class="btn btn-primary btn-sm mt-3" id="btn-dash-add-batt">
            <svg class="icon"><use href="#icon-plus"></use></svg>
            <span>Register First Battery</span>
          </button>
        </div>
      `;
      const btn = document.getElementById('btn-dash-add-batt');
      if (btn) btn.addEventListener('click', () => openBatteryModal());
      return;
    }

    // Find battery with most flights
    let topBatt = null;
    let topStats = null;
    let maxFlights = -1;

    state.batteries.forEach(b => {
      const stats = calculateBatteryStats(b);
      if (stats.flightCount > maxFlights) {
        maxFlights = stats.flightCount;
        topBatt = b;
        topStats = stats;
      }
    });

    if (!topBatt || topStats.flightCount === 0) {
      const firstBatt = state.batteries[0];
      const stats = calculateBatteryStats(firstBatt);
      container.innerHTML = `
        <div class="battery-card-header mb-2">
          <div>
            <div class="battery-name">${escapeHtml(firstBatt.name)}</div>
            <div class="battery-specs-sub">${escapeHtml(firstBatt.chemistry)} &bull; ${firstBatt.capacity} mAh ${firstBatt.cells ? `&bull; ${escapeHtml(firstBatt.cells)}` : ''}</div>
          </div>
          <span class="badge badge-info">Fleet Primary</span>
        </div>
        <div class="cycle-progress-wrap">
          <div class="cycle-progress-labels">
            <span class="cycle-count-big">${stats.cyclesFormatted} <span class="cycle-max-label">/ ${stats.maxCycles} cycles</span></span>
            <span class="text-xs text-muted">${stats.healthStatus} (${stats.percentageUsed}%)</span>
          </div>
          <div class="progress-track">
            <div class="progress-bar ${stats.healthClass}" style="width: ${stats.percentageUsed}%"></div>
          </div>
        </div>
        <p class="text-xs text-muted mt-3">Ready for flight missions. No sorties recorded yet with this pack.</p>
      `;
      return;
    }

    container.innerHTML = `
      <div class="battery-card-header mb-2">
        <div>
          <div class="battery-name">${escapeHtml(topBatt.name)}</div>
          <div class="battery-specs-sub">${escapeHtml(topBatt.chemistry)} &bull; ${topBatt.capacity} mAh ${topBatt.cells ? `&bull; ${escapeHtml(topBatt.cells)}` : ''}</div>
        </div>
        <span class="badge badge-warning">Top Workhorse</span>
      </div>
      <div class="cycle-progress-wrap">
        <div class="cycle-progress-labels">
          <span class="cycle-count-big">${topStats.cyclesFormatted} <span class="cycle-max-label">/ ${topStats.maxCycles} cycles</span></span>
          <span class="text-xs text-muted">${topStats.healthStatus} (${topStats.percentageUsed}%)</span>
        </div>
        <div class="progress-track">
          <div class="progress-bar ${topStats.healthClass}" style="width: ${topStats.percentageUsed}%"></div>
        </div>
      </div>
      <div class="battery-stats-grid mt-3">
        <div class="batt-stat-item">
          <span class="batt-stat-label">Sorties Flown</span>
          <span class="batt-stat-val text-cyan">${topStats.flightCount} flights</span>
        </div>
        <div class="batt-stat-item">
          <span class="batt-stat-label">Air Time</span>
          <span class="batt-stat-val">${formatDuration(topStats.totalDurationMinutes)}</span>
        </div>
      </div>
    `;
  }

  function renderDashboardRecentFlights() {
    const container = document.getElementById('dashboard-recent-flights');
    if (!container) return;

    if (state.flights.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">
            <svg class="icon"><use href="#icon-plane"></use></svg>
          </div>
          <div class="empty-state-title">No Flight Missions Logged</div>
          <div class="empty-state-desc">Start logging your pilot sorties, drone flights, and battery discharge telemetry to monitor fleet readiness.</div>
          <div class="button-row mt-3">
            <button type="button" class="btn btn-primary" id="btn-empty-log-flight">
              <svg class="icon"><use href="#icon-plus"></use></svg>
              <span>Log New Flight</span>
            </button>
            <button type="button" class="btn btn-secondary" id="btn-empty-demo-data">
              <svg class="icon"><use href="#icon-crosshair"></use></svg>
              <span>Load Sample Demo Data</span>
            </button>
          </div>
        </div>
      `;

      const logBtn = document.getElementById('btn-empty-log-flight');
      if (logBtn) logBtn.addEventListener('click', () => openFlightModal());

      const demoBtn = document.getElementById('btn-empty-demo-data');
      if (demoBtn) demoBtn.addEventListener('click', () => loadSampleDemoData());
      return;
    }

    // Sort flights by date descending, take first 5
    const recent = [...state.flights]
      .sort((a, b) => new Date(b.date) - new Date(a.date))
      .slice(0, 5);

    let tableRows = '';
    let mobileCards = '';

    recent.forEach(flight => {
      const batt = state.batteries.find(b => b.id === flight.batteryId);
      const battName = batt ? batt.name : (flight.batteryId || 'Unknown');
      const statusBadge = getStatusBadge(flight.status);
      const incidentPill = flight.hasIncident
        ? `<span class="badge badge-danger" title="Incident recorded">Incident</span>`
        : '';

      tableRows += `
        <tr class="compact-flight-item recent-table-row" data-flight-id="${escapeHtml(flight.id)}" tabindex="0" role="button" aria-label="View flight ${escapeHtml(flight.id)}">
          <td>
            <div class="table-mission-name">${escapeHtml(flight.missionName || flight.location || flight.id)}</div>
            <div class="table-flight-id">${escapeHtml(flight.id)}</div>
          </td>
          <td>
            <div class="table-cell-date">${formatDateString(flight.date)}</div>
          </td>
          <td>
            <div class="table-cell-location">${escapeHtml(flight.location || '—')}</div>
          </td>
          <td>
            <span class="chip chip-battery">🔋 ${escapeHtml(battName)}</span>
          </td>
          <td>
            <span class="chip chip-duration">${formatDuration(flight.duration)}</span>
          </td>
          <td>
            <div class="status-stack">${statusBadge} ${incidentPill}</div>
          </td>
          <td>
            <button type="button" class="btn btn-outline btn-xs" aria-label="View Dossier">Dossier</button>
          </td>
        </tr>
      `;

      mobileCards += `
        <div class="compact-flight-item recent-mobile-card" data-flight-id="${escapeHtml(flight.id)}" tabindex="0" role="button">
          <div class="recent-card-top">
            <div class="recent-card-meta">
              <span class="recent-card-id">${escapeHtml(flight.id)}</span>
              <span class="recent-card-date">${formatDateString(flight.date)}</span>
            </div>
            <div class="recent-card-status">
              ${statusBadge}
              ${incidentPill}
            </div>
          </div>
          <div class="recent-card-title">${escapeHtml(flight.missionName || flight.location || flight.id)}</div>
          <div class="recent-card-location">📍 ${escapeHtml(flight.location || '—')}</div>
          <div class="recent-card-chips">
            <span class="chip chip-duration">⏱ ${formatDuration(flight.duration)}</span>
            <span class="chip chip-battery">🔋 ${escapeHtml(battName)}</span>
          </div>
        </div>
      `;
    });

    container.innerHTML = `
      <div class="recent-flights-table-wrap hide-mobile">
        <table class="recent-flights-table">
          <thead>
            <tr>
              <th>Mission / Flight ID</th>
              <th>Date & Time</th>
              <th>Location</th>
              <th>Battery Pack</th>
              <th>Air Time</th>
              <th>Status</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            ${tableRows}
          </tbody>
        </table>
      </div>
      <div class="recent-flights-cards-wrap hide-desktop">
        ${mobileCards}
      </div>
    `;

    // Attach click and keyboard listeners to open flight details dossier
    container.querySelectorAll('.compact-flight-item').forEach(item => {
      const openDossier = () => {
        const id = item.dataset.flightId;
        if (id) openFlightDetailsModal(id);
      };
      item.addEventListener('click', openDossier);
      item.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          openDossier();
        }
      });
    });
  }

  /* =========================================================================
     VIEW RENDERING: FLIGHT MISSIONS LIST & CARDS
     ========================================================================= */

  function renderFlightsView() {
    populateBatteryFilterOptions();

    const container = document.getElementById('flights-container');
    if (!container) return;

    // Filter flights according to state.filters
    const filtered = getFilteredFlights();

    // Results count
    const countEl = document.getElementById('filter-results-count');
    if (countEl) countEl.textContent = `Showing ${filtered.length} of ${state.flights.length} flights`;

    // Filter count badge
    updateActiveFilterBadge();

    if (filtered.length === 0) {
      if (state.flights.length === 0) {
        container.innerHTML = `
          <div class="empty-state">
            <div class="empty-state-icon">
              <svg class="icon"><use href="#icon-plane"></use></svg>
            </div>
            <div class="empty-state-title">Your Flight Hangar is Empty</div>
            <div class="empty-state-desc">Log your first mission to track air time, pilot hours, and battery discharge cycles.</div>
            <button type="button" class="btn btn-primary mt-3" id="btn-flights-empty-add">
              <svg class="icon"><use href="#icon-plus"></use></svg>
              <span>Log Mission Flight</span>
            </button>
          </div>
        `;
        const btn = document.getElementById('btn-flights-empty-add');
        if (btn) btn.addEventListener('click', () => openFlightModal());
      } else {
        container.innerHTML = `
          <div class="empty-state">
            <div class="empty-state-icon">
              <svg class="icon"><use href="#icon-search"></use></svg>
            </div>
            <div class="empty-state-title">No Matching Flights Found</div>
            <div class="empty-state-desc">Try clearing your search query or adjusting your filters.</div>
            <button type="button" class="btn btn-outline btn-sm mt-3" id="btn-empty-reset-filters">
              <span>Reset All Filters</span>
            </button>
          </div>
        `;
        const resetBtn = document.getElementById('btn-empty-reset-filters');
        if (resetBtn) resetBtn.addEventListener('click', resetFilters);
      }
      return;
    }

    let html = '';
    filtered.forEach(flight => {
      const batt = state.batteries.find(b => b.id === flight.batteryId);
      const battName = batt ? batt.name : (flight.batteryId || 'Unknown');
      const statusBadge = getStatusBadge(flight.status);

      // Pre/Post discharge calculation
      let dischargeChip = '';
      if (flight.preFlightPct !== null && flight.preFlightPct !== undefined && flight.preFlightPct !== '' &&
          flight.postFlightPct !== null && flight.postFlightPct !== undefined && flight.postFlightPct !== '') {
        const pre = Number(flight.preFlightPct);
        const post = Number(flight.postFlightPct);
        const diff = pre - post;
        const deltaCycle = (diff / 100).toFixed(2);
        dischargeChip = `<span class="chip">⚡ ${pre}% &rarr; ${post}% (&Delta;${diff}% / ${deltaCycle} cyc)</span>`;
      }

      // Incident alert block
      let incidentBlock = '';
      if (flight.hasIncident) {
        const severity = flight.incidentSeverity || 'medium';
        incidentBlock = `
          <div class="flight-incident-alert severity-${severity}">
            <svg class="icon text-red"><use href="#icon-alert"></use></svg>
            <div class="incident-alert-content">
              <div class="incident-alert-title">
                <span class="badge ${getSeverityBadgeClass(severity)}">${severity.toUpperCase()} INCIDENT</span>
                ${flight.maintenanceRequired ? '<span class="badge badge-warning">MAINTENANCE REQ</span>' : ''}
              </div>
              <div>${escapeHtml(flight.incidentDescription || 'Incident anomaly documented during flight.')}</div>
            </div>
          </div>
        `;
      }

      html += `
        <div class="flight-card" data-flight-id="${escapeHtml(flight.id)}">
          <div class="flight-card-header">
            <div>
              <div class="flight-id-wrap">
                <span class="flight-id">${escapeHtml(flight.id)}</span>
                <span class="flight-date">&bull; ${formatDateString(flight.date)}</span>
              </div>
              <div class="flight-mission-title">${escapeHtml(flight.missionName || flight.location || 'Flight Sortie')}</div>
              <div class="flight-location-sub">
                <svg class="icon"><use href="#icon-crosshair"></use></svg>
                <span>${escapeHtml(flight.location)}</span>
              </div>
            </div>
            <div>${statusBadge}</div>
          </div>

          <div class="flight-chips-row">
            <span class="chip chip-duration">
              <svg class="icon"><use href="#icon-clock"></use></svg>
              <strong>${formatDuration(flight.duration)}</strong>
            </span>
            <span class="chip chip-battery">
              <svg class="icon"><use href="#icon-battery"></use></svg>
              <strong>${escapeHtml(battName)}</strong>
            </span>
            ${flight.aircraftModel ? `<span class="chip">🛩 ${escapeHtml(flight.aircraftModel)}</span>` : ''}
            ${flight.pilotName ? `<span class="chip">👤 ${escapeHtml(flight.pilotName)}</span>` : ''}
            ${flight.weather ? `<span class="chip">🌤 ${escapeHtml(flight.weather)}</span>` : ''}
            ${dischargeChip}
          </div>

          ${incidentBlock}

          <div class="flight-card-footer">
            <button type="button" class="btn btn-outline btn-xs btn-card-details" data-id="${escapeHtml(flight.id)}">
              <span>View Dossier</span> &rarr;
            </button>
            <div class="card-actions-right">
              <button type="button" class="btn btn-secondary btn-xs btn-card-edit" data-id="${escapeHtml(flight.id)}" title="Edit flight">
                <svg class="icon"><use href="#icon-edit"></use></svg>
                <span class="hide-mobile">Edit</span>
              </button>
              <button type="button" class="btn btn-secondary btn-xs btn-card-delete text-red" data-id="${escapeHtml(flight.id)}" title="Delete flight">
                <svg class="icon"><use href="#icon-trash"></use></svg>
                <span class="hide-mobile">Delete</span>
              </button>
            </div>
          </div>
        </div>
      `;
    });

    container.innerHTML = html;

    // Attach card event listeners
    container.querySelectorAll('.btn-card-details').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        openFlightDetailsModal(btn.dataset.id);
      });
    });

    container.querySelectorAll('.btn-card-edit').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        openFlightModal(btn.dataset.id);
      });
    });

    container.querySelectorAll('.btn-card-delete').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        promptDeleteFlight(btn.dataset.id);
      });
    });

    // Make entire card clickable for viewing details
    container.querySelectorAll('.flight-card').forEach(card => {
      card.addEventListener('click', (e) => {
        if (!e.target.closest('button')) {
          openFlightDetailsModal(card.dataset.flightId);
        }
      });
    });
  }

  function getFilteredFlights() {
    return state.flights.filter(flight => {
      // 1. Text Search
      if (state.filters.search) {
        const q = state.filters.search.toLowerCase();
        const matchesId = (flight.id || '').toLowerCase().includes(q);
        const matchesMission = (flight.missionName || '').toLowerCase().includes(q);
        const matchesLoc = (flight.location || '').toLowerCase().includes(q);
        const matchesPilot = (flight.pilotName || '').toLowerCase().includes(q);
        const matchesModel = (flight.aircraftModel || '').toLowerCase().includes(q);
        const matchesNotes = (flight.notes || '').toLowerCase().includes(q);
        const matchesIncident = (flight.incidentDescription || '').toLowerCase().includes(q);
        if (!matchesId && !matchesMission && !matchesLoc && !matchesPilot && !matchesModel && !matchesNotes && !matchesIncident) {
          return false;
        }
      }

      // 2. Date Range
      if (state.filters.dateFrom) {
        const from = new Date(state.filters.dateFrom).getTime();
        const d = new Date(flight.date).getTime();
        if (d < from) return false;
      }
      if (state.filters.dateTo) {
        const to = new Date(state.filters.dateTo + 'T23:59:59').getTime();
        const d = new Date(flight.date).getTime();
        if (d > to) return false;
      }

      // 3. Battery
      if (state.filters.batteryId && flight.batteryId !== state.filters.batteryId) {
        return false;
      }

      // 4. Status
      if (state.filters.status && flight.status !== state.filters.status) {
        return false;
      }

      // 5. Incident
      if (state.filters.incident) {
        if (state.filters.incident === 'has_incident' && !flight.hasIncident) {
          return false;
        }
        if (['low', 'medium', 'high', 'critical'].includes(state.filters.incident)) {
          if (!flight.hasIncident || flight.incidentSeverity !== state.filters.incident) {
            return false;
          }
        }
      }

      return true;
    }).sort((a, b) => {
      if (state.filters.sort === 'date-desc') return new Date(b.date) - new Date(a.date);
      if (state.filters.sort === 'date-asc') return new Date(a.date) - new Date(b.date);
      if (state.filters.sort === 'duration-desc') return (b.duration || 0) - (a.duration || 0);
      if (state.filters.sort === 'duration-asc') return (a.duration || 0) - (b.duration || 0);
      return 0;
    });
  }

  function updateActiveFilterBadge() {
    const badge = document.getElementById('active-filter-badge');
    if (!badge) return;

    let activeCount = 0;
    if (state.filters.dateFrom) activeCount++;
    if (state.filters.dateTo) activeCount++;
    if (state.filters.batteryId) activeCount++;
    if (state.filters.status) activeCount++;
    if (state.filters.incident) activeCount++;
    if (state.filters.sort !== 'date-desc') activeCount++;

    if (activeCount > 0) {
      badge.textContent = activeCount;
      badge.style.display = 'inline-block';
    } else {
      badge.style.display = 'none';
    }
  }

  function populateBatteryFilterOptions() {
    const select = document.getElementById('filter-battery');
    if (!select) return;

    const currentVal = state.filters.batteryId;
    let html = '<option value="">All Batteries</option>';
    state.batteries.forEach(b => {
      const selected = b.id === currentVal ? 'selected' : '';
      html += `<option value="${escapeHtml(b.id)}" ${selected}>${escapeHtml(b.name)} (${b.capacity}mAh)</option>`;
    });
    select.innerHTML = html;
  }

  function resetFilters() {
    state.filters = {
      search: '',
      dateFrom: '',
      dateTo: '',
      batteryId: '',
      status: '',
      incident: '',
      sort: 'date-desc'
    };

    const searchInput = document.getElementById('flights-search-input');
    const clearSearchBtn = document.getElementById('btn-clear-search');
    if (searchInput) searchInput.value = '';
    if (clearSearchBtn) clearSearchBtn.style.display = 'none';

    const dateFrom = document.getElementById('filter-date-from');
    if (dateFrom) dateFrom.value = '';
    const dateTo = document.getElementById('filter-date-to');
    if (dateTo) dateTo.value = '';
    const battFilter = document.getElementById('filter-battery');
    if (battFilter) battFilter.value = '';
    const statusFilter = document.getElementById('filter-status');
    if (statusFilter) statusFilter.value = '';
    const incFilter = document.getElementById('filter-incident');
    if (incFilter) incFilter.value = '';
    const sortFilter = document.getElementById('sort-flights');
    if (sortFilter) sortFilter.value = 'date-desc';

    renderFlightsView();
  }

  /* =========================================================================
     VIEW RENDERING: BATTERIES HANGAR
     ========================================================================= */

  function renderBatteriesView() {
    const title = document.getElementById('batteries-view-mode-title');
    const desc = document.getElementById('batteries-view-mode-desc');
    if (title && desc) {
      if (state.settings.cycleMode === 'simple') {
        title.textContent = 'Simple Usage Count (1:1)';
        desc.textContent = 'Current method counts 1 flight as 1 usage cycle. To estimate Equivalent Full Cycles (EFC) based on battery % discharge, toggle in Settings.';
      } else {
        title.textContent = 'Advanced Equivalent Full Cycles (EFC)';
        desc.textContent = 'Current method accumulates equivalent full cycles from depth of discharge: (Pre% - Post%) / 100. Accurate battery wear accumulation.';
      }
    }

    const container = document.getElementById('batteries-container');
    if (!container) return;

    if (state.batteries.length === 0) {
      container.innerHTML = `
        <div class="empty-state" style="grid-column: 1 / -1;">
          <div class="empty-state-icon">
            <svg class="icon"><use href="#icon-battery"></use></svg>
          </div>
          <div class="empty-state-title">No Batteries Registered in Hangar</div>
          <div class="empty-state-desc">Register your drone and aircraft power packs to track cycle wear, discharge depth, and maintenance limits.</div>
          <button type="button" class="btn btn-primary mt-3" id="btn-batteries-empty-add">
            <svg class="icon"><use href="#icon-plus"></use></svg>
            <span>Register First Battery</span>
          </button>
        </div>
      `;
      const btn = document.getElementById('btn-batteries-empty-add');
      if (btn) btn.addEventListener('click', () => openBatteryModal());
      return;
    }

    let html = '';
    state.batteries.forEach(battery => {
      const stats = calculateBatteryStats(battery);

      html += `
        <div class="battery-card" data-battery-id="${escapeHtml(battery.id)}">
          <div class="battery-card-header">
            <div>
              <div class="battery-name">${escapeHtml(battery.name)}</div>
              <div class="battery-specs-sub">
                <span>${escapeHtml(battery.chemistry)}</span>
                <span>&bull;</span>
                <span>${battery.capacity} mAh</span>
                ${battery.voltage ? `<span>&bull; ${battery.voltage}V</span>` : ''}
                ${battery.cells ? `<span>&bull; ${escapeHtml(battery.cells)}</span>` : ''}
              </div>
            </div>
            <span class="badge ${getHealthBadgeClass(stats.healthStatus)}">${stats.healthStatus}</span>
          </div>

          <!-- Cycle Progress Bar -->
          <div class="cycle-progress-wrap">
            <div class="cycle-progress-labels">
              <div>
                <span class="cycle-count-big">${stats.cyclesFormatted}</span>
                <span class="cycle-max-label">/ ${stats.maxCycles} max cycles</span>
              </div>
              <span class="text-xs text-muted">${stats.percentageUsed}% life spent</span>
            </div>
            <div class="progress-track">
              <div class="progress-bar ${stats.healthClass}" style="width: ${stats.percentageUsed}%"></div>
            </div>
          </div>

          <!-- Battery Telemetry Stats -->
          <div class="battery-stats-grid">
            <div class="batt-stat-item">
              <span class="batt-stat-label">Total Missions</span>
              <span class="batt-stat-val text-cyan">${stats.flightCount} flights</span>
            </div>
            <div class="batt-stat-item">
              <span class="batt-stat-label">Total Air Time</span>
              <span class="batt-stat-val">${formatDuration(stats.totalDurationMinutes)}</span>
            </div>
            <div class="batt-stat-item">
              <span class="batt-stat-label">Initial Cycles</span>
              <span class="batt-stat-val">${stats.initialCycles} cycles</span>
            </div>
            <div class="batt-stat-item">
              <span class="batt-stat-label">Logged Cycles</span>
              <span class="batt-stat-val">${state.settings.cycleMode === 'simple' ? stats.additionalCycles.toFixed(0) : stats.additionalCycles.toFixed(1)} cycles</span>
            </div>
            <div class="batt-stat-item" style="grid-column: 1 / -1;">
              <span class="batt-stat-label">Last Flight Mission</span>
              <span class="batt-stat-val text-muted">${stats.lastUsedDate}</span>
            </div>
          </div>

          ${battery.notes ? `<div class="text-xs text-muted"><strong>Notes:</strong> ${escapeHtml(battery.notes)}</div>` : ''}

          <div class="battery-card-footer">
            <button type="button" class="btn btn-outline btn-xs btn-battery-quick-flight" data-id="${escapeHtml(battery.id)}">
              <svg class="icon"><use href="#icon-plus"></use></svg>
              <span>Log Flight With This</span>
            </button>
            <div class="card-actions-right">
              <button type="button" class="btn btn-secondary btn-xs btn-battery-edit" data-id="${escapeHtml(battery.id)}" title="Edit battery specs">
                <svg class="icon"><use href="#icon-edit"></use></svg>
                <span class="hide-mobile">Edit</span>
              </button>
              <button type="button" class="btn btn-secondary btn-xs btn-battery-delete text-red" data-id="${escapeHtml(battery.id)}" title="Delete battery">
                <svg class="icon"><use href="#icon-trash"></use></svg>
                <span class="hide-mobile">Delete</span>
              </button>
            </div>
          </div>
        </div>
      `;
    });

    container.innerHTML = html;

    // Attach button listeners
    container.querySelectorAll('.btn-battery-quick-flight').forEach(btn => {
      btn.addEventListener('click', () => {
        openFlightModal(null, btn.dataset.id);
      });
    });

    container.querySelectorAll('.btn-battery-edit').forEach(btn => {
      btn.addEventListener('click', () => {
        openBatteryModal(btn.dataset.id);
      });
    });

    container.querySelectorAll('.btn-battery-delete').forEach(btn => {
      btn.addEventListener('click', () => {
        promptDeleteBattery(btn.dataset.id);
      });
    });
  }

  function getHealthBadgeClass(healthStatus) {
    if (healthStatus === 'Optimal') return 'badge-success';
    if (healthStatus === 'Moderate Wear') return 'badge-warning';
    if (healthStatus === 'Near End of Life') return 'badge-warning';
    return 'badge-danger';
  }

  /* =========================================================================
     VIEW RENDERING: SETTINGS VIEW
     ========================================================================= */

  function renderSettingsView() {
    const recordCountEl = document.getElementById('stats-record-count');
    if (recordCountEl) {
      recordCountEl.textContent = `${state.flights.length} flights, ${state.batteries.length} batteries`;
    }
  }

  /* =========================================================================
     MODAL MANAGEMENT: FLIGHT MODAL (CREATE / EDIT)
     ========================================================================= */

  function openFlightModal(flightId = null, preselectedBatteryId = null) {
    const modal = document.getElementById('modal-flight');
    const form = document.getElementById('form-flight');
    const title = document.getElementById('modal-flight-title');
    const alertBox = document.getElementById('flight-form-alert');
    const editIdInput = document.getElementById('flight-edit-id');

    if (!modal || !form) return;
    form.reset();
    if (alertBox) alertBox.style.display = 'none';

    // Populate batteries select
    populateFlightBatteryDropdown(preselectedBatteryId);

    if (flightId) {
      // Editing existing flight
      const flight = state.flights.find(f => f.id === flightId);
      if (!flight) return;

      title.textContent = 'Edit Flight Mission';
      editIdInput.value = flight.id;

      document.getElementById('flight-id-input').value = flight.id;
      document.getElementById('flight-id-input').disabled = true; // Protect ID integrity
      document.getElementById('flight-datetime').value = flight.date ? flight.date.slice(0, 16) : '';
      document.getElementById('flight-location').value = flight.location || '';
      document.getElementById('flight-battery-select').value = flight.batteryId || '';

      const durMins = Number(flight.duration) || 0;
      document.getElementById('flight-duration-hours').value = Math.floor(durMins / 60);
      document.getElementById('flight-duration-minutes').value = durMins % 60;

      document.getElementById('flight-status-select').value = flight.status || 'completed';
      document.getElementById('flight-mission-name').value = flight.missionName || '';
      document.getElementById('flight-pilot-name').value = flight.pilotName || '';
      document.getElementById('flight-aircraft-model').value = flight.aircraftModel || '';
      document.getElementById('flight-purpose').value = flight.purpose || '';
      document.getElementById('flight-weather').value = flight.weather || '';

      document.getElementById('flight-pre-pct').value = flight.preFlightPct !== null && flight.preFlightPct !== undefined ? flight.preFlightPct : '';
      document.getElementById('flight-post-pct').value = flight.postFlightPct !== null && flight.postFlightPct !== undefined ? flight.postFlightPct : '';

      document.getElementById('flight-notes').value = flight.notes || '';

      const hasIncCheckbox = document.getElementById('flight-has-incident');
      const incFields = document.getElementById('incident-fields-container');
      if (hasIncCheckbox && incFields) {
        hasIncCheckbox.checked = !!flight.hasIncident;
        incFields.style.display = flight.hasIncident ? 'block' : 'none';

        document.getElementById('incident-severity').value = flight.incidentSeverity || 'low';
        document.getElementById('incident-maintenance-required').checked = !!flight.maintenanceRequired;
        document.getElementById('incident-description').value = flight.incidentDescription || '';
        document.getElementById('incident-corrective-action').value = flight.correctiveAction || '';
        document.getElementById('incident-maintenance-notes').value = flight.maintenanceNotes || '';
      }

      updateCyclePreview();
    } else {
      // Creating new flight
      title.textContent = 'Log New Flight Mission';
      editIdInput.value = '';

      const flightIdInput = document.getElementById('flight-id-input');
      flightIdInput.disabled = false;
      flightIdInput.value = generateFlightId();

      // Default date & time to now
      const now = new Date();
      const localIso = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
      document.getElementById('flight-datetime').value = localIso;

      document.getElementById('flight-duration-hours').value = '0';
      document.getElementById('flight-duration-minutes').value = '25'; // convenient default

      const incFields = document.getElementById('incident-fields-container');
      if (incFields) incFields.style.display = 'none';

      updateCyclePreview();
    }

    modal.style.display = 'flex';
  }

  function closeFlightModal() {
    const modal = document.getElementById('modal-flight');
    if (modal) modal.style.display = 'none';
  }

  function populateFlightBatteryDropdown(selectedId = null) {
    const select = document.getElementById('flight-battery-select');
    if (!select) return;

    if (state.batteries.length === 0) {
      select.innerHTML = '<option value="">No batteries registered! Register a battery first.</option>';
      return;
    }

    let html = '<option value="">Select registered battery...</option>';
    state.batteries.forEach(b => {
      const stats = calculateBatteryStats(b);
      const isSelected = (selectedId && b.id === selectedId) ? 'selected' : '';
      html += `<option value="${escapeHtml(b.id)}" ${isSelected}>${escapeHtml(b.name)} &bull; ${b.capacity}mAh (${stats.cyclesFormatted} cyc)</option>`;
    });
    select.innerHTML = html;
  }

  function generateFlightId() {
    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10).replace(/-/g, '');
    const rand = Math.random().toString(36).substring(2, 6).toUpperCase();
    return `FL-${dateStr}-${rand}`;
  }

  function updateCyclePreview() {
    const preInput = document.getElementById('flight-pre-pct');
    const postInput = document.getElementById('flight-post-pct');
    const previewBox = document.getElementById('cycle-preview-badge');
    const dischargeEl = document.getElementById('cycle-preview-discharge');
    const deltaEl = document.getElementById('cycle-preview-delta');

    if (!preInput || !postInput || !previewBox) return;

    const pre = parseFloat(preInput.value);
    const post = parseFloat(postInput.value);

    if (!isNaN(pre) && !isNaN(post)) {
      if (pre >= post && pre >= 0 && post >= 0 && pre <= 100 && post <= 100) {
        const diff = pre - post;
        const delta = (diff / 100).toFixed(2);
        dischargeEl.textContent = `${diff}%`;
        deltaEl.textContent = `${delta} cycles`;
        previewBox.style.display = 'block';
        return;
      }
    }
    previewBox.style.display = 'none';
  }

  async function handleSaveFlight(e) {
    e.preventDefault();
    const alertBox = document.getElementById('flight-form-alert');
    if (alertBox) alertBox.style.display = 'none';

    // Form values
    const isEditing = !!document.getElementById('flight-edit-id').value;
    const flightId = document.getElementById('flight-id-input').value.trim();
    const dateTime = document.getElementById('flight-datetime').value;
    const location = document.getElementById('flight-location').value.trim();
    const batteryId = document.getElementById('flight-battery-select').value;

    const hours = parseInt(document.getElementById('flight-duration-hours').value, 10) || 0;
    const minutes = parseInt(document.getElementById('flight-duration-minutes').value, 10) || 0;
    const durationMinutes = (hours * 60) + minutes;

    const status = document.getElementById('flight-status-select').value;
    const missionName = document.getElementById('flight-mission-name').value.trim();
    const pilotName = document.getElementById('flight-pilot-name').value.trim();
    const aircraftModel = document.getElementById('flight-aircraft-model').value.trim();
    const purpose = document.getElementById('flight-purpose').value.trim();
    const weather = document.getElementById('flight-weather').value.trim();

    const prePctVal = document.getElementById('flight-pre-pct').value;
    const postPctVal = document.getElementById('flight-post-pct').value;
    const preFlightPct = prePctVal !== '' ? Number(prePctVal) : null;
    const postFlightPct = postPctVal !== '' ? Number(postPctVal) : null;

    const notes = document.getElementById('flight-notes').value.trim();

    const hasIncident = document.getElementById('flight-has-incident').checked;
    const incidentSeverity = document.getElementById('incident-severity').value;
    const maintenanceRequired = document.getElementById('incident-maintenance-required').checked;
    const incidentDescription = document.getElementById('incident-description').value.trim();
    const correctiveAction = document.getElementById('incident-corrective-action').value.trim();
    const maintenanceNotes = document.getElementById('incident-maintenance-notes').value.trim();

    // Required Field Validations
    if (!flightId) {
      showFormAlert(alertBox, 'Flight ID is required.');
      return;
    }

    if (!dateTime) {
      showFormAlert(alertBox, 'Flight Date & Time is required.');
      return;
    }

    if (!location) {
      showFormAlert(alertBox, 'Flight Location is required.');
      return;
    }

    if (!batteryId) {
      showFormAlert(alertBox, 'Please select a registered battery used for this flight.');
      return;
    }

    if (durationMinutes <= 0) {
      showFormAlert(alertBox, 'Flight duration must be greater than 0 minutes.');
      return;
    }

    // Check duplicate ID if new flight
    if (!isEditing) {
      const exists = state.flights.some(f => f.id === flightId);
      if (exists) {
        showFormAlert(alertBox, `Flight ID "${flightId}" already exists. Please choose a unique ID.`);
        return;
      }
    }

    // Validate battery percentages if provided
    if (preFlightPct !== null && (preFlightPct < 0 || preFlightPct > 100)) {
      showFormAlert(alertBox, 'Pre-flight battery percentage must be between 0% and 100%.');
      return;
    }
    if (postFlightPct !== null && (postFlightPct < 0 || postFlightPct > 100)) {
      showFormAlert(alertBox, 'Post-flight battery percentage must be between 0% and 100%.');
      return;
    }
    if (preFlightPct !== null && postFlightPct !== null && postFlightPct > preFlightPct) {
      showFormAlert(alertBox, 'Post-flight battery percentage cannot exceed pre-flight percentage (battery discharges during flight).');
      return;
    }

    // Validate incident description if incident checked
    if (hasIncident && !incidentDescription) {
      showFormAlert(alertBox, 'Please provide an incident description describing what occurred.');
      return;
    }

    // Create record
    const flightRecord = {
      id: flightId,
      date: new Date(dateTime).toISOString(),
      location,
      batteryId,
      duration: durationMinutes,
      status,
      missionName,
      pilotName,
      aircraftModel,
      purpose,
      weather,
      preFlightPct,
      postFlightPct,
      notes,
      hasIncident,
      incidentSeverity: hasIncident ? incidentSeverity : 'none',
      incidentDescription: hasIncident ? incidentDescription : '',
      correctiveAction: hasIncident ? correctiveAction : '',
      maintenanceRequired: hasIncident ? maintenanceRequired : false,
      maintenanceNotes: hasIncident ? maintenanceNotes : ''
    };

    try {
      await window.missionDB.saveFlight(flightRecord);

      // Update in-memory state
      const idx = state.flights.findIndex(f => f.id === flightId);
      if (idx !== -1) {
        state.flights[idx] = flightRecord;
      } else {
        state.flights.push(flightRecord);
      }

      closeFlightModal();
      renderAllViews();
      showToast(isEditing ? 'Flight mission updated.' : 'Flight mission logged successfully.', 'success');
    } catch (err) {
      console.error('Error saving flight:', err);
      showFormAlert(alertBox, 'Database error saving flight: ' + err.message);
    }
  }

  function promptDeleteFlight(flightId) {
    const flight = state.flights.find(f => f.id === flightId);
    if (!flight) return;

    openConfirmModal(
      'Delete Flight Mission',
      `Are you sure you want to delete flight "${flight.missionName || flight.id}"? All associated air time and battery cycle calculations will be updated.`,
      async () => {
        try {
          await window.missionDB.deleteFlight(flightId);
          state.flights = state.flights.filter(f => f.id !== flightId);
          renderAllViews();
          showToast(`Flight mission ${flightId} deleted.`, 'info');
        } catch (err) {
          showToast('Failed to delete flight: ' + err.message, 'error');
        }
      }
    );
  }

  /* =========================================================================
     MODAL MANAGEMENT: FLIGHT DETAILS DOSSIER
     ========================================================================= */

  function openFlightDetailsModal(flightId) {
    const flight = state.flights.find(f => f.id === flightId);
    if (!flight) return;

    const modal = document.getElementById('modal-flight-details');
    const container = document.getElementById('flight-details-content');
    if (!modal || !container) return;

    const batt = state.batteries.find(b => b.id === flight.batteryId);
    const battName = batt ? `${batt.name} (${batt.chemistry})` : (flight.batteryId || 'Unknown');
    const statusBadge = getStatusBadge(flight.status);

    let dischargeHtml = '—';
    if (flight.preFlightPct !== null && flight.postFlightPct !== null) {
      const diff = flight.preFlightPct - flight.postFlightPct;
      const efc = (diff / 100).toFixed(2);
      dischargeHtml = `${flight.preFlightPct}% &rarr; ${flight.postFlightPct}% (&Delta;${diff}% discharge &bull; ${efc} EFC)`;
    }

    let incidentSection = '';
    if (flight.hasIncident) {
      const severity = flight.incidentSeverity || 'low';
      incidentSection = `
        <div class="dossier-incident-box">
          <div class="form-section-title text-red" style="border-color: rgba(239, 68, 68, 0.3);">
            INCIDENT / ANOMALY REPORT
          </div>
          <div class="dossier-grid p-0 mb-3">
            <div class="dossier-item">
              <span class="dossier-item-label">Severity</span>
              <span class="dossier-item-value">
                <span class="badge ${getSeverityBadgeClass(severity)}">${severity.toUpperCase()}</span>
              </span>
            </div>
            <div class="dossier-item">
              <span class="dossier-item-label">Follow-Up Maintenance</span>
              <span class="dossier-item-value">${flight.maintenanceRequired ? 'Required &bull; Action Item' : 'None Required'}</span>
            </div>
          </div>
          <div class="mb-2">
            <strong class="text-sm">Incident Description:</strong>
            <p class="text-sm mt-1">${escapeHtml(flight.incidentDescription)}</p>
          </div>
          ${flight.correctiveAction ? `
            <div class="mb-2">
              <strong class="text-sm">Corrective Action Taken:</strong>
              <p class="text-sm mt-1">${escapeHtml(flight.correctiveAction)}</p>
            </div>
          ` : ''}
          ${flight.maintenanceNotes ? `
            <div>
              <strong class="text-sm">Maintenance Observations:</strong>
              <p class="text-sm mt-1">${escapeHtml(flight.maintenanceNotes)}</p>
            </div>
          ` : ''}
        </div>
      `;
    }

    container.innerHTML = `
      <div class="dossier-hero">
        <div>
          <div class="dossier-mission-name">${escapeHtml(flight.missionName || flight.location || 'Flight Mission')}</div>
          <div class="dossier-meta">
            <span><strong>ID:</strong> ${escapeHtml(flight.id)}</span>
            <span>&bull;</span>
            <span><strong>Date:</strong> ${formatDateString(flight.date)}</span>
            <span>&bull;</span>
            <span><strong>Location:</strong> ${escapeHtml(flight.location)}</span>
          </div>
        </div>
        <div>${statusBadge}</div>
      </div>

      <div class="dossier-grid">
        <div class="dossier-item">
          <span class="dossier-item-label">Flight Duration</span>
          <span class="dossier-item-value text-cyan">${formatDuration(flight.duration)}</span>
        </div>
        <div class="dossier-item">
          <span class="dossier-item-label">Battery Pack Assigned</span>
          <span class="dossier-item-value text-amber">${escapeHtml(battName)}</span>
        </div>
        <div class="dossier-item">
          <span class="dossier-item-label">Discharge & Delta Cycles</span>
          <span class="dossier-item-value">${dischargeHtml}</span>
        </div>
        <div class="dossier-item">
          <span class="dossier-item-label">Aircraft / Drone</span>
          <span class="dossier-item-value">${escapeHtml(flight.aircraftModel || '—')}</span>
        </div>
        <div class="dossier-item">
          <span class="dossier-item-label">Pilot / Operator</span>
          <span class="dossier-item-value">${escapeHtml(flight.pilotName || '—')}</span>
        </div>
        <div class="dossier-item">
          <span class="dossier-item-label">Flight Purpose</span>
          <span class="dossier-item-value">${escapeHtml(flight.purpose || '—')}</span>
        </div>
        <div class="dossier-item" style="grid-column: 1 / -1;">
          <span class="dossier-item-label">Weather Conditions</span>
          <span class="dossier-item-value">${escapeHtml(flight.weather || '—')}</span>
        </div>
      </div>

      ${flight.notes ? `
        <div class="dossier-notes-box">
          <strong class="text-sm">Pilot Notes & Observations:</strong>
          <p class="text-sm mt-1">${escapeHtml(flight.notes)}</p>
        </div>
      ` : ''}

      ${incidentSection}
    `;

    // Hook modal buttons
    const editBtn = document.getElementById('btn-details-edit');
    const deleteBtn = document.getElementById('btn-details-delete');
    if (editBtn) {
      editBtn.onclick = () => {
        closeFlightDetailsModal();
        openFlightModal(flight.id);
      };
    }
    if (deleteBtn) {
      deleteBtn.onclick = () => {
        closeFlightDetailsModal();
        promptDeleteFlight(flight.id);
      };
    }

    modal.style.display = 'flex';
  }

  function closeFlightDetailsModal() {
    const modal = document.getElementById('modal-flight-details');
    if (modal) modal.style.display = 'none';
  }

  /* =========================================================================
     MODAL MANAGEMENT: BATTERY MODAL (CREATE / EDIT)
     ========================================================================= */

  function openBatteryModal(batteryId = null) {
    const modal = document.getElementById('modal-battery');
    const form = document.getElementById('form-battery');
    const title = document.getElementById('modal-battery-title');
    const alertBox = document.getElementById('battery-form-alert');
    const editIdInput = document.getElementById('battery-edit-id');

    if (!modal || !form) return;
    form.reset();
    if (alertBox) alertBox.style.display = 'none';

    if (batteryId) {
      const battery = state.batteries.find(b => b.id === batteryId);
      if (!battery) return;

      title.textContent = 'Edit Battery Pack';
      editIdInput.value = battery.id;

      const idInput = document.getElementById('battery-id-input');
      idInput.value = battery.name || battery.id;
      idInput.disabled = true; // Protect ID

      document.getElementById('battery-chemistry').value = battery.chemistry || 'LiPo';
      document.getElementById('battery-capacity').value = battery.capacity || '';
      document.getElementById('battery-voltage').value = battery.voltage || '';
      document.getElementById('battery-cells').value = battery.cells || '';
      document.getElementById('battery-purchase-date').value = battery.purchaseDate || '';
      document.getElementById('battery-initial-cycles').value = battery.initialCycles !== undefined ? battery.initialCycles : 0;
      document.getElementById('battery-max-cycles').value = battery.maxCycles || 300;
      document.getElementById('battery-notes').value = battery.notes || '';
    } else {
      title.textContent = 'Register Battery';
      editIdInput.value = '';

      const idInput = document.getElementById('battery-id-input');
      idInput.disabled = false;
      idInput.value = '';

      document.getElementById('battery-initial-cycles').value = '0';
      document.getElementById('battery-max-cycles').value = '300';
    }

    modal.style.display = 'flex';
  }

  function closeBatteryModal() {
    const modal = document.getElementById('modal-battery');
    if (modal) modal.style.display = 'none';
  }

  async function handleSaveBattery(e) {
    e.preventDefault();
    const alertBox = document.getElementById('battery-form-alert');
    if (alertBox) alertBox.style.display = 'none';

    const isEditing = !!document.getElementById('battery-edit-id').value;
    const nameOrId = document.getElementById('battery-id-input').value.trim();
    const chemistry = document.getElementById('battery-chemistry').value;
    const capacity = Number(document.getElementById('battery-capacity').value);
    const voltage = Number(document.getElementById('battery-voltage').value) || null;
    const cells = document.getElementById('battery-cells').value.trim();
    const purchaseDate = document.getElementById('battery-purchase-date').value;
    const initialCycles = Number(document.getElementById('battery-initial-cycles').value) || 0;
    const maxCycles = Number(document.getElementById('battery-max-cycles').value) || 300;
    const notes = document.getElementById('battery-notes').value.trim();

    if (!nameOrId) {
      showFormAlert(alertBox, 'Battery ID / Custom Name is required.');
      return;
    }

    if (!capacity || capacity <= 0) {
      showFormAlert(alertBox, 'Capacity in mAh must be a positive number.');
      return;
    }

    if (maxCycles <= 0) {
      showFormAlert(alertBox, 'Maximum recommended cycles must be greater than 0.');
      return;
    }

    const batteryId = isEditing ? document.getElementById('battery-edit-id').value : nameOrId;

    if (!isEditing) {
      const exists = state.batteries.some(b => b.id.toLowerCase() === batteryId.toLowerCase());
      if (exists) {
        showFormAlert(alertBox, `Battery with ID "${batteryId}" already exists. Please choose a unique name.`);
        return;
      }
    }

    const batteryRecord = {
      id: batteryId,
      name: nameOrId,
      chemistry,
      capacity,
      voltage,
      cells,
      purchaseDate,
      initialCycles,
      maxCycles,
      notes
    };

    try {
      await window.missionDB.saveBattery(batteryRecord);

      const idx = state.batteries.findIndex(b => b.id === batteryId);
      if (idx !== -1) {
        state.batteries[idx] = batteryRecord;
      } else {
        state.batteries.push(batteryRecord);
      }

      closeBatteryModal();
      renderAllViews();
      showToast(isEditing ? 'Battery pack updated.' : 'Battery registered in hangar.', 'success');
    } catch (err) {
      console.error('Error saving battery:', err);
      showFormAlert(alertBox, 'Database error saving battery: ' + err.message);
    }
  }

  function promptDeleteBattery(batteryId) {
    const battery = state.batteries.find(b => b.id === batteryId);
    if (!battery) return;

    const associatedFlights = state.flights.filter(f => f.batteryId === batteryId);
    let warningMsg = `Are you sure you want to delete battery "${battery.name}"?`;
    if (associatedFlights.length > 0) {
      warningMsg += ` Note: ${associatedFlights.length} flights are currently logged using this battery. Deleting the battery record will affect fleet statistics.`;
    }

    openConfirmModal(
      'Delete Battery Pack',
      warningMsg,
      async () => {
        try {
          await window.missionDB.deleteBattery(batteryId);
          state.batteries = state.batteries.filter(b => b.id !== batteryId);
          renderAllViews();
          showToast(`Battery "${battery.name}" removed from hangar.`, 'info');
        } catch (err) {
          showToast('Failed to delete battery: ' + err.message, 'error');
        }
      }
    );
  }

  /* =========================================================================
     CSV EXPORT FUNCTIONALITY (RFC 4180 & FORMULA INJECTION DEFENSE)
     ========================================================================= */

  /**
   * Safely escapes a single cell for CSV output.
   * Defends against CSV Formula Injection (=, +, -, @, \t, \r).
   * Escapes commas, quotes, and newlines properly according to RFC 4180.
   */
  function escapeCsvCell(val) {
    if (val === null || val === undefined) return '""';
    let str = String(val);

    // Formula Injection Defense
    if (/^[=+\-@\t\r]/.test(str)) {
      str = "'" + str;
    }

    // Escape quotes and wrap
    if (str.includes('"') || str.includes(',') || str.includes('\n') || str.includes('\r')) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return `"${str}"`;
  }

  function downloadCsvFile(content, filename) {
    // Add UTF-8 BOM (\uFEFF) for Microsoft Excel compatibility
    const blob = new Blob(['\uFEFF' + content], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    showToast(`Downloaded CSV: ${filename}`, 'success');
  }

  function getExportTimestamp() {
    const now = new Date();
    return now.toISOString().slice(0, 10).replace(/-/g, '');
  }

  // Export A: All Flights
  function exportAllFlightsCsv() {
    if (state.flights.length === 0) {
      showToast('No flights available to export.', 'warning');
      return;
    }
    generateAndDownloadFlightsCsv(state.flights, `mission_log_all_flights_${getExportTimestamp()}.csv`);
  }

  // Export B: Battery Summary
  function exportBatteriesSummaryCsv() {
    if (state.batteries.length === 0) {
      showToast('No batteries registered to export.', 'warning');
      return;
    }

    const headers = [
      'Battery ID',
      'Name',
      'Chemistry',
      'Capacity (mAh)',
      'Nominal Voltage (V)',
      'Cells',
      'Purchase Date',
      'Initial Cycles',
      'Total Recorded Flights',
      'Total Flight Duration (min)',
      'Total Flight Duration (formatted)',
      'Additional Recorded Cycles',
      'Current Total Cycles',
      'Max Recommended Cycles',
      'Health Status',
      'Health Percentage (%)',
      'Last Used Date',
      'Cycle Counting Mode',
      'Notes'
    ];

    const rows = state.batteries.map(battery => {
      const stats = calculateBatteryStats(battery);
      return [
        battery.id,
        battery.name,
        battery.chemistry,
        battery.capacity,
        battery.voltage || '',
        battery.cells || '',
        battery.purchaseDate || '',
        stats.initialCycles,
        stats.flightCount,
        stats.totalDurationMinutes,
        formatDuration(stats.totalDurationMinutes),
        state.settings.cycleMode === 'simple' ? stats.additionalCycles.toFixed(0) : stats.additionalCycles.toFixed(2),
        stats.cyclesFormatted,
        stats.maxCycles,
        stats.healthStatus,
        `${stats.percentageUsed}%`,
        stats.lastUsedDate,
        state.settings.cycleMode === 'simple' ? 'Simple Usage (1:1)' : 'Advanced (EFC)',
        battery.notes || ''
      ].map(escapeCsvCell).join(',');
    });

    const csv = [headers.map(escapeCsvCell).join(','), ...rows].join('\r\n');
    downloadCsvFile(csv, `mission_log_battery_summary_${getExportTimestamp()}.csv`);
  }

  // Export C: Filtered Flights
  function exportFilteredFlightsCsv() {
    const filtered = getFilteredFlights();
    if (filtered.length === 0) {
      showToast('No flights match the current active filter criteria.', 'warning');
      return;
    }
    generateAndDownloadFlightsCsv(filtered, `mission_log_filtered_flights_${getExportTimestamp()}.csv`);
  }

  function generateAndDownloadFlightsCsv(flightsList, filename) {
    const headers = [
      'Flight ID',
      'Date & Time',
      'Mission Name',
      'Location',
      'Battery ID',
      'Battery Name',
      'Duration (Minutes)',
      'Duration (Formatted)',
      'Flight Status',
      'Pilot Name',
      'Aircraft Model',
      'Flight Purpose',
      'Weather',
      'Pre-Flight Battery (%)',
      'Post-Flight Battery (%)',
      'Discharge (%)',
      'Flight Notes',
      'Incident Occurred',
      'Incident Severity',
      'Incident Description',
      'Corrective Action',
      'Follow-Up Maintenance Required',
      'Maintenance Notes'
    ];

    const rows = flightsList.map(flight => {
      const batt = state.batteries.find(b => b.id === flight.batteryId);
      const battName = batt ? batt.name : (flight.batteryId || '');
      const discharge = (flight.preFlightPct !== null && flight.postFlightPct !== null)
        ? (flight.preFlightPct - flight.postFlightPct)
        : '';

      return [
        flight.id,
        flight.date,
        flight.missionName || '',
        flight.location,
        flight.batteryId,
        battName,
        flight.duration,
        formatDuration(flight.duration),
        flight.status,
        flight.pilotName || '',
        flight.aircraftModel || '',
        flight.purpose || '',
        flight.weather || '',
        flight.preFlightPct !== null ? flight.preFlightPct : '',
        flight.postFlightPct !== null ? flight.postFlightPct : '',
        discharge,
        flight.notes || '',
        flight.hasIncident ? 'YES' : 'NO',
        flight.hasIncident ? flight.incidentSeverity : 'NONE',
        flight.hasIncident ? (flight.incidentDescription || '') : '',
        flight.hasIncident ? (flight.correctiveAction || '') : '',
        flight.hasIncident ? (flight.maintenanceRequired ? 'YES' : 'NO') : 'NO',
        flight.hasIncident ? (flight.maintenanceNotes || '') : ''
      ].map(escapeCsvCell).join(',');
    });

    const csv = [headers.map(escapeCsvCell).join(','), ...rows].join('\r\n');
    downloadCsvFile(csv, filename);
  }

  /* =========================================================================
     DATA BACKUP & RESTORE (JSON)
     ========================================================================= */

  async function exportJsonBackup() {
    try {
      const data = await window.missionDB.exportFullDatabase();
      const jsonString = JSON.stringify(data, null, 2);
      const blob = new Blob([jsonString], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const filename = `mission_log_backup_${new Date().toISOString().replace(/[:.]/g, '-')}.json`;

      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      showToast(`Exported complete JSON backup.`, 'success');
    } catch (err) {
      console.error('Backup error:', err);
      showToast('Failed to create backup: ' + err.message, 'error');
    }
  }

  function handleImportFileSelect(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (evt) => {
      try {
        const text = evt.target.result;
        const backupData = JSON.parse(text);

        if (!backupData || (typeof backupData !== 'object')) {
          throw new Error('File does not contain valid JSON object.');
        }

        const flightsCount = Array.isArray(backupData.flights) ? backupData.flights.length : 0;
        const batteriesCount = Array.isArray(backupData.batteries) ? backupData.batteries.length : 0;

        if (flightsCount === 0 && batteriesCount === 0) {
          throw new Error('Backup contains neither flight records nor battery data.');
        }

        openConfirmModal(
          'Restore Database Backup',
          `Found ${flightsCount} flights and ${batteriesCount} batteries in backup file. Do you want to replace your current local database with this backup?`,
          async () => {
            try {
              await window.missionDB.importData(backupData, 'replace');
              await loadSettings();
              await loadData();
              showToast(`Restored ${flightsCount} flights and ${batteriesCount} batteries successfully.`, 'success');
            } catch (err) {
              showToast('Import error: ' + err.message, 'error');
            }
          }
        );
      } catch (err) {
        showToast('Invalid backup file: ' + err.message, 'error');
      } finally {
        e.target.value = ''; // Reset file input
      }
    };

    reader.onerror = () => {
      showToast('Error reading backup file.', 'error');
      e.target.value = '';
    };

    reader.readAsText(file);
  }

  async function handleClearAllData() {
    openConfirmModal(
      'Factory Reset / Clear All Data',
      'WARNING: This will permanently wipe all local flights, batteries, and settings stored in this browser. This action CANNOT be undone. Have you exported a JSON backup?',
      async () => {
        try {
          await window.missionDB.clearAllData();
          state.flights = [];
          state.batteries = [];
          state.settings = { cycleMode: 'simple', durationFormat: 'hm', theme: 'minimal' };
          applyTheme('minimal');
          renderAllViews();
          showToast('Local database cleared.', 'info');
        } catch (err) {
          showToast('Failed to clear database: ' + err.message, 'error');
        }
      }
    );
  }

  /* =========================================================================
     SAMPLE DEMO AVIATION DATA LOADER
     ========================================================================= */

  async function loadSampleDemoData() {
    openConfirmModal(
      'Load Aviation Demo Data',
      'Load sample drone and aircraft batteries along with 4 realistic flight sorties (including survey, patrol, and anomaly incident)?',
      async () => {
        const sampleBatteries = [
          {
            id: 'BATT-6S-5000-A',
            name: 'LiPo 6S 5000mAh Pack A',
            chemistry: 'LiPo',
            capacity: 5000,
            voltage: 22.2,
            cells: '6S',
            purchaseDate: '2026-06-15',
            initialCycles: 12,
            maxCycles: 250,
            notes: 'High discharge rate pack for survey drone payload.'
          },
          {
            id: 'BATT-TB65-01',
            name: 'TB65 Intelligent Flight Pack 01',
            chemistry: 'Li-ion',
            capacity: 13120,
            voltage: 44.76,
            cells: '12S',
            purchaseDate: '2026-08-01',
            initialCycles: 4,
            maxCycles: 400,
            notes: 'Commercial enterprise drone twin pack.'
          }
        ];

        const now = new Date();
        const makeDate = (daysAgo, hour = 10, min = 30) => {
          const d = new Date(now.getTime() - daysAgo * 86400000);
          d.setHours(hour, min, 0, 0);
          return d.toISOString();
        };

        const sampleFlights = [
          {
            id: 'FL-20261001-A912',
            date: makeDate(8, 9, 15),
            location: 'Airfield Alpha, Sector 4',
            batteryId: 'BATT-6S-5000-A',
            duration: 38,
            status: 'completed',
            missionName: 'North Perimeter High-Res Photogrammetry',
            pilotName: 'Capt. Cole',
            aircraftModel: 'DJI Matrice 350 RTK',
            purpose: 'Mapping & Survey',
            weather: 'Clear, 7kt Wind NW, 21°C',
            preFlightPct: 100,
            postFlightPct: 32,
            notes: 'Grid mapping completed with 80% front and side overlap. Zero anomalies.',
            hasIncident: false,
            incidentSeverity: 'none',
            incidentDescription: '',
            correctiveAction: '',
            maintenanceRequired: false,
            maintenanceNotes: ''
          },
          {
            id: 'FL-20261003-B488',
            date: makeDate(6, 14, 0),
            location: 'Ridge Crest Telecom Tower',
            batteryId: 'BATT-TB65-01',
            duration: 45,
            status: 'completed',
            missionName: 'Infrastructure Mast Inspection',
            pilotName: 'Capt. Cole',
            aircraftModel: 'DJI Matrice 350 RTK',
            purpose: 'Asset Inspection',
            weather: 'Scattered clouds, 12kt gusts',
            preFlightPct: 98,
            postFlightPct: 40,
            notes: 'Structural imagery gathered cleanly. Obstacle radar functioned normally.',
            hasIncident: false,
            incidentSeverity: 'none',
            incidentDescription: '',
            correctiveAction: '',
            maintenanceRequired: false,
            maintenanceNotes: ''
          },
          {
            id: 'FL-20261006-C319',
            date: makeDate(3, 11, 20),
            location: 'West Valley Basin',
            batteryId: 'BATT-6S-5000-A',
            duration: 22,
            status: 'aborted',
            missionName: 'Topographical Grid Scan — Aborted',
            pilotName: 'Operator Maya',
            aircraftModel: 'Custom 7-inch Quad',
            purpose: 'Survey Sortie',
            weather: 'Sudden gust front, 24kt wind',
            preFlightPct: 99,
            postFlightPct: 65,
            notes: 'Telemetry warning triggered when wind shear exceeded max design limit.',
            hasIncident: true,
            incidentSeverity: 'medium',
            incidentDescription: 'Severe wind turbulence caused motor #3 ESC temperature spike and 15% heading deflection.',
            correctiveAction: 'Manual override engaged immediately; executed return-to-home protocol and touched down safely.',
            maintenanceRequired: true,
            maintenanceNotes: 'Inspect ESC cooling sink and inspect prop lock nuts before next sortie.'
          },
          {
            id: 'FL-20261008-D702',
            date: makeDate(1, 16, 45),
            location: 'Central Runway Training Zone',
            batteryId: 'BATT-TB65-01',
            duration: 52,
            status: 'completed',
            missionName: 'Pilot Recertification Sortie',
            pilotName: 'Capt. Mitchell',
            aircraftModel: 'DJI Matrice 350 RTK',
            purpose: 'Pilot Training',
            weather: 'Calm, 3kt wind, 24°C',
            preFlightPct: 100,
            postFlightPct: 28,
            notes: 'Night ops lighting test and manual compass calibration flight.',
            hasIncident: false,
            incidentSeverity: 'none',
            incidentDescription: '',
            correctiveAction: '',
            maintenanceRequired: false,
            maintenanceNotes: ''
          }
        ];

        try {
          for (const b of sampleBatteries) {
            await window.missionDB.saveBattery(b);
          }
          for (const f of sampleFlights) {
            await window.missionDB.saveFlight(f);
          }
          await loadData();
          showToast('Sample aviation demo data loaded successfully.', 'success');
        } catch (err) {
          showToast('Error loading demo data: ' + err.message, 'error');
        }
      }
    );
  }

  /* =========================================================================
     MODAL MANAGEMENT: CONFIRM ACTION
     ========================================================================= */

  function openConfirmModal(title, message, callback) {
    const modal = document.getElementById('modal-confirm');
    const titleEl = document.getElementById('confirm-modal-title');
    const msgEl = document.getElementById('confirm-modal-message');
    const proceedBtn = document.getElementById('btn-confirm-proceed');

    if (!modal) return;

    if (titleEl) titleEl.textContent = title;
    if (msgEl) msgEl.textContent = message;

    state.confirmCallback = callback;
    modal.style.display = 'flex';

    if (proceedBtn) {
      proceedBtn.onclick = async () => {
        const cb = state.confirmCallback;
        closeConfirmModal();
        if (typeof cb === 'function') {
          try {
            await cb();
          } catch (err) {
            console.error('Confirm action error:', err);
            showToast('Action failed: ' + err.message, 'error');
          }
        }
      };
    }
  }

  function closeConfirmModal() {
    const modal = document.getElementById('modal-confirm');
    if (modal) modal.style.display = 'none';
    state.confirmCallback = null;
  }

  /* =========================================================================
     HELPERS & UI UTILITIES
     ========================================================================= */

  function getStatusBadge(status) {
    switch (status) {
      case 'completed':
        return '<span class="badge badge-success">Completed</span>';
      case 'aborted':
        return '<span class="badge badge-warning">Aborted</span>';
      case 'emergency':
        return '<span class="badge badge-danger">Emergency</span>';
      default:
        return `<span class="badge badge-neutral">${escapeHtml(status || 'Unknown')}</span>`;
    }
  }

  function getSeverityBadgeClass(severity) {
    switch (severity) {
      case 'low': return 'badge-info';
      case 'medium': return 'badge-warning';
      case 'high': return 'badge-warning';
      case 'critical': return 'badge-danger';
      default: return 'badge-neutral';
    }
  }

  function showFormAlert(alertBox, message) {
    if (!alertBox) return;
    alertBox.textContent = message;
    alertBox.style.display = 'block';
    alertBox.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;

    let iconSymbol = '#icon-check';
    if (type === 'error') iconSymbol = '#icon-alert';
    if (type === 'warning') iconSymbol = '#icon-alert';
    if (type === 'info') iconSymbol = '#icon-crosshair';

    toast.innerHTML = `
      <svg class="icon"><use href="${iconSymbol}"></use></svg>
      <span>${escapeHtml(message)}</span>
    `;

    container.appendChild(toast);

    setTimeout(() => {
      toast.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(10px)';
      setTimeout(() => {
        if (toast.parentNode) toast.parentNode.removeChild(toast);
      }, 300);
    }, 4000);
  }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  /* =========================================================================
     GLOBAL EVENT LISTENERS ATTACHMENT
     ========================================================================= */

  function initEventListeners() {
    // Navigation listeners
    document.querySelectorAll('.nav-item, .bottom-nav-item').forEach(btn => {
      btn.addEventListener('click', () => {
        const view = btn.dataset.view;
        if (view) switchView(view);
      });
    });

    // Quick Log Buttons
    const sidebarQuickLog = document.getElementById('btn-quick-log-sidebar');
    if (sidebarQuickLog) sidebarQuickLog.addEventListener('click', () => openFlightModal());

    const headerQuickLog = document.getElementById('btn-quick-log-header');
    if (headerQuickLog) headerQuickLog.addEventListener('click', () => openFlightModal());

    const dashQuickLog = document.getElementById('btn-dash-quick-log');
    if (dashQuickLog) dashQuickLog.addEventListener('click', () => openFlightModal());

    const fabLogFlight = document.getElementById('fab-log-flight');
    if (fabLogFlight) fabLogFlight.addEventListener('click', () => openFlightModal());

    const toolbarLogFlight = document.getElementById('btn-log-flight-toolbar');
    if (toolbarLogFlight) toolbarLogFlight.addEventListener('click', () => openFlightModal());

    // Dashboard Buttons
    const viewAllFlightsBtn = document.getElementById('btn-view-all-flights');
    if (viewAllFlightsBtn) viewAllFlightsBtn.addEventListener('click', () => switchView('flights'));

    const dashExportFlights = document.getElementById('btn-dash-export-flights');
    if (dashExportFlights) dashExportFlights.addEventListener('click', exportAllFlightsCsv);

    const dashExportBatteries = document.getElementById('btn-dash-export-batteries');
    if (dashExportBatteries) dashExportBatteries.addEventListener('click', exportBatteriesSummaryCsv);

    const toggleCycleModeBtn = document.getElementById('btn-toggle-cycle-mode');
    if (toggleCycleModeBtn) toggleCycleModeBtn.addEventListener('click', () => switchView('settings'));

    // Flights Toolbar: Search & Filters
    const searchInput = document.getElementById('flights-search-input');
    const clearSearchBtn = document.getElementById('btn-clear-search');
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        state.filters.search = e.target.value.trim();
        if (clearSearchBtn) {
          clearSearchBtn.style.display = state.filters.search ? 'block' : 'none';
        }
        renderFlightsView();
      });
    }

    if (clearSearchBtn) {
      clearSearchBtn.addEventListener('click', () => {
        if (searchInput) searchInput.value = '';
        state.filters.search = '';
        clearSearchBtn.style.display = 'none';
        renderFlightsView();
      });
    }

    const filterToggleBtn = document.getElementById('btn-toggle-filters');
    const filterPanel = document.getElementById('filter-panel');
    if (filterToggleBtn && filterPanel) {
      filterToggleBtn.addEventListener('click', () => {
        const isHidden = filterPanel.style.display === 'none';
        filterPanel.style.display = isHidden ? 'block' : 'none';
      });
    }

    const filterDateFrom = document.getElementById('filter-date-from');
    if (filterDateFrom) filterDateFrom.addEventListener('change', (e) => {
      state.filters.dateFrom = e.target.value;
      renderFlightsView();
    });

    const filterDateTo = document.getElementById('filter-date-to');
    if (filterDateTo) filterDateTo.addEventListener('change', (e) => {
      state.filters.dateTo = e.target.value;
      renderFlightsView();
    });

    const filterBattery = document.getElementById('filter-battery');
    if (filterBattery) filterBattery.addEventListener('change', (e) => {
      state.filters.batteryId = e.target.value;
      renderFlightsView();
    });

    const filterStatus = document.getElementById('filter-status');
    if (filterStatus) filterStatus.addEventListener('change', (e) => {
      state.filters.status = e.target.value;
      renderFlightsView();
    });

    const filterIncident = document.getElementById('filter-incident');
    if (filterIncident) filterIncident.addEventListener('change', (e) => {
      state.filters.incident = e.target.value;
      renderFlightsView();
    });

    const sortFlights = document.getElementById('sort-flights');
    if (sortFlights) sortFlights.addEventListener('change', (e) => {
      state.filters.sort = e.target.value;
      renderFlightsView();
    });

    const resetFiltersBtn = document.getElementById('btn-reset-filters');
    if (resetFiltersBtn) resetFiltersBtn.addEventListener('click', resetFilters);

    // Export Dropdown
    const exportDropdownToggle = document.getElementById('btn-export-dropdown-toggle');
    const exportDropdownMenu = document.getElementById('export-dropdown-menu');
    if (exportDropdownToggle && exportDropdownMenu) {
      exportDropdownToggle.addEventListener('click', (e) => {
        e.stopPropagation();
        exportDropdownMenu.classList.toggle('show');
      });
      document.addEventListener('click', () => {
        exportDropdownMenu.classList.remove('show');
      });
    }

    const exportAllFlightsBtn = document.getElementById('btn-export-all-flights-csv');
    if (exportAllFlightsBtn) exportAllFlightsBtn.addEventListener('click', exportAllFlightsCsv);

    const exportFilteredFlightsBtn = document.getElementById('btn-export-filtered-flights-csv');
    if (exportFilteredFlightsBtn) exportFilteredFlightsBtn.addEventListener('click', exportFilteredFlightsCsv);

    // Batteries Toolbar Buttons
    const registerBatteryBtn = document.getElementById('btn-register-battery');
    if (registerBatteryBtn) registerBatteryBtn.addEventListener('click', () => openBatteryModal());

    const exportBatteriesCsvBtn = document.getElementById('btn-export-batteries-csv');
    if (exportBatteriesCsvBtn) exportBatteriesCsvBtn.addEventListener('click', exportBatteriesSummaryCsv);

    const switchCycleModeBattsBtn = document.getElementById('btn-switch-cycle-mode-batteries');
    if (switchCycleModeBattsBtn) switchCycleModeBattsBtn.addEventListener('click', () => switchView('settings'));

    // Flight Form Actions
    const formFlight = document.getElementById('form-flight');
    if (formFlight) formFlight.addEventListener('submit', handleSaveFlight);

    const closeFlightBtn = document.getElementById('btn-close-flight-modal');
    if (closeFlightBtn) closeFlightBtn.addEventListener('click', closeFlightModal);

    const cancelFlightBtn = document.getElementById('btn-cancel-flight-modal');
    if (cancelFlightBtn) cancelFlightBtn.addEventListener('click', closeFlightModal);

    const prePctInput = document.getElementById('flight-pre-pct');
    const postPctInput = document.getElementById('flight-post-pct');
    if (prePctInput) prePctInput.addEventListener('input', updateCyclePreview);
    if (postPctInput) postPctInput.addEventListener('input', updateCyclePreview);

    const hasIncidentCheckbox = document.getElementById('flight-has-incident');
    const incidentFields = document.getElementById('incident-fields-container');
    if (hasIncidentCheckbox && incidentFields) {
      hasIncidentCheckbox.addEventListener('change', () => {
        incidentFields.style.display = hasIncidentCheckbox.checked ? 'block' : 'none';
      });
    }

    // Battery Form Actions
    const formBattery = document.getElementById('form-battery');
    if (formBattery) formBattery.addEventListener('submit', handleSaveBattery);

    const closeBatteryBtn = document.getElementById('btn-close-battery-modal');
    if (closeBatteryBtn) closeBatteryBtn.addEventListener('click', closeBatteryModal);

    const cancelBatteryBtn = document.getElementById('btn-cancel-battery-modal');
    if (cancelBatteryBtn) cancelBatteryBtn.addEventListener('click', closeBatteryModal);

    // Flight Details Modal Close
    const closeDetailsBtn1 = document.getElementById('btn-close-details-modal');
    if (closeDetailsBtn1) closeDetailsBtn1.addEventListener('click', closeFlightDetailsModal);

    const closeDetailsBtn2 = document.getElementById('btn-close-details-btn');
    if (closeDetailsBtn2) closeDetailsBtn2.addEventListener('click', closeFlightDetailsModal);

    // Confirm Modal Close
    const closeConfirmBtn = document.getElementById('btn-close-confirm-modal');
    if (closeConfirmBtn) closeConfirmBtn.addEventListener('click', closeConfirmModal);

    const cancelConfirmBtn = document.getElementById('btn-confirm-cancel');
    if (cancelConfirmBtn) cancelConfirmBtn.addEventListener('click', closeConfirmModal);

    // Close Modals on Overlay Click
    document.querySelectorAll('.modal-overlay').forEach(overlay => {
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) {
          overlay.style.display = 'none';
        }
      });
    });

    // Settings Radio: Cycle Mode
    document.querySelectorAll('input[name="setting-cycle-mode"]').forEach(radio => {
      radio.addEventListener('change', async (e) => {
        if (e.target.checked) {
          await saveSetting('cycleMode', e.target.value);
          showToast(`Cycle counting changed to: ${e.target.value === 'simple' ? 'Simple Usage (1:1)' : 'Advanced (EFC)'}`, 'info');
        }
      });
    });

    // Settings: Duration Format
    const settingDurFormat = document.getElementById('setting-duration-format');
    if (settingDurFormat) {
      settingDurFormat.addEventListener('change', async (e) => {
        await saveSetting('durationFormat', e.target.value);
      });
    }

    // Settings: Theme
    const settingTheme = document.getElementById('setting-theme');
    if (settingTheme) {
      settingTheme.addEventListener('change', async (e) => {
        const theme = e.target.value;
        applyTheme(theme);
        await saveSetting('theme', theme);
      });
    }

    // Backup & Restore Buttons
    const exportBackupBtn = document.getElementById('btn-export-backup-json');
    if (exportBackupBtn) exportBackupBtn.addEventListener('click', exportJsonBackup);

    const importFileInput = document.getElementById('input-import-backup-file');
    if (importFileInput) importFileInput.addEventListener('change', handleImportFileSelect);

    const loadDemoDataBtn = document.getElementById('btn-load-demo-data');
    if (loadDemoDataBtn) loadDemoDataBtn.addEventListener('click', loadSampleDemoData);

    const clearAllDataBtn = document.getElementById('btn-clear-all-data');
    if (clearAllDataBtn) clearAllDataBtn.addEventListener('click', handleClearAllData);

    // Keyboard Shortcuts (Escape to close modals)
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        closeFlightModal();
        closeBatteryModal();
        closeFlightDetailsModal();
        closeConfirmModal();
      }
    });
  }

})();
