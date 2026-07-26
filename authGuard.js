/* =====================================================
   AUTH GUARD - PROTEÇÃO DE ROTAS E PERMISSÕES
   Arquivo: authGuard.js
   Versão: v003

   Regras principais:
   - Perfil do banco manda.
   - Usuário salvo como "usuario" não vira administrador por e-mail.
   - E-mail fixo só serve como contingência se o usuário ainda não tiver perfil.
   - Mostra e-mail e perfil automaticamente nas páginas protegidas.
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
  getDoc,
  collection,
  getDocs,
  query,
  where
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

function obterEmailUsuario(usuario) {
  return emailNormalizado(
    usuario?.email ||
    usuario?.emailAuth ||
    usuario?.usuarioEmail ||
    usuario?.login ||
    usuario?.user?.email ||
    auth.currentUser?.email ||
    ""
  );
}

function obterNomeUsuario(usuario) {
  return String(
    usuario?.nome ||
    usuario?.displayName ||
    usuario?.usuario ||
    usuario?.name ||
    obterEmailUsuario(usuario) ||
    "Usuário"
  ).trim();
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

  sessionStorage.removeItem("usuarioLogado");
  sessionStorage.removeItem("usuarioAtual");
  sessionStorage.removeItem("usuario");
  sessionStorage.removeItem("currentUser");
  sessionStorage.removeItem("user");

  sessionStorage.removeItem("uid");
  sessionStorage.removeItem("email");
  sessionStorage.removeItem("nome");
  sessionStorage.removeItem("perfil");
  sessionStorage.removeItem("role");
  sessionStorage.removeItem("tipo");
  sessionStorage.removeItem("cargo");
  sessionStorage.removeItem("nivel");
  sessionStorage.removeItem("permissao");
  sessionStorage.removeItem("regional");
  sessionStorage.removeItem("podeAprovarRM");

  sessionStorage.removeItem("logoutManual");
}

function salvarSessaoLocal(usuario) {
  try {
    sessionStorage.setItem(
      "uid",
      usuario.uid || ""
    );

    sessionStorage.setItem(
      "email",
      obterEmailUsuario(usuario)
    );

    sessionStorage.setItem(
      "nome",
      obterNomeUsuario(usuario)
    );

    sessionStorage.setItem(
      "perfil",
      obterPerfilEfetivo(usuario)
    );

    sessionStorage.setItem(
      "regional",
      usuario.regional || ""
    );

    sessionStorage.setItem(
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
   STATUS
===================================================== */

function obterStatusUsuario(usuario) {
  return normalizarTexto(
    usuario?.status ||
    "pendente"
  );
}

function usuarioEstaAtivo(usuario) {
  const status =
    obterStatusUsuario(usuario);

  return (
    status === "ativo" ||
    status === "active"
  );
}

function usuarioEstaPendente(usuario) {
  const status =
    obterStatusUsuario(usuario);

  return (
    status === "pendente" ||
    status === "aguardando" ||
    status === "aguardando aprovacao" ||
    status === "aguardando aprovação"
  );
}

function usuarioEstaBloqueado(usuario) {
  const status =
    obterStatusUsuario(usuario);

  return [
    "inativo",
    "inactive",
    "bloqueado",
    "bloqueada",
    "desativado",
    "desativada",
    "reprovado",
    "reprovada"
  ].includes(status);
}

/* =====================================================
   PERFIL
===================================================== */

function normalizarPerfilSistema(perfil) {
  const perfilNormalizado =
    normalizarTexto(perfil);

  if (
    perfilNormalizado === "administrador" ||
    perfilNormalizado === "admin" ||
    perfilNormalizado === "adm" ||
    perfilNormalizado === "administrator" ||
    perfilNormalizado === "administrador geral" ||
    perfilNormalizado === "administradorgeral" ||
    perfilNormalizado === "admin geral" ||
    perfilNormalizado === "adm geral"
  ) {
    return "administrador";
  }

  if (
    perfilNormalizado === "planejador" ||
    perfilNormalizado === "gestor" ||
    perfilNormalizado === "engenharia" ||
    perfilNormalizado === "editor" ||
    perfilNormalizado === "administradorregional" ||
    perfilNormalizado === "administrador regional" ||
    perfilNormalizado === "adminregional" ||
    perfilNormalizado === "admin regional" ||
    perfilNormalizado === "aprovadorrm"
  ) {
    return "planejador";
  }

  if (
    perfilNormalizado === "usuario" ||
    perfilNormalizado === "usuário" ||
    perfilNormalizado === "visualizador" ||
    perfilNormalizado === "viewer"
  ) {
    return "usuario";
  }

  return perfilNormalizado || "";
}

function usuarioTemPerfilSalvo(usuario) {
  return Boolean(
    normalizarPerfilSistema(usuario?.perfil)
  );
}

function usuarioEmailEhAdminInicial(usuario) {
  const email =
    obterEmailUsuario(usuario);

  return (
    EMAILS_ADMIN_GERAL.includes(email) &&
    usuario?.adminRebaixado !== true &&
    !usuarioTemPerfilSalvo(usuario)
  );
}

export function obterPerfilEfetivo(usuario) {
  const perfilSalvo =
    normalizarPerfilSistema(
      usuario?.perfil
    );

  /*
    REGRA DE SEGURANÇA:
    Se existe perfil salvo no banco, o banco manda.
    Então, se está salvo como "usuario", será usuário.
  */

  if (perfilSalvo) {
    return perfilSalvo;
  }

  /*
    A lista fixa só serve como contingência inicial,
    quando ainda não existe perfil salvo.
  */

  if (usuarioEmailEhAdminInicial(usuario)) {
    return "administrador";
  }

  return "usuario";
}

export function obterRotuloPerfil(usuario) {
  const perfil =
    obterPerfilEfetivo(usuario);

  const mapa = {
    administrador: "Administrador Geral",
    planejador: "Planejador",
    usuario: "Usuário"
  };

  return mapa[perfil] || "Usuário";
}

export function usuarioEhAdministrador(usuario) {
  return (
    usuarioEstaAtivo(usuario) &&
    obterPerfilEfetivo(usuario) === "administrador"
  );
}

export function usuarioEhPlanejador(usuario) {
  return (
    usuarioEstaAtivo(usuario) &&
    obterPerfilEfetivo(usuario) === "planejador"
  );
}

export function usuarioEhUsuarioComum(usuario) {
  return (
    usuarioEstaAtivo(usuario) &&
    obterPerfilEfetivo(usuario) === "usuario"
  );
}

export function usuarioEhAdministradorRegional() {
  return false;
}

export function usuarioPodeAprovarRM(usuario) {
  return usuarioEhAdministrador(usuario);
}

export function usuarioPodeEditarObras(usuario) {
  return usuarioEhAdministrador(usuario);
}

export function usuarioPodeExcluirObras(usuario) {
  return usuarioEhAdministrador(usuario);
}

function mensagemStatusUsuario(usuario) {
  if (usuarioEstaPendente(usuario)) {
    return "Seu cadastro está pendente de aprovação do administrador.";
  }

  if (usuarioEstaBloqueado(usuario)) {
    return "Seu usuário está inativo ou bloqueado. Procure o administrador.";
  }

  return "Seu usuário não está liberado para acessar o sistema.";
}

/* =====================================================
   BUSCAR USUÁRIO NO FIRESTORE
===================================================== */

async function buscarUsuarioPorUid(user) {
  if (!user?.uid) {
    return null;
  }

  const usuarioRef =
    doc(
      db,
      COLECAO_USUARIOS,
      user.uid
    );

  const usuarioSnap =
    await getDoc(usuarioRef);

  if (!usuarioSnap.exists()) {
    return null;
  }

  return {
    id: usuarioSnap.id,
    uid: user.uid,
    emailAuth: user.email || "",
    ...usuarioSnap.data()
  };
}

async function buscarUsuarioPorEmail(user) {
  const email =
    emailNormalizado(user?.email);

  if (!email) {
    return null;
  }

  const camposBusca = [
    "email",
    "emailAuth",
    "usuarioEmail",
    "login"
  ];

  for (const campo of camposBusca) {
    try {
      const consulta =
        query(
          collection(
            db,
            COLECAO_USUARIOS
          ),
          where(
            campo,
            "==",
            email
          )
        );

      const snapshot =
        await getDocs(consulta);

      if (!snapshot.empty) {
        const documento =
          snapshot.docs[0];

        return {
          id: documento.id,
          uid: documento.data().uid || user.uid || documento.id,
          emailAuth: user.email || "",
          ...documento.data()
        };
      }
    } catch (error) {
      console.warn(
        `Não foi possível buscar usuário pelo campo ${campo}:`,
        error
      );
    }
  }

  return null;
}

async function buscarUsuarioSistema(user) {
  let usuarioSistema =
    await buscarUsuarioPorUid(user);

  if (!usuarioSistema) {
    usuarioSistema =
      await buscarUsuarioPorEmail(user);
  }

  if (!usuarioSistema) {
    return null;
  }

  return {
    ...usuarioSistema,

    uid:
      usuarioSistema.uid ||
      user.uid ||
      usuarioSistema.id ||
      "",

    emailAuth:
      user.email || "",

    email:
      emailNormalizado(
        usuarioSistema.email ||
        usuarioSistema.emailAuth ||
        user.email ||
        ""
      ),

    displayName:
      usuarioSistema.displayName ||
      user.displayName ||
      ""
  };
}

/* =====================================================
   ENCERRAR ACESSO BLOQUEADO
===================================================== */

async function bloquearAcesso(mensagem) {
  try {
    alert(mensagem);

    limparSessaoLocal();

    await signOut(auth);
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
   IDENTIFICAÇÃO VISUAL DO USUÁRIO
===================================================== */

function garantirEstiloUsuarioTopo() {
  if (
    document.getElementById("estiloUsuarioSistemaTopo")
  ) {
    return;
  }

  const style =
    document.createElement("style");

  style.id =
    "estiloUsuarioSistemaTopo";

  style.textContent = `
    .usuario-logado-info,
    .sg-usuario-logado-info {
      margin-top: 8px;
      padding: 6px 10px;
      display: inline-flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 8px;
      border: 1px solid rgba(255,255,255,.35);
      border-radius: 10px;
      background: rgba(255,255,255,.14);
      color: inherit;
      font-size: 11px;
      font-weight: 700;
      line-height: 1.2;
      max-width: 100%;
    }

    .usuario-logado-info strong,
    .sg-usuario-logado-info strong {
      font-weight: 800;
    }

    .usuario-logado-item,
    .sg-usuario-logado-item {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      white-space: nowrap;
    }

    .usuario-logado-separador,
    .sg-usuario-logado-separador {
      opacity: .65;
    }

    .usuario-logado-info.perfil-sem-permissao,
    .sg-usuario-logado-info.perfil-sem-permissao {
      background: rgba(255,255,255,.10);
    }

    body:not(.usuario-admin) [data-admin-only],
    body:not(.usuario-admin) .btn-excluir-obra,
    body:not(.usuario-admin) .btn-editar-datas {
      display: none !important;
    }

    @media(max-width: 768px) {
      .usuario-logado-info,
      .sg-usuario-logado-info {
        width: 100%;
        align-items: flex-start;
      }

      .usuario-logado-item,
      .sg-usuario-logado-item {
        width: 100%;
        white-space: normal;
      }

      .usuario-logado-separador,
      .sg-usuario-logado-separador {
        display: none;
      }
    }
  `;

  document.head.appendChild(style);
}

function montarHtmlUsuarioTopo(usuario) {
  const email =
    obterEmailUsuario(usuario) ||
    "Email não identificado";

  const perfil =
    obterRotuloPerfil(usuario);

  return `
    <span class="usuario-logado-item sg-usuario-logado-item">
      <span aria-hidden="true">✉</span>
      <strong id="usuarioEmailTopo">${email}</strong>
    </span>

    <span class="usuario-logado-separador sg-usuario-logado-separador">|</span>

    <span class="usuario-logado-item sg-usuario-logado-item">
      <span aria-hidden="true">👤</span>
      <span>Perfil:</span>
      <strong id="usuarioPerfilTopo">${perfil}</strong>
    </span>
  `;
}

function localizarAreaCabecalho() {
  return (
    document.querySelector(".topbar-left") ||
    document.querySelector(".header-left") ||
    document.querySelector(".dashboard-title") ||
    document.querySelector(".page-title") ||
    document.querySelector(".cabecalho-left") ||
    document.querySelector("header .container") ||
    document.querySelector("header") ||
    document.querySelector(".topbar") ||
    document.querySelector(".header")
  );
}

export function exibirUsuarioLogadoNaPagina(usuario) {
  garantirEstiloUsuarioTopo();

  const email =
    obterEmailUsuario(usuario) ||
    "Email não identificado";

  const perfil =
    obterRotuloPerfil(usuario);

  let box =
    document.getElementById("usuarioLogadoInfo");

  if (!box) {
    box =
      document.createElement("div");

    box.id =
      "usuarioLogadoInfo";

    box.className =
      "usuario-logado-info sg-usuario-logado-info";

    const areaCabecalho =
      localizarAreaCabecalho();

    if (areaCabecalho) {
      areaCabecalho.appendChild(box);
    } else {
      document.body.insertBefore(
        box,
        document.body.firstChild
      );
    }
  }

  box.classList.add(
    "usuario-logado-info",
    "sg-usuario-logado-info"
  );

  if (
    !document.getElementById("usuarioEmailTopo") ||
    !document.getElementById("usuarioPerfilTopo")
  ) {
    box.innerHTML =
      montarHtmlUsuarioTopo(usuario);
  }

  const elEmail =
    document.getElementById("usuarioEmailTopo");

  const elPerfil =
    document.getElementById("usuarioPerfilTopo");

  if (elEmail) {
    elEmail.textContent =
      email;
  }

  if (elPerfil) {
    elPerfil.textContent =
      perfil;
  }

  box.classList.toggle(
    "perfil-administrador",
    usuarioEhAdministrador(usuario)
  );

  box.classList.toggle(
    "perfil-sem-permissao",
    !usuarioEhAdministrador(usuario)
  );

  document.body.dataset.usuarioEmail =
    email;

  document.body.dataset.usuarioPerfil =
    obterPerfilEfetivo(usuario);
}

/* =====================================================
   APLICAR PERMISSÕES VISUAIS
===================================================== */

function alternarElementoPorPermissao(
  elemento,
  permitido
) {
  if (permitido) {
    elemento.hidden = false;
    elemento.removeAttribute("aria-disabled");
    elemento.style.removeProperty("display");
    return;
  }

  elemento.hidden = true;
  elemento.setAttribute("aria-disabled", "true");
  elemento.style.display = "none";
}

function aplicarPermissoesVisuais(usuario) {
  const admin =
    usuarioEhAdministrador(usuario);

  const aprovador =
    usuarioPodeAprovarRM(usuario);

  const editor =
    usuarioPodeEditarObras(usuario);

  document
    .querySelectorAll("[data-admin-only]")
    .forEach((elemento) => {
      alternarElementoPorPermissao(
        elemento,
        admin
      );
    });

  document
    .querySelectorAll("[data-aprovacao-only]")
    .forEach((elemento) => {
      alternarElementoPorPermissao(
        elemento,
        aprovador
      );
    });

  document
    .querySelectorAll("[data-editor-only]")
    .forEach((elemento) => {
      alternarElementoPorPermissao(
        elemento,
        editor
      );
    });

  document.body.classList.toggle(
    "usuario-admin",
    admin
  );

  document.body.classList.toggle(
    "usuario-admin-geral",
    admin
  );

  document.body.classList.toggle(
    "usuario-aprovador-rm",
    aprovador
  );

  document.body.classList.toggle(
    "usuario-editor-obras",
    editor
  );

  document.body.classList.toggle(
    "usuario-planejador",
    usuarioEhPlanejador(usuario)
  );

  document.body.classList.toggle(
    "usuario-comum",
    usuarioEhUsuarioComum(usuario)
  );

  exibirUsuarioLogadoNaPagina(usuario);
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

          const usuarioSistema =
            await buscarUsuarioSistema(user);

          if (!usuarioSistema) {
            await bloquearAcesso(
              "Usuário não encontrado no sistema. Procure o administrador."
            );

            return;
          }

          if (!usuarioEstaAtivo(usuarioSistema)) {
            await bloquearAcesso(
              mensagemStatusUsuario(usuarioSistema)
            );

            return;
          }

          if (
            adminOnly &&
            !usuarioEhAdministrador(usuarioSistema)
          ) {
            alert(
              "Acesso permitido apenas para Administrador Geral."
            );

            redirecionarDashboard();

            return;
          }

          if (
            editorOnly &&
            !usuarioPodeEditarObras(usuarioSistema)
          ) {
            alert(
              "Acesso permitido apenas para Administrador Geral."
            );

            redirecionarDashboard();

            return;
          }

          if (
            aprovacaoOnly &&
            !usuarioPodeAprovarRM(usuarioSistema)
          ) {
            alert(
              "Acesso permitido apenas para Administrador Geral."
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

          console.info(
            "Usuário validado:",
            {
              uid: usuarioSistema.uid,
              email: obterEmailUsuario(usuarioSistema),
              perfilBanco: usuarioSistema.perfil || "",
              perfilEfetivo: obterPerfilEfetivo(usuarioSistema),
              administrador: usuarioEhAdministrador(usuarioSistema)
            }
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

    await signOut(auth);

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