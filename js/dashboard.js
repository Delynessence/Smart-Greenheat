/* DASHBOARD dengan Grafik + Watchdog Online/Offline
   - Chart.js realtime (Suhu & Kelembapan) + filter 15m/1h/6h/24h/All
   - Deteksi perangkat offline (modal + disable kontrol) via /status/lastSeen + .info/connected
   - Export CSV dari buffer data
   - Perintah Ganti Wi-Fi (wifi_reconfig) dari dashboard
*/

let currentUser = null;

// Penyimpanan data (raw untuk semua titik, view untuk hasil filter)
const store = {
  raw : { ts: [], t: [], h: [] },
  view: { labels: [], t: [], h: [] }
};

// Firebase
const db   = window.database;
const auth = window.auth;
let sensorsRef=null, statusRef=null, lastSeenRef=null, offsetRef=null, connectedRef=null;

// Heartbeat (deteksi online)
let LAST_SEEN_MS = 0;            // server timestamp dari RTDB (/status/lastSeen)
let SERVER_OFFSET_MS = 0;        // .info/serverTimeOffset (ms)
let lastAnyEventAt = 0;          // kapan pun ada event RTDB (ms dari client)
let hbTimer = null;
let deviceOnline = null;

// Ambang
const FRESH_MS  = 7000;          // lastSeen <= 7s → online
const QUIET_MS  = 10000;         // tak ada event >10s → offline
const STARTUP_GRACE_MS = 8000;   // 8s awal tanpa beat → offline

// Chart & Filter
let chart=null;
let rangeMinutes=15;             // default 15 menit; "all" = semua
const MAX_POINTS=1000;           // batasi titik digambar

// ===== Helpers waktu =====
const serverNow = () => Date.now() + (SERVER_OFFSET_MS || 0);
const log = (...a) => console.log('[DASH]', ...a);

// ===== Init =====
document.addEventListener('DOMContentLoaded', () => {
  // Safe default: kunci UI sampai terbukti online
  setDeviceOnline(false);
  showOfflineModal(true);

  // Loading overlay hilang
  setTimeout(()=>document.getElementById('loading-overlay')?.classList.add('hidden'), 900);

  // Auth
  auth.onAuthStateChanged(user => {
    if (!user) { window.location.href='login.html'; return; }
    currentUser = user;
    document.getElementById('user-status').textContent = '👤 ' + (user.email||'User');
    document.getElementById('auth-btn').style.display = 'inline-flex';
    setupFirebase();
    bindRangeButtons();
  });

  // Grace awal: bila tidak ada beat sama sekali
  setTimeout(() => {
    if (LAST_SEEN_MS === 0) {
      log('No heartbeat in startup grace → mark offline');
      updateOnlineState(false);
    }
  }, STARTUP_GRACE_MS);

  // Hemat resource saat tab di background
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stopHeartbeatWatch(); else startHeartbeatWatch();
  });
});

// ===== Firebase listeners =====
function setupFirebase(){
  if (!db) return;

  sensorsRef   = db.ref('sensors');
  statusRef    = db.ref('status');
  lastSeenRef  = db.ref('status/lastSeen');
  offsetRef    = db.ref('.info/serverTimeOffset');
  connectedRef = db.ref('.info/connected');

  // Offset waktu server
  offsetRef.on('value', snap => {
    SERVER_OFFSET_MS = Number(snap.val() || 0);
    log('server offset (ms)=', SERVER_OFFSET_MS);
  });

  // Koneksi client ke RTDB
  connectedRef.on('value', snap => {
    const clientOnline = snap.val() === true;
    const who = currentUser ? currentUser.email : 'Guest';
    document.getElementById('user-status').textContent = (clientOnline ? '🟢 ' : '🔴 ') + (who || 'Guest');

    if (!clientOnline || !navigator.onLine) {
      updateOnlineState(false);
    }
  });

  // Sensor stream
  sensorsRef.on('value', snap => {
    lastAnyEventAt = Date.now();

    const data = snap.val() || {};
    const t = (typeof data.temperature === 'number') ? data.temperature : null;
    const h = (typeof data.moisture    === 'number') ? data.moisture    : null;

    setText('temp-value',      t !== null ? t.toFixed(1) : '--');
    setText('humidity-value',  h !== null ? h : '--');
    if (t !== null) setProgress('temp-progress', t, 100);
    if (h !== null) setProgress('humidity-progress', h, 100);

    // Simpan raw (pakai waktu client)
    const ts = Date.now();
    store.raw.ts.push(ts);
    store.raw.t.push(t);
    store.raw.h.push(h);
    trimRaw();

    rebuildView();
    if (!chart) initChart();
    chart.update('none');
  });

  // Status (running / last source)
  statusRef.on('value', snap => {
    lastAnyEventAt = Date.now();
    const d = snap.val() || {};
    setText('status-value', d.running ? 'RUNNING' : 'STOPPED');
    setText('source-value', d.lastCommandSource ? String(d.lastCommandSource).toUpperCase() : '--');
  });

  // Heartbeat langsung
  lastSeenRef.on('value', snap => {
    const v = snap.val();
    LAST_SEEN_MS = (typeof v === 'number') ? v : Number(v || 0);
    const fresh = (serverNow() - LAST_SEEN_MS) <= FRESH_MS;
    updateOnlineState(fresh);
  });

  // Start watchdog
  startHeartbeatWatch();
}

// ===== Watchdog =====
function startHeartbeatWatch(){
  if (hbTimer) return;
  hbTimer = setInterval(() => {
    const sNow = serverNow();
    const beatFresh   = (LAST_SEEN_MS > 0) && ((sNow - LAST_SEEN_MS) <= FRESH_MS);
    const streamFresh = (lastAnyEventAt > 0) && ((Date.now() - lastAnyEventAt) <= QUIET_MS);
    const clientOk    = navigator.onLine;

    const shouldOnline = beatFresh && streamFresh && clientOk;
    updateOnlineState(shouldOnline);
  }, 2000);
}
function stopHeartbeatWatch(){ if (hbTimer){ clearInterval(hbTimer); hbTimer=null; } }

// ===== Chart.js =====
function initChart(){
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
          borderWidth: 2, pointRadius: 0, tension: 0.35
        },
        {
          label: 'Kelembapan (%)',
          data: store.view.h,
          yAxisID: 'yHum',
          borderColor: colorHum,
          backgroundColor: hexToRGBA(colorHum, 0.15),
          borderWidth: 2, pointRadius: 0, tension: 0.35
        }
      ]
    },
    options: {
      responsive:true, maintainAspectRatio:false, animation:false,
      interaction:{ mode:'index', intersect:false },
      plugins:{
        legend:{ position:'top' },
        tooltip:{ callbacks:{
          title:(items)=> items[0]?.label || '',
          label:(ctx)=>{
            const v = ctx.parsed.y;
            return ctx.dataset.yAxisID==='yTemp'
              ? `Suhu: ${Number(v).toFixed(1)} °C`
              : `Kelembapan: ${v} %`;
          }
        }},
        decimation: { enabled:true, algorithm:'lttb', samples: 500 }
      },
      scales:{
        x:{ ticks:{ maxRotation:0, autoSkip:true, maxTicksLimit:8 }, grid:{ display:false } },
        yTemp:{ position:'left', title:{ display:true, text:'°C' } },
        yHum :{ position:'right', title:{ display:true, text:'%' }, suggestedMin:0, suggestedMax:100, grid:{ drawOnChartArea:false } }
      }
    }
  });
}

function rebuildView(){
  const N = store.raw.ts.length;
  if (!N) return;

  let idxStart = 0;
  if (rangeMinutes !== 'all') {
    const cutoff = Date.now() - rangeMinutes*60*1000;
    for (let i=N-1; i>=0; i--) {
      if (store.raw.ts[i] < cutoff) { idxStart = i+1; break; }
    }
  }
  const tsSlice = store.raw.ts.slice(idxStart);
  const tSlice  = store.raw.t.slice(idxStart);
  const hSlice  = store.raw.h.slice(idxStart);

  const step = Math.max(1, Math.ceil(tsSlice.length / MAX_POINTS));

  store.view.labels.length=0;
  store.view.t.length=0;
  store.view.h.length=0;

  for (let i=0;i<tsSlice.length;i+=step){
    store.view.labels.push(formatLabel(tsSlice[i]));
    store.view.t.push(tSlice[i]);
    store.view.h.push(hSlice[i]);
  }
}

function bindRangeButtons(){
  document.querySelectorAll('.range-btn').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      document.querySelectorAll('.range-btn').forEach(b=>b.classList.remove('active'));
      btn.classList.add('active');
      const v = btn.getAttribute('data-min');
      rangeMinutes = (v==='all') ? 'all' : Number(v);
      rebuildView(); if (chart) chart.update('none');
    });
  });
}

// ===== UI helpers =====
function updateOnlineState(isOnline){
  if (deviceOnline === isOnline) return;
  deviceOnline = isOnline;

  setDeviceOnline(isOnline);
  if (isOnline){
    showOfflineModal(false);
    showToast('Perangkat Online','Koneksi mesin tersambung kembali','success',1500);
  } else {
    showOfflineModal(true);
    showToast('Perangkat Offline','Hubungkan koneksi internet pada Mesin','warning',2500);
  }
}
function setDeviceOnline(isOnline){
  // Biarkan grafik aktif; kontrol saja yang dikunci
  const ctrl = document.getElementById('control-section');
  if (ctrl) ctrl.classList.toggle('disabled', !isOnline);
  setButtonsDisabled(!isOnline);
}
function showOfflineModal(show){
  const m = document.getElementById('device-offline-modal');
  if (m) m.style.display = show ? 'block' : 'none';
}
function setButtonsDisabled(disabled){
  document.querySelectorAll('.control-btn').forEach(b=>b.disabled = disabled);
  const exportBtn=document.querySelector('.export-btn'); if (exportBtn) exportBtn.disabled = disabled;
  const wifiBtn=document.querySelector('.wifi-btn'); if (wifiBtn) wifiBtn.disabled = disabled;
}
function setText(id, text){ const el=document.getElementById(id); if (el) el.textContent = text; }
function setProgress(id, value, maxValue){
  const el=document.getElementById(id);
  if (!el || typeof value!=='number' || maxValue<=0) return;
  el.style.width = Math.max(0, Math.min(100, (value/maxValue)*100)) + '%';
}
function trimRaw(){
  const HARD_MAX = 20000;
  const len = store.raw.ts.length;
  if (len>HARD_MAX){
    const drop = len-HARD_MAX;
    store.raw.ts.splice(0,drop);
    store.raw.t.splice(0,drop);
    store.raw.h.splice(0,drop);
  }
}
function formatLabel(ms){
  const d=new Date(ms), today=new Date();
  return (d.toDateString()===today.toDateString()) ? d.toLocaleTimeString() : d.toLocaleString();
}
function getCss(name){ return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }
function hexToRGBA(hex,a){
  const m=hex.replace('#',''); const v=parseInt(m.length===3? m.split('').map(c=>c+c).join(''):m,16);
  const r=(v>>16)&255,g=(v>>8)&255,b=v&255; return `rgba(${r},${g},${b},${a})`;
}

// ===== Commands =====
function sendCommand(action){
  if (!currentUser) { showToast('Akses Ditolak','Silakan login dulu','warning'); return; }
  if (deviceOnline===false){ showToast('Perangkat Offline','Tidak dapat mengirim perintah','warning'); return; }

  setButtonsDisabled(true);
  db.ref('controls/action').set(action)
    .then(()=>{
      showToast('Perintah Dikirim', action==='start'?'Sistem akan dihidupkan':'Sistem akan dihentikan', 'info');
      setTimeout(()=> db.ref('controls/action').set('').finally(()=>setButtonsDisabled(false)), 900);
    })
    .catch(err=>{ setButtonsDisabled(false); showToast('Error','Gagal kirim: '+err.message,'error'); });
}

// REFRESH → minta reboot (soft reset).
function refreshData(){
  if (!currentUser) { showToast('Akses Ditolak','Silakan login dulu','warning'); return; }
  if (deviceOnline===false){ showToast('Perangkat Offline','Tidak bisa reboot saat offline','warning'); return; }

  setButtonsDisabled(true);
  db.ref('controls/action').set('reboot')
    .then(()=>{
      showToast('Reboot', 'Meminta perangkat untuk restart…', 'info', 1500);
      setTimeout(()=> db.ref('controls/action').set('').finally(()=>setButtonsDisabled(false)), 900);
    })
    .catch(err=>{ setButtonsDisabled(false); showToast('Error','Gagal kirim reboot: '+err.message,'error'); });
}

// Minta ESP32 hapus kredensial Wi-Fi & reboot ke portal
function requestWifiReconfig(){
  if (!currentUser) { showToast('Akses Ditolak','Silakan login dulu','warning'); return; }
  if (deviceOnline===false){ showToast('Perangkat Offline','Tidak bisa ganti Wi-Fi saat offline','warning'); return; }

  if (!confirm('Perangkat akan masuk mode Setup Wi-Fi (AP). Lanjutkan?')) return;

  setButtonsDisabled(true);
  db.ref('controls/action').set('wifi_reconfig')
    .then(()=>{
      showToast('Ganti Wi-Fi', 'Perangkat akan masuk mode Setup…', 'info', 2000);
      setTimeout(()=> db.ref('controls/action').set('').finally(()=>setButtonsDisabled(false)), 900);
    })
    .catch(err=>{ setButtonsDisabled(false); showToast('Error','Gagal kirim perintah Wi-Fi: '+err.message,'error'); });
}

// ===== Export CSV =====
function exportData(){
  if (!currentUser) { showToast('Akses Ditolak','Silakan login dulu','warning'); return; }
  let csv = "data:text/csv;charset=utf-8,Timestamp,Suhu (°C),Kelembapan (%)\n";
  for (let i=0;i<store.raw.ts.length;i++){
    const ts = new Date(store.raw.ts[i]).toLocaleString();
    const t  = (store.raw.t[i] ?? '');
    const h  = (store.raw.h[i] ?? '');
    csv += `${ts},${t},${h}\n`;
  }
  const a=document.createElement('a');
  a.href=encodeURI(csv); a.download="sensor_data_"+new Date().toISOString().slice(0,10)+".csv";
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  showToast('Export Berhasil','Data sensor telah diunduh','success');
}

// ===== Toast =====
function showToast(title, message, type='info', duration=5000){
  const prev=document.querySelector('.toast'); if(prev) prev.remove();
  const toast=document.createElement('div');
  toast.className=`toast toast-${type} show`;
  let icon='ℹ️'; if(type==='success')icon='✅'; else if(type==='warning')icon='⚠️'; else if(type==='error')icon='❌';
  toast.innerHTML=`
    <div class="toast-icon">${icon}</div>
    <div class="toast-content">
      <div class="toast-title">${title}</div>
      <p class="toast-message">${message}</p>
    </div>
    <button class="toast-close" aria-label="Tutup">&times;</button>
  `;
  document.body.appendChild(toast);
  toast.querySelector('.toast-close').addEventListener('click',()=>toast.remove());
  if(duration>0) setTimeout(()=>toast.remove(), duration);
}

// ===== Modal & Auth =====
function toggleAuth(){ document.getElementById('logout-modal').style.display='block'; }
function closeModal(){ document.getElementById('logout-modal').style.display='none'; }
function logout(){
  auth.signOut()
    .then(()=>{ showToast('Logout Berhasil','Anda telah keluar','success'); setTimeout(()=>location.href='login.html',1200); })
    .catch(err=> showToast('Error Logout', err.message, 'error'));
}

// ===== Cleanup =====
window.addEventListener('beforeunload', () => {
  sensorsRef?.off(); statusRef?.off(); lastSeenRef?.off(); offsetRef?.off(); connectedRef?.off();
  stopHeartbeatWatch();
});

// Expose ke HTML
window.sendCommand = sendCommand;
window.refreshData = refreshData;
window.exportData  = exportData;
window.toggleAuth  = toggleAuth;
window.closeModal  = closeModal;
window.logout      = logout;
window.showOfflineModal = showOfflineModal;
window.requestWifiReconfig = requestWifiReconfig;
