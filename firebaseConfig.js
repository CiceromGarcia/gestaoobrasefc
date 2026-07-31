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

import {
  initializeAppCheck,
  ReCaptchaV3Provider
} from "https://www.gstatic.com/firebasejs/10.12.3/firebase-app-check.js";

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

/* =====================================================
   APP CHECK
   Impede que os endpoints (Cloud Functions e, opcionalmente,
   Firestore/Storage) sejam chamados por scripts/bots fora do
   seu site — só o app rodando no seu domínio consegue gerar
   um token de App Check válido.

   PASSO A PASSO (uma vez só, no Console do Firebase):
   1. Firebase Console > App Check > registrar o app Web.
   2. Escolher provedor "reCAPTCHA v3" e criar/colar a site key
      do reCAPTCHA (console.cloud.google.com/security/recaptcha).
   3. Colar a site key abaixo, no lugar de "COLE_SUA_SITE_KEY_AQUI".
   4. Em desenvolvimento local (localhost), habilite o modo debug:
      abra o console do navegador, rode
        self.FIREBASE_APPCHECK_DEBUG_TOKEN = true;
      antes de carregar a página, copie o token gerado no console
      e cadastre-o em App Check > Apps > gerenciar tokens de depuração.
   5. Só DEPOIS de configurado, ative "Enforce" nas Cloud Functions
      (já feito no functions/index.js) e, se quiser, no Firestore.
===================================================== */

const APP_CHECK_SITE_KEY = "COLE_SUA_SITE_KEY_AQUI";

let appCheck = null;

if (APP_CHECK_SITE_KEY && APP_CHECK_SITE_KEY !== "COLE_SUA_SITE_KEY_AQUI") {
  appCheck = initializeAppCheck(app, {
    provider: new ReCaptchaV3Provider(APP_CHECK_SITE_KEY),
    isTokenAutoRefreshEnabled: true
  });
} else {
  console.warn(
    "[AppCheck] Site key não configurada em firebaseConfig.js — " +
    "as chamadas às Cloud Functions com enforceAppCheck vão falhar " +
    "até isso ser configurado."
  );
}

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
  auth,
  appCheck
};