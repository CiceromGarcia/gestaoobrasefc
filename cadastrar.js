/* =====================================================
   CADASTRAR OBRA - PROTEGIDO COM AUTH GUARD
===================================================== */

import {
  db
} from "./firebaseConfig.js";

import {
  protegerPagina
} from "./authGuard.js";

import {
  collection,
  addDoc,
  getDocs,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.3/firebase-firestore.js";

/* =========================================
   USUÁRIO LOGADO
========================================= */

let usuarioLogadoGlobal = null;

/* =========================================
   ELEMENTOS
========================================= */

const form =
document.getElementById("formProjeto");

const localidade =
document.getElementById("localidade");

const regional =
document.getElementById("regional");

const gutGravidade =
document.getElementById("gutGravidade");

const gutUrgencia =
document.getElementById("gutUrgencia");

const gutTendencia =
document.getElementById("gutTendencia");

const gutScore =
document.getElementById("gutScore");

const gutNivel =
document.getElementById("gutNivel");

const gutBadge =
document.querySelector(".gut-badge");

const investimento =
document.getElementById("investimento");

const btnVoltar =
document.getElementById("btnVoltar");

/* =========================================
   HELPERS
========================================= */

function obterValorCampo(id) {

  return document
    .getElementById(id)
    ?.value
    ?.trim() || "";

}

function normalizarTexto(valor) {

  return String(valor || "")
    .toLowerCase()
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

}

function converterMoedaParaNumero(valor) {

  if (
    valor === null ||
    valor === undefined ||
    valor === ""
  ) {
    return 0;
  }

  if (typeof valor === "number") {
    return valor;
  }

  let texto =
  String(valor)
    .replace("R$", "")
    .replace(/\s/g, "")
    .trim();

  if (!texto) {
    return 0;
  }

  if (texto.includes(",")) {

    texto =
    texto
      .replace(/\./g, "")
      .replace(",", ".");

    return Number(texto) || 0;

  }

  texto =
  texto.replace(/[^\d.-]/g, "");

  return Number(texto) || 0;

}

function formatarMoedaBR(valor) {

  return Number(valor || 0)
    .toLocaleString(
      "pt-BR",
      {
        style: "currency",
        currency: "BRL"
      }
    );

}

function dataValida(valor) {

  if (!valor) {
    return false;
  }

  const data =
  new Date(valor);

  return !isNaN(data);

}

function datasValidas() {

  const inicio =
  obterValorCampo("dataInicioPrevisto");

  const fim =
  obterValorCampo("dataTerminoPrevisto");

  if (
    !dataValida(inicio) ||
    !dataValida(fim)
  ) {
    return false;
  }

  const dataInicio =
  new Date(inicio);

  const dataFim =
  new Date(fim);

  return dataFim >= dataInicio;

}

/* =========================================
   REGIONAL AUTOMÁTICA
========================================= */

const mapaRegional = {

  "sao luis": "São Luís",
  "são luís": "São Luís",

  "arari": "Regional 1",

  "vitoria do mearim": "Regional 1",
  "vitória do mearim": "Regional 1",

  "santa ines": "Regional 1",
  "santa inês": "Regional 1",

  "alto alegre": "Regional 1",

  "alto alegre do pindare": "Regional 1",
  "alto alegre do pindaré": "Regional 1",

  "altamira": "Regional 1",

  "auzilandia": "Regional 1",
  "auzilândia": "Regional 1",

  "vila pindare": "Regional 1",
  "vila pindaré": "Regional 1",

  "mineirinho": "Regional 1",

  "nova vida": "Regional 2",

  "acailandia": "Regional 2",
  "açailândia": "Regional 2",

  "maraba": "Regional 3",
  "marabá": "Regional 3",

  "itainopolis": "Regional 3",
  "itainópolis": "Regional 3",

  "sao pedro d'agua branca": "Regional 3",
  "são pedro d'água branca": "Regional 3",
  "sao pedro d agua branca": "Regional 3",
  "são pedro d água branca": "Regional 3"

};

function configurarRegionalAutomatica() {

  if (!localidade || !regional) {
    return;
  }

  localidade.addEventListener(
    "change",
    () => {

      const chave =
      normalizarTexto(
        localidade.value
      );

      regional.value =
      mapaRegional[chave] || "";

    }
  );

}

/* =========================================
   CALCULAR GUT
========================================= */

function calcularGUT() {

  if (
    !gutGravidade ||
    !gutUrgencia ||
    !gutTendencia ||
    !gutScore ||
    !gutNivel ||
    !gutBadge
  ) {
    return;
  }

  if (
    gutGravidade.value === "" ||
    gutUrgencia.value === "" ||
    gutTendencia.value === ""
  ) {

    gutScore.textContent =
    "--";

    gutNivel.textContent =
    "G/U/T";

    gutBadge.style.background =
    "#007E7A";

    gutBadge.style.color =
    "#fff";

    return;

  }

  const g =
  Number(gutGravidade.value);

  const u =
  Number(gutUrgencia.value);

  const t =
  Number(gutTendencia.value);

  const total =
  g * u * t;

  gutScore.textContent =
  String(total);

  let nivel = "";
  let cor = "";

  if (total <= 20) {

    nivel = "Baixa";
    cor = "#22c55e";

  } else if (total <= 40) {

    nivel = "Moderada";
    cor = "#f59e0b";

  } else if (total <= 80) {

    nivel = "Alta";
    cor = "#ef4444";

  } else {

    nivel = "Crítica";
    cor = "#991b1b";

  }

  gutNivel.textContent =
  nivel;

  gutBadge.style.background =
  cor;

  gutBadge.style.color =
  "#fff";

  gutScore.style.color =
  "#fff";

  gutNivel.style.color =
  "#fff";

}

/* =========================================
   EVENTOS GUT
========================================= */

function configurarEventosGUT() {

  gutGravidade?.addEventListener(
    "change",
    calcularGUT
  );

  gutUrgencia?.addEventListener(
    "change",
    calcularGUT
  );

  gutTendencia?.addEventListener(
    "change",
    calcularGUT
  );

  calcularGUT();

}

/* =========================================
   FORMATAR MOEDA
========================================= */

function configurarMoeda() {

  if (!investimento) {
    return;
  }

  investimento.addEventListener(
    "input",
    (e) => {

      let valor =
      e.target.value
        .replace(/\D/g, "");

      valor =
      formatarMoedaBR(
        Number(valor) / 100
      );

      e.target.value =
      valor;

    }
  );

}

/* =========================================
   GERAR ID DA OBRA
   Observação:
   Este método lê os IDs existentes e gera o próximo.
   Em etapa futura, o ideal é migrar para transaction.
========================================= */

async function gerarNovoId() {

  const snapshot =
  await getDocs(
    collection(
      db,
      "obras"
    )
  );

  let maiorNumero = 0;

  snapshot.forEach((documento) => {

    const dados =
    documento.data();

    const idBase =
    dados.idProjeto ||
    dados.idObra ||
    "";

    const numero =
    parseInt(
      String(idBase)
        .replace("OBR-", "")
        .replace(/\D/g, "")
    );

    if (
      !isNaN(numero) &&
      numero > maiorNumero
    ) {

      maiorNumero =
      numero;

    }

  });

  const proximo =
  maiorNumero + 1;

  return `OBR-${String(proximo).padStart(4, "0")}`;

}

/* =========================================
   VALIDAR FORMULÁRIO
========================================= */

function validarFormulario() {

  const nomeProjeto =
  obterValorCampo("nomeProjeto");

  const tipoObra =
  obterValorCampo("tipoObra");

  const valorInvestimento =
  investimento?.value || "";

  if (!nomeProjeto) {

    alert(
      "⚠️ Informe o nome da obra."
    );

    document
      .getElementById("nomeProjeto")
      ?.focus();

    return false;

  }

  if (!tipoObra) {

    alert(
      "⚠️ Selecione o tipo da obra."
    );

    document
      .getElementById("tipoObra")
      ?.focus();

    return false;

  }

  if (!localidade?.value) {

    alert(
      "⚠️ Selecione a localidade."
    );

    localidade?.focus();

    return false;

  }

  if (!regional?.value) {

    alert(
      "⚠️ A regional não foi definida. Verifique a localidade."
    );

    localidade?.focus();

    return false;

  }

  if (
    !valorInvestimento ||
    converterMoedaParaNumero(valorInvestimento) <= 0
  ) {

    alert(
      "⚠️ Informe o valor orçado da obra."
    );

    investimento?.focus();

    return false;

  }

  if (!obterValorCampo("dataInicioPrevisto")) {

    alert(
      "⚠️ Informe a data de início prevista."
    );

    document
      .getElementById("dataInicioPrevisto")
      ?.focus();

    return false;

  }

  if (!obterValorCampo("dataTerminoPrevisto")) {

    alert(
      "⚠️ Informe a data de término prevista."
    );

    document
      .getElementById("dataTerminoPrevisto")
      ?.focus();

    return false;

  }

  if (!datasValidas()) {

    alert(
      "⚠️ A data de término não pode ser menor que a data de início."
    );

    document
      .getElementById("dataTerminoPrevisto")
      ?.focus();

    return false;

  }

  if (
    !gutGravidade?.value ||
    !gutUrgencia?.value ||
    !gutTendencia?.value
  ) {

    alert(
      "⚠️ Preencha a matriz GUT."
    );

    return false;

  }

  return true;

}

/* =========================================
   MONTAR DADOS DA OBRA
========================================= */

async function montarDadosObra() {

  const novoId =
  await gerarNovoId();

  const valorObraFormatado =
  investimento?.value || "R$ 0,00";

  const valorObraNumero =
  converterMoedaParaNumero(
    valorObraFormatado
  );

  return {

    /* =====================================
       IDENTIFICAÇÃO
    ===================================== */

    idProjeto:
    novoId,

    idObra:
    novoId,

    /* =====================================
       DADOS GERAIS
    ===================================== */

    nomeProjeto:
    obterValorCampo("nomeProjeto"),

    tipoObra:
    obterValorCampo("tipoObra"),

    numeroOM:
    obterValorCampo("numeroOM"),

    localidade:
    localidade?.value || "",

    regional:
    regional?.value || "",

    centroCusto:
    obterValorCampo("centroCusto"),

    /* =====================================
       VALORES
    ===================================== */

    valorObra:
    valorObraFormatado,

    investimento:
    valorObraFormatado,

    valorObraNumero:
    valorObraNumero,

    investimentoNumero:
    valorObraNumero,

    executado:
    "R$ 0,00",

    executadoNumero:
    0,

    /* =====================================
       ÁREA
    ===================================== */

    areaM2:
    obterValorCampo("areaM2"),

    /* =====================================
       APROVAÇÃO
    ===================================== */

    aprovacaoCliente:
    obterValorCampo("aprovacaoCliente"),

    /* =====================================
       DATAS
    ===================================== */

    dataInicio:
    obterValorCampo("dataInicioPrevisto"),

    dataFim:
    obterValorCampo("dataTerminoPrevisto"),

    dataInicioPrevisto:
    obterValorCampo("dataInicioPrevisto"),

    dataTerminoPrevisto:
    obterValorCampo("dataTerminoPrevisto"),

    /* =====================================
       GUT
    ===================================== */

    gravidade:
    gutGravidade?.value || "",

    urgencia:
    gutUrgencia?.value || "",

    tendencia:
    gutTendencia?.value || "",

    score:
    gutScore?.textContent || "",

    gutScore:
    gutScore?.textContent || "",

    nivel:
    gutNivel?.textContent || "",

    gutNivel:
    gutNivel?.textContent || "",

    /* =====================================
       AVANÇO E STATUS
    ===================================== */

    avancoFisico:
    0,

    status:
    "Planejado",

    /* =====================================
       ESCOPO
    ===================================== */

    escopo:
    obterValorCampo("escopoObra"),

    /* =====================================
       AUDITORIA
    ===================================== */

    criadoPorUid:
    usuarioLogadoGlobal?.uid || "",

    criadoPorEmail:
    usuarioLogadoGlobal?.email ||
    usuarioLogadoGlobal?.emailAuth ||
    "",

    criadoPorNome:
    usuarioLogadoGlobal?.nome || "",

    criadoEm:
    serverTimestamp(),

    atualizadoEm:
    serverTimestamp()

  };

}

/* =========================================
   SALVAR OBRA
========================================= */

async function salvarObra(event) {

  event.preventDefault();

  if (!usuarioLogadoGlobal) {

    alert(
      "Usuário não autenticado. Faça login novamente."
    );

    return;

  }

  if (!validarFormulario()) {
    return;
  }

  const botaoSubmit =
  form?.querySelector(
    "button[type='submit']"
  );

  const textoOriginalBotao =
  botaoSubmit?.textContent || "Salvar Obra";

  try {

    if (botaoSubmit) {

      botaoSubmit.disabled =
      true;

      botaoSubmit.textContent =
      "Salvando...";

    }

    const dadosObra =
    await montarDadosObra();

    await addDoc(
      collection(
        db,
        "obras"
      ),
      dadosObra
    );

    const desejaPlanejar =
    confirm(
      `✅ Obra cadastrada com sucesso!\n\nID: ${dadosObra.idProjeto}\n\nDeseja realizar o planejamento desta obra agora?`
    );

    if (desejaPlanejar) {

      window.location.href =
      "./planejamento.html";

    } else {

      window.location.href =
      "./dashboard.html";

    }

  } catch (error) {

    console.error(
      "Erro ao salvar obra:",
      error
    );

    alert(
      "❌ Erro ao salvar obra. Verifique suas permissões no Firestore."
    );

  } finally {

    if (botaoSubmit) {

      botaoSubmit.disabled =
      false;

      botaoSubmit.textContent =
      textoOriginalBotao;

    }

  }

}

/* =========================================
   VOLTAR
========================================= */

function configurarBotaoVoltar() {

  if (!btnVoltar) {
    return;
  }

  btnVoltar.addEventListener(
    "click",
    () => {

      window.location.href =
      "./dashboard.html";

    }
  );

}

/* =========================================
   EVENTOS
========================================= */

function configurarEventos() {

  configurarRegionalAutomatica();

  configurarEventosGUT();

  configurarMoeda();

  configurarBotaoVoltar();

  form?.addEventListener(
    "submit",
    salvarObra
  );

}

/* =========================================
   INIT
========================================= */

document.addEventListener(
  "DOMContentLoaded",
  async () => {

    try {

      usuarioLogadoGlobal =
      await protegerPagina();

      configurarEventos();

    } catch (error) {

      console.error(
        "Erro ao iniciar cadastro:",
        error
      );

      alert(
        "Erro ao iniciar a tela de cadastro."
      );

    }

  }
);