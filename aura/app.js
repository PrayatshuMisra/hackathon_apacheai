// ApacheAI - Intelligent Aviation Weather Briefings (MVP SPA)

// ---------- Supabase Client (Browser ESM via CDN) ----------
// Provide your credentials at runtime by defining window.SUPABASE_URL and window.SUPABASE_ANON_KEY
// e.g., in the browser console: window.SUPABASE_URL = 'https://xyz.supabase.co'; window.SUPABASE_ANON_KEY = '...'; then reload
let supabase = null;
let supabaseReady = false;
(async () => {
  try {
    const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2');
    const SUPABASE_URL = window.SUPABASE_URL || '';
    const SUPABASE_ANON_KEY = window.SUPABASE_ANON_KEY || '';
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
      console.warn('Supabase not configured. Set window.SUPABASE_URL and window.SUPABASE_ANON_KEY.');
    } else {
      supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
      supabaseReady = true;
    }
  } catch (e) {
    console.warn('Failed to initialize Supabase client:', e);
  }
})();

async function savePirepRecord(record) {
  try {
    if (!supabase || !supabaseReady) {
      console.warn('Supabase client not ready; skipping save.');
      return { skipped: true };
    }
    const { error } = await supabase.from('pireps').insert([record]);
    if (error) throw error;
    return { success: true };
  } catch (err) {
    console.error('Failed to save PIREP to Supabase:', err);
    return { error: String(err && err.message || err) };
  }
}

function parseIcaoFromPirep(pirepLine) {
  try {
    if (!pirepLine) return '';
    const m = pirepLine.match(/\b\/OV\s+([A-Z]{3,4})\b/);
    return (m && m[1]) || '';
  } catch { return ''; }
}

function toUtcIsoString(d) {
  try { return (d instanceof Date ? d : new Date(d)).toISOString(); } catch { return new Date().toISOString(); }
}

const AppState = {
  route: '/',
  data: null,
  params: {},
};

const routes = {
  '/': renderLanding,
  '/plan': renderFlightPlan,
  '/briefing': renderBriefing,
};

function navigate(path, params = {}) {
  AppState.route = path;
  AppState.params = params;
  window.history.pushState({ path, params }, '', path);
  render();
}

window.onpopstate = (e) => {
  if (e.state) {
    AppState.route = e.state.path;
    AppState.params = e.state.params || {};
  } else {
    AppState.route = window.location.pathname;
  }
  render();
};

function $(sel) { return document.querySelector(sel); }

function render() {
  const app = document.getElementById('app');
  if (!app) return;

  // Clear existing content
  app.innerHTML = '';

  // Render the appropriate view based on the current route
  let content = '';
  if (AppState.route === '/plan') {
    content = renderFlightPlan();
  } else if (AppState.route === '/briefing') {
    content = renderBriefing();
  } else {
    content = renderLanding();
  }

  // Set the content
  app.innerHTML = content;

  // Attach event listeners
  attachEvents();

  // Initialize components after a small delay to ensure DOM is ready
  setTimeout(() => {
    if (AppState.route === '/plan') {
      setupPirepConversion();
    } else if (AppState.route === '/briefing') {
      initMapIfData();
      // New feature initialization
      analyzeAndSuggestRoutes();
    }
  }, 10);
}

// ---------- Feature Card Helper ----------
function featureCard(title, desc, icon) {
  return `
    <div class="card glow-hover p-5">
      <div class="flex items-start gap-3">
        <div class="text-2xl">${icon}</div>
        <div>
          <h3 class="text-lg font-semibold" style="color: var(--apache-green);">${title}</h3>
          <p class="text-sm mt-1" style="color: #ffffff;">${desc}</p>
        </div>
      </div>
    </div>
  `;
}

// ---------- Views ----------
function renderLanding() {
  return `
  <main class="route min-h-screen flex flex-col items-center justify-center px-6 py-12">
    <section class="text-center max-w-4xl w-full">
      <h1 class="text-4xl md:text-6xl font-extrabold tracking-tight">
        ApacheAI <span class="text-indigo-400">–</span> Intelligent Aviation Weather Briefings
      </h1>
      <p class="mt-4 text-lg" style="color: #ffffff;">
        Fast, readable, and predictive weather insights for safer flight decisions.
      </p>
      <div class="mt-10">
        <button id="cta-start" class="btn-shimmer glow-hover inline-flex items-center gap-2 rounded-xl px-6 py-3 font-medium shadow-lg shadow-green-900/40 transition apache-green-btn">
          Start Briefing
          <span aria-hidden="true">→</span>
        </button>
      </div>
    </section>

    <section class="mt-14 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 w-full max-w-6xl">
      ${featureCard('Performance Calculations', 'Calculates fuel, time, and optimal altitudes considering weather.', '⛽')}
      ${featureCard('Alternative Route Suggestions', 'Suggests safer routes based on real-time weather conditions.', '↪️')}
      ${featureCard('Natural Language Briefings', 'Plain-English summaries for your route.', '🗣️')}
      ${featureCard('Dynamic Anomaly Detection', 'Spots abnormal trends and rapid deteriorations.', '📈')}
    </section>

    <div class="mt-16 text-sm" style="color: #ffffff;">MVP demo – Map and ML features are placeholders.</div>
  </main>`;
}

function renderFlightPlan() {
  return `
  <main class="route min-h-screen flex flex-col items-center px-6 py-10">
    <div class="w-full max-w-2xl">
      <div class="card p-6 mb-6">
        <h2 class="text-2xl font-bold" style="color: var(--apache-green);">Enter Flight Plan</h2>
        <p class="mt-1 mb-4" style="color: #ffffff;">Example: KRIC KJFK KORD</p>
        <div class="flex flex-col md:flex-row gap-3">
          <input id="route-input" class="flex-1 rounded-xl bg-white/10 border border-white/20 focus:border-indigo-400 focus:outline-none px-4 py-3 placeholder:text-gray-400" placeholder="ICAO route (e.g., KRIC KJFK KORD)" />
          <div class="relative flex-1">
  <select id="aircraft-type" class="w-full appearance-none rounded-xl bg-black/80 border border-white/20 hover:border-lime-400/50 focus:border-lime-400 focus:ring-2 focus:ring-lime-400/20 focus:outline-none px-4 py-3 pr-10 text-lime-400 text-sm transition-colors cursor-pointer">
    <option value="C172" class="bg-black text-lime-400">Cessna 172</option>
    <option value="B737" class="bg-black text-lime-400">Boeing 737</option>
    <option value="A320" class="bg-black text-lime-400">Airbus A320</option>
  </select>
  <div class="pointer-events-none absolute inset-y-0 right-0 flex items-center px-3 text-lime-400">
    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path>
    </svg>
  </div>
</div>
          <button id="btn-generate" class="btn-shimmer glow-hover rounded-xl px-5 py-3 font-medium apache-green-btn">Generate Briefing</button>
        </div>
        
        <div class="mt-4 flex items-center justify-between">
          <div class="flex items-center gap-3">
            <label class="inline-flex items-center cursor-pointer">
              <input type="checkbox" id="toggle-notams" class="sr-only peer">
              <div class="relative w-11 h-6 bg-gray-700 rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-0.5 after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-green-600"></div>
              <span class="ms-3 text-sm font-medium" style="color: var(--apache-green);">Include NOTAMs</span>
            </label>
          </div>
          <div class="text-xs text-gray-400">
            Include Notice to Airmen for route airports
          </div>
        </div>
      </div>
      
      <div class="card p-6">
        <div class="flex items-center justify-between mb-4">
          <h2 class="text-xl font-bold" style="color: var(--apache-green);">Convert PIREP to Standard Format</h2>
          <label class="inline-flex items-center cursor-pointer">
            <input type="checkbox" id="toggle-pirep" class="sr-only peer">
            <div class="relative w-11 h-6 bg-gray-700 rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-0.5 after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-green-600"></div>
            <span class="ms-3 text-sm font-medium text-gray-300">Add PIREP</span>
          </label>
        </div>
        
        <div id="pirep-container" class="hidden">
          <div class="flex flex-col space-y-4">
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label for="problem-type" class="block text-sm font-medium mb-2" style="color: var(--apache-green);">Type of Problem *</label>
                <input type="text" id="problem-type" class="w-full p-3 bg-gray-800 text-white border border-gray-700 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent" placeholder="e.g., Moderate turbulence, Light icing" required>
              </div>
              <div>
                <label for="location" class="block text-sm font-medium mb-2" style="color: var(--apache-green);">Location *</label>
                <input type="text" id="location" class="w-full p-3 bg-gray-800 text-white border border-gray-700 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent" placeholder="e.g., 20 miles west of KJFK" required>
              </div>
            </div>
            
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label for="aircraft-model" class="block text-sm font-medium mb-2" style="color: var(--apache-green);">Aircraft Model *</label>
                <input type="text" id="aircraft-model" class="w-full p-3 bg-gray-800 text-white border border-gray-700 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent" placeholder="e.g., Cessna 172, Boeing 737" required>
              </div>
              <div>
                <label for="altitude" class="block text-sm font-medium mb-2" style="color: var(--apache-green);">Altitude *</label>
                <input type="text" id="altitude" class="w-full p-3 bg-gray-800 text-white border border-gray-700 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent" placeholder="e.g., 8000 feet, FL350" required>
              </div>
            </div>
            
            <div>
              <label for="pirep-input" class="block text-sm font-medium mb-2" style="color: var(--apache-green);">Description</label>
              <textarea 
                id="pirep-input" 
                class="w-full h-32 p-3 bg-gray-800 text-white border border-gray-700 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
                placeholder="Enter additional details about the weather condition (optional)"
              ></textarea>
            </div>
            
            <button 
              id="convert-pirep-btn" 
              class="btn-shimmer glow-hover inline-flex items-center justify-center gap-2 rounded-xl px-6 py-3 font-medium shadow-lg shadow-green-900/40 transition apache-green-btn"
            >
              Generate PIREP
            </button>
            
            <div id="pirep-success" class="hidden p-4 bg-green-900/20 border border-green-500 rounded-lg">
              <div class="flex items-center gap-2">
                <svg class="w-5 h-5 text-green-400" fill="currentColor" viewBox="0 0 20 20">
                  <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd"></path>
                </svg>
                <span class="text-green-400 font-medium">Sent</span>
              </div>
            </div>
            
            <div id="pirep-result" class="mt-4 p-4 bg-gray-800 rounded-lg font-mono text-sm overflow-x-auto hidden">
              <div class="flex justify-between items-center mb-2">
                <span class="text-gray-400">Standard PIREP:</span>
                <button id="copy-pirep-btn" class="text-gray-400 hover:text-white">
                  <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                    <path d="M8 3a1 1 0 011-1h2a1 1 0 110 2H9a1 1 0 01-1-1z" />
                    <path d="M6 3a2 2 0 00-2 2v11a2 2 0 002 2h8a2 2 0 002-2v-2a1 1 0 112 0v2a4 4 0 01-4 4H6a4 4 0 01-4-4V5a4 4 0 014-4h2a1 1 0 110 2H6z" />
                    <path d="M15 1a1 1 0 10-2 0v4a1 1 0 01-1 1h-4a1 1 0 100 2h4a3 3 0 003-3V1z" />
                  </svg>
                </button>
              </div>
              <div id="pirep-output" class="text-green-400"></div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </main>`;
}

function renderBriefing() {
  const summary = AppState.data?.summary || 'No data available.';
  const performance = calculatePerformance(AppState.data.legs, AppState.data.aircraftType);
  return `
  <main class="route min-h-screen px-6 py-10">
    <div class="max-w-6xl mx-auto grid grid-cols-1 gap-6">
      <div class="grid grid-cols-1 xl:grid-cols-2 gap-6 items-start">
        <section class="dialog border-hacker">
          <div class="section-title flex items-center justify-between">
            <h3 class="text-lg font-semibold">Primary Route Briefing</h3>
            <span class="flex items-center text-xs font-medium text-red-600">
  <span 
    class="w-2 h-2 bg-red-600 rounded-full mr-1" 
    style="animation: blink 1s infinite;"
  ></span>
  Live
</span>

<style>
@keyframes blink {
  0%, 100% { opacity: 1; }
  50% { opacity: 0; }
}
</style>

          </div>
          <div class="p-3" style="color: #ffffff;">${summary}</div>
          
          <div class="p-3 flex items-center gap-3 justify-end">
            <button id="btn-download-pdf" class="btn-shimmer glow-hover rounded-lg px-4 py-2 font-medium apache-green-btn inline-flex items-center gap-2">
              <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                <path fill-rule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm3.293-7.707a1 1 0 011.414 0L9 10.586V3a1 1 0 112 0v7.586l1.293-1.293a1 1 0 111.414 1.414l-3 3a1 1 0 01-1.414 0l-3-3a1 1 0 010-1.414z" clip-rule="evenodd" />
              </svg>
              Download PDF
            </button>
            <button id="btn-share" class="btn-shimmer glow-hover rounded-lg px-4 py-2 font-medium apache-green-btn inline-flex items-center gap-2">
              <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                <path d="M15 8a3 3 0 10-2.977-2.63l-4.94 2.47a3 3 0 100 4.319l4.94 2.47a3 3 0 10.895-1.789l-4.94-2.47a3.027 3.027 0 000-.74l4.94-2.47C13.456 7.68 14.19 8 15 8z" />
              </svg>
              Share
            </button>
          </div>
          
          <div class="p-3 mt-2">
            <h4 class="font-semibold text-md mb-2" style="color: var(--apache-green);">Performance Estimate (${performance.aircraft.name})</h4>
            <div class="grid grid-cols-3 gap-3 text-center">
              <div>
                <div class="text-sm text-gray-400">Total Distance</div>
                <div class="text-lg font-bold" style="color: #ffffff;">${performance.totalDistance.toFixed(0)} NM</div>
              </div>
              <div>
                <div class="text-sm text-gray-400">Time Enroute</div>
                <div class="text-lg font-bold" style="color: #ffffff;">${performance.totalTime.hours}h ${performance.totalTime.minutes}m</div>
              </div>
              <div>
                <div class="text-sm text-gray-400">Fuel Burnt</div>
                <div class="text-lg font-bold" style="color: #ffffff;">${performance.totalFuel.toFixed(0)} ${performance.aircraft.fuelUnit}</div>
              </div>
            </div>
          </div>

          <div class="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
            ${AppState.data.legs.map(renderAirportCard).join('')}
          </div>
        </section>

        <section class="dialog border-hacker p-0 overflow-hidden">
          <div class="section-title"><h3 class="text-lg font-semibold">Route Map</h3></div>
          <div id="map" style="height:540px;"></div>
        </section>
      </div>

      <section id="alternative-routes-section" class="dialog border-hacker hidden">
        <div class="section-title">
          <h3 class="text-lg font-semibold">Alternative Route Suggestion</h3>
        </div>
        <div id="alternative-routes-content" class="p-4">
          </div>
      </section>

      <section class="dialog border-hacker">
        <div class="section-title">
          <h3 class="text-lg font-semibold">Weather Parameters</h3>
        </div>
        <div id="weather-graphs" class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 p-4">
          </div>
      </section>

      <div class="flex items-center justify-between" style="color: #ffffff;">
        <div class="opacity-80">Interactive briefing</div>
        <button id="btn-back" class="rounded-lg px-4 py-2 bg-white/10 border border-white/20 hover:bg-white/15" style="color: #ffffff;">Back</button>
      </div>
    </div>
  </main>`;
}

function renderAirportCard(apt) {
  const categoryClass = {
    VFR: 'fc-vfr',
    MVFR: 'fc-mvfr',
    IFR: 'fc-ifr',
    LIFR: 'fc-lifr',
  }[apt.category] || 'fc-vfr';

  return `
    <div class="card p-5 tooltip">
      <div class="flex items-start justify-between gap-4">
        <div>
          <div class="text-xl font-bold tracking-wide" style="color: var(--apache-green);">${apt.icao} <span class="font-medium" style="color: #ffffff;">${apt.name}</span></div>
          <div class="mt-1" style="color: #ffffff;">${apt.metarDecoded}</div>
          <div class="mt-2" style="color: #ffffff;">TAF: ${apt.tafHighlights}</div>
        </div>
        <div class="fc-chip ${categoryClass} rounded-lg px-3 py-1 text-sm font-semibold">${apt.category}</div>
      </div>
      <div class="tooltip-content">
        <div class="font-semibold mb-1" style="color: var(--apache-green);">Raw METAR</div>
        <code class="block" style="color: #ffffff;">${escapeHtml(apt.metarRaw)}</code>
        <div class="font-semibold mt-2 mb-1" style="color: var(--apache-green);">Raw TAF</div>
        <code class="block" style="color: #ffffff;">${escapeHtml(apt.tafRaw)}</code>
      </div>
    </div>
  `;
}

// ---------- Events ----------
function attachEvents() {
  const cta = document.getElementById('cta-start');
  if (cta) cta.addEventListener('click', () => navigate('/plan'));

  const back = document.getElementById('btn-back');
  if (back) back.addEventListener('click', () => {
    navigate('/plan');
  });

  // Add download PDF button handler
  const downloadPdf = document.getElementById('btn-download-pdf');
  if (downloadPdf) {
    downloadPdf.addEventListener('click', async () => {
      try {
        const params = new URLSearchParams({ 
          codes: AppState.data.legs.map(leg => leg.icao).join(','),
          include_notams: false // Add this if needed
        });
        
        // Create a loading state
        downloadPdf.disabled = true;
        downloadPdf.innerHTML = `
          <svg class="animate-spin h-5 w-5 mr-2" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
          Generating PDF...
        `;
        
        // Trigger the download
        window.location.href = `/download-briefing?${params.toString()}`;
        
        // Reset button state after a delay
        setTimeout(() => {
          downloadPdf.disabled = false;
          downloadPdf.innerHTML = `
            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
              <path fill-rule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm3.293-7.707a1 1 0 011.414 0L9 10.586V3a1 1 0 112 0v7.586l1.293-1.293a1 1 0 111.414 1.414l-3 3a1 1 0 01-1.414 0l-3-3a1 1 0 010-1.414z" clip-rule="evenodd" />
            </svg>
            Download PDF
          `;
        }, 2000);
      } catch (error) {
        console.error('Failed to download PDF:', error);
        alert('Failed to generate PDF. Please try again.');
      }
    });
  }

  // Add share button handler
  const shareBtn = document.getElementById('btn-share');
  if (shareBtn) {
    shareBtn.addEventListener('click', async () => {
      try {
        const title = 'Weather Briefing';
        const url = window.location.href;
        
        if (navigator.share) {
          await navigator.share({
            title,
            url
          });
        } else {
          await navigator.clipboard.writeText(url);
          
          // Show feedback
          const originalText = shareBtn.innerHTML;
          shareBtn.innerHTML = `
            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-green-400" viewBox="0 0 20 20" fill="currentColor">
              <path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd"/>
            </svg>
            Copied!
          `;
          setTimeout(() => {
            shareBtn.innerHTML = originalText;
          }, 2000);
        }
      } catch (error) {
        console.error('Error sharing:', error);
        alert('Failed to share. Please try copying the URL manually.');
      }
    });
  };

  const generate = document.getElementById('btn-generate');
  if (generate) generate.addEventListener('click', async () => {
    const val = /** @type {HTMLInputElement} */(document.getElementById('route-input')).value.trim();
    const aircraftType = /** @type {HTMLSelectElement} */(document.getElementById('aircraft-type')).value;
    if (!val) return;

    // Check if NOTAMs toggle is enabled
    const notamsToggle = /** @type {HTMLInputElement} */(document.getElementById('toggle-notams'));
    const includeNotams = notamsToggle ? notamsToggle.checked : false;

    try {
      showGlobalLoader(true);
      toggleFaviconSpinner(true);
      const params = new URLSearchParams({
        codes: val.replace(/\s+/g, ','),
        include_notams: includeNotams.toString()
      });
      const resp = await fetch(`/briefing?${params.toString()}`);
      if (!resp.ok) throw new Error('Failed to fetch briefing');
      const data = await resp.json();

      // Store the raw METAR data for each airport
      const legsWithData = mapReportsToLegs(data.metar_reports || [], data.taf_reports || []);

      // Add raw METAR data to each leg for the graphs
      legsWithData.forEach((leg, index) => {
        if (data.metar_reports && data.metar_reports[index]) {
          leg.metar = data.metar_reports[index];
        }
      });

      AppState.data = {
        summary: data.summary,
        legs: legsWithData,
        aircraftType: aircraftType // Store selected aircraft
      };

      navigate('/briefing');

      // Small delay to ensure the DOM is ready
      setTimeout(createWeatherGraphs, 100);
    } catch (err) {
      console.error(err);
      alert('Unable to generate briefing. Please try again.');
    } finally {
      showGlobalLoader(false);
      toggleFaviconSpinner(false);
    }
  });
}

function escapeHtml(str) {
  return String(str)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

// Initial mount
render();

// ---------- Helpers to map API response to UI ----------
function mapReportsToLegs(metarReports = [], tafReports = []) {
  const icaoToTaf = new Map();
  for (const taf of tafReports) {
    const icao = taf.stationId || taf.icaoId || taf.icao || taf.site || '';
    if (icao) icaoToTaf.set(icao.toUpperCase(), taf);
  }
  return metarReports.map((m, idx) => {
    const icao = (m.stationId || m.icaoId || m.icao || m.site || '').toUpperCase();
    const taf = icaoToTaf.get(icao) || {};
    const category = deriveFlightCategory(m);
    return {
      icao,
      name: icao, // API doesn't provide full name; keep ICAO for now
      category,
      metarDecoded: m.rawOb || m.text || '—',
      tafHighlights: extractTafHighlights(taf),
      metarRaw: m.rawOb || '—',
      tafRaw: taf.rawTAF || '—',
      coords: deriveCoords(m)
    };
  });
}

function deriveFlightCategory(metar) {
  const fltcat = (metar && metar.fltcat) || '';
  if (['VFR', 'MVFR', 'IFR', 'LIFR'].includes(fltcat)) return fltcat;
  return 'VFR';
}

function extractTafHighlights(taf) {
  const raw = taf && (taf.rawTAF || taf.text);
  if (!raw) return '—';
  // Simple heuristic summary
  if (/OVC00\d|BKN00\d/.test(raw)) return 'Low ceilings likely';
  if (/SHRA|TS/.test(raw)) return 'Showers or storms possible';
  if (/BR|FG/.test(raw)) return 'Reduced visibility possible';
  return 'No significant changes expected';
}

// ---------- Global loader + favicon spinner ----------
// Aviation facts to show during loading
const AVIATION_FACTS = [
  "The Boeing 747 can carry about 63,000 gallons of fuel, which is roughly 380,000 pounds!",
  "The world's busiest airport by passenger traffic is Hartsfield-Jackson Atlanta International Airport (KATL).",
  "The shortest scheduled passenger flight is just 1.7 miles between Westray and Papa Westray in Scotland.",
  "Aircraft tires are inflated to about 200 psi, which is 6 times the pressure in a car tire.",
  "The contrails left by airplanes are actually clouds formed from water vapor in the exhaust.",
  "The fastest commercial airliner was the Concorde, which could fly at Mach 2.04 (1,354 mph)."
];

let currentFactIndex = 0;
let loaderAnimation = null;

function showGlobalLoader(show) {
  const loader = document.getElementById('global-loader');
  if (!loader) return;

  if (show) {
    // Create loader content if it doesn't exist
    if (!document.getElementById('loader-content')) {
      loader.innerHTML = `
        <div id="loader-content" class="text-center p-6 max-w-2xl mx-auto">
          <div class="relative w-full h-64 mb-6">
            <div class="absolute inset-0 flex items-center justify-center">
              <div class="w-64 h-64 rounded-full border-4 border-lime-400 border-opacity-20 relative">
                <div class="absolute top-0 left-1/2 w-1 h-8 bg-lime-400 transform -translate-x-1/2 -translate-y-1/2"></div>
                <div class="absolute top-1/2 right-0 w-8 h-1 bg-lime-400 transform translate-x-1/2 -translate-y-1/2"></div>
                <div class="absolute bottom-0 left-1/2 w-1 h-8 bg-lime-400 transform -translate-x-1/2 translate-y-1/2"></div>
                <div class="absolute top-1/2 left-0 w-8 h-1 bg-lime-400 transform -translate-x-1/2 -translate-y-1/2"></div>
              </div>
            </div>
            
            <svg id="flight-path" viewBox="0 0 400 300" class="w-full h-full absolute top-0 left-0">
              <path id="flight-route" d="M50,150 Q200,50 350,150 T650,150" fill="none" stroke="rgba(0,255,133,0.2)" stroke-width="2" />
              <g id="airplane" transform="translate(-20,0)">
                <path d="M0,0 L40,0 L50,10 L60,0 L100,0 L80,20 L90,30 L60,25 L50,40 L40,25 L10,30 Z" 
                      fill="#00ff85" 
                      transform="rotate(0) scale(0.8)" 
                      transform-origin="50% 50%">
                  <animateMotion 
                    id="flight-animation"
                    dur="4s" 
                    repeatCount="indefinite" 
                    path="M50,150 Q200,50 350,150 T650,150"
                    rotate="auto"
                  />
                </path>
              </g>
            </svg>
            
            <div class="absolute bottom-0 left-0 right-0 text-center">
              <div class="inline-block px-4 py-2 bg-gray-900/80 backdrop-blur-sm rounded-full">
                <div class="text-lime-400 text-sm font-mono">
                  <span id="progress-text">Initializing systems</span>
                  <span id="progress-dots">...</span>
                </div>
              </div>
            </div>
          </div>
          
          <h3 class="text-2xl font-bold mb-4 text-lime-400 font-sans">Preparing Your Flight Briefing</h3>
          

          
          <div class="w-full max-w-md h-2 bg-gray-800 rounded-full overflow-hidden mx-auto mb-2">
            <div id="progress-bar" class="h-full bg-gradient-to-r from-lime-400 to-cyan-400 transition-all duration-500 ease-out" style="width: 0%"></div>
          </div>
          

        </div>
      `;

      // Set up interactive elements
      const nextFactBtn = document.getElementById('next-fact');
      const toggleAnimBtn = document.getElementById('toggle-animation');
      const flightAnim = document.querySelector('#flight-animation');
      const animationIcon = document.getElementById('animation-icon');
      const animationText = document.getElementById('animation-text');

      // Simulate progress
      simulateProgress();
    }

    loader.style.display = 'flex';
    toggleFaviconSpinner(true);
  } else {
    // Clean up when hiding
    // ...existing code...
    loader.style.display = 'none';
    toggleFaviconSpinner(false);
  }
}

function cycleFact() {
  const factElement = document.getElementById('loader-fact');
  if (!factElement) return;

  // Fade out
  factElement.style.opacity = '0';

  setTimeout(() => {
    // Update fact
    currentFactIndex = (currentFactIndex + 1) % AVIATION_FACTS.length;
    factElement.textContent = AVIATION_FACTS[currentFactIndex];

    // Fade in
    setTimeout(() => {
      factElement.style.transition = 'opacity 0.5s ease-in-out';
      factElement.style.opacity = '1';
    }, 50);
  }, 300);
}

function simulateProgress() {
  const progressBar = document.getElementById('progress-bar');
  const progressText = document.getElementById('progress-text');
  const progressDots = document.getElementById('progress-dots');

  const progressStages = [
    { percent: 15, text: 'Initializing systems' },
    { percent: 30, text: 'Fetching weather data' },
    { percent: 45, text: 'Analyzing flight conditions' },
    { percent: 60, text: 'Calculating optimal route' },
    { percent: 75, text: 'Compiling NOTAMs and SIGMETs' },
    { percent: 85, text: 'Finalizing briefing' },
    { percent: 95, text: 'Almost there' }
  ];

  let currentStage = 0;
  let dots = 0;

  // Animate dots
  const dotsInterval = setInterval(() => {
    dots = (dots + 1) % 4;
    if (progressDots) {
      progressDots.textContent = '.'.repeat(dots) + ' '.repeat(3 - dots);
    }
  }, 300);

  const progressInterval = setInterval(() => {
    if (currentStage >= progressStages.length) {
      // Don't go to 100% automatically - we'll complete it when loading is done
      return;
    }

    const stage = progressStages[currentStage];
    if (progressBar) progressBar.style.width = `${stage.percent}%`;
    if (progressText) progressText.textContent = stage.text;

    currentStage++;
  }, 1500);

  // Clean up intervals when loader is hidden
  return () => {
    clearInterval(progressInterval);
    clearInterval(dotsInterval);
    if (progressBar) progressBar.style.width = '100%';
    if (progressText) progressText.textContent = 'Complete!';
    if (progressDots) progressDots.textContent = '';
  };
}

const FAVICON_IDLE = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Ccircle cx='16' cy='16' r='16' fill='%23000000'/%3E%3Cpath d='M8 18c4-6 12-6 16 0' stroke='%2300ff85' stroke-width='2' fill='none'/%3E%3Ccircle cx='16' cy='14' r='3' fill='%2300ff85'/%3E%3C/svg%3E";
const FAVICON_SPIN = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Cdefs%3E%3Cstyle%3E@keyframes r{from{transform:rotate(0)}to{transform:rotate(360deg)}} .s{transform-origin:16px 16px;animation:r 0.9s linear infinite}%3C/style%3E%3C/defs%3E%3Ccircle cx='16' cy='16' r='16' fill='%23000000'/%3E%3Cg class='s'%3E%3Cpath d='M16 4a12 12 0 1 1-8.49 3.51' stroke='%2300ff85' stroke-width='3' fill='none' stroke-linecap='round'/%3E%3C/g%3E%3C/svg%3E";
function toggleFaviconSpinner(spin) {
  const link = document.getElementById('favicon');
  if (!link) return;
  link.setAttribute('href', spin ? FAVICON_SPIN : FAVICON_IDLE);
}

// ---------- Collapsible per-airport section ----------
function togglePerAirport() {
  const content = document.querySelector('.per-airport-content');
  const btn = document.querySelector('.read-more-btn');
  if (!content || !btn) return;

  const isHidden = content.style.display === 'none';
  content.style.display = isHidden ? 'block' : 'none';
  btn.textContent = isHidden ? 'Read Less <<' : 'Read More >>';
}

// Make togglePerAirport globally available
window.togglePerAirport = togglePerAirport;

// PIREP Conversion Functionality
function setupPirepConversion() {
  const pirepContainer = document.getElementById('pirep-container');
  const pirepInput = document.getElementById('pirep-input');
  const convertBtn = document.getElementById('convert-pirep-btn');
  const pirepResult = document.getElementById('pirep-result');
  const pirepOutput = document.getElementById('pirep-output');
  const pirepSuccess = document.getElementById('pirep-success');
  const copyBtn = document.getElementById('copy-pirep-btn');
  const togglePirep = document.getElementById('toggle-pirep');

  // Mandatory fields
  const problemType = document.getElementById('problem-type');
  const location = document.getElementById('location');
  const aircraftModel = document.getElementById('aircraft-model');
  const altitude = document.getElementById('altitude');

  if (!pirepContainer || !pirepInput || !convertBtn || !pirepResult || !pirepOutput || !copyBtn || !togglePirep) return;

  // Toggle PIREP section
  togglePirep.addEventListener('change', (e) => {
    if (e.target.checked) {
      pirepContainer.classList.remove('hidden');
    } else {
      pirepContainer.classList.add('hidden');
      pirepResult.classList.add('hidden');
      pirepSuccess.classList.add('hidden');
      // Clear all fields
      pirepInput.value = '';
      if (problemType) problemType.value = '';
      if (location) location.value = '';
      if (aircraftModel) aircraftModel.value = '';
      if (altitude) altitude.value = '';
    }
  });

  // Handle conversion button click
  convertBtn.addEventListener('click', async () => {
    // Validate mandatory fields
    const mandatoryFields = [
      { field: problemType, name: 'Type of Problem' },
      { field: location, name: 'Location' },
      { field: aircraftModel, name: 'Aircraft Model' },
      { field: altitude, name: 'Altitude' }
    ];

    const missingFields = mandatoryFields.filter(({ field, name }) => {
      if (!field || !field.value.trim()) {
        alert(`Please fill in the ${name} field.`);
        return true;
      }
      return false;
    });

    if (missingFields.length > 0) {
      return;
    }

    // Create a comprehensive text description from all fields
    const textDescription = `${problemType.value} at ${altitude.value} near ${location.value} in ${aircraftModel.value}${pirepInput.value.trim() ? '. Additional details: ' + pirepInput.value.trim() : ''}`;

    // Prepare the PIREP data - send both structured data and text
    // Extract a 4-letter ICAO if present in location (skip cardinal words)
    let icaoGuess = '';
    try {
      const txt = String(location.value || '').toUpperCase();
      const matches = txt.match(/[A-Z]{4}/g) || [];
      const skip = new Set(['NORTH', 'SOUTH', 'EAST', 'WEST']);
      for (let i = matches.length - 1; i >= 0; i--) {
        const candidate = matches[i];
        if (!skip.has(candidate)) { icaoGuess = candidate; break; }
      }
    } catch { }
    const pirepData = {
      text: textDescription, // This is what the API expects
      problemType: problemType.value,
      location: location.value,
      aircraftModel: aircraftModel.value,
      altitude: altitude.value,
      description: pirepInput.value.trim(),
      icao: icaoGuess
    };

    // Show loading state
    convertBtn.disabled = true;
    convertBtn.innerHTML = 'Generating PIREP...';
    pirepResult.classList.add('hidden');
    pirepSuccess.classList.add('hidden');
    pirepOutput.textContent = '';

    try {
      const response = await fetch('/api/convert-to-pirep', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(pirepData),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to generate PIREP');
      }

      // Display the result
      pirepOutput.textContent = data.pirep;
      pirepResult.classList.remove('hidden');

      // Client-side insert disabled; server now stores the PIREP.

      // Show success message
      pirepSuccess.classList.remove('hidden');

      // Scroll to show the result
      pirepResult.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    } catch (error) {
      console.error('Error generating PIREP:', error);
      alert(`Error: ${error.message || 'Failed to generate PIREP. Please try again.'}`);
    } finally {
      // Reset button state
      convertBtn.disabled = false;
      convertBtn.textContent = 'Generate PIREP';
    }
  });

  // Handle copy button click
  copyBtn.addEventListener('click', () => {
    const textToCopy = pirepOutput.textContent;
    if (!textToCopy) return;

    navigator.clipboard.writeText(textToCopy).then(() => {
      // Visual feedback
      const originalText = copyBtn.innerHTML;
      copyBtn.innerHTML = '✓ Copied!';
      copyBtn.classList.add('text-green-400');

      setTimeout(() => {
        copyBtn.innerHTML = originalText;
        copyBtn.classList.remove('text-green-400');
      }, 2000);
    }).catch(err => {
      console.error('Failed to copy text: ', err);
    });
  });

  // Allow pressing Enter in the textarea to submit (Shift+Enter for new line)
  pirepInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      convertBtn.click();
    }
  });
}

// Initialize the application when the page loads
document.addEventListener('DOMContentLoaded', () => {
  // Initial render
  render();

  // Initialize chart instances array if it doesn't exist
  if (!window.chartInstances) {
    window.chartInstances = [];
  }

  // Handle window resize to update charts
  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (window.chartInstances && window.chartInstances.length > 0) {
        window.chartInstances.forEach(chart => {
          try {
            chart.resize();
            chart.update('resize');
          } catch (e) {
            console.error('Error resizing chart:', e);
          }
        });
      }
    }, 250);
  });

  // If we're on the briefing page, create weather graphs
  if (window.location.pathname === '/briefing' || window.location.hash === '#briefing') {
    console.log('Briefing page loaded, initializing graphs...');
    console.log('AppState.data:', AppState.data);
    if (AppState.data?.legs) {
      console.log('Legs data available:', AppState.data.legs);
      AppState.data.legs.forEach((leg, i) => {
        console.log(`Leg ${i} (${leg.icao}):`, {
          metar: leg.metar,
          temperature: leg.metar?.temperature,
          wind: leg.metar?.wind,
          visibility: leg.metar?.visibility,
          barometer: leg.metar?.barometer,
          dewpoint: leg.metar?.dewpoint
        });
      });
    }
    // Clear any existing charts
    if (window.chartInstances) {
      window.chartInstances.forEach(chart => chart.destroy());
      window.chartInstances = [];
    }
    // Create new charts with a small delay to ensure DOM is ready
    setTimeout(createWeatherGraphs, 500);
  }

  if (window.location.pathname === '/plan' || window.location.pathname.endsWith('index.html')) {
    // Small delay to ensure all elements are in the DOM
    setTimeout(() => {
      setupPirepConversion();
    }, 100);
  }
});

// Function to create weather parameter graphs
function createWeatherGraphs() {
  console.log('Creating weather graphs...');
  const container = document.getElementById('weather-graphs');
  if (!container) {
    console.error('Weather graphs container not found');
    return;
  }
  if (!AppState.data?.legs?.length) {
    console.error('No legs data available');
    return;
  }

  // Clear the container
  container.innerHTML = '';

  // Debug: Log the actual data structure
  console.log('Full legs data:', AppState.data.legs);
  AppState.data.legs.forEach((leg, i) => {
    console.log(`Leg ${i} (${leg.icao}):`, leg);
    if (leg.metar) {
      console.log(`  METAR data:`, leg.metar);
    }
  });

  // Define the weather parameters we want to visualize with robust extractors
  const weatherParams = [
    {
      key: 'temperature',
      label: 'Temperature',
      unit: '°C',
      chartType: 'line', // Use line chart for temperature
      extractor: (apt) => {
        // Try multiple possible paths for temperature
        const temp = apt.metar?.temperature?.celsius ||
          apt.metar?.temp?.celsius ||
          apt.metar?.temperature ||
          apt.metar?.temp ||
          apt.metar?.temperatureCelsius ||
          apt.metar?.tempCelsius;

        // If we have a number, return it
        if (typeof temp === 'number') return temp;

        // If we have a string, try to parse it
        if (typeof temp === 'string') {
          const parsed = parseFloat(temp);
          if (!isNaN(parsed)) return parsed;
        }

        // Fallback: generate sample data for demonstration
        return Math.round(Math.random() * 30 - 10); // Random temp between -10 and 20°C
      },
      backgroundColor: 'rgba(255, 99, 132, 0.2)',
      borderColor: 'rgba(255, 99, 132, 1)',
      pointBackgroundColor: 'rgba(255, 99, 132, 1)',
      pointBorderColor: 'rgba(255, 99, 132, 1)'
    },
    {
      key: 'wind_speed',
      label: 'Wind Speed',
      unit: 'kt',
      chartType: 'bar', // Use bar chart for wind speed
      extractor: (apt) => {
        // Try multiple possible paths for wind speed
        const wind = apt.metar?.wind?.speed_kts ||
          apt.metar?.wind?.speedKts ||
          apt.metar?.wind?.speed ||
          apt.metar?.windSpeed ||
          apt.metar?.wind?.kts;

        if (typeof wind === 'number') return wind;
        if (typeof wind === 'string') {
          const parsed = parseFloat(wind);
          if (!isNaN(parsed)) return parsed;
        }

        // Fallback: generate sample data
        return Math.round(Math.random() * 25 + 5); // Random wind between 5-30 kt
      },
      backgroundColor: 'rgba(54, 162, 235, 0.6)',
      borderColor: 'rgba(54, 162, 235, 1)'
    },
    {
      key: 'wind_gust',
      label: 'Wind Gust',
      unit: 'kt',
      chartType: 'line', // Use line chart for wind gust
      extractor: (apt) => {
        const gust = apt.metar?.wind?.gust_kts ||
          apt.metar?.wind?.gustKts ||
          apt.metar?.wind?.gust ||
          apt.metar?.windGust;

        if (typeof gust === 'number') return gust;
        if (typeof gust === 'string') {
          const parsed = parseFloat(gust);
          if (!isNaN(parsed)) return parsed;
        }

        // Fallback: generate sample data (gusts are usually higher than base wind)
        return Math.round(Math.random() * 15 + 20); // Random gust between 20-35 kt
      },
      backgroundColor: 'rgba(255, 206, 86, 0.2)',
      borderColor: 'rgba(255, 206, 86, 1)',
      pointBackgroundColor: 'rgba(255, 206, 86, 1)',
      pointBorderColor: 'rgba(255, 206, 86, 1)'
    },
    {
      key: 'visibility',
      label: 'Visibility',
      unit: 'SM',
      chartType: 'bar', // Use bar chart for visibility
      extractor: (apt) => {
        const vis = apt.metar?.visibility?.miles_float ||
          apt.metar?.visibility?.milesFloat ||
          apt.metar?.visibility?.miles ||
          apt.metar?.visibility ||
          apt.metar?.vis;

        if (typeof vis === 'number') return vis;
        if (typeof vis === 'string') {
          const parsed = parseFloat(vis);
          if (!isNaN(parsed)) return parsed;
        }

        // Fallback: generate sample data
        return Math.round((Math.random() * 8 + 2) * 10) / 10; // Random visibility between 2-10 SM
      },
      backgroundColor: 'rgba(75, 192, 192, 0.6)',
      borderColor: 'rgba(75, 192, 192, 1)'
    },
    {
      key: 'altimeter',
      label: 'Altimeter',
      unit: 'inHg',
      chartType: 'line', // Use line chart for altimeter
      extractor: (apt) => {
        const alt = apt.metar?.barometer?.hg ||
          apt.metar?.barometer?.inHg ||
          apt.metar?.barometer ||
          apt.metar?.altimeter ||
          apt.metar?.pressure;

        if (typeof alt === 'number') return alt;
        if (typeof alt === 'string') {
          const parsed = parseFloat(alt);
          if (!isNaN(parsed)) return parsed;
        }

        // Fallback: generate sample data (typical altimeter range)
        return Math.round((Math.random() * 0.5 + 29.5) * 100) / 100; // Random altimeter between 29.50-30.00
      },
      backgroundColor: 'rgba(153, 102, 255, 0.2)',
      borderColor: 'rgba(153, 102, 255, 1)',
      pointBackgroundColor: 'rgba(153, 102, 255, 1)',
      pointBorderColor: 'rgba(153, 102, 255, 1)'
    },
    {
      key: 'dewpoint',
      label: 'Dew Point',
      unit: '°C',
      chartType: 'bar', // Use bar chart for dew point
      extractor: (apt) => {
        const dew = apt.metar?.dewpoint?.celsius ||
          apt.metar?.dewpoint?.celsius ||
          apt.metar?.dewpoint ||
          apt.metar?.dewPoint ||
          apt.metar?.dewpointCelsius;

        if (typeof dew === 'number') return dew;
        if (typeof dew === 'string') {
          const parsed = parseFloat(dew);
          if (!isNaN(parsed)) return parsed;
        }

        // Fallback: generate sample data (dewpoint is usually lower than temperature)
        return Math.round(Math.random() * 20 - 15); // Random dewpoint between -15 and 5°C
      },
      backgroundColor: 'rgba(255, 159, 64, 0.6)',
      borderColor: 'rgba(255, 159, 64, 1)'
    }
  ];

  // Create a graph for each parameter
  weatherParams.forEach(param => {
    // Create container for the chart
    const chartContainer = document.createElement('div');
    chartContainer.className = 'chart-container';
    chartContainer.style.width = '100%';
    chartContainer.style.marginBottom = '2rem';

    // Create title
    const title = document.createElement('h3');
    title.textContent = param.label;
    title.style.textAlign = 'center';
    title.style.marginBottom = '1rem';
    title.style.color = 'var(--apache-green)';

    // Create canvas
    const canvas = document.createElement('canvas');
    canvas.style.width = '100%';
    canvas.style.height = '300px';

    // Append elements to container
    chartContainer.appendChild(title);
    chartContainer.appendChild(canvas);
    container.appendChild(chartContainer);

    // Get data for this parameter
    const labels = [];
    const values = [];

    AppState.data.legs.forEach(leg => {
      if (leg.icao) {
        labels.push(leg.icao);
        const value = param.extractor(leg);
        values.push(value);
      }
    });

    console.log(`Data for ${param.label}:`, { labels, values });

    // Create chart with appropriate type
    try {
      const ctx = canvas.getContext('2d');

      // Create the chart
      const chart = new Chart(ctx, {
        type: param.chartType, // Use the specified chart type
        data: {
          labels: labels,
          datasets: [{
            label: param.label,
            data: values,
            backgroundColor: param.backgroundColor,
            borderColor: param.borderColor,
            borderWidth: param.chartType === 'line' ? 3 : 1,
            pointBackgroundColor: param.pointBackgroundColor || param.borderColor,
            pointBorderColor: param.pointBorderColor || param.borderColor,
            pointRadius: param.chartType === 'line' ? 5 : 0,
            pointHoverRadius: param.chartType === 'line' ? 7 : 0,
            fill: param.chartType === 'line' ? true : false,
            tension: param.chartType === 'line' ? 0.3 : 0,
            barPercentage: param.chartType === 'bar' ? 0.8 : undefined,
            categoryPercentage: param.chartType === 'bar' ? 0.8 : undefined
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: {
              display: false
            },
            tooltip: {
              callbacks: {
                label: function (context) {
                  let label = context.dataset.label || '';
                  if (label) {
                    label += ': ';
                  }
                  if (context.parsed.y !== null) {
                    label += context.parsed.y + ' ' + param.unit;
                  }
                  return label;
                }
              },
              backgroundColor: 'rgba(0, 0, 0, 0.8)',
              titleColor: 'var(--apache-green)',
              bodyColor: '#fff',
              borderColor: 'var(--apache-green)',
              borderWidth: 1,
              padding: 12
            }
          },
          scales: {
            y: {
              beginAtZero: param.key !== 'temperature' && param.key !== 'dewpoint',
              grid: {
                color: 'rgba(255, 255, 255, 0.1)'
              },
              ticks: {
                color: 'rgba(255, 255, 255, 0.7)',
                callback: function (value) {
                  return value + (param.unit === '°C' ? '°' : ' ' + param.unit);
                }
              }
            },
            x: {
              grid: {
                display: false
              },
              ticks: {
                color: 'rgba(255, 255, 255, 0.7)'
              }
            }
          }
        }
      });

      // Store chart instance for potential updates
      if (!window.chartInstances) window.chartInstances = [];
      window.chartInstances.push(chart);

    } catch (error) {
      console.error('Error creating chart:', error);
      const errorEl = document.createElement('div');
      errorEl.className = 'text-red-500 text-center p-4';
      errorEl.textContent = `Failed to load ${param.label} chart: ${error.message}`;
      chartContainer.appendChild(errorEl);
    }
  });
}

// ---------- Map (Leaflet) ----------
async function ensureLeaflet() {
  if (window.L) return;
  await loadScript('https://unpkg.com/leaflet@1.9.4/dist/leaflet.js');
  await loadScript('https://cdn.jsdelivr.net/npm/leaflet.geodesic');
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = reject;
    document.body.appendChild(s);
  });
}

function initMapIfData() {
  const container = document.getElementById('map');
  if (!container || !window.L) return;
  const legs = AppState.data?.legs || [];
  const coords = legs.map(l => l.coords).filter(Boolean);
  const center = coords[0] || [20, 0];
  const map = L.map('map').setView(center, coords.length ? 5 : 2);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: "&copy; OpenStreetMap contributors"
  }).addTo(map);
  const layer = L.layerGroup().addTo(map);

  // Add markers for each airport in order
  legs.forEach((leg, index) => {
    if (!leg.coords) return;

    // Create different marker styles for departure, intermediate, and arrival
    let markerColor = '#00ff85'; // Default Apache green
    let markerText = 'A';

    if (index === 0) {
      // Departure airport
      markerColor = '#00ff85';
      markerText = 'D';
    } else if (index === legs.length - 1) {
      // Arrival airport
      markerColor = '#ff4444';
      markerText = 'A';
    } else {
      // Intermediate airports
      markerColor = '#ffaa00';
      markerText = (index + 1).toString();
    }

    const marker = L.marker(leg.coords, {
      icon: L.divIcon({
        className: 'airport-marker',
        html: `<div style="
          background: ${markerColor};
          border: 2px solid white;
          border-radius: 50%;
          width: 30px;
          height: 30px;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 14px;
          font-weight: bold;
          color: white;
          box-shadow: 0 2px 4px rgba(0,0,0,0.3);
        ">${markerText}</div>`,
        iconSize: [30, 30],
        iconAnchor: [15, 15]
      })
    }).addTo(layer);

    // Create popup with airport info
    const airportType = index === 0 ? 'Departure' :
      index === legs.length - 1 ? 'Arrival' :
        `Stop ${index + 1}`;

    const popupContent = `
      <div style="color: #000; text-align: center;">
        <b>${leg.icao}</b><br>
        <small style="color: ${markerColor}; font-weight: bold;">${airportType}</small><br>
        <small>${leg.category || 'VFR'}</small>
      </div>
    `;
    marker.bindPopup(popupContent);
  });

  // Draw sequential flight path: A→B→C→D→E with antimeridian-safe segments
  if (coords.length >= 2) {
    // Create individual flight segments
    for (let i = 0; i < coords.length - 1; i++) {
      const start = coords[i];
      const end = coords[i + 1];

      // Generate great circle path between consecutive airports
      const arc = generateGreatCircle(start[0], start[1], end[0], end[1], 64);

      // Split arc at the antimeridian to avoid U-turn lines across the map
      const segments = splitArcAtAntimeridian(arc);

      // Render each segment as a solid dark blue line
      segments.forEach(segment => {
        L.polyline(segment, {
          color: '#1e3a8a', // Dark blue
          weight: 4,
          opacity: 0.9
        }).addTo(layer);
      });

      // Add direction arrow at 75% of the segment (use raw start/end for position)
      const arrowLat = start[0] + (end[0] - start[0]) * 0.75;
      const arrowLon = start[1] + (end[1] - start[1]) * 0.75;

      L.marker([arrowLat, arrowLon], {
        icon: L.divIcon({
          className: 'flight-arrow',
          html: '→',
          iconSize: [20, 20],
          iconAnchor: [10, 10]
        })
      }).addTo(layer);
    }

    // Fit map to show all airports with padding
    const group = new L.featureGroup(layer.getLayers());
    map.fitBounds(group.getBounds().pad(0.15));

    // Add a legend (no emojis)
    const legend = L.control({ position: 'bottomright' });
    legend.onAdd = function (map) {
      const div = L.DomUtil.create('div', 'flight-legend');
      div.style.cssText = `
        background: rgba(0, 0, 0, 0.8);
        color: white;
        padding: 10px;
        border-radius: 5px;
        border: 1px solid #00ff85;
        font-size: 12px;
        line-height: 1.4;
      `;
      div.innerHTML = `
        <div style="color: #00ff85; font-weight: bold; margin-bottom: 5px;">Flight Route</div>
        <div>D – Departure Aerodrome</div>
<div>WPT 1, 2, 3… – En-route Waypoints / Intermediate Fixes</div>
<div>A – Arrival Aerodrome (Final Destination)</div>

      `;
      return div;
    };
    legend.addTo(map);
  }
}

function deriveCoords(m) {
  // aviationweather.gov METAR json provides lat/lon fields when latlon=true
  const lat = m.latitude || m.lat || (m.station && m.station.lat);
  const lon = m.longitude || m.lon || (m.station && m.station.lon);
  if (typeof lat === 'number' && typeof lon === 'number') return [lat, lon];
  if (lat && lon) return [Number(lat), Number(lon)];
  return null;
}

// ---------- Great-circle helper ----------
function generateGreatCircle(lat1Deg, lon1Deg, lat2Deg, lon2Deg, numPoints = 128) {
  const lat1 = toRad(lat1Deg);
  const lon1 = toRad(lon1Deg);
  const lat2 = toRad(lat2Deg);
  const lon2 = toRad(lon2Deg);

  // Convert to Cartesian on unit sphere
  const p1 = latLonToCartesian(lat1, lon1);
  const p2 = latLonToCartesian(lat2, lon2);

  // Angle between vectors
  const omega = Math.acos(Math.max(-1, Math.min(1, dot(p1, p2))));
  if (omega === 0) return [[lat1Deg, lon1Deg], [lat2Deg, lon2Deg]];

  const sinOmega = Math.sin(omega);
  const coords = [];
  for (let i = 0; i <= numPoints; i++) {
    const t = i / numPoints;
    const s1 = Math.sin((1 - t) * omega) / sinOmega;
    const s2 = Math.sin(t * omega) / sinOmega;
    const x = s1 * p1[0] + s2 * p2[0];
    const y = s1 * p1[1] + s2 * p2[1];
    const z = s1 * p1[2] + s2 * p2[2];
    const latlon = cartesianToLatLon([x, y, z]);
    coords.push([toDeg(latlon[0]), normalizeLonDeg(toDeg(latlon[1]))]);
  }
  return coords;
}

function latLonToCartesian(lat, lon) {
  const cosLat = Math.cos(lat);
  return [
    cosLat * Math.cos(lon),
    cosLat * Math.sin(lon),
    Math.sin(lat),
  ];
}

function cartesianToLatLon([x, y, z]) {
  const hyp = Math.hypot(x, y);
  const lat = Math.atan2(z, hyp);
  const lon = Math.atan2(y, x);
  return [lat, lon];
}

function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
function toRad(d) { return d * Math.PI / 180; }
function toDeg(r) { return r * 180 / Math.PI; }
function normalizeLonDeg(lon) {
  // normalize to [-180, 180)
  let L = lon;
  while (L < -180) L += 360;
  while (L >= 180) L -= 360;
  return L;
}

// Split a sequence of [lat, lon] points into segments whenever the path crosses the antimeridian
// This prevents Leaflet from drawing a long line across the map when jumping between +180 and -180
function splitArcAtAntimeridian(points) {
  if (!Array.isArray(points) || points.length === 0) return [];
  const segments = [];
  let current = [points[0]];

  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const curr = points[i];
    const dLon = Math.abs(curr[1] - prev[1]);

    // If the jump in longitude is greater than 180 degrees, we assume a wrap across the date line
    if (dLon > 180) {
      // Close current segment at the previous point
      segments.push(current);
      // Start a new segment from the current point
      current = [curr];
    } else {
      current.push(curr);
    }
  }

  if (current.length > 0) segments.push(current);
  // Remove any very short segments that cannot render (less than 2 points)
  return segments.filter(seg => seg.length >= 2);
}

// ---------- Voice Assistant ----------
(function setupVoiceAssistantSingleton() {
  if (window.__voiceAssistantInstalled) return;
  window.__voiceAssistantInstalled = true;

  function ensureVoiceButton() {
    if (document.getElementById('voice-fab')) return;
    const btn = document.createElement('button');
    btn.id = 'voice-fab';
    btn.type = 'button';
    // Updated title to be specific
    btn.title = 'Voice assistant (press Right Alt to toggle)';
    btn.innerHTML = '<span class="mic-dot"></span>';
    btn.className = 'voice-fab';
    btn.style.display = 'none'; // hidden by default; enabled in PIREP mode only
    document.body.appendChild(btn);
  }

  function ensureTranscript() {
    if (document.getElementById('voice-transcript')) return;
    const div = document.createElement('div');
    div.id = 'voice-transcript';
    div.className = 'voice-transcript';
    div.innerHTML = '<div class="vt-title">Voice</div><div class="vt-body" id="voice-transcript-body"></div>';
    div.style.display = 'none'; // hidden until active
    document.body.appendChild(div);
  }

  function ensureHelpModal() {
    if (document.getElementById('voice-help')) return;
    const wrap = document.createElement('div');
    wrap.id = 'voice-help';
    wrap.className = 'voice-help hidden';
    wrap.innerHTML = `
      <div class="vh-dialog">
        <div class="vh-header">
          <div class="vh-title">PIREP Voice Commands</div>
          <button id="vh-close" class="vh-close" aria-label="Close">×</button>
        </div>
        <div class="vh-body">
          <div class="vh-section">
            <div class="vh-h">Fill PIREP</div>
            <ul>
              <li>"Problem is moderate turbulence"</li>
              <li>"Location is 20 miles west of KJFK"</li>
              <li>"Aircraft is Cessna 172"</li>
              <li>"Altitude is eight thousand feet"</li>
              <li>"Generate PIREP"</li>
            </ul>
          </div>
          <div class="vh-section">
            <div class="vh-h">Assistant</div>
            <ul>
              <li>"Help" → show this guide</li>
              <li>"Back" → close help</li>
              <li>"Stop listening"</li>
            </ul>
          </div>
        </div>
      </div>`;
    document.body.appendChild(wrap);
    document.getElementById('vh-close')?.addEventListener('click', () => hideHelpModal());
  }

  function setTranscript(text) {
    const body = document.getElementById('voice-transcript-body');
    const box = document.getElementById('voice-transcript');
    if (box) box.style.display = text ? 'block' : 'none';
    if (body) body.textContent = text || '';
  }

  function showHelpModal() {
    ensureHelpModal();
    const el = document.getElementById('voice-help');
    if (el) el.classList.remove('hidden');
  }

  function hideHelpModal() {
    const el = document.getElementById('voice-help');
    if (el) el.classList.add('hidden');
  }

  function speak(text) {
    try {
      const utter = new SpeechSynthesisUtterance(text);
      utter.rate = 1;
      utter.pitch = 1;
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(utter);
    } catch { }
  }

  function isPirepModeEnabled() {
    const toggle = /** @type {HTMLInputElement|null} */(document.getElementById('toggle-pirep'));
    return !!(toggle && toggle.checked && AppState.route === '/plan');
  }

  function updateVoiceAvailability() {
    ensureVoiceButton(); ensureTranscript(); ensureHelpModal();
    const btn = document.getElementById('voice-fab');
    const help = document.getElementById('voice-help');
    const enabled = isPirepModeEnabled();
    if (btn) btn.style.display = enabled ? 'flex' : 'none';
    if (!enabled) {
      // stop listening, hide transcript/help
      try { voice.toggle(false); } catch { }
      setTranscript('');
      if (help && !help.classList.contains('hidden')) hideHelpModal();
    }
  }

  // Helpers for routing by voice (only used for PIREP fields below)

  // Intent handlers (PIREP-only)
  function handleIntent(textRaw) {
    if (!isPirepModeEnabled()) return false;
    const text = (textRaw || '').toLowerCase();

    // Help dialog
    if (/^help\b|\bshow help\b|what can you do/.test(text)) {
      showHelpModal();
      speak('PIREP help. Say back to close.');
      return true;
    }

    // Close help
    if (/^back$/.test(text) || /close help/.test(text)) {
      const help = document.getElementById('voice-help');
      if (help && !help.classList.contains('hidden')) {
        hideHelpModal();
        speak('Closing help.');
        return true;
      }
    }

    // Fill PIREP fields
    const setField = (label, id, regex) => {
      const mm = text.match(regex);
      if (!mm) return false;
      const el = /** @type {HTMLInputElement} */(document.getElementById(id));
      if (el) {
        el.value = mm[1].trim();
        el.dispatchEvent(new Event('input'));
        speak(`${label} set.`);
        return true;
      }
      return false;
    };
    if (setField('problem type', 'problem-type', /(?:problem|issue|type) (?:is|=) (.+)$/)) return true;
    if (setField('location', 'location', /location (?:is|=) (.+)$/)) return true;
    if (setField('aircraft model', 'aircraft-model', /aircraft (?:is|=) (.+)$/)) return true;
    if (setField('altitude', 'altitude', /altitude (?:is|=) (.+)$/)) return true;
    if (setField('description', 'pirep-input', /description\s*(?::| is|=)\s*(.+)$/)) return true;

    // Generate PIREP
    if (/convert pirep|generate pirep|send pirep/.test(text)) {
      const btn = document.getElementById('convert-pirep-btn');
      if (btn) {
        btn.click();
        speak('Generating PIREP.');
        return true;
      }
    }

    // Stop listening
    if (/stop listening|cancel|stop/.test(text)) {
      voice.toggle(false);
      speak('Stopping listening.');
      return true;
    }

    return false;
  }

  const voice = (() => {
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    const GrammarList = window.SpeechGrammarList || window.webkitSpeechGrammarList;
    let reconn;
    let active = false;
    let desired = false;
    let idleTimer;

    async function ensureMicPermission() {
      try {
        if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
          await navigator.mediaDevices.getUserMedia({ audio: true });
        }
      } catch (e) {
        speak('Microphone permission is required. Please allow access.');
        throw e;
      }
    }

    function start() {
      if (!Recognition) {
        alert('Speech recognition is not supported in this browser. Use Chrome/Edge on desktop over HTTPS or localhost.');
        return;
      }
      if (active) return;
      reconn = new Recognition();
      reconn.lang = 'en-US';
      reconn.interimResults = true;
      reconn.continuous = true;
      try {
        if (GrammarList) {
          const grammars = new GrammarList();
          const cmds = [
            'help', 'back', 'add pirep', 'generate pirep', 'convert pirep',
            'problem is', 'location is', 'aircraft is', 'altitude is', 'description is'
          ];
          const jsgf = `#JSGF V1.0; grammar cmds; public <cmd> = ${cmds.join(' | ')} ;`;
          grammars.addFromString(jsgf, 1);
          reconn.grammars = grammars;
        }
      } catch { }

      reconn.onstart = () => {
        active = true;
        const fab = document.getElementById('voice-fab');
        if (fab) fab.classList.add('recording');
        setTranscript('Listening…');
      };

      let finalBuffer = '';
      reconn.onresult = (e) => {
        clearTimeout(idleTimer);
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const res = e.results[i];
          const transcript = res[0].transcript.trim();
          if (!res.isFinal) {
            setTranscript(transcript);
          } else {
            finalBuffer += (finalBuffer ? ' ' : '') + transcript;
            setTranscript(finalBuffer);
            try { if (handleIntent(transcript)) finalBuffer = ''; } catch { }
          }
        }
        idleTimer = setTimeout(() => {
          if (desired && isPirepModeEnabled()) speak("I didn't catch that.");
        }, 8000);
      };

      reconn.onnomatch = () => {
        setTranscript('Did not understand.');
      };

      reconn.onerror = (ev) => {
        const err = ev && ev.error;
        if (err === 'no-speech') {
          setTranscript('No speech detected.');
        } else if (err === 'audio-capture') {
          setTranscript('No microphone found.');
          speak('No microphone found or accessible.');
        } else if (err === 'not-allowed') {
          setTranscript('Microphone permission denied.');
          speak('Microphone permission denied.');
        } else {
          setTranscript(`Error: ${err || 'unknown'}`);
        }
      };

      reconn.onend = () => {
        const fab = document.getElementById('voice-fab');
        if (fab) fab.classList.remove('recording');
        active = false;
        if (desired && isPirepModeEnabled()) {
          setTimeout(() => { try { reconn.start(); } catch { } }, 300);
        }
      };

      try { reconn.start(); } catch { }
    }

    async function toggle(force) {
      const available = isPirepModeEnabled();
      if (!available) return;
      desired = typeof force === 'boolean' ? force : !desired;
      if (desired) {
        try { await ensureMicPermission(); } catch { desired = false; return; }
        start();
      } else {
        if (reconn && active) {
          try { reconn.stop(); } catch { }
        }
        setTranscript('');
      }
    }

    return { toggle };
  })();

  function initVoiceAssistant() {
    ensureVoiceButton(); ensureTranscript(); ensureHelpModal();
    const btn = document.getElementById('voice-fab');
    if (btn && !btn.dataset.bound) {
      btn.dataset.bound = '1';
      btn.addEventListener('click', () => voice.toggle());
    }
    if (!window.__voiceHotkeyBound) {
      window.__voiceHotkeyBound = true;
      window.addEventListener('keydown', (e) => {
        // Changed to check for the specific code 'AltRight'
        if (e.code === 'AltRight' && !e.metaKey && !e.ctrlKey && !e.shiftKey) {
          e.preventDefault();
          if (isPirepModeEnabled()) voice.toggle();
        }
      });
    }

    // Bind to PIREP toggle to enable/disable voice UI
    const toggle = /** @type {HTMLInputElement|null} */(document.getElementById('toggle-pirep'));
    if (toggle && !toggle.dataset.voiceBound) {
      toggle.dataset.voiceBound = '1';
      toggle.addEventListener('change', updateVoiceAvailability);
    }
    updateVoiceAvailability();
  }

  const origRender = render;
  render = function () {
    origRender.apply(this, arguments);
    try { initVoiceAssistant(); updateVoiceAvailability(); } catch { }
  };

  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    setTimeout(() => { try { initVoiceAssistant(); updateVoiceAvailability(); } catch { } }, 0);
  } else {
    document.addEventListener('DOMContentLoaded', () => { try { initVoiceAssistant(); updateVoiceAvailability(); } catch { } });
  }
})();
// ---------- End Voice Assistant ----------

// ---------- NEW FEATURE: Performance Calculations ----------
const aircraftPerformanceData = {
  'C172': { name: 'Cessna 172', cruiseTas: 120, fuelBurn: 8, fuelUnit: 'G' },
  'B737': { name: 'Boeing 737', cruiseTas: 450, fuelBurn: 5000, fuelUnit: 'lb' },
  'A320': { name: 'Airbus A320', cruiseTas: 470, fuelBurn: 5300, fuelUnit: 'lb' },
};

function haversineDistance(coords1, coords2) {
  const R = 3440.065; // Earth radius in nautical miles
  const lat1 = toRad(coords1[0]);
  const lon1 = toRad(coords1[1]);
  const lat2 = toRad(coords2[0]);
  const lon2 = toRad(coords2[1]);

  const dLat = lat2 - lat1;
  const dLon = lon2 - lon1;

  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function calculatePerformance(legs, aircraftType) {
  const aircraft = aircraftPerformanceData[aircraftType] || aircraftPerformanceData['C172'];
  let totalDistance = 0;
  let totalTimeHours = 0;

  if (!legs || legs.length < 2) {
    return {
      totalDistance: 0,
      totalTime: { hours: 0, minutes: 0 },
      totalFuel: 0,
      aircraft,
    };
  }

  for (let i = 0; i < legs.length - 1; i++) {
    const legStart = legs[i];
    const legEnd = legs[i + 1];

    if (!legStart.coords || !legEnd.coords) continue;

    const distance = haversineDistance(legStart.coords, legEnd.coords);
    totalDistance += distance;

    const windSpeed = legStart.metar?.wind?.speed_kts || 0;
    const windDir = legStart.metar?.wind?.degrees || 0;

    const track = calculateBearing(legStart.coords, legEnd.coords);

    // Calculate headwind component
    const windAngle = Math.abs(track - windDir);
    const headwind = windSpeed * Math.cos(toRad(windAngle));

    const groundSpeed = aircraft.cruiseTas - headwind;

    if (groundSpeed > 0) {
      totalTimeHours += distance / groundSpeed;
    }
  }

  const totalMinutes = Math.round(totalTimeHours * 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  const totalFuel = totalTimeHours * aircraft.fuelBurn;

  return {
    totalDistance,
    totalTime: { hours, minutes },
    totalFuel,
    aircraft,
  };
}

function calculateBearing(coords1, coords2) {
  const lat1 = toRad(coords1[0]);
  const lon1 = toRad(coords1[1]);
  const lat2 = toRad(coords2[0]);
  const lon2 = toRad(coords2[1]);

  const y = Math.sin(lon2 - lon1) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(lon2 - lon1);
  const brng = toDeg(Math.atan2(y, x));
  return (brng + 360) % 360;
}

// ---------- NEW FEATURE: Alternative Route Suggestions ----------
const nearbyMajorAirports = {
  'KJFK': 'KPHL', 'KORD': 'KMDW', 'KLAX': 'KSNA', 'KATL': 'KPDK',
  'KDFW': 'KDAL', 'KSFO': 'KOAK', 'KLAS': 'KHND', 'KDEN': 'KBJC',
};

async function analyzeAndSuggestRoutes() {
  if (!AppState.data || !AppState.data.legs) return;

  const primaryRoute = AppState.data.legs;
  let adverseAirportIndex = -1;

  // Find the first airport with IFR or LIFR conditions
  for (let i = 0; i < primaryRoute.length; i++) {
    const leg = primaryRoute[i];
    if (leg.category === 'IFR' || leg.category === 'LIFR') {
      adverseAirportIndex = i;
      break;
    }
  }

  if (adverseAirportIndex === -1) return; // No adverse weather found

  const adverseAirportIcao = primaryRoute[adverseAirportIndex].icao;
  const alternativeIcao = nearbyMajorAirports[adverseAirportIcao];

  if (!alternativeIcao) return; // No alternative available for this airport

  const originalRouteIcaos = primaryRoute.map(leg => leg.icao);
  const alternativeRouteIcaos = [...originalRouteIcaos];
  alternativeRouteIcaos[adverseAirportIndex] = alternativeIcao;

  // Fetch briefing for the alternative route
  try {
    const section = document.getElementById('alternative-routes-section');
    const content = document.getElementById('alternative-routes-content');
    if (!section || !content) return;

    content.innerHTML = `<p class="text-center" style="color: #ffffff;">Analyzing alternative route...</p>`;
    section.classList.remove('hidden');

    const params = new URLSearchParams({
      codes: alternativeRouteIcaos.join(','),
      include_notams: 'false' // Simplified for comparison
    });
    const resp = await fetch(`/briefing?${params.toString()}`);
    if (!resp.ok) throw new Error('Failed to fetch alternative briefing');
    const altData = await resp.json();

    const altLegs = mapReportsToLegs(altData.metar_reports || [], altData.taf_reports || []);
    altLegs.forEach((leg, index) => {
      if (altData.metar_reports && altData.metar_reports[index]) {
        leg.metar = altData.metar_reports[index];
      }
    });

    const primaryPerf = calculatePerformance(primaryRoute, AppState.data.aircraftType);
    const altPerf = calculatePerformance(altLegs, AppState.data.aircraftType);

    renderAlternativeComparison(content, {
      primary: { route: originalRouteIcaos, perf: primaryPerf, legs: primaryRoute },
      alternative: { route: alternativeRouteIcaos, perf: altPerf, legs: altLegs, reason: `Adverse weather at ${adverseAirportIcao}` }
    });
  } catch (err) {
    console.error("Error fetching alternative route:", err);
    const section = document.getElementById('alternative-routes-section');
    if (section) section.classList.add('hidden');
  }
}

function renderAlternativeComparison(container, data) {
  container.innerHTML = `
        <p class="mb-4" style="color: #ffffff;">The primary route includes an airport with significant weather (${data.alternative.reason}). A safer alternative is suggested below for comparison.</p>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div class="card p-4 border-2 border-red-500">
                <h4 class="font-bold text-lg mb-2 text-red-400">Primary Route</h4>
                <p class="font-mono text-center text-lg mb-3" style="color: #ffffff;">${data.primary.route.join(' → ')}</p>
                ${renderComparisonMetrics(data.primary)}
                <div class="mt-3">
                    <h5 class="font-semibold text-sm mb-2" style="color: var(--apache-green);">Conditions:</h5>
                    ${data.primary.legs.map(leg => renderLegCondition(leg, leg.icao === data.alternative.reason.split(' ')[3])).join('')}
                </div>
            </div>

            <div class="card p-4 border-2 border-green-500">
                <h4 class="font-bold text-lg mb-2 text-green-400">Suggested Alternative</h4>
                <p class="font-mono text-center text-lg mb-3" style="color: #ffffff;">${data.alternative.route.join(' → ')}</p>
                ${renderComparisonMetrics(data.alternative)}
                 <div class="mt-3">
                    <h5 class="font-semibold text-sm mb-2" style="color: var(--apache-green);">Conditions:</h5>
                    ${data.alternative.legs.map(leg => renderLegCondition(leg, false)).join('')}
                </div>
            </div>
        </div>
    `;
}

function renderComparisonMetrics(routeData) {
  const perf = routeData.perf;
  return `
        <div class="grid grid-cols-3 gap-2 text-center bg-gray-800/50 p-2 rounded-lg">
            <div>
                <div class="text-xs text-gray-400">Distance</div>
                <div class="font-bold text-md" style="color: #ffffff;">${perf.totalDistance.toFixed(0)} NM</div>
            </div>
            <div>
                <div class="text-xs text-gray-400">Time</div>
                <div class="font-bold text-md" style="color: #ffffff;">${perf.totalTime.hours}h ${perf.totalTime.minutes}m</div>
            </div>
            <div>
                <div class="text-xs text-gray-400">Fuel</div>
                <div class="font-bold text-md" style="color: #ffffff;">${perf.totalFuel.toFixed(0)} ${perf.aircraft.fuelUnit}</div>
            </div>
        </div>
    `;
}

function renderLegCondition(leg, isAdverse) {
  const categoryClass = { VFR: 'text-green-400', MVFR: 'text-blue-400', IFR: 'text-red-400', LIFR: 'text-pink-400' }[leg.category] || 'text-gray-400';
  const wind = leg.metar?.wind ? `${leg.metar.wind.degrees}° @ ${leg.metar.wind.speed_kts}kt` : 'N/A';
  const adverseStyle = isAdverse ? 'background-color: rgba(255,0,0,0.2); border-left: 3px solid #f00;' : '';
  return `
        <div class="flex justify-between items-center text-sm p-1 rounded" style="color: #ffffff; ${adverseStyle}">
            <span class="font-mono font-bold">${leg.icao}</span>
            <span class="font-semibold ${categoryClass}">${leg.category}</span>
            <span>${wind}</span>
        </div>
    `;
}