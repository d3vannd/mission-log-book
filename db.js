/**
 * Mission Log Book - IndexedDB Storage Layer
 * High-performance, offline-first local database.
 * 
 * Stores:
 * - 'flights': Flight mission records with full telemetry and incident logs.
 * - 'batteries': Battery hardware definitions and life cycle parameters.
 * - 'settings': App configuration (cycle counting mode, themes, display units).
 */

const DB_NAME = 'MissionLogBookDB';
const DB_VERSION = 1;

class MissionLogDB {
  constructor() {
    this.db = null;
    this.initPromise = null;
  }

  /**
   * Initializes and opens the IndexedDB database.
   * Returns a promise resolving to the IDBDatabase instance.
   */
  async open() {
    if (this.db) return this.db;
    if (this.initPromise) return this.initPromise;

    this.initPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = event.target.result;

        // Flights Object Store
        if (!db.objectStoreNames.contains('flights')) {
          const flightStore = db.createObjectStore('flights', { keyPath: 'id' });
          flightStore.createIndex('date', 'date', { unique: false });
          flightStore.createIndex('batteryId', 'batteryId', { unique: false });
          flightStore.createIndex('status', 'status', { unique: false });
          flightStore.createIndex('hasIncident', 'hasIncident', { unique: false });
        }

        // Batteries Object Store
        if (!db.objectStoreNames.contains('batteries')) {
          const batteryStore = db.createObjectStore('batteries', { keyPath: 'id' });
          batteryStore.createIndex('name', 'name', { unique: false });
          batteryStore.createIndex('chemistry', 'chemistry', { unique: false });
        }

        // Settings Object Store
        if (!db.objectStoreNames.contains('settings')) {
          db.createObjectStore('settings', { keyPath: 'key' });
        }
      };

      request.onsuccess = (event) => {
        this.db = event.target.result;
        this.db.onversionchange = () => {
          this.db.close();
          this.db = null;
        };
        resolve(this.db);
      };

      request.onerror = (event) => {
        console.error('IndexedDB open error:', event.target.error);
        reject(event.target.error);
      };
    });

    return this.initPromise;
  }

  /* =========================================================================
     FLIGHTS CRUD OPERATIONS
     ========================================================================= */

  async getAllFlights() {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('flights', 'readonly');
      const store = tx.objectStore('flights');
      const request = store.getAll();

      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
  }

  async getFlight(id) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('flights', 'readonly');
      const store = tx.objectStore('flights');
      const request = store.get(id);

      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  }

  async saveFlight(flightData) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('flights', 'readwrite');
      const store = tx.objectStore('flights');

      const now = new Date().toISOString();
      const record = {
        ...flightData,
        updatedAt: now,
        createdAt: flightData.createdAt || now
      };

      const request = store.put(record);

      request.onsuccess = () => resolve(record);
      request.onerror = () => reject(request.error);
    });
  }

  async deleteFlight(id) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('flights', 'readwrite');
      const store = tx.objectStore('flights');
      const request = store.delete(id);

      request.onsuccess = () => resolve(true);
      request.onerror = () => reject(request.error);
    });
  }

  /* =========================================================================
     BATTERIES CRUD OPERATIONS
     ========================================================================= */

  async getAllBatteries() {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('batteries', 'readonly');
      const store = tx.objectStore('batteries');
      const request = store.getAll();

      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
  }

  async getBattery(id) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('batteries', 'readonly');
      const store = tx.objectStore('batteries');
      const request = store.get(id);

      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  }

  async saveBattery(batteryData) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('batteries', 'readwrite');
      const store = tx.objectStore('batteries');

      const now = new Date().toISOString();
      const record = {
        ...batteryData,
        initialCycles: Number(batteryData.initialCycles) || 0,
        maxCycles: Number(batteryData.maxCycles) || 300,
        capacity: Number(batteryData.capacity) || 0,
        voltage: Number(batteryData.voltage) || 0,
        updatedAt: now,
        createdAt: batteryData.createdAt || now
      };

      const request = store.put(record);

      request.onsuccess = () => resolve(record);
      request.onerror = () => reject(request.error);
    });
  }

  async deleteBattery(id) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('batteries', 'readwrite');
      const store = tx.objectStore('batteries');
      const request = store.delete(id);

      request.onsuccess = () => resolve(true);
      request.onerror = () => reject(request.error);
    });
  }

  /* =========================================================================
     SETTINGS & CONFIG
     ========================================================================= */

  async getSetting(key, defaultValue = null) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('settings', 'readonly');
      const store = tx.objectStore('settings');
      const request = store.get(key);

      request.onsuccess = () => {
        if (request.result && request.result.value !== undefined) {
          resolve(request.result.value);
        } else {
          resolve(defaultValue);
        }
      };
      request.onerror = () => reject(request.error);
    });
  }

  async setSetting(key, value) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('settings', 'readwrite');
      const store = tx.objectStore('settings');
      const request = store.put({ key, value });

      request.onsuccess = () => resolve(value);
      request.onerror = () => reject(request.error);
    });
  }

  async getAllSettings() {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('settings', 'readonly');
      const store = tx.objectStore('settings');
      const request = store.getAll();

      request.onsuccess = () => {
        const settings = {};
        (request.result || []).forEach(item => {
          settings[item.key] = item.value;
        });
        resolve(settings);
      };
      request.onerror = () => reject(request.error);
    });
  }

  /* =========================================================================
     BACKUP, RESTORE & WIPE
     ========================================================================= */

  async exportFullDatabase() {
    const [flights, batteries, settings] = await Promise.all([
      this.getAllFlights(),
      this.getAllBatteries(),
      this.getAllSettings()
    ]);

    return {
      appName: 'Mission Log Book',
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      flights,
      batteries,
      settings
    };
  }

  async clearAllData() {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(['flights', 'batteries', 'settings'], 'readwrite');
      tx.objectStore('flights').clear();
      tx.objectStore('batteries').clear();
      tx.objectStore('settings').clear();

      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    });
  }

  async importData(data, mode = 'replace') {
    if (!data || typeof data !== 'object') {
      throw new Error('Invalid backup file: not a JSON object.');
    }

    if (!Array.isArray(data.flights) && !Array.isArray(data.batteries)) {
      throw new Error('Invalid backup file: missing flights or batteries lists.');
    }

    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(['flights', 'batteries', 'settings'], 'readwrite');
      const flightStore = tx.objectStore('flights');
      const batteryStore = tx.objectStore('batteries');
      const settingStore = tx.objectStore('settings');

      if (mode === 'replace') {
        flightStore.clear();
        batteryStore.clear();
        settingStore.clear();
      }

      // Restore batteries
      if (Array.isArray(data.batteries)) {
        data.batteries.forEach(battery => {
          if (battery && battery.id) {
            batteryStore.put(battery);
          }
        });
      }

      // Restore flights
      if (Array.isArray(data.flights)) {
        data.flights.forEach(flight => {
          if (flight && flight.id) {
            flightStore.put(flight);
          }
        });
      }

      // Restore settings
      if (data.settings && typeof data.settings === 'object') {
        Object.entries(data.settings).forEach(([key, value]) => {
          settingStore.put({ key, value });
        });
      }

      tx.oncomplete = () => resolve({
        flightsCount: (data.flights || []).length,
        batteriesCount: (data.batteries || []).length
      });

      tx.onerror = () => reject(tx.error);
    });
  }
}

// Export singleton instance
window.missionDB = new MissionLogDB();
