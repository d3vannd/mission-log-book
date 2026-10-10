# Mission Log Book — Pilot & Drone Flight Log

> **A professional, mobile-friendly, offline-first aviation logbook for pilots, drone operators, and fleet managers to record flight missions, monitor battery health, calculate usage and equivalent full cycles (EFC), and export flight records to CSV.**

---

## 🛫 1. Project Overview

**Mission Log Book** is a standalone Progressive Web Application (PWA) designed for commercial drone operators, aerial surveyors, RC aviators, and general aviation pilots. 

It provides reliable, zero-latency flight logging and battery health telemetry directly in the field. Built strictly with client-side web standards, **all user data remains 100% private and persistent on the user's device** using IndexedDB. No server accounts, subscriptions, or cloud connections are ever required.

---

## ⚡ 2. Key Features

- **📱 Mobile-First Responsive HUD Design**:
  - Touch-friendly interface with dark navy cockpit aesthetics, electric cyan telemetry accents, and high-readability typography.
  - Ergonomic bottom navigation bar on smartphones and a collapsible/persistent sidebar on desktop and tablet displays.
  - Floating Action Button (FAB) for rapid mission logging in the field.

- **📊 Real-Time Mission Dashboard**:
  - Live Key Performance Indicators (KPIs): Total Flights, Cumulative Air Time, Registered Batteries, Total Accumulated Cycles, Sorties Completed This Month, and Mission Reliability Rate.
  - "Top Workhorse Battery" analytics card tracking fleet primary packs.
  - Real-time updates across the dashboard whenever flights or batteries are added, edited, or deleted.

- **🛩 Comprehensive Flight Mission Management**:
  - **Required Telemetry**: Auto-generated unique Flight ID, Date & Time, Location, Battery used, Flight Duration (hours & minutes), Flight Status (*Completed*, *Aborted*, *Emergency Landing*).
  - **Optional Mission Fields**: Mission Name, Pilot/Operator, Aircraft/Drone Model, Flight Purpose, Weather Conditions, Pre-flight Battery %, Post-flight Battery %, Pilot Notes.
  - **Incident & Anomaly Logging**: Severity ratings (*Low*, *Medium*, *High*, *Critical*), incident descriptions, corrective actions taken, and follow-up maintenance flags.
  - **Instant Search & Multi-Filter Engine**: Filter by date range, battery pack, flight status, and incident severity; sort by date or duration.
  - **Interactive Flight Dossier**: Inspect complete flight records in a modal view with quick edit, export, and delete options.

- **🔋 Battery Fleet Management & Dual Cycle-Counting Logic**:
  - Register battery packs with Chemistry (LiPo, Li-ion, LiFePO4, Solid-State, NiMH), Capacity (mAh), Nominal Voltage, Cell count (e.g. 6S, 12S), Purchase Date, Initial Cycles, and Maximum Recommended Cycles.
  - Real-time Health Status indicator (*Optimal*, *Moderate Wear*, *Near End of Life*, *Exceeded Rating*) with color-coded progress bars.
  - **Dual Cycle-Counting Modes**:
    1. **Simple Usage Count (1:1)**: Each recorded flight increments battery usage by 1.0 cycle. Labeled as a usage-based estimate.
    2. **Advanced Equivalent Full Cycles (EFC)**: Calculates cycle wear from depth of discharge:
       $$\text{Cycle Delta} = \frac{\text{Pre-Flight \%} - \text{Post-Flight \%}}{100}$$
       *(e.g., a flight discharging from 100% to 60% consumes $0.40$ full cycles. Safe fallback to 1.0 cycle if telemetry readings are omitted).*
  - Dynamic recalculation on all edits, deletions, or battery reassignments without duplicate counting.

- **📑 Robust CSV Export Engine**:
  - **Export All Flights**: Complete flight archive with all operational and incident fields.
  - **Export Battery Summary**: Fleet inventory with capacity, air time, initial cycles, flight cycles, total cycles, health ratings, and last used dates.
  - **Export Filtered Flights**: Only exports records currently matching active search and filter criteria.
  - **Security & Compatibility**: Full RFC 4180 compliance, quote escaping, **CSV Formula Injection defense** (sanitizes `=, +, -, @, \t, \r`), and UTF-8 BOM (`\uFEFF`) for seamless opening in Microsoft Excel.

- **🔒 Local Privacy, Backup & Restore**:
  - One-click JSON backup export (`mission_log_backup_*.json`).
  - Restoring backup with JSON schema validation and confirmation dialog.
  - Factory reset / database clear with confirmation safeguards.
  - Sample aviation demo dataset loader for instant testing.

---

## 🛠 3. Technology Stack

- **HTML5**: Semantic, accessible markup with native modal dialog structures.
- **CSS3**: Custom design tokens, responsive CSS Grid and Flexbox layouts, aviation HUD color system, and smooth hardware-accelerated animations. No heavy CSS frameworks.
- **Vanilla JavaScript (ES6+)**: Modular application architecture, state management, and real-time computation.
- **IndexedDB**: Persistent local database (`MissionLogBookDB`) with transactional integrity.
- **Service Worker API**: Shell caching and offline resource serving.
- **Web App Manifest**: Enables installation as a native Progressive Web App (PWA).
- **Blob & URL APIs**: Client-side CSV and JSON generation and instant downloads.

---

## 🚀 4. How to Run the Application

Because Progressive Web Apps and Service Workers require a secure origin (`https://` or `localhost`), run the application using any local web server.

### Option A: Using Python (Recommended)
```bash
# Navigate to the project directory
cd mission-log-book

# Start Python's built-in HTTP server on port 8000
python -m http.server 8000
```
Open your browser to: **`http://localhost:8000`**

### Option B: Using Node.js (`npx serve` or `http-server`)
```bash
cd mission-log-book
npx serve -l 8000 .
```
Open your browser to: **`http://localhost:8000`**

---

## 📲 5. How to Install as a PWA

Mission Log Book is configured as an installable Progressive Web App:

1. **On Mobile (Android / Chrome)**:
   - Open the web app URL in Chrome.
   - Tap the three dots menu (**⋮**) or the "Add to Home screen" banner.
   - Tap **Install app** / **Add to Home screen**.
   - The app will now open full-screen like a native mobile app without URL bars.

2. **On Mobile (iOS / Safari)**:
   - Open the web app URL in Safari.
   - Tap the **Share** button (box with upward arrow).
   - Scroll down and tap **Add to Home Screen**.
   - Tap **Add** in the top right.

3. **On Desktop (Chrome / Edge / Brave)**:
   - Look for the **Install Mission Log Book** icon on the right side of the address bar.
   - Click **Install** to run the app in its own standalone desktop window.

---

## 🌐 6. How Offline Caching Works

1. During the initial application load, the registered Service Worker (`service-worker.js`) intercepts the network request and downloads the static application shell:
   - `index.html`
   - `styles.css`
   - `app.js`
   - `db.js`
   - `manifest.json`
   - `assets/icon-192.png`
   - `assets/icon-512.png`
2. The Service Worker caches these assets inside the browser's Cache Storage (`mission-log-cache-v1`).
3. On all subsequent visits, requests are served **cache-first**, allowing the app to launch instantly even if the device is in airplane mode or operating in remote flight zones with zero cellular signal.
4. An online/offline indicator in the top HUD alerts pilots when connection drops, confirming that local IndexedDB storage remains fully active.

---

## 💾 7. How to Export and Restore Data

### Exporting Backups:
1. Navigate to the **Settings** tab.
2. In the **Data Privacy, Backup & Restore** section, click **Export JSON Backup**.
3. A JSON file titled `mission_log_backup_<timestamp>.json` will download immediately.
4. Keep this file stored on your laptop, external drive, or cloud drive for safekeeping.

### Restoring Backups:
1. Under **Settings**, click **Restore from JSON Backup**.
2. Select your previously exported `.json` backup file.
3. The app validates the file structure and displays the number of flights and batteries detected.
4. Confirm the prompt to restore and replace the database.

---

## ⚠️ 8. Known Limitations

1. **Electrochemical Battery Degradation**:
   - The **Simple Usage (1:1)** and **Advanced Equivalent Full Cycles (EFC)** calculations are operational estimates. They do not account for cell internal resistance ($m\Omega$), ambient temperature extremes, C-rate discharge stress, or storage degradation.
2. **Browser Storage Eviction**:
   - Clearing browser browsing data, cache, and cookies can remove IndexedDB storage. Always periodically export a JSON backup before clearing site data.
3. **Service Worker Restrictions**:
   - Service Workers will not activate if opening `index.html` via the `file:///` protocol. Always use a local dev server (`http://localhost:8000`) or deploy to an HTTPS static host (such as GitHub Pages, Netlify, or Vercel).

---

## 📜 9. License

MIT License. Free for commercial and recreational aviation operations.
