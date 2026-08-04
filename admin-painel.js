/* =====================================================
   ADMIN PAINEL - USUÁRIOS DO SISTEMA
   Arquivo: admin-painel.js
   Versão: v007

   Perfis oficiais:
   - Administrador Geral
   - Planejador
   - Usuário

   Correções:
   - Administrador Geral pode rebaixar outro administrador.
   - E-mails oficiais podem ser rebaixados quando adminRebaixado = true.
   - O próprio administrador logado não pode rebaixar a si mesmo.
   - Exclusão remove todos os registros do mesmo e-mail em usuariosSistema.
===================================================== */

import {
  db,
  app
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
  doc,
  query,
  where,
  writeBatch,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.3/firebase-firestore.js";

import {
  getFunctions,
  httpsCallable
} from "https://www.gstatic.com/firebasejs/10.12.3/firebase-functions.js";

const functions = getFunctions(app, "us-central1");

/* =====================================================
   CONFIGURAÇÃO
===================================================== */

const COLECAO_USUARIOS =
  "usuariosSistema";

const TELA_DASHBOARD =
  "./dashboard.html";

/*
  SEGURANÇA: lista fixa de e-mails admin removida (ficava exposta
  via "Ver código-fonte"). Perfil salvo no Firestore é a única
  fonte de verdade — ver authGuard.js / functions/index.js.
*/

const PERFIS_VALIDOS = [
  "administrador",
  "planejador",
  "usuario"
];

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

const usuarioLogadoInfo =
  buscarElemento([
    "usuarioLogadoInfo"
  ]);

const usuarioEmailTopo =
  buscarElemento([
    "usuarioEmailTopo"
  ]);

const usuarioPerfilTopo =
  buscarElemento([
    "usuarioPerfilTopo"
  ]);

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

const selectRegional =
  buscarElemento([
    "regionalUsuario",
    "regional",
    "selectRegional",
    "usuarioRegional"
  ]);

const checkPodeAprovarRM =
  buscarElemento([
    "podeAprovarRM",
    "checkPodeAprovarRM",
    "usuarioPodeAprovarRM"
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

const filtroRegional =
  buscarElemento([
    "filtroRegional",
    "selectFiltroRegional",
    "regionalFiltro"
  ]);

const filtroAprovacaoRM =
  buscarElemento([
    "filtroAprovacaoRM",
    "selectFiltroAprovacaoRM",
    "aprovacaoRMFiltro"
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
    dt = data.toDate();
  } else {
    dt = new Date(data);
  }

  if (Number.isNaN(dt.getTime())) {
    return "-";
  }

  return dt.toLocaleString("pt-BR");
}

/* =====================================================
   PERFIL / STATUS / PERMISSÕES
===================================================== */

function normalizarPerfilSistema(perfil) {
  const perfilNormalizado =
    normalizarTexto(perfil);

  if (
    perfilNormalizado === "administrador" ||
    perfilNormalizado === "admin" ||
    perfilNormalizado === "adm" ||
    perfilNormalizado === "administrator" ||
    perfilNormalizado === "administrador geral"
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

  return perfilNormalizado || "usuario";
}

function perfilEhValido(perfil) {
  return PERFIS_VALIDOS.includes(
    normalizarPerfilSistema(perfil)
  );
}

function obterEmailUsuario(usuario) {
  return emailNormalizado(
    usuario?.email ||
    usuario?.emailAuth ||
    usuario?.usuarioEmail ||
    usuario?.login ||
    ""
  );
}

/*
  Esta função antes comparava com uma lista fixa de e-mails.
  Removemos a lista (ela expunha e-mails pessoais no código do
  cliente). A partir de agora não existe mais "e-mail oficial de
  admin" — a promoção a administrador é feita só pelo campo
  "perfil" no Firestore. Mantemos a função (sempre retornando
  false) apenas para não quebrar os pontos do formulário que a
  chamam; o campo "adminRebaixado" também se torna sempre falso.
*/
function emailStringEhAdministradorGeral() {
  return false;
}

function obterPerfilEfetivo(usuario) {
  const perfilSalvo =
    normalizarPerfilSistema(
      usuario?.perfil
    );

  return perfilSalvo;
}

function usuarioEhAdministrador(usuario) {
  return obterPerfilEfetivo(usuario) === "administrador";
}

function usuarioPodeAprovarRM(usuario) {
  return usuarioEhAdministrador(usuario);
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
    obterEmailUsuario(usuarioLogadoGlobal) === obterEmailUsuario(usuario)
  );
}

function obterRotuloPerfil(perfil, usuario = null) {
  const perfilFinal =
    usuario
      ? obterPerfilEfetivo(usuario)
      : normalizarPerfilSistema(perfil);

  const mapa = {
    administrador: "Administrador Geral",
    planejador: "Planejador",
    usuario: "Usuário"
  };

  return mapa[perfilFinal] || "Usuário";
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

function obterRegionalUsuario(usuario) {
  return usuario?.regional || "";
}

function obterRotuloRegional(usuario) {
  const regional =
    obterRegionalUsuario(usuario);

  return regional || "Sem Regional";
}

function obterRotuloAprovacaoRM(usuario) {
  if (usuarioEhAdministrador(usuario)) {
    return "Administrador";
  }

  return "Não";
}

function obterClasseAprovacaoRM(usuario) {
  if (usuarioEhAdministrador(usuario)) {
    return "status-ativo";
  }

  return "status-inativo";
}

function obterEmailUsuarioLogado() {
  return obterEmailUsuario(
    usuarioLogadoGlobal
  );
}

function exibirUsuarioLogadoNoTopo() {
  const email =
    obterEmailUsuarioLogado() ||
    "Email não identificado";

  const perfil =
    obterRotuloPerfil(
      usuarioLogadoGlobal?.perfil,
      usuarioLogadoGlobal
    );

  if (usuarioEmailTopo) {
    usuarioEmailTopo.textContent =
      email;
  }

  if (usuarioPerfilTopo) {
    usuarioPerfilTopo.textContent =
      perfil;
  }

  if (usuarioLogadoInfo) {
    usuarioLogadoInfo.classList.toggle(
      "perfil-administrador",
      usuarioEhAdministrador(usuarioLogadoGlobal)
    );
  }
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

function criarCelulaAprovacaoRM(usuario) {
  const td =
    document.createElement("td");

  const span =
    document.createElement("span");

  span.className =
    obterClasseAprovacaoRM(usuario);

  span.textContent =
    obterRotuloAprovacaoRM(usuario);

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

  if (!usuarioEhAdministrador(usuarioLogadoGlobal)) {
    td.textContent = "-";
    return td;
  }

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
    8;

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

  btnSalvar.innerHTML =
    `<i class="fa-solid fa-floppy-disk"></i> ${texto}`;
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
    selectPerfil.disabled = false;
  }

  if (selectStatus) {
    selectStatus.value = "ativo";
  }

  if (selectRegional) {
    selectRegional.value = "";
  }

  if (checkPodeAprovarRM) {
    checkPodeAprovarRM.checked = false;
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
    normalizarPerfilSistema(
      selectPerfil?.value
    );

  const status =
    obterStatusFormulario();

  let regional =
    selectRegional?.value || "";

  let podeAprovarRM =
    Boolean(checkPodeAprovarRM?.checked);

  const emailAdminOficial =
    emailStringEhAdministradorGeral(email);

  const adminRebaixado =
    emailAdminOficial &&
    perfil !== "administrador";

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

  if (!perfil || !perfilEhValido(perfil)) {
    alert(
      "Selecione um perfil válido: Administrador Geral, Planejador ou Usuário."
    );

    selectPerfil?.focus();

    return null;
  }

  if (perfil === "administrador") {
    regional =
      regional || "Todas";

    podeAprovarRM =
      true;
  }

  if (
    perfil !== "administrador" &&
    regional === "Todas"
  ) {
    alert(
      "Somente Administrador Geral pode usar a Regional Todas."
    );

    selectRegional?.focus();

    return null;
  }

  if (perfil !== "administrador") {
    podeAprovarRM =
      false;
  }

  return {
    nome,
    email,
    perfil,
    status,
    regional,
    podeAprovarRM,
    adminRebaixado
  };
}

/* =====================================================
   CONSULTA / DUPLICIDADE POR E-MAIL
===================================================== */

async function consultarDocumentosUsuarioPorEmail(email) {
  const emailFinal =
    emailNormalizado(email);

  const documentosMap =
    new Map();

  if (!emailFinal) {
    return [];
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
            emailFinal
          )
        );

      const snapshot =
        await getDocs(consulta);

      snapshot.forEach((docUsuario) => {
        documentosMap.set(
          docUsuario.id,
          docUsuario
        );
      });
    } catch (error) {
      console.warn(
        `Consulta ignorada em usuariosSistema.${campo}:`,
        error
      );
    }
  }

  return Array.from(
    documentosMap.values()
  );
}

async function emailJaExiste(email, ignorarId = null) {
  const documentos =
    await consultarDocumentosUsuarioPorEmail(email);

  return documentos.some((docUsuario) => {
    return docUsuario.id !== ignorarId;
  });
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
      "Apenas Administrador Geral pode salvar usuários."
    );

    return;
  }

  try {
    if (btnSalvar) {
      btnSalvar.disabled = true;
      definirTextoBotaoSalvar("Salvando...");
    }

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

      if (
        usuarioAtual &&
        mesmoUsuarioLogado(usuarioAtual) &&
        dadosFormulario.perfil !== "administrador"
      ) {
        alert(
          "Você não pode rebaixar o próprio usuário logado. Peça para outro Administrador Geral fazer essa alteração."
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
          nome:
            dadosFormulario.nome,

          email:
            dadosFormulario.email,

          perfil:
            dadosFormulario.perfil,

          status:
            dadosFormulario.status,

          regional:
            dadosFormulario.regional,

          podeAprovarRM:
            dadosFormulario.podeAprovarRM,

          adminRebaixado:
            dadosFormulario.adminRebaixado,

          atualizadoEm:
            serverTimestamp(),

          atualizadoPorUid:
            usuarioLogadoGlobal.uid || "",

          atualizadoPorEmail:
            obterEmailUsuario(usuarioLogadoGlobal),

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
            nome:
              dadosFormulario.nome,

            email:
              dadosFormulario.email,

            perfil:
              dadosFormulario.perfil,

            status:
              dadosFormulario.status,

            regional:
              dadosFormulario.regional,

            podeAprovarRM:
              dadosFormulario.podeAprovarRM,

            adminRebaixado:
              dadosFormulario.adminRebaixado,

            uid:
              "",

            criadoPorUid:
              usuarioLogadoGlobal.uid || "",

            criadoPorEmail:
              obterEmailUsuario(usuarioLogadoGlobal),

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
  } finally {
    if (btnSalvar) {
      btnSalvar.disabled = false;
      definirTextoBotaoSalvar("Salvar perfil");
    }
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

    atualizarAvisoUsuariosPendentes();
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

function atualizarAvisoUsuariosPendentes() {
  const aviso = document.getElementById("avisoUsuariosPendentes");
  const texto = document.getElementById("textoAvisoUsuariosPendentes");

  if (!aviso || !texto) {
    return;
  }

  const pendentes = usuariosSistema.filter(usuarioEstaPendente);

  if (pendentes.length === 0) {
    aviso.style.display = "none";
    return;
  }

  const nomes = pendentes
    .map((usuario) => usuario.nome || usuario.email || "usuário sem nome")
    .join(", ");

  texto.textContent =
    pendentes.length === 1
      ? `1 usuário aguardando aprovação: ${nomes}`
      : `${pendentes.length} usuários aguardando aprovação: ${nomes}`;

  aviso.style.display = "flex";
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

  const regionalFiltro =
    filtroRegional?.value || "todos";

  const aprovacaoRMFiltro =
    filtroAprovacaoRM?.value || "todos";

  if (
    perfilFiltro &&
    perfilFiltro !== "todos" &&
    perfilFiltro !== "todas"
  ) {
    lista =
      lista.filter((usuario) => {
        return obterPerfilEfetivo(usuario) ===
          normalizarPerfilSistema(perfilFiltro);
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

  if (
    regionalFiltro &&
    regionalFiltro !== "todos" &&
    regionalFiltro !== "todas"
  ) {
    lista =
      lista.filter((usuario) => {
        return obterRegionalUsuario(usuario) ===
          regionalFiltro;
      });
  }

  if (aprovacaoRMFiltro === "sim") {
    lista =
      lista.filter((usuario) => {
        return usuarioPodeAprovarRM(usuario);
      });
  }

  if (aprovacaoRMFiltro === "nao") {
    lista =
      lista.filter((usuario) => {
        return !usuarioPodeAprovarRM(usuario);
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
      criarCelulaTexto(
        obterRotuloPerfil(usuario.perfil, usuario)
      )
    );

    tr.appendChild(
      criarCelulaTexto(
        obterRotuloRegional(usuario)
      )
    );

    tr.appendChild(
      criarCelulaAprovacaoRM(usuario)
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

  if (!usuarioEhAdministrador(usuarioLogadoGlobal)) {
    alert(
      "Apenas Administrador Geral pode editar usuários."
    );

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
      obterEmailUsuario(usuario) || usuario.email || "";

    inputEmail.disabled =
      true;
  }

  if (selectPerfil) {
    selectPerfil.value =
      obterPerfilEfetivo(usuario);
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

  if (selectRegional) {
    selectRegional.value =
      usuario.regional || "";
  }

  if (checkPodeAprovarRM) {
    checkPodeAprovarRM.checked =
      usuarioEhAdministrador(usuario);
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

  if (!usuarioEhAdministrador(usuarioLogadoGlobal)) {
    alert(
      "Apenas Administrador Geral pode aprovar usuários."
    );

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

  const perfilFinal =
    obterPerfilEfetivo(usuario);

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

        perfil:
          perfilFinal,

        regional:
          perfilFinal === "administrador"
            ? (usuario.regional || "Todas")
            : (usuario.regional || ""),

        podeAprovarRM:
          perfilFinal === "administrador",

        adminRebaixado:
          usuario?.adminRebaixado === true,

        aprovadoEm:
          serverTimestamp(),

        aprovadoPorUid:
          usuarioLogadoGlobal.uid || "",

        aprovadoPorEmail:
          obterEmailUsuario(usuarioLogadoGlobal),

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

  if (!usuarioEhAdministrador(usuarioLogadoGlobal)) {
    alert(
      "Apenas Administrador Geral pode alterar status de usuário."
    );

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
        obterEmailUsuario(usuarioLogadoGlobal),

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
        obterEmailUsuario(usuarioLogadoGlobal);

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
   EXCLUIR USUÁRIO DO BANCO
===================================================== */

async function excluirUsuario(id) {
  const usuario =
    usuariosSistema.find(
      item => item.id === id
    );

  if (!usuario) {
    return;
  }

  if (!usuarioEhAdministrador(usuarioLogadoGlobal)) {
    alert(
      "Apenas Administrador Geral pode excluir usuários."
    );

    return;
  }

  if (mesmoUsuarioLogado(usuario)) {
    alert(
      "Você não pode excluir o próprio usuário administrador logado."
    );

    return;
  }

  const emailUsuario =
    obterEmailUsuario(usuario) ||
    emailNormalizado(usuario.email);

  const confirmar =
    confirm(
      [
        "Deseja realmente excluir este usuário por completo?",
        "",
        `Nome: ${usuario.nome || "-"}`,
        `E-mail: ${emailUsuario || "-"}`,
        "",
        "Isso remove o registro do usuário E a conta de login (Authentication),",
        "permitindo que esse e-mail seja cadastrado novamente do zero."
      ].join("\n")
    );

  if (!confirmar) {
    return;
  }

  try {
    const excluirUsuarioCompleto =
      httpsCallable(functions, "excluirUsuarioCompleto");

    const resultado =
      await excluirUsuarioCompleto({
        uid: usuario.id,
        email: emailUsuario
      });

    const dados = resultado.data || {};

    if (usuarioEditandoId === id) {
      limparFormulario();
    }

    await carregarUsuarios();

    if (dados.authExcluido) {
      alert(
        [
          "Usuário excluído por completo (Firestore + login).",
          "",
          `E-mail: ${emailUsuario || "-"}`,
          `Registros removidos: ${dados.documentosExcluidos ?? "-"}`,
          "",
          "Esse e-mail já pode ser cadastrado novamente."
        ].join("\n")
      );
    } else {
      alert(
        [
          "O registro do usuário foi removido, mas a conta de login",
          "NÃO pôde ser excluída automaticamente.",
          "",
          dados.authErro ? `Detalhe: ${dados.authErro}` : "",
          "",
          "Peça pra apagar manualmente em Firebase Console > Authentication",
          "antes de tentar cadastrar esse e-mail de novo."
        ].join("\n")
      );
    }
  } catch (error) {
    console.error(
      "Erro ao excluir usuário:",
      error
    );

    alert(
      [
        "Erro ao excluir o usuário por completo.",
        "",
        String(error?.message || error),
        "",
        "Nada foi removido. Tente novamente ou apague manualmente pelo Firebase Console."
      ].join("\n")
    );
  }
}

/* =====================================================
   AJUSTES AUTOMÁTICOS DO FORMULÁRIO
===================================================== */

function configurarAjustesFormulario() {
  if (selectPerfil) {
    selectPerfil.addEventListener(
      "change",
      () => {
        const perfil =
          normalizarPerfilSistema(
            selectPerfil.value
          );

        if (perfil === "administrador") {
          if (checkPodeAprovarRM) {
            checkPodeAprovarRM.checked = true;
          }

          if (selectRegional && !selectRegional.value) {
            selectRegional.value = "Todas";
          }
        }

        if (
          perfil === "planejador" ||
          perfil === "usuario"
        ) {
          if (checkPodeAprovarRM) {
            checkPodeAprovarRM.checked = false;
          }

          if (selectRegional?.value === "Todas") {
            selectRegional.value = "";
          }
        }
      }
    );
  }

  if (inputEmail) {
    inputEmail.addEventListener(
      "blur",
      () => {
        const email =
          emailNormalizado(
            inputEmail.value
          );

        if (emailStringEhAdministradorGeral(email)) {
          if (selectPerfil && !selectPerfil.value) {
            selectPerfil.value = "administrador";
          }

          if (
            selectPerfil?.value === "administrador" &&
            selectRegional &&
            !selectRegional.value
          ) {
            selectRegional.value = "Todas";
          }

          if (
            selectPerfil?.value === "administrador" &&
            checkPodeAprovarRM
          ) {
            checkPodeAprovarRM.checked = true;
          }
        }
      }
    );
  }

  if (checkPodeAprovarRM) {
    checkPodeAprovarRM.addEventListener(
      "change",
      () => {
        const perfil =
          normalizarPerfilSistema(
            selectPerfil?.value
          );

        if (
          perfil !== "administrador" &&
          checkPodeAprovarRM.checked
        ) {
          alert(
            "Somente Administrador Geral pode receber permissão administrativa."
          );

          checkPodeAprovarRM.checked = false;
        }
      }
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

  filtroRegional?.addEventListener(
    "change",
    renderizarUsuarios
  );

  filtroAprovacaoRM?.addEventListener(
    "change",
    renderizarUsuarios
  );

  configurarAjustesFormulario();

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

      if (!usuarioEhAdministrador(usuarioLogadoGlobal)) {
        alert(
          "Acesso restrito ao Administrador Geral."
        );

        window.location.href =
          TELA_DASHBOARD;

        return;
      }

      exibirUsuarioLogadoNoTopo();

      configurarEventos();

      limparFormulario();

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