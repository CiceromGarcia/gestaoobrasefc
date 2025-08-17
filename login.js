// login.js (versão reforçada, mesma estrutura/ids)

const ALLOWED = {
  "admin": "admin@queops.local",
  "regional 1": "regional1@queops.local",
  "regional 2": "regional2@queops.local",
  "regional 3": "regional3@queops.local"
};

const normalize = (s) =>
  s.normalize("NFD").replace(/\p{Diacritic}/gu,"").replace(/\s+/g," ").trim().toLowerCase();

const form = document.getElementById("loginForm");
const btn  = document.getElementById("btnLogin") || form.querySelector('button[type="submit"]');

let lockUntil = 0;

form.addEventListener("submit", async (e) => {
  e.preventDefault();

  if (!window.auth) {
    alert("Falha ao inicializar autenticação. Verifique o firebaseConfig.js e a ordem dos scripts.");
    return;
  }

  const now = Date.now();
  if (now < lockUntil) return;

  const rawUser = document.getElementById("username").value;
  const pass    = document.getElementById("password").value;

  const key = normalize(rawUser);
  const email = ALLOWED[key];

  if (!email) {
    alert("Usuário ou senha inválidos.");
    return;
  }

  if (btn) btn.disabled = true;

  try {
    const cred = await window.auth.signInWithEmailAndPassword(email, pass);
    const user = cred.user;

    const isLocal = email.endsWith("@queops.local");
    if (!isLocal && user.emailVerified === false) {
      await window.auth.signOut();
      alert("Confirme seu e-mail antes de acessar.");
      return;
    }

    window.location.href = "menu.html";
  } catch (err) {
    console.error("LOGIN ERROR:", err);
    let msg = "Usuário ou senha inválidos.";
    if (err?.code === "auth/too-many-requests") {
      msg = "Muitas tentativas. Aguarde e tente novamente.";
      lockUntil = Date.now() + 10_000;
    }
    alert(msg);
  } finally {
    await new Promise(r => setTimeout(r, 300));
    if (btn) btn.disabled = false;
  }
});
