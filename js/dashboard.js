/* DASHBOARD — Chart + Logs Persisten + Watchdog Online/Offline
   - Grafik (Chart.js) sumber data: /logs (persisten)
   - Kartu nilai live: /sensors, /status
   - Filter 15m / 1h / 6h / 24h / All
   - Export CSV dari /logs sesuai rentang filter aktif
   - Kontrol: start / stop / refresh(reboot) / wifi_reconfig (opsional)
*/

(() => {
  // ===== Firebase (dari firebase-config.js) =====
  const db   = window.database;
  const auth = window.auth;

  // ===== Global state =====
  let currentUser = null;

  // Live sensors (kartu)
  let sensorsRef = null, statusRef = null, lastSeenRef = null;

  // Logs (grafik)
  let logsQueryRef = null;      // ref aktif untuk listener logs
  const logs = [];              // cache logs range aktif: {ts, t, h}
  let rangeMinutes = 15;        // default filter (angka menit | 'all')

  // Watchdog
  let deviceOnline = null;
  let hbTimer = null;
  let SERVER_OFFSET_MS = 0;
  const FRESH_MS = 7000;        // lastSeen umur <= 7s → online
  const QUIET_MS = 10000;       // cadangan (tidak dipakai untuk logs)
  let LAST_SEEN_MS = 0;
  let lastAnyEventAt = 0;

  // Chart
  let chart = null;
  const MAX_POINTS = 2000;      // decimation Chart.js juga aktif

  // ===== Utilities =====
  const serverNow = () => Date.now() + (SERVER_OFFSET_MS || 0);
  const log = (...a) => console.log('[DASH]', ...a);

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);
  const setText = (id, txt) => { const el = document.getElementById(id); if (el) el.textContent = txt; };
  const setProgress = (id, value, maxValue) => {
    const el = document.getElementById(id);
    if (!el || typeof value!=='number' || !isFinite(value) || maxValue<=0) return;
    el.style.width = Math.max(0, Math.min(100, (value/maxValue)*100)) + '%';
  };
  const getCss = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const hexToRGBA = (hex, a) => {
    const m = hex.replace('#','');
    const v = parseInt(m.length===3 ? m.split('').map(c=>c+c).join('') : m, 16);
    const r=(v>>16)&255, g=(v>>8)&255, b=v&255;
    return `rgba(${r},${g},${b},${a})`;
  };

  // ===== Toast =====
  function showToast(title, message, type='info', duration=4000){
    const prev = document.querySelector('.toast'); if (prev) prev.remove();
    const toast = document.createElement('div');
    toast.className = `toast toast-${type} show`;
    let icon='ℹ️'; if(type==='success')icon='✅'; else if(type==='warning')icon='⚠️'; else if(type==='error')icon='❌';
    toast.innerHTML = `
      <div class="toast-icon">${icon}</div>
      <div class="toast-content">
        <div class="toast-title">${title}</div>
        <p class="toast-message">${message}</p>
      </div>
      <button class="toast-close" aria-label="Tutup">&times;</button>
    `;
    document.body.appendChild(toast);
    toast.querySelector('.toast-close').addEventListener('click',()=>toast.remove());
    if (duration>0) setTimeout(()=>toast.remove(), duration);
  }

  // ===== Online/Offline UI =====
  function setDeviceOnline(isOnline) {
    const controlSection = document.getElementById('control-section');
    if (controlSection) controlSection.classList.toggle('disabled', !isOnline);
    setButtonsDisabled(!isOnline);
  }
  function setButtonsDisabled(disabled) {
    document.querySelectorAll('.control-btn').forEach(b=> b.disabled = disabled);
    const exportBtn = document.querySelector('.export-btn');
    if (exportBtn) exportBtn.disabled = false; // export dari logs tetap boleh meski device offline
  }
  function showOfflineModal(show){
    const m = document.getElementById('device-offline-modal');
    if (m) m.style.display = show ? 'block' : 'none';
  }
  function updateOnlineState(isOnline){
    if (deviceOnline === isOnline) return;
    deviceOnline = isOnline;
    setDeviceOnline(isOnline);
    if (isOnline) {
      showOfflineModal(false);
      showToast('Perangkat Online', 'Koneksi mesin tersambung kembali', 'success', 1500);
    } else {
      showOfflineModal(true);
      showToast('Perangkat Offline', 'Hubungkan koneksi internet pada Mesin', 'warning', 2500);
    }
  }

  // ===== Heartbeat watch =====
  function startHeartbeatWatch(){
    if (hbTimer) return;
    hbTimer = setInterval(()=>{
      const sNow = serverNow();
      const beatFresh = (LAST_SEEN_MS > 0) && ((sNow - LAST_SEEN_MS) <= FRESH_MS);
      const clientOk  = navigator.onLine;
      updateOnlineState(beatFresh && clientOk);
    }, 2000);
  }
  function stopHeartbeatWatch(){ if(hbTimer){ clearInterval(hbTimer); hbTimer=null; } }

  // ===== Chart =====
  function initChart(){
    const ctx = document.getElementById('sensorChart');
    if (!ctx) return;
    const colorTemp = getCss('--start-2') || '#FF8A00';
    const colorHum  = getCss('--ref-2')   || '#167BD9';

    chart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: [],
        datasets: [
          {
            label: 'Suhu (°C)',
            data: [],
            yAxisID: 'yTemp',
            borderColor: colorTemp,
            backgroundColor: hexToRGBA(colorTemp, 0.15),
            borderWidth: 2, pointRadius: 0, tension: 0.35
          },
          {
            label: 'Kelembapan (%)',
            data: [],
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
          decimation:{ enabled:true, algorithm:'lttb', samples: 1000 }
        },
        scales:{
          x:{ ticks:{ maxRotation:0, autoSkip:true, maxTicksLimit:8 }, grid:{ display:false } },
          yTemp:{ position:'left', title:{ display:true, text:'°C' } },
          yHum: { position:'right', title:{ display:true, text:'%' }, suggestedMin:0, suggestedMax:100, grid:{ drawOnChartArea:false } }
        }
      }
    });
  }

  function msToLabel(ms){
    const d=new Date(ms), today=new Date();
    return (d.toDateString()===today.toDateString()) ? d.toLocaleTimeString() : d.toLocaleString();
  }

  function renderChartFromLogs(){
    if (!chart) initChart();
    if (!chart) return;

    // Downsample sederhana jika > MAX_POINTS (Chart decimation juga aktif)
    const step = Math.max(1, Math.ceil(logs.length / MAX_POINTS));
    const labels = [];
    const t = [];
    const h = [];

    for (let i=0;i<logs.length;i+=step){
      labels.push(msToLabel(logs[i].ts));
      t.push(logs[i].t);
      h.push(logs[i].h);
    }

    chart.data.labels = labels;
    chart.data.datasets[0].data = t;
    chart.data.datasets[1].data = h;
    chart.update('none');
  }

  // ===== Logs listener =====
  function detachLogsListener(){
    if (logsQueryRef) { logsQueryRef.off(); logsQueryRef = null; }
  }

  // Ambil data logs sesuai filter (persisten di RTDB)
  function attachLogsListener(){
    detachLogsListener();
    logs.length = 0;

    const logsRef = db.ref('logs').orderByChild('ts');

    let qRef;
    if (rangeMinutes === 'all') {
      // Semua histori (hati2 kalau data sangat banyak; bisa batasi last 30k)
      qRef = logsRef.limitToLast(30000);
    } else {
      const startTs = Date.now() - (Number(rangeMinutes) * 60 * 1000);
      // ambil dari waktu cutoff sampai sekarang, batasi jumlah maksimum
      qRef = logsRef.startAt(startTs).limitToLast(10000);
    }

    logsQueryRef = qRef;
    qRef.on('value', snap => {
      const arr = [];
      snap.forEach(child => {
        const v = child.val() || {};
        // pastikan ts, t, h valid
        if (typeof v.ts === 'number' && typeof v.t === 'number' && typeof v.h === 'number') {
          arr.push({ ts: v.ts, t: v.t, h: v.h });
        }
      });
      // sort by ts untuk jaga urutan
      arr.sort((a,b)=>a.ts-b.ts);

      logs.length = 0;
      Array.prototype.push.apply(logs, arr);

      renderChartFromLogs();
    }, err => {
      console.error('logs listener error', err);
      showToast('Gagal memuat grafik', err?.message || 'Error RTDB', 'error');
    });
  }

  // ===== Export CSV =====
  function exportData(){
    if (!currentUser) { showToast('Akses Ditolak','Silakan login dulu','warning'); return; }
    if (!logs.length){ showToast('Tidak ada data','Belum ada log pada rentang ini','warning'); return; }

    let csv = "data:text/csv;charset=utf-8,";
    csv += "Timestamp (Local),Suhu (°C),Kelembapan (%)\n";
    for (const row of logs){
      const ts = new Date(row.ts).toLocaleString();
      csv += `${ts},${row.t},${row.h}\n`;
    }
    const a=document.createElement('a');
    a.href=encodeURI(csv);
    const suffix = (rangeMinutes==='all') ? 'all' : `${rangeMinutes}min`;
    a.download=`greenheat_logs_${suffix}_${new Date().toISOString().slice(0,10)}.csv`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    showToast('Export Berhasil','Data log telah diunduh','success');
  }

  // ===== Controls =====
  function sendCommand(action){
    if (!currentUser) { showToast('Akses Ditolak','Silakan login dulu','warning'); return; }
    if (deviceOnline === false){ showToast('Perangkat Offline','Tidak dapat mengirim perintah','warning'); return; }

    setButtonsDisabled(true);
    db.ref('controls/action').set(action)
      .then(()=>{
        const msg = action==='start' ? 'Sistem akan dihidupkan'
                  : action==='stop'  ? 'Sistem akan dihentikan'
                  : action==='reboot'? 'Diminta restart…'
                  : action==='wifi_reconfig' ? 'Masuk mode ganti Wi-Fi (portal)…'
                  : 'Perintah terkirim';
        showToast('Perintah Dikirim', msg, 'info', 1600);
        setTimeout(()=> db.ref('controls/action').set('').finally(()=> setButtonsDisabled(false)), 900);
      })
      .catch(err=>{
        setButtonsDisabled(false);
        showToast('Error', 'Gagal mengirim perintah: ' + err.message, 'error');
      });
  }
  function refreshData(){ sendCommand('reboot'); }
  function wifiReconfig(){
    if (!confirm('Masuk mode konfigurasi Wi-Fi? Perangkat akan reboot lalu membuka portal "GreenHeat".')) return;
    sendCommand('wifi_reconfig');
  }

  // ===== Auth & listeners =====
  function setupRealtimeListeners(){
    // server time offset
    db.ref('.info/serverTimeOffset').on('value', snap => {
      SERVER_OFFSET_MS = Number(snap.val() || 0);
    });

    // live sensors (cards)
    sensorsRef = db.ref('sensors');
    sensorsRef.on('value', snap => {
      lastAnyEventAt = Date.now();
      const d = snap.val() || {};
      const t = (typeof d.temperature === 'number') ? d.temperature : null;
      const h = (typeof d.moisture    === 'number') ? d.moisture    : null;
      setText('temp-value',     t!==null ? t.toFixed(1) : '--');
      setText('humidity-value', h!==null ? h : '--');
      if (t!==null) setProgress('temp-progress', t, 100);
      if (h!==null) setProgress('humidity-progress', h, 100);
    });

    // status
    statusRef = db.ref('status');
    statusRef.on('value', snap => {
      lastAnyEventAt = Date.now();
      const d = snap.val() || {};
      setText('status-value', d.running ? 'RUNNING' : 'STOPPED');
      setText('source-value', d.lastCommandSource ? String(d.lastCommandSource).toUpperCase() : '--');
    });

    // heartbeat lastSeen (server timestamp)
    lastSeenRef = db.ref('status/lastSeen');
    lastSeenRef.on('value', snap => {
      const v = snap.val();
      LAST_SEEN_MS = (typeof v === 'number') ? v : Number(v || 0);
      const fresh = (serverNow() - LAST_SEEN_MS) <= FRESH_MS;
      updateOnlineState(fresh);
    });

    // mulai watchdog
    startHeartbeatWatch();
  }

  function bindRangeButtons(){
    $$('.range-btn').forEach(btn=>{
      btn.addEventListener('click', ()=>{
        $$('.range-btn').forEach(b=> b.classList.remove('active'));
        btn.classList.add('active');
        const v = btn.getAttribute('data-min');
        rangeMinutes = (v==='all') ? 'all' : Number(v);
        attachLogsListener(); // fetch ulang dari /logs sesuai range
      });
    });
  }

  // ===== Modal / Auth buttons =====
  function toggleAuth(){
    const m = document.getElementById('logout-modal');
    if (m) m.style.display = 'block';
  }
  function closeModal(){
    const m = document.getElementById('logout-modal');
    if (m) m.style.display = 'none';
  }
  function logout(){
    auth.signOut()
      .then(()=>{ showToast('Logout Berhasil','Anda telah keluar','success'); setTimeout(()=> location.href='login.html', 900); })
      .catch(err=> showToast('Error Logout', err.message, 'error'));
  }

  // ===== Boot =====
  document.addEventListener('DOMContentLoaded', () => {
    // Default: kontrol dikunci sampai terbukti online
    setDeviceOnline(false);
    showOfflineModal(true);

    // Loading overlay auto-hide
    setTimeout(()=> document.getElementById('loading-overlay')?.classList.add('hidden'), 900);

    // Init Chart
    initChart();

    // Range buttons
    bindRangeButtons();

    // Auth
    auth.onAuthStateChanged(user=>{
      if (!user) { window.location.href = 'login.html'; return; }
      currentUser = user;
      setText('user-status', '👤 ' + (user.email || 'User'));
      document.getElementById('auth-btn')?.classList.remove('hidden');

      // Realtime listeners (sensors/status/lastSeen)
      setupRealtimeListeners();

      // Ambil logs sesuai range default
      attachLogsListener();
    });

    // Hemat resource saat tab bg
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) stopHeartbeatWatch(); else startHeartbeatWatch();
    });
  });

  // ===== Cleanup =====
  window.addEventListener('beforeunload', ()=>{
    sensorsRef?.off(); statusRef?.off(); lastSeenRef?.off();
    detachLogsListener();
    stopHeartbeatWatch();
  });

  // ===== Expose to HTML =====
  window.sendCommand = sendCommand;
  window.refreshData = refreshData;
  window.exportData  = exportData;
  window.wifiReconfig = wifiReconfig;   // opsional, tambahkan tombol jika perlu
  window.toggleAuth  = toggleAuth;
  window.closeModal  = closeModal;
  window.logout      = logout;
  window.showOfflineModal = showOfflineModal;
})();
