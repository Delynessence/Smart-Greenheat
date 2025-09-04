// dashboard.js — versi diperbarui

// ====== Global state ======
let currentUser = null;
let sensorData = {
  timestamps: [],
  temperatures: [],
  humidities: []
};

// refs global biar bisa di-off saat unload
let sensorsRef = null;
let statusRef  = null;

// helper ambil objek compat dari window (dibuat di firebase-config.js)
const db   = window.database;
const auth = window.auth;

// ====== Init ======
document.addEventListener('DOMContentLoaded', function () {

  // (opsional) Tampilkan status koneksi RTDB
  if (window.connectedRef) {
    window.connectedRef.on('value', snap => {
      const online = snap.val() === true;
      const el = document.getElementById('user-status');
      if (el) {
        const who = currentUser ? currentUser.email : 'Guest';
        el.textContent = (online ? '🟢 ' : '🔴 ') + (who ? who : 'Guest');
      }
    });
  }

  // Auth (mode default: butuh login)
  auth.onAuthStateChanged(function (user) {
    if (user) {
      currentUser = user;
      const el = document.getElementById('user-status');
      if (el) el.textContent = '👤 ' + user.email;
      setupFirebase();
    } else {
      // === Kalau mau TEST tanpa login, hapus redirect & set guest ===
      // currentUser = { email: 'guest@local' };
      // document.getElementById('user-status').textContent = '👤 Guest';
      // setupFirebase(); return;

      // Production: redirect ke login
      window.location.href = 'login.html';
    }
  });

  // Loading overlay auto-hide
  setTimeout(() => {
    const ov = document.getElementById('loading-overlay');
    if (ov) ov.classList.add('hidden');
  }, 1500);
});

// ====== Firebase listeners ======
function setupFirebase() {
  // Pastikan ref tunggal (hindari dobel listener)
  if (!sensorsRef) sensorsRef = db.ref('sensors');
  if (!statusRef)  statusRef  = db.ref('status');

  // Sensor stream
  sensorsRef.on('value', function (snapshot) {
    const data = snapshot.val() || {};

    // Baca aman: 0 dianggap valid
    const t = (typeof data.temperature === 'number') ? data.temperature : null;
    const h = (typeof data.moisture    === 'number') ? data.moisture    : null;

    // Tampilkan ke UI
    document.getElementById('temp-value').textContent     = (t !== null) ? t.toFixed(1) : '--';
    document.getElementById('humidity-value').textContent = (h !== null) ? h : '--';

    if (t !== null) updateProgressBar('temp-progress', t, 100);
    if (h !== null) updateProgressBar('humidity-progress', h, 100);

    // Simpan untuk export
    const now = new Date().toLocaleString();
    sensorData.timestamps.push(now);
    sensorData.temperatures.push(t !== null ? t : '');
    sensorData.humidities.push(h !== null ? h : '');

    // Batasi 100 data terakhir
    if (sensorData.timestamps.length > 100) {
      sensorData.timestamps.shift();
      sensorData.temperatures.shift();
      sensorData.humidities.shift();
    }
  });

  // Status stream
  statusRef.on('value', function (snapshot) {
    const data = snapshot.val() || {};
    const running = !!data.running;
    document.getElementById('status-value').textContent = running ? 'RUNNING' : 'STOPPED';
    document.getElementById('source-value').textContent = data.lastCommandSource
      ? String(data.lastCommandSource).toUpperCase()
      : '--';
  });
}

// ====== UI Helpers ======
function updateProgressBar(elementId, value, maxValue) {
  const el = document.getElementById(elementId);
  if (!el || typeof value !== 'number' || typeof maxValue !== 'number' || maxValue <= 0) return;
  const pct = Math.max(0, Math.min(100, (value / maxValue) * 100));
  el.style.width = pct + '%';
}

// ====== Commands ======
function setButtonsDisabled(disabled) {
  document.querySelectorAll('.control-btn').forEach(btn => {
    btn.disabled = disabled;
  });
}

function sendCommand(action) {
  if (!currentUser) {
    showToast('Akses Ditolak', 'Silakan login dulu untuk mengontrol sistem', 'warning');
    return;
  }

  setButtonsDisabled(true);

  db.ref('controls/action').set(action)
    .then(function () {
      console.log('Command sent:', action);
      showToast('Perintah Dikirim', action === 'start' ? 'Sistem akan dihidupkan' : 'Sistem akan dihentikan', 'info');

      // Clear command setelah 1 detik (biar ESP32 sempat baca)
      setTimeout(function () {
        db.ref('controls/action').set('').finally(() => setButtonsDisabled(false));
      }, 1000);
    })
    .catch(function (error) {
      console.error('Error:', error);
      setButtonsDisabled(false);
      showToast('Error', 'Gagal mengirim perintah: ' + error.message, 'error');
    });
}

// ====== Misc UI ======
function refreshData() {
  showToast('Refresh', 'Memperbarui data...', 'info', 1500);
}

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
  const encoded = encodeURI(csv);
  const a = document.createElement("a");
  a.href = encoded;
  a.download = "sensor_data_" + new Date().toISOString().slice(0, 10) + ".csv";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);

  showToast('Export Berhasil', 'Data sensor telah diunduh', 'success');
}

// ====== Toast ======
function showToast(title, message, type = 'info', duration = 5000) {
  const existing = document.querySelector('.toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.className = `toast toast-${type} show`;

  let icon = 'ℹ️';
  if (type === 'success') icon = '✅';
  else if (type === 'warning') icon = '⚠️';
  else if (type === 'error') icon = '❌';

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

// ====== Modal & Unload ======
function toggleAuth() {
  const modal = document.getElementById('logout-modal');
  if (!modal) return;
  modal.style.display = (modal.style.display === 'block') ? 'none' : 'block';
}
function closeModal() {
  const modal = document.getElementById('logout-modal');
  if (modal) modal.style.display = 'none';
}
function logout() {
  auth.signOut()
    .then(function () {
      showToast('Logout Berhasil', 'Anda telah keluar dari sistem', 'success');
      setTimeout(() => { window.location.href = 'login.html'; }, 1500);
    })
    .catch(function (error) {
      console.error('Error:', error);
      showToast('Error Logout', 'Gagal logout: ' + error.message, 'error');
    });
}

// Tutup listener saat pindah halaman
window.addEventListener('beforeunload', function () {
  if (sensorsRef) sensorsRef.off();
  if (statusRef)  statusRef.off();
});

// Expose yang dipakai oleh onclick di HTML
window.sendCommand = sendCommand;
window.refreshData = refreshData;
window.toggleAuth = toggleAuth;
window.closeModal  = closeModal;
window.logout      = logout;
