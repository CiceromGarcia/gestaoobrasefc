import { db } from "./firebaseConfig.js";

import {
  protegerPagina
} from "./authGuard.js";

import {
  collection,
  getDocs,
  doc,
  updateDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.3/firebase-firestore.js";

/* =========================================
   VARIÁVEIS GLOBAIS
========================================= */

let usuarioLogadoGlobal = null;

let obras = [];
let planejamentos = [];
let realizados = [];
let atualizacoes = [];
let anomalias = [];

let chartFisico;
let chartFinanceiro;
let chartRegional;
let chartCentroCusto;
let chartStatus;

let anomaliasRenderizadas = new Map();

/* =========================================
   FORMATADORES
========================================= */

const moeda = new Intl.NumberFormat(
  "pt-BR",
  {
    style: "currency",
    currency: "BRL"
  }
);

function percentual(valor) {

  return `${Number(valor || 0).toFixed(1).replace(".", ",")}%`;

}

/* =========================================
   INICIALIZAÇÃO
========================================= */

document.addEventListener(
  "DOMContentLoaded",
  async () => {

    try {

      usuarioLogadoGlobal =
      await protegerPagina();

      configurarEventos();

      configurarModalStatusAnomalia();

      await carregarDados();

      preencherFiltrosIniciais();

      atualizarDashboard();

      setTexto(
        "ultimaAtualizacao",
        `Última atualização: ${new Date().toLocaleString("pt-BR")}`
      );

    } catch (erro) {

      console.error(
        "Erro ao iniciar indicadores estratégicos:",
        erro
      );

      alert(
        "Erro ao iniciar a tela de indicadores."
      );

    }

  }
);

/* =========================================
   EVENTOS
========================================= */

function configurarEventos() {

  const filtrosPrincipais = [
    "filtroInicio",
    "filtroFim",
    "filtroRegional",
    "filtroCentroCusto",
    "filtroLocalidade",
    "filtroStatus",
    "filtroObra"
  ];

  filtrosPrincipais.forEach((id) => {

    const elemento =
    document.getElementById(id);

    if (!elemento) {
      return;
    }

    elemento.addEventListener(
      "change",
      () => {

        if (
          id === "filtroRegional" ||
          id === "filtroCentroCusto"
        ) {

          atualizarFiltrosDependentes(
            "principal"
          );

        }

        if (id === "filtroLocalidade") {

          atualizarFiltrosDependentes(
            "localidade"
          );

        }

        atualizarDashboard();

      }
    );

  });

  const btnLimpar =
  document.getElementById("btnLimparFiltros");

  if (btnLimpar) {

    btnLimpar.addEventListener(
      "click",
      () => {

        document
          .querySelectorAll(".filters input, .filters select")
          .forEach((elemento) => {

            elemento.value = "";

          });

        preencherFiltrosIniciais();

        atualizarDashboard();

        limparTabelaAnomaliasSelecionada();

      }
    );

  }

  const btnExportar =
  document.getElementById("btnExportar");

  if (btnExportar) {

    btnExportar.addEventListener(
      "click",
      () => {

        window.print();

      }
    );

  }

}

/* =========================================
   MODAL STATUS ANOMALIA
========================================= */

function configurarModalStatusAnomalia() {

  const modal =
  document.getElementById("modalStatusAnomalia");

  const btnFechar =
  document.getElementById("btnFecharModalStatus");

  const btnCancelar =
  document.getElementById("btnCancelarStatusAnomalia");

  const btnSalvar =
  document.getElementById("btnSalvarStatusAnomalia");

  btnFechar?.addEventListener(
    "click",
    fecharModalStatusAnomalia
  );

  btnCancelar?.addEventListener(
    "click",
    fecharModalStatusAnomalia
  );

  btnSalvar?.addEventListener(
    "click",
    salvarStatusAnomalia
  );

  modal?.addEventListener(
    "click",
    (event) => {

      if (event.target === modal) {
        fecharModalStatusAnomalia();
      }

    }
  );

}

function abrirModalStatusAnomalia(
  anomalia,
  novoStatus
) {

  if (!usuarioEhAdministrador(usuarioLogadoGlobal)) {

    alert(
      "Apenas administradores podem alterar o status da anomalia."
    );

    return;

  }

  if (!anomalia?.docId) {

    alert(
      "Não foi possível identificar o registro da anomalia no banco de dados."
    );

    return;

  }

  setValor(
    "modalAnomaliaDocId",
    anomalia.docId
  );

  setValor(
    "modalAnomaliaOrigem",
    anomalia.origem
  );

  setValor(
    "modalAnomaliaObraId",
    anomalia.obraId
  );

  setValor(
    "modalAnomaliaSemana",
    anomalia.semana
  );

  setValor(
    "modalObraAnomalia",
    anomalia.obraNome || "-"
  );

  setValor(
    "modalTipoAnomalia",
    anomalia.tipo || "-"
  );

  setValor(
    "modalStatusAtualAnomalia",
    anomalia.status || "-"
  );

  setValor(
    "modalNovoStatusAnomalia",
    novoStatus || anomalia.status || ""
  );

  setValor(
    "modalObservacaoStatusAnomalia",
    ""
  );

  const modal =
  document.getElementById("modalStatusAnomalia");

  if (modal) {

    modal.classList.add("ativo");

    modal.setAttribute(
      "aria-hidden",
      "false"
    );

  }

}

function fecharModalStatusAnomalia() {

  const modal =
  document.getElementById("modalStatusAnomalia");

  if (modal) {

    modal.classList.remove("ativo");

    modal.setAttribute(
      "aria-hidden",
      "true"
    );

  }

}

async function salvarStatusAnomalia() {

  if (!usuarioEhAdministrador(usuarioLogadoGlobal)) {

    alert(
      "Apenas administradores podem alterar o status da anomalia."
    );

    return;

  }

  const docId =
  getValor("modalAnomaliaDocId");

  const origem =
  getValor("modalAnomaliaOrigem");

  const novoStatus =
  getValor("modalNovoStatusAnomalia");

  const observacao =
  getValor("modalObservacaoStatusAnomalia");

  if (!docId || !origem) {

    alert(
      "Registro da anomalia não identificado."
    );

    return;

  }

  if (!novoStatus) {

    alert(
      "Selecione o novo status da anomalia."
    );

    return;

  }

  const anomaliaAtual =
  [...anomaliasRenderizadas.values()]
    .find((item) =>
      item.docId === docId &&
      item.origem === origem
    );

  try {

    const textoConsolidado =
    montarTextoConsolidadoAnomalia({
      ...(anomaliaAtual || {}),
      status: novoStatus
    });

    await updateDoc(
      doc(
        db,
        origem,
        docId
      ),
      {
        statusAnomalia:
        novoStatus,

        statusTratativa:
        novoStatus,

        "anomalia.status":
        novoStatus,

        anomalias:
        textoConsolidado,

        observacaoStatusAnomalia:
        observacao || "",

        statusAnomaliaAtualizadoPorUid:
        usuarioLogadoGlobal?.uid || "",

        statusAnomaliaAtualizadoPorEmail:
        usuarioLogadoGlobal?.email ||
        usuarioLogadoGlobal?.emailAuth ||
        "",

        statusAnomaliaAtualizadoPorNome:
        usuarioLogadoGlobal?.nome || "",

        statusAnomaliaAtualizadoEm:
        serverTimestamp(),

        atualizadoEm:
        serverTimestamp()
      }
    );

    alert(
      "Status da anomalia atualizado com sucesso!"
    );

    fecharModalStatusAnomalia();

    await carregarDados();

    preencherFiltrosIniciais();

    atualizarDashboard();

  } catch (erro) {

    console.error(
      "Erro ao atualizar status da anomalia:",
      erro
    );

    alert(
      "Erro ao atualizar o status da anomalia. Verifique suas permissões no Firestore."
    );

  }

}

/* =========================================
   CARREGAMENTO FIREBASE
========================================= */

async function carregarDados() {

  try {

    const obrasBanco =
    await buscarColecao("obras");

    const projetosBanco =
    await buscarColecao("projetos");

    obras =
    obrasBanco.length > 0
    ? obrasBanco
    : projetosBanco;

    planejamentos =
    await buscarColecao("planejamentoCurvaS");

    const realizadosBanco =
    await buscarColecao("realizadoCurvaS");

    atualizacoes =
    await buscarColecao("projetos_atualizados");

    const anomaliasColecao =
    await buscarColecao("anomalias");

    realizados = [
      ...realizadosBanco,
      ...converterAtualizacoesParaRealizado(
        atualizacoes
      )
    ];

    const anomaliasRealizado =
    extrairAnomaliasDeLista(
      realizadosBanco,
      "realizadoCurvaS"
    );

    const anomaliasAtualizacoes =
    extrairAnomaliasDeLista(
      atualizacoes,
      "projetos_atualizados"
    );

    const anomaliasAvulsas =
    extrairAnomaliasDeLista(
      anomaliasColecao,
      "anomalias"
    );

    anomalias =
    removerAnomaliasDuplicadas([
      ...anomaliasAvulsas,
      ...anomaliasRealizado,
      ...anomaliasAtualizacoes
    ]);

    console.log("Obras carregadas:", obras);
    console.log("Planejamentos carregados:", planejamentos);
    console.log("Realizados carregados:", realizados);
    console.log("Anomalias carregadas:", anomalias);

  } catch (erro) {

    console.error(
      "Erro ao carregar dados:",
      erro
    );

    alert(
      "Erro ao carregar os indicadores. Verifique o console do navegador."
    );

  }

}

async function buscarColecao(nomeColecao) {

  try {

    const snap =
    await getDocs(
      collection(
        db,
        nomeColecao
      )
    );

    return snap.docs.map((documento) => ({
      docId: documento.id,
      ...documento.data()
    }));

  } catch (erro) {

    console.warn(
      `Não foi possível carregar a coleção: ${nomeColecao}`,
      erro
    );

    return [];

  }

}

/* =========================================
   CONVERSÕES
========================================= */

function converterAtualizacoesParaRealizado(lista) {

  return lista.map((item) => ({

    ...item,

    obraId:
    item.obraId ||
    item.idObra ||
    item.projetoId ||
    item.idProjeto ||
    item.obraDocId,

    idProjeto:
    item.idProjeto ||
    item.idObra ||
    item.obraId,

    obraNome:
    item.obraNome ||
    item.nomeObra ||
    item.nomeProjeto ||
    item.obra,

    data:
    item.data ||
    item.dataAtualizacao ||
    item.atualizadoEm ||
    item.criadoEm,

    fisicoReal:
    numero(
      item.fisicoReal ||
      item.avancoFisicoNovo ||
      item.avancoFisico ||
      0
    ),

    fisicoRealAcum:
    numero(
      item.fisicoRealAcum ||
      item.fisicoAcum ||
      item.avancoFisicoAcumulado ||
      item.avancoFisicoNovo ||
      item.avancoFisico ||
      0
    ),

    financeiroReal:
    numero(
      item.financeiroReal ||
      item.investimentoNovo ||
      item.custoSemana ||
      item.custo ||
      0
    ),

    financeiroRealAcum:
    numero(
      item.financeiroRealAcum ||
      item.financeiroAcum ||
      item.financeiroRealAcumulado ||
      item.financeiroAcumulado ||
      item.valorExecutado ||
      item.executado ||
      item.investimentoNovo ||
      0
    )

  }));

}

function extrairAnomaliasDeLista(lista, origem) {

  return lista
    .map((item) =>
      normalizarAnomalia(
        item,
        origem
      )
    )
    .filter((item) =>
      item.houveAnomalia
    );

}

function normalizarAnomalia(item, origem = "") {

  const mapa =
  typeof item.anomalia === "object" &&
  item.anomalia !== null
  ? item.anomalia
  : {};

  const tipo =
  valorTexto(
    item.tipoAnomalia ||
    mapa.tipo ||
    item.categoriaAnomalia ||
    item.categoria ||
    item.tipo ||
    ""
  );

  const criticidade =
  valorTexto(
    item.criticidadeAnomalia ||
    mapa.criticidade ||
    item.criticidade ||
    item.severidade ||
    item.gravidadeAnomalia ||
    item.gravidade ||
    ""
  );

  const impacto =
  valorTexto(
    item.impactoAnomalia ||
    mapa.impacto ||
    item.impactoPrincipal ||
    item.impactoTexto ||
    ""
  );

  const status =
  obterStatusAnomalia(
    item,
    mapa
  );

  const prazoTratativa =
  item.prazoTratativaAnomalia ||
  mapa.prazoTratativa ||
  item.prazoTratativa ||
  item.prazo ||
  "";

  const responsavel =
  valorTexto(
    item.responsavelAnomalia ||
    mapa.responsavel ||
    item.responsavel ||
    item.responsavelTratativa ||
    ""
  );

  const descricao =
  valorTexto(
    item.descricaoAnomalia ||
    mapa.descricao ||
    item.descricao ||
    item.observacaoAnomalia ||
    item.anomalias ||
    ""
  );

  const acaoCorretiva =
  valorTexto(
    item.acaoCorretivaAnomalia ||
    mapa.acaoCorretiva ||
    item.acaoCorretiva ||
    item.planoAcao ||
    item.acao ||
    ""
  );

  const houveAnomalia =
  item.houveAnomalia === true ||
  item.temAnomalia === "Sim" ||
  mapa.houve === true ||
  Boolean(tipo) ||
  Boolean(criticidade) ||
  Boolean(impacto) ||
  Boolean(descricao) ||
  Boolean(item.anomalias);

  const impactoFinanceiro =
  numero(
    item.impactoFinanceiro ||
    item.custoImpacto ||
    item.valorImpacto ||
    item.impactoFinanceiroAnomalia ||
    0
  );

  const impactoPrazo =
  numero(
    item.impactoPrazo ||
    item.diasImpacto ||
    item.diasAtraso ||
    item.impactoPrazoDias ||
    0
  );

  const data =
  item.data ||
  item.dataAtualizacao ||
  item.atualizadoEm ||
  item.criadoEm ||
  item.periodo ||
  "";

  return {

    docId:
    item.docId ||
    item.id ||
    "",

    origem,

    obraId:
    item.obraId ||
    item.idObra ||
    item.projetoId ||
    item.idProjeto ||
    item.obraDocId ||
    "",

    idProjeto:
    item.idProjeto ||
    item.idObra ||
    item.obraId ||
    "",

    obraNome:
    item.obraNome ||
    item.nomeObra ||
    item.nomeProjeto ||
    item.obra ||
    item.projeto ||
    "Sem obra",

    regional:
    item.regional ||
    "",

    localidade:
    item.localidade ||
    "",

    centroCusto:
    item.centroCusto ||
    item.centroCustoApropriacao ||
    item.centroDeCusto ||
    "",

    semana:
    item.semana ||
    "",

    periodo:
    item.periodo ||
    "",

    data,

    houveAnomalia,

    tipo:
    tipo || "Não classificada",

    categoria:
    tipo || "Não classificada",

    criticidade:
    criticidade || "Média",

    severidade:
    criticidade || "Média",

    impacto:
    impacto || "Não informado",

    status,

    prazoTratativa,

    responsavel,

    descricao:
    descricao || "Sem descrição",

    acaoCorretiva,

    impactoFinanceiro,

    impactoPrazo,

    textoConsolidado:
    item.anomalias || ""

  };

}

function obterStatusAnomalia(item, mapa = {}) {

  const statusEstruturado =
  valorTexto(
    item.statusAnomalia ||
    mapa.status ||
    item.statusTratativa ||
    item.statusProblema ||
    ""
  );

  if (statusEstruturado) {
    return statusEstruturado;
  }

  const statusGenerico =
  valorTexto(
    item.status ||
    ""
  );

  const statusNormalizado =
  normalizarTexto(
    statusGenerico
  );

  if (
    statusNormalizado.includes("aberta") ||
    statusNormalizado.includes("tratativa") ||
    statusNormalizado.includes("tratamento") ||
    statusNormalizado.includes("resolvida") ||
    statusNormalizado.includes("concluida") ||
    statusNormalizado.includes("concluido") ||
    statusNormalizado.includes("finalizada")
  ) {

    return statusGenerico;

  }

  return "Aberta";

}

function removerAnomaliasDuplicadas(lista) {

  const mapa = new Map();

  lista.forEach((item) => {

    const chave = [
      normalizarTexto(item.docId),
      normalizarTexto(item.origem),
      normalizarTexto(item.obraId),
      normalizarTexto(item.obraNome),
      normalizarTexto(item.semana),
      normalizarTexto(item.descricao),
      normalizarTexto(item.tipo)
    ].join("|");

    if (!mapa.has(chave)) {

      mapa.set(
        chave,
        item
      );

    }

  });

  return Array.from(
    mapa.values()
  );

}

function montarTextoConsolidadoAnomalia(anomalia) {

  const partes = [];

  if (anomalia.tipo) {
    partes.push(`Tipo: ${anomalia.tipo}`);
  }

  if (anomalia.criticidade) {
    partes.push(`Criticidade: ${anomalia.criticidade}`);
  }

  if (anomalia.impacto) {
    partes.push(`Impacto: ${anomalia.impacto}`);
  }

  if (anomalia.status) {
    partes.push(`Status: ${anomalia.status}`);
  }

  if (anomalia.prazoTratativa) {
    partes.push(`Prazo: ${formatarPrazo(anomalia.prazoTratativa)}`);
  }

  if (anomalia.responsavel) {
    partes.push(`Responsável: ${anomalia.responsavel}`);
  }

  if (anomalia.descricao) {
    partes.push(`Descrição: ${anomalia.descricao}`);
  }

  if (anomalia.acaoCorretiva) {
    partes.push(`Ação: ${anomalia.acaoCorretiva}`);
  }

  return partes.join(" | ");

}

/* =========================================
   FILTROS
========================================= */

function preencherFiltrosIniciais() {

  preencherSelect(
    "filtroRegional",
    obras.map((obra) => obra.regional),
    "Todas"
  );

  preencherSelect(
    "filtroCentroCusto",
    obras.map((obra) =>
      obterCentroCustoObra(
        obra
      )
    ),
    "Todos"
  );

  preencherSelect(
    "filtroLocalidade",
    obras.map((obra) => obra.localidade),
    "Todas"
  );

  preencherSelect(
    "filtroObra",
    obras.map((obra) =>
      obterNomeObra(
        obra
      )
    ),
    "Todas"
  );

}

function atualizarFiltrosDependentes(origem) {

  const regionalSelecionada =
  getValor("filtroRegional");

  const centroSelecionado =
  getValor("filtroCentroCusto");

  const localidadeSelecionada =
  getValor("filtroLocalidade");

  const obraSelecionada =
  getValor("filtroObra");

  let obrasBase = [...obras];

  if (regionalSelecionada) {

    obrasBase =
    obrasBase.filter((obra) =>
      obra.regional === regionalSelecionada
    );

  }

  if (centroSelecionado) {

    obrasBase =
    obrasBase.filter((obra) =>
      obterCentroCustoObra(obra) === centroSelecionado
    );

  }

  if (origem === "principal") {

    const localidadesPermitidas = [
      ...new Set(
        obrasBase
          .map((obra) => obra.localidade)
          .filter(Boolean)
          .map((valor) => String(valor).trim())
      )
    ].sort();

    preencherSelect(
      "filtroLocalidade",
      localidadesPermitidas,
      "Todas"
    );

    if (
      localidadeSelecionada &&
      !localidadesPermitidas.includes(localidadeSelecionada)
    ) {

      setValor(
        "filtroLocalidade",
        ""
      );

    }

  }

  const localidadeAtual =
  getValor("filtroLocalidade");

  if (localidadeAtual) {

    obrasBase =
    obrasBase.filter((obra) =>
      obra.localidade === localidadeAtual
    );

  }

  const obrasPermitidas = [
    ...new Set(
      obrasBase
        .map((obra) =>
          obterNomeObra(
            obra
          )
        )
        .filter(Boolean)
        .map((valor) => String(valor).trim())
    )
  ].sort();

  preencherSelect(
    "filtroObra",
    obrasPermitidas,
    "Todas"
  );

  if (
    obraSelecionada &&
    !obrasPermitidas.includes(obraSelecionada)
  ) {

    setValor(
      "filtroObra",
      ""
    );

  }

}

function preencherSelect(id, valores, textoInicial) {

  const select =
  document.getElementById(id);

  if (!select) {
    return;
  }

  const valorAtual =
  select.value;

  select.innerHTML =
  `<option value="">${textoInicial}</option>`;

  const valoresUnicos = [
    ...new Set(
      valores
        .filter(Boolean)
        .map((valor) => String(valor).trim())
        .filter((valor) => valor !== "")
    )
  ].sort();

  valoresUnicos.forEach((valor) => {

    const option =
    document.createElement("option");

    option.value =
    valor;

    option.textContent =
    valor;

    select.appendChild(option);

  });

  if (valoresUnicos.includes(valorAtual)) {

    select.value =
    valorAtual;

  }

}

/* =========================================
   OBRAS FILTRADAS
========================================= */

function obterObrasFiltradasSemStatus() {

  const inicio =
  getValor("filtroInicio");

  const fim =
  getValor("filtroFim");

  const regional =
  getValor("filtroRegional");

  const centroCusto =
  getValor("filtroCentroCusto");

  const localidade =
  getValor("filtroLocalidade");

  const obraSelecionada =
  getValor("filtroObra");

  return obras.filter((obra) => {

    const nome =
    obterNomeObra(obra);

    const centro =
    obterCentroCustoObra(obra);

    const passaFiltrosBasicos =
    (!regional || obra.regional === regional) &&
    (!centroCusto || centro === centroCusto) &&
    (!localidade || obra.localidade === localidade) &&
    (!obraSelecionada || nome === obraSelecionada);

    if (!passaFiltrosBasicos) {
      return false;
    }

    if (!inicio && !fim) {
      return true;
    }

    return obraTemMovimentoNoPeriodo(
      obra,
      inicio,
      fim
    );

  });

}

function obraTemMovimentoNoPeriodo(
  obra,
  filtroInicio,
  filtroFim
) {

  const intervaloObra =
  obterIntervaloObra(
    obra
  );

  if (
    intervaloObra &&
    intervaloSobrepoeFiltro(
      intervaloObra.inicio,
      intervaloObra.fim,
      filtroInicio,
      filtroFim
    )
  ) {
    return true;
  }

  const temPlanejamento =
  planejamentos.some((item) =>
    pertenceAObra(item, obra) &&
    itemRespeitaPeriodo(
      item,
      filtroInicio,
      filtroFim
    )
  );

  if (temPlanejamento) {
    return true;
  }

  const temRealizado =
  realizados.some((item) =>
    pertenceAObra(item, obra) &&
    itemRespeitaPeriodo(
      item,
      filtroInicio,
      filtroFim
    )
  );

  if (temRealizado) {
    return true;
  }

  const temAnomalia =
  anomalias.some((item) =>
    pertenceAObra(item, obra) &&
    itemRespeitaPeriodo(
      item,
      filtroInicio,
      filtroFim
    )
  );

  return temAnomalia;

}

function obterIntervaloObra(obra) {

  const inicio =
  normalizarData(
    obra.dataInicio ||
    obra.dataInicioPrevisto ||
    obra.inicioPrevisto ||
    obra.inicio
  );

  const fim =
  normalizarData(
    obra.dataFim ||
    obra.dataTerminoPrevisto ||
    obra.dataTermino ||
    obra.terminoPrevisto ||
    obra.fim
  );

  if (!inicio && !fim) {
    return null;
  }

  return {
    inicio: inicio || fim,
    fim: fim || inicio
  };

}

/* =========================================
   DASHBOARD
========================================= */

function atualizarDashboard() {

  atualizarResumoPeriodo();

  const obrasFiltradasSemStatus =
  obterObrasFiltradasSemStatus();

  const planejamentosFiltrados =
  filtrarListaPorObrasEPeriodo(
    planejamentos,
    obrasFiltradasSemStatus
  );

  const realizadosFiltrados =
  filtrarListaPorObrasEPeriodo(
    realizados,
    obrasFiltradasSemStatus
  );

  const anomaliasFiltradas =
  filtrarListaPorObrasEPeriodo(
    anomalias,
    obrasFiltradasSemStatus
  );

  const resumoSemStatus =
  montarResumoObras(
    obrasFiltradasSemStatus,
    planejamentosFiltrados,
    realizadosFiltrados,
    anomaliasFiltradas
  );

  const resumo =
  aplicarFiltroStatusResumo(
    resumoSemStatus
  );

  atualizarKPIs(
    resumo
  );

  atualizarGraficosConsolidados(
    resumo
  );

  atualizarGraficosDistribuicao(
    resumo
  );

  atualizarRanking(
    resumo
  );

  limparTabelaAnomaliasSelecionada();

}

function aplicarFiltroStatusResumo(resumo) {

  const statusFiltro =
  getValor("filtroStatus");

  if (!statusFiltro) {
    return resumo;
  }

  return resumo.filter((obra) =>
    statusEquivalente(
      obra.status,
      statusFiltro
    )
  );

}

/* =========================================
   FILTRAGEM POR OBRA E PERÍODO
========================================= */

function filtrarListaPorObrasEPeriodo(
  lista,
  obrasFiltradas
) {

  const inicio =
  getValor("filtroInicio");

  const fim =
  getValor("filtroFim");

  return lista.filter((item) => {

    const pertence =
    obrasFiltradas.some((obra) =>
      pertenceAObra(
        item,
        obra
      )
    );

    if (!pertence) {
      return false;
    }

    return itemRespeitaPeriodo(
      item,
      inicio,
      fim
    );

  });

}

function itemRespeitaPeriodo(
  item,
  filtroInicio,
  filtroFim
) {

  if (!filtroInicio && !filtroFim) {
    return true;
  }

  const intervalo =
  obterIntervaloItem(
    item
  );

  if (!intervalo) {
    return false;
  }

  return intervaloSobrepoeFiltro(
    intervalo.inicio,
    intervalo.fim,
    filtroInicio,
    filtroFim
  );

}

function obterIntervaloItem(item) {

  if (item.periodo) {

    const intervaloPeriodo =
    obterIntervaloTextoPeriodo(
      item.periodo
    );

    if (intervaloPeriodo) {
      return intervaloPeriodo;
    }

  }

  const data =
  normalizarData(
    item.data ||
    item.dataAtualizacao ||
    item.atualizadoEm ||
    item.criadoEm ||
    item.dataRegistro
  );

  if (!data) {
    return null;
  }

  return {
    inicio: data,
    fim: data
  };

}

function obterIntervaloTextoPeriodo(textoPeriodo) {

  const texto =
  String(textoPeriodo || "").trim();

  if (!texto) {
    return null;
  }

  if (texto.includes(" a ")) {

    const partes =
    texto.split(" a ");

    const inicio =
    normalizarData(
      partes[0].trim()
    );

    const fim =
    normalizarData(
      partes[1].trim()
    );

    if (inicio || fim) {

      return {
        inicio: inicio || fim,
        fim: fim || inicio
      };

    }

  }

  const dataUnica =
  normalizarData(texto);

  if (!dataUnica) {
    return null;
  }

  return {
    inicio: dataUnica,
    fim: dataUnica
  };

}

function intervaloSobrepoeFiltro(
  inicioItem,
  fimItem,
  filtroInicio,
  filtroFim
) {

  const inicioFiltro =
  filtroInicio
  ? new Date(`${filtroInicio}T00:00:00`)
  : null;

  const fimFiltro =
  filtroFim
  ? new Date(`${filtroFim}T23:59:59`)
  : null;

  const inicio =
  inicioItem || fimItem;

  const fim =
  fimItem || inicioItem;

  if (!inicio && !fim) {
    return false;
  }

  if (
    inicioFiltro &&
    fim &&
    fim < inicioFiltro
  ) {
    return false;
  }

  if (
    fimFiltro &&
    inicio &&
    inicio > fimFiltro
  ) {
    return false;
  }

  return true;

}

function pertenceAObra(item, obra) {

  const chavesObra =
  obterChavesObra(obra);

  const chavesItem = [
    item.docId,
    item.id,
    item.obraId,
    item.idObra,
    item.projetoId,
    item.idProjeto,
    item.obraDocId,
    item.codigoObra,
    item.obraCodigo,
    item.obraNome,
    item.nomeObra,
    item.nomeProjeto,
    item.obra,
    item.projeto
  ]
    .filter(Boolean)
    .map((valor) =>
      normalizarTexto(valor)
    );

  const encontrouPorChave =
  chavesItem.some((chave) =>
    chavesObra.includes(chave)
  );

  if (encontrouPorChave) {
    return true;
  }

  const centroItem =
  normalizarTexto(
    item.centroCusto ||
    item.centroDeCusto ||
    item.centroCustoApropriacao
  );

  const centroObra =
  normalizarTexto(
    obterCentroCustoObra(obra)
  );

  const obraItem =
  normalizarTexto(
    item.obraNome ||
    item.nomeObra ||
    item.nomeProjeto ||
    item.obra
  );

  const obraNome =
  normalizarTexto(
    obterNomeObra(obra)
  );

  if (
    centroItem &&
    centroObra &&
    centroItem === centroObra &&
    obraItem &&
    obraNome &&
    obraItem === obraNome
  ) {
    return true;
  }

  if (
    centroItem &&
    centroObra &&
    centroItem === centroObra &&
    !obraItem
  ) {
    return true;
  }

  return false;

}

function obterChavesObra(obra) {

  return [
    obra.docId,
    obra.id,
    obra.obraId,
    obra.idObra,
    obra.idProjeto,
    obra.projetoId,
    obra.codigoObra,
    obra.obraCodigo,
    obra.nomeProjeto,
    obra.nomeObra,
    obra.obraNome,
    obra.obra,
    obra.projeto,
    obterNomeObra(obra)
  ]
    .filter(Boolean)
    .map((valor) =>
      normalizarTexto(valor)
    );

}

/* =========================================
   RESUMO DAS OBRAS
========================================= */

function montarResumoObras(
  obrasLista,
  planLista,
  realLista,
  anomLista
) {

  return obrasLista.map((obra) => {

    const nome =
    obterNomeObra(obra);

    const plan =
    planLista.filter((item) =>
      pertenceAObra(
        item,
        obra
      )
    );

    const real =
    realLista.filter((item) =>
      pertenceAObra(
        item,
        obra
      )
    );

    const anom =
    anomLista.filter((item) =>
      pertenceAObra(
        item,
        obra
      )
    );

    const fisicoPlanejado =
    obterValorAcumulado(
      plan,
      [
        "fisicoAcum",
        "fisicoPlanejadoAcum",
        "fisicoPlanejadoAcumulado"
      ],
      [
        "fisico",
        "fisicoPlanejado",
        "percentualFisico"
      ],
      100
    );

    const fisicoReal =
    obterValorAcumulado(
      real,
      [
        "fisicoRealAcum",
        "fisicoAcum",
        "avancoFisicoAcumulado"
      ],
      [
        "fisicoReal",
        "avancoFisicoNovo",
        "avancoFisico"
      ],
      100
    );

    const financeiroPlanejado =
    obterValorAcumulado(
      plan,
      [
        "financeiroAcum",
        "financeiroPlanejadoAcum",
        "financeiroPlanejadoAcumulado"
      ],
      [
        "financeiro",
        "financeiroPlanejado",
        "valorPlanejado"
      ],
      null
    );

    const financeiroReal =
    obterValorAcumulado(
      real,
      [
        "financeiroRealAcum",
        "financeiroAcum",
        "financeiroRealAcumulado"
      ],
      [
        "financeiroReal",
        "valorExecutado",
        "executado",
        "investimentoNovo",
        "custoSemana",
        "custo"
      ],
      null
    );

    const valorTotalObra =
    numero(
      obra.valorObra ||
      obra.valorTotal ||
      obra.valorOrcado ||
      obra.valorOrçado ||
      obra.valororcado ||
      obra.investimento ||
      obra.custoTotal ||
      obra.orcamento ||
      0
    );

    const existeFiltroPeriodo =
    Boolean(
      getValor("filtroInicio") ||
      getValor("filtroFim")
    );

    const valorOrcado =
    existeFiltroPeriodo
    ? financeiroPlanejado
    : financeiroPlanejado || valorTotalObra;

    const afo =
    fisicoPlanejado > 0
    ? (fisicoReal / fisicoPlanejado) * 100
    : 0;

    const ipf =
    valorOrcado > 0
    ? (financeiroReal / valorOrcado) * 100
    : 0;

    const anomCriticas =
    anom.filter((item) =>
      ehCritica(
        item.criticidade
      )
    ).length;

    const anomAbertas =
    anom.filter((item) =>
      ehAberta(
        item.status
      )
    ).length;

    const anomVencidas =
    anom.filter((item) =>
      obterStatusPrazoAnomalia(item) === "vencidas"
    ).length;

    const statusCalculado =
    calcularStatusObraConsolidado(
      obra,
      fisicoReal,
      financeiroReal
    );

    const saude =
    calcularSaudeObra(
      afo,
      ipf,
      anom.length,
      anomCriticas,
      anomVencidas
    );

    return {

      id:
      obra.docId ||
      obra.id ||
      obra.idProjeto ||
      nome,

      nome,

      regional:
      obra.regional ||
      "-",

      localidade:
      obra.localidade ||
      "-",

      centroCusto:
      obterCentroCustoObra(obra) ||
      "-",

      status:
      statusCalculado,

      valorOrcado,

      financeiroPlanejado,

      financeiroReal,

      saldo:
      valorOrcado - financeiroReal,

      fisicoPlanejado,

      fisicoReal,

      afo,

      ipf,

      anomalias:
      anom.length,

      anomAbertas,

      anomCriticas,

      anomVencidas,

      saude,

      plan,

      real,

      anomaliasLista:
      anom,

      obraOriginal:
      obra

    };

  });

}

/* =========================================
   KPIS
========================================= */

function atualizarKPIs(resumo) {

  const totalObras =
  resumo.length;

  const orcado =
  soma(
    resumo,
    "valorOrcado"
  );

  const executado =
  soma(
    resumo,
    "financeiroReal"
  );

  const saldo =
  orcado - executado;

  const afoMedio =
  media(
    resumo
      .map((item) => item.afo)
      .filter((valor) => valor > 0)
  );

  const saudeMedia =
  media(
    resumo.map((item) => item.saude)
  );

  const obrasCriticas =
  resumo.filter((item) =>
    item.saude < 70 ||
    item.afo < 90 ||
    item.anomCriticas > 0 ||
    item.anomVencidas > 0
  ).length;

  const percExecutado =
  orcado > 0
  ? (executado / orcado) * 100
  : 0;

  const percSaldo =
  orcado > 0
  ? (saldo / orcado) * 100
  : 0;

  setTexto(
    "kpiTotalObras",
    totalObras
  );

  setTexto(
    "kpiOrcado",
    moeda.format(orcado)
  );

  setTexto(
    "kpiExecutado",
    moeda.format(executado)
  );

  setTexto(
    "kpiSaldo",
    moeda.format(saldo)
  );

  setTexto(
    "kpiExecutadoPerc",
    `${percentual(percExecutado)} do orçado`
  );

  setTexto(
    "kpiSaldoPerc",
    `${percentual(percSaldo)} do orçado`
  );

  setTexto(
    "kpiAFO",
    percentual(afoMedio)
  );

  setTexto(
    "kpiSaude",
    percentual(saudeMedia)
  );

  setTexto(
    "kpiObrasCriticas",
    obrasCriticas
  );

  setTexto(
    "ipfFinanceiro",
    percentual(percExecutado)
  );

  setTexto(
    "afoFisico",
    percentual(afoMedio)
  );

  setTexto(
    "kpiAFOStatus",
    afoMedio >= 95
    ? "Conforme"
    : afoMedio >= 90
      ? "Atenção"
      : "Crítico"
  );

  setTexto(
    "kpiSaudeStatus",
    saudeMedia >= 90
    ? "Saudável"
    : saudeMedia >= 70
      ? "Atenção"
      : "Crítico"
  );

  aplicarCorIndicador(
    "kpiSaldo",
    saldo,
    saldo < 0
  );

  aplicarCorIndicador(
    "kpiAFO",
    afoMedio,
    afoMedio < 90
  );

  aplicarCorIndicador(
    "kpiSaude",
    saudeMedia,
    saudeMedia < 70
  );

  aplicarCorIndicador(
    "ipfFinanceiro",
    percExecutado,
    percExecutado > 100
  );

  aplicarCorIndicador(
    "afoFisico",
    afoMedio,
    afoMedio < 90
  );

  aplicarCorIndicador(
    "kpiObrasCriticas",
    obrasCriticas,
    obrasCriticas > 0
  );

}

/* =========================================
   CURVAS CONSOLIDADAS
========================================= */

function atualizarGraficosConsolidados(resumo) {

  const curva =
  montarCurvaConsolidada(
    resumo
  );

  chartFisico =
  criarLinha(
    chartFisico,
    "chartFisico",
    curva.labels,
    [
      {
        label: "Planejado",
        data: curva.fisicoPlanejado,
        borderDash: [6, 4]
      },
      {
        label: "Realizado",
        data: curva.fisicoReal
      }
    ],
    "%"
  );

  chartFinanceiro =
  criarLinha(
    chartFinanceiro,
    "chartFinanceiro",
    curva.labels,
    [
      {
        label: "Planejado R$",
        data: curva.financeiroPlanejado,
        borderDash: [6, 4]
      },
      {
        label: "Executado R$",
        data: curva.financeiroReal
      }
    ],
    "R$"
  );

}

function montarCurvaConsolidada(resumo) {

  const labelsSet =
  new Set();

  resumo.forEach((obra) => {

    obra.plan.forEach((item) =>
      labelsSet.add(
        obterLabelPeriodo(item)
      )
    );

    obra.real.forEach((item) =>
      labelsSet.add(
        obterLabelPeriodo(item)
      )
    );

  });

  const labels =
  ordenarLabels(
    [...labelsSet].filter(Boolean)
  );

  const fisicoPlanejado = [];
  const fisicoReal = [];
  const financeiroPlanejado = [];
  const financeiroReal = [];

  labels.forEach((label) => {

    let pesoPlanejado = 0;
    let pesoReal = 0;

    let fisicoPlanPonderado = 0;
    let fisicoRealPonderado = 0;

    let financeiroPlanTotal = 0;
    let financeiroRealTotal = 0;

    resumo.forEach((obra) => {

      const peso =
      obra.valorOrcado > 0
      ? obra.valorOrcado
      : 1;

      const fisPlan =
      obterAcumuladoAteLabel(
        obra.plan,
        label,
        [
          "fisicoAcum",
          "fisicoPlanejadoAcum",
          "fisicoPlanejadoAcumulado"
        ],
        [
          "fisico",
          "fisicoPlanejado",
          "percentualFisico"
        ],
        100
      );

      const fisReal =
      obterAcumuladoAteLabel(
        obra.real,
        label,
        [
          "fisicoRealAcum",
          "fisicoAcum",
          "avancoFisicoAcumulado"
        ],
        [
          "fisicoReal",
          "avancoFisicoNovo",
          "avancoFisico"
        ],
        100
      );

      const finPlan =
      obterAcumuladoAteLabel(
        obra.plan,
        label,
        [
          "financeiroAcum",
          "financeiroPlanejadoAcum",
          "financeiroPlanejadoAcumulado"
        ],
        [
          "financeiro",
          "financeiroPlanejado",
          "valorPlanejado"
        ],
        null
      );

      const finReal =
      obterAcumuladoAteLabel(
        obra.real,
        label,
        [
          "financeiroRealAcum",
          "financeiroAcum",
          "financeiroRealAcumulado"
        ],
        [
          "financeiroReal",
          "valorExecutado",
          "executado",
          "investimentoNovo",
          "custoSemana",
          "custo"
        ],
        null
      );

      if (fisPlan > 0) {

        fisicoPlanPonderado +=
        fisPlan * peso;

        pesoPlanejado +=
        peso;

      }

      if (fisReal > 0) {

        fisicoRealPonderado +=
        fisReal * peso;

        pesoReal +=
        peso;

      }

      financeiroPlanTotal +=
      finPlan;

      financeiroRealTotal +=
      finReal;

    });

    fisicoPlanejado.push(
      pesoPlanejado > 0
      ? fisicoPlanPonderado / pesoPlanejado
      : 0
    );

    fisicoReal.push(
      pesoReal > 0
      ? fisicoRealPonderado / pesoReal
      : 0
    );

    financeiroPlanejado.push(
      financeiroPlanTotal
    );

    financeiroReal.push(
      financeiroRealTotal
    );

  });

  return {
    labels,
    fisicoPlanejado,
    fisicoReal,
    financeiroPlanejado,
    financeiroReal
  };

}

/* =========================================
   DISTRIBUIÇÃO
========================================= */

function atualizarGraficosDistribuicao(resumo) {

  const porRegional =
  agruparSoma(
    resumo,
    "regional",
    "valorOrcado"
  );

  const porCentro =
  agruparSoma(
    resumo,
    "centroCusto",
    "valorOrcado"
  );

  const porStatus =
  agruparContagem(
    resumo,
    "status"
  );

  chartRegional =
  criarBarra(
    chartRegional,
    "chartRegional",
    Object.keys(porRegional),
    Object.values(porRegional),
    "R$"
  );

  chartCentroCusto =
  criarBarra(
    chartCentroCusto,
    "chartCentroCusto",
    Object.keys(porCentro),
    Object.values(porCentro),
    "R$"
  );

  chartStatus =
  criarRosca(
    chartStatus,
    "chartStatus",
    Object.keys(porStatus),
    Object.values(porStatus)
  );

  setTexto(
    "semSaudaveis",
    resumo.filter((item) => item.afo >= 95).length
  );

  setTexto(
    "semAtencao",
    resumo.filter((item) => item.afo >= 90 && item.afo < 95).length
  );

  setTexto(
    "semCriticas",
    resumo.filter((item) => item.afo < 90).length
  );

}

/* =========================================
   RANKING
========================================= */

function atualizarRanking(resumo) {

  const tbody =
  document.getElementById("tabelaRanking");

  if (!tbody) {
    return;
  }

  tbody.innerHTML = "";

  const ordenado =
  [...resumo].sort((a, b) =>
    (a.saude - b.saude) ||
    (b.anomCriticas - a.anomCriticas) ||
    (b.anomAbertas - a.anomAbertas)
  );

  if (!ordenado.length) {

    tbody.innerHTML = `
      <tr>
        <td colspan="16">
          Nenhuma obra encontrada com os filtros aplicados.
        </td>
      </tr>
    `;

    return;

  }

  ordenado.forEach((obra, index) => {

    const tr =
    document.createElement("tr");

    const classeAfo =
    obra.afo < 90
    ? "td-negativo"
    : "";

    const classeSaude =
    obra.saude < 70
    ? "td-negativo"
    : "";

    const classeSaldo =
    obra.saldo < 0
    ? "td-negativo"
    : "";

    const classeAnomalia =
    obra.anomAbertas > 0
    ? "td-negativo"
    : "";

    const classeCriticas =
    obra.anomCriticas > 0
    ? "td-negativo"
    : "";

    const classeVencidas =
    obra.anomVencidas > 0
    ? "td-negativo"
    : "";

    tr.innerHTML = `
      <td>${index + 1}</td>
      <td>${textoSeguro(obra.nome)}</td>
      <td>${textoSeguro(obra.regional)}</td>
      <td>${textoSeguro(obra.localidade)}</td>
      <td>${textoSeguro(obra.centroCusto)}</td>
      <td>
        <span class="status-pill ${classeStatus(obra.status)}">
          ${textoSeguro(obra.status)}
        </span>
      </td>
      <td class="${classeAfo}">${percentual(obra.afo)}</td>
      <td>${percentual(obra.fisicoReal)}</td>
      <td>${moeda.format(obra.valorOrcado)}</td>
      <td>${moeda.format(obra.financeiroReal)}</td>
      <td class="${classeSaldo}">${moeda.format(obra.saldo)}</td>
      <td>${obra.anomalias}</td>
      <td class="${classeAnomalia}">${obra.anomAbertas}</td>
      <td class="${classeCriticas}">${obra.anomCriticas}</td>
      <td class="${classeVencidas}">${obra.anomVencidas}</td>
      <td class="${classeSaude}">${percentual(obra.saude)}</td>
    `;

    tr.addEventListener(
      "click",
      () => {

        document
          .querySelectorAll("#tabelaRanking tr")
          .forEach((linha) => {

            linha.classList.remove(
              "selecionada"
            );

          });

        tr.classList.add(
          "selecionada"
        );

        mostrarAnomaliasDaObra(
          obra
        );

      }
    );

    tbody.appendChild(tr);

  });

}

/* =========================================
   GESTÃO DAS ANOMALIAS POR OBRA
========================================= */

function mostrarAnomaliasDaObra(obra) {

  const resumo =
  document.getElementById("anomaliasObraSelecionada");

  const tbody =
  document.getElementById("tabelaDescricaoAnomalias");

  if (!tbody) {
    return;
  }

  anomaliasRenderizadas =
  new Map();

  const lista =
  [...obra.anomaliasLista].sort((a, b) => {

    const dataA =
    normalizarData(a.data) ||
    new Date(0);

    const dataB =
    normalizarData(b.data) ||
    new Date(0);

    return dataB - dataA;

  });

  if (resumo) {

    resumo.className =
    "anomalias-obra-resumo";

    resumo.innerHTML = `
      <strong>${textoSeguro(obra.nome)}</strong>
      <span>
        ${lista.length} anomalia(s) registrada(s) |
        ${obra.anomAbertas} aberta(s) |
        ${obra.anomCriticas} crítica(s) |
        ${obra.anomVencidas} vencida(s)
      </span>
    `;

  }

  tbody.innerHTML = "";

  if (!lista.length) {

    tbody.innerHTML = `
      <tr>
        <td colspan="12">
          Nenhuma anomalia registrada para esta obra no período filtrado.
        </td>
      </tr>
    `;

    return;

  }

  lista.forEach((anomalia, index) => {

    const chave =
    criarChaveRenderizacaoAnomalia(
      anomalia,
      index
    );

    anomaliasRenderizadas.set(
      chave,
      anomalia
    );

    const tr =
    document.createElement("tr");

    const classeCriticidade =
    ehCritica(anomalia.criticidade)
    ? "td-negativo"
    : "";

    const classePrazo =
    obterStatusPrazoAnomalia(anomalia) === "vencidas"
    ? "td-negativo"
    : "";

    const admin =
    usuarioEhAdministrador(
      usuarioLogadoGlobal
    );

    const disabled =
    admin
    ? ""
    : "disabled";

    tr.innerHTML = `
      <td>${formatarDataTabela(anomalia.data)}</td>
      <td>${textoSeguro(anomalia.semana || "-")}</td>
      <td>${textoSeguro(anomalia.tipo)}</td>
      <td class="${classeCriticidade}">${textoSeguro(anomalia.criticidade)}</td>
      <td>${textoSeguro(anomalia.impacto)}</td>
      <td>
        <span class="status-anomalia-pill ${classeStatusAnomalia(anomalia.status)}">
          ${textoSeguro(anomalia.status)}
        </span>
      </td>
      <td>
        <select
          class="select-status-anomalia"
          data-chave="${textoSeguro(chave)}"
          ${disabled}
        >
          <option value="">Selecione</option>
          <option value="Aberta" ${statusAnomaliaIgual(anomalia.status, "Aberta") ? "selected" : ""}>Aberta</option>
          <option value="Em tratativa" ${statusAnomaliaIgual(anomalia.status, "Em tratativa") ? "selected" : ""}>Em tratativa</option>
          <option value="Resolvida" ${statusAnomaliaIgual(anomalia.status, "Resolvida") ? "selected" : ""}>Resolvida</option>
        </select>
      </td>
      <td class="${classePrazo}">${formatarPrazo(anomalia.prazoTratativa)}</td>
      <td>${textoSeguro(anomalia.responsavel || "-")}</td>
      <td>${textoSeguro(anomalia.descricao)}</td>
      <td>${textoSeguro(anomalia.acaoCorretiva || "-")}</td>
      <td>
        <button
          type="button"
          class="btn-alterar-status-anomalia"
          data-chave="${textoSeguro(chave)}"
          ${disabled}
        >
          Alterar
        </button>
      </td>
    `;

    tbody.appendChild(tr);

  });

  configurarBotoesAlterarStatusInline();

}

function configurarBotoesAlterarStatusInline() {

  document
    .querySelectorAll(".btn-alterar-status-anomalia")
    .forEach((botao) => {

      botao.addEventListener(
        "click",
        (event) => {

          event.stopPropagation();

          const chave =
          botao.dataset.chave;

          const anomalia =
          anomaliasRenderizadas.get(chave);

          const select =
          document.querySelector(
            `.select-status-anomalia[data-chave="${CSS.escape(chave)}"]`
          );

          const novoStatus =
          select?.value || "";

          abrirModalStatusAnomalia(
            anomalia,
            novoStatus
          );

        }
      );

    });

}

function limparTabelaAnomaliasSelecionada() {

  const resumo =
  document.getElementById("anomaliasObraSelecionada");

  const tbody =
  document.getElementById("tabelaDescricaoAnomalias");

  if (resumo) {

    resumo.className =
    "anomalias-obra-vazio";

    resumo.textContent =
    "Selecione uma obra no ranking para visualizar as anomalias registradas.";

  }

  if (tbody) {

    tbody.innerHTML = `
      <tr>
        <td colspan="12">
          Nenhuma obra selecionada.
        </td>
      </tr>
    `;

  }

}

/* =========================================
   CHART JS
========================================= */

function criarLinha(
  instancia,
  idCanvas,
  labels,
  datasets,
  tipo
) {

  const canvas =
  document.getElementById(idCanvas);

  if (!canvas) {
    return instancia;
  }

  if (instancia) {
    instancia.destroy();
  }

  return new Chart(
    canvas,
    {
      type: "line",
      data: {
        labels,
        datasets: datasets.map((dataset, index) => ({
          ...dataset,
          borderColor:
          index === 0
          ? "#007E7A"
          : "#0ABB98",
          backgroundColor: "transparent",
          tension: 0.35,
          pointRadius: 4,
          pointHoverRadius: 6,
          borderWidth: 3
        }))
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: {
          mode: "index",
          intersect: false
        },
        plugins: {
          legend: {
            labels: {
              boxWidth: 12,
              font: {
                size: 11
              }
            }
          },
          tooltip: {
            callbacks: {
              label: (context) => {

                const valor =
                numero(context.raw);

                if (tipo === "R$") {

                  return `${context.dataset.label}: ${moeda.format(valor)}`;

                }

                return `${context.dataset.label}: ${percentual(valor)}`;

              }
            }
          }
        },
        scales: {
          y: {
            beginAtZero: true,
            ticks: {
              callback: (value) => {

                if (tipo === "R$") {
                  return moeda.format(value);
                }

                return `${value}%`;

              }
            }
          },
          x: {
            ticks: {
              maxRotation: 0,
              autoSkip: true,
              maxTicksLimit: 10
            }
          }
        }
      }
    }
  );

}

function criarBarra(
  instancia,
  idCanvas,
  labels,
  dados,
  tipo = "R$"
) {

  const canvas =
  document.getElementById(idCanvas);

  if (!canvas) {
    return instancia;
  }

  if (instancia) {
    instancia.destroy();
  }

  return new Chart(
    canvas,
    {
      type: "bar",
      data: {
        labels,
        datasets: [
          {
            data: dados,
            backgroundColor: "#007E7A",
            borderRadius: 8
          }
        ]
      },
      options: {
        indexAxis: "y",
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            display: false
          },
          tooltip: {
            callbacks: {
              label: (context) => {

                const valor =
                numero(context.raw);

                if (tipo === "R$") {
                  return moeda.format(valor);
                }

                return `${valor}`;

              }
            }
          }
        },
        scales: {
          x: {
            beginAtZero: true,
            ticks: {
              callback: (value) => {

                if (tipo === "R$") {
                  return moeda.format(value);
                }

                return value;

              }
            }
          }
        }
      }
    }
  );

}

function criarRosca(
  instancia,
  idCanvas,
  labels,
  dados
) {

  const canvas =
  document.getElementById(idCanvas);

  if (!canvas) {
    return instancia;
  }

  if (instancia) {
    instancia.destroy();
  }

  return new Chart(
    canvas,
    {
      type: "doughnut",
      data: {
        labels,
        datasets: [
          {
            data: dados,
            backgroundColor: [
              "#007E7A",
              "#0ABB98",
              "#16a34a",
              "#f59e0b",
              "#ef4444",
              "#2563eb",
              "#8b5cf6",
              "#64748b"
            ],
            borderWidth: 2
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: "right",
            labels: {
              boxWidth: 12,
              font: {
                size: 11
              }
            }
          }
        }
      }
    }
  );

}

/* =========================================
   FUNÇÕES DE APOIO - VALORES
========================================= */

function numero(valor) {

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

  if (typeof valor === "string") {

    let texto =
    valor
      .replace(/\s/g, "")
      .replace("R$", "")
      .replace("%", "")
      .replace(/[^\d,.-]/g, "");

    if (
      texto.includes(",") &&
      texto.includes(".")
    ) {

      texto =
      texto
        .replace(/\./g, "")
        .replace(",", ".");

    } else if (texto.includes(",")) {

      texto =
      texto.replace(",", ".");

    }

    const convertido =
    Number(texto);

    return isNaN(convertido)
    ? 0
    : convertido;

  }

  return Number(valor) || 0;

}

function obterValorAcumulado(
  lista,
  camposAcumulados,
  camposUnitarios,
  limite
) {

  if (!lista.length) {
    return 0;
  }

  const itensComAcumulado =
  lista.filter((item) =>
    camposAcumulados.some((campo) =>
      temValor(item[campo])
    )
  );

  let valor = 0;

  if (itensComAcumulado.length > 0) {

    const ultimo =
    ordenarItensPorLabel(
      itensComAcumulado
    ).at(-1);

    valor =
    obterValorDoItem(
      ultimo,
      camposAcumulados
    );

  } else {

    valor =
    lista.reduce((acc, item) =>
      acc + obterValorDoItem(
        item,
        camposUnitarios
      ),
      0
    );

  }

  if (
    limite !== null &&
    limite !== undefined
  ) {

    return Math.min(
      limite,
      valor
    );

  }

  return valor;

}

function obterAcumuladoAteLabel(
  lista,
  label,
  camposAcumulados,
  camposUnitarios,
  limite
) {

  const itensAteLabel =
  lista.filter((item) =>
    compararLabels(
      obterLabelPeriodo(item),
      label
    ) <= 0
  );

  return obterValorAcumulado(
    itensAteLabel,
    camposAcumulados,
    camposUnitarios,
    limite
  );

}

function obterValorDoItem(item, campos) {

  for (const campo of campos) {

    if (temValor(item[campo])) {

      return numero(
        item[campo]
      );

    }

  }

  return 0;

}

function temValor(valor) {

  return (
    valor !== undefined &&
    valor !== null &&
    valor !== ""
  );

}

function soma(lista, campo) {

  return lista.reduce((acc, item) =>
    acc + numero(item[campo]),
    0
  );

}

function media(lista) {

  const valores =
  lista
    .map((valor) => numero(valor))
    .filter((valor) => !isNaN(valor));

  if (!valores.length) {
    return 0;
  }

  return valores.reduce((acc, valor) =>
    acc + valor,
    0
  ) / valores.length;

}

/* =========================================
   FUNÇÕES DE APOIO - OBRA
========================================= */

function obterNomeObra(obra) {

  return (
    obra.nomeProjeto ||
    obra.nomeObra ||
    obra.obraNome ||
    obra.obra ||
    obra.projeto ||
    obra.nome ||
    "Sem nome"
  );

}

function obterCentroCustoObra(obra) {

  return (
    obra.centroCusto ||
    obra.centroDeCusto ||
    obra.centroCustoApropriacao ||
    obra.centroCustoReal ||
    ""
  );

}

function calcularStatusObraConsolidado(
  obra,
  fisicoReal,
  financeiroReal
) {

  const statusOriginal =
  obra.status ||
  obra.statusNovo ||
  obra.fase ||
  "";

  const statusNormalizado =
  normalizarTexto(
    statusOriginal
  );

  const fisico =
  numero(
    fisicoReal
  );

  const financeiro =
  numero(
    financeiroReal
  );

  if (fisico >= 100) {
    return "Concluído";
  }

  if (
    statusNormalizado.includes("concluid")
  ) {
    return "Concluído";
  }

  if (
    statusNormalizado.includes("paralisad")
  ) {
    return "Paralisado";
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
    return "Paralisado";
  }

  if (
    statusNormalizado.includes("andamento") ||
    statusNormalizado.includes("execucao") ||
    statusNormalizado.includes("execução")
  ) {
    return "Em andamento";
  }

  return "Planejado";

}

function calcularSaudeObra(
  afo,
  ipf,
  totalAnomalias,
  criticas,
  vencidas
) {

  let nota = 100;

  if (afo > 0 && afo < 95) {

    nota -=
    (95 - afo) * 0.8;

  }

  if (ipf > 105) {

    nota -=
    (ipf - 105) * 0.5;

  }

  nota -=
  totalAnomalias * 2;

  nota -=
  criticas * 5;

  nota -=
  vencidas * 6;

  return Math.max(
    0,
    Math.min(100, nota)
  );

}

/* =========================================
   FUNÇÕES DE APOIO - ANOMALIA
========================================= */

function ehCritica(valor) {

  const texto =
  normalizarTexto(valor);

  return (
    texto.includes("critica") ||
    texto.includes("alta") ||
    texto.includes("grave")
  );

}

function ehAberta(valor) {

  const texto =
  normalizarTexto(valor);

  return (
    texto.includes("aberta") ||
    texto === "" ||
    texto.includes("pendente")
  );

}

function ehResolvida(valor) {

  const texto =
  normalizarTexto(valor);

  return (
    texto.includes("resolvida") ||
    texto.includes("concluida") ||
    texto.includes("concluido") ||
    texto.includes("finalizada") ||
    texto.includes("encerrada")
  );

}

function statusAnomaliaIgual(
  valorAtual,
  valorComparado
) {

  const atual =
  normalizarTexto(valorAtual);

  const comparado =
  normalizarTexto(valorComparado);

  if (comparado.includes("tratativa")) {
    return atual.includes("tratativa") || atual.includes("tratamento");
  }

  if (comparado.includes("resolvida")) {
    return ehResolvida(atual);
  }

  if (comparado.includes("aberta")) {
    return ehAberta(atual);
  }

  return atual === comparado;

}

function obterStatusPrazoAnomalia(anomalia) {

  const prazo =
  normalizarData(
    anomalia.prazoTratativa
  );

  if (!prazo) {
    return "semPrazo";
  }

  if (ehResolvida(anomalia.status)) {
    return "noPrazo";
  }

  const hoje =
  new Date();

  hoje.setHours(
    0,
    0,
    0,
    0
  );

  const prazoLimpo =
  new Date(prazo);

  prazoLimpo.setHours(
    0,
    0,
    0,
    0
  );

  const diffMs =
  prazoLimpo - hoje;

  const diffDias =
  Math.ceil(
    diffMs / 86400000
  );

  if (diffDias < 0) {
    return "vencidas";
  }

  if (diffDias <= 7) {
    return "vence7dias";
  }

  return "noPrazo";

}

function formatarPrazo(valor) {

  const data =
  normalizarData(valor);

  if (!data) {
    return "-";
  }

  return data.toLocaleDateString(
    "pt-BR"
  );

}

function criarChaveRenderizacaoAnomalia(
  anomalia,
  index
) {

  return [
    anomalia.origem,
    anomalia.docId,
    anomalia.obraId,
    anomalia.semana,
    index
  ].join("_");

}

/* =========================================
   FUNÇÕES DE APOIO - PERÍODO
========================================= */

function atualizarResumoPeriodo() {

  const inicio =
  getValor("filtroInicio");

  const fim =
  getValor("filtroFim");

  const elemento =
  document.getElementById("periodoAplicadoResumo");

  if (!elemento) {
    return;
  }

  if (!inicio && !fim) {

    elemento.textContent =
    "Todos os indicadores abaixo consideram todo o histórico disponível.";

    return;

  }

  const inicioTexto =
  inicio
  ? formatarDataTabela(inicio)
  : "início do histórico";

  const fimTexto =
  fim
  ? formatarDataTabela(fim)
  : "data atual";

  elemento.textContent =
  `Indicadores filtrados pelo período de ${inicioTexto} até ${fimTexto}.`;

}

function obterLabelPeriodo(item) {

  return (
    item.semana ||
    item.periodo ||
    item.mes ||
    formatarDataCurta(
      normalizarData(
        item.data ||
        item.dataAtualizacao ||
        item.atualizadoEm ||
        item.criadoEm
      )
    ) ||
    "Sem período"
  );

}

function ordenarItensPorLabel(lista) {

  return [...lista].sort((a, b) =>
    compararLabels(
      obterLabelPeriodo(a),
      obterLabelPeriodo(b)
    )
  );

}

function ordenarLabels(labels) {

  return [...labels].sort(
    compararLabels
  );

}

function compararLabels(a, b) {

  const valorA =
  extrairOrdemLabel(a);

  const valorB =
  extrairOrdemLabel(b);

  if (valorA !== valorB) {

    return valorA - valorB;

  }

  return String(a).localeCompare(
    String(b),
    "pt-BR"
  );

}

function extrairOrdemLabel(label) {

  const texto =
  String(label || "");

  const data =
  normalizarData(texto);

  if (data) {
    return data.getTime();
  }

  const numeroSemana =
  texto.match(/\d+/);

  if (numeroSemana) {
    return Number(numeroSemana[0]);
  }

  return 999999;

}

/* =========================================
   FUNÇÕES DE APOIO - DATA
========================================= */

function normalizarData(valor) {

  if (!valor) {
    return null;
  }

  if (valor?.toDate) {
    return valor.toDate();
  }

  if (valor?.seconds) {
    return new Date(valor.seconds * 1000);
  }

  if (valor instanceof Date) {

    return isNaN(valor.getTime())
    ? null
    : valor;

  }

  const texto =
  String(valor).trim();

  if (!texto) {
    return null;
  }

  if (texto.includes(" a ")) {

    const primeiraData =
    texto.split(" a ")[0].trim();

    return normalizarData(
      primeiraData
    );

  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(texto)) {

    const data =
    new Date(`${texto}T00:00:00`);

    return isNaN(data.getTime())
    ? null
    : data;

  }

  if (/^\d{2}\/\d{2}\/\d{4}/.test(texto)) {

    const partes =
    texto
      .split(" ")[0]
      .split("/");

    const data =
    new Date(
      `${partes[2]}-${partes[1]}-${partes[0]}T00:00:00`
    );

    return isNaN(data.getTime())
    ? null
    : data;

  }

  const data =
  new Date(texto);

  return isNaN(data.getTime())
  ? null
  : data;

}

function formatarDataTabela(valor) {

  const data =
  normalizarData(valor);

  if (!data) {
    return "-";
  }

  return data.toLocaleDateString(
    "pt-BR"
  );

}

function formatarDataCurta(data) {

  if (!data) {
    return "";
  }

  return data.toLocaleDateString(
    "pt-BR"
  );

}

/* =========================================
   AGRUPAMENTOS
========================================= */

function agruparContagem(lista, campo) {

  return lista.reduce((acc, item) => {

    const chave =
    item[campo] ||
    "Não informado";

    acc[chave] =
    (acc[chave] || 0) + 1;

    return acc;

  }, {});

}

function agruparSoma(lista, campoGrupo, campoValor) {

  return lista.reduce((acc, item) => {

    const chave =
    item[campoGrupo] ||
    "Não informado";

    acc[chave] =
    (acc[chave] || 0) +
    numero(item[campoValor]);

    return acc;

  }, {});

}

/* =========================================
   CLASSES E STATUS
========================================= */

function classeStatus(status) {

  const texto =
  normalizarTexto(status);

  if (texto.includes("planejado")) {
    return "status-planejado";
  }

  if (
    texto.includes("andamento") ||
    texto.includes("execucao") ||
    texto.includes("execução")
  ) {
    return "status-andamento";
  }

  if (
    texto.includes("concluido") ||
    texto.includes("concluida")
  ) {
    return "status-concluido";
  }

  if (
    texto.includes("paralisado") ||
    texto.includes("paralisada")
  ) {
    return "status-paralisado";
  }

  return "status-planejado";

}

function classeStatusAnomalia(status) {

  const texto =
  normalizarTexto(status);

  if (texto.includes("resolvida")) {
    return "anomalia-resolvida";
  }

  if (
    texto.includes("tratativa") ||
    texto.includes("tratamento")
  ) {
    return "anomalia-tratativa";
  }

  return "anomalia-aberta";

}

function statusEquivalente(valorAtual, valorFiltro) {

  const atual =
  normalizarTexto(valorAtual);

  const filtro =
  normalizarTexto(valorFiltro);

  if (!filtro) {
    return true;
  }

  if (filtro.includes("planejado")) {
    return atual.includes("planejado");
  }

  if (
    filtro.includes("andamento") ||
    filtro.includes("execucao") ||
    filtro.includes("execução")
  ) {
    return atual.includes("andamento") ||
    atual.includes("execucao") ||
    atual.includes("execução");
  }

  if (
    filtro.includes("concluido") ||
    filtro.includes("concluida")
  ) {
    return atual.includes("concluid");
  }

  if (
    filtro.includes("paralisado") ||
    filtro.includes("paralisada")
  ) {
    return atual.includes("paralisad");
  }

  return atual === filtro;

}

function aplicarCorIndicador(
  id,
  valor,
  condicaoNegativa
) {

  const elemento =
  document.getElementById(id);

  if (!elemento) {
    return;
  }

  elemento.classList.remove(
    "td-negativo",
    "td-positivo"
  );

  if (condicaoNegativa) {

    elemento.classList.add(
      "td-negativo"
    );

    return;

  }

  if (numero(valor) > 0) {

    elemento.classList.add(
      "td-positivo"
    );

  }

}

/* =========================================
   ADMIN
========================================= */

function usuarioEhAdministrador(usuario) {

  const perfil =
  normalizarTexto(
    usuario?.perfil ||
    usuario?.tipoUsuario ||
    usuario?.nivelAcesso ||
    usuario?.role ||
    usuario?.acesso ||
    ""
  );

  return (
    perfil === "administrador" ||
    perfil === "admin" ||
    perfil === "administrator" ||
    usuario?.admin === true ||
    usuario?.isAdmin === true
  );

}

/* =========================================
   TEXTO E DOM
========================================= */

function setTexto(id, valor) {

  const elemento =
  document.getElementById(id);

  if (!elemento) {
    return;
  }

  elemento.textContent =
  valor;

}

function getValor(id) {

  const elemento =
  document.getElementById(id);

  return elemento
  ? elemento.value
  : "";

}

function setValor(id, valor) {

  const elemento =
  document.getElementById(id);

  if (elemento) {
    elemento.value = valor;
  }

}

function valorTexto(valor) {

  if (
    valor === null ||
    valor === undefined
  ) {
    return "";
  }

  return String(valor).trim();

}

function textoSeguro(valor) {

  return String(valor ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");

}

function normalizarTexto(valor) {

  return String(valor || "")
    .toLowerCase()
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

}