/* =====================================================
   FIREBASE CONFIG
===================================================== */

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.3/firebase-app.js";

import {
  getFirestore
} from "https://www.gstatic.com/firebasejs/10.12.3/firebase-firestore.js";

import {
  getAuth
} from "https://www.gstatic.com/firebasejs/10.12.3/firebase-auth.js";

/* =====================================================
   CONFIGURAÇÃO DO SEU PROJETO FIREBASE
   COLE AQUI OS DADOS REAIS DO FIREBASE
===================================================== */

const firebaseConfig = {
  apiKey: "AIzaSyAD3hnVDVS0af1nyWbqpsBWQlTHkDtcx3U",
  authDomain: "fenix-obras.firebaseapp.com",
  projectId: "fenix-obras",
  storageBucket: "fenix-obras.firebasestorage.app",
  messagingSenderId: "289968302307",
  appId: "1:289968302307:web:c131f76320b3feb13ebdd6"
};


/* =====================================================
   INICIALIZAÇÃO
===================================================== */

const app = initializeApp(
  firebaseConfig
);

const db = getFirestore(
  app
);

const auth = getAuth(
  app
);

/* =====================================================
   EXPORTAÇÃO
===================================================== */

export {
  app,
  db,
  auth
};