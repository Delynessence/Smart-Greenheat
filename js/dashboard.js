// ===== Global =====
let currentUser = null;
let sensorData = { timestamps: [], temperatures: [], humidities: [] };
let sensorsRef = null, statusRef = null;

const db = window.database;
const auth = window.auth;

// ===== Heartbeat watcher =====
let LAST_SEEN_MS = 0;                 // server timestamp dari /status/lastSeen (ms)
const ONLINE_FRESH_MS = 15000;        // online jika lastSeen < 15 detik
let hbTimer = null;                   // interval checker
let deviceOnline = null;              // cache state agar tidak spam UI

// ===== Init =====
document.addEventListener('DOMContentLoaded', () => {
  // Status koneksi client (browser) ke RTDB
  if (window.connectedRef) {
    window.connectedRef.on('value', snap => {
      const clientOnline = snap.val() === true;
      if (!clientOnline) updateOnlineState(false); // browser offline → paksa offline UI
      const el = document.getElementById('user-status');
      if (el) {
        const who = currentUser ? currentUser.email : 'Guest';
        el.textContent = (clientOnline ? '🟢 ' : '🔴 ') + (who || 'Guest');
      }
    });
  }

  // Auth
  auth.onAuthStateChanged(user => {
    if (user) {
      currentUser = user;
      const el = document.getElementById('user-status');
      if (el) el.textContent = '👤 ' + user.email;

      setDeviceOnline(false); // default: tunggu heartbeat
      setupFirebase();

      const btn = document.getElementById('auth-btn');
      if (btn) btn.style.display = 'inline-flex';
    } else {
      // balik ke halaman login/landing kamu
      window.location.href = 'login.html';
    }
  });

  // Auto hide loading
  setTimeout(() => {
    const ov = document.getElementById('loading-overlay');
    if (ov) ov.classList.add('hidden');
  }, 1500);

  // Hemat resource saat tab di background
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stopHeartbeatWatch();
    else startHeartbeatWatch();
  });
});

// ===== Firebase listeners =====
function setupFirebase() {
  if (!sensorsRef) sensorsRef = db.ref('sensors');
  if (!statusRef)  statusRef  = db.ref('status');

  // Stream sensors
  sensorsRef.on('value', snapshot => {
    const data = snapshot.val() || {};
    const t = (typeof data.temperature === 'number') ? data.temperature : null;
    const h = (typeof data.moisture    === 'number') ? data.moisture    : null;

    document.getElementById('temp-value').textContent     = (t !== null) ? t.toFixed(1) : '--';
    document.getElementById('humidity-value').textContent = (h !== null) ? h : '--';

    if (t !== null) updateProgressBar('temp-progress', t, 100);
    if (h !== null) updateProgressBar('humidity-progress', h, 100);

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

  // Stream status + heartbeat
  statusRef.on('value', snapshot => {
    const data = snapshot.val() || {};

    document.getElementById('status-value').textContent =
      data.running ? 'RUNNING' : 'STOPPED';
    document.getElementById('source-value').textContent =
      data.lastCommandSource ? String(data.lastCommandSource).toUpperCase() : '--';

    // lastSeen (server timestamp dalam ms)
    LAST_SEEN_MS = (typeof data.lastSeen === 'number') ? data.lastSeen : 0;

    // Evaluasi segera
    const freshNow = (Date.now() - LAST_SEEN_MS) < ONLINE_FRESH_MS;
    updateOnlineState(freshNow);

    // Pastikan watcher jalan
    startHeartbeatWatch();
  });
}

// ===== Heartbeat loop =====
function startHeartbeatWatch() {
  if (hbTimer) return;
  hbTimer = setInterval(() => {
    const fresh = (Date.now() - LAST_SEEN_MS) < ONLINE_FRESH_MS;
    updateOnlineState(fresh);
  }, 3000); // cek tiap 3 detik
}
function stopHeartbeatWatch() {
  if (hbTimer) { clearInterval(hbTimer); hbTimer = null; }
}

// Idempotent state switch
function updateOnlineState(isOnline) {
  if (deviceOnline === isOnline) return;
  deviceOnline = isOnline;
  setDeviceOnline(isOnline);

  if (isOnline) {
    showOfflineModal(false);
    showToast('Perangkat Online', 'Koneksi mesin tersambung kembali', 'success', 2000);
  } else {
    showOfflineModal(true);
    showToast('Perangkat Offline', 'Hubungkan koneksi internet pada Mesin', 'warning', 4000);
  }
}

// ===== UI Helpers =====
function updateProgressBar(elementId, value, maxValue) {
  const el = document.getElementById(elementId);
  if (!el || typeof value !== 'number' || typeof maxValue !== 'number' || maxValue <= 0) return;
  const pct = Math.max(0, Math.min(100, (value / maxValue) * 100));
  el.style.width = pct + '%';
}
function setButtonsDisabled(disabled) {
  document.querySelectorAll('.control-btn').forEach(btn => { btn.disabled = disabled; });
  const exportBtn = document.querySelector('.export-btn');
  if (exportBtn) exportBtn.disabled = disabled;
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
  if (!modal) return;
  modal.style.display = show ? 'block' : 'none';
}

// ===== Commands =====
function sendCommand(action) {
  if (!currentUser) {
    showToast('Akses Ditolak', 'Silakan login dulu untuk mengontrol sistem', 'warning');
    return;
  }
  setButtonsDisabled(true);
  db.ref('controls/action').set(action)
    .then(() => {
      showToast('Perintah Dikirim',
        action === 'start' ? 'Sistem akan dihidupkan' : 'Sistem akan dihentikan',
        'info'
      );
      setTimeout(() => {
        db.ref('controls/action').set('').finally(() => setButtonsDisabled(false));
      }, 1000);
    })
    .catch(err => {
      setButtonsDisabled(false);
      showToast('Error', 'Gagal mengirim perintah: ' + err.message, 'error');
    });
}

// REFRESH = minta soft reset ke ESP32
function refreshData() {
  if (!currentUser) {
    showToast('Akses Ditolak', 'Silakan login dulu', 'warning');
    return;
  }
  setButtonsDisabled(true);
  db.ref('controls/action').set('reboot')
    .then(() => {
      showToast('Reboot', 'Meminta perangkat untuk restart…', 'info', 2000);
      setTimeout(() => {
        db.ref('controls/action').set('').finally(() => setButtonsDisabled(false));
      }, 1000);
    })
    .catch(err => {
      setButtonsDisabled(false);
      showToast('Error', 'Gagal kirim reboot: ' + err.message, 'error');
    });
}

// ===== Export =====
function exportData() {
  if (!currentUser) {
    showToast('Akses Ditolak', 'Silakan login dulu untuk mengekspor data', 'warning');
    return;
  }
  let csv = "data:text/csv;charset=utf-8,";
  csv += "Timestamp,Suhu (°C),Kelembapan (%)\n";
  for (let i = 0; i < sensorData.timestamps.length; i++) {
    const ts = sensorData.timestamps[i];
    const t  = sensorData.temperatures[i];
    const h  = sensorData.humidities[i];
    csv += `${ts},${t},${h}\n`;
  }
  const a = document.createElement("a");
  a.href = encodeURI(csv);
  a.download = "sensor_data_" + new Date().toISOString().slice(0, 10) + ".csv";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
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
  if (duration > 0) {
    setTimeout(() => {
      toast.style.animation = 'toastSlideOut 0.3s forwards';
      setTimeout(() => toast.remove(), 300);
    }, duration);
  }
}

// ===== Modal & unload =====
function toggleAuth(){ const m=document.getElementById('logout-modal'); if(!m) return; m.style.display=(m.style.display==='block')?'none':'block'; }
function closeModal(){ const m=document.getElementById('logout-modal'); if(m) m.style.display='none'; }
function logout(){
  auth.signOut()
    .then(()=>{ showToast('Logout Berhasil','Anda telah keluar dari sistem','success'); setTimeout(()=>{ window.location.href='login.html'; },1500); })
    .catch(e=>{ showToast('Error Logout','Gagal logout: '+e.message,'error'); });
}

window.addEventListener('beforeunload', () => {
  if (sensorsRef) sensorsRef.off();
  if (statusRef)  statusRef.off();
  stopHeartbeatWatch();
});

// Expose ke HTML
window.sendCommand      = sendCommand;
window.refreshData      = refreshData;
window.toggleAuth       = toggleAuth;
window.closeModal       = closeModal;
window.logout           = logout;
window.showOfflineModal = showOfflineModal;
