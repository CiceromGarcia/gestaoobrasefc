const firebaseConfig = {
    apiKey: "AIzaSyCIN_N1vkthW3G9E7HubFg-C_61-WnFSRU",
    authDomain: "queops-84feb.firebaseapp.com",
    projectId: "queops-84feb",
    storageBucket: "queops-84feb.appspot.com",
    messagingSenderId: "415710636047",
    appId: "1:415710636047:web:58feb0b3fa8b5bcc199b7a"
};

// Inicializa Firebase apenas se não estiver inicializado
if (!firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
}

// Inicializa Firestore com suporte a timestamps
const db = firebase.firestore();
db.settings({ ignoreUndefinedProperties: true });

// Disponibiliza globalmente
window.db = db;


