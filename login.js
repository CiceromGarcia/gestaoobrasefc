/* =====================================================
   LOGIN.JS
   Login, cadastro, recuperação de senha e redirecionamento
===================================================== */

import {
  db,
  auth
} from "./firebaseConfig.js";

import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
  updateProfile,
  signOut,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.3/firebase-auth.js";

import {
  doc,
  setDoc,
  getDoc,
  collection,
  getDocs,
  serverTimestamp,
  orderBy,
  query
} from "https://www.gstatic.com/firebasejs/10.12.3/firebase-firestore.js";

/* =====================================================
   ELEMENTOS DA TELA
===================================================== */

const authCard =
document.querySelector(
  ".auth-card"
);

const painelUsuario =
document.getElementById(
  "painelUsuario"
);

const tituloTela =
document.getElementById(
  "tituloTela"
);

const subtituloTela =
document.getElementById(
  "subtituloTela"
);

const btnLogin =
document.getElementById(
  "btnLogin"
);

const btnCadastro =
document.getElementById(
  "btnCadastro"
);

const formLogin =
document.getElementById(
  "formLogin"
);

const formCadastro =
document.getElementById(
  "formCadastro"
);

const formRecuperacao =
document.getElementById(
  "formRecuperacao"
);

const abrirRecuperacao =
document.getElementById(
  "abrirRecuperacao"
);

const voltarLogin =
document.getElementById(
  "voltarLogin"
);

const mensagem =
document.getElementById(
  "mensagem"
);

const usuarioLogado =
document.getElementById(
  "usuarioLogado"
);

const areaAdmin =
document.getElementById(
  "areaAdmin"
);

const listaUsuarios =
document.getElementById(
  "listaUsuarios"
);

const btnSair =
document.getElementById(
  "btnSair"
);

/* =====================================================
   CONFIGURAÇÕES
===================================================== */

const COLECAO_USUARIOS =
"usuariosSistema";

const PAGINA_PRINCIPAL =
"./dashboard.html";

const ARQUIVO_LOGIN_ATUAL =
window.location.pathname
  .split("/")
  .pop() || "login.html";

const PAGINA_LOGIN =
`./${ARQUIVO_LOGIN_ATUAL}`;

/* =====================================================
   CONTROLES
===================================================== */

let firebasePronto =
true;

let loginEmAndamento =
false;

let cadastroEmAndamento =
false;

let observadorConfigurado =
false;

/* =====================================================
   PARÂMETROS DE LOGOUT
===================================================== */

function logoutFoiSolicitado() {

  const parametros =
  new URLSearchParams(
    window.location.search
  );

  return (
    parametros.get("sair") === "1" ||
    sessionStorage.getItem("logoutManual") === "sim"
  );

}

/* =====================================================
   LIMPAR SESSÃO LOCAL
===================================================== */

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

}

/* =====================================================
   SALVAR SESSÃO LOCAL
   Observação:
   Esses dados são apenas apoio visual.
   A permissão real vem do Firebase Auth + Firestore.
===================================================== */

function salvarSessaoLocal(usuarioFirebase, dadosSistema) {

  const email =
  String(
    usuarioFirebase?.email ||
    dadosSistema?.email ||
    ""
  )
    .toLowerCase()
    .trim();

  const usuarioFinal = {

    uid:
    usuarioFirebase?.uid ||
    dadosSistema?.uid ||
    "",

    id:
    usuarioFirebase?.uid ||
    dadosSistema?.uid ||
    "",

    nome:
    dadosSistema?.nome ||
    usuarioFirebase?.displayName ||
    email ||
    "Usuário",

    email:
    email,

    perfil:
    dadosSistema?.perfil ||
    "usuario",

    status:
    dadosSistema?.status ||
    "pendente",

    autenticado:
    true,

    loginEm:
    new Date().toISOString()

  };

  localStorage.setItem(
    "usuarioLogado",
    JSON.stringify(usuarioFinal)
  );

  localStorage.setItem(
    "uid",
    usuarioFinal.uid
  );

  localStorage.setItem(
    "email",
    usuarioFinal.email
  );

  localStorage.setItem(
    "nome",
    usuarioFinal.nome
  );

  localStorage.setItem(
    "perfil",
    usuarioFinal.perfil
  );

  sessionStorage.removeItem(
    "logoutManual"
  );

}

/* =====================================================
   FUNÇÕES DE MENSAGEM
===================================================== */

function limparMensagem() {

  if (!mensagem) {
    return;
  }

  mensagem.className =
  "message";

  mensagem.textContent =
  "";

}

function mostrarMensagem(
  texto,
  tipo = "success"
) {

  if (!mensagem) {
    return;
  }

  mensagem.className =
  `message ${tipo}`;

  mensagem.textContent =
  texto;

}

/* =====================================================
   REDIRECIONAMENTO
===================================================== */

function redirecionarPaginaPrincipal() {

  setTimeout(
    () => {

      window.location.replace(
        PAGINA_PRINCIPAL
      );

    },
    800
  );

}

/* =====================================================
   TROCAR TELAS
===================================================== */

function trocarTela(tela) {

  limparMensagem();

  formLogin?.classList.remove(
    "active"
  );

  formCadastro?.classList.remove(
    "active"
  );

  formRecuperacao?.classList.remove(
    "active"
  );

  btnLogin?.classList.remove(
    "active"
  );

  btnCadastro?.classList.remove(
    "active"
  );

  if (tela === "login") {

    formLogin?.classList.add(
      "active"
    );

    btnLogin?.classList.add(
      "active"
    );

    if (tituloTela) {

      tituloTela.textContent =
      "Acessar sistema";

    }

    if (subtituloTela) {

      subtituloTela.textContent =
      "Informe seus dados para continuar";

    }

  }

  if (tela === "cadastro") {

    formCadastro?.classList.add(
      "active"
    );

    btnCadastro?.classList.add(
      "active"
    );

    if (tituloTela) {

      tituloTela.textContent =
      "Criar cadastro";

    }

    if (subtituloTela) {

      subtituloTela.textContent =
      "Seu acesso ficará pendente de aprovação do administrador";

    }

  }

  if (tela === "recuperacao") {

    formRecuperacao?.classList.add(
      "active"
    );

    if (tituloTela) {

      tituloTela.textContent =
      "Recuperar senha";

    }

    if (subtituloTela) {

      subtituloTela.textContent =
      "Receba um link de redefinição no seu e-mail";

    }

  }

}

/* =====================================================
   CLIQUES DAS ABAS
===================================================== */

function configurarAbas() {

  btnLogin?.addEventListener(
    "click",
    () => {

      trocarTela(
        "login"
      );

    }
  );

  btnCadastro?.addEventListener(
    "click",
    () => {

      trocarTela(
        "cadastro"
      );

    }
  );

  voltarLogin?.addEventListener(
    "click",
    () => {

      trocarTela(
        "login"
      );

    }
  );

}

/* =====================================================
   MOSTRAR / OCULTAR SENHA
===================================================== */

function configurarMostrarSenha() {

  document.querySelectorAll(
    ".eye-btn"
  ).forEach((botao) => {

    botao.addEventListener(
      "click",
      () => {

        const targetId =
        botao.dataset.target;

        const input =
        document.getElementById(
          targetId
        );

        const icone =
        botao.querySelector(
          "i"
        );

        if (!input || !icone) {
          return;
        }

        if (input.type === "password") {

          input.type =
          "text";

          icone.classList.remove(
            "fa-eye"
          );

          icone.classList.add(
            "fa-eye-slash"
          );

        } else {

          input.type =
          "password";

          icone.classList.remove(
            "fa-eye-slash"
          );

          icone.classList.add(
            "fa-eye"
          );

        }

      }
    );

  });

}

/* =====================================================
   NORMALIZAR TEXTO
===================================================== */

function normalizarTexto(valor) {

  return String(valor || "")
    .toLowerCase()
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

}

/* =====================================================
   TRADUZIR ERROS
===================================================== */

function traduzErro(erro) {

  console.error(
    "ERRO FIREBASE:",
    erro
  );

  const erros = {

    "auth/email-already-in-use":
    "Este e-mail já está cadastrado.",

    "auth/invalid-email":
    "E-mail inválido. Digite um e-mail válido.",

    "auth/user-not-found":
    "Usuário não encontrado.",

    "auth/wrong-password":
    "Senha incorreta.",

    "auth/invalid-credential":
    "E-mail ou senha incorretos.",

    "auth/weak-password":
    "A senha precisa ter pelo menos 6 caracteres.",

    "auth/missing-password":
    "Informe a senha.",

    "auth/missing-email":
    "Informe o e-mail para recuperação.",

    "auth/too-many-requests":
    "Muitas tentativas em pouco tempo. Aguarde alguns minutos e tente novamente.",

    "auth/user-disabled":
    "Este usuário está desativado no Firebase Authentication.",

    "auth/operation-not-allowed":
    "O cadastro por e-mail e senha não está ativado no Firebase Authentication.",

    "auth/api-key-not-valid.-please-pass-a-valid-api-key.":
    "A API Key do Firebase está inválida. Corrija o arquivo firebaseConfig.js.",

    "auth/network-request-failed":
    "Falha de conexão com o Firebase.",

    "auth/unauthorized-domain":
    "Este domínio não está autorizado no Firebase. Adicione localhost, 127.0.0.1 ou seu domínio publicado em Authentication > Settings > Authorized domains.",

    "auth/unauthorized-continue-uri":
    "A URL de retorno não está autorizada no Firebase.",

    "auth/invalid-continue-uri":
    "A URL de retorno da recuperação de senha é inválida.",

    "permission-denied":
    "Permissão negada no Firestore. Verifique as regras do banco de dados.",

    "unavailable":
    "Firebase indisponível no momento. Tente novamente.",

    "failed-precondition":
    "Existe uma configuração pendente no Firestore.",

    "usuario/pendente":
    "Seu cadastro está pendente de aprovação do administrador.",

    "usuario/inativo":
    "Usuário inativo. Procure o administrador."

  };

  return erros[erro.code] ||
  erro.message ||
  `Erro não identificado: ${erro.code || "sem código"}`;

}

function mensagemErro(erro) {

  if (
    erro?.code === "usuario/pendente" ||
    erro?.code === "usuario/inativo"
  ) {

    return erro.message ||
    traduzErro(erro);

  }

  return traduzErro(
    erro
  );

}

/* =====================================================
   VERIFICAR FIREBASE
===================================================== */

function verificarFirebase() {

  if (!firebasePronto || !auth || !db) {

    mostrarMensagem(
      "Firebase ainda não carregou. Verifique o firebaseConfig.js.",
      "error"
    );

    return false;

  }

  return true;

}

/* =====================================================
   FORMATAR DATA
===================================================== */

function formatarData(data) {

  if (!data) {
    return "-";
  }

  if (data.toDate) {

    return data
      .toDate()
      .toLocaleDateString(
        "pt-BR"
      );

  }

  return "-";

}

/* =====================================================
   STATUS DO USUÁRIO
===================================================== */

function obterStatusUsuario(dadosUsuario) {

  return normalizarTexto(
    dadosUsuario?.status ||
    "pendente"
  );

}

function usuarioEstaAtivo(dadosUsuario) {

  const status =
  obterStatusUsuario(
    dadosUsuario
  );

  return (
    status === "ativo" ||
    status === "active"
  );

}

function usuarioEstaPendente(dadosUsuario) {

  const status =
  obterStatusUsuario(
    dadosUsuario
  );

  return (
    status === "pendente" ||
    status === "aguardando" ||
    status === "aguardando aprovacao" ||
    status === "aguardando aprovação"
  );

}

function usuarioEhAdministrador(dadosUsuario) {

  const perfil =
  normalizarTexto(
    dadosUsuario?.perfil
  );

  return (
    perfil === "administrador" ||
    perfil === "admin" ||
    perfil === "administrator"
  );

}

/* =====================================================
   BUSCAR OU CRIAR USUÁRIO DO SISTEMA
   Regra:
   - Só acessa se status = ativo.
   - Cadastro novo fica pendente.
   - Usuário Auth sem documento também fica pendente.
===================================================== */

async function buscarOuCriarUsuarioSistema(usuarioFirebase) {

  const email =
  String(usuarioFirebase?.email || "")
    .toLowerCase()
    .trim();

  const usuarioRef =
  doc(
    db,
    COLECAO_USUARIOS,
    usuarioFirebase.uid
  );

  const snapUsuario =
  await getDoc(
    usuarioRef
  );

  if (snapUsuario.exists()) {

    const dados =
    snapUsuario.data();

    if (!usuarioEstaAtivo(dados)) {

      await signOut(
        auth
      );

      limparSessaoLocal();

      if (usuarioEstaPendente(dados)) {

        throw {
          code: "usuario/pendente",
          message: "Seu cadastro está pendente de aprovação do administrador."
        };

      }

      throw {
        code: "usuario/inativo",
        message: "Usuário inativo. Procure o administrador."
      };

    }

    await setDoc(
      usuarioRef,
      {
        ultimoLogin:
        serverTimestamp()
      },
      {
        merge:
        true
      }
    );

    return {
      uid: usuarioFirebase.uid,
      emailAuth: email,
      ...dados
    };

  }

  const novoUsuario = {

    uid:
    usuarioFirebase.uid,

    nome:
    usuarioFirebase.displayName ||
    email ||
    "Usuário",

    email:
    email,

    perfil:
    "usuario",

    status:
    "pendente",

    criadoEm:
    serverTimestamp(),

    ultimoLogin:
    null

  };

  await setDoc(
    usuarioRef,
    novoUsuario,
    {
      merge:
      true
    }
  );

  await signOut(
    auth
  );

  limparSessaoLocal();

  throw {
    code: "usuario/pendente",
    message: "Seu cadastro foi registrado e está pendente de aprovação do administrador."
  };

}

/* =====================================================
   CADASTRAR USUÁRIO
===================================================== */

function configurarCadastro() {

  formCadastro?.addEventListener(
    "submit",
    async (event) => {

      event.preventDefault();

      limparMensagem();

      if (!verificarFirebase()) {
        return;
      }

      const nome =
      document
        .getElementById("cadastroNome")
        ?.value
        .trim();

      const email =
      document
        .getElementById("cadastroEmail")
        ?.value
        .trim()
        .toLowerCase();

      const senha =
      document
        .getElementById("cadastroSenha")
        ?.value;

      const confirmarSenha =
      document
        .getElementById("cadastroSenhaConfirmar")
        ?.value;

      if (
        !nome ||
        !email ||
        !senha ||
        !confirmarSenha
      ) {

        mostrarMensagem(
          "Preencha todos os campos.",
          "error"
        );

        return;

      }

      if (senha !== confirmarSenha) {

        mostrarMensagem(
          "As senhas não conferem.",
          "error"
        );

        return;

      }

      try {

        cadastroEmAndamento =
        true;

        const credencial =
        await createUserWithEmailAndPassword(
          auth,
          email,
          senha
        );

        await updateProfile(
          credencial.user,
          {
            displayName:
            nome
          }
        );

        await setDoc(
          doc(
            db,
            COLECAO_USUARIOS,
            credencial.user.uid
          ),
          {
            uid:
            credencial.user.uid,

            nome:
            nome,

            email:
            email,

            perfil:
            "usuario",

            status:
            "pendente",

            criadoEm:
            serverTimestamp(),

            ultimoLogin:
            null
          },
          {
            merge:
            true
          }
        );

        await signOut(
          auth
        );

        limparSessaoLocal();

        cadastroEmAndamento =
        false;

        mostrarMensagem(
          "Cadastro realizado com sucesso! Aguarde aprovação do administrador.",
          "success"
        );

        formCadastro.reset();

        setTimeout(
          () => {

            trocarTela(
              "login"
            );

          },
          1800
        );

      } catch (erro) {

        cadastroEmAndamento =
        false;

        limparSessaoLocal();

        try {

          await signOut(
            auth
          );

        } catch (erroLogout) {

          console.warn(
            "Sessão já estava encerrada.",
            erroLogout
          );

        }

        mostrarMensagem(
          traduzErro(
            erro
          ),
          "error"
        );

      }

    }
  );

}

/* =====================================================
   LOGIN
===================================================== */

function configurarLogin() {

  formLogin?.addEventListener(
    "submit",
    async (event) => {

      event.preventDefault();

      limparMensagem();

      if (!verificarFirebase()) {
        return;
      }

      const email =
      document
        .getElementById("loginEmail")
        ?.value
        .trim()
        .toLowerCase();

      const senha =
      document
        .getElementById("loginSenha")
        ?.value;

      if (
        !email ||
        !senha
      ) {

        mostrarMensagem(
          "Informe e-mail e senha.",
          "error"
        );

        return;

      }

      try {

        loginEmAndamento =
        true;

        const credencial =
        await signInWithEmailAndPassword(
          auth,
          email,
          senha
        );

        const dadosUsuario =
        await buscarOuCriarUsuarioSistema(
          credencial.user
        );

        salvarSessaoLocal(
          credencial.user,
          dadosUsuario
        );

        mostrarMensagem(
          "Login realizado com sucesso! Redirecionando...",
          "success"
        );

        redirecionarPaginaPrincipal();

      } catch (erro) {

        loginEmAndamento =
        false;

        limparSessaoLocal();

        mostrarMensagem(
          mensagemErro(
            erro
          ),
          "error"
        );

      }

    }
  );

}

/* =====================================================
   ENVIAR E-MAIL DE RECUPERAÇÃO
===================================================== */

async function enviarEmailRecuperacao(
  email,
  botao = null
) {

  limparMensagem();

  if (!verificarFirebase()) {
    return false;
  }

  const emailTratado =
  String(email || "")
    .trim()
    .toLowerCase();

  if (!emailTratado) {

    mostrarMensagem(
      "Informe o e-mail para recuperar a senha.",
      "error"
    );

    return false;

  }

  let textoOriginalBotao = "";

  try {

    if (botao) {

      textoOriginalBotao =
      botao.innerHTML;

      botao.disabled =
      true;

      botao.innerHTML =
      `
        <i class="fa-solid fa-spinner fa-spin"></i>
        Enviando...
      `;

    }

    auth.languageCode =
    "pt-BR";

    const urlRetorno =
    new URL(
      PAGINA_LOGIN,
      window.location.href
    ).href;

    await sendPasswordResetEmail(
      auth,
      emailTratado,
      {
        url:
        urlRetorno,

        handleCodeInApp:
        false
      }
    );

    mostrarMensagem(
      "E-mail de recuperação enviado. Verifique a caixa de entrada e a pasta de spam.",
      "success"
    );

    return true;

  } catch (erro) {

    mostrarMensagem(
      traduzErro(
        erro
      ),
      "error"
    );

    return false;

  } finally {

    if (botao) {

      botao.disabled =
      false;

      botao.innerHTML =
      textoOriginalBotao;

    }

  }

}

/* =====================================================
   RECUPERAÇÃO DE SENHA
===================================================== */

function configurarRecuperacaoSenha() {

  abrirRecuperacao?.addEventListener(
    "click",
    async () => {

      const emailLogin =
      document
        .getElementById("loginEmail")
        ?.value
        .trim()
        .toLowerCase() || "";

      if (emailLogin) {

        await enviarEmailRecuperacao(
          emailLogin,
          abrirRecuperacao
        );

        return;

      }

      const recuperarEmail =
      document.getElementById(
        "recuperarEmail"
      );

      if (recuperarEmail) {
        recuperarEmail.value = "";
      }

      trocarTela(
        "recuperacao"
      );

      setTimeout(
        () => {

          recuperarEmail?.focus();

        },
        150
      );

    }
  );

  formRecuperacao?.addEventListener(
    "submit",
    async (event) => {

      event.preventDefault();

      const email =
      document
        .getElementById("recuperarEmail")
        ?.value
        .trim()
        .toLowerCase();

      const botaoEnviar =
      formRecuperacao.querySelector(
        ".main-btn"
      );

      const enviado =
      await enviarEmailRecuperacao(
        email,
        botaoEnviar
      );

      if (enviado) {

        formRecuperacao.reset();

        setTimeout(
          () => {

            trocarTela(
              "login"
            );

          },
          1800
        );

      }

    }
  );

}

/* =====================================================
   USUÁRIO LOGADO
===================================================== */

function observarUsuarioLogado() {

  if (observadorConfigurado) {
    return;
  }

  observadorConfigurado =
  true;

  onAuthStateChanged(
    auth,
    async (usuario) => {

      if (usuario) {

        if (
          cadastroEmAndamento ||
          loginEmAndamento ||
          logoutFoiSolicitado()
        ) {
          return;
        }

        try {

          const dadosUsuario =
          await buscarOuCriarUsuarioSistema(
            usuario
          );

          salvarSessaoLocal(
            usuario,
            dadosUsuario
          );

          redirecionarPaginaPrincipal();

        } catch (erro) {

          limparSessaoLocal();

          authCard?.classList.remove(
            "hidden"
          );

          painelUsuario?.classList.add(
            "hidden"
          );

          areaAdmin?.classList.add(
            "hidden"
          );

          mostrarMensagem(
            mensagemErro(
              erro
            ),
            "error"
          );

        }

        return;

      }

      loginEmAndamento =
      false;

      painelUsuario?.classList.add(
        "hidden"
      );

      authCard?.classList.remove(
        "hidden"
      );

      areaAdmin?.classList.add(
        "hidden"
      );

    }
  );

}

/* =====================================================
   VERIFICAR ADMINISTRADOR
===================================================== */

async function verificarAdministrador(usuario) {

  try {

    if (!usuario) {
      return false;
    }

    const refUsuario =
    doc(
      db,
      COLECAO_USUARIOS,
      usuario.uid
    );

    const snap =
    await getDoc(
      refUsuario
    );

    if (!snap.exists()) {
      return false;
    }

    const dados =
    snap.data();

    return (
      usuarioEstaAtivo(dados) &&
      usuarioEhAdministrador(dados)
    );

  } catch (erro) {

    console.error(
      "Erro ao verificar administrador:",
      erro
    );

    return false;

  }

}

/* =====================================================
   TABELA DE USUÁRIOS
===================================================== */

function criarCelulaTexto(texto) {

  const td =
  document.createElement(
    "td"
  );

  td.textContent =
  texto || "-";

  return td;

}

function criarCelulaPerfil(perfil) {

  const td =
  document.createElement(
    "td"
  );

  const span =
  document.createElement(
    "span"
  );

  span.className =
  "badge";

  span.textContent =
  perfil || "usuario";

  td.appendChild(
    span
  );

  return td;

}

function mostrarMensagemUsuarios(texto) {

  if (!listaUsuarios) {
    return;
  }

  listaUsuarios.innerHTML = "";

  const tr =
  document.createElement(
    "tr"
  );

  const td =
  document.createElement(
    "td"
  );

  td.colSpan =
  4;

  td.textContent =
  texto;

  tr.appendChild(
    td
  );

  listaUsuarios.appendChild(
    tr
  );

}

/* =====================================================
   CARREGAR USUÁRIOS
===================================================== */

async function carregarUsuarios() {

  if (!listaUsuarios) {
    return;
  }

  mostrarMensagemUsuarios(
    "Carregando usuários..."
  );

  try {

    const consulta =
    query(
      collection(
        db,
        COLECAO_USUARIOS
      ),
      orderBy(
        "criadoEm",
        "desc"
      )
    );

    const snapshot =
    await getDocs(
      consulta
    );

    if (snapshot.empty) {

      mostrarMensagemUsuarios(
        "Nenhum usuário cadastrado."
      );

      return;

    }

    listaUsuarios.innerHTML =
    "";

    snapshot.forEach((item) => {

      const usuario =
      item.data();

      const tr =
      document.createElement(
        "tr"
      );

      tr.appendChild(
        criarCelulaTexto(
          usuario.nome || "-"
        )
      );

      tr.appendChild(
        criarCelulaTexto(
          usuario.email || "-"
        )
      );

      tr.appendChild(
        criarCelulaPerfil(
          usuario.perfil || "usuario"
        )
      );

      tr.appendChild(
        criarCelulaTexto(
          formatarData(
            usuario.criadoEm
          )
        )
      );

      listaUsuarios.appendChild(
        tr
      );

    });

  } catch (erro) {

    console.error(
      "Erro ao carregar usuários:",
      erro
    );

    mostrarMensagemUsuarios(
      "Não foi possível carregar os usuários."
    );

  }

}

/* =====================================================
   SAIR
===================================================== */

function configurarSair() {

  btnSair?.addEventListener(
    "click",
    async () => {

      sessionStorage.setItem(
        "logoutManual",
        "sim"
      );

      limparSessaoLocal();

      try {

        await signOut(
          auth
        );

      } catch (erro) {

        console.warn(
          "Erro ao encerrar sessão:",
          erro
        );

      }

      window.location.replace(
        `${PAGINA_LOGIN}?sair=1`
      );

    }
  );

}

/* =====================================================
   LOGOUT INICIAL
===================================================== */

async function tratarLogoutInicial() {

  if (!logoutFoiSolicitado()) {
    return;
  }

  limparSessaoLocal();

  try {

    await signOut(
      auth
    );

  } catch (error) {

    console.warn(
      "Sessão Firebase já estava encerrada.",
      error
    );

  }

  sessionStorage.removeItem(
    "logoutManual"
  );

  if (window.history.replaceState) {

    window.history.replaceState(
      {},
      document.title,
      PAGINA_LOGIN
    );

  }

}

/* =====================================================
   INICIAR
===================================================== */

async function iniciar() {

  try {

    firebasePronto =
    true;

    auth.languageCode =
    "pt-BR";

    trocarTela(
      "login"
    );

    configurarAbas();

    configurarMostrarSenha();

    configurarCadastro();

    configurarLogin();

    configurarRecuperacaoSenha();

    configurarSair();

    await tratarLogoutInicial();

    observarUsuarioLogado();

  } catch (erro) {

    firebasePronto =
    false;

    console.error(
      "Erro ao iniciar login:",
      erro
    );

    mostrarMensagem(
      "Erro ao carregar Firebase. Verifique o arquivo firebaseConfig.js.",
      "error"
    );

  }

}

iniciar();