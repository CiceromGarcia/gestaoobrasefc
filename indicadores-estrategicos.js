import { db } from "./firebaseConfig.js";
import { protegerPagina } from "./authGuard.js";

import {
  collection,
  getDocs,
  doc,
  setDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.3/firebase-firestore.js";

/* =========================================
   INDICADORES ESTRATÉGICOS - v408

   Correções:
   - Removida execução dos gráficos de Curva S.
   - Mantidos KPIs executivos.
   - Mantidos gráficos analíticos.
   - Mantido ranking de criticidade.
   - Mantida gestão de anomalias.
   - Mantida lógica de valor orçado igual ao Dashboard.
========================================= */

console.info("Indicadores Estratégicos v408 carregado");

let usuarioLogadoGlobal = null;

let obras = [];
let planejamentos = [];
let realizados = [];
let atualizacoes = [];
let anomalias = [];

const moeda = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL"
});

const percentual = (valor) =>
  `${Number(valor || 0).toFixed(2).replace(".", ",")}%`;

/* =========================================
   INICIALIZAÇÃO
========================================= */

document.addEventListener("DOMContentLoaded", async () => {
  try {
    usuarioLogadoGlobal = await protegerPagina();

    configurarEventos();

    await carregarDados();
    await carregarManuaisSLA();
    await carregarPesquisasRespostasSLA();

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
    "filtroRegional",
    "filtroLocalidade",
    "filtroStatus"
  ].forEach((id) => {
    const elemento = document.getElementById(id);

    if (!elemento) {
      return;
    }

    elemento.addEventListener("change", () => {
      if (id === "filtroRegional") {
        atualizarFiltrosDependentes();
      }

      atualizarDashboard();
    });
  });

  ["filtroInicio", "filtroFim"].forEach((id) => {
    document.getElementById(id)?.addEventListener("change", atualizarDashboard);
  });

  document.getElementById("btnLimparFiltros")?.addEventListener("click", () => {
    document
      .querySelectorAll(".filters input, .filters select")
      .forEach((elemento) => {
        elemento.value = "";
      });

    preencherFiltrosIniciais();
    atualizarDashboard();
  });

  document.getElementById("btnExportar")?.addEventListener("click", () => {
    window.print();
  });
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

    financeiroReal: numeroMoedaCadastro(
      item.financeiroReal ||
      item.investimentoNovo ||
      item.custoSemana ||
      item.custo ||
      0
    ),

    financeiroRealAcum: numeroMoedaCadastro(
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

  const responsabilidade = valorTexto(
    item.responsabilidadeAnomalia ||
    mapa.responsabilidade ||
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
    responsabilidade,
    descricao: descricao || "Sem descrição",
    acaoCorretiva,

    impactoFinanceiro: numeroMoedaCadastro(
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
    "filtroLocalidade",
    obras.map((obra) => obra.localidade),
    "Todas"
  );

  // Data Fim sempre parte marcada com hoje, e Status sempre parte em
  // "Em andamento" — tanto no primeiro carregamento quanto ao limpar
  // os filtros.
  setValor("filtroFim", obterDataHojeISO());
  setValor("filtroStatus", "Em andamento");
}

function obterDataHojeISO() {
  const hoje = new Date();
  const ano = hoje.getFullYear();
  const mes = String(hoje.getMonth() + 1).padStart(2, "0");
  const dia = String(hoje.getDate()).padStart(2, "0");

  return `${ano}-${mes}-${dia}`;
}

// Só a Localidade depende de outro filtro (Regional) — Obra e Centro
// de Custo foram removidos da tela.
function atualizarFiltrosDependentes() {
  const regionalSelecionada = getValor("filtroRegional");
  const localidadeSelecionada = getValor("filtroLocalidade");

  let obrasBase = [...obras];

  if (regionalSelecionada) {
    obrasBase = obrasBase.filter((obra) => obra.regional === regionalSelecionada);
  }

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

  // Anomalias sempre completas, sem filtro nenhum (nem período, nem
  // Regional/Localidade/Status/Obra) — cada anomalia continua sendo
  // atribuída à obra certa dentro de montarResumoObras.
  const anomaliasFiltradas = anomalias;

  const resumoSemStatus = montarResumoObras(
    obrasFiltradasSemStatus,
    planejamentosFiltrados,
    realizadosFiltrados,
    anomaliasFiltradas,
    realizados,
    planejamentos
  );

  const resumo = aplicarFiltroStatusResumo(resumoSemStatus);

  renderizarTodasAnomalias(resumo);

  atualizarDescricaoSLA();
  renderizarTabelaObrasSLA(resumo);
  atualizarIndicadoresSLA(resumo);
}

/* =========================================
   SLA — PEQUENAS OBRAS

   Indicadores extraídos do processo "Pequenas Obras" da planilha
   SLA_Consolidado (aba SLA_EFC), excluindo o grupo "Qualidade" (ainda
   não medido). Usa o MESMO "resumo" já calculado por montarResumoObras
   pro restante da tela — os indicadores sempre respeitam os filtros
   (Regional/Localidade/Status/Ciclo) aplicados no momento.
========================================= */

const MESES_PT = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"
];

function atualizarDescricaoSLA() {
  const elemento = document.getElementById("slaDescricaoResumo");

  if (!elemento) {
    return;
  }

  const inicio = getValor("filtroInicio");
  const fim = getValor("filtroFim");

  const base =
    "SLA — Pequenas Obras e Pragas e Vetores (Processo: Pequenas Obras)";

  if (!inicio || !fim) {
    elemento.textContent = base;
    return;
  }

  const dataFim = normalizarData(fim);
  const mesReferencia = dataFim
    ? `${MESES_PT[dataFim.getMonth()]}/${dataFim.getFullYear()}`
    : "-";

  elemento.textContent =
    `${base} · Período: ${formatarDataTabela(inicio)} a ${formatarDataTabela(fim)} · Mês de referência: ${mesReferencia}`;
}

function obterIdObraResumo(item) {
  const obra = item.obraOriginal || {};

  return (
    obra.idProjeto ||
    obra.idObra ||
    obra.codigoObra ||
    obra.id ||
    "-"
  );
}

function obterDataInicioResumo(item) {
  const obra = item.obraOriginal || {};

  return (
    obra.dataInicio ||
    obra.dataInicioPrevisto ||
    obra.dataInicioObra ||
    ""
  );
}

function obterDataFimResumo(item) {
  const obra = item.obraOriginal || {};

  return (
    obra.dataFim ||
    obra.dataTerminoPrevisto ||
    obra.dataFimPrevisto ||
    obra.dataFimObra ||
    ""
  );
}

function renderizarTabelaObrasSLA(resumo) {
  const corpo = document.getElementById("tabelaObrasSLA");

  if (!corpo) {
    return;
  }

  if (!resumo.length) {
    corpo.innerHTML = `<tr><td colspan="11">Nenhuma obra encontrada para os filtros selecionados.</td></tr>`;
    return;
  }

  corpo.innerHTML = resumo
    .map((item) => {
      const desvio = item.valorOrcado - item.financeiroReal;

      return `
        <tr>
          <td>${obterIdObraResumo(item)}</td>
          <td>${item.nome}</td>
          <td>${item.localidade}</td>
          <td>${formatarDataTabela(obterDataInicioResumo(item))}</td>
          <td>${formatarDataTabela(obterDataFimResumo(item))}</td>
          <td>${item.centroCusto}</td>
          <td>${moeda.format(item.valorOrcado || 0)}</td>
          <td>${moeda.format(item.financeiroReal || 0)}</td>
          <td class="${desvio < 0 ? "td-negativo" : "td-positivo"}">${moeda.format(desvio || 0)}</td>
          <td>${percentual(item.fisicoReal)}</td>
          <td class="${Number(item.afo || 0) < 100 ? "afo-baixo" : "afo-ok"}">${percentual(item.afo)}</td>
        </tr>
      `;
    })
    .join("");
}

// Escala genérica (percentual -> pontuação 0 a 4) a partir de 4
// limites ascendentes [l1,l2,l3,l4].
function pontuarPercentualComLimites(valor, limites) {
  if (valor >= limites[3]) return 4;
  if (valor >= limites[2]) return 3;
  if (valor >= limites[1]) return 2;
  if (valor >= limites[0]) return 1;
  return 0;
}

// Escala usada por ADFísico, IMC, AFO(%), ADFinanceiro, AFO(R$) e IQO
// na planilha original: <75%:0 · 75-85%:1 · 85-95%:2 · 95-99%:3 · ≥99%:4.
function pontuarIndicadorSLA(percentualValor) {
  return pontuarPercentualComLimites(percentualValor, [75, 85, 95, 99]);
}

// Escala própria do AT (Atendimento de Pragas e Vetores): <80%:0 ·
// 80-85%:1 · 85-90%:2 · 90-95%:3 · ≥95%:4.
function pontuarAT(percentualValor) {
  return pontuarPercentualComLimites(percentualValor, [80, 85, 90, 95]);
}

// QAO é por QUANTIDADE de anomalias (não percentual) e é invertido:
// quanto menos anomalias, maior a pontuação. Escala da planilha:
// 7+:0 · 6:1 · 5:2 · 4:3 · ≤3:4.
function pontuarQAO(quantidade) {
  if (quantidade <= 3) return 4;
  if (quantidade === 4) return 3;
  if (quantidade === 5) return 2;
  if (quantidade === 6) return 1;
  return 0;
}

function classificarSLA(percentualFinal) {
  if (percentualFinal >= 90) {
    return { label: "Bom", cor: "#16a34a" };
  }

  if (percentualFinal >= 80) {
    return { label: "Aceitável", cor: "#2563eb" };
  }

  if (percentualFinal >= 75) {
    return { label: "Regular", cor: "#f59e0b" };
  }

  return { label: "Péssimo", cor: "#ef4444" };
}

// Chave usada pra salvar os campos digitáveis do SLA — um documento
// por período (Data Início/Fim) selecionado nos filtros. Sem período
// selecionado, cai num período "geral" (histórico completo).
function chaveCicloAtual() {
  const inicio = getValor("filtroInicio") || "geral";
  const fim = getValor("filtroFim") || "geral";

  return `${inicio}_${fim}`;
}

// Indicadores sem fonte de dados própria no sistema — ficam digitáveis
// e salvos por período em slaIndicadoresManuais/{inicio_fim}:
//   at  -> Atendimento das OMs de Pragas e Vetores (AT), percentual
//   imc -> Idade Média da Carteira (IMC), percentual
//   qao -> Quantidade de Anomalias em Obra (QAO), quantidade (não %)
// IQO deixou de ser digitável — agora vem das respostas reais da tela
// de Avaliação de Qualidade da Obra (pesquisa.html), ver
// carregarPesquisasRespostasSLA() logo abaixo.
let manuaisSLACache = {};

async function carregarManuaisSLA() {
  try {
    const snap = await getDocs(collection(db, "slaIndicadoresManuais"));

    manuaisSLACache = {};

    snap.forEach((documento) => {
      manuaisSLACache[documento.id] = documento.data();
    });
  } catch (erro) {
    console.warn("Não foi possível carregar os indicadores manuais do SLA:", erro);
  }
}

// Respostas da pesquisa de satisfação (pesquisasRespostas) — usadas
// pra calcular o IQO. A regra do Firestore já filtra por Regional
// sozinha (mesma regra usada na tela de pesquisa), então aqui é só
// ler a coleção sem filtro nenhum no client.
let pesquisasRespostasCache = [];

async function carregarPesquisasRespostasSLA() {
  try {
    const snap = await getDocs(collection(db, "pesquisasRespostas"));

    pesquisasRespostasCache = snap.docs.map((documento) => documento.data());
  } catch (erro) {
    console.warn("Não foi possível carregar as respostas de qualidade do SLA:", erro);
    pesquisasRespostasCache = [];
  }
}

async function salvarCampoManualSLA(campo, valor) {
  const chave = chaveCicloAtual();

  manuaisSLACache[chave] = {
    ...manuaisSLACache[chave],
    [campo]: valor,
    atualizadoEm: serverTimestamp()
  };

  try {
    await setDoc(
      doc(db, "slaIndicadoresManuais", chave),
      { [campo]: valor, atualizadoEm: serverTimestamp() },
      { merge: true }
    );
  } catch (erro) {
    console.warn(`Não foi possível salvar o campo "${campo}" do SLA:`, erro);
  }
}

// Pesos dos 3 grupos do SLA (somam 100%) e peso INTERNO de cada
// indicador dentro do seu grupo (também somam 100% por grupo).
const PESO_GRUPO_SLA = {
  "Produtividade": 0.65,
  "Custo": 0.15,
  "Qualidade": 0.20
};

function atualizarIndicadoresSLA(resumo) {
  const corposPorGrupo = {
    "Produtividade": document.getElementById("tabelaIndicadoresProdutividade"),
    "Custo": document.getElementById("tabelaIndicadoresCusto"),
    "Qualidade": document.getElementById("tabelaIndicadoresQualidade")
  };

  const resultadoFinal = document.getElementById("slaResultadoFinal");

  if (!corposPorGrupo.Produtividade || !corposPorGrupo.Custo || !corposPorGrupo.Qualidade || !resultadoFinal) {
    return;
  }

  const somaFisicoReal = soma(resumo, "fisicoReal");
  const somaFisicoPlanejado = soma(resumo, "fisicoPlanejado");
  const somaExecutado = soma(resumo, "financeiroReal");
  const somaFinanceiroPlanejadoAteSemana = soma(resumo, "financeiroPlanejadoAteSemanaReal");

  // ADFísico: agregado — soma do físico real / soma do físico
  // planejado de todas as obras do período (não é média das AFOs).
  const adFisico = somaFisicoPlanejado > 0
    ? limitarPercentual((somaFisicoReal / somaFisicoPlanejado) * 100)
    : 0;

  // AFO (%): média simples da AFO calculada obra a obra — é o mesmo
  // valor exibido na coluna "AFO(%)" da Relação de Obras.
  const afoFisicoMedia = resumo.length
    ? resumo.reduce((total, item) => total + numero(item.afo), 0) / resumo.length
    : 0;

  // ADFinanceiro: valor gasto / valor planejado até a mesma semana do
  // último lançamento, agregado (soma) entre todas as obras do
  // período — não contra o orçado total, que penalizava qualquer obra
  // ainda não concluída só por ainda ter orçamento a gastar no futuro.
  // Sem limitarPercentual: um grupo que gastou mais do que o previsto
  // até agora precisa aparecer acima de 100%, não travado nele.
  const adFinanceiro = somaFinanceiroPlanejadoAteSemana > 0
    ? (somaExecutado / somaFinanceiroPlanejadoAteSemana) * 100
    : 0;

  // AFO (R$): mesma lógica da AFO física, só que financeira — média,
  // obra a obra, de (valor gasto / valor planejado até a mesma semana
  // do último lançamento daquela obra). Sem limitarPercentual: uma
  // obra que gastou mais do que deveria até agora precisa penalizar a
  // média (ex.: acima de 100%), não ser travada nele.
  const afoFinanceiroMedia = resumo.length
    ? resumo.reduce((total, item) => {
      const planejadoAteSemana = numero(item.financeiroPlanejadoAteSemanaReal);
      const executado = numero(item.financeiroReal);
      const razao = planejadoAteSemana > 0 ? (executado / planejadoAteSemana) * 100 : 0;
      return total + razao;
    }, 0) / resumo.length
    : 0;

  // QAO: mesma regra da Gestão de Anomalias — só conta anomalia com
  // prazo de resolução VENCIDO e de responsabilidade da Contratada.
  const qaoCalculado = resumo
    .flatMap((item) => item.anomaliasLista || [])
    .filter((anomalia) =>
      anomalia.responsabilidade === "Contratada" &&
      obterStatusPrazoAnomalia(anomalia) === "vencidas"
    ).length;

  // IQO: % de respostas "satisfatórias" (nota média 4 ou 5, numa
  // escala de 1 a 5) da pesquisa de qualidade (pesquisa.html), só das
  // obras que aparecem no resumo filtrado desta tela — mesma lógica
  // de "Σ votos satisfatórios / Σ votos totalizados" da planilha
  // original.
  const idsObrasResumo = new Set(resumo.map((item) => item.id));

  const respostasQualidade = pesquisasRespostasCache.filter((resposta) =>
    idsObrasResumo.has(resposta.obraId)
  );

  const iqoCalculado = respostasQualidade.length
    ? (respostasQualidade.filter((resposta) => numero(resposta.notaMedia) >= 4).length /
        respostasQualidade.length) * 100
    : null;

  // AT e IMC não têm fonte de dados própria no sistema hoje (Pragas e
  // Vetores não é controlado aqui; datas de visita/orçamento/aprovação
  // por etapa também não) — ficam digitáveis e salvos por ciclo.
  const manual = manuaisSLACache[chaveCicloAtual()] || {};

  const obterManual = (campo) =>
    manual[campo] !== undefined && manual[campo] !== null
      ? Number(manual[campo])
      : null;

  const atValor = obterManual("at");
  const imcValor = obterManual("imc");

  const indicadores = [
    {
      id: "at",
      numero: 6,
      processo: "Pragas e Vetores",
      nome: "Atendimento das OM's do grupo de planejamento de Pragas e Vetores dentro do Prazo (AT)",
      grupo: "Produtividade",
      pesoInterno: 0.25,
      metrica: "Σ OMs concluídas dentro do prazo / Σ OMs planejadas no período",
      resultado: atValor,
      pontuacao: atValor !== null ? pontuarAT(atValor) : 0,
      editavel: true,
      escalaTexto: "<80%: 0 · 80-85%: 1 · 85-90%: 2 · 90-95%: 3 · ≥95%: 4"
    },
    {
      id: "adfisico",
      numero: 7,
      processo: "Pequenas Obras",
      nome: "Aderência Física Acumulada das Obras (ADFísico)",
      grupo: "Produtividade",
      pesoInterno: 0.25,
      metrica: "Σ avanço físico real / Σ avanço físico previsto no período",
      resultado: adFisico,
      pontuacao: pontuarIndicadorSLA(adFisico),
      editavel: false,
      escalaTexto: "<75%: 0 · 75-85%: 1 · 85-95%: 2 · 95-99%: 3 · ≥99%: 4"
    },
    {
      id: "imc",
      numero: 8,
      processo: "Pequenas Obras",
      nome: "Idade Média da Carteira de Obras (IMC)",
      grupo: "Produtividade",
      pesoInterno: 0.25,
      metrica: "Tempo de visita, orçamento, aprovação, planejamento e programação / SLA de cada etapa",
      resultado: imcValor,
      pontuacao: imcValor !== null ? pontuarIndicadorSLA(imcValor) : 0,
      editavel: true,
      escalaTexto: "<75%: 0 · 75-85%: 1 · 85-95%: 2 · 95-99%: 3 · ≥99%: 4"
    },
    {
      id: "afoFisico",
      numero: 9,
      processo: "Pequenas Obras",
      nome: "Aderência Física por Obra (AFO %)",
      grupo: "Produtividade",
      pesoInterno: 0.25,
      metrica: "Média da AFO (avanço físico executado / previsto) de cada obra",
      resultado: afoFisicoMedia,
      pontuacao: pontuarIndicadorSLA(afoFisicoMedia),
      editavel: false,
      escalaTexto: "<75%: 0 · 75-85%: 1 · 85-95%: 2 · 95-99%: 3 · ≥99%: 4"
    },
    {
      id: "adfinanceiro",
      numero: 10,
      processo: "Pequenas Obras",
      nome: "Aderência Financeira Acumulada das Obras (ADFinanceiro)",
      grupo: "Custo",
      pesoInterno: 0.50,
      metrica: "Σ valor gasto / Σ valor planejado até a mesma semana do último lançamento (não o orçado total)",
      resultado: adFinanceiro,
      pontuacao: pontuarIndicadorSLA(adFinanceiro),
      editavel: false,
      escalaTexto: "<75%: 0 · 75-85%: 1 · 85-95%: 2 · 95-99%: 3 · ≥99%: 4"
    },
    {
      id: "afoFinanceiro",
      numero: 11,
      processo: "Pequenas Obras",
      nome: "Aderência Financeira por Obra (AFO R$)",
      grupo: "Custo",
      pesoInterno: 0.50,
      metrica: "Média, obra a obra, de (valor gasto / valor planejado até a mesma semana do último lançamento)",
      resultado: afoFinanceiroMedia,
      pontuacao: pontuarIndicadorSLA(afoFinanceiroMedia),
      editavel: false,
      escalaTexto: "<75%: 0 · 75-85%: 1 · 85-95%: 2 · 95-99%: 3 · ≥99%: 4"
    },
    {
      id: "iqo",
      numero: 14,
      processo: "Pequenas Obras",
      nome: "Índice de Qualidade de Entrega da Obra (IQO)",
      grupo: "Qualidade",
      pesoInterno: 0.50,
      metrica: "Σ votos satisfatórios (nota 4 ou 5) / Σ votos totalizados na Avaliação de Qualidade da Obra",
      resultado: iqoCalculado,
      // Sem nenhuma avaliação no período, a empresa não é penalizada.
      pontuacao: iqoCalculado !== null ? pontuarIndicadorSLA(iqoCalculado) : 4,
      editavel: false,
      escalaTexto: "<75%: 0 · 75-85%: 1 · 85-95%: 2 · 95-99%: 3 · ≥99%: 4"
    },
    {
      id: "qao",
      numero: 15,
      processo: "Pequenas Obras",
      nome: "Quantidade de Anomalias em Obra (QAO)",
      grupo: "Qualidade",
      pesoInterno: 0.50,
      metrica: "Quantidade de anomalias vencidas de responsabilidade da Contratada (quanto menos, melhor)",
      resultado: qaoCalculado,
      pontuacao: pontuarQAO(qaoCalculado),
      editavel: false,
      unidade: "quantidade",
      escalaTexto: "≥7: 0 · 6: 1 · 5: 2 · 4: 3 · ≤3: 4"
    }
  ];

  const gruposOrdem = ["Produtividade", "Custo", "Qualidade"];

  const pontuacaoPorGrupo = {};

  gruposOrdem.forEach((grupo) => {
    const itensGrupo = indicadores.filter((ind) => ind.grupo === grupo);
    const somaPesoInterno = itensGrupo.reduce((total, ind) => total + ind.pesoInterno, 0);

    pontuacaoPorGrupo[grupo] = somaPesoInterno > 0
      ? itensGrupo.reduce((total, ind) => total + (ind.pontuacao * ind.pesoInterno), 0) / somaPesoInterno
      : 0;
  });

  gruposOrdem.forEach((grupo) => {
    const corpo = corposPorGrupo[grupo];
    const itensGrupo = indicadores.filter((ind) => ind.grupo === grupo);

    corpo.innerHTML = itensGrupo.map((ind) => {
      const resultadoTexto = ind.resultado === null
        ? ""
        : ind.unidade === "quantidade"
          ? String(ind.resultado)
          : percentual(ind.resultado);

      const celulaResultado = ind.editavel
        ? `<input
            type="number"
            min="0"
            ${ind.unidade === "quantidade" ? "" : "max=\"100\" step=\"0.1\""}
            class="input-manual-sla"
            data-campo="${ind.id}"
            value="${ind.resultado ?? ""}"
            placeholder="${ind.unidade === "quantidade" ? "Informar qtde." : "Informar %"}"
          >`
        : resultadoTexto;

      return `
        <tr>
          <td>${ind.numero}</td>
          <td><span class="processo-pill">${ind.processo}</span></td>
          <td>${ind.nome}</td>
          <td>${(ind.pesoInterno * 100).toFixed(0)}%</td>
          <td class="celula-metrica">${ind.metrica}</td>
          <td>${celulaResultado}</td>
          <td>${ind.escalaTexto}</td>
          <td class="celula-pontuacao">${ind.pontuacao}</td>
        </tr>
      `;
    }).join("");

    corpo.querySelectorAll(".input-manual-sla").forEach((input) => {
      input.addEventListener("change", (evento) => {
        const campo = evento.target.getAttribute("data-campo");
        const valor = Number(evento.target.value);

        salvarCampoManualSLA(campo, Number.isFinite(valor) ? valor : null);
        atualizarIndicadoresSLA(resumo);
      });
    });

  });

  const pontuacaoFinal = gruposOrdem.reduce(
    (total, grupo) => total + (pontuacaoPorGrupo[grupo] * PESO_GRUPO_SLA[grupo]),
    0
  );

  const percentualFinal = (pontuacaoFinal / 4) * 100;
  const classificacao = classificarSLA(percentualFinal);

  // Percentual atingido de cada grupo (Produtividade/Custo/Qualidade),
  // exibido ao lado direito do respectivo card no Resultado Final.
  const linhaComPercentual = (pontuacaoGrupo) => {
    const percentualGrupo = (pontuacaoGrupo / 4) * 100;
    const corGrupo = classificarSLA(percentualGrupo).cor;

    return `
      <div class="sla-resultado-linha">
        <strong>${pontuacaoGrupo.toFixed(2)} / 4,00</strong>
        <strong class="sla-resultado-percentual" style="color:${corGrupo}">${percentual(percentualGrupo)}</strong>
      </div>
    `;
  };

  resultadoFinal.innerHTML = `
    <div class="sla-resultado-item">
      <span>Produtividade (65%)</span>
      ${linhaComPercentual(pontuacaoPorGrupo.Produtividade)}
    </div>
    <div class="sla-resultado-item">
      <span>Custo (15%)</span>
      ${linhaComPercentual(pontuacaoPorGrupo.Custo)}
    </div>
    <div class="sla-resultado-item">
      <span>Qualidade (20%)</span>
      ${linhaComPercentual(pontuacaoPorGrupo.Qualidade)}
    </div>
    <div class="sla-resultado-item">
      <span>Pontuação Final</span>
      <strong>${pontuacaoFinal.toFixed(2)} / 4,00</strong>
    </div>
    <div class="sla-resultado-item">
      <span>Resultado</span>
      <strong>${percentual(percentualFinal)}</strong>
    </div>
    <div class="sla-resultado-item">
      <span>Classificação</span>
      <strong style="color:${classificacao.cor}">${classificacao.label}</strong>
    </div>
  `;
}

function obterObrasFiltradasSemStatus() {
  const inicio = getValor("filtroInicio");
  const fim = getValor("filtroFim");
  const regional = getValor("filtroRegional");
  const localidade = getValor("filtroLocalidade");

  return obras.filter((obra) => {
    const passaFiltrosBasicos =
      (!regional || obra.regional === regional) &&
      (!localidade || obra.localidade === localidade);

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

// realListaCompleta (opcional) é o histórico INTEIRO de realizados da
// obra, sem o filtro de Ciclo — usado só para decidir o status
// (Em andamento/Paralisada/Concluída). Sem isso, uma obra sem nenhum
// lançamento no ciclo selecionado "sumia" da contagem de Em andamento
// mesmo tendo avanço registrado em ciclos anteriores (o Dashboard,
// que não tem filtro de período, continuava contando ela
// corretamente — daí a divergência entre as duas telas). Os demais
// valores (AFO, IPF, financeiro etc.) continuam refletindo só o
// ciclo selecionado, que é o comportamento esperado pra essa tela.
function montarResumoObras(obrasLista, planLista, realLista, anomLista, realListaCompleta, planListaCompleta) {
  return obrasLista.map((obra) => {
    const nome = obterNomeObra(obra);

    let plan = planLista.filter((item) =>
      item.ativo !== false && pertenceAObra(item, obra)
    );

    let real = realLista.filter((item) => pertenceAObra(item, obra));
    const anom = anomLista.filter((item) => pertenceAObra(item, obra));

    const realParaStatus = realListaCompleta
      ? realListaCompleta.filter((item) => pertenceAObra(item, obra))
      : real;

    // Status (e os totais que o decidem) sempre sobre o histórico completo.
    const fisicoRealTotal = obterValorAcumulado(
      realParaStatus,
      ["fisicoRealAcum", "fisicoAcum", "fisicoRealizadoAcum", "avancoFisicoAcumulado"],
      ["fisicoReal", "avancoFisicoNovo", "avancoFisico"],
      100,
      false,
      false
    );

    const financeiroRealTotal = obterValorAcumulado(
      realParaStatus,
      ["financeiroRealAcum", "financeiroAcum", "financeiroRealAcumulado", "financeiroAcumulado"],
      ["financeiroReal", "valorExecutado", "executado", "investimentoNovo", "custoSemana", "custo", "financeiro"],
      null,
      true,
      false
    );

    const statusCalculado = calcularStatusObraConsolidado(
      obra,
      fisicoRealTotal,
      financeiroRealTotal
    );

    // Obra Concluída mostra os valores finais (histórico completo, igual
    // ao Dashboard), mesmo que tenha sido concluída antes do período
    // filtrado — senão apareceria com físico e executado zerados.
    if (statusCalculado === "Concluído") {
      real = realParaStatus;

      if (planListaCompleta) {
        plan = planListaCompleta.filter((item) =>
          item.ativo !== false && pertenceAObra(item, obra)
        );
      }
    }

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
      100,
      false
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
      100,
      false,
      false
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
      null,
      true
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
      null,
      true,
      false
    );

    const valorTotalObra = obterValorOrcadoObra(obra);

    const financeiroPlanejadoCorrigido =
      normalizarValorPlanejadoOrcado(
        financeiroPlanejado,
        valorTotalObra
      );

    const valorOrcado =
      valorTotalObra > 0
        ? valorTotalObra
        : financeiroPlanejadoCorrigido;

    const saldo = valorOrcado - financeiroReal;

    const fisicoPlanejadoAfo = obterFisicoPlanejadoNaSemanaReal(
      plan,
      real,
      fisicoPlanejado
    );

    const financeiroPlanejadoAteSemanaReal = obterFinanceiroPlanejadoNaSemanaReal(
      plan,
      real,
      financeiroPlanejado
    );

    // Sem limitarPercentual aqui: o Dashboard também não limita a AFO em
    // 100% — uma obra adiantada em relação ao planejado (ex.: 140%)
    // precisa aparecer igual nas duas telas, não ser cortada em 100%.
    const afo = fisicoPlanejadoAfo > 0
      ? (fisicoReal / fisicoPlanejadoAfo) * 100
      : 0;

    const ipf = valorOrcado > 0
      ? (financeiroReal / valorOrcado) * 100
      : 0;

    const anomCriticas = anom.filter((item) => ehCritica(item.criticidade)).length;
    const anomAbertas = anom.filter((item) => ehAberta(item.status)).length;
    const anomVencidas = anom.filter((item) =>
      obterStatusPrazoAnomalia(item) === "vencidas"
    ).length;

    const gutScore = obterGutScoreObra(obra);
    const fatorGut = obterFatorGUT(gutScore);
    const pesoPonderado = obterPesoPonderadoObra(obra, valorOrcado);

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
      financeiroPlanejado: financeiroPlanejadoCorrigido,
      financeiroPlanejadoAteSemanaReal,
      financeiroReal,
      saldo,
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

// somarSemanais controla o que fazer quando NENHUM campo "Acum" existe
// no registro e só sobra o campo semanal: true = trata como incremento
// da semana e SOMA ao longo do tempo (planejamento: cada semana define
// quanto é planejado incrementar); false = trata o próprio campo
// semanal como já sendo o valor acumulado até aquela semana (é o caso
// do realizado — "fisicoReal"/"avancoFisico"/"financeiroReal" já vêm
// prontos como acumulado até a semana, então o valor certo é o da
// semana MAIS RECENTE, nunca a soma de todas — somar inflava o total,
// às vezes passando de 100% e fazendo a obra parecer "Concluída" à toa).
function obterValorAcumulado(
  lista,
  camposAcumulados,
  camposSemanais,
  limitePercentual,
  usarMoeda = false,
  somarSemanais = true
) {
  const ordenados = ordenarItensPorPeriodo(lista);

  let ultimoAcumulado = null;
  let somaSemanal = 0;

  ordenados.forEach((item) => {
    const acumulado = primeiroNumeroValido(item, camposAcumulados, usarMoeda);

    if (acumulado !== null) {
      ultimoAcumulado = acumulado;
      return;
    }

    const semanal = primeiroNumeroValido(item, camposSemanais, usarMoeda);

    if (semanal !== null) {
      if (somarSemanais) {
        somaSemanal += semanal;
        ultimoAcumulado = somaSemanal;
      } else {
        ultimoAcumulado = semanal;
      }
    }
  });

  const valor = ultimoAcumulado ?? somaSemanal;

  if (limitePercentual) {
    return limitarPercentual(valor);
  }

  return usarMoeda
    ? numeroMoedaCadastro(valor)
    : numero(valor);
}

function numeroSemanaItem(item) {
  return parseInt(String(item?.semana || "").replace(/\D/g, "")) || 0;
}

// Alinha o AFO(%) com a mesma lógica do Dashboard: compara o físico
// realizado com o físico PLANEJADO ATÉ A MESMA SEMANA do último
// realizado — não com o último planejamento dentro do período, que
// pode ser de uma semana mais adiantada (planejamento lançado com
// antecedência) e inflar o denominador, derrubando o AFO artificialmente
// em relação ao que o Dashboard mostra.
function obterFisicoPlanejadoNaSemanaReal(plan, real, fisicoPlanejadoFallback) {
  const semanaUltimoReal = numeroSemanaItem(
    ordenarItensPorPeriodo(real).slice(-1)[0]
  );

  if (semanaUltimoReal <= 0) {
    return fisicoPlanejadoFallback;
  }

  const ordenadosPlan = ordenarItensPorPeriodo(plan);

  let ultimoAcumulado = null;
  let somaSemanal = 0;
  let valorNaSemana = null;

  ordenadosPlan.forEach((item) => {
    const acumulado = primeiroNumeroValido(
      item,
      ["fisicoAcum", "fisicoPlanejadoAcum", "fisicoPlanejadoAcumulado", "fisicoAcumulado"],
      false
    );

    if (acumulado !== null) {
      ultimoAcumulado = acumulado;
    } else {
      const semanal = primeiroNumeroValido(item, ["fisico", "fisicoPlanejado", "percentualFisico"], false);

      if (semanal !== null) {
        somaSemanal += semanal;
        ultimoAcumulado = somaSemanal;
      }
    }

    if (numeroSemanaItem(item) === semanaUltimoReal && ultimoAcumulado !== null) {
      valorNaSemana = ultimoAcumulado;
    }
  });

  return valorNaSemana !== null
    ? valorNaSemana
    : fisicoPlanejadoFallback;
}

// Mesma lógica de obterFisicoPlanejadoNaSemanaReal, só que pro
// financeiro: compara o Executado(R$) com o PLANEJADO financeiro até a
// mesma semana do último lançamento real — não com o orçado total, que
// penaliza qualquer obra ainda não concluída só por ainda ter dinheiro
// a gastar no futuro.
function obterFinanceiroPlanejadoNaSemanaReal(plan, real, financeiroPlanejadoFallback) {
  const semanaUltimoReal = numeroSemanaItem(
    ordenarItensPorPeriodo(real).slice(-1)[0]
  );

  if (semanaUltimoReal <= 0) {
    return financeiroPlanejadoFallback;
  }

  const ordenadosPlan = ordenarItensPorPeriodo(plan);

  let ultimoAcumulado = null;
  let somaSemanal = 0;
  let valorNaSemana = null;

  ordenadosPlan.forEach((item) => {
    const acumulado = primeiroNumeroValido(
      item,
      ["financeiroAcum", "financeiroPlanejadoAcum", "financeiroPlanejadoAcumulado", "financeiroAcumulado"],
      true
    );

    if (acumulado !== null) {
      ultimoAcumulado = acumulado;
    } else {
      const semanal = primeiroNumeroValido(item, ["financeiro", "financeiroPlanejado", "valorPlanejado"], true);

      if (semanal !== null) {
        somaSemanal += semanal;
        ultimoAcumulado = somaSemanal;
      }
    }

    if (numeroSemanaItem(item) === semanaUltimoReal && ultimoAcumulado !== null) {
      valorNaSemana = ultimoAcumulado;
    }
  });

  return valorNaSemana !== null
    ? numeroMoedaCadastro(valorNaSemana)
    : financeiroPlanejadoFallback;
}

/* =========================================
   ANOMALIAS
========================================= */

// Renderiza as LINHAS da tabela de anomalias (compartilhado entre a
// visão "todas as obras" e a visão de uma obra específica) — cada
// anomalia já precisa vir com "nomeObraExibicao" preenchido.
// Tela apenas de VISUALIZAÇÃO: sem coluna de edição de status, sem
// Ação Corretiva e sem coluna de Ação.
function renderizarLinhasAnomalias(lista) {
  const tbody = document.getElementById("tabelaDescricaoAnomalias");

  if (!tbody) {
    return;
  }

  if (lista.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="10">Nenhuma anomalia registrada.</td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = lista.map((anomalia) => {
    const vencida = obterStatusPrazoAnomalia(anomalia) === "vencidas";

    return `
      <tr>
        <td>${textoSeguro(anomalia.nomeObraExibicao || "-")}</td>
        <td>${formatarDataTabela(anomalia.data)}</td>
        <td>${textoSeguro(anomalia.semana || "-")}</td>
        <td>${textoSeguro(anomalia.tipo || "-")}</td>
        <td>${textoSeguro(anomalia.criticidade || "-")}</td>
        <td>${textoSeguro(anomalia.impacto || "-")}</td>
        <td>
          <span class="status-anomalia-pill ${vencida ? "anomalia-vencida" : classeStatusAnomalia(anomalia.status)}">
            ${vencida ? "Vencida" : textoSeguro(anomalia.status || "Aberta")}
          </span>
        </td>
        <td>${formatarPrazo(anomalia.prazoTratativa)}</td>
        <td>${textoSeguro(anomalia.responsabilidade || "-")}</td>
        <td>${textoSeguro(anomalia.descricao || "-")}</td>
      </tr>
    `;
  }).join("");
}

// TODAS as anomalias das obras filtradas aparecem aqui de uma vez,
// sem precisar selecionar nenhuma obra.
function renderizarTodasAnomalias(resumo) {
  const resumoElemento = document.getElementById("anomaliasObraSelecionada");

  const listaCompleta = resumo.flatMap((item) =>
    (item.anomaliasLista || []).map((anomalia) => ({
      ...anomalia,
      nomeObraExibicao: item.nome
    }))
  );

  // Só é contabilizada e imputada à Contratada a anomalia com prazo de
  // resolução VENCIDO e cuja responsabilidade pela tratativa seja dela
  // — as demais (no prazo, de responsabilidade da Vale ou já
  // resolvidas) não entram nem na tabela nem nas contagens abaixo.
  const lista = listaCompleta.filter((anomalia) =>
    anomalia.responsabilidade === "Contratada" &&
    obterStatusPrazoAnomalia(anomalia) === "vencidas"
  );

  // Todo item de "lista" já é vencido por definição do filtro acima,
  // então só falta contar quantos são críticos.
  const totalCriticas = lista.filter((anomalia) => ehCritica(anomalia.criticidade)).length;

  if (resumoElemento) {
    resumoElemento.className = "anomalias-obra-resumo";
    resumoElemento.innerHTML = `
      <strong>Todas as obras (${resumo.length})</strong>
      <span>
        ${lista.length} anomalia(s) vencida(s) | ${totalCriticas} crítica(s)
      </span>
    `;
  }

  renderizarLinhasAnomalias(lista);
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
  const camposTextoDashboard = [
    obra.valorObra,
    obra.valorOrcado,
    obra.valorOrçado,
    obra.investimento,
    obra.valorInvestimento,
    obra.orcamento,
    obra.orçamento,
    obra.orcado,
    obra.orçado,
    obra.valorTotal,
    obra.custoTotal,
    obra.custoOrcado,
    obra.orcadoTotal,
    obra.orcamentoTotal,
    obra.orçamentoTotal,
    obra.investimentoTotal
  ];

  for (const valor of camposTextoDashboard) {
    if (typeof valor !== "string") {
      continue;
    }

    const convertido = numeroMoedaCadastro(valor);

    if (convertido > 0) {
      return convertido;
    }
  }

  const camposNumericos = [
    obra.valorObraNumero,
    obra.valorObraNumerico,
    obra.valorOrcadoNumero,
    obra.valorOrçadoNumero,
    obra.investimentoNumero,
    obra.investimentoTotalNumero,
    obra.valorInvestimentoNumero,
    obra.orcamentoNumero,
    obra.orçamentoNumero,
    obra.orcadoNumero,
    obra.orçadoNumero,
    obra.valorTotalNumero,
    obra.valorTotalNumerico,
    obra.custoTotalNumero,
    obra.custoOrcadoNumero,
    obra.valorObra,
    obra.valorOrcado,
    obra.valorOrçado,
    obra.investimento,
    obra.valorInvestimento,
    obra.orcamento,
    obra.orçamento,
    obra.orcado,
    obra.orçado,
    obra.valorTotal,
    obra.custoTotal,
    obra.custoOrcado,
    obra.orcadoTotal,
    obra.orcamentoTotal,
    obra.orçamentoTotal,
    obra.investimentoTotal
  ];

  for (const valor of camposNumericos) {
    const convertido = numeroMoedaCadastro(valor);

    if (convertido > 0) {
      return convertido;
    }
  }

  return 0;
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
   PERÍODO E ORDENAÇÃO
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
   MATEMÁTICA
========================================= */

function soma(lista, campo) {
  return lista.reduce((total, item) => total + numero(item[campo]), 0);
}

function numero(valor) {
  if (valor === null || valor === undefined || valor === "") {
    return 0;
  }

  if (typeof valor === "number") {
    return Number.isFinite(valor) ? valor : 0;
  }

  let texto = String(valor)
    .trim()
    .replace(/R\$/gi, "")
    .replace(/%/g, "")
    .replace(/\s/g, "")
    .replace(/[^\d,.-]/g, "");

  if (!texto) {
    return 0;
  }

  const negativo = texto.startsWith("-");

  texto = texto.replace(/^-/, "");

  const temVirgula = texto.includes(",");
  const temPonto = texto.includes(".");

  if (temVirgula && temPonto) {
    const ultimaVirgula = texto.lastIndexOf(",");
    const ultimoPonto = texto.lastIndexOf(".");

    if (ultimaVirgula > ultimoPonto) {
      texto = texto.replace(/\./g, "").replace(",", ".");
    } else {
      texto = texto.replace(/,/g, "");
    }
  } else if (temVirgula) {
    const partes = texto.split(",");

    if (partes.length === 2 && partes[1].length <= 2) {
      texto = partes[0].replace(/\./g, "") + "." + partes[1];
    } else {
      texto = texto.replace(/,/g, "");
    }
  } else if (temPonto) {
    const partes = texto.split(".");

    if (partes.length > 2) {
      const ultimaParte = partes.pop();

      if (ultimaParte.length <= 2) {
        texto = partes.join("") + "." + ultimaParte;
      } else {
        texto = partes.join("") + ultimaParte;
      }
    } else if (partes.length === 2) {
      if (partes[1].length <= 2) {
        texto = partes[0] + "." + partes[1];
      } else {
        texto = partes.join("");
      }
    }
  }

  const convertido = Number(
    negativo ? `-${texto}` : texto
  );

  return Number.isFinite(convertido) ? convertido : 0;
}

function numeroMoedaCadastro(valor) {
  if (valor === null || valor === undefined || valor === "") {
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

  const textoOriginal = String(valor).trim();

  if (!textoOriginal) {
    return 0;
  }

  const textoLimpo = textoOriginal
    .replace(/R\$/gi, "")
    .replace(/%/g, "")
    .replace(/\s/g, "")
    .replace(/[^\d,.-]/g, "");

  if (!textoLimpo) {
    return 0;
  }

  const possuiVirgula = textoLimpo.includes(",");
  const possuiPonto = textoLimpo.includes(".");
  const somenteNumeros = textoLimpo.replace(/\D/g, "");

  let convertido = 0;

  if (possuiVirgula) {
    convertido = Number(
      textoLimpo
        .replace(/\./g, "")
        .replace(",", ".")
    );
  } else {
    convertido = Number(
      textoLimpo.replace(/,/g, "")
    );
  }

  if (!Number.isFinite(convertido) || convertido <= 0) {
    return 0;
  }

  if (
    !possuiVirgula &&
    !possuiPonto &&
    somenteNumeros.length >= 8 &&
    convertido >= 10000000
  ) {
    return convertido / 100;
  }

  if (
    !possuiVirgula &&
    possuiPonto
  ) {
    const partes = textoLimpo.split(".");
    const parteInteira = partes[0] || "";
    const parteDecimal = partes[1] || "";

    if (
      parteInteira.length >= 8 &&
      parteDecimal === "00" &&
      convertido >= 10000000
    ) {
      return convertido / 100;
    }
  }

  if (
    possuiVirgula &&
    possuiPonto &&
    convertido >= 100000000
  ) {
    return convertido / 100;
  }

  return convertido;
}

function normalizarValorPlanejadoOrcado(valorPlanejado, valorObraReferencia = 0) {
  let valor = numeroMoedaCadastro(valorPlanejado);

  if (valor <= 0) {
    return 0;
  }

  if (
    valorObraReferencia > 0 &&
    valor > valorObraReferencia * 50
  ) {
    valor = valor / 100;
  }

  return valor;
}

function primeiroNumeroValido(objeto, campos, usarMoeda = false) {
  for (const campo of campos) {
    if (
      objeto[campo] !== undefined &&
      objeto[campo] !== null &&
      objeto[campo] !== ""
    ) {
      return usarMoeda
        ? numeroMoedaCadastro(objeto[campo])
        : numero(objeto[campo]);
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

/* =========================================
   CLASSES E STATUS
========================================= */

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
   DOM / TEXTO
========================================= */

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

