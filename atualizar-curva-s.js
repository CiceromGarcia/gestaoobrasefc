/* =====================================================
   ATUALIZAR CURVA S - PROTEGIDO COM AUTH GUARD
===================================================== */

import {
  db
} from "./firebaseConfig.js";

import {
  protegerPagina
} from "./authGuard.js";

import {
  collection,
  getDocs,
  query,
  where,
  addDoc,
  doc,
  updateDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.3/firebase-firestore.js";

/* =========================================
   USUÁRIO LOGADO
========================================= */

let usuarioLogadoGlobal = null;

/* =========================================
   ELEMENTOS
========================================= */

const filtroRegional =
document.getElementById("filtroRegional");

const filtroLocalidade =
document.getElementById("filtroLocalidade");

const filtroObra =
document.getElementById("filtroObra");

const valorObra =
document.getElementById("valorObra");

const valorExecutado =
document.getElementById("valorExecutado");

const tabelaSemanas =
document.getElementById("tabelaSemanas");

const btnSalvar =
document.getElementById("btnSalvar");

const semanaSelecionadaLabel =
document.getElementById("semanaSelecionadaLabel");

const inputFisicoReal =
document.getElementById("fisicoReal");

const inputFinanceiroReal =
document.getElementById("financeiroReal");

const inputCentroCustoApropriacao =
document.getElementById("centroCustoApropriacao");

const inputAnomalias =
document.getElementById("anomalias");

/* =========================================
   ELEMENTOS DA ANOMALIA
========================================= */

const selectTemAnomalia =
document.getElementById("temAnomalia");

const selectTipoAnomalia =
document.getElementById("tipoAnomalia");

const selectCriticidadeAnomalia =
document.getElementById("criticidadeAnomalia");

const selectImpactoAnomalia =
document.getElementById("impactoAnomalia");

const selectStatusAnomalia =
document.getElementById("statusAnomalia");

const inputPrazoTratativaAnomalia =
document.getElementById("prazoTratativaAnomalia");

const inputDescricaoAnomalia =
document.getElementById("descricaoAnomalia");

const inputAcaoCorretivaAnomalia =
document.getElementById("acaoCorretivaAnomalia");

const inputResponsavelAnomalia =
document.getElementById("responsavelAnomalia");

/* =========================================
   ELEMENTOS STATUS DA OBRA
========================================= */

const statusObra =
document.getElementById("statusObra");

const motivoParalisacao =
document.getElementById("motivoParalisacao");

const btnSalvarStatusObra =
document.getElementById("btnSalvarStatusObra");

const btnReativarObra =
document.getElementById("btnReativarObra");

const statusObraLabel =
document.getElementById("statusObraLabel");

/* =========================================
   VARIÁVEIS
========================================= */

let obras = [];

let obraSelecionada = null;

let semanaSelecionada = null;

let modoEdicao = false;

let realizadoEmEdicaoId = null;

/* =========================================
   NORMALIZAR TEXTO
========================================= */

function normalizarTexto(valor) {

  return String(valor || "")
    .toLowerCase()
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

}

/* =========================================
   PERFIL DO USUÁRIO
========================================= */

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

/* =========================================
   VERIFICAR STATUS
========================================= */

function obraEstaParalisada(obra) {

  const status =
  normalizarTexto(
    obra?.status ||
    obra?.fase ||
    ""
  );

  return (
    status === "paralisada" ||
    status === "paralisado"
  );

}

/* =========================================
   APLICAR STATUS VISUAL
========================================= */

function aplicarStatusVisualObra() {

  if (!obraSelecionada) {

    if (statusObra) {
      statusObra.value = "";
    }

    if (motivoParalisacao) {

      motivoParalisacao.value = "";

      motivoParalisacao.disabled = true;

    }

    if (statusObraLabel) {

      statusObraLabel.textContent =
      "Nenhuma obra selecionada";

    }

    return;

  }

  const paralisada =
  obraEstaParalisada(
    obraSelecionada
  );

  if (statusObra) {

    statusObra.value =
    paralisada
    ? "Paralisada"
    : "Em andamento";

  }

  if (motivoParalisacao) {

    motivoParalisacao.value =
    obraSelecionada.motivoParalisacao || "";

    motivoParalisacao.disabled =
    !paralisada;

  }

  if (statusObraLabel) {

    statusObraLabel.textContent =
    paralisada
    ? "Obra paralisada"
    : "Obra em andamento";

  }

}

/* =========================================
   CONVERTER MOEDA
========================================= */

function converterMoeda(valor) {

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

/* =========================================
   FORMATAR MOEDA
========================================= */

function formatarMoeda(valor) {

  const numero =
  converterMoeda(
    valor
  );

  return numero.toLocaleString(
    "pt-BR",
    {
      style: "currency",
      currency: "BRL",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }
  );

}

/* =========================================
   CONVERTER PERCENTUAL
========================================= */

function converterPercentual(valor) {

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
    .replace("%", "")
    .replace(/\s/g, "")
    .trim();

  if (texto.includes(",")) {

    texto =
    texto
      .replace(/\./g, "")
      .replace(",", ".");

  }

  texto =
  texto.replace(/[^\d.-]/g, "");

  return Number(texto) || 0;

}

/* =========================================
   FORMATAR PERCENTUAL
========================================= */

function formatarPercentual(valor) {

  if (
    valor === null ||
    valor === undefined ||
    valor === ""
  ) {
    return "-";
  }

  const numero =
  converterPercentual(
    valor
  );

  return numero.toLocaleString(
    "pt-BR",
    {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }
  ) + "%";

}

/* =========================================
   MÁSCARA DE MOEDA
========================================= */

function aplicarMascaraMoeda(valor) {

  let somenteNumeros =
  String(valor || "")
    .replace(/\D/g, "");

  if (!somenteNumeros) {
    return "";
  }

  return (
    Number(
      somenteNumeros
    ) / 100
  ).toLocaleString(
    "pt-BR",
    {
      style: "currency",
      currency: "BRL"
    }
  );

}

/* =========================================
   NÚMERO DA SEMANA
========================================= */

function obterNumeroSemana(semana) {

  const numero =
  String(semana || "")
    .match(/\d+/);

  return numero
  ? Number(numero[0])
  : 0;

}

/* =========================================
   DATA
========================================= */

function obterData(valor) {

  if (!valor) {
    return null;
  }

  if (valor?.toDate) {
    return valor.toDate();
  }

  if (valor?.seconds) {
    return new Date(
      valor.seconds * 1000
    );
  }

  const data =
  new Date(valor);

  return isNaN(data.getTime())
  ? null
  : data;

}

function formatarDataAtualizacao(realizado) {

  const data =
  obterData(
    realizado?.atualizadoEm ||
    realizado?.criadoEm ||
    realizado?.dataAtualizacao
  );

  if (!data) {
    return "-";
  }

  return data.toLocaleDateString(
    "pt-BR"
  ) + " " + data.toLocaleTimeString(
    "pt-BR",
    {
      hour: "2-digit",
      minute: "2-digit"
    }
  );

}

function formatarDataSimples(valor) {

  if (!valor) {
    return "";
  }

  if (
    typeof valor === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(valor)
  ) {

    const partes =
    valor.split("-");

    return `${partes[2]}/${partes[1]}/${partes[0]}`;

  }

  const data =
  obterData(valor);

  if (!data) {
    return "";
  }

  return data.toLocaleDateString(
    "pt-BR"
  );

}

function normalizarDataParaInput(valor) {

  if (!valor) {
    return "";
  }

  if (
    typeof valor === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(valor)
  ) {
    return valor;
  }

  const data =
  obterData(valor);

  if (!data) {
    return "";
  }

  const ano =
  data.getFullYear();

  const mes =
  String(data.getMonth() + 1)
    .padStart(2, "0");

  const dia =
  String(data.getDate())
    .padStart(2, "0");

  return `${ano}-${mes}-${dia}`;

}

/* =========================================
   VALORES DA OBRA
========================================= */

function obterValorOrcadoObra(obra) {

  return converterMoeda(
    obra?.valorObraNumero ??
    obra?.investimentoNumero ??
    obra?.valorObra ??
    obra?.valorOrcado ??
    obra?.valorTotal ??
    obra?.investimento ??
    obra?.orcado ??
    obra?.valor ??
    0
  );

}

function obterValorPlanejadoFisico(item) {

  if (item.fisicoAcum !== undefined) {
    return item.fisicoAcum;
  }

  if (item.fisicoAcumulado !== undefined) {
    return item.fisicoAcumulado;
  }

  if (item.fisicoPlanejado !== undefined) {
    return item.fisicoPlanejado;
  }

  return item.fisico || 0;

}

function obterValorPlanejadoFinanceiro(item) {

  if (item.financeiroAcum !== undefined) {
    return item.financeiroAcum;
  }

  if (item.financeiroAcumulado !== undefined) {
    return item.financeiroAcumulado;
  }

  if (item.financeiroPlanejado !== undefined) {
    return item.financeiroPlanejado;
  }

  return item.financeiro || 0;

}

/* =========================================
   VALORES REALIZADOS
========================================= */

function obterFisicoRealizado(item) {

  return converterPercentual(
    item?.fisicoRealAcum ??
    item?.fisicoReal ??
    item?.fisicoAcum ??
    item?.fisico ??
    0
  );

}

function obterFinanceiroRealizado(item) {

  return converterMoeda(
    item?.financeiroRealAcum ??
    item?.financeiroReal ??
    item?.financeiroAcum ??
    item?.financeiro ??
    0
  );

}

function obterCentroCustoApropriacao(item) {

  return (
    item?.centroCustoApropriacao ||
    item?.centroCusto ||
    item?.centroCustoReal ||
    "-"
  );

}

/* =========================================
   ANOMALIAS
========================================= */

function obterCamposAnomalia() {

  return [
    selectTipoAnomalia,
    selectCriticidadeAnomalia,
    selectImpactoAnomalia,
    selectStatusAnomalia,
    inputPrazoTratativaAnomalia,
    inputDescricaoAnomalia,
    inputAcaoCorretivaAnomalia,
    inputResponsavelAnomalia
  ].filter(Boolean);

}

function limparDetalhesAnomalia() {

  if (selectTipoAnomalia) {
    selectTipoAnomalia.value = "";
  }

  if (selectCriticidadeAnomalia) {
    selectCriticidadeAnomalia.value = "";
  }

  if (selectImpactoAnomalia) {
    selectImpactoAnomalia.value = "";
  }

  if (selectStatusAnomalia) {
    selectStatusAnomalia.value = "";
  }

  if (inputPrazoTratativaAnomalia) {
    inputPrazoTratativaAnomalia.value = "";
  }

  if (inputDescricaoAnomalia) {
    inputDescricaoAnomalia.value = "";
  }

  if (inputAcaoCorretivaAnomalia) {
    inputAcaoCorretivaAnomalia.value = "";
  }

  if (inputResponsavelAnomalia) {
    inputResponsavelAnomalia.value = "";
  }

  if (inputAnomalias) {
    inputAnomalias.value = "";
  }

}

function definirCamposAnomaliaHabilitados(habilitar) {

  obterCamposAnomalia()
    .forEach((campo) => {

      campo.disabled =
      !habilitar;

    });

}

function montarDescricaoAnomalia() {

  const houveAnomalia =
  selectTemAnomalia?.value === "Sim";

  if (!houveAnomalia) {
    return "";
  }

  const tipo =
  selectTipoAnomalia?.value || "";

  const criticidade =
  selectCriticidadeAnomalia?.value || "";

  const impacto =
  selectImpactoAnomalia?.value || "";

  const status =
  selectStatusAnomalia?.value || "";

  const prazo =
  inputPrazoTratativaAnomalia?.value || "";

  const descricao =
  inputDescricaoAnomalia?.value.trim() || "";

  const acao =
  inputAcaoCorretivaAnomalia?.value.trim() || "";

  const responsavel =
  inputResponsavelAnomalia?.value.trim() || "";

  const partes = [];

  if (tipo) {
    partes.push(`Tipo: ${tipo}`);
  }

  if (criticidade) {
    partes.push(`Criticidade: ${criticidade}`);
  }

  if (impacto) {
    partes.push(`Impacto: ${impacto}`);
  }

  if (status) {
    partes.push(`Status: ${status}`);
  }

  if (prazo) {
    partes.push(`Prazo: ${formatarDataSimples(prazo)}`);
  }

  if (responsavel) {
    partes.push(`Responsável: ${responsavel}`);
  }

  if (descricao) {
    partes.push(`Descrição: ${descricao}`);
  }

  if (acao) {
    partes.push(`Ação: ${acao}`);
  }

  return partes.join(" | ");

}

function atualizarCampoAnomaliasConsolidado() {

  if (!inputAnomalias) {
    return;
  }

  inputAnomalias.value =
  montarDescricaoAnomalia();

}

function atualizarEstadoAnomalia() {

  const houveAnomalia =
  selectTemAnomalia?.value === "Sim";

  if (!houveAnomalia) {
    limparDetalhesAnomalia();
  }

  definirCamposAnomaliaHabilitados(
    houveAnomalia
  );

  atualizarCampoAnomaliasConsolidado();

}

function obterDadosAnomaliaParaSalvar() {

  const houveAnomalia =
  selectTemAnomalia?.value === "Sim";

  if (!houveAnomalia) {

    return {
      houveAnomalia: false,
      temAnomalia: "Não",
      tipoAnomalia: "",
      criticidadeAnomalia: "",
      impactoAnomalia: "",
      statusAnomalia: "",
      prazoTratativaAnomalia: "",
      descricaoAnomalia: "",
      acaoCorretivaAnomalia: "",
      responsavelAnomalia: "",
      anomalias: "",
      anomalia: {
        houve: false,
        tipo: "",
        criticidade: "",
        impacto: "",
        status: "",
        prazoTratativa: "",
        descricao: "",
        acaoCorretiva: "",
        responsavel: ""
      }
    };

  }

  const tipoAnomalia =
  selectTipoAnomalia?.value || "";

  const criticidadeAnomalia =
  selectCriticidadeAnomalia?.value || "";

  const impactoAnomalia =
  selectImpactoAnomalia?.value || "";

  const statusAnomalia =
  selectStatusAnomalia?.value || "";

  const prazoTratativaAnomalia =
  inputPrazoTratativaAnomalia?.value || "";

  const descricaoAnomalia =
  inputDescricaoAnomalia?.value.trim() || "";

  const acaoCorretivaAnomalia =
  inputAcaoCorretivaAnomalia?.value.trim() || "";

  const responsavelAnomalia =
  inputResponsavelAnomalia?.value.trim() || "";

  const anomalias =
  montarDescricaoAnomalia();

  return {
    houveAnomalia: true,
    temAnomalia: "Sim",
    tipoAnomalia,
    criticidadeAnomalia,
    impactoAnomalia,
    statusAnomalia,
    prazoTratativaAnomalia,
    descricaoAnomalia,
    acaoCorretivaAnomalia,
    responsavelAnomalia,
    anomalias,
    anomalia: {
      houve: true,
      tipo: tipoAnomalia,
      criticidade: criticidadeAnomalia,
      impacto: impactoAnomalia,
      status: statusAnomalia,
      prazoTratativa: prazoTratativaAnomalia,
      descricao: descricaoAnomalia,
      acaoCorretiva: acaoCorretivaAnomalia,
      responsavel: responsavelAnomalia
    }
  };

}

function validarDadosAnomalia(dadosAnomalia) {

  if (!dadosAnomalia.houveAnomalia) {
    return true;
  }

  if (!dadosAnomalia.tipoAnomalia) {

    alert(
      "Selecione o tipo da anomalia."
    );

    selectTipoAnomalia?.focus();

    return false;

  }

  if (!dadosAnomalia.criticidadeAnomalia) {

    alert(
      "Selecione a criticidade da anomalia."
    );

    selectCriticidadeAnomalia?.focus();

    return false;

  }

  if (!dadosAnomalia.impactoAnomalia) {

    alert(
      "Selecione o impacto principal da anomalia."
    );

    selectImpactoAnomalia?.focus();

    return false;

  }

  if (!dadosAnomalia.statusAnomalia) {

    alert(
      "Selecione o status da anomalia."
    );

    selectStatusAnomalia?.focus();

    return false;

  }

  if (!dadosAnomalia.descricaoAnomalia) {

    alert(
      "Descreva a anomalia encontrada na semana."
    );

    inputDescricaoAnomalia?.focus();

    return false;

  }

  return true;

}

function realizadoPossuiAnomalia(realizado) {

  return (
    realizado?.houveAnomalia === true ||
    realizado?.temAnomalia === "Sim" ||
    Boolean(realizado?.tipoAnomalia) ||
    Boolean(realizado?.descricaoAnomalia) ||
    Boolean(realizado?.anomalias && String(realizado.anomalias).trim() !== "")
  );

}

function obterResumoAnomalia(realizado) {

  if (!realizadoPossuiAnomalia(realizado)) {
    return "-";
  }

  const tipo =
  realizado?.tipoAnomalia ||
  realizado?.anomalia?.tipo ||
  "";

  const descricao =
  realizado?.descricaoAnomalia ||
  realizado?.anomalia?.descricao ||
  realizado?.anomalias ||
  "";

  if (tipo && descricao) {
    return `${tipo} - ${descricao}`;
  }

  return tipo || descricao || "-";

}

function obterCriticidadeAnomalia(realizado) {

  if (!realizadoPossuiAnomalia(realizado)) {
    return "-";
  }

  return (
    realizado?.criticidadeAnomalia ||
    realizado?.anomalia?.criticidade ||
    "-"
  );

}

function obterClasseCriticidadeAnomalia(realizado) {

  const criticidade =
  normalizarTexto(
    obterCriticidadeAnomalia(realizado)
  );

  if (
    criticidade === "alta" ||
    criticidade === "critica"
  ) {
    return "texto-vermelho";
  }

  return "";

}

function preencherCamposAnomalia(realizado) {

  const possuiAnomalia =
  realizadoPossuiAnomalia(
    realizado
  );

  if (selectTemAnomalia) {

    selectTemAnomalia.value =
    possuiAnomalia
    ? "Sim"
    : "Não";

  }

  if (!possuiAnomalia) {

    limparDetalhesAnomalia();

    definirCamposAnomaliaHabilitados(false);

    return;

  }

  if (selectTipoAnomalia) {

    selectTipoAnomalia.value =
    realizado?.tipoAnomalia ||
    realizado?.anomalia?.tipo ||
    "";

  }

  if (selectCriticidadeAnomalia) {

    selectCriticidadeAnomalia.value =
    realizado?.criticidadeAnomalia ||
    realizado?.anomalia?.criticidade ||
    "";

  }

  if (selectImpactoAnomalia) {

    selectImpactoAnomalia.value =
    realizado?.impactoAnomalia ||
    realizado?.anomalia?.impacto ||
    "";

  }

  if (selectStatusAnomalia) {

    selectStatusAnomalia.value =
    realizado?.statusAnomalia ||
    realizado?.anomalia?.status ||
    "";

  }

  if (inputPrazoTratativaAnomalia) {

    inputPrazoTratativaAnomalia.value =
    normalizarDataParaInput(
      realizado?.prazoTratativaAnomalia ||
      realizado?.anomalia?.prazoTratativa ||
      ""
    );

  }

  if (inputDescricaoAnomalia) {

    inputDescricaoAnomalia.value =
    realizado?.descricaoAnomalia ||
    realizado?.anomalia?.descricao ||
    realizado?.anomalias ||
    "";

  }

  if (inputAcaoCorretivaAnomalia) {

    inputAcaoCorretivaAnomalia.value =
    realizado?.acaoCorretivaAnomalia ||
    realizado?.anomalia?.acaoCorretiva ||
    "";

  }

  if (inputResponsavelAnomalia) {

    inputResponsavelAnomalia.value =
    realizado?.responsavelAnomalia ||
    realizado?.anomalia?.responsavel ||
    "";

  }

  definirCamposAnomaliaHabilitados(true);

  atualizarCampoAnomaliasConsolidado();

}

function configurarAnomalias() {

  selectTemAnomalia?.addEventListener(
    "change",
    atualizarEstadoAnomalia
  );

  [
    selectTipoAnomalia,
    selectCriticidadeAnomalia,
    selectImpactoAnomalia,
    selectStatusAnomalia,
    inputPrazoTratativaAnomalia,
    inputDescricaoAnomalia,
    inputAcaoCorretivaAnomalia,
    inputResponsavelAnomalia
  ]
    .filter(Boolean)
    .forEach((campo) => {

      campo.addEventListener(
        "input",
        atualizarCampoAnomaliasConsolidado
      );

      campo.addEventListener(
        "change",
        atualizarCampoAnomaliasConsolidado
      );

    });

  atualizarEstadoAnomalia();

}

/* =========================================
   HELPERS DE SELECT
========================================= */

function limparSelect(select, textoPadrao) {

  if (!select) {
    return;
  }

  select.innerHTML = "";

  const option =
  document.createElement("option");

  option.value = "";

  option.textContent =
  textoPadrao;

  select.appendChild(option);

}

function adicionarOption(select, valor, texto) {

  if (!select) {
    return;
  }

  const option =
  document.createElement("option");

  option.value =
  valor;

  option.textContent =
  texto;

  select.appendChild(option);

}

/* =========================================
   HELPERS DE TABELA
========================================= */

function criarCelulaTexto(texto, classe = "") {

  const td =
  document.createElement("td");

  if (classe) {
    td.className = classe;
  }

  td.textContent =
  texto || "-";

  return td;

}

function mostrarMensagemTabela(mensagem) {

  if (!tabelaSemanas) {
    return;
  }

  tabelaSemanas.innerHTML = "";

  const tr =
  document.createElement("tr");

  const td =
  document.createElement("td");

  td.colSpan =
  10;

  td.textContent =
  mensagem;

  tr.appendChild(td);

  tabelaSemanas.appendChild(tr);

}

/* =========================================
   LIMPAR CAMPOS
========================================= */

function limparCamposAtualizacao() {

  if (inputFisicoReal) {
    inputFisicoReal.value = "";
  }

  if (inputFinanceiroReal) {
    inputFinanceiroReal.value = "";
  }

  if (inputCentroCustoApropriacao) {
    inputCentroCustoApropriacao.value = "";
  }

  if (selectTemAnomalia) {
    selectTemAnomalia.value = "Não";
  }

  limparDetalhesAnomalia();

  atualizarEstadoAnomalia();

  semanaSelecionada = null;

  modoEdicao = false;

  realizadoEmEdicaoId = null;

  if (btnSalvar) {
    btnSalvar.textContent = "Salvar Atualização";
  }

  if (semanaSelecionadaLabel) {
    semanaSelecionadaLabel.textContent =
    "Nenhuma semana selecionada";
  }

}

function limparStatusObra() {

  if (statusObra) {
    statusObra.value = "";
  }

  if (motivoParalisacao) {

    motivoParalisacao.value = "";

    motivoParalisacao.disabled = true;

  }

  if (statusObraLabel) {
    statusObraLabel.textContent =
    "Nenhuma obra selecionada";
  }

}

function limparTela() {

  if (tabelaSemanas) {
    tabelaSemanas.innerHTML = "";
  }

  if (valorObra) {
    valorObra.value = "";
  }

  if (valorExecutado) {
    valorExecutado.value = "";
  }

  limparCamposAtualizacao();

  limparStatusObra();

}

/* =========================================
   MÁSCARA DO FINANCEIRO REAL
========================================= */

function configurarMascaraFinanceiro() {

  inputFinanceiroReal?.addEventListener(
    "input",
    (e) => {

      e.target.value =
      aplicarMascaraMoeda(
        e.target.value
      );

    }
  );

}

/* =========================================
   STATUS - ALTERAR SELECT
========================================= */

function configurarStatusObra() {

  statusObra?.addEventListener(
    "change",
    () => {

      if (!motivoParalisacao) {
        return;
      }

      if (statusObra.value === "Paralisada") {

        motivoParalisacao.disabled = false;

        motivoParalisacao.focus();

      } else {

        motivoParalisacao.disabled = true;

        motivoParalisacao.value = "";

      }

    }
  );

  btnSalvarStatusObra?.addEventListener(
    "click",
    salvarStatusObra
  );

  btnReativarObra?.addEventListener(
    "click",
    reativarObra
  );

}

/* =========================================
   SALVAR STATUS DA OBRA
========================================= */

async function salvarStatusObra() {

  if (!usuarioLogadoGlobal) {

    alert(
      "Usuário não autenticado. Faça login novamente."
    );

    return;

  }

  if (!obraSelecionada) {

    alert(
      "Selecione uma obra."
    );

    return;

  }

  if (!statusObra?.value) {

    alert(
      "Selecione o status da obra."
    );

    return;

  }

  if (
    statusObra.value === "Paralisada" &&
    !motivoParalisacao?.value.trim()
  ) {

    alert(
      "Informe o motivo da paralisação."
    );

    motivoParalisacao?.focus();

    return;

  }

  try {

    const dadosAtualizacao = {

      status:
      statusObra.value,

      fase:
      statusObra.value,

      motivoParalisacao:
      statusObra.value === "Paralisada"
      ? motivoParalisacao.value.trim()
      : "",

      atualizadoPorUid:
      usuarioLogadoGlobal?.uid || "",

      atualizadoPorEmail:
      usuarioLogadoGlobal?.email ||
      usuarioLogadoGlobal?.emailAuth ||
      "",

      atualizadoPorNome:
      usuarioLogadoGlobal?.nome || "",

      atualizadoEm:
      serverTimestamp()

    };

    if (statusObra.value === "Paralisada") {

      dadosAtualizacao.paralisadaEm =
      serverTimestamp();

    }

    await updateDoc(
      doc(
        db,
        "obras",
        obraSelecionada.id
      ),
      dadosAtualizacao
    );

    obraSelecionada.status =
    dadosAtualizacao.status;

    obraSelecionada.fase =
    dadosAtualizacao.fase;

    obraSelecionada.motivoParalisacao =
    dadosAtualizacao.motivoParalisacao;

    alert(
      "Status da obra atualizado com sucesso!"
    );

    aplicarStatusVisualObra();

    await carregarObras();

  } catch (error) {

    console.error(
      "Erro ao salvar status:",
      error
    );

    alert(
      "Erro ao salvar status da obra. Verifique suas permissões."
    );

  }

}

/* =========================================
   REATIVAR OBRA
========================================= */

async function reativarObra() {

  if (!usuarioLogadoGlobal) {

    alert(
      "Usuário não autenticado. Faça login novamente."
    );

    return;

  }

  if (!obraSelecionada) {

    alert(
      "Selecione uma obra."
    );

    return;

  }

  const confirmar =
  confirm(
    "Deseja reativar esta obra?"
  );

  if (!confirmar) {
    return;
  }

  try {

    await updateDoc(
      doc(
        db,
        "obras",
        obraSelecionada.id
      ),
      {
        status:
        "Em andamento",

        fase:
        "Em andamento",

        motivoParalisacao:
        "",

        reativadaPorUid:
        usuarioLogadoGlobal?.uid || "",

        reativadaPorEmail:
        usuarioLogadoGlobal?.email ||
        usuarioLogadoGlobal?.emailAuth ||
        "",

        reativadaPorNome:
        usuarioLogadoGlobal?.nome || "",

        reativadaEm:
        serverTimestamp(),

        atualizadoEm:
        serverTimestamp()
      }
    );

    obraSelecionada.status =
    "Em andamento";

    obraSelecionada.fase =
    "Em andamento";

    obraSelecionada.motivoParalisacao =
    "";

    alert(
      "Obra reativada com sucesso!"
    );

    aplicarStatusVisualObra();

    await carregarObras();

  } catch (error) {

    console.error(
      "Erro ao reativar obra:",
      error
    );

    alert(
      "Erro ao reativar obra. Verifique suas permissões."
    );

  }

}

/* =========================================
   CARREGAR OBRAS
========================================= */

async function carregarObras() {

  try {

    const snapshot =
    await getDocs(
      collection(
        db,
        "obras"
      )
    );

    obras = [];

    snapshot.forEach((docRef) => {

      obras.push({
        id: docRef.id,
        ...docRef.data()
      });

    });

    carregarRegionais();

  } catch (error) {

    console.error(
      "Erro ao carregar obras:",
      error
    );

    alert(
      "Erro ao carregar obras. Verifique suas permissões no Firestore."
    );

  }

}

/* =========================================
   CARREGAR REGIONAIS
========================================= */

function carregarRegionais() {

  const regionais =
  [
    ...new Set(
      obras.map(
        obra => obra.regional
      )
    )
  ]
    .filter(Boolean)
    .sort();

  limparSelect(
    filtroRegional,
    "Regional"
  );

  regionais.forEach((regional) => {

    adicionarOption(
      filtroRegional,
      regional,
      regional
    );

  });

}

/* =========================================
   FILTRO REGIONAL
========================================= */

function configurarFiltroRegional() {

  filtroRegional?.addEventListener(
    "change",
    () => {

      limparSelect(
        filtroLocalidade,
        "Localidade"
      );

      limparSelect(
        filtroObra,
        "Obra"
      );

      obraSelecionada = null;

      limparTela();

      const localidades =
      [
        ...new Set(
          obras
            .filter(
              obra =>
              obra.regional === filtroRegional.value
            )
            .map(
              obra => obra.localidade
            )
        )
      ]
        .filter(Boolean)
        .sort();

      localidades.forEach((localidade) => {

        adicionarOption(
          filtroLocalidade,
          localidade,
          localidade
        );

      });

    }
  );

}

/* =========================================
   FILTRO LOCALIDADE
========================================= */

function configurarFiltroLocalidade() {

  filtroLocalidade?.addEventListener(
    "change",
    () => {

      limparSelect(
        filtroObra,
        "Obra"
      );

      obraSelecionada = null;

      limparTela();

      const obrasFiltradas =
      obras
        .filter(
          obra =>
          obra.regional === filtroRegional?.value &&
          obra.localidade === filtroLocalidade?.value
        )
        .sort(
          (a, b) =>
          String(a.nomeProjeto || "")
            .localeCompare(
              String(b.nomeProjeto || ""),
              "pt-BR"
            )
        );

      obrasFiltradas.forEach((obra) => {

        adicionarOption(
          filtroObra,
          obra.id,
          obra.nomeProjeto || "-"
        );

      });

    }
  );

}

/* =========================================
   FILTRO OBRA
========================================= */

function configurarFiltroObra() {

  filtroObra?.addEventListener(
    "change",
    () => {

      const obra =
      obras.find(
        item =>
        item.id === filtroObra.value
      );

      if (!obra) {

        obraSelecionada = null;

        limparTela();

        return;

      }

      obraSelecionada = obra;

      if (valorObra) {

        valorObra.value =
        formatarMoeda(
          obterValorOrcadoObra(
            obraSelecionada
          )
        );

      }

      if (valorExecutado) {
        valorExecutado.value =
        formatarMoeda(0);
      }

      aplicarStatusVisualObra();

      carregarPlanejamento();

    }
  );

}

/* =========================================
   CONSULTAR PLANEJAMENTOS DA OBRA
========================================= */

async function buscarPlanejamentosDaObra() {

  const lista = [];

  const idsAdicionados =
  new Set();

  const consultas = [
    query(
      collection(db, "planejamentoCurvaS"),
      where("obraId", "==", obraSelecionada.id)
    ),
    query(
      collection(db, "planejamentoCurvaS"),
      where("obra", "==", obraSelecionada.nomeProjeto)
    ),
    query(
      collection(db, "planejamentoCurvaS"),
      where("nomeObra", "==", obraSelecionada.nomeProjeto)
    ),
    query(
      collection(db, "planejamentoCurvaS"),
      where("obraNome", "==", obraSelecionada.nomeProjeto)
    )
  ];

  for (const consulta of consultas) {

    const snapshot =
    await getDocs(consulta);

    snapshot.forEach((docRef) => {

      if (idsAdicionados.has(docRef.id)) {
        return;
      }

      idsAdicionados.add(
        docRef.id
      );

      lista.push({
        id: docRef.id,
        ...docRef.data()
      });

    });

  }

  return lista;

}

/* =========================================
   CONSULTAR REALIZADOS DA OBRA
========================================= */

async function buscarRealizadosDaObra() {

  const lista = [];

  const idsAdicionados =
  new Set();

  const consultas = [
    query(
      collection(db, "realizadoCurvaS"),
      where("obraId", "==", obraSelecionada.id)
    ),
    query(
      collection(db, "realizadoCurvaS"),
      where("obra", "==", obraSelecionada.nomeProjeto)
    ),
    query(
      collection(db, "realizadoCurvaS"),
      where("nomeObra", "==", obraSelecionada.nomeProjeto)
    ),
    query(
      collection(db, "realizadoCurvaS"),
      where("obraNome", "==", obraSelecionada.nomeProjeto)
    )
  ];

  for (const consulta of consultas) {

    const snapshot =
    await getDocs(consulta);

    snapshot.forEach((docRef) => {

      if (idsAdicionados.has(docRef.id)) {
        return;
      }

      idsAdicionados.add(
        docRef.id
      );

      lista.push({
        id: docRef.id,
        ...docRef.data()
      });

    });

  }

  const realizados = {};

  lista.forEach((dado) => {

    const semana =
    String(dado.semana || "")
      .trim()
      .toUpperCase();

    if (!semana) {
      return;
    }

    const existente =
    realizados[semana];

    if (!existente) {

      realizados[semana] =
      dado;

      return;

    }

    const dataAtual =
    obterData(
      dado.atualizadoEm ||
      dado.criadoEm
    );

    const dataExistente =
    obterData(
      existente.atualizadoEm ||
      existente.criadoEm
    );

    if (
      dataAtual &&
      dataExistente &&
      dataAtual > dataExistente
    ) {

      realizados[semana] =
      dado;

    }

  });

  return realizados;

}

/* =========================================
   CARREGAR PLANEJAMENTO + REALIZADO
========================================= */

async function carregarPlanejamento() {

  if (!tabelaSemanas) {
    return;
  }

  tabelaSemanas.innerHTML = "";

  limparCamposAtualizacao();

  try {

    const planejamentoLista =
    await buscarPlanejamentosDaObra();

    const realizados =
    await buscarRealizadosDaObra();

    const semanasMap =
    new Map();

    planejamentoLista.forEach((item) => {

      const chaveSemana =
      String(item.semana || "")
        .trim()
        .toUpperCase();

      if (!chaveSemana) {
        return;
      }

      if (!semanasMap.has(chaveSemana)) {

        semanasMap.set(
          chaveSemana,
          item
        );

      }

    });

    const semanas =
    Array.from(
      semanasMap.values()
    );

    semanas.sort(
      (a, b) =>
      obterNumeroSemana(a.semana) -
      obterNumeroSemana(b.semana)
    );

    if (semanas.length === 0) {

      mostrarMensagemTabela(
        "Nenhum planejamento encontrado para esta obra."
      );

      if (valorObra) {

        valorObra.value =
        formatarMoeda(
          obterValorOrcadoObra(
            obraSelecionada
          )
        );

      }

      if (valorExecutado) {
        valorExecutado.value =
        formatarMoeda(0);
      }

      return;

    }

    if (valorObra) {

      valorObra.value =
      formatarMoeda(
        obterValorOrcadoObra(
          obraSelecionada
        )
      );

    }

    const realizadosOrdenados =
    Object.values(realizados)
      .filter(
        item =>
        item &&
        item.semana
      )
      .sort(
        (a, b) =>
        obterNumeroSemana(a.semana) -
        obterNumeroSemana(b.semana)
      );

    const ultimoRealizado =
    realizadosOrdenados[
      realizadosOrdenados.length - 1
    ];

    if (valorExecutado) {

      valorExecutado.value =
      ultimoRealizado
      ? formatarMoeda(
        obterFinanceiroRealizado(
          ultimoRealizado
        )
      )
      : formatarMoeda(0);

    }

    semanas.forEach((item) => {

      const chaveSemana =
      String(item.semana || "")
        .trim()
        .toUpperCase();

      const realizado =
      realizados[chaveSemana];

      const fisicoPlanejadoRaw =
      obterValorPlanejadoFisico(
        item
      );

      const financeiroPlanejadoRaw =
      obterValorPlanejadoFinanceiro(
        item
      );

      const fisicoPlanejado =
      converterPercentual(
        fisicoPlanejadoRaw
      );

      const financeiroPlanejado =
      converterMoeda(
        financeiroPlanejadoRaw
      );

      const fisicoRealizado =
      realizado
      ? obterFisicoRealizado(
        realizado
      )
      : 0;

      const financeiroRealizado =
      realizado
      ? obterFinanceiroRealizado(
        realizado
      )
      : 0;

      const centroCusto =
      realizado
      ? obterCentroCustoApropriacao(
        realizado
      )
      : "-";

      const classeFisico =
      realizado &&
      fisicoRealizado < fisicoPlanejado
      ? "texto-vermelho"
      : "";

      const classeFinanceiro =
      realizado &&
      financeiroRealizado > financeiroPlanejado
      ? "texto-vermelho"
      : "";

      const possuiAnomalia =
      realizado
      ? realizadoPossuiAnomalia(realizado)
      : false;

      const classeAnomalia =
      possuiAnomalia
      ? "texto-vermelho"
      : "";

      const classeCriticidade =
      realizado
      ? obterClasseCriticidadeAnomalia(realizado)
      : "";

      const tr =
      document.createElement("tr");

      tr.appendChild(
        criarCelulaTexto(
          item.semana || "-"
        )
      );

      tr.appendChild(
        criarCelulaTexto(
          item.periodo || "-"
        )
      );

      tr.appendChild(
        criarCelulaTexto(
          formatarPercentual(
            fisicoPlanejadoRaw
          )
        )
      );

      tr.appendChild(
        criarCelulaTexto(
          formatarMoeda(
            financeiroPlanejadoRaw
          )
        )
      );

      tr.appendChild(
        criarCelulaTexto(
          realizado
          ? formatarPercentual(
            obterFisicoRealizado(
              realizado
            )
          )
          : "-",
          classeFisico
        )
      );

      tr.appendChild(
        criarCelulaTexto(
          realizado
          ? formatarMoeda(
            obterFinanceiroRealizado(
              realizado
            )
          )
          : "-",
          classeFinanceiro
        )
      );

      tr.appendChild(
        criarCelulaTexto(
          centroCusto
        )
      );

      tr.appendChild(
        criarCelulaTexto(
          realizado
          ? obterResumoAnomalia(
            realizado
          )
          : "-",
          classeAnomalia
        )
      );

      tr.appendChild(
        criarCelulaTexto(
          realizado
          ? obterCriticidadeAnomalia(
            realizado
          )
          : "-",
          classeCriticidade
        )
      );

      tr.appendChild(
        criarCelulaTexto(
          realizado
          ? formatarDataAtualizacao(
            realizado
          )
          : "-"
        )
      );

      if (realizado) {

        tr.classList.add(
          "linha-bloqueada"
        );

        tr.title =
        usuarioEhAdministrador(usuarioLogadoGlobal)
        ? "Duplo clique para corrigir esta atualização."
        : "Semana já atualizada. Correção permitida apenas para administrador.";

        tr.addEventListener(
          "dblclick",
          () => {

            prepararCorrecaoRealizado(
              tr,
              item,
              realizado
            );

          }
        );

      } else {

        tr.addEventListener(
          "click",
          () => {

            selecionarSemanaPendente(
              tr,
              item
            );

          }
        );

      }

      tabelaSemanas.appendChild(
        tr
      );

    });

  } catch (error) {

    console.error(
      "Erro ao carregar planejamento:",
      error
    );

    alert(
      "Erro ao carregar planejamento."
    );

  }

}

/* =========================================
   SELECIONAR SEMANA PENDENTE
========================================= */

function selecionarSemanaPendente(tr, item) {

  document
    .querySelectorAll("#tabelaSemanas tr")
    .forEach((linha) => {

      linha.classList.remove(
        "selecionada"
      );

    });

  tr.classList.add(
    "selecionada"
  );

  modoEdicao = false;

  realizadoEmEdicaoId = null;

  semanaSelecionada = {
    semana: item.semana,
    periodo: item.periodo
  };

  if (semanaSelecionadaLabel) {

    semanaSelecionadaLabel.textContent =
    `${item.semana} - ${item.periodo || ""}`;

  }

  if (btnSalvar) {
    btnSalvar.textContent =
    "Salvar Atualização";
  }

  if (inputFisicoReal) {
    inputFisicoReal.value = "";
  }

  if (inputFinanceiroReal) {
    inputFinanceiroReal.value = "";
  }

  if (inputCentroCustoApropriacao) {
    inputCentroCustoApropriacao.value = "";
  }

  if (selectTemAnomalia) {
    selectTemAnomalia.value = "Não";
  }

  limparDetalhesAnomalia();

  atualizarEstadoAnomalia();

  inputFisicoReal?.focus();

}

/* =========================================
   PREPARAR CORREÇÃO DE REALIZADO
========================================= */

function prepararCorrecaoRealizado(
  tr,
  item,
  realizado
) {

  if (!usuarioEhAdministrador(usuarioLogadoGlobal)) {

    alert(
      "Apenas administradores podem corrigir uma semana já atualizada."
    );

    return;

  }

  modoEdicao = true;

  realizadoEmEdicaoId =
  realizado.id;

  semanaSelecionada = {
    semana: item.semana,
    periodo: item.periodo
  };

  if (inputFisicoReal) {

    inputFisicoReal.value =
    obterFisicoRealizado(
      realizado
    );

  }

  if (inputFinanceiroReal) {

    inputFinanceiroReal.value =
    formatarMoeda(
      obterFinanceiroRealizado(
        realizado
      )
    );

  }

  if (inputCentroCustoApropriacao) {

    const centro =
    obterCentroCustoApropriacao(
      realizado
    );

    inputCentroCustoApropriacao.value =
    centro === "-"
    ? ""
    : centro;

  }

  preencherCamposAnomalia(
    realizado
  );

  if (semanaSelecionadaLabel) {

    semanaSelecionadaLabel.textContent =
    `Corrigindo ${item.semana} - ${item.periodo || ""}`;

  }

  document
    .querySelectorAll("#tabelaSemanas tr")
    .forEach((linha) => {

      linha.classList.remove(
        "selecionada"
      );

    });

  tr.classList.add(
    "selecionada"
  );

  if (btnSalvar) {
    btnSalvar.textContent =
    "Salvar Correção";
  }

  inputFisicoReal?.focus();

}

/* =========================================
   VERIFICAR SE JÁ EXISTE REALIZADO
========================================= */

async function buscarRealizadoExistente() {

  const lista = [];

  const consultas = [
    query(
      collection(db, "realizadoCurvaS"),
      where("obraId", "==", obraSelecionada.id),
      where("semana", "==", semanaSelecionada.semana)
    ),
    query(
      collection(db, "realizadoCurvaS"),
      where("obra", "==", obraSelecionada.nomeProjeto),
      where("semana", "==", semanaSelecionada.semana)
    )
  ];

  for (const consulta of consultas) {

    const snapshot =
    await getDocs(consulta);

    snapshot.forEach((docRef) => {

      lista.push({
        id: docRef.id,
        ...docRef.data()
      });

    });

  }

  return lista;

}

/* =========================================
   SALVAR OU CORRIGIR REALIZADO
========================================= */

async function salvarAtualizacaoRealizado() {

  try {

    if (!usuarioLogadoGlobal) {

      alert(
        "Usuário não autenticado. Faça login novamente."
      );

      return;

    }

    if (!obraSelecionada) {

      alert(
        "Selecione uma obra."
      );

      return;

    }

    if (obraEstaParalisada(obraSelecionada)) {

      alert(
        "Esta obra está paralisada. Reative a obra antes de lançar novas atualizações."
      );

      return;

    }

    if (!semanaSelecionada) {

      alert(
        "Selecione uma semana pendente ou dê duplo clique em uma semana atualizada para corrigir."
      );

      return;

    }

    if (
      inputFisicoReal?.value === "" ||
      inputFinanceiroReal?.value === ""
    ) {

      alert(
        "Preencha o físico realizado e o financeiro realizado."
      );

      return;

    }

    if (
      !inputCentroCustoApropriacao ||
      inputCentroCustoApropriacao.value.trim() === ""
    ) {

      alert(
        "Informe o centro de custo de apropriação."
      );

      inputCentroCustoApropriacao?.focus();

      return;

    }

    const fisicoReal =
    converterPercentual(
      inputFisicoReal.value
    );

    const financeiroReal =
    converterMoeda(
      inputFinanceiroReal.value
    );

    if (
      isNaN(fisicoReal) ||
      fisicoReal < 0 ||
      fisicoReal > 100
    ) {

      alert(
        "O físico realizado deve estar entre 0 e 100%."
      );

      return;

    }

    if (
      isNaN(financeiroReal) ||
      financeiroReal < 0
    ) {

      alert(
        "O financeiro realizado deve ser um valor válido."
      );

      return;

    }

    const centroCustoApropriacao =
    inputCentroCustoApropriacao.value.trim();

    const dadosAnomalia =
    obterDadosAnomaliaParaSalvar();

    const anomaliaValida =
    validarDadosAnomalia(
      dadosAnomalia
    );

    if (!anomaliaValida) {
      return;
    }

    if (
      modoEdicao &&
      realizadoEmEdicaoId
    ) {

      if (!usuarioEhAdministrador(usuarioLogadoGlobal)) {

        alert(
          "Apenas administradores podem corrigir uma atualização."
        );

        return;

      }

      await updateDoc(
        doc(
          db,
          "realizadoCurvaS",
          realizadoEmEdicaoId
        ),
        {
          fisicoReal,
          fisicoRealAcum:
          fisicoReal,

          financeiroReal,
          financeiroRealAcum:
          financeiroReal,

          centroCustoApropriacao,

          centroCusto:
          centroCustoApropriacao,

          houveAnomalia:
          dadosAnomalia.houveAnomalia,

          temAnomalia:
          dadosAnomalia.temAnomalia,

          tipoAnomalia:
          dadosAnomalia.tipoAnomalia,

          criticidadeAnomalia:
          dadosAnomalia.criticidadeAnomalia,

          impactoAnomalia:
          dadosAnomalia.impactoAnomalia,

          statusAnomalia:
          dadosAnomalia.statusAnomalia,

          prazoTratativaAnomalia:
          dadosAnomalia.prazoTratativaAnomalia,

          descricaoAnomalia:
          dadosAnomalia.descricaoAnomalia,

          acaoCorretivaAnomalia:
          dadosAnomalia.acaoCorretivaAnomalia,

          responsavelAnomalia:
          dadosAnomalia.responsavelAnomalia,

          anomalias:
          dadosAnomalia.anomalias,

          anomalia:
          dadosAnomalia.anomalia,

          corrigidoPorUid:
          usuarioLogadoGlobal?.uid || "",

          corrigidoPorEmail:
          usuarioLogadoGlobal?.email ||
          usuarioLogadoGlobal?.emailAuth ||
          "",

          corrigidoPorNome:
          usuarioLogadoGlobal?.nome || "",

          corrigidoEm:
          serverTimestamp(),

          atualizadoEm:
          serverTimestamp(),

          dataAtualizacao:
          serverTimestamp()
        }
      );

      alert(
        "Atualização corrigida com sucesso!"
      );

      limparCamposAtualizacao();

      await carregarPlanejamento();

      return;

    }

    const existe =
    await buscarRealizadoExistente();

    if (existe.length > 0) {

      alert(
        "Essa semana já foi atualizada. A correção é permitida apenas para administrador."
      );

      await carregarPlanejamento();

      return;

    }

    await addDoc(
      collection(
        db,
        "realizadoCurvaS"
      ),
      {
        obraId:
        obraSelecionada.id,

        obra:
        obraSelecionada.nomeProjeto,

        obraNome:
        obraSelecionada.nomeProjeto,

        regional:
        obraSelecionada.regional || "",

        localidade:
        obraSelecionada.localidade || "",

        valorOrcado:
        obterValorOrcadoObra(
          obraSelecionada
        ),

        semana:
        semanaSelecionada.semana,

        periodo:
        semanaSelecionada.periodo,

        fisicoReal,

        fisicoRealAcum:
        fisicoReal,

        financeiroReal,

        financeiroRealAcum:
        financeiroReal,

        centroCustoApropriacao,

        centroCusto:
        centroCustoApropriacao,

        houveAnomalia:
        dadosAnomalia.houveAnomalia,

        temAnomalia:
        dadosAnomalia.temAnomalia,

        tipoAnomalia:
        dadosAnomalia.tipoAnomalia,

        criticidadeAnomalia:
        dadosAnomalia.criticidadeAnomalia,

        impactoAnomalia:
        dadosAnomalia.impactoAnomalia,

        statusAnomalia:
        dadosAnomalia.statusAnomalia,

        prazoTratativaAnomalia:
        dadosAnomalia.prazoTratativaAnomalia,

        descricaoAnomalia:
        dadosAnomalia.descricaoAnomalia,

        acaoCorretivaAnomalia:
        dadosAnomalia.acaoCorretivaAnomalia,

        responsavelAnomalia:
        dadosAnomalia.responsavelAnomalia,

        anomalias:
        dadosAnomalia.anomalias,

        anomalia:
        dadosAnomalia.anomalia,

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
        serverTimestamp(),

        dataAtualizacao:
        serverTimestamp()
      }
    );

    alert(
      "Atualização salva com sucesso!"
    );

    limparCamposAtualizacao();

    await carregarPlanejamento();

  } catch (error) {

    console.error(
      "Erro ao salvar atualização:",
      error
    );

    alert(
      "Erro ao salvar atualização. Verifique suas permissões no Firestore."
    );

  }

}

/* =========================================
   EVENTOS
========================================= */

function configurarEventos() {

  configurarMascaraFinanceiro();

  configurarStatusObra();

  configurarAnomalias();

  configurarFiltroRegional();

  configurarFiltroLocalidade();

  configurarFiltroObra();

  btnSalvar?.addEventListener(
    "click",
    salvarAtualizacaoRealizado
  );

}

/* =========================================
   INICIAR
========================================= */

document.addEventListener(
  "DOMContentLoaded",
  async () => {

    try {

      usuarioLogadoGlobal =
      await protegerPagina();

      limparStatusObra();

      configurarEventos();

      await carregarObras();

    } catch (error) {

      console.error(
        "Erro ao iniciar atualização da Curva S:",
        error
      );

      alert(
        "Erro ao iniciar a tela de atualização da Curva S."
      );

    }

  }
);