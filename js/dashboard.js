// ===== Global =====
let currentUser = null;
let sensorData = { timestamps: [], temperatures: [], humidities: [] };
let sensorsRef = null, statusRef = null;

const db   = window.database;
const auth = window.auth;

// ===== Heartbeat & health =====
let LAST_SEEN_MS = 0;                 // server timestamp dari /status/lastSeen (ms)
let lastAnyEventAt = 0;               // kapan terakhir TERIMA event dari RTDB (ms)
const FRESH_MS = 15000;               // dianggap online bila lastSeen <= 15 dtk
const QUIET_MS = 20000;               // bila tak ada event apa pun > 20 dtk → offline
let hbTimer = null;                   // interval checker
let deviceOnline = null;              // cache state (hindari spam UI)

// ===== Init =====
document.addEventListener('DOMContentLoaded', () => {
  // Default: kunci UI & tampilkan modal sampai terbukti online
  setDeviceOnline(false);
  showOfflineModal(true);

  // Status koneksi browser (client) → kalau browser offline, paksa UI offline
  if (window.connectedRef) {
    window.connectedRef.on('value', snap => {
      const clientOnline = snap.val() === true;
      if (!clientOnline || !navigator.onLine) updateOnlineState(false);
      const el = document.getElementById('user-status');
      if (el) {
        const who = currentUser ? currentUser.email : 'Guest';
        el.textContent = (clientOnline ? '🟢 ' : '🔴 ') + (who || 'Guest');
      }
    });
  }
  window.addEventListener('offline', () => updateOnlineState(false));
  window.addEventListener('online',  () => { /* tunggu heartbeat agar aman */ });

  // Auth
  auth.onAuthStateChanged(user => {
    if (user) {
      currentUser = user;
      const el = document.getElementById('user-status');
      if (el) el.textContent = '👤 ' + user.email;

      setupFirebase();
      const btn = document.getElementById('auth-btn');
      if (btn) btn.style.display = 'inline-flex';
    } else {
      window.location.href = 'login.html';
    }
  });

  // Loading overlay auto-hide
  setTimeout(() => {
    const ov = document.getElementById('loading-overlay');
    if (ov) ov.classList.add('hidden');
  }, 1200);

  // Start watchdog segera (tanpa nunggu event pertama)
  startHeartbeatWatch();

  // Hemat resource saat tab di background
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stopHeartbeatWatch(); else startHeartbeatWatch();
  });
});

// ===== Firebase listeners =====
function setupFirebase() {
  if (!sensorsRef) sensorsRef = db.ref('sensors');
  if (!statusRef)  statusRef  = db.ref('status');

  // Sensor stream
  sensorsRef.on('value', snapshot => {
    lastAnyEventAt = Date.now();

    const data = snapshot.val() || {};
    const t = (typeof data.temperature === 'number') ? data.temperature : null;
    const h = (typeof data.moisture    === 'number') ? data.moisture    : null;

    // Render
    document.getElementById('temp-value').textContent     = (t !== null) ? t.toFixed(1) : '--';
    document.getElementById('humidity-value').textContent = (h !== null) ? h : '--';
    if (t !== null) updateProgressBar('temp-progress', t, 100);
    if (h !== null) updateProgressBar('humidity-progress', h, 100);

    // Simpan untuk export
    const now = new Date().toLocaleString();
    sensorData.timestamps.push(now);
    sensorData.temperatures.push(t ?? '');
    sensorData.humidities.push(h ?? '');
    if (sensorData.timestamps.length > 100) {
      sensorData.timestamps.shift();
      sensorData.temperatures.shift();
      sensorData.humidities.shift();
    }
  });

  // Status + Heartbeat stream
  statusRef.on('value', snapshot => {
    lastAnyEventAt = Date.now();

    const data = snapshot.val() || {};
    document.getElementById('status-value').textContent =
      data.running ? 'RUNNING' : 'STOPPED';
    document.getElementById('source-value').textContent =
      data.lastCommandSource ? String(data.lastCommandSource).toUpperCase() : '--';

    // lastSeen (server timestamp dalam ms). Kalau tidak ada → 0 (offline)
    LAST_SEEN_MS = (typeof data.lastSeen === 'number') ? data.lastSeen : 0;

    // Evaluasi segera saat ada data
    const freshNow = (Date.now() - LAST_SEEN_MS) <= FRESH_MS;
    updateOnlineState(freshNow);
  });
}

// ===== Heartbeat / health watchdog =====
function startHeartbeatWatch() {
  if (hbTimer) return;
  hbTimer = setInterval(() => {
    const now = Date.now();

    // Sinyal 1: heartbeat lastSeen
    const hbFresh = LAST_SEEN_MS > 0 && (now - LAST_SEEN_MS) <= FRESH_MS;

    // Sinyal 2: tidak ada event RTDB cukup lama
    const streamFresh = lastAnyEventAt > 0 && (now - lastAnyEventAt) <= QUIET_MS;

    // Sinyal 3: koneksi browser
    const clientFresh = navigator.onLine;

    const shouldBeOnline = hbFresh && streamFresh && clientFresh;
    updateOnlineState(shouldBeOnline);
  }, 2000); // cek tiap 2 detik
}
function stopHeartbeatWatch() { if (hbTimer) { clearInterval(hbTimer); hbTimer = null; } }

// ===== UI helpers =====
function updateOnlineState(isOnline) {
  if (deviceOnline === isOnline) return; // tidak berubah
  deviceOnline = isOnline;
  setDeviceOnline(isOnline);

  if (isOnline) {
    showOfflineModal(false);
    showToast('Perangkat Online', 'Koneksi mesin tersambung kembali', 'success', 1800);
  } else {
    showOfflineModal(true);
    showToast('Perangkat Offline', 'Hubungkan koneksi internet pada Mesin', 'warning', 3000);
  }
}
function setDeviceOnline(isOnline) {
  const section = document.querySelector('.section');
  if (!section) return;
  if (isOnline) {
    section.classList.remove('disabled');
    setButtonsDisabled(false);
  } else {
    section.classList.add('disabled');
    setButtonsDisabled(true);
  }
}
function showOfflineModal(show) {
  const modal = document.getElementById('device-offline-modal');
  if (modal) modal.style.display = show ? 'block' : 'none';
}
function setButtonsDisabled(disabled) {
  document.querySelectorAll('.control-btn').forEach(btn => btn.disabled = disabled);
  const exportBtn = document.querySelector('.export-btn');
  if (exportBtn) exportBtn.disabled = disabled;
}
function updateProgressBar(id, value, maxValue) {
  const el = document.getElementById(id);
  if (!el || typeof value !== 'number' || typeof maxValue !== 'number' || maxValue <= 0) return;
  el.style.width = Math.max(0, Math.min(100, (value / maxValue) * 100)) + '%';
}

// ===== Commands =====
function sendCommand(action) {
  if (!currentUser) return showToast('Akses Ditolak','Silakan login dulu','warning');
  if (deviceOnline === false) return showToast('Perangkat Offline','Tidak dapat mengirim perintah','warning');

  setButtonsDisabled(true);
  db.ref('controls/action').set(action)
    .then(() => {
      showToast('Perintah Dikirim', action === 'start' ? 'Sistem akan dihidupkan' : 'Sistem akan dihentikan', 'info');
      setTimeout(() => db.ref('controls/action').set('').finally(() => setButtonsDisabled(false)), 1000);
    })
    .catch(err => {
      setButtonsDisabled(false);
      showToast('Error', 'Gagal mengirim perintah: ' + err.message, 'error');
    });
}

// REFRESH = minta soft reset (reboot) ke ESP32
function refreshData() {
  if (!currentUser)  return showToast('Akses Ditolak', 'Silakan login dulu', 'warning');
  if (deviceOnline === false) return showToast('Perangkat Offline','Tidak bisa reboot saat offline','warning');

  setButtonsDisabled(true);
  db.ref('controls/action').set('reboot')
    .then(() => {
      showToast('Reboot', 'Meminta perangkat untuk restart…', 'info', 1800);
      setTimeout(() => db.ref('controls/action').set('').finally(() => setButtonsDisabled(false)), 1000);
    })
    .catch(err => {
      setButtonsDisabled(false);
      showToast('Error', 'Gagal kirim reboot: ' + err.message, 'error');
    });
}

// ===== Export =====
function exportData() {
  if (!currentUser) return showToast('Akses Ditolak','Silakan login dulu','warning');
  let csv = "data:text/csv;charset=utf-8,";
  csv += "Timestamp,Suhu (°C),Kelembapan (%)\n";
  for (let i = 0; i < sensorData.timestamps.length; i++) {
    csv += `${sensorData.timestamps[i]},${sensorData.temperatures[i]},${sensorData.humidities[i]}\n`;
  }
  const a = document.createElement("a");
  a.href = encodeURI(csv);
  a.download = "sensor_data_" + new Date().toISOString().slice(0,10) + ".csv";
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  showToast('Export Berhasil', 'Data sensor telah diunduh', 'success');
}

// ===== Toast =====
function showToast(title, message, type = 'info', duration = 5000) {
  const existing = document.querySelector('.toast'); if (existing) existing.remove();
  const toast = document.createElement('div');
  toast.className = `toast toast-${type} show`;
  let icon = 'ℹ️'; if (type==='success') icon='✅'; else if (type==='warning') icon='⚠️'; else if (type==='error') icon='❌';
  toast.innerHTML = `
    <div class="toast-icon">${icon}</div>
    <div class="toast-content">
      <div class="toast-title">${title}</div>
      <p class="toast-message">${message}</p>
    </div>
    <button class="toast-close">&times;</button>
  `;
  document.body.appendChild(toast);
  toast.querySelector('.toast-close').addEventListener('click', () => {
    toast.style.animation = 'toastSlideOut 0.3s forwards';
    setTimeout(() => toast.remove(), 300);
  });
  if (duration > 0) setTimeout(() => {
    toast.style.animation = 'toastSlideOut 0.3s forwards';
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

// ===== Modal & unload =====
function toggleAuth(){ const m=document.getElementById('logout-modal'); if(m) m.style.display=(m.style.display==='block')?'none':'block'; }
function closeModal(){ const m=document.getElementById('logout-modal'); if(m) m.style.display='none'; }
function logout(){
  auth.signOut()
    .then(()=>{ showToast('Logout Berhasil','Anda telah keluar dari sistem','success'); setTimeout(()=>{ window.location.href='login.html'; },1200); })
    .catch(e => showToast('Error Logout','Gagal logout: '+e.message,'error'));
}

window.addEventListener('beforeunload', () => {
  if (sensorsRef) sensorsRef.off();
  if (statusRef)  statusRef.off();
  stopHeartbeatWatch();
});

// Expose ke HTML
window.sendCommand = sendCommand;
window.refreshData = refreshData;
window.toggleAuth  = toggleAuth;
window.closeModal  = closeModal;
window.logout      = logout;
window.showOfflineModal = showOfflineModal;
