// ====== Global state ======
let currentUser = null;

// Simpan data mentah (raw) & tampilan (view)
const store = {
  raw: {
    ts: [],   // timestamp (number, ms)
    t: [],    // temperature
    h: []     // humidity
  },
  view: {
    labels: [],
    t: [],
    h: []
  }
};

// Firebase refs
let sensorsRef = null;
let statusRef  = null;

// Firebase compat objects (dibuat di firebase-config.js)
const db   = window.database;
const auth = window.auth;

// Chart
let chart = null;
let rangeMinutes = 15;   // default 15 menit. "all" = seluruh data
const MAX_POINTS = 1000; // hard cap agar tetap ringan

// ====== Init ======
document.addEventListener('DOMContentLoaded', function () {
  // Spinner auto-hide
  setTimeout(() => {
    const ov = document.getElementById('loading-overlay');
    if (ov) ov.classList.add('hidden');
  }, 1200);

  // Auth
  auth.onAuthStateChanged(function (user) {
    if (user) {
      currentUser = user;
      const el = document.getElementById('user-status');
      if (el) el.textContent = '👤 ' + user.email;

      // tampilkan tombol logout
      const b = document.getElementById('auth-btn');
      if (b) b.style.display = 'inline-flex';

      setupFirebase();
      bindRangeButtons();
    } else {
      window.location.href = 'login.html';
    }
  });
});

// ====== Firebase listeners ======
function setupFirebase () {
  if (!db) return;

  if (!sensorsRef) sensorsRef = db.ref('sensors');
  if (!statusRef)  statusRef  = db.ref('status');

  initChart();

  // Sensor stream
  sensorsRef.on('value', snap => {
    const data = snap.val() || {};
    const t = (typeof data.temperature === 'number') ? data.temperature : null;
    const h = (typeof data.moisture    === 'number') ? data.moisture    : null;

    // tampilkan kartu
    setText('temp-value', (t !== null) ? t.toFixed(1) : '--');
    setText('humidity-value', (h !== null) ? h : '--');
    if (t !== null) setProgress('temp-progress', t, 100);
    if (h !== null) setProgress('humidity-progress', h, 100);

    // simpan raw
    const ts = Date.now();
    store.raw.ts.push(ts);
    store.raw.t.push(t !== null ? t : null);
    store.raw.h.push(h !== null ? h : null);

    // batasi panjang raw (biar ramah)
    trimRaw();

    // refresh grafik sesuai filter aktif
    rebuildView();
    if (chart) chart.update('none');
  });

  // Status stream
  statusRef.on('value', snap => {
    const data = snap.val() || {};
    const running = !!data.running;
    setText('status-value', running ? 'RUNNING' : 'STOPPED');
    setText('source-value',
      data.lastCommandSource ? String(data.lastCommandSource).toUpperCase() : '--'
    );
  });
}

// ====== Chart.js ======
function initChart(){
  if (chart) return;
  const ctx = document.getElementById('sensorChart');
  if (!ctx) return;

  const colorTemp = getCss('--start-2') || '#FF8A00';
  const colorHum  = getCss('--ref-2')   || '#167BD9';

  chart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: store.view.labels,
      datasets: [
        {
          label: 'Suhu (°C)',
          data: store.view.t,
          yAxisID: 'yTemp',
          borderColor: colorTemp,
          backgroundColor: hexToRGBA(colorTemp, 0.15),
          borderWidth: 2,
          pointRadius: 0,
          tension: 0.35
        },
        {
          label: 'Kelembapan (%)',
          data: store.view.h,
          yAxisID: 'yHum',
          borderColor: colorHum,
          backgroundColor: hexToRGBA(colorHum, 0.15),
          borderWidth: 2,
          pointRadius: 0,
          tension: 0.35
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { position: 'top' },
        tooltip: { callbacks: {
          title: (items) => items[0]?.label || '',
          label: (ctx) => {
            const v = ctx.parsed.y;
            if (ctx.dataset.yAxisID === 'yTemp') return `Suhu: ${Number(v).toFixed(1)} °C`;
            return `Kelembapan: ${v} %`;
          }
        }}
      },
      scales: {
        x: {
          ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: 8 },
          grid: { display: false }
        },
        yTemp: {
          position: 'left',
          title: { display: true, text: '°C' },
          grid: { drawOnChartArea: true }
        },
        yHum: {
          position: 'right',
          title: { display: true, text: '%' },
          grid: { drawOnChartArea: false },
          suggestedMin: 0, suggestedMax: 100
        }
      },
      animation: false
    }
  });
}

// Hitung ulang view berdasar range aktif
function rebuildView(){
  const N = store.raw.ts.length;
  if (!N) return;

  let idxStart = 0;
  if (rangeMinutes !== 'all') {
    const cutoff = Date.now() - rangeMinutes * 60 * 1000;
    // cari indeks pertama yang >= cutoff
    for (let i = N - 1; i >= 0; i--) {
      if (store.raw.ts[i] < cutoff) { idxStart = i + 1; break; }
    }
  }

  const tsSlice = store.raw.ts.slice(idxStart);
  const tSlice  = store.raw.t.slice(idxStart);
  const hSlice  = store.raw.h.slice(idxStart);

  // batasi jumlah titik di view agar ringan
  const step = Math.max(1, Math.ceil((tsSlice.length) / MAX_POINTS));

  store.view.labels.length = 0;
  store.view.t.length = 0;
  store.view.h.length = 0;

  for (let i = 0; i < tsSlice.length; i += step) {
    store.view.labels.push(formatLabel(tsSlice[i]));
    store.view.t.push(tSlice[i]);
    store.view.h.push(hSlice[i]);
  }
}

// ====== Range buttons ======
function bindRangeButtons(){
  document.querySelectorAll('.range-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.range-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      const v = btn.getAttribute('data-min');
      rangeMinutes = (v === 'all') ? 'all' : Number(v);

      rebuildView();
      if (chart) chart.update('none');
    });
  });
}

// ====== UI helpers ======
function setText(id, text){
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}
function setProgress(id, value, maxValue){
  const el = document.getElementById(id);
  if (!el || typeof value !== 'number' || typeof maxValue !== 'number' || maxValue <= 0) return;
  const pct = Math.max(0, Math.min(100, (value / maxValue) * 100));
  el.style.width = pct + '%';
}
function getCss(name){
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}
function hexToRGBA(hex, a){
  const m = hex.replace('#','');
  const v = parseInt(m.length === 3 ? m.split('').map(c=>c+c).join('') : m, 16);
  const r = (v>>16)&255, g=(v>>8)&255, b=v&255;
  return `rgba(${r},${g},${b},${a})`;
}
function formatLabel(ms){
  const d = new Date(ms);
  // jika di hari yang sama, tampilkan jam:menit:detik; jika beda hari, sertakan tanggal
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  return sameDay ? d.toLocaleTimeString() : d.toLocaleString();
}
function trimRaw(){
  // jaga-jaga biar tak tumbuh tanpa batas (1 minggu @ 2s ≈ 302k; terlalu besar)
  const HARD_MAX = 20000;
  const len = store.raw.ts.length;
  if (len > HARD_MAX) {
    const drop = len - HARD_MAX;
    store.raw.ts.splice(0, drop);
    store.raw.t.splice(0, drop);
    store.raw.h.splice(0, drop);
  }
}

// ====== Commands & misc ======
function setButtonsDisabled(disabled){
  document.querySelectorAll('.control-btn').forEach(btn => btn.disabled = disabled);
}
function sendCommand(action){
  if (!currentUser) { showToast('Akses Ditolak', 'Silakan login dulu', 'warning'); return; }
  setButtonsDisabled(true);
  db.ref('controls/action').set(action)
    .then(() => {
      showToast('Perintah Dikirim', action === 'start' ? 'Sistem akan dihidupkan' : 'Sistem akan dihentikan', 'info');
      setTimeout(() => db.ref('controls/action').set('').finally(()=>setButtonsDisabled(false)), 1000);
    })
    .catch(err => {
      setButtonsDisabled(false);
      showToast('Error', 'Gagal mengirim perintah: ' + err.message, 'error');
    });
}
function refreshData(){
  showToast('Refresh', 'Memperbarui data...', 'info', 1200);
}
function exportData(){
  if (!currentUser) { showToast('Akses Ditolak', 'Silakan login dulu', 'warning'); return; }
  let csv = "data:text/csv;charset=utf-8,";
  csv += "Timestamp,Suhu (°C),Kelembapan (%)\n";
  for (let i = 0; i < store.raw.ts.length; i++) {
    const ts = new Date(store.raw.ts[i]).toLocaleString();
    const t  = store.raw.t[i] ?? '';
    const h  = store.raw.h[i] ?? '';
    csv += `${ts},${t},${h}\n`;
  }
  const encoded = encodeURI(csv);
  const a = document.createElement("a");
  a.href = encoded;
  a.download = "sensor_data_" + new Date().toISOString().slice(0,10) + ".csv";
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  showToast('Export Berhasil', 'Data sensor telah diunduh', 'success');
}

// ====== Toast ======
function showToast(title, message, type='info', duration=5000){
  const prev = document.querySelector('.toast'); if (prev) prev.remove();
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
  toast.querySelector('.toast-close').addEventListener('click', () => toast.remove());
  if (duration > 0) setTimeout(()=>toast.remove(), duration);
}

// ====== Modal & Auth ======
function toggleAuth(){ document.getElementById('logout-modal').style.display = 'block'; }
function closeModal(){ document.getElementById('logout-modal').style.display = 'none'; }
function logout(){
  auth.signOut()
    .then(()=>{ showToast('Logout Berhasil', 'Anda telah keluar', 'success'); setTimeout(()=>location.href='login.html', 1200); })
    .catch(err => showToast('Error Logout', err.message, 'error'));
}
function showOfflineModal(show){
  const m = document.getElementById('device-offline-modal');
  if (!m) return;
  m.style.display = show ? 'block' : 'none';
}

// Expose ke HTML
window.sendCommand   = sendCommand;
window.refreshData   = refreshData;
window.toggleAuth    = toggleAuth;
window.closeModal    = closeModal;
window.logout        = logout;
window.showOfflineModal = showOfflineModal;
