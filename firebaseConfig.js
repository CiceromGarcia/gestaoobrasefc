// firebaseConfig.js (NÃO coloque <script> aqui)
if (!window._firebaseBoot) {
  const firebaseConfig = {
    apiKey: "AIzaSyCIN_N1vkthW3G9E7HubFg-C_61-WnFSRU",
    authDomain: "queops-84feb.firebaseapp.com",
    projectId: "queops-84feb",
    storageBucket: "queops-84feb.appspot.com", // ✅ correto
    messagingSenderId: "415710636047",
    appId: "1:415710636047:web:58feb0b3fa8b5bcc199b7a"
  };

  // Garante uma única inicialização (evita erro de 'duplicate-app')
  if (!firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
  }

  // Expor globais para suas páginas atuais (compat)
  window.auth = firebase.auth();
  window.db   = firebase.firestore();

  window._firebaseBoot = true;
}

