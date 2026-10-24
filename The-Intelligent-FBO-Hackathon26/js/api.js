/* =========================================================================
   LAXY Intelligent FBO - backend API placeholder layer
   -------------------------------------------------------------------------
   Every dashboard section is wired to one of the endpoints below.
   In this prototype NO real backend exists: each call resolves with a
   synthetic "payload" (model run id, seed, timestamp). The front-end then
   builds a fully synthetic forecast from that payload (see model.js).

   To connect a real backend:
     1. set window.LAXY_API_BASE = 'https://your-host' before this script loads
     2. return JSON from GET /api/v1/forecast with the shape documented in
        `PAYLOAD_SHAPE` below (or extend Model.build to consume richer data)
   ========================================================================= */
(function (global) {
  'use strict';

  const ENDPOINTS = [
    { id: 'forecast',   method: 'GET',  path: '/api/v1/forecast?start=2027-02-10&end=2027-02-16&scenario={low|medium|high}', section: 'Dashboard, Arrival Forecast', desc: 'Daily arrival forecast + hourly schedule with forecast confidence levels' },
    { id: 'schedule',   method: 'GET',  path: '/api/v1/arrivals/schedule?date={date}&scenario={s}',  section: 'Live Schedule', desc: 'Anonymized hourly aircraft entries, service windows, handler assignments (no passenger data)' },
    { id: 'parking',    method: 'GET',  path: '/api/v1/ramp/assignments?date={date}&scenario={s}',   section: 'Parking & Ramp', desc: 'Parking locations / ramp positions per aircraft, duration and status' },
    { id: 'ramp',       method: 'GET',  path: '/api/v1/ramp/capacity?date={date}&scenario={s}',      section: 'Parking & Ramp, Dashboard', desc: 'Positions occupied / reserved / available and overflow outlook' },
    { id: 'runway',     method: 'GET',  path: '/api/v1/runway/advisory?date={date}&scenario={s}',    section: 'Runway Operations (advisory)', desc: 'Advisory-only expected arrival periods, availability and possible arrival conflicts' },
    { id: 'conflicts',  method: 'GET',  path: '/api/v1/schedule/conflicts?date={date}&scenario={s}', section: 'Live Schedule, Assistant', desc: 'Overlapping service windows, parking and spacing conflicts' },
    { id: 'fuel',       method: 'GET',  path: '/api/v1/fuel/requirements?date={date}&scenario={s}',  section: 'Fuel Planning', desc: 'Per-aircraft fuel requirements, hourly demand, inventory projection, replenishment advice' },
    { id: 'staffing',   method: 'GET',  path: '/api/v1/staffing/recommendations?date={date}&scenario={s}', section: 'Staffing', desc: 'Hourly staffing requirements by role vs. current roster' },
    { id: 'scenarios',  method: 'GET',  path: '/api/v1/scenarios',                                   section: 'Demand scenarios', desc: 'Low / Medium / High demand scenario definitions and results' },
    { id: 'alerts',     method: 'GET',  path: '/api/v1/alerts?date={date}&scenario={s}',             section: 'Alerts Center', desc: 'Action-oriented operational alerts with severity' },
    { id: 'recommend',  method: 'POST', path: '/api/v1/assistant/recommendation',                     section: 'Scheduling recommendations', desc: 'Advisory slot, parking, fuel-priority and spacing recommendations' },
    { id: 'chat',       method: 'POST', path: '/api/v1/assistant/chat',                               section: 'AI Operations Assistant', desc: 'Natural-language Q&A over forecast/schedule data. Planning recommendations only' },
    { id: 'accuracy',   method: 'GET',  path: '/api/v1/analytics/accuracy',                          section: 'Reports', desc: 'Forecast vs. actual replay and impact metrics' },
    { id: 'weather',    method: 'GET',  path: '/api/v1/airfield/conditions?date={date}',             section: 'Runway Operations (advisory)', desc: 'Weather, runway closures and NOTAM-style constraints' },
    { id: 'refresh',    method: 'POST', path: '/api/v1/forecast/refresh',                            section: 'Refresh Forecast button', desc: 'Triggers a new model run and returns updated predictions' }
  ];

  /* Documented placeholder response shape (what Model.build consumes today). */
  const PAYLOAD_SHAPE = {
    modelRun: 'integer run counter (0 = baseline run)',
    modelId: 'string e.g. MR-0001',
    seed: 'integer seed for deterministic synthetic generation',
    generatedAt: 'ISO timestamp',
    source: "'synthetic-mock' | 'backend'"
  };

  function pad(n, w) { return String(n).padStart(w, '0'); }

  async function getForecast(run) {
    const base = global.LAXY_API_BASE;
    if (base) {
      try {
        const url = base.replace(/\/$/, '') + '/api/v1/forecast?start=2027-02-10&end=2027-02-16&run=' + run;
        const res = await fetch(url, { headers: { Accept: 'application/json' } });
        if (res.ok) {
          const json = await res.json();
          return Object.assign({ source: 'backend' }, json);
        }
      } catch (e) { /* fall through to synthetic payload */ }
    }
    // Simulated network latency for the mock backend
    await new Promise(function (r) { setTimeout(r, run === 0 ? 350 : 900); });
    return {
      modelRun: run,
      modelId: 'MR-' + pad(run + 1, 4),
      seed: 20270210 + run * 977,
      generatedAt: new Date().toISOString(),
      source: 'synthetic-mock'
    };
  }

  /* Optional backend chat hook. Returns { text, confidence?, actions? } or null so the
     front-end falls back to its local, data-driven answer engine. */
  async function chat(question, ctx) {
    const base = global.LAXY_API_BASE;
    if (!base) return null;
    try {
      const res = await fetch(base.replace(/\/$/, '') + '/api/v1/assistant/chat', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ question: question, context: ctx }) });
      return res.ok ? await res.json() : null;
    } catch (e) { return null; }
  }

  global.LaxyAPI = { ENDPOINTS: ENDPOINTS, PAYLOAD_SHAPE: PAYLOAD_SHAPE, getForecast: getForecast, chat: chat };
})(window);
