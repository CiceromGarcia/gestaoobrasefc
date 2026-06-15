/* =====================================================
   DASHBOARD - PAINEL EXECUTIVO DE OBRAS
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
  query,
  where
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

}

/* =====================================================
   VARIÁVEIS
===================================================== */

let obras = [];

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
    texto === "andamento"
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

/* =====================================================
   STATUS DA OBRA
===================================================== */

function calcularStatusObra(dadosObra, executadoFisico) {

  const statusManual =
  normalizarStatus(
    dadosObra.status ||
    dadosObra.fase ||
    ""
  );

  if (statusManual === "paralisada") {
    return "Paralisada";
  }

  const fisico =
  Number(executadoFisico || 0);

  if (fisico >= 100) {
    return "Concluída";
  }

  if (fisico > 0) {
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

  if (isNaN(dt)) {
    return "-";
  }

  return dt.toLocaleDateString(
    "pt-BR"
  );

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

  if (isNaN(data)) {
    return null;
  }

  return data;

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

  const match =
  texto.match(
    /(\d{2}\/\d{2}\/\d{4})\s*a\s*(\d{2}\/\d{2}\/\d{4})/i
  );

  if (!match) {

    return {
      inicio: null,
      fim: null
    };

  }

  return {

    inicio:
    converterDataBRParaDate(
      match[1]
    ),

    fim:
    converterDataBRParaDate(
      match[2]
    )

  };

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

  if (
    typeof valor === "string" &&
    valor.includes("/")
  ) {
    return converterDataBRParaDate(valor);
  }

  const data =
  new Date(valor);

  if (isNaN(data)) {
    return null;
  }

  return data;

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
    item?.ultimoLogin
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

  if (item.fisicoReal !== undefined) {
    return converterPercentual(item.fisicoReal);
  }

  if (item.fisicoAcum !== undefined) {
    return converterPercentual(item.fisicoAcum);
  }

  if (item.fisicoAcumulado !== undefined) {
    return converterPercentual(item.fisicoAcumulado);
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

  if (item.financeiroReal !== undefined) {
    return converterValor(item.financeiroReal);
  }

  if (item.financeiroAcum !== undefined) {
    return converterValor(item.financeiroAcum);
  }

  if (item.financeiroAcumulado !== undefined) {
    return converterValor(item.financeiroAcumulado);
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
    dados.orcado ||
    dados.investimento ||
    dados.valorTotal ||
    dados.valor ||
    0
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

  const elementosAdmin =
  document.querySelectorAll(
    "[data-admin-only]"
  );

  elementosAdmin.forEach((elemento) => {

    elemento.style.display =
    admin
    ? ""
    : "none";

  });

}

/* =====================================================
   HELPERS DE TABELA
===================================================== */

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

function criarCelulaHTMLSeguro(texto, classe = "") {

  const td =
  document.createElement("td");

  if (classe) {
    td.className = classe;
  }

  td.textContent =
  texto || "-";

  return td;

}

function mostrarMensagemTabela(tbody, mensagem, colunas) {

  if (!tbody) {
    return;
  }

  tbody.innerHTML = "";

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

  select.innerHTML = "";

  const option =
  document.createElement("option");

  option.value = "";
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
   CARREGAR OBRAS
===================================================== */

async function carregarObrasFirebase() {

  try {

    obras = [];

    if (tbodyObras) {
      mostrarMensagemTabela(
        tbodyObras,
        "Carregando obras...",
        11
      );
    }

    const snapshot =
    await getDocs(
      collection(
        db,
        "obras"
      )
    );

    let contadorId = 1;

    for (const documento of snapshot.docs) {

      const dados =
      documento.data();

      const idPadrao =
      dados.idProjeto ||
      dados.idObra ||
      `OBR-${String(contadorId).padStart(4, "0")}`;

      contadorId++;

      const nomeProjeto =
      dados.nomeProjeto || "-";

      /* =====================================
         PLANEJAMENTO
      ===================================== */

      const qPlanejamento =
      query(
        collection(
          db,
          "planejamentoCurvaS"
        ),
        where(
          "obra",
          "==",
          nomeProjeto
        )
      );

      const planejamentoSnapshot =
      await getDocs(
        qPlanejamento
      );

      let planejamentoListaResumo = [];

      planejamentoSnapshot.forEach((docPlanejamento) => {

        planejamentoListaResumo.push(
          docPlanejamento.data()
        );

      });

      planejamentoListaResumo =
      deduplicarPorSemana(
        planejamentoListaResumo
      );

      let dataInicioPlanejamento = null;
      let dataFimPlanejamento = null;

      let acumuladoFisicoPlanejadoResumo = 0;
      let acumuladoFinanceiroPlanejadoResumo = 0;

      let planejadoFisicoFinal = 0;
      let planejadoFinanceiro = 0;

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
          item.fisico || 0
        );

        const financeiroSemana =
        converterValor(
          item.financeiro || 0
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

      /* =====================================
         REALIZADO
      ===================================== */

      const qRealizado =
      query(
        collection(
          db,
          "realizadoCurvaS"
        ),
        where(
          "obra",
          "==",
          nomeProjeto
        )
      );

      const realizadoSnapshot =
      await getDocs(
        qRealizado
      );

      let realizadoListaResumo = [];

      realizadoSnapshot.forEach((docRealizado) => {

        realizadoListaResumo.push(
          docRealizado.data()
        );

      });

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
      : 0;

      const statusCalculado =
      calcularStatusObra(
        dados,
        executadoFisico
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

      const investimento =
      obterValorOrcadoObra(
        dados
      );

      obras.push({

        firebaseId:
        documento.id,

        idProjeto:
        idPadrao,

        nomeProjeto:
        nomeProjeto,

        localidade:
        dados.localidade || "-",

        centroCusto:
        dados.centroCusto ||
        dados.numeroOM ||
        "-",

        regional:
        dados.regional ||
        regionaisMap[
          dados.localidade
        ] ||
        "Não definida",

        investimento:
        investimento,

        planejadoFinanceiro:
        planejadoFinanceiro,

        executado:
        executadoFinanceiro ||
        converterValor(
          dados.executado ||
          dados.valorExecutado ||
          0
        ),

        avancoFisico:
        executadoFisico,

        planejadoFisicoAteSemanaAtual:
        planejadoFisicoAteSemanaAtual,

        afo:
        afo,

        gutScore:
        Number(
          dados.score ||
          dados.gutScore ||
          0
        ),

        fase:
        statusCalculado,

        dataInicioPlanejamento,
        dataFimPlanejamento

      });

    }

    carregarRegionais();
    carregarLocalidades();
    carregarFiltroObras();
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

}

/* =====================================================
   CARREGAR LOCALIDADES
===================================================== */

function carregarLocalidades() {

  if (!filtroLocalidade) {
    return;
  }

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

}

/* =====================================================
   CARREGAR FILTRO OBRAS
===================================================== */

function carregarFiltroObras() {

  if (!filtroObra) {
    return;
  }

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

}

/* =====================================================
   FILTRAR OBRAS
===================================================== */

function obterObrasFiltradas() {

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

  if (filtroStatus?.value) {

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
   RENDER TABELA DE OBRAS
===================================================== */

function renderTabela() {

  if (!tbodyObras) {
    return;
  }

  tbodyObras.innerHTML = "";

  const lista =
  obterObrasFiltradas();

  if (lista.length === 0) {

    mostrarMensagemTabela(
      tbodyObras,
      "Nenhuma obra encontrada.",
      11
    );

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
          item.dataInicioPlanejamento
        )
      )
    );

    tr.appendChild(
      criarCelulaTexto(
        formatarData(
          item.dataFimPlanejamento
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

    tbodyObras.appendChild(tr);

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

  const nomeObra =
  obraSelecionada.nomeProjeto;

  mostrarMensagemTabela(
    tbodyPlanejado,
    "Carregando planejamento...",
    6
  );

  const qPlanejado =
  query(
    collection(
      db,
      "planejamentoCurvaS"
    ),
    where(
      "obra",
      "==",
      nomeObra
    )
  );

  const planejadoSnapshot =
  await getDocs(
    qPlanejado
  );

  let planejadoLista = [];

  planejadoSnapshot.forEach((docPlanejado) => {

    planejadoLista.push(
      docPlanejado.data()
    );

  });

  planejadoLista =
  deduplicarPorSemana(
    planejadoLista
  );

  const qRealizado =
  query(
    collection(
      db,
      "realizadoCurvaS"
    ),
    where(
      "obra",
      "==",
      nomeObra
    )
  );

  const realizadoSnapshot =
  await getDocs(
    qRealizado
  );

  let realizadoLista = [];

  realizadoSnapshot.forEach((docRealizado) => {

    realizadoLista.push(
      docRealizado.data()
    );

  });

  realizadoLista =
  deduplicarPorSemana(
    realizadoLista
  );

  const semanasPlanejadas =
  new Set();

  let acumuladoFisicoPlanejado = 0;
  let acumuladoFinanceiroPlanejado = 0;

  const planejadoTratado = [];

  planejadoLista.forEach((item) => {

    const chave =
    `${item.semana}_${item.periodo}`;

    if (semanasPlanejadas.has(chave)) {
      return;
    }

    semanasPlanejadas.add(chave);

    const fisico =
    converterPercentual(
      item.fisico || 0
    );

    const financeiro =
    converterValor(
      item.financeiro || 0
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

  const realizadoTratado = [];

  realizadoLista.forEach((item) => {

    const fisico =
    converterPercentual(
      item.fisicoReal ||
      item.fisico ||
      0
    );

    const financeiro =
    converterValor(
      item.financeiroReal ||
      item.financeiro ||
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
    realizadoTratado
  );

  criarGraficos(
    planejadoTratado,
    realizadoTratado
  );

}

window.abrirPlanejamento =
abrirPlanejamento;

/* =====================================================
   RENDER PLANEJAMENTO DETALHADO
===================================================== */

function renderizarPlanejamentoDetalhado(
  planejadoTratado,
  realizadoTratado
) {

  if (!tbodyPlanejado) {
    return;
  }

  tbodyPlanejado.innerHTML = "";

  if (!planejadoTratado.length) {

    mostrarMensagemTabela(
      tbodyPlanejado,
      "Nenhum planejamento encontrado para esta obra.",
      6
    );

    return;

  }

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

    const classeFisico =
    fisicoRealizado !== null &&
    fisicoRealizado < fisicoPlanejado
    ? "valor-alerta"
    : "";

    const classeFinanceiro =
    financeiroExecutado !== null &&
    financeiroExecutado > financeiroPlanejado
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
        `R$ ${moeda(financeiroPlanejado)}`
      )
    );

    tr.appendChild(
      criarCelulaHTMLSeguro(
        financeiroExecutado !== null
        ? `R$ ${moeda(financeiroExecutado)}`
        : "-",
        classeFinanceiro
      )
    );

    tbodyPlanejado.appendChild(tr);

  });

}

/* =====================================================
   GRÁFICOS
===================================================== */

function criarGraficos(
  planejadoLista,
  realizadoLista
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

  const financeiroPlanejado =
  planejadoLista.map(
    item =>
    Number(
      item.financeiroAcumuladoCalculado ||
      0
    )
  );

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

  const financeiroRealizado =
  planejadoLista.map((itemPlanejado) => {

    const realizado =
    realizadoLista.find(
      itemRealizado =>
      chaveSemana(itemRealizado.semana) ===
      chaveSemana(itemPlanejado.semana)
    );

    return realizado
    ? Number(
      realizado.financeiroAcumuladoCalculado ||
      0
    )
    : null;

  });

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
          tension: 0.4,
          pointRadius: 5
        },

        {
          label: "Realizado Acumulado (%)",
          data: fisicoRealizado,
          borderColor: "#007E7A",
          backgroundColor: "#007E7A",
          tension: 0.4,
          pointRadius: 5
        }

      ]

    },

    options: {

      responsive: true,
      maintainAspectRatio: false,

      plugins: {

        datalabels: {

          align: "top",
          anchor: "end",

          formatter: (value) => {

            if (value === null) {
              return "";
            }

            return percentual(value);

          },

          font: {
            size: 10,
            weight: "bold"
          }

        },

        tooltip: {

          callbacks: {

            label: (context) => {

              return `${context.dataset.label}: ${percentual(context.raw || 0)}`;

            }

          }

        }

      },

      scales: {

        y: {

          beginAtZero: true,
          max: 100,

          ticks: {

            callback: (value) => `${value}%`

          }

        }

      }

    }

  });

  graficoFinanceiro =
  new ChartJS(ctxFinanceiro, {

    type: "line",

    data: {

      labels,

      datasets: [

        {
          label: "Planejado Acumulado (R$)",
          data: financeiroPlanejado,
          borderColor: "#8BC34A",
          backgroundColor: "#8BC34A",
          tension: 0.4,
          pointRadius: 5
        },

        {
          label: "Executado Acumulado (R$)",
          data: financeiroRealizado,
          borderColor: "#007E7A",
          backgroundColor: "#007E7A",
          tension: 0.4,
          pointRadius: 5
        }

      ]

    },

    options: {

      responsive: true,
      maintainAspectRatio: false,

      plugins: {

        datalabels: {

          align: "top",
          anchor: "end",

          formatter: (value) => {

            if (value === null) {
              return "";
            }

            return `R$ ${moeda(value)}`;

          },

          font: {
            size: 10,
            weight: "bold"
          }

        },

        tooltip: {

          callbacks: {

            label: (context) => {

              return `${context.dataset.label}: R$ ${moeda(context.raw || 0)}`;

            }

          }

        }

      },

      scales: {

        y: {

          beginAtZero: true,

          ticks: {

            callback: (value) => `R$ ${moeda(value)}`

          }

        }

      }

    }

  });

}

/* =====================================================
   EXPORTAR PDF
===================================================== */

function configurarExportarPDF() {

  if (!btnExportarPDF) {
    return;
  }

  btnExportarPDF.addEventListener(
    "click",
    async () => {

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

        const { jsPDF } =
        window.jspdf;

        const pdf =
        new jsPDF(
          "p",
          "mm",
          "a4"
        );

        const elemento =
        document.querySelector(".main");

        if (!elemento) {

          alert(
            "Área principal não encontrada para exportação."
          );

          return;

        }

        const canvas =
        await html2canvas(
          elemento,
          {
            scale: 2
          }
        );

        const imgData =
        canvas.toDataURL(
          "image/png"
        );

        const imgWidth =
        190;

        const imgHeight =
        (
          canvas.height *
          imgWidth
        ) /
        canvas.width;

        pdf.addImage(
          imgData,
          "PNG",
          10,
          10,
          imgWidth,
          imgHeight
        );

        pdf.save(
          "planejamento-obra.pdf"
        );

      } catch (error) {

        console.error(
          "Erro ao exportar PDF:",
          error
        );

        alert(
          "Erro ao exportar PDF."
        );

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

      carregarLocalidades();
      carregarFiltroObras();
      renderTabela();

    }
  );

  filtroLocalidade?.addEventListener(
    "change",
    () => {

      carregarFiltroObras();
      renderTabela();

    }
  );

  filtroObra?.addEventListener(
    "change",
    renderTabela
  );

  filtroStatus?.addEventListener(
    "change",
    renderTabela
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