import { db } from "./firebaseConfig.js";
import { protegerPagina } from "./authGuard.js";

import {
  collection,
  getDocs,
  doc,
  updateDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.3/firebase-firestore.js";

let usuarioLogadoGlobal = null;

let obras = [];
let planejamentos = [];
let realizados = [];
let atualizacoes = [];
let anomalias = [];

let chartFisico = null;
let chartFinanceiro = null;
let chartRegional = null;
let chartCentroCusto = null;
let chartStatus = null;

let anomaliasRenderizadas = new Map();

const ChartJS = window.Chart;

if (ChartJS && window.ChartDataLabels) {
  ChartJS.register(window.ChartDataLabels);
}

const moeda = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL"
});

const percentual = (valor) =>
  `${Number(valor || 0).toFixed(1).replace(".", ",")}%`;

/* =========================================
   INICIALIZAÇÃO
========================================= */

document.addEventListener("DOMContentLoaded", async () => {
  try {
    usuarioLogadoGlobal = await protegerPagina();

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
    console.error("Erro ao iniciar indicadores estratégicos:", erro);
    alert("Erro ao iniciar a tela de indicadores.");
  }
});

/* =========================================
   EVENTOS
========================================= */

function configurarEventos() {
  [
    "filtroInicio",
    "filtroFim",
    "filtroRegional",
    "filtroCentroCusto",
    "filtroLocalidade",
    "filtroStatus",
    "filtroObra"
  ].forEach((id) => {
    const elemento = document.getElementById(id);

    if (!elemento) {
      return;
    }

    elemento.addEventListener("change", () => {
      if (id === "filtroRegional" || id === "filtroCentroCusto") {
        atualizarFiltrosDependentes("principal");
      }

      if (id === "filtroLocalidade") {
        atualizarFiltrosDependentes("localidade");
      }

      atualizarDashboard();
    });
  });

  document.getElementById("btnLimparFiltros")?.addEventListener("click", () => {
    document
      .querySelectorAll(".filters input, .filters select")
      .forEach((elemento) => {
        elemento.value = "";
      });

    preencherFiltrosIniciais();
    atualizarDashboard();
    limparTabelaAnomaliasSelecionada();
  });

  document.getElementById("btnExportar")?.addEventListener("click", () => {
    window.print();
  });
}

/* =========================================
   MODAL STATUS ANOMALIA
========================================= */

function configurarModalStatusAnomalia() {
  const modal = document.getElementById("modalStatusAnomalia");

  document
    .getElementById("btnFecharModalStatus")
    ?.addEventListener("click", fecharModalStatusAnomalia);

  document
    .getElementById("btnCancelarStatusAnomalia")
    ?.addEventListener("click", fecharModalStatusAnomalia);

  document
    .getElementById("btnSalvarStatusAnomalia")
    ?.addEventListener("click", salvarStatusAnomalia);

  modal?.addEventListener("click", (event) => {
    if (event.target === modal) {
      fecharModalStatusAnomalia();
    }
  });
}

function abrirModalStatusAnomalia(anomalia, novoStatus) {
  if (!usuarioEhAdministrador(usuarioLogadoGlobal)) {
    alert("Apenas administradores podem alterar o status da anomalia.");
    return;
  }

  if (!anomalia?.docId || !anomalia?.origem) {
    alert("Não foi possível identificar o registro da anomalia no banco de dados.");
    return;
  }

  setValor("modalAnomaliaDocId", anomalia.docId);
  setValor("modalAnomaliaOrigem", anomalia.origem);
  setValor("modalAnomaliaObraId", anomalia.obraId || "");
  setValor("modalAnomaliaSemana", anomalia.semana || "");
  setValor("modalObraAnomalia", anomalia.obraNome || "-");
  setValor("modalTipoAnomalia", anomalia.tipo || "-");
  setValor("modalStatusAtualAnomalia", anomalia.status || "-");
  setValor("modalNovoStatusAnomalia", novoStatus || anomalia.status || "");
  setValor("modalObservacaoStatusAnomalia", "");

  const modal = document.getElementById("modalStatusAnomalia");

  if (modal) {
    modal.classList.add("ativo");
    modal.setAttribute("aria-hidden", "false");
  }
}

function fecharModalStatusAnomalia() {
  const modal = document.getElementById("modalStatusAnomalia");

  if (modal) {
    modal.classList.remove("ativo");
    modal.setAttribute("aria-hidden", "true");
  }
}

async function salvarStatusAnomalia() {
  if (!usuarioEhAdministrador(usuarioLogadoGlobal)) {
    alert("Apenas administradores podem alterar o status da anomalia.");
    return;
  }

  const docId = getValor("modalAnomaliaDocId");
  const origem = getValor("modalAnomaliaOrigem");
  const novoStatus = getValor("modalNovoStatusAnomalia");
  const observacao = getValor("modalObservacaoStatusAnomalia");

  if (!docId || !origem) {
    alert("Registro da anomalia não identificado.");
    return;
  }

  if (!novoStatus) {
    alert("Selecione o novo status da anomalia.");
    return;
  }

  const anomaliaAtual = [...anomaliasRenderizadas.values()].find((item) =>
    item.docId === docId && item.origem === origem
  );

  try {
    const textoConsolidado = montarTextoConsolidadoAnomalia({
      ...(anomaliaAtual || {}),
      status: novoStatus
    });

    await updateDoc(doc(db, origem, docId), {
      statusAnomalia: novoStatus,
      statusTratativa: novoStatus,
      "anomalia.status": novoStatus,
      anomalias: textoConsolidado,
      observacaoStatusAnomalia: observacao || "",
      statusAnomaliaAtualizadoPorUid: usuarioLogadoGlobal?.uid || "",
      statusAnomaliaAtualizadoPorEmail:
        usuarioLogadoGlobal?.email || usuarioLogadoGlobal?.emailAuth || "",
      statusAnomaliaAtualizadoPorNome:
        usuarioLogadoGlobal?.nome || usuarioLogadoGlobal?.displayName || "",
      statusAnomaliaAtualizadoEm: serverTimestamp(),
      atualizadoEm: serverTimestamp()
    });

    alert("Status da anomalia atualizado com sucesso!");

    fecharModalStatusAnomalia();

    await carregarDados();

    preencherFiltrosIniciais();
    atualizarDashboard();
  } catch (erro) {
    console.error("Erro ao atualizar status da anomalia:", erro);
    alert("Erro ao atualizar o status da anomalia. Verifique suas permissões no Firestore.");
  }
}

/* =========================================
   CARREGAMENTO FIREBASE
========================================= */

async function carregarDados() {
  try {
    const obrasBanco = await buscarColecao("obras");
    const projetosBanco = await buscarColecao("projetos");

    obras = obrasBanco.length > 0 ? obrasBanco : projetosBanco;

    const planejamentosBanco = await buscarColecao("planejamentoCurvaS");
    planejamentos = planejamentosBanco.filter((item) => item.ativo !== false);

    const realizadosBanco = await buscarColecao("realizadoCurvaS");
    atualizacoes = await buscarColecao("projetos_atualizados");

    const anomaliasColecao = await buscarColecao("anomalias");

    realizados = [
      ...realizadosBanco,
      ...converterAtualizacoesParaRealizado(atualizacoes)
    ];

    anomalias = removerAnomaliasDuplicadas([
      ...extrairAnomaliasDeLista(anomaliasColecao, "anomalias"),
      ...extrairAnomaliasDeLista(realizadosBanco, "realizadoCurvaS"),
      ...extrairAnomaliasDeLista(atualizacoes, "projetos_atualizados")
    ]);

    console.log("Obras carregadas:", obras);
    console.log("Planejamentos ativos carregados:", planejamentos);
    console.log("Realizados carregados:", realizados);
    console.log("Anomalias carregadas:", anomalias);
  } catch (erro) {
    console.error("Erro ao carregar dados:", erro);
    alert("Erro ao carregar os indicadores. Verifique o console do navegador.");
  }
}

async function buscarColecao(nomeColecao) {
  try {
    const snap = await getDocs(collection(db, nomeColecao));

    return snap.docs.map((documento) => ({
      docId: documento.id,
      id: documento.id,
      ...documento.data()
    }));
  } catch (erro) {
    console.warn(`Não foi possível carregar a coleção: ${nomeColecao}`, erro);
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

    fisicoReal: numero(
      item.fisicoReal ||
      item.avancoFisicoNovo ||
      item.avancoFisico ||
      0
    ),

    fisicoRealAcum: numero(
      item.fisicoRealAcum ||
      item.fisicoAcum ||
      item.avancoFisicoAcumulado ||
      item.avancoFisicoNovo ||
      item.avancoFisico ||
      0
    ),

    financeiroReal: numero(
      item.financeiroReal ||
      item.investimentoNovo ||
      item.custoSemana ||
      item.custo ||
      0
    ),

    financeiroRealAcum: numero(
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

/* =========================================
   ANOMALIAS
========================================= */

function extrairAnomaliasDeLista(lista, origem) {
  return lista
    .map((item) => normalizarAnomalia(item, origem))
    .filter((item) => item.houveAnomalia);
}

function normalizarAnomalia(item, origem = "") {
  const mapa =
    typeof item.anomalia === "object" && item.anomalia !== null
      ? item.anomalia
      : {};

  const tipo = valorTexto(
    item.tipoAnomalia ||
    mapa.tipo ||
    item.categoriaAnomalia ||
    item.categoria ||
    item.tipo ||
    ""
  );

  const criticidade = valorTexto(
    item.criticidadeAnomalia ||
    mapa.criticidade ||
    item.criticidade ||
    item.severidade ||
    item.gravidadeAnomalia ||
    item.gravidade ||
    ""
  );

  const impacto = valorTexto(
    item.impactoAnomalia ||
    mapa.impacto ||
    item.impactoPrincipal ||
    item.impactoTexto ||
    ""
  );

  const status = obterStatusAnomalia(item, mapa);

  const prazoTratativa =
    item.prazoTratativaAnomalia ||
    mapa.prazoTratativa ||
    item.prazoTratativa ||
    item.prazo ||
    "";

  const responsavel = valorTexto(
    item.responsavelAnomalia ||
    mapa.responsavel ||
    item.responsavel ||
    item.responsavelTratativa ||
    ""
  );

  const descricao = valorTexto(
    item.descricaoAnomalia ||
    mapa.descricao ||
    item.descricao ||
    item.observacaoAnomalia ||
    item.anomalias ||
    ""
  );

  const acaoCorretiva = valorTexto(
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

  return {
    docId: item.docId || item.id || "",
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

    regional: item.regional || "",
    localidade: item.localidade || "",
    centroCusto:
      item.centroCusto ||
      item.centroCustoApropriacao ||
      item.centroDeCusto ||
      "",

    semana: item.semana || "",
    periodo: item.periodo || "",

    data:
      item.data ||
      item.dataAtualizacao ||
      item.atualizadoEm ||
      item.criadoEm ||
      item.periodo ||
      "",

    houveAnomalia,
    tipo: tipo || "Não classificada",
    categoria: tipo || "Não classificada",
    criticidade: criticidade || "Média",
    severidade: criticidade || "Média",
    impacto: impacto || "Não informado",
    status,
    prazoTratativa,
    responsavel,
    descricao: descricao || "Sem descrição",
    acaoCorretiva,

    impactoFinanceiro: numero(
      item.impactoFinanceiro ||
      item.custoImpacto ||
      item.valorImpacto ||
      item.impactoFinanceiroAnomalia ||
      0
    ),

    impactoPrazo: numero(
      item.impactoPrazo ||
      item.diasImpacto ||
      item.diasAtraso ||
      item.impactoPrazoDias ||
      0
    ),

    textoConsolidado: item.anomalias || ""
  };
}

function obterStatusAnomalia(item, mapa = {}) {
  const statusEstruturado = valorTexto(
    item.statusAnomalia ||
    mapa.status ||
    item.statusTratativa ||
    item.statusProblema ||
    ""
  );

  if (statusEstruturado) {
    return statusEstruturado;
  }

  const statusGenerico = valorTexto(item.status || "");
  const statusNormalizado = normalizarTexto(statusGenerico);

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
      mapa.set(chave, item);
    }
  });

  return Array.from(mapa.values());
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
    obras.map((obra) => obterCentroCustoObra(obra)),
    "Todos"
  );

  preencherSelect(
    "filtroLocalidade",
    obras.map((obra) => obra.localidade),
    "Todas"
  );

  preencherSelect(
    "filtroObra",
    obras.map((obra) => obterNomeObra(obra)),
    "Todas"
  );
}

function atualizarFiltrosDependentes(origem) {
  const regionalSelecionada = getValor("filtroRegional");
  const centroSelecionado = getValor("filtroCentroCusto");
  const localidadeSelecionada = getValor("filtroLocalidade");
  const obraSelecionada = getValor("filtroObra");

  let obrasBase = [...obras];

  if (regionalSelecionada) {
    obrasBase = obrasBase.filter((obra) => obra.regional === regionalSelecionada);
  }

  if (centroSelecionado) {
    obrasBase = obrasBase.filter((obra) =>
      obterCentroCustoObra(obra) === centroSelecionado
    );
  }

  if (origem === "principal") {
    const localidadesPermitidas = [...new Set(
      obrasBase
        .map((obra) => obra.localidade)
        .filter(Boolean)
        .map((valor) => String(valor).trim())
    )].sort((a, b) => a.localeCompare(b, "pt-BR"));

    preencherSelect("filtroLocalidade", localidadesPermitidas, "Todas");

    if (
      localidadeSelecionada &&
      !localidadesPermitidas.includes(localidadeSelecionada)
    ) {
      setValor("filtroLocalidade", "");
    }
  }

  const localidadeAtual = getValor("filtroLocalidade");

  if (localidadeAtual) {
    obrasBase = obrasBase.filter((obra) => obra.localidade === localidadeAtual);
  }

  const obrasPermitidas = [...new Set(
    obrasBase
      .map((obra) => obterNomeObra(obra))
      .filter(Boolean)
      .map((valor) => String(valor).trim())
  )].sort((a, b) => a.localeCompare(b, "pt-BR"));

  preencherSelect("filtroObra", obrasPermitidas, "Todas");

  if (obraSelecionada && !obrasPermitidas.includes(obraSelecionada)) {
    setValor("filtroObra", "");
  }
}

function preencherSelect(id, valores, textoInicial) {
  const select = document.getElementById(id);

  if (!select) {
    return;
  }

  const valorAtual = select.value;

  select.innerHTML = "";

  const optionInicial = document.createElement("option");
  optionInicial.value = "";
  optionInicial.textContent = textoInicial;
  select.appendChild(optionInicial);

  const valoresUnicos = [...new Set(
    valores
      .filter(Boolean)
      .map((valor) => String(valor).trim())
      .filter((valor) => valor !== "")
  )].sort((a, b) => a.localeCompare(b, "pt-BR"));

  valoresUnicos.forEach((valor) => {
    const option = document.createElement("option");
    option.value = valor;
    option.textContent = valor;
    select.appendChild(option);
  });

  if (valoresUnicos.includes(valorAtual)) {
    select.value = valorAtual;
  }
}

/* =========================================
   DASHBOARD
========================================= */

function atualizarDashboard() {
  atualizarResumoPeriodo();

  const obrasFiltradasSemStatus = obterObrasFiltradasSemStatus();

  const planejamentosFiltrados = filtrarListaPorObrasEPeriodo(
    planejamentos,
    obrasFiltradasSemStatus
  );

  const realizadosFiltrados = filtrarListaPorObrasEPeriodo(
    realizados,
    obrasFiltradasSemStatus
  );

  const anomaliasFiltradas = filtrarListaPorObrasEPeriodo(
    anomalias,
    obrasFiltradasSemStatus
  );

  const resumoSemStatus = montarResumoObras(
    obrasFiltradasSemStatus,
    planejamentosFiltrados,
    realizadosFiltrados,
    anomaliasFiltradas
  );

  const resumo = aplicarFiltroStatusResumo(resumoSemStatus);

  atualizarKPIs(resumo);
  atualizarGraficosConsolidados(resumo);
  atualizarGraficosDistribuicao(resumo);
  atualizarRanking(resumo);
  limparTabelaAnomaliasSelecionada();
}

function obterObrasFiltradasSemStatus() {
  const inicio = getValor("filtroInicio");
  const fim = getValor("filtroFim");
  const regional = getValor("filtroRegional");
  const centroCusto = getValor("filtroCentroCusto");
  const localidade = getValor("filtroLocalidade");
  const obraSelecionada = getValor("filtroObra");

  return obras.filter((obra) => {
    const nome = obterNomeObra(obra);
    const centro = obterCentroCustoObra(obra);

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

    return obraTemMovimentoNoPeriodo(obra, inicio, fim);
  });
}

function obraTemMovimentoNoPeriodo(obra, filtroInicio, filtroFim) {
  const intervaloObra = obterIntervaloObra(obra);

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

  if (
    planejamentos.some((item) =>
      item.ativo !== false &&
      pertenceAObra(item, obra) &&
      itemRespeitaPeriodo(item, filtroInicio, filtroFim)
    )
  ) {
    return true;
  }

  if (
    realizados.some((item) =>
      pertenceAObra(item, obra) &&
      itemRespeitaPeriodo(item, filtroInicio, filtroFim)
    )
  ) {
    return true;
  }

  return anomalias.some((item) =>
    pertenceAObra(item, obra) &&
    itemRespeitaPeriodo(item, filtroInicio, filtroFim)
  );
}

function aplicarFiltroStatusResumo(resumo) {
  const statusFiltro = getValor("filtroStatus");

  if (!statusFiltro) {
    return resumo;
  }

  return resumo.filter((obra) => statusEquivalente(obra.status, statusFiltro));
}

function filtrarListaPorObrasEPeriodo(lista, obrasFiltradas) {
  const inicio = getValor("filtroInicio");
  const fim = getValor("filtroFim");

  return lista.filter((item) => {
    if (item.ativo === false) {
      return false;
    }

    const pertence = obrasFiltradas.some((obra) => pertenceAObra(item, obra));

    if (!pertence) {
      return false;
    }

    return itemRespeitaPeriodo(item, inicio, fim);
  });
}

function itemRespeitaPeriodo(item, filtroInicio, filtroFim) {
  if (!filtroInicio && !filtroFim) {
    return true;
  }

  const intervalo = obterIntervaloItem(item);

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

/* =========================================
   RESUMO DAS OBRAS
========================================= */

function montarResumoObras(obrasLista, planLista, realLista, anomLista) {
  return obrasLista.map((obra) => {
    const nome = obterNomeObra(obra);

    const plan = planLista.filter((item) =>
      item.ativo !== false && pertenceAObra(item, obra)
    );

    const real = realLista.filter((item) => pertenceAObra(item, obra));
    const anom = anomLista.filter((item) => pertenceAObra(item, obra));

    const fisicoPlanejado = obterValorAcumulado(
      plan,
      [
        "fisicoAcum",
        "fisicoPlanejadoAcum",
        "fisicoPlanejadoAcumulado",
        "fisicoAcumulado"
      ],
      [
        "fisico",
        "fisicoPlanejado",
        "percentualFisico"
      ],
      100
    );

    const fisicoReal = obterValorAcumulado(
      real,
      [
        "fisicoRealAcum",
        "fisicoAcum",
        "fisicoRealizadoAcum",
        "avancoFisicoAcumulado"
      ],
      [
        "fisicoReal",
        "avancoFisicoNovo",
        "avancoFisico"
      ],
      100
    );

    const financeiroPlanejado = obterValorAcumulado(
      plan,
      [
        "financeiroAcum",
        "financeiroPlanejadoAcum",
        "financeiroPlanejadoAcumulado",
        "financeiroAcumulado"
      ],
      [
        "financeiro",
        "financeiroPlanejado",
        "valorPlanejado"
      ],
      null
    );

    const financeiroReal = obterValorAcumulado(
      real,
      [
        "financeiroRealAcum",
        "financeiroAcum",
        "financeiroRealAcumulado",
        "financeiroAcumulado"
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

    const valorTotalObra = obterValorOrcadoObra(obra);

    const valorOrcado = financeiroPlanejado || valorTotalObra;

    const afo = fisicoPlanejado > 0
      ? limitarPercentual((fisicoReal / fisicoPlanejado) * 100)
      : 0;

    const ipf = valorOrcado > 0
      ? limitarPercentual((financeiroReal / valorOrcado) * 100)
      : 0;

    const anomCriticas = anom.filter((item) => ehCritica(item.criticidade)).length;
    const anomAbertas = anom.filter((item) => ehAberta(item.status)).length;
    const anomVencidas = anom.filter((item) =>
      obterStatusPrazoAnomalia(item) === "vencidas"
    ).length;

    const gutScore = obterGutScoreObra(obra);
    const fatorGut = obterFatorGUT(gutScore);
    const pesoPonderado = obterPesoPonderadoObra(obra, valorOrcado);

    const statusCalculado = calcularStatusObraConsolidado(
      obra,
      fisicoReal,
      financeiroReal
    );

    const saude = calcularSaudeObra(
      afo,
      ipf,
      anom.length,
      anomCriticas,
      anomVencidas,
      gutScore
    );

    return {
      id: obra.docId || obra.id || obra.idProjeto || obra.idObra || nome,
      nome,
      regional: obra.regional || "-",
      localidade: obra.localidade || "-",
      centroCusto: obterCentroCustoObra(obra) || "-",
      status: statusCalculado,
      valorOrcado,
      financeiroPlanejado,
      financeiroReal,
      saldo: valorOrcado - financeiroReal,
      fisicoPlanejado,
      fisicoReal,
      afo,
      ipf,
      gutScore,
      fatorGut,
      pesoPonderado,
      anomalias: anom.length,
      anomAbertas,
      anomCriticas,
      anomVencidas,
      saude,
      plan,
      real,
      anomaliasLista: anom,
      obraOriginal: obra
    };
  });
}

function obterValorAcumulado(lista, camposAcumulados, camposSemanais, limitePercentual) {
  const ordenados = ordenarItensPorPeriodo(lista);

  let ultimoAcumulado = null;
  let somaSemanal = 0;

  ordenados.forEach((item) => {
    const acumulado = primeiroNumeroValido(item, camposAcumulados);

    if (acumulado !== null) {
      ultimoAcumulado = acumulado;
      return;
    }

    const semanal = primeiroNumeroValido(item, camposSemanais);

    if (semanal !== null) {
      somaSemanal += semanal;
      ultimoAcumulado = somaSemanal;
    }
  });

  const valor = ultimoAcumulado ?? somaSemanal;

  if (limitePercentual) {
    return limitarPercentual(valor);
  }

  return numero(valor);
}

/* =========================================
   KPIS
========================================= */

function atualizarKPIs(resumo) {
  const totalObras = resumo.length;
  const orcado = soma(resumo, "valorOrcado");
  const executado = soma(resumo, "financeiroReal");
  const saldo = orcado - executado;

  const afoMedio = mediaPonderada(
    resumo.map((item) => ({
      valor: item.afo,
      peso: item.pesoPonderado
    }))
  );

  const saudeMedia = mediaPonderada(
    resumo.map((item) => ({
      valor: item.saude,
      peso: item.pesoPonderado
    }))
  );

  const obrasCriticas = resumo.filter((item) =>
    item.saude < 70 ||
    item.afo < 90 ||
    item.anomCriticas > 0 ||
    item.anomVencidas > 0
  ).length;

  const percExecutado = orcado > 0 ? (executado / orcado) * 100 : 0;
  const percSaldo = orcado > 0 ? (saldo / orcado) * 100 : 0;

  setTexto("kpiTotalObras", totalObras);
  setTexto("kpiOrcado", moeda.format(orcado));
  setTexto("kpiExecutado", moeda.format(executado));
  setTexto("kpiSaldo", moeda.format(saldo));
  setTexto("kpiAFO", percentual(afoMedio));
  setTexto("kpiSaude", percentual(saudeMedia));
  setTexto("kpiObrasCriticas", obrasCriticas);
  setTexto("kpiExecutadoPerc", `${percentual(percExecutado)} do orçado`);
  setTexto("kpiSaldoPerc", `${percentual(percSaldo)} do orçado`);
  setTexto("kpiAFOStatus", obterStatusAFO(afoMedio));
  setTexto("kpiSaudeStatus", obterStatusSaude(saudeMedia));
  setTexto("ipfFinanceiro", percentual(percExecutado));
  setTexto("afoFisico", percentual(afoMedio));

  aplicarCorIndicador("kpiAFO", afoMedio, afoMedio < 90);
  aplicarCorIndicador("kpiSaude", saudeMedia, saudeMedia < 70);
  aplicarCorIndicador("ipfFinanceiro", percExecutado, percExecutado > 100);
  aplicarCorIndicador("afoFisico", afoMedio, afoMedio < 90);
}

function obterStatusAFO(valor) {
  if (!valor) {
    return "Sem dados";
  }

  if (valor >= 95) {
    return "Saudável";
  }

  if (valor >= 90) {
    return "Atenção";
  }

  return "Crítico";
}

function obterStatusSaude(valor) {
  if (!valor) {
    return "Sem dados";
  }

  if (valor >= 85) {
    return "Saudável";
  }

  if (valor >= 70) {
    return "Atenção";
  }

  return "Crítico";
}

/* =========================================
   CURVAS S PONDERADAS
========================================= */

function atualizarGraficosConsolidados(resumo) {
  const series = montarSeriesCurvaSPonderada(resumo);

  chartFisico = renderizarGraficoLinha(
    chartFisico,
    "chartFisico",
    series.labels,
    [
      {
        label: "Planejado físico ponderado",
        data: series.fisicoPlanejado
      },
      {
        label: "Realizado físico ponderado",
        data: series.fisicoReal
      }
    ],
    "%"
  );

  chartFinanceiro = renderizarGraficoLinha(
    chartFinanceiro,
    "chartFinanceiro",
    series.labels,
    [
      {
        label: "Planejado financeiro ponderado",
        data: series.financeiroPlanejado
      },
      {
        label: "Executado financeiro ponderado",
        data: series.financeiroReal
      }
    ],
    "%"
  );
}

function montarSeriesCurvaSPonderada(resumo) {
  const pontos = obterPontosCurvaS(resumo);

  if (pontos.length === 0) {
    return {
      labels: ["Sem dados"],
      fisicoPlanejado: [0],
      fisicoReal: [0],
      financeiroPlanejado: [0],
      financeiroReal: [0]
    };
  }

  const labels = pontos.map((ponto) => ponto.label);
  const fisicoPlanejado = [];
  const fisicoReal = [];
  const financeiroPlanejado = [];
  const financeiroReal = [];

  pontos.forEach((ponto) => {
    let somaPesoFisPlan = 0;
    let somaPesoFisReal = 0;
    let somaPesoFinPlan = 0;
    let somaPesoFinReal = 0;

    let somaFisPlan = 0;
    let somaFisReal = 0;
    let somaFinPlan = 0;
    let somaFinReal = 0;

    resumo.forEach((obra) => {
      const peso = obra.pesoPonderado || 1;
      const valorBase = obra.valorOrcado || obterValorOrcadoObra(obra.obraOriginal) || 0;

      const fisPlan = obterAcumuladoAtePonto(
        obra.plan,
        ponto,
        [
          "fisicoAcum",
          "fisicoPlanejadoAcum",
          "fisicoPlanejadoAcumulado",
          "fisicoAcumulado"
        ],
        [
          "fisico",
          "fisicoPlanejado",
          "percentualFisico"
        ],
        100
      );

      const fisReal = obterAcumuladoAtePonto(
        obra.real,
        ponto,
        [
          "fisicoRealAcum",
          "fisicoAcum",
          "fisicoRealizadoAcum",
          "avancoFisicoAcumulado"
        ],
        [
          "fisicoReal",
          "avancoFisicoNovo",
          "avancoFisico"
        ],
        100
      );

      const finPlanValor = obterAcumuladoAtePonto(
        obra.plan,
        ponto,
        [
          "financeiroAcum",
          "financeiroPlanejadoAcum",
          "financeiroPlanejadoAcumulado",
          "financeiroAcumulado"
        ],
        [
          "financeiro",
          "financeiroPlanejado",
          "valorPlanejado"
        ],
        null
      );

      const finRealValor = obterAcumuladoAtePonto(
        obra.real,
        ponto,
        [
          "financeiroRealAcum",
          "financeiroAcum",
          "financeiroRealAcumulado",
          "financeiroAcumulado"
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

      const finPlanPerc = valorBase > 0
        ? limitarPercentual((finPlanValor / valorBase) * 100)
        : 0;

      const finRealPerc = valorBase > 0
        ? limitarPercentual((finRealValor / valorBase) * 100)
        : 0;

      if (fisPlan > 0) {
        somaFisPlan += fisPlan * peso;
        somaPesoFisPlan += peso;
      }

      if (fisReal > 0) {
        somaFisReal += fisReal * peso;
        somaPesoFisReal += peso;
      }

      if (finPlanPerc > 0) {
        somaFinPlan += finPlanPerc * peso;
        somaPesoFinPlan += peso;
      }

      if (finRealPerc > 0) {
        somaFinReal += finRealPerc * peso;
        somaPesoFinReal += peso;
      }
    });

    fisicoPlanejado.push(arredondar1(somaPesoFisPlan > 0 ? somaFisPlan / somaPesoFisPlan : 0));
    fisicoReal.push(arredondar1(somaPesoFisReal > 0 ? somaFisReal / somaPesoFisReal : 0));
    financeiroPlanejado.push(arredondar1(somaPesoFinPlan > 0 ? somaFinPlan / somaPesoFinPlan : 0));
    financeiroReal.push(arredondar1(somaPesoFinReal > 0 ? somaFinReal / somaPesoFinReal : 0));
  });

  return {
    labels,
    fisicoPlanejado,
    fisicoReal,
    financeiroPlanejado,
    financeiroReal
  };
}

function obterPontosCurvaS(resumo) {
  const mapa = new Map();

  resumo.forEach((obra) => {
    [...obra.plan, ...obra.real].forEach((item) => {
      if (!item || item.ativo === false) {
        return;
      }

      const ordem = obterOrdemPeriodoItem(item);

      if (ordem === null || ordem === undefined || Number.isNaN(ordem)) {
        return;
      }

      const chave = String(ordem);

      if (!mapa.has(chave)) {
        mapa.set(chave, {
          ordem,
          labelOriginal: obterLabelPeriodoOriginal(item)
        });
      }
    });
  });

  return [...mapa.values()]
    .sort((a, b) => a.ordem - b.ordem)
    .map((ponto, index) => ({
      ...ponto,
      label: `SEM ${index + 1}`
    }));
}

function obterAcumuladoAtePonto(
  lista,
  ponto,
  camposAcumulados,
  camposSemanais,
  limitePercentual
) {
  const itensAtePonto = lista.filter((item) => {
    if (!item || item.ativo === false) {
      return false;
    }

    const ordemItem = obterOrdemPeriodoItem(item);

    if (ordemItem === null || ordemItem === undefined || Number.isNaN(ordemItem)) {
      return false;
    }

    return ordemItem <= ponto.ordem;
  });

  return obterValorAcumulado(
    itensAtePonto,
    camposAcumulados,
    camposSemanais,
    limitePercentual
  );
}

/* =========================================
   GRÁFICOS DE DISTRIBUIÇÃO
========================================= */

function atualizarGraficosDistribuicao(resumo) {
  const porRegional = agruparSoma(resumo, "regional", "valorOrcado");
  const porCentro = agruparSoma(resumo, "centroCusto", "valorOrcado");
  const porStatus = agruparContagem(resumo, "status");

  chartRegional = renderizarGraficoBarra(
    chartRegional,
    "chartRegional",
    Object.keys(porRegional),
    Object.values(porRegional),
    true
  );

  chartCentroCusto = renderizarGraficoBarra(
    chartCentroCusto,
    "chartCentroCusto",
    Object.keys(porCentro),
    Object.values(porCentro),
    true
  );

  chartStatus = renderizarGraficoPizza(
    chartStatus,
    "chartStatus",
    Object.keys(porStatus),
    Object.values(porStatus)
  );

  const saudaveis = resumo.filter((item) => item.afo >= 95).length;
  const atencao = resumo.filter((item) => item.afo >= 90 && item.afo < 95).length;
  const criticas = resumo.filter((item) => item.afo < 90).length;

  setTexto("semSaudaveis", saudaveis);
  setTexto("semAtencao", atencao);
  setTexto("semCriticas", criticas);
}

function renderizarGraficoLinha(instancia, canvasId, labels, datasets, sufixo = "") {
  const ctx = document.getElementById(canvasId);

  if (!ctx || !ChartJS) {
    return instancia;
  }

  if (instancia) {
    instancia.destroy();
  }

  return new ChartJS(ctx, {
    type: "line",
    data: {
      labels,
      datasets: datasets.map((dataset) => ({
        ...dataset,
        borderWidth: 3,
        tension: 0.35,
        fill: false,
        pointRadius: 2,
        pointHoverRadius: 5
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
          position: "top",
          labels: {
            boxWidth: 10,
            font: {
              size: 10,
              weight: "bold"
            }
          }
        },

        tooltip: {
          callbacks: {
            label: (context) =>
              `${context.dataset.label}: ${percentual(context.raw)}`
          }
        },

        datalabels: {
          display: (context) => {
            const total = context.dataset.data.length;
            const index = context.dataIndex;

            return (
              index === 0 ||
              index === total - 1 ||
              index % 4 === 0
            );
          },

          align: "top",
          anchor: "end",
          formatter: (valor) =>
            `${Number(valor || 0).toFixed(1).replace(".", ",")}${sufixo}`,

          font: {
            size: 8,
            weight: "bold"
          },

          clamp: true,
          clip: true
        }
      },

      scales: {
        y: {
          beginAtZero: true,
          suggestedMax: 100,
          max: 110,
          ticks: {
            font: {
              size: 10
            },
            callback: (valor) => `${valor}${sufixo}`
          }
        },

        x: {
          ticks: {
            autoSkip: true,
            maxTicksLimit: 12,
            maxRotation: 45,
            minRotation: 45,
            font: {
              size: 10
            }
          }
        }
      }
    }
  });
}

function renderizarGraficoBarra(instancia, canvasId, labels, valores, formatoMoeda = false) {
  const ctx = document.getElementById(canvasId);

  if (!ctx || !ChartJS) {
    return instancia;
  }

  if (instancia) {
    instancia.destroy();
  }

  return new ChartJS(ctx, {
    type: "bar",
    data: {
      labels,
      datasets: [
        {
          label: formatoMoeda ? "Investimento" : "Quantidade",
          data: valores,
          borderWidth: 1,
          borderRadius: 8
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,

      plugins: {
        legend: {
          display: false
        },

        tooltip: {
          callbacks: {
            label: (context) =>
              formatoMoeda
                ? moeda.format(context.raw || 0)
                : String(context.raw || 0)
          }
        },

        datalabels: {
          display: true,
          anchor: "end",
          align: "top",
          formatter: (valor) =>
            formatoMoeda
              ? moedaCompacta(valor)
              : valor,
          font: {
            size: 9,
            weight: "bold"
          },
          clamp: true,
          clip: true
        }
      },

      scales: {
        y: {
          beginAtZero: true,
          ticks: {
            font: {
              size: 10
            },
            callback: (valor) =>
              formatoMoeda
                ? moedaCompacta(valor)
                : valor
          }
        },

        x: {
          ticks: {
            maxRotation: 35,
            minRotation: 0,
            font: {
              size: 10
            }
          }
        }
      }
    }
  });
}

function renderizarGraficoPizza(instancia, canvasId, labels, valores) {
  const ctx = document.getElementById(canvasId);

  if (!ctx || !ChartJS) {
    return instancia;
  }

  if (instancia) {
    instancia.destroy();
  }

  return new ChartJS(ctx, {
    type: "doughnut",
    data: {
      labels,
      datasets: [
        {
          data: valores,
          borderWidth: 2
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: "58%",

      plugins: {
        legend: {
          position: "bottom",
          labels: {
            boxWidth: 10,
            font: {
              size: 10,
              weight: "bold"
            }
          }
        },

        datalabels: {
          display: true,
          formatter: (valor) => valor,
          font: {
            size: 10,
            weight: "bold"
          }
        }
      }
    }
  });
}

/* =========================================
   RANKING E ANOMALIAS
========================================= */

function atualizarRanking(resumo) {
  const tbody = document.getElementById("tabelaRanking");

  if (!tbody) {
    return;
  }

  if (resumo.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="16">Nenhuma obra encontrada para os filtros selecionados.</td>
      </tr>
    `;
    return;
  }

  const ranking = [...resumo].sort((a, b) =>
    obterPontuacaoCriticidade(b) - obterPontuacaoCriticidade(a)
  );

  tbody.innerHTML = ranking.map((obra, index) => `
    <tr data-obra-id="${textoSeguro(obra.id)}">
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
      <td class="${obra.afo < 90 ? "td-negativo" : "td-positivo"}">${percentual(obra.afo)}</td>
      <td>${percentual(obra.fisicoReal)}</td>
      <td>${moeda.format(obra.valorOrcado)}</td>
      <td>${moeda.format(obra.financeiroReal)}</td>
      <td class="${obra.saldo < 0 ? "td-negativo" : "td-positivo"}">${moeda.format(obra.saldo)}</td>
      <td>${obra.anomalias}</td>
      <td>${obra.anomAbertas}</td>
      <td class="${obra.anomCriticas > 0 ? "td-negativo" : ""}">${obra.anomCriticas}</td>
      <td class="${obra.anomVencidas > 0 ? "td-negativo" : ""}">${obra.anomVencidas}</td>
      <td class="${obra.saude < 70 ? "td-negativo" : "td-positivo"}">${percentual(obra.saude)}</td>
    </tr>
  `).join("");

  tbody.querySelectorAll("tr[data-obra-id]").forEach((linha) => {
    linha.addEventListener("click", () => {
      tbody.querySelectorAll("tr").forEach((item) =>
        item.classList.remove("selecionada")
      );

      linha.classList.add("selecionada");

      const id = linha.getAttribute("data-obra-id");
      const obraSelecionada = ranking.find((obra) => String(obra.id) === String(id));

      if (obraSelecionada) {
        renderizarAnomaliasObra(obraSelecionada);
      }
    });
  });
}

function obterPontuacaoCriticidade(obra) {
  const saudeInvertida = 100 - numero(obra.saude);
  const afoInvertido = 100 - numero(obra.afo);
  const pesoValor = Math.log10(Math.max(numero(obra.valorOrcado), 1));
  const pesoGut = obterFatorGUT(obra.gutScore || 0);

  return (
    saudeInvertida * 2 +
    afoInvertido * 1.5 +
    obra.anomCriticas * 15 +
    obra.anomVencidas * 12 +
    obra.anomAbertas * 5 +
    pesoValor * 4 +
    pesoGut * 10
  );
}

function renderizarAnomaliasObra(obra) {
  const resumo = document.getElementById("anomaliasObraSelecionada");
  const tbody = document.getElementById("tabelaDescricaoAnomalias");

  if (!tbody) {
    return;
  }

  const lista = obra.anomaliasLista || [];

  if (resumo) {
    resumo.className = "anomalias-obra-resumo";
    resumo.innerHTML = `
      <strong>${textoSeguro(obra.nome)}</strong>
      <span>
        ${lista.length} anomalia(s) | ${obra.anomCriticas} crítica(s) | ${obra.anomVencidas} vencida(s)
      </span>
    `;
  }

  if (lista.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="12">Nenhuma anomalia registrada para esta obra.</td>
      </tr>
    `;
    return;
  }

  anomaliasRenderizadas = new Map();

  tbody.innerHTML = lista.map((anomalia, index) => {
    const chave = criarChaveRenderizacaoAnomalia(anomalia, index);
    anomaliasRenderizadas.set(chave, anomalia);

    const podeEditar = usuarioEhAdministrador(usuarioLogadoGlobal);

    return `
      <tr>
        <td>${formatarDataTabela(anomalia.data)}</td>
        <td>${textoSeguro(anomalia.semana || "-")}</td>
        <td>${textoSeguro(anomalia.tipo || "-")}</td>
        <td>${textoSeguro(anomalia.criticidade || "-")}</td>
        <td>${textoSeguro(anomalia.impacto || "-")}</td>
        <td>
          <span class="status-anomalia-pill ${classeStatusAnomalia(anomalia.status)}">
            ${textoSeguro(anomalia.status || "Aberta")}
          </span>
        </td>
        <td>
          <select class="select-status-anomalia" data-chave="${textoSeguro(chave)}" ${podeEditar ? "" : "disabled"}>
            <option value="Aberta" ${statusAnomaliaIgual(anomalia.status, "Aberta") ? "selected" : ""}>Aberta</option>
            <option value="Em tratativa" ${statusAnomaliaIgual(anomalia.status, "Em tratativa") ? "selected" : ""}>Em tratativa</option>
            <option value="Resolvida" ${statusAnomaliaIgual(anomalia.status, "Resolvida") ? "selected" : ""}>Resolvida</option>
          </select>
        </td>
        <td>${formatarPrazo(anomalia.prazoTratativa)}</td>
        <td>${textoSeguro(anomalia.responsavel || "-")}</td>
        <td>${textoSeguro(anomalia.descricao || "-")}</td>
        <td>${textoSeguro(anomalia.acaoCorretiva || "-")}</td>
        <td>
          <button
            type="button"
            class="btn-alterar-status-anomalia"
            data-chave="${textoSeguro(chave)}"
            ${podeEditar ? "" : "disabled"}
          >
            Alterar
          </button>
        </td>
      </tr>
    `;
  }).join("");

  tbody.querySelectorAll(".btn-alterar-status-anomalia").forEach((botao) => {
    botao.addEventListener("click", () => {
      const chave = botao.getAttribute("data-chave");
      const anomalia = anomaliasRenderizadas.get(chave);
      const select = tbody.querySelector(
        `.select-status-anomalia[data-chave="${cssEscapeSafe(chave)}"]`
      );
      const novoStatus = select?.value || anomalia?.status || "";

      abrirModalStatusAnomalia(anomalia, novoStatus);
    });
  });
}

function limparTabelaAnomaliasSelecionada() {
  const resumo = document.getElementById("anomaliasObraSelecionada");
  const tbody = document.getElementById("tabelaDescricaoAnomalias");

  if (resumo) {
    resumo.className = "anomalias-obra-vazio";
    resumo.textContent = "Selecione uma obra no ranking para visualizar as anomalias registradas.";
  }

  if (tbody) {
    tbody.innerHTML = `
      <tr>
        <td colspan="12">Nenhuma obra selecionada.</td>
      </tr>
    `;
  }
}

/* =========================================
   STATUS, SAÚDE E GUT
========================================= */

function calcularStatusObraConsolidado(obra, fisicoReal, financeiroReal) {
  const statusOriginal = valorTexto(
    obra.status ||
    obra.statusObra ||
    obra.statusNovo ||
    obra.fase ||
    ""
  );

  const statusNormalizado = normalizarTexto(statusOriginal);

  if (statusNormalizado.includes("concluid") || fisicoReal >= 100) {
    return "Concluído";
  }

  if (statusNormalizado.includes("paralisad")) {
    return "Paralisado";
  }

  if (financeiroReal > 0 && fisicoReal <= 0) {
    return "Paralisado";
  }

  if (fisicoReal > 0 && fisicoReal < 100) {
    return "Em andamento";
  }

  if (statusNormalizado.includes("andamento") || statusNormalizado.includes("execucao")) {
    return "Em andamento";
  }

  return "Planejado";
}

function calcularSaudeObra(afo, ipf, totalAnomalias, anomCriticas, anomVencidas, gutScore) {
  let saude = 100;

  if (afo > 0 && afo < 100) {
    saude -= Math.min(30, (100 - afo) * 0.6);
  }

  if (ipf > 100) {
    saude -= Math.min(25, (ipf - 100) * 0.5);
  }

  saude -= Math.min(15, totalAnomalias * 2);
  saude -= Math.min(25, anomCriticas * 7);
  saude -= Math.min(25, anomVencidas * 8);

  const fatorGut = obterFatorGUT(gutScore || 0);

  if (fatorGut > 1) {
    saude -= Math.min(15, (fatorGut - 1) * 10);
  }

  return limitarEntre(saude, 0, 100);
}

function obterGutScoreObra(obra) {
  const direto = numero(
    obra.gutScore ||
    obra.resultadoGUT ||
    obra.resultadoGut ||
    obra.matrizGUT ||
    obra.matrizGut ||
    obra.scoreGUT ||
    obra.scoreGut ||
    obra.gut ||
    0
  );

  if (direto > 0) {
    return direto;
  }

  const gravidade = numero(
    obra.gravidade ||
    obra.gutGravidade ||
    obra.G ||
    obra.g ||
    0
  );

  const urgencia = numero(
    obra.urgencia ||
    obra.gutUrgencia ||
    obra.U ||
    obra.u ||
    0
  );

  const tendencia = numero(
    obra.tendencia ||
    obra.gutTendencia ||
    obra.T ||
    obra.t ||
    0
  );

  if (gravidade > 0 && urgencia > 0 && tendencia > 0) {
    return gravidade * urgencia * tendencia;
  }

  return 0;
}

function obterFatorGUT(score) {
  const valor = numero(score);

  if (valor <= 0) {
    return 1;
  }

  if (valor <= 5) {
    return 1 + valor / 5;
  }

  if (valor <= 25) {
    return 1 + valor / 25;
  }

  return 1 + Math.min(valor, 125) / 125;
}

function obterPesoPonderadoObra(obra, valorOrcadoCalculado = 0) {
  const valor = Math.max(
    numero(valorOrcadoCalculado) || obterValorOrcadoObra(obra),
    1
  );

  return valor * obterFatorGUT(obterGutScoreObra(obra));
}

/* =========================================
   OBRA, PERTENCIMENTO E PERÍODOS
========================================= */

function pertenceAObra(item, obra) {
  const chavesObra = obterChavesObra(obra);

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
    .map((valor) => normalizarTexto(valor));

  if (chavesItem.some((chave) => chavesObra.includes(chave))) {
    return true;
  }

  const centroItem = normalizarTexto(
    item.centroCusto ||
    item.centroDeCusto ||
    item.centroCustoApropriacao
  );

  const centroObra = normalizarTexto(obterCentroCustoObra(obra));

  const obraItem = normalizarTexto(
    item.obraNome ||
    item.nomeObra ||
    item.nomeProjeto ||
    item.obra
  );

  const obraNome = normalizarTexto(obterNomeObra(obra));

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

  if (centroItem && centroObra && centroItem === centroObra && !obraItem) {
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
    .map((valor) => normalizarTexto(valor));
}

function obterNomeObra(obra) {
  return valorTexto(
    obra.nomeProjeto ||
    obra.nomeObra ||
    obra.obraNome ||
    obra.nome ||
    obra.obra ||
    obra.projeto ||
    obra.idObra ||
    obra.idProjeto ||
    obra.docId ||
    "Sem nome"
  );
}

function obterCentroCustoObra(obra) {
  return valorTexto(
    obra.centroCusto ||
    obra.centroDeCusto ||
    obra.centroCustoApropriacao ||
    obra.centroCustoReal ||
    obra.cc ||
    ""
  );
}

function obterValorOrcadoObra(obra) {
  return numero(
    obra.valorObra ||
    obra.valorTotal ||
    obra.valorOrcado ||
    obra.valorOrçado ||
    obra.valororcado ||
    obra.investimento ||
    obra.custoTotal ||
    obra.orcamento ||
    obra.orçamento ||
    0
  );
}

function obterIntervaloObra(obra) {
  const inicio = normalizarData(
    obra.dataInicio ||
    obra.dataInicioPrevisto ||
    obra.inicioPrevisto ||
    obra.inicio ||
    obra.dataInicioObra ||
    obra.dataInicial ||
    obra.inicioObra
  );

  const fim = normalizarData(
    obra.dataFim ||
    obra.dataTerminoPrevisto ||
    obra.dataFimPrevisto ||
    obra.dataTermino ||
    obra.terminoPrevisto ||
    obra.termino ||
    obra.fim ||
    obra.dataFimObra ||
    obra.dataFinal ||
    obra.terminoObra
  );

  if (!inicio && !fim) {
    return null;
  }

  return {
    inicio: inicio || fim,
    fim: fim || inicio
  };
}

function obterIntervaloItem(item) {
  if (item.periodo) {
    const intervaloPeriodo = obterIntervaloTextoPeriodo(item.periodo);

    if (intervaloPeriodo) {
      return intervaloPeriodo;
    }
  }

  const inicio = normalizarData(
    item.dataInicio ||
    item.dataInicioPrevisto ||
    item.inicioPrevisto ||
    item.inicio ||
    item.dataInicial
  );

  const fim = normalizarData(
    item.dataFim ||
    item.dataTerminoPrevisto ||
    item.dataFimPrevisto ||
    item.dataTermino ||
    item.terminoPrevisto ||
    item.termino ||
    item.fim ||
    item.dataFinal
  );

  if (inicio || fim) {
    return {
      inicio: inicio || fim,
      fim: fim || inicio
    };
  }

  const data = normalizarData(
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
  const texto = String(textoPeriodo || "").trim();

  if (!texto) {
    return null;
  }

  const datasBR = texto.match(/\d{2}\/\d{2}\/\d{4}/g);

  if (datasBR && datasBR.length >= 2) {
    const inicio = normalizarData(datasBR[0]);
    const fim = normalizarData(datasBR[datasBR.length - 1]);

    if (inicio || fim) {
      return {
        inicio: inicio || fim,
        fim: fim || inicio
      };
    }
  }

  const datasISO = texto.match(/\d{4}-\d{2}-\d{2}/g);

  if (datasISO && datasISO.length >= 2) {
    const inicio = normalizarData(datasISO[0]);
    const fim = normalizarData(datasISO[datasISO.length - 1]);

    if (inicio || fim) {
      return {
        inicio: inicio || fim,
        fim: fim || inicio
      };
    }
  }

  const dataUnica = normalizarData(texto);

  if (!dataUnica) {
    return null;
  }

  return {
    inicio: dataUnica,
    fim: dataUnica
  };
}

function intervaloSobrepoeFiltro(inicioItem, fimItem, filtroInicio, filtroFim) {
  const inicioFiltro = filtroInicio ? normalizarData(filtroInicio) : null;
  const fimFiltro = filtroFim ? normalizarData(filtroFim) : null;

  if (fimFiltro) {
    fimFiltro.setHours(23, 59, 59, 999);
  }

  const inicio = inicioItem || fimItem;
  const fim = fimItem || inicioItem;

  if (!inicio && !fim) {
    return false;
  }

  if (inicioFiltro && fim && fim < inicioFiltro) {
    return false;
  }

  if (fimFiltro && inicio && inicio > fimFiltro) {
    return false;
  }

  return true;
}

/* =========================================
   PERÍODO E ORDENAÇÃO DAS SEMANAS
========================================= */

function atualizarResumoPeriodo() {
  const inicio = getValor("filtroInicio");
  const fim = getValor("filtroFim");
  const elemento = document.getElementById("periodoAplicadoResumo");

  if (!elemento) {
    return;
  }

  if (!inicio && !fim) {
    elemento.textContent =
      "Todos os indicadores abaixo consideram todo o histórico disponível.";
    return;
  }

  const inicioTexto = inicio ? formatarDataTabela(inicio) : "início do histórico";
  const fimTexto = fim ? formatarDataTabela(fim) : "data atual";

  elemento.textContent = `Indicadores filtrados pelo período de ${inicioTexto} até ${fimTexto}.`;
}

function obterLabelPeriodoOriginal(item) {
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

function obterNumeroSemanaItem(item) {
  const candidatos = [
    item.semana,
    item.numeroSemana,
    item.semanaNumero,
    item.week,
    item.weekNumber,
    item.numSemana
  ];

  for (const valor of candidatos) {
    if (valor === null || valor === undefined || valor === "") {
      continue;
    }

    if (typeof valor === "number" && valor > 0) {
      return valor;
    }

    const texto = String(valor).trim();

    if (/^\d+$/.test(texto)) {
      return Number(texto);
    }

    const matchSemana =
      texto.match(/semana\s*0*(\d+)/i) ||
      texto.match(/sem\s*0*(\d+)/i);

    if (matchSemana) {
      return Number(matchSemana[1]);
    }
  }

  return null;
}

function obterOrdemPeriodoItem(item) {
  const intervaloPeriodo = item.periodo
    ? obterIntervaloTextoPeriodo(item.periodo)
    : null;

  if (intervaloPeriodo?.inicio) {
    return limparHorario(intervaloPeriodo.inicio).getTime();
  }

  const intervaloItem = obterIntervaloItem(item);

  if (intervaloItem?.inicio) {
    return limparHorario(intervaloItem.inicio).getTime();
  }

  const data = normalizarData(
    item.data ||
    item.dataAtualizacao ||
    item.atualizadoEm ||
    item.criadoEm ||
    item.dataRegistro
  );

  if (data) {
    return limparHorario(data).getTime();
  }

  const numeroSemana = obterNumeroSemanaItem(item);

  if (numeroSemana !== null) {
    return numeroSemana;
  }

  return null;
}

function ordenarItensPorPeriodo(lista) {
  return [...lista].sort((a, b) => {
    const ordemA = obterOrdemPeriodoItem(a);
    const ordemB = obterOrdemPeriodoItem(b);

    if (ordemA !== null && ordemB !== null && ordemA !== ordemB) {
      return ordemA - ordemB;
    }

    if (ordemA !== null && ordemB === null) {
      return -1;
    }

    if (ordemA === null && ordemB !== null) {
      return 1;
    }

    return String(obterLabelPeriodoOriginal(a)).localeCompare(
      String(obterLabelPeriodoOriginal(b)),
      "pt-BR"
    );
  });
}

function limparHorario(data) {
  const novaData = new Date(data);
  novaData.setHours(0, 0, 0, 0);
  return novaData;
}

/* =========================================
   DATA
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
    return isNaN(valor.getTime()) ? null : valor;
  }

  const texto = String(valor).trim();

  if (!texto) {
    return null;
  }

  if (texto.includes(" a ")) {
    return normalizarData(texto.split(" a ")[0].trim());
  }

  if (/^\d{4}-\d{2}-\d{2}/.test(texto)) {
    const partes = texto.split("T")[0].split("-");
    const data = new Date(Number(partes[0]), Number(partes[1]) - 1, Number(partes[2]));
    return isNaN(data.getTime()) ? null : data;
  }

  if (/^\d{2}\/\d{2}\/\d{4}/.test(texto)) {
    const partes = texto.split(" ")[0].split("/");
    const data = new Date(Number(partes[2]), Number(partes[1]) - 1, Number(partes[0]));
    return isNaN(data.getTime()) ? null : data;
  }

  const data = new Date(texto);

  return isNaN(data.getTime()) ? null : data;
}

function formatarDataTabela(valor) {
  const data = normalizarData(valor);
  return data ? data.toLocaleDateString("pt-BR") : "-";
}

const formatarDataCurta = (data) =>
  data ? data.toLocaleDateString("pt-BR") : "";

/* =========================================
   AGRUPAMENTOS E MATEMÁTICA
========================================= */

function agruparContagem(lista, campo) {
  return lista.reduce((acc, item) => {
    const chave = item[campo] || "Não informado";
    acc[chave] = (acc[chave] || 0) + 1;
    return acc;
  }, {});
}

function agruparSoma(lista, campoGrupo, campoValor) {
  return lista.reduce((acc, item) => {
    const chave = item[campoGrupo] || "Não informado";
    acc[chave] = (acc[chave] || 0) + numero(item[campoValor]);
    return acc;
  }, {});
}

function soma(lista, campo) {
  return lista.reduce((total, item) => total + numero(item[campo]), 0);
}

function mediaPonderada(lista) {
  const validos = lista.filter((item) => numero(item.valor) > 0 && numero(item.peso) > 0);
  const somaPesos = validos.reduce((total, item) => total + numero(item.peso), 0);

  if (somaPesos <= 0) {
    return 0;
  }

  return validos.reduce((total, item) =>
    total + numero(item.valor) * numero(item.peso),
    0
  ) / somaPesos;
}

function numero(valor) {
  if (valor === null || valor === undefined || valor === "") {
    return 0;
  }

  if (typeof valor === "number") {
    return isNaN(valor) ? 0 : valor;
  }

  const texto = String(valor)
    .replace(/R\$/gi, "")
    .replace(/%/g, "")
    .replace(/\s/g, "")
    .replace(/\./g, "")
    .replace(/,/g, ".");

  const convertido = Number(texto);

  return isNaN(convertido) ? 0 : convertido;
}

function primeiroNumeroValido(objeto, campos) {
  for (const campo of campos) {
    if (
      objeto[campo] !== undefined &&
      objeto[campo] !== null &&
      objeto[campo] !== ""
    ) {
      return numero(objeto[campo]);
    }
  }

  return null;
}

function limitarPercentual(valor) {
  return limitarEntre(numero(valor), 0, 100);
}

function limitarEntre(valor, min, max) {
  return Math.min(Math.max(numero(valor), min), max);
}

function arredondar1(valor) {
  return Number(numero(valor).toFixed(1));
}

function moedaCompacta(valor) {
  const numeroValor = numero(valor);

  if (Math.abs(numeroValor) >= 1000000) {
    return `R$ ${(numeroValor / 1000000).toFixed(1).replace(".", ",")} mi`;
  }

  if (Math.abs(numeroValor) >= 1000) {
    return `R$ ${(numeroValor / 1000).toFixed(0).replace(".", ",")} mil`;
  }

  return moeda.format(numeroValor);
}

/* =========================================
   ANOMALIAS - APOIO
========================================= */

function ehCritica(valor) {
  const texto = normalizarTexto(valor);

  return (
    texto.includes("critica") ||
    texto.includes("alta") ||
    texto.includes("grave")
  );
}

function ehAberta(valor) {
  const texto = normalizarTexto(valor);

  return (
    texto.includes("aberta") ||
    texto === "" ||
    texto.includes("pendente")
  );
}

function ehResolvida(valor) {
  const texto = normalizarTexto(valor);

  return (
    texto.includes("resolvida") ||
    texto.includes("concluida") ||
    texto.includes("concluido") ||
    texto.includes("finalizada") ||
    texto.includes("encerrada")
  );
}

function statusAnomaliaIgual(valorAtual, valorComparado) {
  const atual = normalizarTexto(valorAtual);
  const comparado = normalizarTexto(valorComparado);

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
  const prazo = normalizarData(anomalia.prazoTratativa);

  if (!prazo) {
    return "semPrazo";
  }

  if (ehResolvida(anomalia.status)) {
    return "noPrazo";
  }

  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);

  const prazoLimpo = new Date(prazo);
  prazoLimpo.setHours(0, 0, 0, 0);

  const diffDias = Math.ceil((prazoLimpo - hoje) / 86400000);

  if (diffDias < 0) {
    return "vencidas";
  }

  if (diffDias <= 7) {
    return "vence7dias";
  }

  return "noPrazo";
}

function formatarPrazo(valor) {
  const data = normalizarData(valor);
  return data ? data.toLocaleDateString("pt-BR") : "-";
}

function criarChaveRenderizacaoAnomalia(anomalia, index) {
  return [
    anomalia.origem,
    anomalia.docId,
    anomalia.obraId,
    anomalia.semana,
    index
  ].join("_");
}

/* =========================================
   CLASSES E STATUS
========================================= */

function classeStatus(status) {
  const texto = normalizarTexto(status);

  if (texto.includes("planejado")) {
    return "status-planejado";
  }

  if (texto.includes("andamento") || texto.includes("execucao")) {
    return "status-andamento";
  }

  if (texto.includes("concluido") || texto.includes("concluida")) {
    return "status-concluido";
  }

  if (texto.includes("paralisado") || texto.includes("paralisada")) {
    return "status-paralisado";
  }

  return "status-planejado";
}

function classeStatusAnomalia(status) {
  const texto = normalizarTexto(status);

  if (texto.includes("resolvida")) {
    return "anomalia-resolvida";
  }

  if (texto.includes("tratativa") || texto.includes("tratamento")) {
    return "anomalia-tratativa";
  }

  return "anomalia-aberta";
}

function statusEquivalente(valorAtual, valorFiltro) {
  const atual = normalizarTexto(valorAtual);
  const filtro = normalizarTexto(valorFiltro);

  if (!filtro) {
    return true;
  }

  if (filtro.includes("planejado")) {
    return atual.includes("planejado");
  }

  if (filtro.includes("andamento") || filtro.includes("execucao")) {
    return atual.includes("andamento") || atual.includes("execucao");
  }

  if (filtro.includes("concluido") || filtro.includes("concluida")) {
    return atual.includes("concluid");
  }

  if (filtro.includes("paralisado") || filtro.includes("paralisada")) {
    return atual.includes("paralisad");
  }

  return atual === filtro;
}

function aplicarCorIndicador(id, valor, condicaoNegativa) {
  const elemento = document.getElementById(id);

  if (!elemento) {
    return;
  }

  elemento.classList.remove("td-negativo", "td-positivo", "indicador-alerta");

  if (condicaoNegativa) {
    elemento.classList.add("td-negativo");
    return;
  }

  if (numero(valor) > 0) {
    elemento.classList.add("td-positivo");
  }
}

/* =========================================
   ADMIN / DOM / TEXTO
========================================= */

function usuarioEhAdministrador(usuario) {
  const perfil = normalizarTexto(
    usuario?.perfil ||
    usuario?.tipoUsuario ||
    usuario?.nivelAcesso ||
    usuario?.role ||
    usuario?.acesso ||
    usuario?.email ||
    ""
  );

  return (
    perfil.includes("administrador") ||
    perfil.includes("admin") ||
    usuario?.admin === true ||
    usuario?.isAdmin === true ||
    usuario?.administrador === true
  );
}

function setTexto(id, valor) {
  const elemento = document.getElementById(id);

  if (elemento) {
    elemento.textContent = valor;
  }
}

function getValor(id) {
  const elemento = document.getElementById(id);
  return elemento ? elemento.value : "";
}

function setValor(id, valor) {
  const elemento = document.getElementById(id);

  if (elemento) {
    elemento.value = valor;
  }
}

function valorTexto(valor) {
  if (valor === null || valor === undefined) {
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

function cssEscapeSafe(valor) {
  if (window.CSS && typeof window.CSS.escape === "function") {
    return window.CSS.escape(valor);
  }

  return String(valor || "")
    .replace(/\\/g, "\\\\")
    .replace(/"/g, "\\\"");
}