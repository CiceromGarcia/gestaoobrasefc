/* =====================================================
   AUTH GUARD - PROTEÇÃO DE ROTAS E PERMISSÕES
   Arquivo: authGuard.js
   Versão: v002
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

const EMAILS_ADMIN_GERAL = [
  "cicero.garcia@vale.com",
  "c0706341@vale.com",
  "ciceromgarcia@gmail.com"
];

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

function emailNormalizado(valor) {

  return String(valor || "")
    .toLowerCase()
    .trim();

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
  localStorage.removeItem("regional");
  localStorage.removeItem("podeAprovarRM");

  sessionStorage.removeItem("logoutManual");

}

function salvarSessaoLocal(usuario) {

  try {

    localStorage.setItem(
      "uid",
      usuario.uid || ""
    );

    localStorage.setItem(
      "email",
      usuario.email || usuario.emailAuth || ""
    );

    localStorage.setItem(
      "nome",
      usuario.nome || ""
    );

    localStorage.setItem(
      "perfil",
      usuario.perfil || ""
    );

    localStorage.setItem(
      "regional",
      usuario.regional || ""
    );

    localStorage.setItem(
      "podeAprovarRM",
      usuarioPodeAprovarRM(usuario) ? "sim" : "nao"
    );

  } catch (error) {

    console.warn(
      "Não foi possível salvar sessão local:",
      error
    );

  }

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

export function usuarioEhAdministrador(usuario) {

  const perfil =
  normalizarTexto(
    usuario?.perfil
  );

  const email =
  emailNormalizado(
    usuario?.email ||
    usuario?.emailAuth
  );

  return (
    perfil === "administrador" ||
    perfil === "admin" ||
    perfil === "adm" ||
    perfil === "administrator" ||
    EMAILS_ADMIN_GERAL.includes(email)
  );

}

export function usuarioEhAdministradorRegional(usuario) {

  const perfil =
  normalizarTexto(
    usuario?.perfil
  );

  return (
    perfil === "administradorregional" ||
    perfil === "adminregional" ||
    perfil === "aprovadorrm"
  );

}

export function usuarioPodeAprovarRM(usuario) {

  return Boolean(
    usuarioEhAdministrador(usuario) ||
    usuarioEhAdministradorRegional(usuario) ||
    usuario?.podeAprovarRM === true
  );

}

export function usuarioPodeEditarObras(usuario) {

  if (usuarioEhAdministrador(usuario)) {
    return true;
  }

  const perfil =
  normalizarTexto(
    usuario?.perfil
  );

  return [
    "gestor",
    "planejador",
    "engenharia",
    "editor"
  ].includes(perfil);

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
    adminOnly = false,
    editorOnly = false,
    aprovacaoOnly = false
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
          email: usuarioSnap.data().email || user.email || "",
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

        if (
          editorOnly &&
          !usuarioPodeEditarObras(usuarioSistema)
        ) {

          alert(
            "Acesso permitido apenas para usuários com permissão de edição de obras."
          );

          redirecionarDashboard();

          return;

        }

        if (
          aprovacaoOnly &&
          !usuarioPodeAprovarRM(usuarioSistema)
        ) {

          alert(
            "Acesso permitido apenas para aprovadores de RM."
          );

          redirecionarDashboard();

          return;

        }

        window.usuarioSistema =
        usuarioSistema;

        salvarSessaoLocal(
          usuarioSistema
        );

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

    elemento.style.display =
    usuarioEhAdministrador(usuario)
    ? ""
    : "none";

  });

  const elementosAprovacao =
  document.querySelectorAll(
    "[data-aprovacao-only]"
  );

  elementosAprovacao.forEach((elemento) => {

    elemento.style.display =
    usuarioPodeAprovarRM(usuario)
    ? ""
    : "none";

  });

  const elementosEditor =
  document.querySelectorAll(
    "[data-editor-only]"
  );

  elementosEditor.forEach((elemento) => {

    elemento.style.display =
    usuarioPodeEditarObras(usuario)
    ? ""
    : "none";

  });

  if (usuarioEhAdministrador(usuario)) {
    document.body.classList.add("usuario-admin");
  } else {
    document.body.classList.remove("usuario-admin");
  }

  if (usuarioPodeAprovarRM(usuario)) {
    document.body.classList.add("usuario-aprovador-rm");
  } else {
    document.body.classList.remove("usuario-aprovador-rm");
  }

  if (usuarioPodeEditarObras(usuario)) {
    document.body.classList.add("usuario-editor-obras");
  } else {
    document.body.classList.remove("usuario-editor-obras");
  }

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