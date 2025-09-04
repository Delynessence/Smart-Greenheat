// ====== UI helpers ======
function showLoading() {
    document.getElementById('loading-overlay').classList.add('show');
  }
  function hideLoading() {
    document.getElementById('loading-overlay').classList.remove('show');
  }
  function showToast(message, type = 'info') {
    const toast = document.getElementById('toast');
    const toastMessage = document.getElementById('toast-message');
    toastMessage.textContent = message;
    toast.className = 'toast show';
    // border kiri sesuai type
    toast.style.borderLeftColor =
      type === 'success' ? '#4CAF50' :
      type === 'error'   ? '#F44336' :
      type === 'warning' ? '#FF9800' : '#FF9A00';
    // auto hide
    setTimeout(() => { toast.className = 'toast'; }, 3000);
  }
  document.addEventListener('click', (e) => {
    if (e.target && e.target.classList.contains('toast-close')) {
      document.getElementById('toast').className = 'toast';
    }
  });
  
  // ====== Login logic ======
  document.addEventListener('DOMContentLoaded', function () {
    const auth = window.auth; // dari firebase-config.js
    const form = document.getElementById('login-form');
    const remember = document.getElementById('remember');
    const forgot = document.getElementById('forgot-link');
    const loginBtn = document.getElementById('login-btn');
  
    // Redirect jika sudah login
    auth.onAuthStateChanged(function (user) {
      if (user) {
        window.location.href = 'dashboard.html';
      }
    });
  
    // Reset password
    if (forgot) {
      forgot.addEventListener('click', function (e) {
        e.preventDefault();
        const email = document.getElementById('email').value.trim();
        if (!email) {
          showToast('Masukkan email terlebih dahulu untuk reset kata sandi.', 'warning');
          return;
        }
        showLoading();
        auth.sendPasswordResetEmail(email)
          .then(() => {
            hideLoading();
            showToast('Email reset password telah dikirim.', 'success');
          })
          .catch((error) => {
            hideLoading();
            showToast(`Gagal mengirim reset password: ${error.message}`, 'error');
          });
      });
    }
  
    // Submit login
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      const email = document.getElementById('email').value.trim();
      const pwd   = document.getElementById('password').value;
  
      if (!email || !pwd) {
        showToast('Email dan password wajib diisi.', 'warning');
        return;
      }
  
      // Persistence: Ingat saya → LOCAL; else → SESSION
      const mode = remember.checked
        ? firebase.auth.Auth.Persistence.LOCAL
        : firebase.auth.Auth.Persistence.SESSION;
  
      loginBtn.disabled = true;
      showLoading();
  
      auth.setPersistence(mode)
        .then(() => auth.signInWithEmailAndPassword(email, pwd))
        .then(() => {
          hideLoading();
          showToast('Login berhasil! Mengarahkan ke dashboard...', 'success');
          setTimeout(() => (window.location.href = 'dashboard.html'), 1200);
        })
        .catch((error) => {
          hideLoading();
          loginBtn.disabled = false;
  
          // Pesan error yang lebih ramah
          let msg = error.message;
          if (error.code === 'auth/invalid-email') msg = 'Format email tidak valid.';
          if (error.code === 'auth/user-not-found') msg = 'Akun tidak ditemukan.';
          if (error.code === 'auth/wrong-password') msg = 'Password salah.';
          if (error.code === 'auth/too-many-requests')
            msg = 'Terlalu banyak percobaan. Coba lagi nanti.';
          showToast(msg, 'error');
        });
    });
  });
  