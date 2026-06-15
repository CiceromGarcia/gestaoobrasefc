/* =====================================================
   AUTH GUARD - PROTEÇÃO DE ROTAS E PERMISSÕES
===================================================== */

import {
  auth,
  db
} from "./firebaseConfig.js";

import {
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/10.12.3/firebase-auth.js";

import {
  doc,
  getDoc
} from "https://www.gstatic.com/firebasejs/10.12.3/firebase-firestore.js";

/* =====================================================
   CONFIGURAÇÕES
===================================================== */

const COLECAO_USUARIOS =
"usuariosSistema";

const PAGINA_LOGIN =
"./login.html";

const PAGINA_DASHBOARD =
"./dashboard.html";

/* =====================================================
   UTILITÁRIOS
===================================================== */

function normalizarTexto(valor) {

  return String(valor || "")
    .toLowerCase()
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

}

function limparSessaoLocal() {

  localStorage.removeItem("usuarioLogado");
  localStorage.removeItem("usuarioAtual");
  localStorage.removeItem("usuario");
  localStorage.removeItem("currentUser");
  localStorage.removeItem("user");

  localStorage.removeItem("uid");
  localStorage.removeItem("email");
  localStorage.removeItem("nome");
  localStorage.removeItem("perfil");
  localStorage.removeItem("role");
  localStorage.removeItem("tipo");
  localStorage.removeItem("cargo");
  localStorage.removeItem("nivel");
  localStorage.removeItem("permissao");

  sessionStorage.removeItem("logoutManual");

}

function redirecionarLogin() {

  window.location.replace(
    PAGINA_LOGIN
  );

}

function redirecionarDashboard() {

  window.location.replace(
    PAGINA_DASHBOARD
  );

}

/* =====================================================
   STATUS E PERFIL
===================================================== */

function obterStatusUsuario(usuario) {

  return normalizarTexto(
    usuario?.status ||
    "pendente"
  );

}

function usuarioEstaAtivo(usuario) {

  const status =
  obterStatusUsuario(
    usuario
  );

  return (
    status === "ativo" ||
    status === "active"
  );

}

function usuarioEstaPendente(usuario) {

  const status =
  obterStatusUsuario(
    usuario
  );

  return (
    status === "pendente" ||
    status === "aguardando" ||
    status === "aguardando aprovacao" ||
    status === "aguardando aprovação"
  );

}

function usuarioEhAdministrador(usuario) {

  const perfil =
  normalizarTexto(
    usuario?.perfil
  );

  return (
    perfil === "administrador" ||
    perfil === "admin" ||
    perfil === "administrator"
  );

}

function mensagemStatusUsuario(usuario) {

  if (usuarioEstaPendente(usuario)) {

    return "Seu cadastro está pendente de aprovação do administrador.";

  }

  return "Seu usuário está inativo. Procure o administrador.";

}

/* =====================================================
   ENCERRAR ACESSO BLOQUEADO
===================================================== */

async function bloquearAcesso(mensagem) {

  try {

    alert(
      mensagem
    );

    limparSessaoLocal();

    await signOut(
      auth
    );

  } catch (error) {

    console.warn(
      "Erro ao encerrar sessão bloqueada:",
      error
    );

  } finally {

    redirecionarLogin();

  }

}

/* =====================================================
   PROTEGER PÁGINA
===================================================== */

export function protegerPagina(opcoes = {}) {

  const {
    adminOnly = false
  } = opcoes;

  return new Promise((resolve) => {

    let cancelarObservador = null;

    cancelarObservador =
    onAuthStateChanged(auth, async (user) => {

      if (cancelarObservador) {

        cancelarObservador();

      }

      try {

        if (!user) {

          limparSessaoLocal();

          redirecionarLogin();

          return;

        }

        const usuarioRef =
        doc(
          db,
          COLECAO_USUARIOS,
          user.uid
        );

        const usuarioSnap =
        await getDoc(
          usuarioRef
        );

        if (!usuarioSnap.exists()) {

          await bloquearAcesso(
            "Usuário não encontrado no sistema. Procure o administrador."
          );

          return;

        }

        const usuarioSistema = {
          uid: user.uid,
          emailAuth: user.email,
          ...usuarioSnap.data()
        };

        if (!usuarioEstaAtivo(usuarioSistema)) {

          await bloquearAcesso(
            mensagemStatusUsuario(
              usuarioSistema
            )
          );

          return;

        }

        if (
          adminOnly &&
          !usuarioEhAdministrador(usuarioSistema)
        ) {

          alert(
            "Acesso permitido apenas para administradores."
          );

          redirecionarDashboard();

          return;

        }

        window.usuarioSistema =
        usuarioSistema;

        aplicarPermissoesVisuais(
          usuarioSistema
        );

        resolve(
          usuarioSistema
        );

      } catch (error) {

        console.error(
          "Erro ao validar usuário:",
          error
        );

        await bloquearAcesso(
          "Erro ao validar permissões do usuário."
        );

      }

    });

  });

}

/* =====================================================
   APLICAR PERMISSÕES VISUAIS
===================================================== */

function aplicarPermissoesVisuais(usuario) {

  const elementosAdmin =
  document.querySelectorAll(
    "[data-admin-only]"
  );

  elementosAdmin.forEach((elemento) => {

    if (!usuarioEhAdministrador(usuario)) {

      elemento.style.display =
      "none";

    } else {

      elemento.style.display =
      "";

    }

  });

}

/* =====================================================
   OBTER USUÁRIO LOGADO
===================================================== */

export function obterUsuarioSistema() {

  return window.usuarioSistema || null;

}

/* =====================================================
   SAIR DO SISTEMA
===================================================== */

export async function sairDoSistema() {

  try {

    limparSessaoLocal();

    await signOut(
      auth
    );

    window.location.replace(
      `${PAGINA_LOGIN}?sair=1`
    );

  } catch (error) {

    console.error(
      "Erro ao sair:",
      error
    );

    alert(
      "Erro ao sair do sistema."
    );

  }

}