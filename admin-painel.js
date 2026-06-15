/* =====================================================
   ADMIN PAINEL - USUÁRIOS DO SISTEMA
===================================================== */

import {
  db
} from "./firebaseConfig.js";

import {
  protegerPagina,
  sairDoSistema
} from "./authGuard.js";

import {
  collection,
  getDocs,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  query,
  where,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.3/firebase-firestore.js";

/* =====================================================
   CONFIGURAÇÃO
===================================================== */

const COLECAO_USUARIOS =
"usuariosSistema";

const TELA_DASHBOARD =
"./dashboard.html";

/* =====================================================
   VARIÁVEIS
===================================================== */

let usuariosSistema = [];

let usuarioLogadoGlobal = null;

let usuarioEditandoId = null;

/* =====================================================
   ELEMENTOS
===================================================== */

function buscarElemento(ids) {

  for (const id of ids) {

    const elemento =
    document.getElementById(id);

    if (elemento) {
      return elemento;
    }

  }

  return null;

}

const inputNome =
buscarElemento([
  "nome",
  "nomeUsuario",
  "inputNome",
  "usuarioNome"
]);

const inputEmail =
buscarElemento([
  "email",
  "emailUsuario",
  "inputEmail",
  "usuarioEmail"
]);

const selectPerfil =
buscarElemento([
  "perfil",
  "perfilUsuario",
  "selectPerfil",
  "usuarioPerfil"
]);

const selectStatus =
buscarElemento([
  "status",
  "statusUsuario",
  "selectStatus",
  "usuarioStatus"
]);

const checkAtivo =
buscarElemento([
  "ativo",
  "statusAtivo",
  "usuarioAtivo",
  "checkAtivo"
]);

const btnSalvar =
buscarElemento([
  "btnSalvarPerfil",
  "btnSalvarUsuario",
  "btnSalvar",
  "salvarPerfil",
  "salvarUsuario"
]);

const tbodyUsuarios =
buscarElemento([
  "tbodyUsuarios",
  "listaUsuarios",
  "usuariosBody",
  "tabelaUsuarios"
]);

const filtroPerfil =
buscarElemento([
  "filtroPerfil",
  "selectFiltroPerfil",
  "perfilFiltro"
]);

const filtroStatus =
buscarElemento([
  "filtroStatus",
  "selectFiltroStatus",
  "statusFiltro"
]);

const btnAtualizar =
buscarElemento([
  "btnAtualizar",
  "btnAtualizarUsuarios",
  "atualizarUsuarios"
]);

const btnLimpar =
buscarElemento([
  "btnLimpar",
  "btnCancelar",
  "btnNovoUsuario",
  "limparFormulario"
]);

const btnVoltarDashboard =
buscarElemento([
  "btnVoltarDashboard",
  "btnVoltar",
  "voltarDashboard"
]);

const btnSair =
buscarElemento([
  "btnSair",
  "btnSairSistema",
  "sairSistema"
]);

/* =====================================================
   TEXTO
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

/* =====================================================
   DATA
===================================================== */

function formatarData(data) {

  if (!data) {
    return "-";
  }

  let dt;

  if (data?.toDate) {

    dt =
    data.toDate();

  } else {

    dt =
    new Date(data);

  }

  if (Number.isNaN(dt.getTime())) {
    return "-";
  }

  return dt.toLocaleString(
    "pt-BR"
  );

}

/* =====================================================
   VERIFICAÇÕES
===================================================== */

function usuarioEhAdministrador(usuario) {

  const perfil =
  normalizarTexto(
    usuario?.perfil
  );

  return (
    perfil === "administrador" ||
    perfil === "administrator" ||
    perfil === "admin"
  );

}

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

function usuarioEstaInativo(usuario) {

  const status =
  obterStatusUsuario(usuario);

  return (
    status === "inativo" ||
    status === "inactive" ||
    status === "bloqueado" ||
    status === "desativado"
  );

}

function mesmoUsuarioLogado(usuario) {

  return (
    usuarioLogadoGlobal?.id === usuario.id ||
    usuarioLogadoGlobal?.uid === usuario.uid ||
    emailNormalizado(
      usuarioLogadoGlobal?.email ||
      usuarioLogadoGlobal?.emailAuth
    ) === emailNormalizado(usuario.email)
  );

}

function obterRotuloStatus(usuario) {

  if (usuarioEstaAtivo(usuario)) {
    return "Ativo";
  }

  if (usuarioEstaPendente(usuario)) {
    return "Pendente";
  }

  if (usuarioEstaInativo(usuario)) {
    return "Inativo";
  }

  return usuario.status || "Pendente";

}

function obterClasseStatus(usuario) {

  if (usuarioEstaAtivo(usuario)) {
    return "status-ativo";
  }

  if (usuarioEstaPendente(usuario)) {
    return "status-pendente";
  }

  return "status-inativo";

}

/* =====================================================
   TABELA SEGURA
===================================================== */

function criarCelulaTexto(texto) {

  const td =
  document.createElement("td");

  td.textContent =
  texto || "-";

  return td;

}

function criarCelulaStatus(usuario) {

  const td =
  document.createElement("td");

  const span =
  document.createElement("span");

  span.className =
  obterClasseStatus(usuario);

  span.textContent =
  obterRotuloStatus(usuario);

  td.appendChild(span);

  return td;

}

function criarBotao(texto, classe, acao) {

  const botao =
  document.createElement("button");

  botao.type =
  "button";

  botao.className =
  classe;

  botao.textContent =
  texto;

  botao.addEventListener(
    "click",
    acao
  );

  return botao;

}

function criarCelulaAcoes(usuario) {

  const td =
  document.createElement("td");

  td.className =
  "acoes-usuario";

  const btnEditar =
  criarBotao(
    "Editar",
    "btn-acao",
    () => editarUsuario(usuario.id)
  );

  td.appendChild(btnEditar);

  if (usuarioEstaPendente(usuario)) {

    const btnAprovar =
    criarBotao(
      "Aprovar",
      "btn-acao success",
      () => aprovarUsuario(usuario.id)
    );

    td.appendChild(btnAprovar);

  }

  const btnStatus =
  criarBotao(
    usuarioEstaAtivo(usuario) ? "Inativar" : "Ativar",
    usuarioEstaAtivo(usuario) ? "btn-acao warning" : "btn-acao success",
    () => alternarStatusUsuario(usuario.id)
  );

  const btnExcluir =
  criarBotao(
    "Excluir",
    "btn-acao danger",
    () => excluirUsuario(usuario.id)
  );

  td.appendChild(btnStatus);
  td.appendChild(btnExcluir);

  return td;

}

function mostrarMensagemTabela(mensagem) {

  if (!tbodyUsuarios) {
    return;
  }

  tbodyUsuarios.innerHTML = "";

  const tr =
  document.createElement("tr");

  const td =
  document.createElement("td");

  td.colSpan =
  6;

  td.textContent =
  mensagem;

  tr.appendChild(td);

  tbodyUsuarios.appendChild(tr);

}

/* =====================================================
   BOTÃO SALVAR
===================================================== */

function definirTextoBotaoSalvar(texto) {

  if (!btnSalvar) {
    return;
  }

  btnSalvar.textContent =
  texto;

}

/* =====================================================
   LIMPAR FORMULÁRIO
===================================================== */

function limparFormulario() {

  usuarioEditandoId =
  null;

  if (inputNome) {
    inputNome.value = "";
  }

  if (inputEmail) {
    inputEmail.value = "";
    inputEmail.disabled = false;
  }

  if (selectPerfil) {
    selectPerfil.value = "";
  }

  if (selectStatus) {
    selectStatus.value = "ativo";
  }

  if (checkAtivo) {
    checkAtivo.checked = true;
  }

  definirTextoBotaoSalvar(
    "Salvar perfil"
  );

}

/* =====================================================
   VALIDAR FORMULÁRIO
===================================================== */

function obterStatusFormulario() {

  if (selectStatus) {

    const status =
    normalizarTexto(
      selectStatus.value
    );

    if (
      status === "pendente" ||
      status === "ativo" ||
      status === "inativo"
    ) {
      return status;
    }

  }

  return checkAtivo?.checked
  ? "ativo"
  : "inativo";

}

function validarFormulario() {

  const nome =
  inputNome?.value.trim();

  const email =
  emailNormalizado(
    inputEmail?.value
  );

  const perfil =
  selectPerfil?.value;

  const status =
  obterStatusFormulario();

  if (!nome) {

    alert(
      "Informe o nome do usuário."
    );

    inputNome?.focus();

    return null;

  }

  if (!email) {

    alert(
      "Informe o e-mail do usuário."
    );

    inputEmail?.focus();

    return null;

  }

  if (!perfil) {

    alert(
      "Selecione o perfil do usuário."
    );

    selectPerfil?.focus();

    return null;

  }

  return {
    nome,
    email,
    perfil,
    status
  };

}

/* =====================================================
   EMAIL DUPLICADO
===================================================== */

async function emailJaExiste(email, ignorarId = null) {

  const qEmail =
  query(

    collection(
      db,
      COLECAO_USUARIOS
    ),

    where(
      "email",
      "==",
      emailNormalizado(email)
    )

  );

  const snapshot =
  await getDocs(qEmail);

  let existe =
  false;

  snapshot.forEach((docUsuario) => {

    if (docUsuario.id !== ignorarId) {
      existe = true;
    }

  });

  return existe;

}

/* =====================================================
   SALVAR USUÁRIO
===================================================== */

async function salvarPerfilUsuario() {

  const dadosFormulario =
  validarFormulario();

  if (!dadosFormulario) {
    return;
  }

  if (
    !usuarioLogadoGlobal ||
    !usuarioEhAdministrador(usuarioLogadoGlobal)
  ) {

    alert(
      "Apenas administradores podem salvar usuários."
    );

    return;

  }

  try {

    const existeEmail =
    await emailJaExiste(
      dadosFormulario.email,
      usuarioEditandoId
    );

    if (existeEmail) {

      alert(
        "Já existe um usuário cadastrado com este e-mail."
      );

      return;

    }

    if (usuarioEditandoId) {

      const usuarioAtual =
      usuariosSistema.find(
        item => item.id === usuarioEditandoId
      );

      if (
        usuarioAtual &&
        mesmoUsuarioLogado(usuarioAtual) &&
        dadosFormulario.status !== "ativo"
      ) {

        alert(
          "Você não pode alterar o status do próprio usuário administrador logado."
        );

        return;

      }

      await updateDoc(

        doc(
          db,
          COLECAO_USUARIOS,
          usuarioEditandoId
        ),

        {
          ...dadosFormulario,

          atualizadoEm:
          serverTimestamp(),

          atualizadoPorUid:
          usuarioLogadoGlobal.uid || "",

          atualizadoPorEmail:
          usuarioLogadoGlobal.email || usuarioLogadoGlobal.emailAuth || "",

          atualizadoPorNome:
          usuarioLogadoGlobal.nome || ""
        }

      );

      alert(
        "Perfil atualizado com sucesso!"
      );

    } else {

      const docRef =
      await addDoc(

        collection(
          db,
          COLECAO_USUARIOS
        ),

        {
          ...dadosFormulario,

          uid:
          "",

          criadoPorUid:
          usuarioLogadoGlobal.uid || "",

          criadoPorEmail:
          usuarioLogadoGlobal.email || usuarioLogadoGlobal.emailAuth || "",

          criadoPorNome:
          usuarioLogadoGlobal.nome || "",

          criadoEm:
          serverTimestamp(),

          atualizadoEm:
          serverTimestamp(),

          ultimoLogin:
          null
        }

      );

      await updateDoc(

        doc(
          db,
          COLECAO_USUARIOS,
          docRef.id
        ),

        {
          uid:
          docRef.id,

          atualizadoEm:
          serverTimestamp()
        }

      );

      alert(
        "Perfil cadastrado com sucesso!"
      );

    }

    limparFormulario();

    await carregarUsuarios();

  } catch (error) {

    console.error(
      "Erro ao salvar perfil:",
      error
    );

    alert(
      "Erro ao salvar perfil do usuário. Verifique as permissões do Firestore."
    );

  }

}

/* =====================================================
   CARREGAR USUÁRIOS
===================================================== */

async function carregarUsuarios() {

  try {

    mostrarMensagemTabela(
      "Carregando usuários..."
    );

    usuariosSistema = [];

    const snapshot =
    await getDocs(
      collection(
        db,
        COLECAO_USUARIOS
      )
    );

    snapshot.forEach((docUsuario) => {

      usuariosSistema.push({
        id: docUsuario.id,
        ...docUsuario.data()
      });

    });

    usuariosSistema.sort((a, b) => {

      const statusA =
      usuarioEstaPendente(a) ? 0 : usuarioEstaAtivo(a) ? 1 : 2;

      const statusB =
      usuarioEstaPendente(b) ? 0 : usuarioEstaAtivo(b) ? 1 : 2;

      if (statusA !== statusB) {
        return statusA - statusB;
      }

      return String(a.nome || "")
        .localeCompare(
          String(b.nome || ""),
          "pt-BR"
        );

    });

    renderizarUsuarios();

  } catch (error) {

    console.error(
      "Erro ao carregar usuários:",
      error
    );

    mostrarMensagemTabela(
      "Erro ao carregar usuários."
    );

  }

}

/* =====================================================
   FILTRAR USUÁRIOS
===================================================== */

function obterUsuariosFiltrados() {

  let lista =
  [...usuariosSistema];

  const perfilFiltro =
  normalizarTexto(
    filtroPerfil?.value
  );

  const statusFiltro =
  normalizarTexto(
    filtroStatus?.value
  );

  if (
    perfilFiltro &&
    perfilFiltro !== "todos" &&
    perfilFiltro !== "todas"
  ) {

    lista =
    lista.filter((usuario) => {

      return normalizarTexto(usuario.perfil) ===
      perfilFiltro;

    });

  }

  if (
    statusFiltro &&
    statusFiltro !== "todos" &&
    statusFiltro !== "todas"
  ) {

    lista =
    lista.filter((usuario) => {

      if (statusFiltro === "ativo") {
        return usuarioEstaAtivo(usuario);
      }

      if (statusFiltro === "pendente") {
        return usuarioEstaPendente(usuario);
      }

      if (statusFiltro === "inativo") {
        return usuarioEstaInativo(usuario);
      }

      return normalizarTexto(usuario.status) ===
      statusFiltro;

    });

  }

  return lista;

}

/* =====================================================
   RENDERIZAR USUÁRIOS
===================================================== */

function renderizarUsuarios() {

  if (!tbodyUsuarios) {
    return;
  }

  const lista =
  obterUsuariosFiltrados();

  tbodyUsuarios.innerHTML = "";

  if (lista.length === 0) {

    mostrarMensagemTabela(
      "Nenhum usuário encontrado."
    );

    return;

  }

  lista.forEach((usuario) => {

    const tr =
    document.createElement("tr");

    if (usuarioEstaPendente(usuario)) {

      tr.classList.add(
        "linha-pendente"
      );

    }

    tr.appendChild(
      criarCelulaTexto(usuario.nome)
    );

    tr.appendChild(
      criarCelulaTexto(usuario.email)
    );

    tr.appendChild(
      criarCelulaTexto(usuario.perfil)
    );

    tr.appendChild(
      criarCelulaStatus(usuario)
    );

    tr.appendChild(
      criarCelulaTexto(
        formatarData(usuario.ultimoLogin)
      )
    );

    tr.appendChild(
      criarCelulaAcoes(usuario)
    );

    tbodyUsuarios.appendChild(tr);

  });

}

/* =====================================================
   EDITAR USUÁRIO
===================================================== */

function editarUsuario(id) {

  const usuario =
  usuariosSistema.find(
    item => item.id === id
  );

  if (!usuario) {
    return;
  }

  usuarioEditandoId =
  id;

  if (inputNome) {
    inputNome.value =
    usuario.nome || "";
  }

  if (inputEmail) {

    inputEmail.value =
    usuario.email || "";

    inputEmail.disabled =
    false;

  }

  if (selectPerfil) {
    selectPerfil.value =
    usuario.perfil || "usuario";
  }

  if (selectStatus) {

    if (usuarioEstaAtivo(usuario)) {
      selectStatus.value = "ativo";
    } else if (usuarioEstaPendente(usuario)) {
      selectStatus.value = "pendente";
    } else {
      selectStatus.value = "inativo";
    }

  }

  if (checkAtivo) {

    checkAtivo.checked =
    usuarioEstaAtivo(usuario);

  }

  definirTextoBotaoSalvar(
    "Atualizar perfil"
  );

  window.scrollTo({
    top: 0,
    behavior: "smooth"
  });

}

/* =====================================================
   APROVAR USUÁRIO
===================================================== */

async function aprovarUsuario(id) {

  const usuario =
  usuariosSistema.find(
    item => item.id === id
  );

  if (!usuario) {
    return;
  }

  if (mesmoUsuarioLogado(usuario)) {

    alert(
      "Você não pode aprovar ou alterar o próprio usuário logado por esta ação."
    );

    return;

  }

  const confirmar =
  confirm(
    `Deseja aprovar o acesso de ${usuario.nome || usuario.email || "este usuário"}?`
  );

  if (!confirmar) {
    return;
  }

  try {

    await updateDoc(

      doc(
        db,
        COLECAO_USUARIOS,
        id
      ),

      {
        status:
        "ativo",

        aprovadoEm:
        serverTimestamp(),

        aprovadoPorUid:
        usuarioLogadoGlobal.uid || "",

        aprovadoPorEmail:
        usuarioLogadoGlobal.email || usuarioLogadoGlobal.emailAuth || "",

        aprovadoPorNome:
        usuarioLogadoGlobal.nome || "",

        atualizadoEm:
        serverTimestamp()
      }

    );

    alert(
      "Usuário aprovado com sucesso!"
    );

    await carregarUsuarios();

  } catch (error) {

    console.error(
      "Erro ao aprovar usuário:",
      error
    );

    alert(
      "Erro ao aprovar usuário."
    );

  }

}

/* =====================================================
   ALTERAR STATUS
===================================================== */

async function alternarStatusUsuario(id) {

  const usuario =
  usuariosSistema.find(
    item => item.id === id
  );

  if (!usuario) {
    return;
  }

  if (mesmoUsuarioLogado(usuario)) {

    alert(
      "Você não pode alterar o status do próprio usuário administrador logado."
    );

    return;

  }

  let novoStatus = "ativo";

  if (usuarioEstaAtivo(usuario)) {
    novoStatus = "inativo";
  }

  if (usuarioEstaPendente(usuario)) {
    novoStatus = "ativo";
  }

  const confirmar =
  confirm(
    `Deseja realmente ${novoStatus === "ativo" ? "ativar/aprovar" : "inativar"} este usuário?`
  );

  if (!confirmar) {
    return;
  }

  try {

    const payload = {
      status:
      novoStatus,

      atualizadoEm:
      serverTimestamp(),

      atualizadoPorUid:
      usuarioLogadoGlobal.uid || "",

      atualizadoPorEmail:
      usuarioLogadoGlobal.email || usuarioLogadoGlobal.emailAuth || "",

      atualizadoPorNome:
      usuarioLogadoGlobal.nome || ""
    };

    if (
      novoStatus === "ativo" &&
      usuarioEstaPendente(usuario)
    ) {

      payload.aprovadoEm =
      serverTimestamp();

      payload.aprovadoPorUid =
      usuarioLogadoGlobal.uid || "";

      payload.aprovadoPorEmail =
      usuarioLogadoGlobal.email || usuarioLogadoGlobal.emailAuth || "";

      payload.aprovadoPorNome =
      usuarioLogadoGlobal.nome || "";

    }

    await updateDoc(

      doc(
        db,
        COLECAO_USUARIOS,
        id
      ),

      payload

    );

    await carregarUsuarios();

  } catch (error) {

    console.error(
      "Erro ao alterar status:",
      error
    );

    alert(
      "Erro ao alterar status do usuário."
    );

  }

}

/* =====================================================
   EXCLUIR USUÁRIO
===================================================== */

async function excluirUsuario(id) {

  const usuario =
  usuariosSistema.find(
    item => item.id === id
  );

  if (!usuario) {
    return;
  }

  if (mesmoUsuarioLogado(usuario)) {

    alert(
      "Você não pode excluir o próprio usuário administrador logado."
    );

    return;

  }

  const confirmar =
  confirm(
    "Deseja realmente excluir este usuário do painel?"
  );

  if (!confirmar) {
    return;
  }

  try {

    await deleteDoc(

      doc(
        db,
        COLECAO_USUARIOS,
        id
      )

    );

    await carregarUsuarios();

  } catch (error) {

    console.error(
      "Erro ao excluir usuário:",
      error
    );

    alert(
      "Erro ao excluir usuário."
    );

  }

}

/* =====================================================
   VOLTAR DASHBOARD
===================================================== */

function configurarBotaoVoltar() {

  if (!btnVoltarDashboard) {
    return;
  }

  btnVoltarDashboard.addEventListener(
    "click",
    () => {

      window.location.href =
      TELA_DASHBOARD;

    }
  );

}

/* =====================================================
   SAIR
===================================================== */

function configurarBotaoSair() {

  if (!btnSair) {
    return;
  }

  btnSair.addEventListener(
    "click",
    async () => {

      const confirmar =
      confirm(
        "Deseja realmente sair do sistema?"
      );

      if (!confirmar) {
        return;
      }

      await sairDoSistema();

    }
  );

}

/* =====================================================
   EVENTOS
===================================================== */

function configurarEventos() {

  btnSalvar?.addEventListener(
    "click",
    salvarPerfilUsuario
  );

  btnAtualizar?.addEventListener(
    "click",
    carregarUsuarios
  );

  btnLimpar?.addEventListener(
    "click",
    limparFormulario
  );

  filtroPerfil?.addEventListener(
    "change",
    renderizarUsuarios
  );

  filtroStatus?.addEventListener(
    "change",
    renderizarUsuarios
  );

  configurarBotaoVoltar();

  configurarBotaoSair();

}

/* =====================================================
   INIT
===================================================== */

document.addEventListener(
  "DOMContentLoaded",
  async () => {

    try {

      usuarioLogadoGlobal =
      await protegerPagina({
        adminOnly: true
      });

      configurarEventos();

      await carregarUsuarios();

    } catch (error) {

      console.error(
        "Erro ao iniciar painel admin:",
        error
      );

      alert(
        "Erro ao iniciar o painel administrativo."
      );

    }

  }
);