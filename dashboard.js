/* =====================================================
   DASHBOARD - PAINEL EXECUTIVO DE OBRAS
   Arquivo: dashboard.js
   Versão: v011
===================================================== */

import {
  db
} from "./firebaseConfig.js";

import {
  protegerPagina,
  sairDoSistema,
  usuarioEhAdministrador as usuarioEhAdministradorSistema
} from "./authGuard.js";

import {
  collection,
  getDocs
} from "https://www.gstatic.com/firebasejs/10.12.3/firebase-firestore.js";

/* =====================================================
   CHART JS GLOBAL
===================================================== */

const ChartJS =
window.Chart;

if (
  ChartJS &&
  window.ChartDataLabels
) {

  ChartJS.register(
    window.ChartDataLabels
  );

  ChartJS.defaults.font.family =
  "'Segoe UI', sans-serif";

  ChartJS.defaults.font.size =
  11;

  ChartJS.defaults.font.weight =
  "600";

  ChartJS.defaults.color =
  "#333";

}

/* =====================================================
   VARIÁVEIS
===================================================== */

let obras = [];

let planejamentosBanco = [];

let realizadosBanco = [];

let graficoFisico = null;

let graficoFinanceiro = null;

let usuarioLogadoGlobal = null;

/* =====================================================
   ELEMENTOS
===================================================== */

const filtroRegional =
document.getElementById("filtroRegional");

const filtroLocalidade =
document.getElementById("filtroLocalidade");

const filtroObra =
document.getElementById("filtroObra");

const filtroStatus =
document.getElementById("filtroStatus");

const tbodyObras =
document.getElementById("tbodyObras");

const tbodyPlanejado =
document.getElementById("tbodyPlanejado");

const detalhamentoPlanejamento =
document.getElementById("detalhamentoPlanejamento");

const btnExportarPDF =
document.getElementById("btnExportarPDF");

const cardEmAndamento =
document.getElementById("cardEmAndamento");

const cardConcluidas =
document.getElementById("cardConcluidas");

const cardPlanejadas =
document.getElementById("cardPlanejadas");

const cardParalisadas =
document.getElementById("cardParalisadas");

/* =====================================================
   REGIONAIS
===================================================== */

const regionaisMap = {

  "Arari": "Regional 1",

  "Vitória do Mearim": "Regional 1",

  "Santa Inês": "Regional 1",

  "Alto Alegre": "Regional 1",

  "Alto Alegre do Pindaré": "Regional 1",

  "Altamira": "Regional 1",

  "Auzilândia": "Regional 1",

  "Vila Pindaré": "Regional 1",

  "Mineirinho": "Regional 1",

  "Açailândia": "Regional 2",

  "Nova Vida": "Regional 2",

  "Marabá": "Regional 3",

  "São Pedro d’Água Branca": "Regional 3",

  "São Pedro d'Água Branca": "Regional 3",

  "Itainópolis": "Regional 3",

  "São Luís": "São Luís"

};

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

function normalizarStatus(valor) {

  const texto =
  normalizarTexto(valor);

  if (
    texto === "planejado" ||
    texto === "planejada"
  ) {
    return "planejada";
  }

  if (
    texto === "em andamento" ||
    texto === "andamento" ||
    texto === "execucao" ||
    texto === "execução"
  ) {
    return "em andamento";
  }

  if (
    texto === "concluido" ||
    texto === "concluida"
  ) {
    return "concluida";
  }

  if (
    texto === "paralisado" ||
    texto === "paralisada"
  ) {
    return "paralisada";
  }

  return texto;

}

function usuarioEhAdministrador(usuario) {

  return usuarioEhAdministradorSistema(
    usuario
  );

}

/* =====================================================
   STATUS DA OBRA
===================================================== */

function calcularStatusObra(
  dadosObra,
  executadoFisico,
  executadoFinanceiro
) {

  const statusManual =
  normalizarStatus(
    dadosObra.status ||
    dadosObra.statusNovo ||
    dadosObra.fase ||
    ""
  );

  const fisico =
  Number(executadoFisico || 0);

  const financeiro =
  Number(executadoFinanceiro || 0);

  if (statusManual === "paralisada") {
    return "Paralisada";
  }

  if (
    statusManual === "concluida" ||
    fisico >= 100
  ) {
    return "Concluída";
  }

  if (
    fisico > 0 &&
    fisico < 100
  ) {
    return "Em andamento";
  }

  if (
    financeiro > 0 &&
    fisico === 0
  ) {
    return "Paralisada";
  }

  if (statusManual === "em andamento") {
    return "Em andamento";
  }

  return "Planejada";

}

/* =====================================================
   FORMATAÇÕES
===================================================== */

function moeda(valor) {

  return Number(valor || 0)
    .toLocaleString(
      "pt-BR",
      {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
      }
    );

}

function percentual(valor) {

  return `${Number(valor || 0)
    .toFixed(2)
    .replace(".", ",")}%`;

}

function converterValor(valor) {

  if (
    valor === null ||
    valor === undefined ||
    valor === ""
  ) {
    return 0;
  }

  if (typeof valor === "number") {

    return Number.isFinite(valor)
    ? valor
    : 0;

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

function converterPercentual(valor) {

  if (
    valor === null ||
    valor === undefined ||
    valor === ""
  ) {
    return 0;
  }

  if (typeof valor === "number") {

    return Number.isFinite(valor)
    ? valor
    : 0;

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

function financeiroParaPercentual(
  valorFinanceiro,
  valorBase
) {

  const base =
  Number(valorBase || 0);

  if (base <= 0) {
    return 0;
  }

  return (
    Number(valorFinanceiro || 0) /
    base
  ) * 100;

}

/* =====================================================
   DATAS
===================================================== */

function converterDataBRParaDate(valor) {

  if (!valor) {
    return null;
  }

  const partes =
  String(valor)
    .trim()
    .split("/");

  if (partes.length !== 3) {
    return null;
  }

  const dia =
  Number(partes[0]);

  const mes =
  Number(partes[1]) - 1;

  const ano =
  Number(partes[2]);

  const data =
  new Date(
    ano,
    mes,
    dia
  );

  if (isNaN(data.getTime())) {
    return null;
  }

  return data;

}

function converterDataISOParaDate(valor) {

  if (!valor) {
    return null;
  }

  const texto =
  String(valor)
    .trim()
    .split("T")[0];

  const match =
  texto.match(
    /^(\d{4})-(\d{2})-(\d{2})$/
  );

  if (!match) {
    return null;
  }

  const ano =
  Number(match[1]);

  const mes =
  Number(match[2]) - 1;

  const dia =
  Number(match[3]);

  const data =
  new Date(
    ano,
    mes,
    dia
  );

  if (isNaN(data.getTime())) {
    return null;
  }

  return data;

}

function obterDataGenerica(valor) {

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

  if (valor instanceof Date) {

    return isNaN(valor.getTime())
    ? null
    : valor;

  }

  if (typeof valor === "string") {

    const texto =
    valor.trim();

    if (!texto) {
      return null;
    }

    if (texto.includes("/")) {
      return converterDataBRParaDate(texto);
    }

    if (
      /^\d{4}-\d{2}-\d{2}/.test(texto)
    ) {
      return converterDataISOParaDate(texto);
    }

  }

  const data =
  new Date(valor);

  if (isNaN(data.getTime())) {
    return null;
  }

  return data;

}

function formatarData(data) {

  const dt =
  obterDataGenerica(data);

  if (!dt) {
    return "-";
  }

  return dt.toLocaleDateString(
    "pt-BR"
  );

}

function obterDataInicioObra(dados) {

  return obterDataGenerica(
    dados.dataInicio ||
    dados.dataInicioPrevisto ||
    dados.inicioPrevisto ||
    dados.inicio ||
    dados.dataInicioObra ||
    dados.dataInicial ||
    dados.inicioObra ||
    ""
  );

}

function obterDataFimObra(dados) {

  return obterDataGenerica(
    dados.dataFim ||
    dados.dataTerminoPrevisto ||
    dados.dataFimPrevisto ||
    dados.dataTermino ||
    dados.terminoPrevisto ||
    dados.termino ||
    dados.fim ||
    dados.dataFimObra ||
    dados.dataFinal ||
    dados.terminoObra ||
    ""
  );

}

function extrairDatasPeriodo(periodo) {

  if (!periodo) {

    return {
      inicio: null,
      fim: null
    };

  }

  const texto =
  String(periodo)
    .replace(/\s+/g, " ")
    .trim();

  const matchBR =
  texto.match(
    /(\d{2}\/\d{2}\/\d{4})\s*a\s*(\d{2}\/\d{2}\/\d{4})/i
  );

  if (matchBR) {

    return {

      inicio:
      converterDataBRParaDate(
        matchBR[1]
      ),

      fim:
      converterDataBRParaDate(
        matchBR[2]
      )

    };

  }

  const matchISO =
  texto.match(
    /(\d{4}-\d{2}-\d{2})\s*a\s*(\d{4}-\d{2}-\d{2})/i
  );

  if (matchISO) {

    return {

      inicio:
      converterDataISOParaDate(
        matchISO[1]
      ),

      fim:
      converterDataISOParaDate(
        matchISO[2]
      )

    };

  }

  return {
    inicio: null,
    fim: null
  };

}

function obterDatasDoPlanejamento(item) {

  const datasPeriodo =
  extrairDatasPeriodo(
    item.periodo
  );

  let inicio =
  datasPeriodo.inicio;

  let fim =
  datasPeriodo.fim;

  if (!inicio) {

    inicio =
    obterDataGenerica(
      item.dataInicio ||
      item.inicio ||
      item.dataInicial
    );

  }

  if (!fim) {

    fim =
    obterDataGenerica(
      item.dataFim ||
      item.fim ||
      item.dataFinal
    );

  }

  return {
    inicio,
    fim
  };

}

/* =====================================================
   SEMANAS
===================================================== */

function numeroSemana(valor) {

  return parseInt(
    String(valor || "")
      .replace(/\D/g, "")
  ) || 0;

}

function chaveSemana(valor) {

  return String(valor || "")
    .trim()
    .toUpperCase();

}

function obterTimestampComparacao(item) {

  const data =
  obterDataGenerica(
    item?.atualizadoEm ||
    item?.criadoEm ||
    item?.dataAtualizacao ||
    item?.dataRegistro
  );

  return data
  ? data.getTime()
  : 0;

}

/* =====================================================
   REALIZADO ACUMULADO
===================================================== */

function obterFisicoRealizadoAcumulado(item) {

  if (!item) {
    return 0;
  }

  if (item.fisicoRealAcum !== undefined) {
    return converterPercentual(item.fisicoRealAcum);
  }

  if (item.fisicoAcum !== undefined) {
    return converterPercentual(item.fisicoAcum);
  }

  if (item.fisicoAcumulado !== undefined) {
    return converterPercentual(item.fisicoAcumulado);
  }

  if (item.avancoFisicoAcumulado !== undefined) {
    return converterPercentual(item.avancoFisicoAcumulado);
  }

  if (item.fisicoReal !== undefined) {
    return converterPercentual(item.fisicoReal);
  }

  if (item.avancoFisicoNovo !== undefined) {
    return converterPercentual(item.avancoFisicoNovo);
  }

  if (item.avancoFisico !== undefined) {
    return converterPercentual(item.avancoFisico);
  }

  return converterPercentual(
    item.fisico || 0
  );

}

function obterFinanceiroRealizadoAcumulado(item) {

  if (!item) {
    return 0;
  }

  if (item.financeiroRealAcum !== undefined) {
    return converterValor(item.financeiroRealAcum);
  }

  if (item.financeiroAcum !== undefined) {
    return converterValor(item.financeiroAcum);
  }

  if (item.financeiroRealAcumulado !== undefined) {
    return converterValor(item.financeiroRealAcumulado);
  }

  if (item.financeiroAcumulado !== undefined) {
    return converterValor(item.financeiroAcumulado);
  }

  if (item.valorExecutado !== undefined) {
    return converterValor(item.valorExecutado);
  }

  if (item.executado !== undefined) {
    return converterValor(item.executado);
  }

  if (item.financeiroReal !== undefined) {
    return converterValor(item.financeiroReal);
  }

  if (item.investimentoNovo !== undefined) {
    return converterValor(item.investimentoNovo);
  }

  return converterValor(
    item.financeiro || 0
  );

}

/* =====================================================
   VALOR ORÇADO
===================================================== */

function obterValorOrcadoObra(dados) {

  return converterValor(
    dados.valorObra ||
    dados.valorOrcado ||
    dados.valorOrçado ||
    dados.orcado ||
    dados.investimento ||
    dados.valorTotal ||
    dados.valor ||
    dados.custoTotal ||
    0
  );

}

/* =====================================================
   MATCH ENTRE OBRA, PLANEJAMENTO E REALIZADO
===================================================== */

function registroPertenceAObra(
  registro,
  obra
) {

  if (!registro || !obra) {
    return false;
  }

  const chavesObra = [
    obra.firebaseId,
    obra.idProjeto,
    obra.idObra,
    obra.obraId,
    obra.nomeProjeto
  ]
    .filter(Boolean)
    .map(normalizarTexto);

  const chavesRegistro = [
    registro.obraId,
    registro.idObra,
    registro.idProjeto,
    registro.projetoId,
    registro.obraDocId,
    registro.obra,
    registro.obraNome,
    registro.nomeObra,
    registro.nomeProjeto,
    registro.projeto
  ]
    .filter(Boolean)
    .map(normalizarTexto);

  return chavesRegistro.some((chave) =>
    chavesObra.includes(chave)
  );

}

/* =====================================================
   DEDUPLICAR POR SEMANA
===================================================== */

function deduplicarPorSemana(lista) {

  const mapa =
  new Map();

  lista.forEach((item) => {

    const numero =
    numeroSemana(
      item.semana
    );

    if (numero <= 0) {
      return;
    }

    const existente =
    mapa.get(numero);

    if (!existente) {

      mapa.set(
        numero,
        item
      );

      return;

    }

    const timestampAtual =
    obterTimestampComparacao(
      item
    );

    const timestampExistente =
    obterTimestampComparacao(
      existente
    );

    if (timestampAtual >= timestampExistente) {

      mapa.set(
        numero,
        item
      );

    }

  });

  return Array.from(
    mapa.values()
  )
    .sort((a, b) => {

      return numeroSemana(a.semana) -
      numeroSemana(b.semana);

    });

}

/* =====================================================
   CONTROLE VISUAL DO ADMIN
===================================================== */

function aplicarPerfilVisual(usuario) {

  const admin =
  usuarioEhAdministrador(usuario);

  document.body.classList.toggle(
    "usuario-admin",
    admin
  );

}

/* =====================================================
   MENU ATIVO
===================================================== */

function configurarMenuAtivo() {

  const paginaAtual =
  window.location.pathname
    .split("/")
    .pop() ||
  "dashboard.html";

  document
    .querySelectorAll(".menu a")
    .forEach((link) => {

      const href =
      link.getAttribute("href") || "";

      if (
        !href ||
        href === "#"
      ) {

        link.classList.remove(
          "active"
        );

        return;

      }

      const paginaLink =
      href
        .replace("./", "")
        .split("/")
        .pop();

      link.classList.toggle(
        "active",
        paginaLink === paginaAtual
      );

    });

}

/* =====================================================
   HELPERS DE TABELA
===================================================== */

function criarCelulaTexto(texto, classe = "") {

  const td =
  document.createElement("td");

  if (classe) {
    td.className =
    classe;
  }

  td.textContent =
  texto || "-";

  return td;

}

function criarCelulaHTMLSeguro(texto, classe = "") {

  const td =
  document.createElement("td");

  if (classe) {
    td.className =
    classe;
  }

  td.textContent =
  texto || "-";

  return td;

}

function mostrarMensagemTabela(tbody, mensagem, colunas) {

  if (!tbody) {
    return;
  }

  tbody.innerHTML =
  "";

  const tr =
  document.createElement("tr");

  const td =
  document.createElement("td");

  td.colSpan =
  colunas;

  td.textContent =
  mensagem;

  tr.appendChild(td);

  tbody.appendChild(tr);

}

/* =====================================================
   SELECTS SEGUROS
===================================================== */

function limparSelect(select, textoPadrao) {

  if (!select) {
    return;
  }

  select.innerHTML =
  "";

  const option =
  document.createElement("option");

  option.value =
  "";

  option.textContent =
  textoPadrao;

  select.appendChild(option);

}

function adicionarOption(select, valor, texto = valor) {

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

/* =====================================================
   LIMPAR DETALHAMENTO
===================================================== */

function limparDetalhamento() {

  if (detalhamentoPlanejamento) {
    detalhamentoPlanejamento.style.display =
    "none";
  }

  if (tbodyPlanejado) {

    mostrarMensagemTabela(
      tbodyPlanejado,
      "Selecione uma obra para visualizar o acompanhamento.",
      6
    );

  }

  if (graficoFisico) {

    graficoFisico.destroy();

    graficoFisico =
    null;

  }

  if (graficoFinanceiro) {

    graficoFinanceiro.destroy();

    graficoFinanceiro =
    null;

  }

}

/* =====================================================
   REDIMENSIONAR GRÁFICOS
===================================================== */

function redimensionarGraficos() {

  window.requestAnimationFrame(() => {

    setTimeout(() => {

      if (graficoFisico) {
        graficoFisico.resize();
        graficoFisico.update();
      }

      if (graficoFinanceiro) {
        graficoFinanceiro.resize();
        graficoFinanceiro.update();
      }

    }, 150);

  });

}

/* =====================================================
   MENU LATERAL RETRÁTIL
===================================================== */

function configurarMenuLateral() {

  const menuBtn =
  document.querySelector(".menu-btn");

  const sidebar =
  document.querySelector(".sidebar");

  const main =
  document.querySelector(".main");

  if (
    menuBtn &&
    sidebar &&
    main
  ) {

    menuBtn.addEventListener(
      "click",
      () => {

        sidebar.classList.toggle(
          "collapsed"
        );

        main.classList.toggle(
          "expanded"
        );

        redimensionarGraficos();

      }
    );

  }

}

/* =====================================================
   SAIR DO SISTEMA
===================================================== */

function configurarBotaoSair() {

  const botoesSair =
  document.querySelectorAll(
    "#btnSairSistema, #btnSair, .logout-link"
  );

  if (!botoesSair.length) {
    return;
  }

  botoesSair.forEach((btn) => {

    btn.addEventListener(
      "click",
      async (event) => {

        event.preventDefault();

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

  });

}

/* =====================================================
   CARREGAR COLEÇÕES BASE
===================================================== */

async function carregarColecao(nomeColecao) {

  const snapshot =
  await getDocs(
    collection(
      db,
      nomeColecao
    )
  );

  return snapshot.docs.map((documento) => ({
    firebaseId: documento.id,
    docId: documento.id,
    ...documento.data()
  }));

}

/* =====================================================
   CARREGAR OBRAS
===================================================== */

async function carregarObrasFirebase() {

  try {

    obras = [];

    limparDetalhamento();

    if (tbodyObras) {

      mostrarMensagemTabela(
        tbodyObras,
        "Carregando obras...",
        11
      );

    }

    const obrasBanco =
    await carregarColecao("obras");

    planejamentosBanco =
    await carregarColecao("planejamentoCurvaS");

    realizadosBanco =
    await carregarColecao("realizadoCurvaS");

    let contadorId =
    1;

    for (const dados of obrasBanco) {

      const idPadrao =
      dados.idProjeto ||
      dados.idObra ||
      `OBR-${String(contadorId).padStart(4, "0")}`;

      contadorId++;

      const nomeProjeto =
      dados.nomeProjeto ||
      dados.nomeObra ||
      dados.obraNome ||
      dados.obra ||
      "-";

      const dataInicioObraPrincipal =
      obterDataInicioObra(
        dados
      );

      const dataFimObraPrincipal =
      obterDataFimObra(
        dados
      );

      const obraBase = {

        firebaseId:
        dados.firebaseId,

        idProjeto:
        idPadrao,

        idObra:
        dados.idObra || "",

        obraId:
        dados.obraId || "",

        nomeProjeto:
        nomeProjeto,

        localidade:
        dados.localidade || "-",

        centroCusto:
        dados.centroCusto ||
        dados.centroDeCusto ||
        dados.numeroOM ||
        "-",

        regional:
        dados.regional ||
        regionaisMap[
          dados.localidade
        ] ||
        "Não definida",

        investimento:
        obterValorOrcadoObra(
          dados
        ),

        gutScore:
        Number(
          dados.score ||
          dados.gutScore ||
          0
        ),

        statusOriginal:
        dados.status ||
        dados.statusNovo ||
        dados.fase ||
        "",

        dadosOriginais:
        dados

      };

      let planejamentoListaResumo =
      planejamentosBanco.filter((item) =>
        registroPertenceAObra(
          item,
          obraBase
        )
      );

      planejamentoListaResumo =
      deduplicarPorSemana(
        planejamentoListaResumo
      );

      let dataInicioPlanejamento =
      null;

      let dataFimPlanejamento =
      null;

      let acumuladoFisicoPlanejadoResumo =
      0;

      let acumuladoFinanceiroPlanejadoResumo =
      0;

      let planejadoFisicoFinal =
      0;

      let planejadoFinanceiro =
      0;

      const planejadoFisicoPorSemana =
      new Map();

      planejamentoListaResumo.forEach((item) => {

        const datasPlanejamento =
        obterDatasDoPlanejamento(
          item
        );

        if (
          datasPlanejamento.inicio &&
          (
            !dataInicioPlanejamento ||
            datasPlanejamento.inicio < dataInicioPlanejamento
          )
        ) {

          dataInicioPlanejamento =
          datasPlanejamento.inicio;

        }

        if (
          datasPlanejamento.fim &&
          (
            !dataFimPlanejamento ||
            datasPlanejamento.fim > dataFimPlanejamento
          )
        ) {

          dataFimPlanejamento =
          datasPlanejamento.fim;

        }

        const fisicoSemana =
        converterPercentual(
          item.fisico ||
          item.fisicoPlanejado ||
          0
        );

        const financeiroSemana =
        converterValor(
          item.financeiro ||
          item.financeiroPlanejado ||
          item.valorPlanejado ||
          0
        );

        acumuladoFisicoPlanejadoResumo =
        item.fisicoAcum !== undefined
        ? converterPercentual(item.fisicoAcum)
        : item.fisicoAcumulado !== undefined
        ? converterPercentual(item.fisicoAcumulado)
        : acumuladoFisicoPlanejadoResumo + fisicoSemana;

        acumuladoFinanceiroPlanejadoResumo =
        item.financeiroAcum !== undefined
        ? converterValor(item.financeiroAcum)
        : item.financeiroAcumulado !== undefined
        ? converterValor(item.financeiroAcumulado)
        : acumuladoFinanceiroPlanejadoResumo + financeiroSemana;

        planejadoFisicoFinal =
        acumuladoFisicoPlanejadoResumo;

        planejadoFinanceiro =
        acumuladoFinanceiroPlanejadoResumo;

        const numeroDaSemana =
        numeroSemana(
          item.semana
        );

        if (numeroDaSemana > 0) {

          planejadoFisicoPorSemana.set(
            numeroDaSemana,
            acumuladoFisicoPlanejadoResumo
          );

        }

      });

      const dataInicioExibicao =
      dataInicioObraPrincipal ||
      dataInicioPlanejamento;

      const dataFimExibicao =
      dataFimObraPrincipal ||
      dataFimPlanejamento;

      let realizadoListaResumo =
      realizadosBanco.filter((item) =>
        registroPertenceAObra(
          item,
          obraBase
        )
      );

      realizadoListaResumo =
      deduplicarPorSemana(
        realizadoListaResumo
      );

      const ultimoRealizado =
      realizadoListaResumo[
        realizadoListaResumo.length - 1
      ];

      const executadoFisico =
      ultimoRealizado
      ? obterFisicoRealizadoAcumulado(
        ultimoRealizado
      )
      : 0;

      const executadoFinanceiro =
      ultimoRealizado
      ? obterFinanceiroRealizadoAcumulado(
        ultimoRealizado
      )
      : converterValor(
        dados.valorExecutado ||
        dados.executado ||
        0
      );

      const statusCalculado =
      calcularStatusObra(
        dados,
        executadoFisico,
        executadoFinanceiro
      );

      const numeroSemanaUltimoRealizado =
      ultimoRealizado
      ? numeroSemana(
        ultimoRealizado.semana
      )
      : 0;

      const planejadoFisicoAteSemanaAtual =
      planejadoFisicoPorSemana.get(
        numeroSemanaUltimoRealizado
      ) ||
      planejadoFisicoFinal ||
      0;

      const afo =
      planejadoFisicoAteSemanaAtual > 0
      ? (
        executadoFisico /
        planejadoFisicoAteSemanaAtual
      ) * 100
      : 0;

      obras.push({

        ...obraBase,

        planejadoFinanceiro:
        planejadoFinanceiro,

        executado:
        executadoFinanceiro,

        avancoFisico:
        executadoFisico,

        planejadoFisicoAteSemanaAtual:
        planejadoFisicoAteSemanaAtual,

        afo:
        afo,

        fase:
        statusCalculado,

        dataInicioObra:
        dataInicioExibicao,

        dataFimObra:
        dataFimExibicao,

        dataInicioPlanejamento:
        dataInicioExibicao,

        dataFimPlanejamento:
        dataFimExibicao,

        dataInicioCurvaS:
        dataInicioPlanejamento,

        dataFimCurvaS:
        dataFimPlanejamento,

        replanejamentoNecessario:
        Boolean(
          dados.replanejamentoNecessario ||
          dados.reprogramacaoNecessaria
        )

      });

    }

    carregarRegionais();
    carregarLocalidades();
    carregarFiltroObras();
    atualizarCardsStatus();
    renderTabela();

  } catch (error) {

    console.error(
      "Erro ao carregar obras:",
      error
    );

    mostrarMensagemTabela(
      tbodyObras,
      "Erro ao carregar obras. Verifique suas permissões no Firestore.",
      11
    );

  }

}

/* =====================================================
   CARREGAR REGIONAIS
===================================================== */

function carregarRegionais() {

  if (!filtroRegional) {
    return;
  }

  const valorAtual =
  filtroRegional.value;

  limparSelect(
    filtroRegional,
    "Todas"
  );

  const regionais =
  [...new Set(
    obras.map(
      item => item.regional
    )
  )]
    .filter(Boolean)
    .sort((a, b) => {

      return String(a)
        .localeCompare(
          String(b),
          "pt-BR"
        );

    });

  regionais.forEach((regional) => {

    adicionarOption(
      filtroRegional,
      regional
    );

  });

  if (regionais.includes(valorAtual)) {

    filtroRegional.value =
    valorAtual;

  }

}

/* =====================================================
   CARREGAR LOCALIDADES
===================================================== */

function carregarLocalidades() {

  if (!filtroLocalidade) {
    return;
  }

  const valorAtual =
  filtroLocalidade.value;

  limparSelect(
    filtroLocalidade,
    "Todas"
  );

  let lista =
  [...obras];

  if (filtroRegional?.value) {

    lista =
    lista.filter(
      item =>
      item.regional === filtroRegional.value
    );

  }

  const localidades =
  [...new Set(
    lista.map(
      item => item.localidade
    )
  )]
    .filter(Boolean)
    .sort((a, b) => {

      return String(a)
        .localeCompare(
          String(b),
          "pt-BR"
        );

    });

  localidades.forEach((localidade) => {

    adicionarOption(
      filtroLocalidade,
      localidade
    );

  });

  if (localidades.includes(valorAtual)) {

    filtroLocalidade.value =
    valorAtual;

  }

}

/* =====================================================
   CARREGAR FILTRO OBRAS
===================================================== */

function carregarFiltroObras() {

  if (!filtroObra) {
    return;
  }

  const valorAtual =
  filtroObra.value;

  limparSelect(
    filtroObra,
    "Todas"
  );

  let lista =
  [...obras];

  if (filtroRegional?.value) {

    lista =
    lista.filter(
      item =>
      item.regional === filtroRegional.value
    );

  }

  if (filtroLocalidade?.value) {

    lista =
    lista.filter(
      item =>
      item.localidade === filtroLocalidade.value
    );

  }

  lista
    .sort((a, b) => {

      return String(a.nomeProjeto || "")
        .localeCompare(
          String(b.nomeProjeto || ""),
          "pt-BR"
        );

    })
    .forEach((obra) => {

      adicionarOption(
        filtroObra,
        obra.nomeProjeto
      );

    });

  const obrasPermitidas =
  lista.map((obra) =>
    obra.nomeProjeto
  );

  if (obrasPermitidas.includes(valorAtual)) {

    filtroObra.value =
    valorAtual;

  }

}

/* =====================================================
   FILTRAR OBRAS
===================================================== */

function obterObrasFiltradas(aplicarStatus = true) {

  let lista =
  [...obras];

  if (filtroRegional?.value) {

    lista =
    lista.filter(
      item =>
      item.regional === filtroRegional.value
    );

  }

  if (filtroLocalidade?.value) {

    lista =
    lista.filter(
      item =>
      item.localidade === filtroLocalidade.value
    );

  }

  if (filtroObra?.value) {

    lista =
    lista.filter(
      item =>
      item.nomeProjeto === filtroObra.value
    );

  }

  if (
    aplicarStatus &&
    filtroStatus?.value
  ) {

    const statusFiltro =
    normalizarStatus(
      filtroStatus.value
    );

    lista =
    lista.filter((item) => {

      return normalizarStatus(
        item.fase
      ) === statusFiltro;

    });

  }

  return lista;

}

/* =====================================================
   CARDS DE STATUS
===================================================== */

function atualizarCardsStatus() {

  const lista =
  obterObrasFiltradas(false);

  const total = {
    andamento: 0,
    concluidas: 0,
    planejadas: 0,
    paralisadas: 0
  };

  lista.forEach((obra) => {

    const status =
    normalizarStatus(
      obra.fase
    );

    if (status === "em andamento") {
      total.andamento++;
    }

    if (status === "concluida") {
      total.concluidas++;
    }

    if (status === "planejada") {
      total.planejadas++;
    }

    if (status === "paralisada") {
      total.paralisadas++;
    }

  });

  if (cardEmAndamento) {
    cardEmAndamento.textContent =
    total.andamento;
  }

  if (cardConcluidas) {
    cardConcluidas.textContent =
    total.concluidas;
  }

  if (cardPlanejadas) {
    cardPlanejadas.textContent =
    total.planejadas;
  }

  if (cardParalisadas) {
    cardParalisadas.textContent =
    total.paralisadas;
  }

}

/* =====================================================
   RENDER TABELA DE OBRAS
===================================================== */

function renderTabela() {

  atualizarCardsStatus();

  if (!tbodyObras) {
    return;
  }

  tbodyObras.innerHTML =
  "";

  const lista =
  obterObrasFiltradas(true);

  if (lista.length === 0) {

    mostrarMensagemTabela(
      tbodyObras,
      "Nenhuma obra encontrada.",
      11
    );

    limparDetalhamento();

    return;

  }

  lista.forEach((item) => {

    const desvio =
    item.investimento -
    item.executado;

    const tr =
    document.createElement("tr");

    tr.addEventListener(
      "click",
      () => {

        selecionarLinha(
          tr
        );

        abrirPlanejamento(
          item.firebaseId
        );

      }
    );

    tr.appendChild(
      criarCelulaTexto(
        item.idProjeto
      )
    );

    tr.appendChild(
      criarCelulaTexto(
        item.nomeProjeto,
        "nome-obra"
      )
    );

    tr.appendChild(
      criarCelulaTexto(
        item.localidade
      )
    );

    tr.appendChild(
      criarCelulaTexto(
        formatarData(
          item.dataInicioObra
        )
      )
    );

    tr.appendChild(
      criarCelulaTexto(
        formatarData(
          item.dataFimObra
        )
      )
    );

    tr.appendChild(
      criarCelulaTexto(
        item.centroCusto
      )
    );

    tr.appendChild(
      criarCelulaTexto(
        `R$ ${moeda(item.investimento)}`
      )
    );

    tr.appendChild(
      criarCelulaTexto(
        `R$ ${moeda(item.executado)}`
      )
    );

    tr.appendChild(
      criarCelulaTexto(
        `R$ ${moeda(desvio)}`
      )
    );

    tr.appendChild(
      criarCelulaTexto(
        percentual(
          item.avancoFisico
        )
      )
    );

    tr.appendChild(
      criarCelulaTexto(
        percentual(
          item.afo
        )
      )
    );

    tbodyObras.appendChild(
      tr
    );

  });

}

/* =====================================================
   SELECIONAR LINHA
===================================================== */

function selecionarLinha(linha) {

  document
    .querySelectorAll(
      "#tbodyObras tr"
    )
    .forEach((tr) => {

      tr.classList.remove(
        "selected"
      );

    });

  linha.classList.add(
    "selected"
  );

}

window.selecionarLinha =
selecionarLinha;

/* =====================================================
   ABRIR PLANEJAMENTO
===================================================== */

async function abrirPlanejamento(idProjeto) {

  if (!detalhamentoPlanejamento) {
    return;
  }

  if (!tbodyPlanejado) {
    return;
  }

  detalhamentoPlanejamento.style.display =
  "block";

  const obraSelecionada =
  obras.find(
    item =>
    item.firebaseId === idProjeto
  );

  if (!obraSelecionada) {
    return;
  }

  mostrarMensagemTabela(
    tbodyPlanejado,
    "Carregando planejamento...",
    6
  );

  let planejadoLista =
  planejamentosBanco.filter((item) =>
    registroPertenceAObra(
      item,
      obraSelecionada
    )
  );

  planejadoLista =
  deduplicarPorSemana(
    planejadoLista
  );

  let realizadoLista =
  realizadosBanco.filter((item) =>
    registroPertenceAObra(
      item,
      obraSelecionada
    )
  );

  realizadoLista =
  deduplicarPorSemana(
    realizadoLista
  );

  const semanasPlanejadas =
  new Set();

  let acumuladoFisicoPlanejado =
  0;

  let acumuladoFinanceiroPlanejado =
  0;

  const planejadoTratado =
  [];

  planejadoLista.forEach((item) => {

    const chave =
    `${item.semana}_${item.periodo}`;

    if (semanasPlanejadas.has(chave)) {
      return;
    }

    semanasPlanejadas.add(chave);

    const fisico =
    converterPercentual(
      item.fisico ||
      item.fisicoPlanejado ||
      0
    );

    const financeiro =
    converterValor(
      item.financeiro ||
      item.financeiroPlanejado ||
      item.valorPlanejado ||
      0
    );

    acumuladoFisicoPlanejado =
    item.fisicoAcum !== undefined
    ? converterPercentual(item.fisicoAcum)
    : item.fisicoAcumulado !== undefined
    ? converterPercentual(item.fisicoAcumulado)
    : acumuladoFisicoPlanejado + fisico;

    acumuladoFinanceiroPlanejado =
    item.financeiroAcum !== undefined
    ? converterValor(item.financeiroAcum)
    : item.financeiroAcumulado !== undefined
    ? converterValor(item.financeiroAcumulado)
    : acumuladoFinanceiroPlanejado + financeiro;

    planejadoTratado.push({

      ...item,

      fisico,
      financeiro,

      fisicoAcumuladoCalculado:
      acumuladoFisicoPlanejado,

      financeiroAcumuladoCalculado:
      acumuladoFinanceiroPlanejado

    });

  });

  const realizadoTratado =
  [];

  realizadoLista.forEach((item) => {

    const fisico =
    converterPercentual(
      item.fisicoReal ||
      item.fisico ||
      item.avancoFisicoNovo ||
      0
    );

    const financeiro =
    converterValor(
      item.financeiroReal ||
      item.financeiro ||
      item.investimentoNovo ||
      0
    );

    const fisicoAcumulado =
    obterFisicoRealizadoAcumulado(
      item
    );

    const financeiroAcumulado =
    obterFinanceiroRealizadoAcumulado(
      item
    );

    realizadoTratado.push({

      ...item,

      fisico,
      financeiro,

      fisicoAcumuladoCalculado:
      fisicoAcumulado,

      financeiroAcumuladoCalculado:
      financeiroAcumulado

    });

  });

  renderizarPlanejamentoDetalhado(
    planejadoTratado,
    realizadoTratado,
    obraSelecionada
  );

  criarGraficos(
    planejadoTratado,
    realizadoTratado,
    obraSelecionada
  );

  redimensionarGraficos();

}

window.abrirPlanejamento =
abrirPlanejamento;

/* =====================================================
   RENDER PLANEJAMENTO DETALHADO
===================================================== */

function renderizarPlanejamentoDetalhado(
  planejadoTratado,
  realizadoTratado,
  obraSelecionada
) {

  if (!tbodyPlanejado) {
    return;
  }

  tbodyPlanejado.innerHTML =
  "";

  if (!planejadoTratado.length) {

    mostrarMensagemTabela(
      tbodyPlanejado,
      "Nenhum planejamento encontrado para esta obra.",
      6
    );

    return;

  }

  const valorBase =
  Number(
    obraSelecionada?.investimento ||
    planejadoTratado[
      planejadoTratado.length - 1
    ]?.financeiroAcumuladoCalculado ||
    0
  );

  const realizadoPorSemana =
  new Map();

  realizadoTratado.forEach((item) => {

    realizadoPorSemana.set(
      chaveSemana(item.semana),
      item
    );

  });

  planejadoTratado.forEach((item) => {

    const realizado =
    realizadoPorSemana.get(
      chaveSemana(item.semana)
    );

    const fisicoPlanejado =
    Number(
      item.fisicoAcumuladoCalculado ||
      0
    );

    const financeiroPlanejado =
    Number(
      item.financeiroAcumuladoCalculado ||
      0
    );

    const fisicoRealizado =
    realizado
    ? Number(
      realizado.fisicoAcumuladoCalculado ||
      0
    )
    : null;

    const financeiroExecutado =
    realizado
    ? Number(
      realizado.financeiroAcumuladoCalculado ||
      0
    )
    : null;

    const financeiroPlanejadoPercentual =
    financeiroParaPercentual(
      financeiroPlanejado,
      valorBase
    );

    const financeiroExecutadoPercentual =
    financeiroExecutado !== null
    ? financeiroParaPercentual(
      financeiroExecutado,
      valorBase
    )
    : null;

    const classeFisico =
    fisicoRealizado !== null &&
    fisicoRealizado < fisicoPlanejado
    ? "valor-alerta"
    : "";

    const classeFinanceiro =
    financeiroExecutadoPercentual !== null &&
    financeiroExecutadoPercentual > financeiroPlanejadoPercentual
    ? "valor-alerta"
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
        percentual(fisicoPlanejado)
      )
    );

    tr.appendChild(
      criarCelulaHTMLSeguro(
        fisicoRealizado !== null
        ? percentual(fisicoRealizado)
        : "-",
        classeFisico
      )
    );

    tr.appendChild(
      criarCelulaTexto(
        percentual(financeiroPlanejadoPercentual)
      )
    );

    tr.appendChild(
      criarCelulaHTMLSeguro(
        financeiroExecutadoPercentual !== null
        ? percentual(financeiroExecutadoPercentual)
        : "-",
        classeFinanceiro
      )
    );

    tbodyPlanejado.appendChild(
      tr
    );

  });

}

/* =====================================================
   OPÇÕES BASE DOS GRÁFICOS
===================================================== */

function opcoesBaseGrafico(
  maximoY = 100
) {

  return {

    responsive: true,
    maintainAspectRatio: false,

    layout: {
      padding: {
        top: 32,
        right: 24,
        bottom: 12,
        left: 12
      }
    },

    interaction: {
      mode: "index",
      intersect: false
    },

    plugins: {

      legend: {
        position: "top",

        labels: {
          color: "#333",
          font: {
            family: "'Segoe UI', sans-serif",
            size: 12,
            weight: "700"
          },
          boxWidth: 38,
          boxHeight: 12,
          padding: 18
        }

      },

      datalabels: {

        display: true,
        clip: false,
        clamp: true,

        color: "#333",

        backgroundColor: "rgba(255,255,255,.85)",

        borderRadius: 4,

        padding: {
          top: 2,
          right: 4,
          bottom: 2,
          left: 4
        },

        font: {
          family: "'Segoe UI', sans-serif",
          size: 10,
          weight: "700"
        },

        formatter: (value) => {

          if (
            value === null ||
            value === undefined
          ) {
            return "";
          }

          return percentual(value);

        },

        align: (context) => {

          return context.datasetIndex === 0
          ? "top"
          : "bottom";

        },

        anchor: (context) => {

          return context.datasetIndex === 0
          ? "end"
          : "start";

        },

        offset: () => {

          return 8;

        }

      },

      tooltip: {

        titleFont: {
          family: "'Segoe UI', sans-serif",
          size: 12,
          weight: "700"
        },

        bodyFont: {
          family: "'Segoe UI', sans-serif",
          size: 12,
          weight: "600"
        },

        callbacks: {

          label: (context) => {

            return `${context.dataset.label}: ${percentual(context.raw || 0)}`;

          }

        }

      }

    },

    scales: {

      x: {

        grid: {
          color: "rgba(0,0,0,.08)"
        },

        ticks: {
          color: "#333",
          maxRotation: 65,
          minRotation: 55,
          autoSkip: false,
          font: {
            family: "'Segoe UI', sans-serif",
            size: 10,
            weight: "600"
          }
        }

      },

      y: {

        beginAtZero: true,
        max: maximoY,

        grid: {
          color: "rgba(0,0,0,.10)"
        },

        ticks: {

          color: "#333",

          font: {
            family: "'Segoe UI', sans-serif",
            size: 11,
            weight: "700"
          },

          callback: (value) => `${value}%`

        }

      }

    }

  };

}

/* =====================================================
   GRÁFICOS
===================================================== */

function criarGraficos(
  planejadoLista,
  realizadoLista,
  obraSelecionada
) {

  const ctxFisico =
  document.getElementById(
    "graficoFisico"
  );

  const ctxFinanceiro =
  document.getElementById(
    "graficoFinanceiro"
  );

  if (
    !ctxFisico ||
    !ctxFinanceiro ||
    !ChartJS
  ) {
    return;
  }

  if (graficoFisico) {
    graficoFisico.destroy();
  }

  if (graficoFinanceiro) {
    graficoFinanceiro.destroy();
  }

  if (!planejadoLista.length) {
    return;
  }

  const valorBaseFinanceiro =
  Number(
    obraSelecionada?.investimento ||
    planejadoLista[
      planejadoLista.length - 1
    ]?.financeiroAcumuladoCalculado ||
    0
  );

  const labels =
  planejadoLista.map(
    item => item.semana
  );

  const fisicoPlanejado =
  planejadoLista.map(
    item =>
    Number(
      item.fisicoAcumuladoCalculado ||
      0
    )
  );

  const financeiroPlanejadoPercentual =
  planejadoLista.map((item) => {

    return financeiroParaPercentual(
      item.financeiroAcumuladoCalculado,
      valorBaseFinanceiro
    );

  });

  const fisicoRealizado =
  planejadoLista.map((itemPlanejado) => {

    const realizado =
    realizadoLista.find(
      itemRealizado =>
      chaveSemana(itemRealizado.semana) ===
      chaveSemana(itemPlanejado.semana)
    );

    return realizado
    ? Number(
      realizado.fisicoAcumuladoCalculado ||
      0
    )
    : null;

  });

  const financeiroRealizadoPercentual =
  planejadoLista.map((itemPlanejado) => {

    const realizado =
    realizadoLista.find(
      itemRealizado =>
      chaveSemana(itemRealizado.semana) ===
      chaveSemana(itemPlanejado.semana)
    );

    if (!realizado) {
      return null;
    }

    return financeiroParaPercentual(
      realizado.financeiroAcumuladoCalculado,
      valorBaseFinanceiro
    );

  });

  const maxFisico =
  Math.max(
    100,
    ...fisicoPlanejado,
    ...fisicoRealizado.filter(valor => valor !== null)
  );

  const maxFinanceiro =
  Math.max(
    100,
    ...financeiroPlanejadoPercentual,
    ...financeiroRealizadoPercentual.filter(valor => valor !== null)
  );

  graficoFisico =
  new ChartJS(ctxFisico, {

    type: "line",

    data: {

      labels,

      datasets: [

        {
          label: "Planejado Acumulado (%)",
          data: fisicoPlanejado,
          borderColor: "#8BC34A",
          backgroundColor: "#8BC34A",
          tension: 0.35,
          borderWidth: 3,
          pointRadius: 4,
          pointHoverRadius: 6,
          pointBorderWidth: 1.5,

          datalabels: {
            align: "top",
            anchor: "end",
            offset: 8
          }
        },

        {
          label: "Realizado Acumulado (%)",
          data: fisicoRealizado,
          borderColor: "#007E7A",
          backgroundColor: "#007E7A",
          tension: 0.35,
          borderWidth: 3,
          pointRadius: 4,
          pointHoverRadius: 6,
          pointBorderWidth: 1.5,

          datalabels: {
            align: "bottom",
            anchor: "start",
            offset: 8
          }
        }

      ]

    },

    options: opcoesBaseGrafico(
      Math.ceil(maxFisico / 10) * 10
    )

  });

  graficoFinanceiro =
  new ChartJS(ctxFinanceiro, {

    type: "line",

    data: {

      labels,

      datasets: [

        {
          label: "Planejado Acumulado (%)",
          data: financeiroPlanejadoPercentual,
          borderColor: "#8BC34A",
          backgroundColor: "#8BC34A",
          tension: 0.35,
          borderWidth: 3,
          pointRadius: 4,
          pointHoverRadius: 6,
          pointBorderWidth: 1.5,

          datalabels: {
            align: "top",
            anchor: "end",
            offset: 8
          }
        },

        {
          label: "Executado Acumulado (%)",
          data: financeiroRealizadoPercentual,
          borderColor: "#007E7A",
          backgroundColor: "#007E7A",
          tension: 0.35,
          borderWidth: 3,
          pointRadius: 4,
          pointHoverRadius: 6,
          pointBorderWidth: 1.5,

          datalabels: {
            align: "bottom",
            anchor: "start",
            offset: 8
          }
        }

      ]

    },

    options: opcoesBaseGrafico(
      Math.ceil(maxFinanceiro / 10) * 10
    )

  });

}

/* =====================================================
   EXPORTAR PDF
===================================================== */

function aguardar(ms) {

  return new Promise((resolve) => {

    setTimeout(
      resolve,
      ms
    );

  });

}

function configurarExportarPDF() {

  if (!btnExportarPDF) {
    return;
  }

  btnExportarPDF.addEventListener(
    "click",
    async () => {

      const textoOriginal =
      btnExportarPDF.innerHTML;

      const scrollAtual =
      window.scrollY;

      try {

        if (
          !window.jspdf ||
          !window.html2canvas
        ) {

          alert(
            "Bibliotecas de exportação PDF não carregadas."
          );

          return;

        }

        btnExportarPDF.disabled =
        true;

        btnExportarPDF.innerHTML =
        `<i class="fa-solid fa-spinner fa-spin"></i> Gerando PDF`;

        document.body.classList.add(
          "exportando-pdf"
        );

        window.scrollTo(
          0,
          0
        );

        redimensionarGraficos();

        await aguardar(
          600
        );

        const { jsPDF } =
        window.jspdf;

        const elemento =
        document.querySelector(".main");

        if (!elemento) {

          alert(
            "Área principal não encontrada para exportação."
          );

          return;

        }

        const larguraElemento =
        Math.max(
          elemento.scrollWidth,
          elemento.offsetWidth,
          elemento.clientWidth
        );

        const alturaElemento =
        Math.max(
          elemento.scrollHeight,
          elemento.offsetHeight,
          elemento.clientHeight
        );

        const canvas =
        await html2canvas(
          elemento,
          {
            scale: 2,
            useCORS: true,
            allowTaint: true,
            backgroundColor: "#ffffff",
            width: larguraElemento,
            height: alturaElemento,
            windowWidth: larguraElemento,
            windowHeight: alturaElemento,
            scrollX: 0,
            scrollY: 0
          }
        );

        const imgData =
        canvas.toDataURL(
          "image/png",
          1.0
        );

        const pdf =
        new jsPDF(
          "l",
          "mm",
          "a4"
        );

        const paginaLargura =
        pdf.internal.pageSize.getWidth();

        const paginaAltura =
        pdf.internal.pageSize.getHeight();

        const margem =
        8;

        const larguraUtil =
        paginaLargura - margem * 2;

        const alturaUtil =
        paginaAltura - margem * 2;

        const imgLargura =
        larguraUtil;

        const imgAltura =
        (
          canvas.height *
          imgLargura
        ) /
        canvas.width;

        let alturaRestante =
        imgAltura;

        let posicaoY =
        margem;

        pdf.addImage(
          imgData,
          "PNG",
          margem,
          posicaoY,
          imgLargura,
          imgAltura
        );

        alturaRestante -=
        alturaUtil;

        while (alturaRestante > 0.5) {

          pdf.addPage();

          posicaoY =
          margem - (
            imgAltura -
            alturaRestante
          );

          pdf.addImage(
            imgData,
            "PNG",
            margem,
            posicaoY,
            imgLargura,
            imgAltura
          );

          alturaRestante -=
          alturaUtil;

        }

        pdf.save(
          "painel-executivo-obras.pdf"
        );

      } catch (error) {

        console.error(
          "Erro ao exportar PDF:",
          error
        );

        alert(
          "Erro ao exportar PDF."
        );

      } finally {

        document.body.classList.remove(
          "exportando-pdf"
        );

        btnExportarPDF.disabled =
        false;

        btnExportarPDF.innerHTML =
        textoOriginal;

        window.scrollTo(
          0,
          scrollAtual
        );

        redimensionarGraficos();

      }

    }
  );

}

/* =====================================================
   EVENTOS DOS FILTROS
===================================================== */

function configurarEventosFiltros() {

  filtroRegional?.addEventListener(
    "change",
    () => {

      limparDetalhamento();
      carregarLocalidades();
      carregarFiltroObras();
      renderTabela();

    }
  );

  filtroLocalidade?.addEventListener(
    "change",
    () => {

      limparDetalhamento();
      carregarFiltroObras();
      renderTabela();

    }
  );

  filtroObra?.addEventListener(
    "change",
    () => {

      limparDetalhamento();
      renderTabela();

    }
  );

  filtroStatus?.addEventListener(
    "change",
    () => {

      limparDetalhamento();
      renderTabela();

    }
  );

}

/* =====================================================
   INIT
===================================================== */

document.addEventListener(
  "DOMContentLoaded",
  async () => {

    try {

      usuarioLogadoGlobal =
      await protegerPagina();

      aplicarPerfilVisual(
        usuarioLogadoGlobal
      );

      configurarMenuAtivo();

      configurarMenuLateral();

      configurarBotaoSair();

      configurarEventosFiltros();

      configurarExportarPDF();

      await carregarObrasFirebase();

    } catch (error) {

      console.error(
        "Erro ao iniciar dashboard:",
        error
      );

      alert(
        "Erro ao iniciar o dashboard."
      );

    }

  }
);