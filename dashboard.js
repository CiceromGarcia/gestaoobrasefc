/* =====================================================
   DASHBOARD - PAINEL EXECUTIVO DE OBRAS
   Arquivo: dashboard.js
   Versão: v013

   Correções:
   - Tabela:
     ACUMULADO FINANCEIRO PLANEJADO agora aparece em R$.
   - Gráfico financeiro:
     continua aparecendo em percentual (%).
   - Exportação PDF:
     ajustada para gerar por blocos e evitar cortes grandes.
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
let filtroSemaforoAtivo = null;

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

  "Vitoria do Mearim": "Regional 1",

  "Santa Inês": "Regional 1",

  "Santa Ines": "Regional 1",

  "Alto Alegre": "Regional 1",

  "Alto Alegre do Pindaré": "Regional 1",

  "Alto Alegre do Pindare": "Regional 1",

  "Altamira": "Regional 1",

  "Auzilândia": "Regional 1",

  "Auzilandia": "Regional 1",

  "Vila Pindaré": "Regional 1",

  "Vila Pindare": "Regional 1",

  "Mineirinho": "Regional 1",

  "Açailândia": "Regional 2",

  "Acailandia": "Regional 2",

  "Nova Vida": "Regional 2",

  "Marabá": "Regional 3",

  "Maraba": "Regional 3",

  "São Pedro d’Água Branca": "Regional 3",

  "São Pedro d'Água Branca": "Regional 3",

  "São Pedro d'agua branca": "Regional 3",

  "Sao Pedro d'agua branca": "Regional 3",

  "Itainópolis": "Regional 3",

  "Itainopolis": "Regional 3",

  "São Luís": "São Luís",

  "Sao Luis": "São Luís"

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

function moedaCompleta(valor) {

  return `R$ ${moeda(valor)}`;

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

    if (!Number.isFinite(valor)) {
      return 0;
    }

    if (
      Number.isInteger(valor) &&
      Math.abs(valor) >= 10000000
    ) {
      return valor / 100;
    }

    return valor;

  }

  let texto =
  String(valor)
    .replace(/R\$/gi, "")
    .replace(/\s/g, "")
    .trim();

  if (!texto) {
    return 0;
  }

  const temVirgula =
  texto.includes(",");

  const temPonto =
  texto.includes(".");

  const somenteNumeros =
  texto.replace(/\D/g, "");

  if (temVirgula) {

    texto =
    texto
      .replace(/\./g, "")
      .replace(",", ".");

    const convertido =
    Number(texto) || 0;

    if (
      convertido >= 100000000 &&
      temPonto
    ) {
      return convertido / 100;
    }

    return convertido;

  }

  texto =
  texto.replace(/[^\d.-]/g, "");

  const convertido =
  Number(texto) || 0;

  if (
    !temVirgula &&
    !temPonto &&
    somenteNumeros.length >= 8 &&
    convertido >= 10000000
  ) {
    return convertido / 100;
  }

  return convertido;

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

function valorTemPercentual(valor) {

  return String(valor || "")
    .includes("%");

}

function limitarPercentual(valor) {

  const numero =
  Number(valor || 0);

  if (!Number.isFinite(numero)) {
    return 0;
  }

  return Math.min(
    Math.max(
      numero,
      0
    ),
    100
  );

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

function percentualParaFinanceiro(
  valorPercentual,
  valorBase
) {

  const base =
  Number(valorBase || 0);

  if (base <= 0) {
    return 0;
  }

  return (
    Number(valorPercentual || 0) /
    100
  ) * base;

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

function obterFinanceiroRealizadoValorAcumulado(
  item,
  valorBase
) {

  if (!item) {
    return 0;
  }

  const candidatos = [
    item.financeiroRealAcum,
    item.financeiroAcum,
    item.financeiroRealAcumulado,
    item.financeiroAcumulado,
    item.valorExecutado,
    item.executado,
    item.financeiroReal,
    item.investimentoNovo,
    item.custoSemana,
    item.custo,
    item.financeiro
  ];

  for (const valor of candidatos) {

    if (
      valor === undefined ||
      valor === null ||
      valor === ""
    ) {
      continue;
    }

    if (valorTemPercentual(valor)) {

      return percentualParaFinanceiro(
        converterPercentual(valor),
        valorBase
      );

    }

    return converterValor(valor);

  }

  return 0;

}

function obterFinanceiroRealizadoPercentualAcumulado(
  item,
  valorBase
) {

  if (!item) {
    return null;
  }

  const candidatosPercentuais = [
    item.financeiroRealPercentualAcum,
    item.financeiroPercentualAcum,
    item.financeiroExecutadoPercentualAcum,
    item.financeiroRealPercentual,
    item.financeiroPercentual,
    item.percentualFinanceiro,
    item.percentualExecutadoFinanceiro
  ];

  for (const valor of candidatosPercentuais) {

    if (
      valor !== undefined &&
      valor !== null &&
      valor !== ""
    ) {

      return limitarPercentual(
        converterPercentual(valor)
      );

    }

  }

  const candidatosValores = [
    item.financeiroRealAcum,
    item.financeiroAcum,
    item.financeiroRealAcumulado,
    item.financeiroAcumulado,
    item.valorExecutado,
    item.executado,
    item.financeiroReal,
    item.investimentoNovo,
    item.custoSemana,
    item.custo,
    item.financeiro
  ];

  for (const valor of candidatosValores) {

    if (
      valor === undefined ||
      valor === null ||
      valor === ""
    ) {
      continue;
    }

    if (valorTemPercentual(valor)) {

      return limitarPercentual(
        converterPercentual(valor)
      );

    }

    const convertido =
    converterValor(valor);

    if (
      convertido <= 100 &&
      valorBase <= 0
    ) {
      return limitarPercentual(convertido);
    }

    if (
      convertido <= 100 &&
      valorBase > 0 &&
      String(valor).includes("%")
    ) {
      return limitarPercentual(convertido);
    }

    return limitarPercentual(
      financeiroParaPercentual(
        convertido,
        valorBase
      )
    );

  }

  return null;

}

/* =====================================================
   VALOR ORÇADO
===================================================== */

function obterValorOrcadoObra(dados) {

  const camposTexto = [
    dados.valorObra,
    dados.valorOrcado,
    dados.valorOrçado,
    dados.investimento,
    dados.valorInvestimento,
    dados.orcamento,
    dados.orçamento,
    dados.orcado,
    dados.orçado,
    dados.valorTotal,
    dados.custoTotal,
    dados.custoOrcado,
    dados.orcadoTotal,
    dados.orcamentoTotal,
    dados.orçamentoTotal,
    dados.investimentoTotal
  ];

  for (const valor of camposTexto) {

    if (typeof valor !== "string") {
      continue;
    }

    const convertido =
    converterValor(valor);

    if (convertido > 0) {
      return convertido;
    }

  }

  const camposNumericos = [
    dados.valorObraNumero,
    dados.valorObraNumerico,
    dados.valorOrcadoNumero,
    dados.valorOrçadoNumero,
    dados.investimentoNumero,
    dados.investimentoTotalNumero,
    dados.valorInvestimentoNumero,
    dados.orcamentoNumero,
    dados.orçamentoNumero,
    dados.orcadoNumero,
    dados.orçadoNumero,
    dados.valorTotalNumero,
    dados.valorTotalNumerico,
    dados.custoTotalNumero,
    dados.custoOrcadoNumero,
    dados.valorObra,
    dados.valorOrcado,
    dados.valorOrçado,
    dados.investimento,
    dados.valorInvestimento,
    dados.orcamento,
    dados.orçamento,
    dados.orcado,
    dados.orçado,
    dados.valorTotal,
    dados.custoTotal,
    dados.custoOrcado,
    dados.orcadoTotal,
    dados.orcamentoTotal,
    dados.orçamentoTotal,
    dados.investimentoTotal,
    dados.valor,
    dados.custoTotal
  ];

  for (const valor of camposNumericos) {

    const convertido =
    converterValor(valor);

    if (convertido > 0) {
      return convertido;
    }

  }

  return 0;

}

/* =====================================================
   FINANCEIRO PLANEJADO
===================================================== */

function obterFinanceiroPlanejadoPercentualItem(
  item,
  valorBase
) {

  const candidatosPercentuais = [
    item.financeiroAcumPercentual,
    item.financeiroPlanejadoAcumPercentual,
    item.financeiroPlanejadoPercentualAcum,
    item.financeiroPercentualAcum,
    item.percentualFinanceiroAcum,
    item.percentualFinanceiroPlanejado,
    item.financeiroPercentual
  ];

  for (const valor of candidatosPercentuais) {

    if (
      valor !== undefined &&
      valor !== null &&
      valor !== ""
    ) {

      return limitarPercentual(
        converterPercentual(valor)
      );

    }

  }

  const candidatosAcumulados = [
    item.financeiroAcum,
    item.financeiroPlanejadoAcum,
    item.financeiroPlanejadoAcumulado,
    item.financeiroAcumulado,
    item.financeiroAcumuladoCalculado
  ];

  for (const valor of candidatosAcumulados) {

    if (
      valor === undefined ||
      valor === null ||
      valor === ""
    ) {
      continue;
    }

    if (valorTemPercentual(valor)) {

      return limitarPercentual(
        converterPercentual(valor)
      );

    }

    const convertido =
    converterValor(valor);

    if (convertido <= 100) {
      return limitarPercentual(convertido);
    }

    return limitarPercentual(
      financeiroParaPercentual(
        convertido,
        valorBase
      )
    );

  }

  const candidatosSemanais = [
    item.financeiro,
    item.financeiroPlanejado,
    item.valorPlanejado
  ];

  for (const valor of candidatosSemanais) {

    if (
      valor === undefined ||
      valor === null ||
      valor === ""
    ) {
      continue;
    }

    if (valorTemPercentual(valor)) {
      return limitarPercentual(
        converterPercentual(valor)
      );
    }

    const convertido =
    converterValor(valor);

    if (convertido <= 100) {
      return limitarPercentual(convertido);
    }

    return limitarPercentual(
      financeiroParaPercentual(
        convertido,
        valorBase
      )
    );

  }

  return 0;

}

function obterFinanceiroPlanejadoValorItem(
  item,
  valorBase
) {

  const candidatosValores = [
    item.financeiroAcumValor,
    item.financeiroPlanejadoAcumValor,
    item.financeiroPlanejadoValorAcum,
    item.financeiroValorAcum,
    item.valorPlanejadoAcum,
    item.valorPlanejadoAcumulado,
    item.financeiroPlanejadoValor,
    item.valorFinanceiroPlanejado
  ];

  for (const valor of candidatosValores) {

    if (
      valor === undefined ||
      valor === null ||
      valor === ""
    ) {
      continue;
    }

    if (valorTemPercentual(valor)) {

      return percentualParaFinanceiro(
        converterPercentual(valor),
        valorBase
      );

    }

    const convertido =
    converterValor(valor);

    if (convertido > 100) {
      return convertido;
    }

  }

  const percentualPlanejado =
  obterFinanceiroPlanejadoPercentualItem(
    item,
    valorBase
  );

  return percentualParaFinanceiro(
    percentualPlanejado,
    valorBase
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
    obra.docId,
    obra.idProjeto,
    obra.idObra,
    obra.obraId,
    obra.codigoObra,
    obra.codigo,
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
    registro.codigoObra,
    registro.codigo,
    registro.obra,
    registro.obraNome,
    registro.nomeObra,
    registro.nomeProjeto,
    registro.projeto
  ]
    .filter(Boolean)
    .map(normalizarTexto);

  if (
    chavesRegistro.some((chave) =>
      chavesObra.includes(chave)
    )
  ) {
    return true;
  }

  const nomeObra =
  normalizarTexto(
    obra.nomeProjeto
  );

  const nomeRegistro =
  normalizarTexto(
    registro.nomeProjeto ||
    registro.nomeObra ||
    registro.obraNome ||
    registro.obra ||
    registro.projeto
  );

  const centroObra =
  normalizarTexto(
    obra.centroCusto
  );

  const centroRegistro =
  normalizarTexto(
    registro.centroCusto ||
    registro.centroDeCusto ||
    registro.centroCustoApropriacao
  );

  if (
    nomeObra &&
    nomeRegistro &&
    nomeObra === nomeRegistro
  ) {
    return true;
  }

  if (
    centroObra &&
    centroRegistro &&
    centroObra === centroRegistro &&
    !nomeRegistro
  ) {
    return true;
  }

  return false;

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
      dados.codigoObra ||
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

      const investimentoObra =
      obterValorOrcadoObra(
        dados
      );

      const obraBase = {

        firebaseId:
        dados.firebaseId,

        docId:
        dados.docId,

        idProjeto:
        idPadrao,

        idObra:
        dados.idObra || "",

        obraId:
        dados.obraId || "",

        /*
          CORREÇÃO: "codigoObra"/"codigo" (ex.: "OBR-0004") não eram
          copiados pra cá. Quando idProjeto/idObra também estavam
          preenchidos com outro valor, o código da obra ficava de
          fora das chaves de casamento em registroPertenceAObra(),
          e um lançamento de Curva S salvo referenciando a obra pelo
          código deixava de ser encontrado — a obra aparecia como
          "sem avanço" mesmo tendo avanço real lançado.
        */
        codigoObra:
        dados.codigoObra ||
        dados.codigo ||
        "",

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
        investimentoObra,

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

      let acumuladoFinanceiroPlanejadoPercentualResumo =
      0;

      let planejadoFisicoFinal =
      0;

      let planejadoFinanceiroValorFinal =
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

        acumuladoFisicoPlanejadoResumo =
        item.fisicoAcum !== undefined
        ? converterPercentual(item.fisicoAcum)
        : item.fisicoAcumulado !== undefined
        ? converterPercentual(item.fisicoAcumulado)
        : acumuladoFisicoPlanejadoResumo + fisicoSemana;

        acumuladoFinanceiroPlanejadoPercentualResumo =
        obterFinanceiroPlanejadoPercentualItem(
          item,
          investimentoObra
        );

        planejadoFisicoFinal =
        acumuladoFisicoPlanejadoResumo;

        planejadoFinanceiroValorFinal =
        obterFinanceiroPlanejadoValorItem(
          item,
          investimentoObra
        );

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
      ? obterFinanceiroRealizadoValorAcumulado(
        ultimoRealizado,
        investimentoObra
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
        planejadoFinanceiroValorFinal,

        planejadoFinanceiroPercentual:
        acumuladoFinanceiroPlanejadoPercentualResumo,

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

function obterObrasFiltradas(aplicarStatus = true, aplicarSemaforo = true) {

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

  if (
    aplicarSemaforo &&
    filtroSemaforoAtivo
  ) {

    lista =
    lista.filter((item) =>
      obterCategoriaSemaforo(item.afo) === filtroSemaforoAtivo
    );

  }

  return lista;

}

function obterCategoriaSemaforo(afo) {
  const valor = Number(afo || 0);

  if (valor >= 95) {
    return "saudavel";
  }

  if (valor >= 90) {
    return "atencao";
  }

  return "critica";
}

function atualizarSemaforoMiniResumo() {
  const listaBase = obterObrasFiltradas(true, false);

  const contagem = {
    saudavel: 0,
    atencao: 0,
    critica: 0
  };

  listaBase.forEach((item) => {
    contagem[obterCategoriaSemaforo(item.afo)]++;
  });

  const numeroSaudaveis = document.querySelector("#semaforoMiniSaudaveis .semaforo-mini-numero");
  const numeroAtencao = document.querySelector("#semaforoMiniAtencao .semaforo-mini-numero");
  const numeroCriticas = document.querySelector("#semaforoMiniCriticas .semaforo-mini-numero");

  if (numeroSaudaveis) {
    numeroSaudaveis.textContent = contagem.saudavel;
  }

  if (numeroAtencao) {
    numeroAtencao.textContent = contagem.atencao;
  }

  if (numeroCriticas) {
    numeroCriticas.textContent = contagem.critica;
  }

  document
    .querySelectorAll(".semaforo-mini-item")
    .forEach((botao) => {
      botao.classList.toggle(
        "ativo",
        botao.dataset.categoria === filtroSemaforoAtivo
      );
    });
}

function configurarSemaforoMiniResumo() {
  document
    .querySelectorAll(".semaforo-mini-item")
    .forEach((botao) => {
      botao.addEventListener("click", () => {
        const categoria = botao.dataset.categoria;

        filtroSemaforoAtivo =
        filtroSemaforoAtivo === categoria
        ? null
        : categoria;

        renderTabela();
      });
    });
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

  atualizarSemaforoMiniResumo();

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
        moedaCompleta(item.investimento)
      )
    );

    tr.appendChild(
      criarCelulaTexto(
        moedaCompleta(item.executado)
      )
    );

    tr.appendChild(
      criarCelulaTexto(
        moedaCompleta(desvio),
        desvio < 0
        ? "desvio-negativo"
        : "desvio-ok"
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
        ),
        Number(item.afo || 0) < 100
        ? "afo-baixo"
        : "afo-ok"
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
    .forEach((item) => {

      item.classList.remove(
        "selected"
      );

    });

  linha.classList.add(
    "selected"
  );

}

/* =====================================================
   ABRIR PLANEJAMENTO
===================================================== */

function textoSeguro(valor) {
  return String(valor ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function obraTemAnomaliaDeCustoOuPrazo(item) {
  const temAnomalia = Boolean(
    item.houveAnomalia === true ||
    item.temAnomalia === "Sim" ||
    item.possuiAnomalia === true ||
    item.tipoAnomalia ||
    item.criticidadeAnomalia ||
    item.impactoAnomalia ||
    item.descricaoAnomalia
  );

  if (!temAnomalia) {
    return false;
  }

  const impacto = normalizarTexto(
    item.impactoAnomalia ||
    item.impactoPrincipal ||
    ""
  );

  return impacto.includes("prazo") || impacto.includes("custo");
}

function ordenarAnomaliasPorCriticidade(lista) {
  const pesoCriticidade = {
    "critica": 0,
    "critico": 0,
    "alta": 1,
    "media": 2,
    "moderada": 2,
    "baixa": 3
  };

  return [...lista].sort((a, b) => {
    const pesoA = pesoCriticidade[normalizarTexto(a.criticidadeAnomalia || "")] ?? 9;
    const pesoB = pesoCriticidade[normalizarTexto(b.criticidadeAnomalia || "")] ?? 9;

    if (pesoA !== pesoB) {
      return pesoA - pesoB;
    }

    const semanaA = parseInt(String(a.semana || "").replace(/\D/g, "")) || 0;
    const semanaB = parseInt(String(b.semana || "").replace(/\D/g, "")) || 0;

    return semanaB - semanaA;
  });
}

function renderizarAnomaliasObraDashboard(realizadoLista) {
  const container = document.getElementById("listaAnomaliasObraDashboard");
  const aviso = document.getElementById("semAnomaliasObraDashboard");

  if (!container || !aviso) {
    return;
  }

  const comImpacto = ordenarAnomaliasPorCriticidade(
    (realizadoLista || []).filter(obraTemAnomaliaDeCustoOuPrazo)
  );

  aviso.classList.toggle("ativo", comImpacto.length === 0);

  container.innerHTML = comImpacto
    .map((item) => {
      const criticidadeClasse = normalizarTexto(
        item.criticidadeAnomalia || ""
      ).replace(/\s+/g, "-");

      const impacto = item.impactoAnomalia || item.impactoPrincipal || "-";
      const tipo = item.tipoAnomalia || item.categoriaAnomalia || "Sem tipo";
      const status = item.statusAnomalia || item.status || "Aberta";
      const descricao = item.descricaoAnomalia || item.observacaoAnomalia || "Sem descrição.";
      const responsavel = item.responsavelAnomalia || item.responsavel || "-";
      const prazo = item.prazoTratativaAnomalia || item.prazoTratativa || "";

      return `
        <div class="card-anomalia-dash criticidade-${textoSeguro(criticidadeClasse)}">
          <div class="cabecalho-anomalia-dash">
            <span class="semana-anomalia-dash">${textoSeguro(item.semana || "-")}</span>
            <span class="tag-anomalia-dash">${textoSeguro(impacto)}</span>
            <span class="tag-anomalia-dash">${textoSeguro(tipo)}</span>
            <span class="tag-anomalia-dash">${textoSeguro(item.criticidadeAnomalia || "-")}</span>
            <span class="tag-anomalia-dash">${textoSeguro(status)}</span>
          </div>
          <div class="descricao-anomalia-dash">${textoSeguro(descricao)}</div>
          <div class="meta-anomalia-dash">
            Responsável: ${textoSeguro(responsavel)}
            ${prazo ? " · Prazo: " + textoSeguro(formatarData(prazo)) : ""}
          </div>
        </div>
      `;
    })
    .join("");
}

function abrirPlanejamento(firebaseId) {

  const obra =
  obras.find((item) =>
    item.firebaseId === firebaseId
  );

  if (!obra) {
    return;
  }

  if (detalhamentoPlanejamento) {

    detalhamentoPlanejamento.style.display =
    "block";

  }

  let planejadoLista =
  planejamentosBanco.filter((item) =>
    registroPertenceAObra(
      item,
      obra
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
      obra
    )
  );

  realizadoLista =
  deduplicarPorSemana(
    realizadoLista
  );

  const planejadoTratado =
  tratarPlanejamentoObra(
    planejadoLista,
    obra
  );

  const realizadoTratado =
  tratarRealizadoObra(
    realizadoLista,
    obra
  );

  renderPlanejamento(
    planejadoTratado,
    realizadoTratado
  );

  criarGraficos(
    planejadoTratado,
    realizadoTratado
  );

  renderizarAnomaliasObraDashboard(
    realizadoLista
  );

  setTimeout(() => {

    detalhamentoPlanejamento?.scrollIntoView({
      behavior: "smooth",
      block: "start"
    });

    redimensionarGraficos();

  }, 100);

}

/* =====================================================
   TRATAR PLANEJAMENTO
===================================================== */

function tratarPlanejamentoObra(
  lista,
  obra
) {

  let acumuladoFisico =
  0;

  return lista.map((item) => {

    const fisicoSemana =
    converterPercentual(
      item.fisico ||
      item.fisicoPlanejado ||
      0
    );

    acumuladoFisico =
    item.fisicoAcum !== undefined
    ? converterPercentual(item.fisicoAcum)
    : item.fisicoAcumulado !== undefined
    ? converterPercentual(item.fisicoAcumulado)
    : acumuladoFisico + fisicoSemana;

    const financeiroPercentual =
    obterFinanceiroPlanejadoPercentualItem(
      item,
      obra.investimento
    );

    const financeiroValor =
    obterFinanceiroPlanejadoValorItem(
      item,
      obra.investimento
    );

    return {

      ...item,

      fisicoAcumuladoCalculado:
      limitarPercentual(acumuladoFisico),

      financeiroAcumuladoPercentualCalculado:
      limitarPercentual(financeiroPercentual),

      financeiroAcumuladoValorCalculado:
      financeiroValor

    };

  });

}

/* =====================================================
   TRATAR REALIZADO
===================================================== */

function tratarRealizadoObra(
  lista,
  obra
) {

  return lista.map((item) => {

    const fisicoRealizado =
    obterFisicoRealizadoAcumulado(
      item
    );

    const financeiroValor =
    obterFinanceiroRealizadoValorAcumulado(
      item,
      obra.investimento
    );

    const financeiroPercentual =
    obterFinanceiroRealizadoPercentualAcumulado(
      item,
      obra.investimento
    );

    return {

      ...item,

      fisicoAcumuladoCalculado:
      limitarPercentual(fisicoRealizado),

      financeiroAcumuladoValorCalculado:
      financeiroValor,

      financeiroAcumuladoPercentualCalculado:
      financeiroPercentual !== null
      ? limitarPercentual(financeiroPercentual)
      : null

    };

  });

}

/* =====================================================
   RENDER PLANEJAMENTO
===================================================== */

function renderPlanejamento(
  planejadoTratado,
  realizadoTratado
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

    const financeiroPlanejadoPercentual =
    Number(
      item.financeiroAcumuladoPercentualCalculado ||
      0
    );

    const financeiroPlanejadoValor =
    Number(
      item.financeiroAcumuladoValorCalculado ||
      0
    );

    const fisicoRealizado =
    realizado
    ? Number(
      realizado.fisicoAcumuladoCalculado ||
      0
    )
    : null;

    const financeiroExecutadoPercentual =
    realizado &&
    realizado.financeiroAcumuladoPercentualCalculado !== null &&
    realizado.financeiroAcumuladoPercentualCalculado !== undefined
    ? Number(
      realizado.financeiroAcumuladoPercentualCalculado ||
      0
    )
    : null;

    /*
      Valor em R$ do financeiro executado acumulado (não o percentual).
      Usado só na tabela — o gráfico da Curva S continua em % via
      financeiroExecutadoPercentual, sem alteração.
    */
    const financeiroExecutadoValor =
    realizado &&
    realizado.financeiroAcumuladoValorCalculado !== null &&
    realizado.financeiroAcumuladoValorCalculado !== undefined
    ? Number(
      realizado.financeiroAcumuladoValorCalculado ||
      0
    )
    : null;

    const classeFisico =
    fisicoRealizado !== null &&
    fisicoRealizado < fisicoPlanejado
    ? "valor-alerta"
    : "";

    const classeFinanceiro =
    financeiroExecutadoValor !== null &&
    financeiroExecutadoValor > financeiroPlanejadoValor
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
        moedaCompleta(financeiroPlanejadoValor)
      )
    );

    tr.appendChild(
      criarCelulaHTMLSeguro(
        financeiroExecutadoValor !== null
        ? moedaCompleta(financeiroExecutadoValor)
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

  const financeiroPlanejadoPercentual =
  planejadoLista.map(
    item =>
    Number(
      item.financeiroAcumuladoPercentualCalculado ||
      0
    )
  );

  const realizadoPorSemana =
  new Map();

  realizadoLista.forEach((item) => {

    realizadoPorSemana.set(
      chaveSemana(item.semana),
      item
    );

  });

  const fisicoRealizado =
  planejadoLista.map((item) => {

    const realizado =
    realizadoPorSemana.get(
      chaveSemana(item.semana)
    );

    return realizado
    ? Number(
      realizado.fisicoAcumuladoCalculado ||
      0
    )
    : null;

  });

  const financeiroRealizadoPercentual =
  planejadoLista.map((item) => {

    const realizado =
    realizadoPorSemana.get(
      chaveSemana(item.semana)
    );

    if (
      !realizado ||
      realizado.financeiroAcumuladoPercentualCalculado === null ||
      realizado.financeiroAcumuladoPercentualCalculado === undefined
    ) {
      return null;
    }

    return Number(
      realizado.financeiroAcumuladoPercentualCalculado ||
      0
    );

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
          pointRadius: 5,
          datalabels: {
            align: "top",
            anchor: "end",
            offset: 8,
            color: "#8BC34A"
          }
        },

        {
          label: "Realizado Acumulado (%)",
          data: fisicoRealizado,
          borderColor: "#007E7A",
          backgroundColor: "#007E7A",
          tension: 0.4,
          pointRadius: 5,
          spanGaps: false,
          datalabels: {
            align: "bottom",
            anchor: "end",
            offset: 8,
            color: "#007E7A"
          }
        }

      ]

    },

    options: criarOpcoesGraficoPercentual()

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
          tension: 0.4,
          pointRadius: 5,
          datalabels: {
            align: "top",
            anchor: "end",
            offset: 8,
            color: "#8BC34A"
          }
        },

        {
          label: "Executado Acumulado (%)",
          data: financeiroRealizadoPercentual,
          borderColor: "#007E7A",
          backgroundColor: "#007E7A",
          tension: 0.4,
          pointRadius: 5,
          spanGaps: false,
          datalabels: {
            align: "bottom",
            anchor: "end",
            offset: 8,
            color: "#007E7A"
          }
        }

      ]

    },

    options: criarOpcoesGraficoPercentual()

  });

}

/* =====================================================
   OPÇÕES DO GRÁFICO EM PERCENTUAL
===================================================== */

function criarOpcoesGraficoPercentual() {

  return {

    responsive: true,
    maintainAspectRatio: false,

    interaction: {
      mode: "index",
      intersect: false
    },

    plugins: {

      legend: {

        labels: {
          font: {
            size: 11,
            weight: "700"
          }
        }

      },

      datalabels: {

        align: "bottom",
        anchor: "end",
        offset: 8,

        formatter: (value) => {

          if (
            value === null ||
            value === undefined
          ) {
            return "";
          }

          return percentual(value);

        },

        font: {
          size: 12,
          weight: "bold"
        }

      },

      tooltip: {

        callbacks: {

          label: (context) => {

            if (
              context.raw === null ||
              context.raw === undefined
            ) {
              return "";
            }

            return `${context.dataset.label}: ${percentual(context.raw || 0)}`;

          }

        }

      }

    },

    scales: {

      y: {

        beginAtZero: true,
        suggestedMax: 100,
        max: 110,

        ticks: {

          callback: (value) => `${value}%`

        }

      }

    }

  };

}

/* =====================================================
   EXPORTAR PDF POR BLOCOS
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

        btnExportarPDF.disabled =
        true;

        btnExportarPDF.innerHTML =
        `<i class="fa-solid fa-spinner fa-spin"></i> Gerando PDF`;

        document.body.classList.add(
          "exportando-pdf"
        );

        await new Promise((resolve) =>
          setTimeout(resolve, 250)
        );

        redimensionarGraficos();

        await new Promise((resolve) =>
          setTimeout(resolve, 500)
        );

        const { jsPDF } =
        window.jspdf;

        const pdf =
        new jsPDF(
          "l",
          "mm",
          "a4"
        );

        const larguraPagina =
        pdf.internal.pageSize.getWidth();

        const alturaPagina =
        pdf.internal.pageSize.getHeight();

        const margem =
        8;

        const larguraUtil =
        larguraPagina - margem * 2;

        const alturaUtil =
        alturaPagina - margem * 2;

        let posicaoY =
        margem;

        let primeiraPagina =
        true;

        const blocos =
        obterBlocosParaPDF();

        for (const bloco of blocos) {

          if (
            !bloco ||
            bloco.offsetParent === null
          ) {
            continue;
          }

          const canvas =
          await window.html2canvas(
            bloco,
            {
              scale: 2,
              useCORS: true,
              backgroundColor: "#ffffff",
              logging: false
            }
          );

          const imgData =
          canvas.toDataURL(
            "image/png"
          );

          let imgWidth =
          larguraUtil;

          let imgHeight =
          (
            canvas.height *
            imgWidth
          ) /
          canvas.width;

          if (imgHeight > alturaUtil) {

            const fator =
            alturaUtil / imgHeight;

            imgHeight =
            alturaUtil;

            imgWidth =
            imgWidth * fator;

          }

          if (
            !primeiraPagina &&
            posicaoY + imgHeight > alturaPagina - margem
          ) {

            pdf.addPage();

            posicaoY =
            margem;

          }

          const posicaoX =
          margem + (
            larguraUtil - imgWidth
          ) / 2;

          pdf.addImage(
            imgData,
            "PNG",
            posicaoX,
            posicaoY,
            imgWidth,
            imgHeight
          );

          posicaoY +=
          imgHeight + 5;

          primeiraPagina =
          false;

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
        `<i class="fa-solid fa-file-pdf"></i> Exportar PDF`;

        redimensionarGraficos();

      }

    }
  );

}

function obterBlocosParaPDF() {

  const blocos = [];

  const topbar =
  document.querySelector(".topbar");

  const filtros =
  document.querySelector(".main > .card");

  const resumoTopo =
  document.querySelector(".resumo-topo");

  const resumoTabela =
  document.querySelector(".main > .card:nth-of-type(2)");

  if (topbar) {
    blocos.push(topbar);
  }

  if (filtros) {
    blocos.push(filtros);
  }

  if (resumoTopo) {
    blocos.push(resumoTopo);
  }

  if (resumoTabela) {
    blocos.push(resumoTabela);
  }

  if (
    detalhamentoPlanejamento &&
    detalhamentoPlanejamento.style.display !== "none"
  ) {

    detalhamentoPlanejamento
      .querySelectorAll(":scope > .card, :scope .chart-card")
      .forEach((bloco) => {

        blocos.push(bloco);

      });

  }

  return blocos;

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

  configurarSemaforoMiniResumo();

}

window.addEventListener(
  "resize",
  redimensionarGraficos
);

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