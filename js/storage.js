/* Aurora Keys — armazenamento local (IndexedDB para MIDIs, localStorage para preferências) */
(function (global) {
  'use strict';

  const DB_NAME = 'aurora-keys';
  const STORE = 'songs';
  let dbPromise = null;

  function db() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      if (!global.indexedDB) return reject(new Error('IndexedDB indisponível'));
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbPromise;
  }

  function tx(mode, fn) {
    return db().then(d => new Promise((resolve, reject) => {
      const t = d.transaction(STORE, mode);
      const s = t.objectStore(STORE);
      const r = fn(s);
      t.oncomplete = () => resolve(r && r.result);
      t.onerror = () => reject(t.error);
    }));
  }

  const Store = {
    allSongs() { return tx('readonly', s => s.getAll()).catch(() => []); },
    putSong(rec) { return tx('readwrite', s => s.put(rec)); },
    deleteSong(id) { return tx('readwrite', s => s.delete(id)); },

    get(key, def) {
      try {
        const v = localStorage.getItem('ak:' + key);
        return v === null ? def : JSON.parse(v);
      } catch (e) { return def; }
    },
    set(key, val) {
      try { localStorage.setItem('ak:' + key, JSON.stringify(val)); } catch (e) {}
    }
  };

  global.Store = Store;
})(window);
