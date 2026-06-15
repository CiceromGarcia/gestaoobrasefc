/* =====================================================
   GESTÃO DE OBRAS - PROTEGIDO COM AUTH GUARD
===================================================== */

import {
  db
} from "./firebaseConfig.js";

import {
  protegerPagina
} from "./authGuard.js";

import {
  collection,
  getDocs
} from "https://www.gstatic.com/firebasejs/10.12.3/firebase-firestore.js";

/* =========================================
   USUÁRIO LOGADO
========================================= */

let usuarioLogadoGlobal = null;

/* =========================================
   ELEMENTOS
========================================= */

const tbodyProjetos =
document.getElementById("tbodyProjetos");

const totalFiltrado =
document.getElementById("totalFiltrado");

const kpiTotal =
document.getElementById("kpiTotal");

const kpiValidadas =
document.getElementById("kpiValidadas");

const kpiPlanejadas =
document.getElementById("kpiPlanejadas");

const kpiAndamento =
document.getElementById("kpiAndamento");

const kpiParalisadas =
document.getElementById("kpiParalisadas");

const kpiConcluidas =
document.getElementById("kpiConcluidas");

/* =========================================
   FILTROS
========================================= */

const filtroRegional =
document.getElementById("filtroRegional");

const filtroLocalidade =
document.getElementById("filtroLocalidade");

const filtroAno =
document.getElementById("filtroAno");

const filtroGutNivel =
document.getElementById("filtroGutNivel");

const filtroStatus =
document.getElementById("filtroStatus");

/* =========================================
   LISTA PRINCIPAL
========================================= */

let listaProjetos = [];

/* =========================================
   UTILITÁRIOS
========================================= */

function normalizarTexto(valor) {

  return String(valor || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();

}

function chaveMapa(valor) {

  return normalizarTexto(valor);

}

function chavesUnicas(lista) {

  return [
    ...new Set(
      lista
        .filter(Boolean)
        .map(chaveMapa)
        .filter(Boolean)
    )
  ];

}

function numeroBRL(valor) {

  if (
    valor === null ||
    valor === undefined ||
    valor === ""
  ) {
    return 0;
  }

  if (typeof valor === "number") {
    return Number.isFinite(valor) ? valor : 0;
  }

  let texto =
  String(valor)
    .trim()
    .replace(/[^\d,.-]/g, "");

  if (!texto) {
    return 0;
  }

  if (texto.includes(",")) {

    texto =
    texto
      .replace(/\./g, "")
      .replace(",", ".");

  } else {

    const partes =
    texto.split(".");

    if (partes.length > 2) {

      const decimal =
      partes.pop();

      texto =
      partes.join("") + "." + decimal;

    } else if (
      partes.length === 2 &&
      partes[1].length === 3
    ) {

      texto =
      partes.join("");

    }

  }

  const numero =
  Number(texto);

  return Number.isFinite(numero) ? numero : 0;

}

function moeda(valor) {

  return numeroBRL(valor).toLocaleString(
    "pt-BR",
    {
      style: "currency",
      currency: "BRL"
    }
  );

}

/* =========================================
   DATAS
========================================= */

function converterParaDate(valor) {

  if (!valor) {
    return null;
  }

  if (valor?.toDate) {
    return valor.toDate();
  }

  if (valor instanceof Date) {
    return valor;
  }

  if (
    typeof valor === "object" &&
    valor.seconds
  ) {
    return new Date(valor.seconds * 1000);
  }

  const texto =
  String(valor).trim();

  if (!texto) {
    return null;
  }

  if (texto.includes("/")) {

    const partes =
    texto.split("/");

    if (partes.length === 3) {

      const dia =
      Number(partes[0]);

      const mes =
      Number(partes[1]) - 1;

      const ano =
      Number(partes[2]);

      return new Date(ano, mes, dia);

    }

  }

  if (texto.includes("-")) {

    const limpo =
    texto.split("T")[0];

    const partes =
    limpo.split("-");

    if (partes.length === 3) {

      const ano =
      Number(partes[0]);

      const mes =
      Number(partes[1]) - 1;

      const dia =
      Number(partes[2]);

      return new Date(ano, mes, dia);

    }

  }

  const data =
  new Date(texto);

  return Number.isNaN(data.getTime()) ? null : data;

}

function dataParaTempo(valor) {

  const data =
  converterParaDate(valor);

  return data ? data.getTime() : null;

}

function formatarData(valor) {

  const data =
  converterParaDate(valor);

  if (!data) {
    return "-";
  }

  return data.toLocaleDateString("pt-BR");

}

function obterAno(valor) {

  const data =
  converterParaDate(valor);

  if (!data) {
    return "";
  }

  return String(data.getFullYear());

}

function extrairDatasPeriodo(periodo) {

  const texto =
  String(periodo || "");

  if (!texto) {

    return {
      inicio: "",
      fim: ""
    };

  }

  const datasBR =
  texto.match(/\d{2}\/\d{2}\/\d{4}/g);

  if (
    datasBR &&
    datasBR.length >= 2
  ) {

    return {
      inicio: datasBR[0],
      fim: datasBR[datasBR.length - 1]
    };

  }

  const datasISO =
  texto.match(/\d{4}-\d{2}-\d{2}/g);

  if (
    datasISO &&
    datasISO.length >= 2
  ) {

    return {
      inicio: datasISO[0],
      fim: datasISO[datasISO.length - 1]
    };

  }

  return {
    inicio: "",
    fim: ""
  };

}

/* =========================================
   STATUS
========================================= */

function normalizarStatus(status) {

  const texto =
  normalizarTexto(status);

  if (
    texto.includes("concl") ||
    texto.includes("final")
  ) {
    return "Concluído";
  }

  if (
    texto.includes("andamento") ||
    texto.includes("execu")
  ) {
    return "Em andamento";
  }

  if (
    texto.includes("paralis") ||
    texto.includes("suspens")
  ) {
    return "Paralisada";
  }

  if (texto.includes("planej")) {
    return "Planejado";
  }

  return status || "Planejado";

}

function calcularStatus(
  obra,
  custoExecucao,
  fisicoRealAcum
) {

  const fisico =
  numeroBRL(
    fisicoRealAcum ??
    obra.fisicoRealAcum ??
    obra.fisicoRealizadoAcum ??
    obra.fisicoAcumReal ??
    obra.fisicoExecutadoAcum ??
    obra.fisicoAcumuladoReal ??
    obra.fisicoAcum ??
    obra.avancoFisico ??
    obra.avancoFisicoNovo ??
    0
  );

  if (fisico >= 100) {
    return "Concluído";
  }

  if (
    fisico > 0 &&
    fisico < 100
  ) {
    return "Em andamento";
  }

  if (
    custoExecucao > 0 &&
    fisico <= 0
  ) {
    return "Paralisada";
  }

  const statusInformado =
  obra.status ||
  obra.statusObra ||
  obra.statusNovo ||
  "";

  if (statusInformado) {
    return normalizarStatus(statusInformado);
  }

  return "Planejado";

}

/* =========================================
   PRIORIDADE
========================================= */

function ordemPrioridade(valor) {

  const prioridade =
  normalizarTexto(valor);

  const mapa = {
    "critica": 1,
    "muito alta": 2,
    "alta": 3,
    "moderada": 4,
    "baixa": 5
  };

  return mapa[prioridade] || 99;

}

/* =========================================
   CAMPOS DA OBRA
========================================= */

function obterCodigoObra(obra, docId) {

  return (
    obra.idObra ||
    obra.codigoObra ||
    obra.codigo ||
    obra.idProjeto ||
    docId ||
    "-"
  );

}

function obterNomeObra(obra) {

  return (
    obra.nomeProjeto ||
    obra.nomeObra ||
    obra.projeto ||
    obra.obra ||
    "-"
  );

}

function obterChavesObra(obra, docId) {

  return chavesUnicas([
    docId,
    obra.id,
    obra.obraId,
    obra.idObra,
    obra.codigoObra,
    obra.codigo,
    obra.idProjeto,
    obra.nomeProjeto,
    obra.nomeObra
  ]);

}

function buscarNoMapa(mapa, chaves) {

  for (const chave of chaves) {

    if (mapa[chave]) {
      return mapa[chave];
    }

  }

  return null;

}

/* =========================================
   MAPA DE DATAS DO PLANEJAMENTO
========================================= */

function adicionarDatasMapa(
  mapa,
  chave,
  inicio,
  fim
) {

  const chaveFinal =
  chaveMapa(chave);

  if (!chaveFinal) {
    return;
  }

  if (!mapa[chaveFinal]) {

    mapa[chaveFinal] = {
      inicio: "",
      fim: ""
    };

  }

  const tempoInicioNovo =
  dataParaTempo(inicio);

  const tempoFimNovo =
  dataParaTempo(fim);

  const tempoInicioAtual =
  dataParaTempo(mapa[chaveFinal].inicio);

  const tempoFimAtual =
  dataParaTempo(mapa[chaveFinal].fim);

  if (
    tempoInicioNovo !== null &&
    (
      tempoInicioAtual === null ||
      tempoInicioNovo < tempoInicioAtual
    )
  ) {

    mapa[chaveFinal].inicio =
    inicio;

  }

  if (
    tempoFimNovo !== null &&
    (
      tempoFimAtual === null ||
      tempoFimNovo > tempoFimAtual
    )
  ) {

    mapa[chaveFinal].fim =
    fim;

  }

}

function montarMapaDatas(snapshotCurva) {

  const mapaDatas = {};

  snapshotCurva.forEach((documento) => {

    const item =
    documento.data();

    const periodo =
    extrairDatasPeriodo(item.periodo);

    const inicio =
    item.dataInicio ||
    item.dataInicioPrevisto ||
    item.inicio ||
    item.inicioPrevisto ||
    periodo.inicio ||
    "";

    const fim =
    item.dataFim ||
    item.dataTerminoPrevisto ||
    item.dataFimPrevisto ||
    item.termino ||
    item.fim ||
    periodo.fim ||
    "";

    const chaves =
    chavesUnicas([
      item.obraId,
      item.idObra,
      item.codigoObra,
      item.idProjeto,
      item.nomeProjeto,
      item.obraNome,
      item.nomeObra,
      item.obra
    ]);

    chaves.forEach((chave) => {

      adicionarDatasMapa(
        mapaDatas,
        chave,
        inicio,
        fim
      );

    });

  });

  return mapaDatas;

}

/* =========================================
   REALIZADO CURVA S
========================================= */

function valorAcumuladoReal(item) {

  const campos = [
    "financeiroRealAcum",
    "financeiroRealizadoAcum",
    "financeiroAcumReal",
    "financeiroExecutadoAcum",
    "financeiroAcumuladoReal",
    "custoRealAcumulado",
    "custoAcumulado",
    "financeiroAcum"
  ];

  for (const campo of campos) {

    if (
      item[campo] !== undefined &&
      item[campo] !== null &&
      item[campo] !== ""
    ) {

      return {
        existe: true,
        valor: numeroBRL(item[campo])
      };

    }

  }

  return {
    existe: false,
    valor: 0
  };

}

function valorSemanalReal(item) {

  return numeroBRL(
    item.financeiroReal ??
    item.financeiroRealizado ??
    item.custoSemana ??
    item.custoReal ??
    item.financeiroExecutado ??
    0
  );

}

function valorAcumuladoFisicoReal(item) {

  const campos = [
    "fisicoRealAcum",
    "fisicoRealizadoAcum",
    "fisicoAcumReal",
    "fisicoExecutadoAcum",
    "fisicoAcumuladoReal",
    "avancoFisicoAcumulado",
    "avancoFisicoNovo",
    "fisicoAcum"
  ];

  for (const campo of campos) {

    if (
      item[campo] !== undefined &&
      item[campo] !== null &&
      item[campo] !== ""
    ) {

      return {
        existe: true,
        valor: numeroBRL(item[campo])
      };

    }

  }

  return {
    existe: false,
    valor: 0
  };

}

function valorFisicoSemanalReal(item) {

  return numeroBRL(
    item.fisicoReal ??
    item.fisicoRealizado ??
    item.avancoFisico ??
    item.avancoFisicoNovo ??
    item.fisico ??
    0
  );

}

function ordemRegistroRealizado(item) {

  const datas = [
    item.dataAtualizacao,
    item.atualizadoEm,
    item.criadoEm,
    item.dataRealizacao,
    item.dataLancamento,
    item.data
  ];

  for (const data of datas) {

    const tempo =
    dataParaTempo(data);

    if (tempo !== null) {
      return tempo;
    }

  }

  const semana =
  Number(
    String(item.semana || "")
      .replace(/[^\d]/g, "")
  );

  if (
    Number.isFinite(semana) &&
    semana > 0
  ) {
    return semana;
  }

  return -1;

}

function criarGrupoRealizado() {

  return {
    possuiAcumulado: false,
    possuiFisicoAcumulado: false,

    financeiroRealAcum: 0,
    fisicoRealAcum: 0,

    ordem: -1,
    ordemFisico: -1,

    somaSemanal: 0,
    somaFisicoSemanal: 0
  };

}

function atualizarGrupoRealizado(
  grupo,
  item
) {

  const acumulado =
  valorAcumuladoReal(item);

  const acumuladoFisico =
  valorAcumuladoFisicoReal(item);

  const ordem =
  ordemRegistroRealizado(item);

  if (acumulado.existe) {

    grupo.possuiAcumulado = true;

    if (
      ordem > grupo.ordem ||
      (
        ordem === grupo.ordem &&
        acumulado.valor > grupo.financeiroRealAcum
      )
    ) {

      grupo.ordem =
      ordem;

      grupo.financeiroRealAcum =
      acumulado.valor;

    }

  } else {

    grupo.somaSemanal +=
    valorSemanalReal(item);

  }

  if (acumuladoFisico.existe) {

    grupo.possuiFisicoAcumulado = true;

    if (
      ordem > grupo.ordemFisico ||
      (
        ordem === grupo.ordemFisico &&
        acumuladoFisico.valor > grupo.fisicoRealAcum
      )
    ) {

      grupo.ordemFisico =
      ordem;

      grupo.fisicoRealAcum =
      acumuladoFisico.valor;

    }

  } else {

    grupo.somaFisicoSemanal +=
    valorFisicoSemanalReal(item);

  }

}

function montarMapaRealizado(snapshotRealizado) {

  const mapaRealizado = {};

  snapshotRealizado.forEach((documento) => {

    const item =
    documento.data();

    const chaves =
    chavesUnicas([
      item.obraId,
      item.idObra,
      item.codigoObra,
      item.idProjeto,
      item.nomeProjeto,
      item.obraNome,
      item.nomeObra,
      item.obra
    ]);

    chaves.forEach((chave) => {

      if (!mapaRealizado[chave]) {

        mapaRealizado[chave] =
        criarGrupoRealizado();

      }

      atualizarGrupoRealizado(
        mapaRealizado[chave],
        item
      );

    });

  });

  Object.keys(mapaRealizado).forEach((chave) => {

    const grupo =
    mapaRealizado[chave];

    if (!grupo.possuiAcumulado) {

      grupo.financeiroRealAcum =
      grupo.somaSemanal;

    }

    if (!grupo.possuiFisicoAcumulado) {

      grupo.fisicoRealAcum =
      grupo.somaFisicoSemanal;

    }

  });

  return mapaRealizado;

}

/* =========================================
   BUSCAR COLEÇÃO
========================================= */

async function buscarColecao(nomeColecao) {

  try {

    return await getDocs(
      collection(
        db,
        nomeColecao
      )
    );

  } catch (error) {

    console.warn(
      `Não foi possível carregar a coleção ${nomeColecao}:`,
      error
    );

    return {
      forEach: () => {}
    };

  }

}

/* =========================================
   HELPERS VISUAIS
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

function criarBadgeStatus(status) {

  const statusFinal =
  normalizarStatus(status);

  const span =
  document.createElement("span");

  span.className =
  `badge ${normalizarTexto(statusFinal).replace(/\s+/g, "-")}`;

  span.textContent =
  statusFinal;

  return span;

}

function criarBadgePrioridade(prioridade) {

  if (
    !prioridade ||
    prioridade === "-"
  ) {
    return document.createTextNode("-");
  }

  const span =
  document.createElement("span");

  span.className =
  `badge-prioridade prioridade-${normalizarTexto(prioridade).replace(/\s+/g, "-")}`;

  span.textContent =
  prioridade;

  return span;

}

function criarCelulaComElemento(elemento) {

  const td =
  document.createElement("td");

  td.appendChild(elemento);

  return td;

}

function mostrarMensagemTabela(mensagem) {

  if (!tbodyProjetos) {
    return;
  }

  tbodyProjetos.innerHTML = "";

  const tr =
  document.createElement("tr");

  const td =
  document.createElement("td");

  td.colSpan =
  10;

  td.textContent =
  mensagem;

  tr.appendChild(td);

  tbodyProjetos.appendChild(tr);

}

/* =========================================
   CARREGAR PROJETOS
========================================= */

async function carregarProjetos() {

  try {

    mostrarMensagemTabela(
      "Carregando projetos..."
    );

    const snapshotObras =
    await buscarColecao("obras");

    const snapshotCurva =
    await buscarColecao("planejamentoCurvaS");

    const snapshotRealizado =
    await buscarColecao("realizadoCurvaS");

    const mapaDatas =
    montarMapaDatas(snapshotCurva);

    const mapaRealizado =
    montarMapaRealizado(snapshotRealizado);

    listaProjetos = [];

    snapshotObras.forEach((documento) => {

      const obra =
      documento.data();

      const chaves =
      obterChavesObra(
        obra,
        documento.id
      );

      const datasCurva =
      buscarNoMapa(
        mapaDatas,
        chaves
      ) || {};

      const realizado =
      buscarNoMapa(
        mapaRealizado,
        chaves
      ) || {};

      const custoExecucao =
      numeroBRL(
        realizado.financeiroRealAcum ??
        obra.financeiroRealAcum ??
        obra.financeiroRealizadoAcum ??
        obra.financeiroAcumReal ??
        obra.financeiroExecutadoAcum ??
        obra.financeiroAcumuladoReal ??
        obra.custoRealAcumulado ??
        0
      );

      const fisicoRealAcum =
      numeroBRL(
        realizado.fisicoRealAcum ??
        obra.fisicoRealAcum ??
        obra.fisicoRealizadoAcum ??
        obra.fisicoAcumReal ??
        obra.fisicoExecutadoAcum ??
        obra.fisicoAcumuladoReal ??
        obra.fisicoAcum ??
        obra.avancoFisico ??
        obra.avancoFisicoNovo ??
        0
      );

      const inicioObra =
      obra.dataInicioPrevisto ||
      obra.dataInicio ||
      obra.inicioPrevisto ||
      obra.inicio ||
      obra.dataInicioObra ||
      datasCurva.inicio ||
      "";

      const fimObra =
      obra.dataTerminoPrevisto ||
      obra.dataFimPrevisto ||
      obra.dataTermino ||
      obra.dataFim ||
      obra.terminoPrevisto ||
      obra.termino ||
      obra.fim ||
      obra.dataFimObra ||
      datasCurva.fim ||
      "";

      const statusFinal =
      calcularStatus(
        obra,
        custoExecucao,
        fisicoRealAcum
      );

      listaProjetos.push({

        id:
        documento.id,

        ...obra,

        codigoObraTela:
        obterCodigoObra(
          obra,
          documento.id
        ),

        nomeObraTela:
        obterNomeObra(
          obra
        ),

        inicioObraTela:
        inicioObra,

        fimObraTela:
        fimObra,

        custoExecucao:
        custoExecucao,

        fisicoRealAcum:
        fisicoRealAcum,

        statusFinal:
        statusFinal,

        prioridadeFinal:
        obra.gutNivel ||
        obra.prioridade ||
        obra.nivel ||
        "-"

      });

    });

    carregarFiltros();

    aplicarFiltros();

  } catch (error) {

    console.error(
      "Erro ao carregar projetos:",
      error
    );

    mostrarMensagemTabela(
      "Erro ao carregar projetos. Verifique suas permissões no Firestore."
    );

  }

}

/* =========================================
   CARREGAR FILTROS
========================================= */

function carregarFiltros() {

  limparSelect(
    filtroRegional,
    "Todas"
  );

  limparSelect(
    filtroLocalidade,
    "Todas"
  );

  limparSelect(
    filtroAno,
    "Todos"
  );

  const regionais =
  [
    ...new Set(
      listaProjetos
        .map((item) => item.regional)
        .filter(Boolean)
    )
  ]
    .sort((a, b) =>
      String(a).localeCompare(String(b), "pt-BR")
    );

  regionais.forEach((regional) => {

    adicionarOption(
      filtroRegional,
      regional
    );

  });

  const localidades =
  [
    ...new Set(
      listaProjetos
        .map((item) => item.localidade)
        .filter(Boolean)
    )
  ]
    .sort((a, b) =>
      String(a).localeCompare(String(b), "pt-BR")
    );

  localidades.forEach((localidade) => {

    adicionarOption(
      filtroLocalidade,
      localidade
    );

  });

  const anos =
  [
    ...new Set(
      listaProjetos
        .map((item) =>
          obterAno(item.inicioObraTela) ||
          obterAno(item.fimObraTela)
        )
        .filter(Boolean)
    )
  ].sort();

  anos.forEach((ano) => {

    adicionarOption(
      filtroAno,
      ano
    );

  });

}

/* =========================================
   APLICAR FILTROS
========================================= */

function aplicarFiltros() {

  let lista =
  [...listaProjetos];

  if (filtroRegional?.value) {

    lista =
    lista.filter((item) =>
      normalizarTexto(item.regional) ===
      normalizarTexto(filtroRegional.value)
    );

  }

  if (filtroLocalidade?.value) {

    lista =
    lista.filter((item) =>
      normalizarTexto(item.localidade) ===
      normalizarTexto(filtroLocalidade.value)
    );

  }

  if (filtroAno?.value) {

    lista =
    lista.filter((item) => {

      const anoInicio =
      obterAno(item.inicioObraTela);

      const anoFim =
      obterAno(item.fimObraTela);

      return (
        anoInicio === filtroAno.value ||
        anoFim === filtroAno.value
      );

    });

  }

  if (filtroGutNivel?.value) {

    lista =
    lista.filter((item) =>
      normalizarTexto(item.prioridadeFinal) ===
      normalizarTexto(filtroGutNivel.value)
    );

  }

  if (filtroStatus?.value) {

    lista =
    lista.filter((item) =>
      normalizarTexto(
        normalizarStatus(item.statusFinal)
      ) ===
      normalizarTexto(
        normalizarStatus(filtroStatus.value)
      )
    );

  }

  lista.sort((a, b) => {

    const prioridadeA =
    ordemPrioridade(a.prioridadeFinal);

    const prioridadeB =
    ordemPrioridade(b.prioridadeFinal);

    if (prioridadeA !== prioridadeB) {
      return prioridadeA - prioridadeB;
    }

    const scoreA =
    numeroBRL(a.gutScore || a.score || 0);

    const scoreB =
    numeroBRL(b.gutScore || b.score || 0);

    if (scoreA !== scoreB) {
      return scoreB - scoreA;
    }

    return String(a.nomeObraTela)
      .localeCompare(
        String(b.nomeObraTela),
        "pt-BR"
      );

  });

  renderTabela(lista);

  atualizarKPIs(lista);

}

/* =========================================
   RENDERIZAR TABELA
========================================= */

function renderTabela(lista) {

  if (!tbodyProjetos) {
    return;
  }

  tbodyProjetos.innerHTML = "";

  if (lista.length === 0) {

    mostrarMensagemTabela(
      "Nenhum projeto encontrado."
    );

    if (totalFiltrado) {
      totalFiltrado.textContent =
      moeda(0);
    }

    return;

  }

  let totalExecucao = 0;

  lista.forEach((obra) => {

    totalExecucao +=
    numeroBRL(
      obra.custoExecucao
    );

    const tr =
    document.createElement("tr");

    tr.appendChild(
      criarCelulaTexto(
        obra.codigoObraTela,
        "codigoProjeto"
      )
    );

    tr.appendChild(
      criarCelulaTexto(
        obra.nomeObraTela,
        "nomeProjeto"
      )
    );

    tr.appendChild(
      criarCelulaTexto(
        obra.regional || "-"
      )
    );

    tr.appendChild(
      criarCelulaTexto(
        obra.localidade || "-"
      )
    );

    tr.appendChild(
      criarCelulaTexto(
        moeda(obra.custoExecucao),
        "valorExecucao"
      )
    );

    tr.appendChild(
      criarCelulaTexto(
        formatarData(
          obra.inicioObraTela
        )
      )
    );

    tr.appendChild(
      criarCelulaTexto(
        formatarData(
          obra.fimObraTela
        )
      )
    );

    tr.appendChild(
      criarCelulaComElemento(
        criarBadgePrioridade(
          obra.prioridadeFinal
        )
      )
    );

    tr.appendChild(
      criarCelulaTexto(
        obra.aprovacaoCliente || "-"
      )
    );

    tr.appendChild(
      criarCelulaComElemento(
        criarBadgeStatus(
          obra.statusFinal
        )
      )
    );

    tbodyProjetos.appendChild(tr);

  });

  if (totalFiltrado) {

    totalFiltrado.textContent =
    moeda(totalExecucao);

  }

}

/* =========================================
   KPIs
========================================= */

function atualizarKPIs(lista) {

  if (kpiTotal) {
    kpiTotal.textContent =
    lista.length;
  }

  if (kpiValidadas) {

    kpiValidadas.textContent =
    lista.filter((item) => {

      const aprovacao =
      normalizarTexto(item.aprovacaoCliente);

      return (
        aprovacao === "aprovado" ||
        aprovacao === "aprovada" ||
        aprovacao === "validado" ||
        aprovacao === "validada" ||
        aprovacao === "sim"
      );

    }).length;

  }

  if (kpiPlanejadas) {

    kpiPlanejadas.textContent =
    lista.filter((item) =>
      normalizarTexto(
        normalizarStatus(item.statusFinal)
      ) === "planejado"
    ).length;

  }

  if (kpiAndamento) {

    kpiAndamento.textContent =
    lista.filter((item) =>
      normalizarTexto(
        normalizarStatus(item.statusFinal)
      ) === "em andamento"
    ).length;

  }

  if (kpiParalisadas) {

    kpiParalisadas.textContent =
    lista.filter((item) =>
      normalizarTexto(
        normalizarStatus(item.statusFinal)
      ) === "paralisada"
    ).length;

  }

  if (kpiConcluidas) {

    kpiConcluidas.textContent =
    lista.filter((item) =>
      normalizarTexto(
        normalizarStatus(item.statusFinal)
      ) === "concluido"
    ).length;

  }

}

/* =========================================
   EXPORTAR PDF
========================================= */

function exportarPDF() {

  window.print();

}

window.exportarPDF =
exportarPDF;

/* =========================================
   EVENTOS
========================================= */

function configurarEventos() {

  filtroRegional?.addEventListener(
    "change",
    aplicarFiltros
  );

  filtroLocalidade?.addEventListener(
    "change",
    aplicarFiltros
  );

  filtroAno?.addEventListener(
    "change",
    aplicarFiltros
  );

  filtroGutNivel?.addEventListener(
    "change",
    aplicarFiltros
  );

  filtroStatus?.addEventListener(
    "change",
    aplicarFiltros
  );

}

/* =========================================
   START
========================================= */

document.addEventListener(
  "DOMContentLoaded",
  async () => {

    try {

      usuarioLogadoGlobal =
      await protegerPagina();

      configurarEventos();

      await carregarProjetos();

    } catch (error) {

      console.error(
        "Erro ao iniciar Gestão de Obras:",
        error
      );

      alert(
        "Erro ao iniciar a tela de Gestão de Obras."
      );

    }

  }
);