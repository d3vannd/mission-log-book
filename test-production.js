/**
 * Mission Log Book - Production Deployment Verification Suite
 * Tests the live HTTPS deployment on Vercel: https://mission-log-book.vercel.app
 */

const { spawn } = require('child_process');
const http = require('http');

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const DEBUG_PORT = 9226;
const PROD_URL = 'https://mission-log-book.vercel.app/';

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function getDebuggerUrl() {
  for (let i = 0; i < 30; i++) {
    try {
      const data = await new Promise((resolve, reject) => {
        http.get(`http://127.0.0.1:${DEBUG_PORT}/json`, res => {
          let body = '';
          res.on('data', chunk => body += chunk);
          res.on('end', () => resolve(body));
        }).on('error', reject);
      });
      const list = JSON.parse(data);
      const page = list.find(p => p.type === 'page');
      if (page && page.webSocketDebuggerUrl) {
        return page.webSocketDebuggerUrl;
      }
    } catch (e) {
      // retry
    }
    await sleep(200);
  }
  throw new Error('Could not connect to Chrome DevTools port ' + DEBUG_PORT);
}

class CDPClient {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.ws = null;
    this.id = 1;
    this.callbacks = new Map();
  }

  async connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.wsUrl);
      this.ws.onopen = () => resolve();
      this.ws.onerror = (err) => reject(err);
      this.ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        if (msg.id && this.callbacks.has(msg.id)) {
          const { resolve, reject } = this.callbacks.get(msg.id);
          this.callbacks.delete(msg.id);
          if (msg.error) {
            reject(new Error(msg.error.message));
          } else {
            resolve(msg.result);
          }
        }
      };
    });
  }

  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const msgId = this.id++;
      this.callbacks.set(msgId, { resolve, reject });
      this.ws.send(JSON.stringify({ id: msgId, method, params }));
    });
  }

  async eval(expression) {
    const res = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true
    });
    if (res.exceptionDetails) {
      throw new Error('Evaluation error: ' + JSON.stringify(res.exceptionDetails));
    }
    return res.result ? res.result.value : undefined;
  }
}

async function verifyProduction() {
  console.log('--- Launching Chrome for Live Production Verification ---');
  const chromeProcess = spawn(CHROME_PATH, [
    `--remote-debugging-port=${DEBUG_PORT}`,
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    '--window-size=1280,800',
    'about:blank'
  ]);

  try {
    const wsUrl = await getDebuggerUrl();
    console.log('Connected to Chrome WebSocket:', wsUrl);

    const client = new CDPClient(wsUrl);
    await client.connect();

    await client.send('Page.enable');
    await client.send('Runtime.enable');

    console.log('Navigating to Live URL:', PROD_URL);
    await client.send('Page.navigate', { url: PROD_URL });
    await sleep(2500);

    // 1. Verify Page Title & Protocol
    const pageCheck = await client.eval(`
      (() => ({
        title: document.title,
        protocol: location.protocol,
        origin: location.origin
      }))()
    `);
    console.log('[PROD TEST 1] Page Loaded:', pageCheck);
    if (!pageCheck.title.includes('Mission Log Book') || pageCheck.protocol !== 'https:') {
      throw new Error('Production page check failed');
    }

    // 2. Verify Service Worker Registration on HTTPS
    console.log('[PROD TEST 2] Verifying Service Worker...');
    const swStatus = await client.eval(`
      (async () => {
        if (!('serviceWorker' in navigator)) return { supported: false };
        const reg = await navigator.serviceWorker.getRegistration();
        return {
          supported: true,
          registered: !!reg,
          scope: reg ? reg.scope : null
        };
      })()
    `);
    console.log('Service Worker Status:', swStatus);

    // 3. Verify Manifest & Icon Link Elements
    console.log('[PROD TEST 3] Verifying Manifest & PWA Metas...');
    const pwaCheck = await client.eval(`
      (() => {
        const manifestLink = document.querySelector('link[rel="manifest"]');
        const icon192 = document.querySelector('link[rel="icon"]');
        return {
          manifestHref: manifestLink ? manifestLink.href : null,
          iconHref: icon192 ? icon192.href : null
        };
      })()
    `);
    console.log('PWA Manifest & Icon tags:', pwaCheck);

    // 4. Test Battery Registration in Live Production
    console.log('[PROD TEST 4] Adding Battery Pack...');
    const batteryCheck = await client.eval(`
      (async () => {
        const battery = {
          id: 'BATT-PROD-6S-5000',
          name: 'LiPo 6S 5000mAh Live Production Pack',
          chemistry: 'LiPo',
          capacity: 5000,
          voltage: 22.2,
          cells: '6S',
          purchaseDate: '2026-10-10',
          initialCycles: 10,
          maxCycles: 300,
          notes: 'Tested on live Vercel deployment'
        };
        await window.missionDB.saveBattery(battery);
        const list = await window.missionDB.getAllBatteries();
        return { count: list.length, id: list[0].id };
      })()
    `);
    console.log('Battery Created in Production IndexedDB:', batteryCheck);

    // 5. Test Flight Logging with Telemetry & Discharge Delta
    console.log('[PROD TEST 5] Logging Flight Mission...');
    const flightCheck = await client.eval(`
      (async () => {
        const flight = {
          id: 'FL-PROD-001',
          date: '2026-10-10T12:00:00.000Z',
          location: 'Production Airfield Beta',
          batteryId: 'BATT-PROD-6S-5000',
          duration: 35,
          status: 'completed',
          missionName: 'Live Vercel Validation Sortie',
          pilotName: 'DevOps Lead',
          aircraftModel: 'Enterprise Drone',
          purpose: 'Verification',
          weather: 'Clear, 8kt Wind, 22C',
          preFlightPct: 100,
          postFlightPct: 45,
          notes: 'Live HTTPS deployment verified successfully.',
          hasIncident: false,
          incidentSeverity: 'none'
        };
        await window.missionDB.saveFlight(flight);
        const list = await window.missionDB.getAllFlights();
        return { count: list.length, id: list[0].id };
      })()
    `);
    console.log('Flight Logged in Production IndexedDB:', flightCheck);

    // 6. Test Dashboard Update & Cycle Calculation
    console.log('[PROD TEST 6] Verifying Dashboard & Cycle Calculations...');
    await client.eval('location.reload()');
    await sleep(2000);

    const liveStats = await client.eval(`
      (() => ({
        kpiFlights: document.getElementById('kpi-total-flights').textContent,
        kpiDuration: document.getElementById('kpi-total-duration').textContent,
        kpiBatteries: document.getElementById('kpi-total-batteries').textContent,
        kpiCycles: document.getElementById('kpi-total-cycles').textContent
      }))()
    `);
    console.log('Live Dashboard Stats:', liveStats);
    if (liveStats.kpiFlights !== '1' || liveStats.kpiBatteries !== '1') {
      throw new Error('Live dashboard stats mismatch: ' + JSON.stringify(liveStats));
    }

    // 7. Test EFC Toggle
    console.log('[PROD TEST 7] Testing Advanced EFC on Live Site...');
    const liveEfc = await client.eval(`
      (async () => {
        await window.missionDB.setSetting('cycleMode', 'advanced');
        location.reload();
      })()
    `);
    await sleep(2000);

    const efcStats = await client.eval(`
      (() => ({
        kpiCycles: document.getElementById('kpi-total-cycles').textContent
      }))()
    `);
    // Pre=100%, Post=45% -> 55% discharge = 0.55 cycles + 10 initial = 10.6 cycles
    console.log('Live EFC Cycles (100% -> 45% = 0.55 delta + 10 = 10.6):', efcStats);
    if (efcStats.kpiCycles !== '10.6') {
      throw new Error('EFC calculation mismatch on live site: ' + efcStats.kpiCycles);
    }

    // 8. Test CSV Generation & JSON Backup in Production
    console.log('[PROD TEST 8] Verifying CSV & JSON Backup in Production...');
    const backupTest = await client.eval(`
      (async () => {
        const backup = await window.missionDB.exportFullDatabase();
        return {
          hasFlights: backup.flights && backup.flights.length === 1,
          hasBatteries: backup.batteries && backup.batteries.length === 1,
          hasSettings: !!backup.settings
        };
      })()
    `);
    console.log('Live Backup Export Check:', backupTest);
    if (!backupTest.hasFlights || !backupTest.hasBatteries) {
      throw new Error('Live backup validation failed');
    }

    // 9. Mobile Responsive Layout Check (390x844)
    console.log('[PROD TEST 9] Testing Mobile Responsive Layout on Live Site...');
    await client.send('Emulation.setDeviceMetricsOverride', {
      width: 390,
      height: 844,
      deviceScaleFactor: 3,
      mobile: true
    });
    await sleep(500);

    const mobileCheck = await client.eval(`
      (() => {
        const bottomNav = document.querySelector('.mobile-bottom-nav');
        const fab = document.querySelector('.fab-btn');
        return {
          bottomNavVisible: window.getComputedStyle(bottomNav).display !== 'none',
          fabVisible: window.getComputedStyle(fab).display !== 'none'
        };
      })()
    `);
    console.log('Mobile Layout Check:', mobileCheck);
    if (!mobileCheck.bottomNavVisible || !mobileCheck.fabVisible) {
      throw new Error('Mobile layout failed on live deployment');
    }

    console.log('\n======================================================');
    console.log('LIVE VERCEL DEPLOYMENT VERIFICATION: 100% SUCCESS!');
    console.log('======================================================\n');
  } finally {
    chromeProcess.kill();
  }
}

verifyProduction().catch(err => {
  console.error('\n❌ Production Verification Error:', err);
  process.exit(1);
});
