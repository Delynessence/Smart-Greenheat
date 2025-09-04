// firebase-config.js — kompatibel untuk login.html (tanpa DB) dan index.html (dengan DB)

const firebaseConfig = {
  apiKey: "AIzaSyDAI8WuEDubVaJpg8ux0ZL_L8yuAnk0kQY",
  authDomain: "smart-greenheat.firebaseapp.com",
  databaseURL: "https://smart-greenheat-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "smart-greenheat",
  storageBucket: "smart-greenheat.appspot.com",
  messagingSenderId: "88979251346",
  appId: "1:88979251346:web:35ba818e22a4e4b4ec864b",
  measurementId: "G-872KXNKKP1"
};

// Inisialisasi Firebase (compat)
if (!firebase.apps || !firebase.apps.length) {
  firebase.initializeApp(firebaseConfig);
}

// Selalu buat AUTH (dibutuhkan login & dashboard)
if (firebase.auth) {
  window.auth = firebase.auth();
} else {
  console.warn("[firebase-config] Auth SDK tidak dimuat di halaman ini.");
  window.auth = null;
}

// Database itu opsional (login.html tidak memuat DB SDK)
if (firebase.database) {
  window.database = firebase.database();
  window.connectedRef = window.database.ref(".info/connected");
} else {
  console.warn("[firebase-config] Database SDK tidak dimuat di halaman ini.");
  window.database = null;
  window.connectedRef = null;
}
