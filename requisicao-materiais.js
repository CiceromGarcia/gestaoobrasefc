/* =====================================================
   REQUISIÇÃO DE MATERIAIS
   Arquivo: requisicao-materiais.js
   Versão: v014

   Correções v014:
   - Corrigida leitura completa da descrição do material.
   - Agora o sistema lê também descrições quebradas antes/depois da linha do item.
   - Criada leitura por posição das colunas do PDF.
   - Mantida leitura textual como alternativa.
   - Mantidos Contrato obrigatório, filtros por data e exportação PDF.
===================================================== */

import { db } from "./firebaseConfig.js";

import { protegerPagina } from "./authGuard.js";

import {
  collection,
  addDoc,
  getDocs,
  query,
  where,
  doc,
  updateDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.3/firebase-firestore.js";

/* =====================================================
   PDF.JS
===================================================== */

const pdfjsLibGlobal = window.pdfjsLib;

if (pdfjsLibGlobal) {
  pdfjsLibGlobal.GlobalWorkerOptions.workerSrc =
    "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
}

/* =====================================================
   ESTADO GLOBAL
===================================================== */

let usuarioLogadoGlobal = null;
let arquivoSelecionado = null;
let textoExtraidoCompleto = "";
let paginasTextoExtraido = [];
let linhasPDFEstruturadas = [];
let materiaisExtraidos = [];
let totalPaginasPDF = 0;
let rmsCadastradas = [];
let rmsJaCarregadas = false;
let rmSelecionadaParaReprovar = null;
let rmAprovacaoDetalhadaId = null;

/* =====================================================
   CONFIGURAÇÕES
===================================================== */

const COLECAO_RMS = "requisicoes_materiais";

const EMAILS_ADMIN_GERAL = new Set([
  "cicero.garcia@vale.com",
  "c0706341@vale.com",
  "ciceromgarcia@gmail.com"
]);

const CONTRATOS_VALIDOS = [
  "Manutenção Predial",
  "Pequenas Obras"
];

const LOCALIDADES_POR_REGIONAL = {
  "Regional 1": [
    "Arari",
    "Vitória do Mearim",
    "Santa Inês",
    "Alto Alegre do Pindaré",
    "Altamira",
    "Auzilândia",
    "Vila Pindaré",
    "Mineirinho"
  ],

  "Regional 2": [
    "Açailândia",
    "Nova Vida"
  ],

  "Regional 3": [
    "Marabá",
    "Itainópolis",
    "São Pedro d’Água Branca"
  ],

  "São Luís": [
    "São Luís"
  ]
};

const REGEX_UNIDADES_MATERIAL =
  /(Pe[çc]a|Peca|Pe[çc]as|Pecas|PÇ|PC|Unidade|Unidades|Unid\.?|UND|und|UN|Kg|KG|kg|Quilo|Quilos|m²|M²|m2|M2|m³|M³|m3|M3|Metro|Metros|M|Lata|Latas|LT|Litro|Litros|L|Caixa|Caixas|CX|Rolo|Rolos|Saco|Sacos|Barra|Barras|Par|Pares|Conjunto|CJ|Balde|Baldes|Gal[aã]o|Gal[õo]es|Galao|Galoes|Verba)/i;

/* =====================================================
   INICIALIZAÇÃO
===================================================== */

document.addEventListener("DOMContentLoaded", async () => {
  try {
    usuarioLogadoGlobal = await protegerPagina();

    configurarEventos();
    configurarAbas();
    preencherLocalidades();
    preencherDataAtual();
    renderizarTabelaMateriais();
    atualizarResumoCadastro();
    atualizarVisaoUsuario();
    configurarVisibilidadeAprovacoes();

    atualizarStatusTela(
      "Aguardando PDF",
      "Importe um arquivo para iniciar",
      "pendente"
    );

    adicionarLog(
      "info",
      "Tela de Requisição de Materiais carregada com sucesso."
    );

    await carregarRMsCadastradas();
  } catch (error) {
    console.error("Erro ao iniciar tela de requisição de materiais:", error);
    alert("Erro ao iniciar a tela. Verifique o login e as permissões.");
  }
});

/* =====================================================
   PERMISSÕES
===================================================== */

function obterEmailUsuario() {
  return String(
    usuarioLogadoGlobal?.email ||
    usuarioLogadoGlobal?.emailAuth ||
    usuarioLogadoGlobal?.user?.email ||
    ""
  )
    .trim()
    .toLowerCase();
}

function obterUidUsuario() {
  return String(
    usuarioLogadoGlobal?.uid ||
    usuarioLogadoGlobal?.id ||
    usuarioLogadoGlobal?.user?.uid ||
    ""
  ).trim();
}

function obterNomeUsuario() {
  return String(
    usuarioLogadoGlobal?.nome ||
    usuarioLogadoGlobal?.displayName ||
    usuarioLogadoGlobal?.name ||
    ""
  ).trim();
}

function obterPerfilUsuario() {
  return String(
    usuarioLogadoGlobal?.perfil ||
    usuarioLogadoGlobal?.role ||
    usuarioLogadoGlobal?.tipo ||
    usuarioLogadoGlobal?.nivel ||
    usuarioLogadoGlobal?.nivelAcesso ||
    ""
  ).trim();
}

function obterRegionalUsuario() {
  return String(
    usuarioLogadoGlobal?.regional ||
    usuarioLogadoGlobal?.regionalUsuario ||
    usuarioLogadoGlobal?.regionalAtuacao ||
    usuarioLogadoGlobal?.regionalResponsavel ||
    ""
  ).trim();
}

function usuarioEhAdminGeral() {
  const email = obterEmailUsuario();
  const perfil = normalizarTexto(obterPerfilUsuario());

  return (
    EMAILS_ADMIN_GERAL.has(email) ||
    perfil === "administrador" ||
    perfil === "admin" ||
    perfil === "adm" ||
    perfil === "administrator" ||
    usuarioLogadoGlobal?.admin === true ||
    usuarioLogadoGlobal?.isAdmin === true
  );
}

function usuarioEhAdminRegional() {
  const perfil = normalizarTexto(obterPerfilUsuario());

  return (
    perfil === "administradorregional" ||
    perfil === "administrador regional" ||
    perfil === "adminregional" ||
    perfil === "admin regional" ||
    perfil === "aprovadorrm" ||
    perfil === "aprovador rm" ||
    usuarioLogadoGlobal?.podeAprovarRM === true ||
    usuarioLogadoGlobal?.aprovadorRM === true
  );
}

function usuarioPodeAprovarRM() {
  return usuarioEhAdminGeral() || usuarioEhAdminRegional();
}

function usuarioPodeAprovarRegional(regionalRM) {
  if (usuarioEhAdminGeral()) {
    return true;
  }

  if (!usuarioEhAdminRegional()) {
    return false;
  }

  const regionalUsuario = normalizarTexto(obterRegionalUsuario());
  const regionalDaRM = normalizarTexto(regionalRM);

  if (!regionalUsuario || !regionalDaRM) {
    return false;
  }

  return regionalUsuario === regionalDaRM;
}

function atualizarVisaoUsuario() {
  const titulo = document.getElementById("tituloVisaoUsuario");
  const descricao = document.getElementById("descricaoVisaoUsuario");
  const resumoVisao = document.getElementById("resumoUsuarioVisao");

  if (usuarioEhAdminGeral()) {
    setTextoElemento(titulo, "Visão de Administrador Geral");

    setTextoElemento(
      descricao,
      "Você tem acesso a todas as RMs, aprovações, custos por Regional e produtos aprovados."
    );

    setTextoElemento(resumoVisao, "Todas as RMs");
    return;
  }

  if (usuarioEhAdminRegional()) {
    const regional = obterRegionalUsuario() || "Regional não definida";

    setTextoElemento(titulo, "Visão de Administrador Regional");

    setTextoElemento(
      descricao,
      `Você aprova RMs da ${regional} e visualiza as RMs da sua área de aprovação.`
    );

    setTextoElemento(resumoVisao, regional);
    return;
  }

  const email = obterEmailUsuario();

  setTextoElemento(titulo, "Visão do Usuário");

  setTextoElemento(
    descricao,
    `Você visualiza apenas as RMs cadastradas pelo seu usuário${email ? ` (${email})` : ""}.`
  );

  setTextoElemento(resumoVisao, "Minhas RMs");
}

function configurarVisibilidadeAprovacoes() {
  const podeAprovar = usuarioPodeAprovarRM();

  document.body.classList.toggle(
    "usuario-aprovador-rm",
    podeAprovar
  );

  document
    .querySelectorAll("[data-aprovacao-only]")
    .forEach((elemento) => {
      elemento.style.display = podeAprovar ? "" : "none";
    });
}

/* =====================================================
   ABAS
===================================================== */

function configurarAbas() {
  document
    .querySelectorAll(".aba-btn")
    .forEach((botao) => {
      botao.addEventListener("click", () => {
        abrirAba(botao.dataset.aba);
      });
    });
}

function abrirAba(aba) {
  if (aba === "aprovacoes" && !usuarioPodeAprovarRM()) {
    alert("Você não possui permissão para acessar a aba de aprovações.");
    aba = "cadastradas";
  }

  const mapa = {
    cadastro: "abaCadastro",
    cadastradas: "abaCadastradas",
    custos: "abaCustos",
    produtos: "abaProdutos",
    aprovacoes: "abaAprovacoes"
  };

  document
    .querySelectorAll(".aba-btn")
    .forEach((botao) => {
      botao.classList.toggle(
        "ativa",
        botao.dataset.aba === aba
      );
    });

  document
    .querySelectorAll(".aba-conteudo")
    .forEach((conteudo) => {
      conteudo.classList.remove("ativa");
      conteudo.style.display = "none";
    });

  const abaSelecionada = document.getElementById(
    mapa[aba] || "abaCadastro"
  );

  if (abaSelecionada) {
    abaSelecionada.classList.add("ativa");
    abaSelecionada.style.display = "block";
  }

  if (
    aba === "cadastradas" ||
    aba === "custos" ||
    aba === "produtos" ||
    aba === "aprovacoes"
  ) {
    if (!rmsJaCarregadas) {
      carregarRMsCadastradas();
    } else {
      renderizarTodasAsVisoes();
    }
  }
}

/* =====================================================
   EVENTOS
===================================================== */

function configurarEventos() {
  const btnSelecionarPDF = document.getElementById("btnSelecionarPDF");
  const arquivoPDF = document.getElementById("arquivoPDF");
  const dropZonePDF = document.getElementById("dropZonePDF");
  const btnLerPDF = document.getElementById("btnLerPDF");
  const btnLimparPDF = document.getElementById("btnLimparPDF");
  const btnAdicionarMaterial = document.getElementById("btnAdicionarMaterial");
  const btnLimparMateriais = document.getElementById("btnLimparMateriais");
  const btnSalvarRequisicao = document.getElementById("btnSalvarRequisicao");
  const regional = document.getElementById("regional");
  const localidade = document.getElementById("localidade");
  const numeroRM = document.getElementById("numeroRM");
  const btnFecharModal = document.getElementById("btnFecharModal");
  const btnCancelarSalvar = document.getElementById("btnCancelarSalvar");
  const btnConfirmarSalvar = document.getElementById("btnConfirmarSalvar");
  const btnAtualizarListaRMs = document.getElementById("btnAtualizarListaRMs");
  const btnExportarRMsPDF = document.getElementById("btnExportarRMsPDF");
  const filtroBuscaRM = document.getElementById("filtroBuscaRM");
  const filtroRegionalRM = document.getElementById("filtroRegionalRM");
  const filtroStatusAprovacaoRM = document.getElementById("filtroStatusAprovacaoRM");
  const filtroDataInicioRM = document.getElementById("filtroDataInicioRM");
  const filtroDataFimRM = document.getElementById("filtroDataFimRM");
  const btnAtualizarProdutos = document.getElementById("btnAtualizarProdutos");
  const filtroBuscaProduto = document.getElementById("filtroBuscaProduto");
  const filtroRegionalProduto = document.getElementById("filtroRegionalProduto");
  const filtroOrdenacaoProduto = document.getElementById("filtroOrdenacaoProduto");
  const btnAtualizarAprovacoes = document.getElementById("btnAtualizarAprovacoes");
  const filtroBuscaAprovacao = document.getElementById("filtroBuscaAprovacao");
  const filtroRegionalAprovacao = document.getElementById("filtroRegionalAprovacao");
  const filtroStatusAprovacao = document.getElementById("filtroStatusAprovacao");
  const btnFecharModalReprovar = document.getElementById("btnFecharModalReprovar");
  const btnCancelarReprovar = document.getElementById("btnCancelarReprovar");
  const btnConfirmarReprovar = document.getElementById("btnConfirmarReprovar");

  btnSelecionarPDF?.addEventListener("click", () => arquivoPDF?.click());

  arquivoPDF?.addEventListener("change", (event) => {
    selecionarArquivoPDF(event.target.files?.[0]);
  });

  dropZonePDF?.addEventListener("dragover", (event) => {
    event.preventDefault();
    dropZonePDF.classList.add("dragover");
  });

  dropZonePDF?.addEventListener("dragleave", () => {
    dropZonePDF.classList.remove("dragover");
  });

  dropZonePDF?.addEventListener("drop", (event) => {
    event.preventDefault();
    dropZonePDF.classList.remove("dragover");
    selecionarArquivoPDF(event.dataTransfer.files?.[0]);
  });

  btnLerPDF?.addEventListener("click", lerPDFSelecionado);
  btnLimparPDF?.addEventListener("click", limparTudo);
  btnAdicionarMaterial?.addEventListener("click", adicionarMaterialManual);
  btnLimparMateriais?.addEventListener("click", limparMateriais);
  btnSalvarRequisicao?.addEventListener("click", abrirModalConfirmacao);
  btnFecharModal?.addEventListener("click", fecharModalConfirmacao);
  btnCancelarSalvar?.addEventListener("click", fecharModalConfirmacao);
  btnConfirmarSalvar?.addEventListener("click", salvarRequisicao);
  btnAtualizarListaRMs?.addEventListener("click", carregarRMsCadastradas);
  btnExportarRMsPDF?.addEventListener("click", exportarRMsPDF);

  filtroBuscaRM?.addEventListener("input", renderizarRMsCadastradas);
  filtroRegionalRM?.addEventListener("change", renderizarRMsCadastradas);
  filtroStatusAprovacaoRM?.addEventListener("change", renderizarRMsCadastradas);
  filtroDataInicioRM?.addEventListener("change", renderizarRMsCadastradas);
  filtroDataFimRM?.addEventListener("change", renderizarRMsCadastradas);

  btnAtualizarProdutos?.addEventListener("click", carregarRMsCadastradas);
  filtroBuscaProduto?.addEventListener("input", renderizarProdutosMaisSaida);
  filtroRegionalProduto?.addEventListener("change", renderizarProdutosMaisSaida);
  filtroOrdenacaoProduto?.addEventListener("change", renderizarProdutosMaisSaida);

  btnAtualizarAprovacoes?.addEventListener("click", carregarRMsCadastradas);
  filtroBuscaAprovacao?.addEventListener("input", renderizarAprovacoes);
  filtroRegionalAprovacao?.addEventListener("change", renderizarAprovacoes);
  filtroStatusAprovacao?.addEventListener("change", renderizarAprovacoes);

  btnFecharModalReprovar?.addEventListener("click", fecharModalReprovarRM);
  btnCancelarReprovar?.addEventListener("click", fecharModalReprovarRM);
  btnConfirmarReprovar?.addEventListener("click", confirmarReprovacaoRM);

  regional?.addEventListener("change", () => {
    preencherLocalidades(regional.value);
  });

  localidade?.addEventListener("change", () => {
    preencherRegionalPelaLocalidade(localidade.value);
  });

  numeroRM?.addEventListener("input", () => {
    setTexto("resumoRM", numeroRM.value || "-");
  });
}

/* =====================================================
   CARREGAMENTO DAS RMs
===================================================== */

async function carregarRMsCadastradas() {
  atualizarTabelasCarregando();

  try {
    const mapa = new Map();
    const ref = collection(db, COLECAO_RMS);

    if (usuarioEhAdminGeral()) {
      const snapshot = await getDocs(ref);

      snapshot.forEach((docItem) => {
        mapa.set(docItem.id, {
          id: docItem.id,
          ...docItem.data()
        });
      });
    } else if (usuarioEhAdminRegional()) {
      const regionalUsuario = obterRegionalUsuario();

      if (regionalUsuario) {
        await adicionarResultadosConsultaNoMapa(
          mapa,
          query(ref, where("regional", "==", regionalUsuario))
        );
      }

      await carregarMinhasRMsNoMapa(mapa, ref);
    } else {
      await carregarMinhasRMsNoMapa(mapa, ref);
    }

    rmsCadastradas = Array.from(mapa.values())
      .sort(ordenarRMDecrescente);

    rmsJaCarregadas = true;

    atualizarVisaoUsuario();
    configurarVisibilidadeAprovacoes();
    renderizarTodasAsVisoes();
  } catch (error) {
    console.error("Erro ao carregar RMs cadastradas:", error);

    mostrarErroTabelas(
      "Erro ao carregar RMs. Verifique suas permissões no Firestore."
    );
  }
}

async function adicionarResultadosConsultaNoMapa(mapa, consulta) {
  try {
    const snapshot = await getDocs(consulta);

    snapshot.forEach((docItem) => {
      mapa.set(docItem.id, {
        id: docItem.id,
        ...docItem.data()
      });
    });
  } catch (error) {
    console.warn("Consulta ignorada por permissão/índice:", error);
  }
}

async function carregarMinhasRMsNoMapa(mapa, ref) {
  const uid = obterUidUsuario();
  const email = obterEmailUsuario();

  if (uid) {
    await adicionarResultadosConsultaNoMapa(
      mapa,
      query(ref, where("criadoPorUid", "==", uid))
    );

    await adicionarResultadosConsultaNoMapa(
      mapa,
      query(ref, where("criadoPor.uid", "==", uid))
    );
  }

  if (email) {
    await adicionarResultadosConsultaNoMapa(
      mapa,
      query(ref, where("criadoPorEmail", "==", email))
    );

    await adicionarResultadosConsultaNoMapa(
      mapa,
      query(ref, where("criadoPor.email", "==", email))
    );
  }
}

function ordenarRMDecrescente(a, b) {
  const dataA = obterDataPeriodoRM(a) || obterDataCriacaoRM(a);
  const dataB = obterDataPeriodoRM(b) || obterDataCriacaoRM(b);

  return (dataB?.getTime() || 0) - (dataA?.getTime() || 0);
}

function atualizarTabelasCarregando() {
  setTabelaMensagem("tbodyRMsCadastradas", 13, "Carregando RMs cadastradas...");
  setTabelaMensagem("tbodyCustosRegional", 5, "Carregando custos por regional...");
  setTabelaMensagem("tbodyProdutosMaisSaida", 9, "Carregando produtos com mais saída...");
  setTabelaMensagem("tbodyAprovacoes", 13, "Carregando aprovações...");
}

function mostrarErroTabelas(mensagem) {
  setTabelaMensagem("tbodyRMsCadastradas", 13, mensagem);
  setTabelaMensagem("tbodyCustosRegional", 5, mensagem);
  setTabelaMensagem("tbodyProdutosMaisSaida", 9, mensagem);
  setTabelaMensagem("tbodyAprovacoes", 13, mensagem);
}

function setTabelaMensagem(tbodyId, colunas, mensagem) {
  const tbody = document.getElementById(tbodyId);

  if (!tbody) {
    return;
  }

  tbody.innerHTML = `
    <tr>
      <td colspan="${colunas}">
        ${escaparHTML(mensagem)}
      </td>
    </tr>
  `;
}

function renderizarTodasAsVisoes() {
  renderizarRMsCadastradas();
  renderizarCustosPorRegional();
  renderizarProdutosMaisSaida();
  renderizarAprovacoes();
}

/* =====================================================
   STATUS DE APROVAÇÃO
===================================================== */

function normalizarStatusAprovacao(valor) {
  const texto = normalizarTexto(valor);

  if (texto.includes("aprovada") || texto === "aprovado") {
    return "Aprovada";
  }

  if (texto.includes("reprovada") || texto === "reprovado") {
    return "Reprovada";
  }

  return "Pendente de Aprovação";
}

function obterStatusAprovacaoRM(item) {
  if (item?.statusAprovacao) {
    return normalizarStatusAprovacao(item.statusAprovacao);
  }

  if (item?.aplicada === true) {
    return "Aprovada";
  }

  if (item?.status) {
    return normalizarStatusAprovacao(item.status);
  }

  return "Pendente de Aprovação";
}

function rmEstaAprovada(item) {
  return obterStatusAprovacaoRM(item) === "Aprovada";
}

function rmEstaPendente(item) {
  return obterStatusAprovacaoRM(item) === "Pendente de Aprovação";
}

function rmEstaReprovada(item) {
  return obterStatusAprovacaoRM(item) === "Reprovada";
}

function classeStatusAprovacao(status) {
  const texto = normalizarTexto(status);

  if (texto.includes("aprovada")) {
    return "aprovada";
  }

  if (texto.includes("reprovada")) {
    return "reprovada";
  }

  return "pendente";
}

function htmlBadgeAprovacao(status) {
  return `
    <span class="badge-aprovacao ${classeStatusAprovacao(status)}">
      ${escaparHTML(status)}
    </span>
  `;
}

/* =====================================================
   TEMPO / DATAS
===================================================== */

function obterDataCriacaoRM(item) {
  return dataFirestoreParaDate(
    item?.criadoEm ||
    item?.enviadoParaAprovacaoEm ||
    item?.dataCriacao ||
    item?.dataRequisicao ||
    item?.atualizadoEm
  );
}

function obterDataPeriodoRM(item) {
  return dataFirestoreParaDate(
    item?.dataRequisicao ||
    item?.dataRM ||
    item?.periodoRM ||
    item?.criadoEm
  );
}

function obterDataDecisaoRM(item) {
  return dataFirestoreParaDate(
    item?.aprovadoEm ||
    item?.reprovadoEm ||
    item?.decididoEm ||
    item?.dataAprovacao ||
    item?.dataReprovacao
  );
}

function calcularTempoMsAteDecisao(item) {
  if (
    item?.tempoAprovacaoMs !== undefined &&
    Number(item.tempoAprovacaoMs) > 0
  ) {
    return Number(item.tempoAprovacaoMs);
  }

  if (
    item?.tempoDecisaoMs !== undefined &&
    Number(item.tempoDecisaoMs) > 0
  ) {
    return Number(item.tempoDecisaoMs);
  }

  const inicio = obterDataCriacaoRM(item);
  const fim = obterDataDecisaoRM(item);

  if (!inicio || !fim) {
    return 0;
  }

  return Math.max(0, fim.getTime() - inicio.getTime());
}

function calcularTempoMsEmAberto(item) {
  const inicio = obterDataCriacaoRM(item);

  if (!inicio) {
    return 0;
  }

  return Math.max(0, Date.now() - inicio.getTime());
}

function formatarDuracao(ms) {
  const totalMinutos = Math.floor(Number(ms || 0) / 60000);

  if (totalMinutos <= 0) {
    return "menos de 1 min";
  }

  const dias = Math.floor(totalMinutos / 1440);
  const horas = Math.floor((totalMinutos % 1440) / 60);
  const minutos = totalMinutos % 60;
  const partes = [];

  if (dias > 0) {
    partes.push(`${dias}d`);
  }

  if (horas > 0) {
    partes.push(`${horas}h`);
  }

  if (minutos > 0 && dias === 0) {
    partes.push(`${minutos}min`);
  }

  return partes.join(" ") || "menos de 1 min";
}

function obterTextoTempoAteAprovacao(item) {
  const status = obterStatusAprovacaoRM(item);

  if (status === "Pendente de Aprovação") {
    return "-";
  }

  const ms = calcularTempoMsAteDecisao(item);

  if (ms <= 0) {
    return "-";
  }

  return item?.tempoAprovacaoTexto ||
    item?.tempoDecisaoTexto ||
    formatarDuracao(ms);
}

function obterTextoTempoEmAberto(item) {
  if (!rmEstaPendente(item)) {
    const ms = calcularTempoMsAteDecisao(item);
    return ms > 0 ? formatarDuracao(ms) : "-";
  }

  const ms = calcularTempoMsEmAberto(item);
  return ms > 0 ? formatarDuracao(ms) : "-";
}

function calcularTempoMedioAprovacao(lista) {
  const tempos = lista
    .filter(rmEstaAprovada)
    .map(calcularTempoMsAteDecisao)
    .filter((valor) => valor > 0);

  if (!tempos.length) {
    return "-";
  }

  const media = tempos.reduce((total, valor) => total + valor, 0) / tempos.length;
  return formatarDuracao(media);
}

/* =====================================================
   RMs CADASTRADAS
===================================================== */

function obterContratoRM(item) {
  return String(
    item?.contrato ||
    item?.tipoCadastro ||
    ""
  ).trim();
}

function filtrarRMsCadastradas() {
  const busca = normalizarTexto(getValor("filtroBuscaRM"));
  const regional = getValor("filtroRegionalRM");
  const statusFiltro = getValor("filtroStatusAprovacaoRM");

  const dataInicio = dataInputParaDate(
    getValor("filtroDataInicioRM"),
    false
  );

  const dataFim = dataInputParaDate(
    getValor("filtroDataFimRM"),
    true
  );

  return rmsCadastradas.filter((item) => {
    if (regional && String(item.regional || "") !== regional) {
      return false;
    }

    if (statusFiltro && obterStatusAprovacaoRM(item) !== statusFiltro) {
      return false;
    }

    const dataRM = obterDataPeriodoRM(item);

    if (dataInicio && dataRM && dataRM < dataInicio) {
      return false;
    }

    if (dataFim && dataRM && dataRM > dataFim) {
      return false;
    }

    if ((dataInicio || dataFim) && !dataRM) {
      return false;
    }

    if (!busca) {
      return true;
    }

    const textoBusca = normalizarTexto(
      [
        item.numeroRM,
        item.numeroOM,
        item.titulo,
        obterContratoRM(item),
        item.regional,
        item.localidade,
        item.centroCusto,
        item.localRM,
        item.solicitante,
        item.criadoPor?.nome,
        item.criadoPor?.email
      ].join(" ")
    );

    return textoBusca.includes(busca);
  });
}

function renderizarRMsCadastradas() {
  const tbody = document.getElementById("tbodyRMsCadastradas");

  if (!tbody) {
    return;
  }

  const lista = filtrarRMsCadastradas();

  atualizarResumoRMs(lista);

  tbody.innerHTML = "";

  if (!lista.length) {
    setTabelaMensagem(
      "tbodyRMsCadastradas",
      13,
      "Nenhuma RM encontrada para sua visão de acesso."
    );

    return;
  }

  lista.forEach((item) => {
    const materiais = Array.isArray(item.materiais)
      ? item.materiais
      : [];

    const status = obterStatusAprovacaoRM(item);
    const contrato = obterContratoRM(item) || "-";

    const tr = document.createElement("tr");

    tr.innerHTML = `
      <td>
        <strong>${escaparHTML(item.numeroRM || "-")}</strong>
      </td>

      <td>
        ${escaparHTML(item.numeroOM || "-")}
      </td>

      <td>
        ${formatarDataBR(obterDataPeriodoRM(item))}
      </td>

      <td>
        ${escaparHTML(item.regional || "Sem Regional")}
      </td>

      <td>
        ${escaparHTML(item.localidade || "-")}
      </td>

      <td>
        ${escaparHTML(contrato)}
      </td>

      <td class="col-descricao-rm">
        ${escaparHTML(item.titulo || "-")}
      </td>

      <td>
        <strong>${formatarMoedaBR(obterValorRM(item))}</strong>
      </td>

      <td>
        ${materiais.length}
      </td>

      <td>
        ${htmlBadgeAprovacao(status)}
      </td>

      <td>
        ${formatarDataHoraBR(obterDataCriacaoRM(item))}
      </td>

      <td>
        ${formatarDataHoraBR(obterDataDecisaoRM(item))}
      </td>

      <td>
        ${escaparHTML(item.criadoPor?.nome || item.criadoPor?.email || "-")}
      </td>
    `;

    tbody.appendChild(tr);
  });
}

function atualizarResumoRMs(lista) {
  const aprovadas = lista.filter(rmEstaAprovada);
  const pendentes = lista.filter(rmEstaPendente);

  const valorAprovado = aprovadas.reduce((total, item) => {
    return total + obterValorRM(item);
  }, 0);

  setTexto("resumoTotalRMs", lista.length);
  setTexto("resumoValorRMs", formatarMoedaBR(valorAprovado));
  setTexto("resumoRMsPendentes", pendentes.length);
  setTexto("resumoTempoMedioAprovacao", calcularTempoMedioAprovacao(lista));

  setTexto(
    "resumoQtdMateriais",
    lista.reduce((total, item) => {
      return total + (
        Array.isArray(item.materiais)
          ? item.materiais.length
          : 0
      );
    }, 0)
  );
}

/* =====================================================
   EXPORTAR RMs PARA PDF
===================================================== */

function exportarRMsPDF() {
  const lista = filtrarRMsCadastradas();

  if (!lista.length) {
    alert("Nenhuma RM encontrada para exportar.");
    return;
  }

  if (!window.jspdf) {
    alert("Biblioteca jsPDF não carregada. Verifique sua conexão ou o script no HTML.");
    return;
  }

  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF("l", "mm", "a4");

  const larguraPagina = pdf.internal.pageSize.getWidth();
  const alturaPagina = pdf.internal.pageSize.getHeight();
  const margem = 8;

  let y = 12;

  const regionalFiltro = getValor("filtroRegionalRM") || "Todas";

  const dataInicioFiltro = getValor("filtroDataInicioRM")
    ? formatarDataBR(dataInputParaDate(getValor("filtroDataInicioRM")))
    : "-";

  const dataFimFiltro = getValor("filtroDataFimRM")
    ? formatarDataBR(dataInputParaDate(getValor("filtroDataFimRM")))
    : "-";

  const statusFiltro = getValor("filtroStatusAprovacaoRM") || "Todos";

  const valorTotal = lista.reduce((total, item) => {
    return total + obterValorRM(item);
  }, 0);

  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(15);
  pdf.text("Relação de RMs por Regional", margem, y);

  y += 7;

  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(9);

  pdf.text(
    `Regional: ${regionalFiltro} | Período RM: ${dataInicioFiltro} até ${dataFimFiltro} | Status: ${statusFiltro}`,
    margem,
    y
  );

  y += 5;

  pdf.text(
    `Total de RMs: ${lista.length} | Valor total: ${formatarMoedaBR(valorTotal)} | Emitido em: ${new Date().toLocaleString("pt-BR")}`,
    margem,
    y
  );

  y += 8;

  const listaOrdenada = lista
    .slice()
    .sort((a, b) => {
      const regionalA = String(a.regional || "");
      const regionalB = String(b.regional || "");

      const comparaRegional = regionalA.localeCompare(
        regionalB,
        "pt-BR"
      );

      if (comparaRegional !== 0) {
        return comparaRegional;
      }

      return ordenarRMDecrescente(a, b);
    });

  let regionalAtual = "";

  const colunas = [
    { titulo: "RM", x: 8, w: 20 },
    { titulo: "Data RM", x: 29, w: 22 },
    { titulo: "Regional", x: 52, w: 24 },
    { titulo: "Localidade", x: 77, w: 34 },
    { titulo: "Contrato", x: 112, w: 32 },
    { titulo: "OM", x: 145, w: 30 },
    { titulo: "Descrição", x: 176, w: 58 },
    { titulo: "Valor", x: 235, w: 26 },
    { titulo: "Status", x: 262, w: 27 }
  ];

  listaOrdenada.forEach((item) => {
    const regionalItem = item.regional || "Sem Regional";

    if (regionalAtual !== regionalItem) {
      regionalAtual = regionalItem;

      y = verificarQuebraPaginaPDF(
        pdf,
        y,
        alturaPagina,
        18,
        margem
      );

      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(11);
      pdf.text(regionalAtual, margem, y);

      y += 5;

      desenharCabecalhoTabelaPDF(pdf, colunas, y);

      y += 6;
    }

    y = verificarQuebraPaginaPDF(
      pdf,
      y,
      alturaPagina,
      8,
      margem,
      () => {
        pdf.setFont("helvetica", "bold");
        pdf.setFontSize(11);
        pdf.text(regionalAtual, margem, 12);
        desenharCabecalhoTabelaPDF(pdf, colunas, 17);

        return 23;
      }
    );

    const descricao = limitarTexto(item.titulo || "-", 46);

    const linha = [
      item.numeroRM || "-",
      formatarDataBR(obterDataPeriodoRM(item)),
      regionalItem,
      item.localidade || "-",
      obterContratoRM(item) || "-",
      item.numeroOM || "-",
      descricao,
      formatarMoedaBR(obterValorRM(item)),
      obterStatusAprovacaoRM(item)
    ];

    desenharLinhaTabelaPDF(pdf, colunas, linha, y);

    y += 6;
  });

  adicionarRodapeTodasPaginasPDF(
    pdf,
    larguraPagina,
    alturaPagina
  );

  pdf.save("relacao-rms-por-regional.pdf");
}

function desenharCabecalhoTabelaPDF(pdf, colunas, y) {
  pdf.setFillColor(0, 126, 122);
  pdf.setTextColor(255, 255, 255);
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(7);

  colunas.forEach((coluna) => {
    pdf.rect(coluna.x, y, coluna.w, 5, "F");

    pdf.text(
      coluna.titulo,
      coluna.x + 1,
      y + 3.5
    );
  });

  pdf.setTextColor(31, 41, 55);
}

function desenharLinhaTabelaPDF(pdf, colunas, dados, y) {
  pdf.setDrawColor(229, 231, 235);
  pdf.setTextColor(31, 41, 55);
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(6.8);

  colunas.forEach((coluna, index) => {
    pdf.rect(coluna.x, y, coluna.w, 6);

    pdf.text(
      limitarTexto(
        String(dados[index] || "-"),
        Math.floor(coluna.w * 1.7)
      ),
      coluna.x + 1,
      y + 4
    );
  });
}

function verificarQuebraPaginaPDF(
  pdf,
  y,
  alturaPagina,
  espacoNecessario,
  margem,
  callbackNovaPagina = null
) {
  if (y + espacoNecessario <= alturaPagina - margem) {
    return y;
  }

  pdf.addPage();

  if (typeof callbackNovaPagina === "function") {
    return callbackNovaPagina();
  }

  return margem + 4;
}

function adicionarRodapeTodasPaginasPDF(
  pdf,
  larguraPagina,
  alturaPagina
) {
  const totalPaginas = pdf.internal.getNumberOfPages();

  for (let i = 1; i <= totalPaginas; i++) {
    pdf.setPage(i);
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(7);
    pdf.setTextColor(100, 116, 139);

    pdf.text(
      `Página ${i} de ${totalPaginas}`,
      larguraPagina - 28,
      alturaPagina - 6
    );
  }

  pdf.setTextColor(31, 41, 55);
}

/* =====================================================
   CUSTOS POR REGIONAL
===================================================== */

function obterRMsAprovadas() {
  return rmsCadastradas.filter(rmEstaAprovada);
}

function renderizarCustosPorRegional() {
  const tbody = document.getElementById("tbodyCustosRegional");

  if (!tbody) {
    return;
  }

  const regionaisBase = [
    "Regional 1",
    "Regional 2",
    "Regional 3",
    "São Luís",
    "Sem Regional"
  ];

  const mapa = new Map();

  regionaisBase.forEach((regional) => {
    mapa.set(regional, {
      regional,
      quantidadeRMs: 0,
      quantidadeMateriais: 0,
      custoTotal: 0
    });
  });

  obterRMsAprovadas().forEach((item) => {
    const regional = item.regional || "Sem Regional";

    if (!mapa.has(regional)) {
      mapa.set(regional, {
        regional,
        quantidadeRMs: 0,
        quantidadeMateriais: 0,
        custoTotal: 0
      });
    }

    const registro = mapa.get(regional);

    registro.quantidadeRMs += 1;

    registro.quantidadeMateriais += Array.isArray(item.materiais)
      ? item.materiais.length
      : 0;

    registro.custoTotal += obterValorRM(item);
  });

  const lista = Array.from(mapa.values())
    .filter((item) => item.quantidadeRMs > 0 || item.custoTotal > 0);

  const custoGeral = lista.reduce((total, item) => {
    return total + item.custoTotal;
  }, 0);

  const qtdGeral = lista.reduce((total, item) => {
    return total + item.quantidadeRMs;
  }, 0);

  const maior = lista
    .slice()
    .sort((a, b) => b.custoTotal - a.custoTotal)[0];

  setTexto("custoGeralRegional", formatarMoedaBR(custoGeral));
  setTexto("qtdGeralRegional", qtdGeral);
  setTexto("maiorCustoRegional", maior ? maior.regional : "-");

  setTexto(
    "ultimaAtualizacaoRegional",
    new Date().toLocaleString(
      "pt-BR",
      {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit"
      }
    )
  );

  tbody.innerHTML = "";

  if (!lista.length) {
    setTabelaMensagem(
      "tbodyCustosRegional",
      5,
      "Nenhuma RM aprovada encontrada para consolidar custos."
    );

    return;
  }

  lista.forEach((item) => {
    const participacao = custoGeral > 0
      ? (item.custoTotal / custoGeral) * 100
      : 0;

    const tr = document.createElement("tr");

    tr.innerHTML = `
      <td>
        <strong>${escaparHTML(item.regional)}</strong>
      </td>

      <td>
        ${item.quantidadeRMs}
      </td>

      <td>
        ${item.quantidadeMateriais}
      </td>

      <td>
        <strong>${formatarMoedaBR(item.custoTotal)}</strong>
      </td>

      <td>
        ${formatarPercentual(participacao)}
      </td>
    `;

    tbody.appendChild(tr);
  });
}

/* =====================================================
   PRODUTOS COM MAIS SAÍDA
===================================================== */

function consolidarProdutosMaisSaida() {
  const mapa = new Map();

  obterRMsAprovadas().forEach((rm) => {
    const materiais = Array.isArray(rm.materiais)
      ? rm.materiais
      : [];

    const regionalRM = rm.regional || "Sem Regional";

    materiais.forEach((material) => {
      const codigo = String(material.codigo || "").trim();
      const descricao = String(material.descricao || "").trim();
      const unidade = String(material.unidade || "").trim() || "Unidade";
      const quantidade = numeroBR(material.quantidade);
      const precoTotalInformado = numeroBR(material.precoTotal);
      const precoUnitario = numeroBR(material.precoUnitario);

      const custoTotal = precoTotalInformado > 0
        ? precoTotalInformado
        : precoUnitario * quantidade;

      if (!codigo && !descricao) {
        return;
      }

      if (quantidade <= 0 && custoTotal <= 0) {
        return;
      }

      const chave = [
        normalizarTexto(codigo),
        normalizarTexto(descricao),
        normalizarTexto(unidade)
      ].join("|");

      if (!mapa.has(chave)) {
        mapa.set(chave, {
          codigo,
          descricao,
          unidade,
          quantidadeTotal: 0,
          custoTotal: 0,
          rms: new Set(),
          regionais: new Set(),
          ocorrencias: 0
        });
      }

      const registro = mapa.get(chave);

      registro.quantidadeTotal += quantidade;
      registro.custoTotal += custoTotal;
      registro.ocorrencias += 1;

      if (rm.numeroRM) {
        registro.rms.add(String(rm.numeroRM));
      }

      registro.regionais.add(regionalRM);
    });
  });

  return Array.from(mapa.values())
    .map((item) => ({
      ...item,
      rmsArray: Array.from(item.rms),
      regionaisArray: Array.from(item.regionais),

      precoMedio: item.quantidadeTotal > 0
        ? item.custoTotal / item.quantidadeTotal
        : 0
    }));
}

function filtrarProdutosMaisSaida() {
  const busca = normalizarTexto(getValor("filtroBuscaProduto"));
  const regional = getValor("filtroRegionalProduto");
  const ordenacao = getValor("filtroOrdenacaoProduto") || "quantidade";

  let lista = consolidarProdutosMaisSaida();

  if (regional) {
    lista = lista.filter((item) => item.regionaisArray.includes(regional));
  }

  if (busca) {
    lista = lista.filter((item) => {
      const texto = normalizarTexto(
        [
          item.codigo,
          item.descricao,
          item.unidade,
          item.regionaisArray.join(" "),
          item.rmsArray.join(" ")
        ].join(" ")
      );

      return texto.includes(busca);
    });
  }

  lista.sort((a, b) => {
    if (ordenacao === "custo") {
      return b.custoTotal - a.custoTotal;
    }

    if (ordenacao === "rms") {
      return b.rmsArray.length - a.rmsArray.length;
    }

    if (ordenacao === "descricao") {
      return String(a.descricao || "")
        .localeCompare(
          String(b.descricao || ""),
          "pt-BR"
        );
    }

    return b.quantidadeTotal - a.quantidadeTotal;
  });

  return lista;
}

function renderizarProdutosMaisSaida() {
  const tbody = document.getElementById("tbodyProdutosMaisSaida");

  if (!tbody) {
    return;
  }

  const lista = filtrarProdutosMaisSaida();

  atualizarResumoProdutos(lista);

  tbody.innerHTML = "";

  if (!lista.length) {
    setTabelaMensagem(
      "tbodyProdutosMaisSaida",
      9,
      "Nenhum produto aprovado encontrado para sua visão de acesso."
    );

    return;
  }

  lista.forEach((item, index) => {
    const tr = document.createElement("tr");

    tr.innerHTML = `
      <td>
        <strong>${index + 1}º</strong>
      </td>

      <td>
        <strong>${escaparHTML(item.codigo || "-")}</strong>
      </td>

      <td class="col-descricao-produto">
        ${escaparHTML(item.descricao || "-")}
      </td>

      <td>
        ${escaparHTML(item.unidade || "-")}
      </td>

      <td>
        <strong>${formatarNumero(item.quantidadeTotal)}</strong>
      </td>

      <td>
        <strong>${formatarMoedaBR(item.custoTotal)}</strong>
      </td>

      <td>
        ${formatarMoedaBR(item.precoMedio)}
      </td>

      <td>
        ${item.rmsArray.length}
      </td>

      <td>
        ${escaparHTML(item.regionaisArray.join(" / ") || "-")}
      </td>
    `;

    tbody.appendChild(tr);
  });
}

function atualizarResumoProdutos(lista) {
  const quantidadeTotal = lista.reduce((total, item) => {
    return total + item.quantidadeTotal;
  }, 0);

  const custoTotal = lista.reduce((total, item) => {
    return total + item.custoTotal;
  }, 0);

  const produtoMaisSaida = lista
    .slice()
    .sort((a, b) => b.quantidadeTotal - a.quantidadeTotal)[0];

  setTexto("resumoTotalProdutos", lista.length);
  setTexto("resumoQuantidadeProdutos", formatarNumero(quantidadeTotal));
  setTexto("resumoCustoProdutos", formatarMoedaBR(custoTotal));

  setTexto(
    "resumoProdutoMaisSaida",
    produtoMaisSaida
      ? (
        produtoMaisSaida.codigo
          ? `${produtoMaisSaida.codigo} - ${produtoMaisSaida.descricao}`
          : produtoMaisSaida.descricao
      )
      : "-"
  );
}

/* =====================================================
   APROVAÇÕES
===================================================== */

function obterRMsParaAprovacao() {
  return rmsCadastradas.filter((item) => {
    return usuarioPodeAprovarRegional(item.regional);
  });
}

function filtrarAprovacoes() {
  const busca = normalizarTexto(getValor("filtroBuscaAprovacao"));
  const regional = getValor("filtroRegionalAprovacao");
  const status = getValor("filtroStatusAprovacao");

  let lista = obterRMsParaAprovacao();

  if (regional) {
    lista = lista.filter((item) => String(item.regional || "") === regional);
  }

  if (status) {
    lista = lista.filter((item) => obterStatusAprovacaoRM(item) === status);
  }

  if (busca) {
    lista = lista.filter((item) => {
      const texto = normalizarTexto(
        [
          item.numeroRM,
          item.numeroOM,
          item.titulo,
          obterContratoRM(item),
          item.regional,
          item.localidade,
          item.solicitante,
          item.criadoPor?.nome,
          item.criadoPor?.email
        ].join(" ")
      );

      return texto.includes(busca);
    });
  }

  lista.sort((a, b) => {
    const ordemStatus = {
      "Pendente de Aprovação": 1,
      "Reprovada": 2,
      "Aprovada": 3
    };

    const statusA = obterStatusAprovacaoRM(a);
    const statusB = obterStatusAprovacaoRM(b);

    if (ordemStatus[statusA] !== ordemStatus[statusB]) {
      return ordemStatus[statusA] - ordemStatus[statusB];
    }

    const dataA = obterDataCriacaoRM(a);
    const dataB = obterDataCriacaoRM(b);

    return (dataA?.getTime() || 0) - (dataB?.getTime() || 0);
  });

  return lista;
}

function renderizarAprovacoes() {
  const tbody = document.getElementById("tbodyAprovacoes");

  if (!tbody) {
    return;
  }

  if (!usuarioPodeAprovarRM()) {
    setTabelaMensagem(
      "tbodyAprovacoes",
      13,
      "Você não possui permissão para aprovar RMs."
    );

    return;
  }

  const lista = filtrarAprovacoes();

  atualizarResumoAprovacoes(
    obterRMsParaAprovacao()
  );

  tbody.innerHTML = "";

  if (!lista.length) {
    setTabelaMensagem(
      "tbodyAprovacoes",
      13,
      "Nenhuma RM encontrada para aprovação."
    );

    return;
  }

  lista.forEach((item) => {
    const materiais = Array.isArray(item.materiais)
      ? item.materiais
      : [];

    const status = obterStatusAprovacaoRM(item);

    const podeDecidir =
      status === "Pendente de Aprovação" &&
      usuarioPodeAprovarRegional(item.regional);

    const descricaoComContrato = obterContratoRM(item)
      ? `${item.titulo || "-"} | ${obterContratoRM(item)}`
      : item.titulo || "-";

    const tr = document.createElement("tr");

    tr.className = "linha-aprovacao-rm";

    if (rmAprovacaoDetalhadaId === item.id) {
      tr.classList.add("linha-aprovacao-aberta");
    }

    tr.dataset.id = item.id;

    tr.innerHTML = `
      <td>
        <strong>${escaparHTML(item.numeroRM || "-")}</strong>
      </td>

      <td>
        ${escaparHTML(item.regional || "Sem Regional")}
      </td>

      <td>
        ${escaparHTML(item.localidade || "-")}
      </td>

      <td class="col-descricao-rm">
        ${escaparHTML(descricaoComContrato)}
      </td>

      <td>
        <strong>${formatarMoedaBR(obterValorRM(item))}</strong>
      </td>

      <td>
        ${materiais.length}
      </td>

      <td>
        ${htmlBadgeAprovacao(status)}
      </td>

      <td>
        ${escaparHTML(item.criadoPor?.nome || item.criadoPor?.email || "-")}
      </td>

      <td>
        ${formatarDataHoraBR(obterDataCriacaoRM(item))}
      </td>

      <td>
        ${escaparHTML(obterTextoTempoEmAberto(item))}
      </td>

      <td>
        ${formatarDataHoraBR(obterDataDecisaoRM(item))}
      </td>

      <td>
        ${escaparHTML(obterTextoTempoAteAprovacao(item))}
      </td>

      <td>
        ${
          podeDecidir
            ? `
              <div class="acoes-aprovacao">
                <button
                  type="button"
                  class="btn-aprovar-rm"
                  data-id="${escaparHTML(item.id)}"
                >
                  <i class="fa-solid fa-check"></i>
                  Aprovar
                </button>

                <button
                  type="button"
                  class="btn-reprovar-rm"
                  data-id="${escaparHTML(item.id)}"
                >
                  <i class="fa-solid fa-xmark"></i>
                  Reprovar
                </button>
              </div>
            `
            : `<span class="texto-sem-acao">Sem ação</span>`
        }
      </td>
    `;

    tr.addEventListener("click", (event) => {
      if (
        event.target.closest("button") ||
        event.target.closest(".acoes-aprovacao")
      ) {
        return;
      }

      rmAprovacaoDetalhadaId =
        rmAprovacaoDetalhadaId === item.id
          ? null
          : item.id;

      renderizarAprovacoes();
    });

    tbody.appendChild(tr);

    if (rmAprovacaoDetalhadaId === item.id) {
      const trDetalhe = document.createElement("tr");

      trDetalhe.className = "linha-detalhe-materiais-rm";

      trDetalhe.innerHTML = `
        <td colspan="13">
          ${montarHTMLMateriaisDaRM(item)}
        </td>
      `;

      tbody.appendChild(trDetalhe);
    }
  });

  tbody
    .querySelectorAll(".btn-aprovar-rm")
    .forEach((botao) => {
      botao.addEventListener("click", (event) => {
        event.stopPropagation();
        aprovarRM(botao.dataset.id);
      });
    });

  tbody
    .querySelectorAll(".btn-reprovar-rm")
    .forEach((botao) => {
      botao.addEventListener("click", (event) => {
        event.stopPropagation();
        abrirModalReprovarRM(botao.dataset.id);
      });
    });
}

function montarHTMLMateriaisDaRM(item) {
  const materiais = Array.isArray(item.materiais)
    ? item.materiais
    : [];

  if (!materiais.length) {
    return `
      <div class="detalhe-rm-box">
        <div class="detalhe-rm-header">
          <div>
            <strong>
              Materiais da RM ${escaparHTML(item.numeroRM || "-")}
            </strong>

            <span>
              Nenhum material cadastrado nesta RM.
            </span>
          </div>
        </div>
      </div>
    `;
  }

  const valorTotalMateriais = materiais.reduce((total, material) => {
    return total + obterValorMaterial(material);
  }, 0);

  const linhas = materiais.map((material, index) => {
    return `
      <tr>
        <td>${index + 1}</td>

        <td>
          <strong>${escaparHTML(material.codigo || "-")}</strong>
        </td>

        <td class="detalhe-material-descricao">
          ${escaparHTML(material.descricao || "-")}
        </td>

        <td>${escaparHTML(material.unidade || "-")}</td>
        <td>${formatarNumero(numeroBR(material.quantidade))}</td>
        <td>${formatarMoedaBR(material.precoUnitario)}</td>

        <td>
          <strong>${formatarMoedaBR(obterValorMaterial(material))}</strong>
        </td>

        <td>${escaparHTML(material.observacao || "-")}</td>
      </tr>
    `;
  }).join("");

  return `
    <div class="detalhe-rm-box">
      <div class="detalhe-rm-header">
        <div>
          <strong>
            Materiais da RM ${escaparHTML(item.numeroRM || "-")}
          </strong>

          <span>
            ${materiais.length} material(is) cadastrado(s)
            ${obterContratoRM(item) ? ` | ${escaparHTML(obterContratoRM(item))}` : ""}
          </span>
        </div>

        <div class="detalhe-rm-resumo">
          <span>Valor total dos materiais</span>

          <strong>
            ${formatarMoedaBR(valorTotalMateriais || obterValorRM(item))}
          </strong>
        </div>
      </div>

      <div class="detalhe-rm-table-wrapper">
        <table class="tabela-detalhe-materiais">
          <thead>
            <tr>
              <th>#</th>
              <th>Código</th>
              <th>Descrição do Material</th>
              <th>Unidade</th>
              <th>Quantidade</th>
              <th>Preço Unitário</th>
              <th>Preço Total</th>
              <th>Observação</th>
            </tr>
          </thead>

          <tbody>
            ${linhas}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function atualizarResumoAprovacoes(lista) {
  const pendentes = lista.filter(rmEstaPendente);
  const aprovadas = lista.filter(rmEstaAprovada);
  const reprovadas = lista.filter(rmEstaReprovada);

  setTexto("aprovacaoQtdPendentes", pendentes.length);
  setTexto("aprovacaoQtdAprovadas", aprovadas.length);
  setTexto("aprovacaoQtdReprovadas", reprovadas.length);
  setTexto("aprovacaoTempoMedio", calcularTempoMedioAprovacao(lista));
}

/* =====================================================
   APROVAR / REPROVAR
===================================================== */

async function aprovarRM(id) {
  const item = rmsCadastradas.find((rm) => rm.id === id);

  if (!item) {
    alert("RM não encontrada.");
    return;
  }

  if (!usuarioPodeAprovarRegional(item.regional)) {
    alert("Você não possui permissão para aprovar esta Regional.");
    return;
  }

  if (!rmEstaPendente(item)) {
    alert("Essa RM não está pendente de aprovação.");
    return;
  }

  const confirmar = confirm(
    `Deseja aprovar a RM ${item.numeroRM || ""}?`
  );

  if (!confirmar) {
    return;
  }

  const agora = new Date();
  const inicio = obterDataCriacaoRM(item);

  const tempoMs = inicio
    ? Math.max(0, agora.getTime() - inicio.getTime())
    : 0;

  const tempoTexto = tempoMs > 0
    ? formatarDuracao(tempoMs)
    : "";

  try {
    await updateDoc(
      doc(db, COLECAO_RMS, id),
      {
        status: "Aprovada",
        statusAprovacao: "Aprovada",
        aplicada: true,

        aprovadoPorUid: obterUidUsuario(),
        aprovadoPorEmail: obterEmailUsuario(),
        aprovadoPorNome: obterNomeUsuario(),
        aprovadoPorRegional: obterRegionalUsuario(),

        aprovadoEm: serverTimestamp(),
        decididoEm: serverTimestamp(),

        tempoAprovacaoMs: tempoMs,
        tempoAprovacaoMinutos: Math.round(tempoMs / 60000),
        tempoAprovacaoHoras: Number((tempoMs / 3600000).toFixed(2)),
        tempoAprovacaoTexto: tempoTexto,

        tempoDecisaoMs: tempoMs,
        tempoDecisaoTexto: tempoTexto,

        atualizadoEm: serverTimestamp()
      }
    );

    alert("RM aprovada com sucesso!");

    rmAprovacaoDetalhadaId = null;

    await carregarRMsCadastradas();

    abrirAba("aprovacoes");
  } catch (error) {
    console.error("Erro ao aprovar RM:", error);
    alert("Erro ao aprovar RM. Verifique as permissões do Firestore.");
  }
}

function abrirModalReprovarRM(id) {
  const item = rmsCadastradas.find((rm) => rm.id === id);

  if (!item) {
    alert("RM não encontrada.");
    return;
  }

  if (!usuarioPodeAprovarRegional(item.regional)) {
    alert("Você não possui permissão para reprovar esta Regional.");
    return;
  }

  if (!rmEstaPendente(item)) {
    alert("Essa RM não está pendente de aprovação.");
    return;
  }

  rmSelecionadaParaReprovar = item;

  setTexto("reprovarRMNumero", item.numeroRM || "-");
  setTexto("reprovarRMRegional", item.regional || "-");
  setTexto("reprovarRMValor", formatarMoedaBR(obterValorRM(item)));
  setValor("motivoReprovacao", "");

  const modal = document.getElementById("modalReprovarRM");

  modal?.classList.add("ativo");
  modal?.setAttribute("aria-hidden", "false");

  document.body.classList.add("modal-aberto");
}

function fecharModalReprovarRM() {
  const modal = document.getElementById("modalReprovarRM");

  modal?.classList.remove("ativo");
  modal?.setAttribute("aria-hidden", "true");

  document.body.classList.remove("modal-aberto");

  rmSelecionadaParaReprovar = null;
}

async function confirmarReprovacaoRM() {
  if (!rmSelecionadaParaReprovar) {
    alert("Nenhuma RM selecionada para reprovação.");
    return;
  }

  const motivo = getValor("motivoReprovacao");

  if (!motivo) {
    alert("Informe o motivo da reprovação.");
    return;
  }

  const item = rmSelecionadaParaReprovar;
  const agora = new Date();
  const inicio = obterDataCriacaoRM(item);

  const tempoMs = inicio
    ? Math.max(0, agora.getTime() - inicio.getTime())
    : 0;

  const tempoTexto = tempoMs > 0
    ? formatarDuracao(tempoMs)
    : "";

  const btn = document.getElementById("btnConfirmarReprovar");
  const textoOriginal = btn?.innerHTML;

  try {
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Reprovando...';
    }

    await updateDoc(
      doc(db, COLECAO_RMS, item.id),
      {
        status: "Reprovada",
        statusAprovacao: "Reprovada",
        aplicada: false,

        motivoReprovacao: motivo,

        reprovadoPorUid: obterUidUsuario(),
        reprovadoPorEmail: obterEmailUsuario(),
        reprovadoPorNome: obterNomeUsuario(),
        reprovadoPorRegional: obterRegionalUsuario(),

        reprovadoEm: serverTimestamp(),
        decididoEm: serverTimestamp(),

        tempoDecisaoMs: tempoMs,
        tempoDecisaoMinutos: Math.round(tempoMs / 60000),
        tempoDecisaoHoras: Number((tempoMs / 3600000).toFixed(2)),
        tempoDecisaoTexto: tempoTexto,

        atualizadoEm: serverTimestamp()
      }
    );

    fecharModalReprovarRM();

    alert("RM reprovada com sucesso!");

    rmAprovacaoDetalhadaId = null;

    await carregarRMsCadastradas();

    abrirAba("aprovacoes");
  } catch (error) {
    console.error("Erro ao reprovar RM:", error);
    alert("Erro ao reprovar RM. Verifique as permissões do Firestore.");
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = textoOriginal;
    }
  }
}

/* =====================================================
   PDF
===================================================== */

function selecionarArquivoPDF(arquivo) {
  if (!arquivo) {
    return;
  }

  if (arquivo.type !== "application/pdf") {
    alert("Selecione apenas arquivo PDF.");
    return;
  }

  arquivoSelecionado = arquivo;

  setTexto("nomeArquivo", arquivo.name);
  setTexto("tamanhoArquivo", formatarTamanhoArquivo(arquivo.size));
  setTexto("paginasLidas", "0");

  setProgresso(0);

  const btnLerPDF = document.getElementById("btnLerPDF");

  if (btnLerPDF) {
    btnLerPDF.disabled = false;
  }

  atualizarStatusTela(
    "PDF selecionado",
    "Clique em Ler PDF para processar",
    "pendente"
  );

  adicionarLog("info", `Arquivo selecionado: ${arquivo.name}`);
}

async function lerPDFSelecionado() {
  if (!arquivoSelecionado) {
    alert("Selecione um PDF antes de iniciar a leitura.");
    return;
  }

  if (!pdfjsLibGlobal) {
    alert("Biblioteca PDF.js não foi carregada. Verifique sua conexão com a internet.");
    return;
  }

  try {
    bloquearLeituraPDF(true);

    atualizarStatusTela(
      "Lendo PDF",
      "Processando páginas do arquivo",
      "processando"
    );

    adicionarLog("info", "Iniciando leitura do PDF...");

    textoExtraidoCompleto = "";
    paginasTextoExtraido = [];
    linhasPDFEstruturadas = [];
    materiaisExtraidos = [];

    const arrayBuffer = await arquivoSelecionado.arrayBuffer();

    const pdf = await pdfjsLibGlobal
      .getDocument({
        data: arrayBuffer
      })
      .promise;

    totalPaginasPDF = pdf.numPages || 0;

    for (let numeroPagina = 1; numeroPagina <= totalPaginasPDF; numeroPagina++) {
      const page = await pdf.getPage(numeroPagina);
      const textContent = await page.getTextContent();

      const linhasPagina = montarLinhasPorCoordenada(
        textContent.items,
        numeroPagina
      );

      const textoPagina = linhasPagina.join("\n");

      paginasTextoExtraido.push({
        pagina: numeroPagina,
        texto: textoPagina,
        linhas: linhasPagina
      });

      textoExtraidoCompleto += `\n\n--- PÁGINA ${numeroPagina} ---\n${textoPagina}`;

      setTexto(
        "paginasLidas",
        `${numeroPagina} de ${totalPaginasPDF}`
      );

      setProgresso(
        Math.round((numeroPagina / totalPaginasPDF) * 100)
      );
    }

    const linhasTodas = paginasTextoExtraido.flatMap((pagina) => pagina.linhas);

    console.log("[RM PDF] Linhas extraídas:", linhasTodas);
    console.log("[RM PDF] Linhas estruturadas:", linhasPDFEstruturadas);

    extrairDadosDaRequisicao(
      textoExtraidoCompleto,
      linhasTodas
    );

    materiaisExtraidos = extrairMateriaisDasLinhas(
      linhasTodas,
      linhasPDFEstruturadas
    );

    console.table(materiaisExtraidos);

    if (
      !getValor("valorTotalRM") &&
      materiaisExtraidos.length > 0
    ) {
      setValor(
        "valorTotalRM",
        formatarMoedaBR(calcularValorTotalMateriais())
      );
    }

    renderizarTabelaMateriais();
    atualizarResumoCadastro();

    if (materiaisExtraidos.length > 0) {
      atualizarStatusTela(
        "Leitura concluída",
        "Materiais identificados para conferência",
        "ok"
      );

      setBadgeConferencia(
        "Pronto para aprovação",
        "pendente"
      );

      adicionarLog(
        "ok",
        `${materiaisExtraidos.length} material(is) identificado(s) no PDF. Confira os dados antes de enviar para aprovação.`
      );
    } else {
      atualizarStatusTela(
        "PDF lido",
        "Nenhum material identificado automaticamente",
        "alerta"
      );

      setBadgeConferencia(
        "Revisão manual necessária",
        "erro"
      );

      adicionarLog(
        "alerta",
        "O texto foi extraído, mas nenhum material foi identificado automaticamente. O PDF pode estar com tabela fora do padrão ou escaneado."
      );
    }
  } catch (error) {
    console.error("Erro ao ler PDF:", error);

    atualizarStatusTela(
      "Erro na leitura",
      "Não foi possível processar o PDF",
      "erro"
    );

    adicionarLog(
      "erro",
      "Erro ao ler o PDF. Verifique se o arquivo não está corrompido ou protegido."
    );

    alert("Erro ao ler o PDF. Verifique o console do navegador.");
  } finally {
    bloquearLeituraPDF(false);
  }
}

function bloquearLeituraPDF(bloquear) {
  const btnLerPDF = document.getElementById("btnLerPDF");

  if (!btnLerPDF) {
    return;
  }

  btnLerPDF.disabled = bloquear || !arquivoSelecionado;

  btnLerPDF.innerHTML = bloquear
    ? '<i class="fa-solid fa-spinner fa-spin"></i> Lendo...'
    : '<i class="fa-solid fa-magnifying-glass-chart"></i> Ler PDF';
}

function montarLinhasPorCoordenada(items, numeroPagina = 1) {
  const elementos = items
    .filter((item) => String(item.str || "").trim())
    .map((item) => ({
      texto: String(item.str || "").trim(),
      x: Number(item.transform?.[4] || 0),
      y: Number(item.transform?.[5] || 0)
    }))
    .sort((a, b) => {
      const diferencaY = b.y - a.y;

      if (Math.abs(diferencaY) > 2.5) {
        return diferencaY;
      }

      return a.x - b.x;
    });

  const grupos = [];

  elementos.forEach((item) => {
    let grupo = grupos.find((linha) =>
      Math.abs(linha.y - item.y) <= 2.5
    );

    if (!grupo) {
      grupo = {
        pagina: numeroPagina,
        y: item.y,
        itens: []
      };

      grupos.push(grupo);
    }

    grupo.itens.push(item);
  });

  const linhasOrdenadas = grupos
    .sort((a, b) => b.y - a.y)
    .map((linha, ordem) => {
      const itensOrdenados = linha.itens
        .sort((a, b) => a.x - b.x);

      const texto = itensOrdenados
        .map((item) => item.texto)
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();

      return {
        pagina: numeroPagina,
        ordem,
        y: linha.y,
        texto,
        itens: itensOrdenados
      };
    })
    .filter((linha) => linha.texto);

  linhasPDFEstruturadas.push(...linhasOrdenadas);

  return linhasOrdenadas.map((linha) => linha.texto);
}

/* =====================================================
   EXTRAÇÃO DOS DADOS DA RM
===================================================== */

function extrairDadosDaRequisicao(textoCompleto, linhas) {
  const dados = extrairDadosRM(textoCompleto, linhas);

  if (dados.numeroRM) {
    setValor("numeroRM", dados.numeroRM);
    setTexto("resumoRM", dados.numeroRM);
  }

  if (dados.numeroOM) {
    setValor("numeroOM", dados.numeroOM);
  }

  if (dados.titulo) {
    setValor("tituloRequisicao", dados.titulo);
  }

  if (dados.centroCusto) {
    setValor("centroCusto", dados.centroCusto);
  }

  if (dados.dataRequisicao) {
    setValor("dataRequisicao", dados.dataRequisicao);
  }

  if (dados.localRM) {
    setValor("localRM", dados.localRM);
  }

  if (dados.localidade) {
    preencherRegionalPelaLocalidade(dados.localidade);
    setValor("localidade", dados.localidade);
  }

  if (dados.via) {
    setValor("viaRM", dados.via);
  }

  if (dados.valorTotalRM) {
    setValor(
      "valorTotalRM",
      formatarMoedaBR(dados.valorTotalRM)
    );
  }
}

function extrairDadosRM(textoCompleto, linhas) {
  const texto = String(textoCompleto || "");
  const textoLinhas = Array.isArray(linhas) ? linhas.join("\n") : "";

  const dadosArquivo = extrairDadosDoNomeArquivoRM(
    arquivoSelecionado?.name || ""
  );

  let numeroRM = "";
  let numeroOM = "";
  let centroCusto = "";
  let dataRM = "";

  const matchLinhaRGI = textoLinhas.match(
    /RG\s*I\s+(\d{3,})\s+(\d{4,})\s+(\d{2}\/\d{2}\/\d{4})/i
  );

  if (matchLinhaRGI) {
    numeroRM = matchLinhaRGI[1];
    centroCusto = matchLinhaRGI[2];
    dataRM = matchLinhaRGI[3];
  }

  const matchCabecalhoAntigo = textoLinhas.match(
    /(\d{4,5})\s+(\d{8,})\s+(\d{4,})\s+(\d{2}\/\d{2}\/\d{4})/
  );

  if (matchCabecalhoAntigo && !numeroRM) {
    numeroRM = matchCabecalhoAntigo[1];
    numeroOM = matchCabecalhoAntigo[2];
    centroCusto = matchCabecalhoAntigo[3];
    dataRM = matchCabecalhoAntigo[4];
  }

  numeroRM = normalizarRM(
    numeroRM ||
    dadosArquivo.numeroRM ||
    extrairNumeroRM(texto, linhas)
  );

  numeroOM =
    numeroOM ||
    dadosArquivo.numeroOM ||
    extrairNumeroOM(textoLinhas) ||
    extrairNumeroOM(texto);

  centroCusto =
    centroCusto ||
    extrairCentroCusto(textoLinhas) ||
    extrairCentroCusto(texto);

  return {
    numeroRM,

    numeroOM,

    centroCusto,

    dataRequisicao: dataRM
      ? converterDataBRParaInput(dataRM)
      : extrairDataRequisicao(texto),

    titulo: extrairDescricaoOrdemRM(
      texto,
      linhas,
      dadosArquivo.titulo
    ),

    localRM: extrairLocalRM(texto, linhas),

    localidade: extrairLocalidade(texto),

    via: extrairViaRM(linhas),

    valorTotalRM: extrairValorTotalRM(texto, linhas)
  };
}

function extrairDadosDoNomeArquivoRM(nomeArquivo) {
  const nome = String(nomeArquivo || "");

  const match = nome.match(
    /RM[-_ ]?(\d{3,})[-_ ]+(\d{8,})[-_ ]+(.+?)\.pdf$/i
  );

  if (!match) {
    return {
      numeroRM: "",
      numeroOM: "",
      titulo: ""
    };
  }

  return {
    numeroRM: normalizarRM(match[1]),
    numeroOM: match[2],
    titulo: limparTextoCampo(
      match[3].replace(/[-_]+/g, " ")
    )
  };
}

function extrairNumeroRM(texto, linhas) {
  const matchRGI = String(texto || "").match(
    /RG\s*I\s+(\d{3,})/i
  );

  if (matchRGI) {
    return matchRGI[1];
  }

  const matchDireto = String(texto || "").match(
    /N[º°]\s*RM\s+(\d{3,})/i
  );

  if (matchDireto) {
    return matchDireto[1];
  }

  const matchArquivo = String(arquivoSelecionado?.name || "")
    .match(/RM[-_ ]?(\d{3,})/i);

  if (matchArquivo) {
    return matchArquivo[1];
  }

  const possiveis = Array.isArray(linhas)
    ? linhas.join(" ").match(/\b0?\d{4,5}\b/g)
    : [];

  return possiveis?.[0] || "";
}

function extrairNumeroOM(texto) {
  const textoBase = String(texto || "");

  const match = textoBase.match(
    /(?:N[º°]\s*ORDEM\s+DE\s+MANUTEN[ÇC][AÃ]O|ORDEM\s+DE\s+MANUTEN[ÇC][AÃ]O|OM)\D{0,40}(\d{8,})/i
  );

  if (match) {
    return match[1];
  }

  const matchLinha = textoBase.match(/\b(20\d{8,})\b/);

  return matchLinha ? matchLinha[1] : "";
}

function normalizarRM(valor) {
  const numero = String(valor || "")
    .replace(/\D/g, "");

  if (!numero) {
    return "";
  }

  return numero.padStart(5, "0");
}

function converterDataBRParaInput(dataBR) {
  const partes = String(dataBR || "").split("/");

  if (partes.length !== 3) {
    return "";
  }

  return `${partes[2]}-${partes[1]}-${partes[0]}`;
}

function extrairDescricaoOrdemRM(texto, linhas, tituloArquivo = "") {
  const indiceChamado = linhas.findIndex((linha) =>
    normalizarTexto(linha).includes("descricao do chamado")
  );

  if (indiceChamado >= 0) {
    for (
      let i = indiceChamado + 1;
      i < Math.min(indiceChamado + 6, linhas.length);
      i++
    ) {
      const linha = String(linhas[i] || "").trim();
      const normalizada = normalizarTexto(linha);

      if (
        linha &&
        !normalizada.includes("medicao") &&
        !normalizada.includes("via") &&
        !normalizada.includes("item") &&
        !normalizada.includes("codigo") &&
        !normalizada.includes("unidade") &&
        !normalizada.includes("preco") &&
        linha.length >= 5
      ) {
        return limparTextoCampo(
          removerSiteDoInicioDescricao(linha)
        );
      }
    }
  }

  const indiceDescricao = linhas.findIndex((linha) =>
    normalizarTexto(linha).includes("descricao da ordem")
  );

  if (indiceDescricao >= 0) {
    for (
      let i = indiceDescricao + 1;
      i < Math.min(indiceDescricao + 6, linhas.length);
      i++
    ) {
      const linha = String(linhas[i] || "").trim();
      const normalizada = normalizarTexto(linha);

      if (
        linha &&
        !normalizada.includes("item") &&
        !normalizada.includes("codigo") &&
        !normalizada.includes("unidade") &&
        !normalizada.includes("preco") &&
        !normalizada.includes("cidade") &&
        !normalizada.includes("via") &&
        !normalizada.includes("medicao") &&
        linha.length >= 5
      ) {
        return limparTextoCampo(linha);
      }
    }
  }

  const match = String(texto || "").match(
    /DESCRI[ÇC][AÃ]O\s+(?:DO\s+CHAMADO|DA\s+ORDEM)\s+([^\n\r]{5,180})/i
  );

  if (match) {
    return limparTextoCampo(
      removerSiteDoInicioDescricao(match[1])
    );
  }

  if (tituloArquivo) {
    return tituloArquivo;
  }

  if (arquivoSelecionado?.name) {
    return arquivoSelecionado.name
      .replace(/\.pdf$/i, "")
      .replace(/[_-]+/g, " ")
      .trim();
  }

  return "";
}

function removerSiteDoInicioDescricao(texto) {
  return String(texto || "")
    .replace(/^\s*SANTA\s+IN[EÊ]S\s+/i, "")
    .replace(/^\s*ALTO\s+ALEGRE\s+/i, "")
    .replace(/^\s*A[ÇC]AIL[ÂA]NDIA\s+/i, "")
    .replace(/^\s*MARAB[ÁA]\s+/i, "")
    .replace(/^\s*ARARI\s+/i, "")
    .replace(/^\s*VIT[ÓO]RIA\s+DO\s+MEARIM\s+/i, "")
    .replace(/^\s*NOVA\s+VIDA\s+/i, "")
    .replace(/^\s*S[ÃA]O\s+LU[ÍI]S\s+/i, "")
    .trim();
}

function extrairLocalRM(texto, linhas) {
  const textoCompleto = normalizarTexto(texto);

  if (textoCompleto.includes("administracao central")) {
    return "ADMINISTRACAO CENTRAL";
  }

  const indiceLocal = linhas.findIndex((linha) =>
    normalizarTexto(linha).includes("local")
  );

  if (indiceLocal >= 0) {
    const candidatos = [];

    for (
      let i = indiceLocal + 1;
      i < Math.min(indiceLocal + 4, linhas.length);
      i++
    ) {
      const linha = String(linhas[i] || "").trim();
      const normalizada = normalizarTexto(linha);

      if (
        linha &&
        !normalizada.includes("descricao da ordem") &&
        !normalizada.includes("descricao do chamado") &&
        !normalizada.includes("cidade") &&
        !normalizada.includes("via") &&
        !normalizada.includes("item") &&
        !normalizada.includes("codigo") &&
        !normalizada.includes("preco")
      ) {
        candidatos.push(linha);
      }
    }

    const junto = candidatos.join(" ");

    if (junto) {
      return limparTextoCampo(junto);
    }
  }

  return "";
}

function extrairViaRM(linhas) {
  const vias = [];

  linhas.forEach((linha) => {
    const match = String(linha || "").match(
      /(\d+\s*[ªº°]?\s*-\s*VIA)/i
    );

    if (match) {
      const via = limparTextoCampo(match[1])
        .replace(/\s+/g, " ")
        .replace("°", "º")
        .replace("1º", "1ª")
        .replace("1°", "1ª");

      if (via && !normalizarTexto(via).includes("medicao")) {
        vias.push(via);
      }
    }
  });

  return [...new Set(vias)].join(" / ");
}

function extrairValorTotalRM(texto, linhas) {
  const candidatos = [];

  linhas.forEach((linha) => {
    const valores = String(linha || "")
      .replace(/R\s+\$/g, "R$")
      .match(/R\$\s*[\d.]+,\d{2}/g);

    if (valores) {
      valores.forEach((valor) => {
        candidatos.push(numeroBR(valor));
      });
    }
  });

  const valoresTexto = [
    ...String(texto || "")
      .replace(/R\s+\$/g, "R$")
      .matchAll(/R\$\s*([\d.]+,\d{2})/g)
  ]
    .map((match) => numeroBR(match[1]))
    .filter((valor) => valor > 0);

  candidatos.push(...valoresTexto);

  return candidatos.length
    ? Math.max(...candidatos)
    : 0;
}

function extrairCentroCusto(texto) {
  const textoBase = String(texto || "");

  const matchCabecalho = textoBase.match(
    /RG\s*I\s+\d{3,}\s+(\d{4,})\s+\d{2}\/\d{2}\/\d{4}/i
  );

  if (matchCabecalho) {
    return matchCabecalho[1];
  }

  const match = textoBase.match(
    /(?:centro\s+de\s+custo|centro\s+custo|cc)\D{0,25}([A-Z0-9.\-/]{3,})/i
  );

  return match
    ? limparTextoCampo(match[1])
    : "";
}

function extrairDataRequisicao(texto) {
  const match = String(texto || "").match(
    /(\d{2}\/\d{2}\/\d{4})/
  );

  return match
    ? converterDataBRParaInput(match[1])
    : "";
}

function extrairLocalidade(texto) {
  const textoNormalizado = normalizarTexto(texto);

  const aliases = {
    "santa ines": "Santa Inês",
    "santa inês": "Santa Inês",
    "alto alegre": "Alto Alegre do Pindaré",
    "alto alegre do pindare": "Alto Alegre do Pindaré",
    "aal": "Alto Alegre do Pindaré",
    "acailandia": "Açailândia",
    "açailandia": "Açailândia",
    "maraba": "Marabá",
    "marabá": "Marabá",
    "sao luis": "São Luís",
    "são luis": "São Luís",
    "vitoria do mearim": "Vitória do Mearim",
    "vitória do mearim": "Vitória do Mearim"
  };

  for (const [alias, localidade] of Object.entries(aliases)) {
    if (textoNormalizado.includes(normalizarTexto(alias))) {
      return localidade;
    }
  }

  for (const localidades of Object.values(LOCALIDADES_POR_REGIONAL)) {
    for (const localidade of localidades) {
      if (textoNormalizado.includes(normalizarTexto(localidade))) {
        return localidade;
      }
    }
  }

  return "";
}

/* =====================================================
   EXTRAÇÃO DOS MATERIAIS
===================================================== */

function extrairMateriaisDasLinhas(linhas, estruturadas = []) {
  const materiaisPorCoordenadas =
    extrairMateriaisPorCoordenadas(estruturadas);

  if (materiaisPorCoordenadas.length) {
    adicionarLog(
      "ok",
      `${materiaisPorCoordenadas.length} material(is) identificado(s) por leitura estruturada da tabela.`
    );

    return materiaisPorCoordenadas;
  }

  const blocos = montarBlocosMateriais(linhas);

  const materiaisPorBloco = blocos
    .map(analisarBlocoMaterial)
    .filter(Boolean);

  const materiaisPorLinha = linhas
    .map(analisarLinhaMaterial)
    .filter(Boolean);

  const materiaisPorTextoContinuo = extrairMateriaisPorTextoContinuo(linhas);

  const todosMateriais = removerMateriaisDuplicados([
    ...materiaisPorBloco,
    ...materiaisPorLinha,
    ...materiaisPorTextoContinuo
  ]);

  if (todosMateriais.length) {
    adicionarLog(
      "ok",
      `${todosMateriais.length} material(is) identificado(s) no PDF.`
    );
  }

  return todosMateriais;
}

function extrairMateriaisPorCoordenadas(linhasEstruturadas = []) {
  if (!Array.isArray(linhasEstruturadas) || !linhasEstruturadas.length) {
    return [];
  }

  const porPagina = new Map();

  linhasEstruturadas.forEach((linha) => {
    if (!porPagina.has(linha.pagina)) {
      porPagina.set(linha.pagina, []);
    }

    porPagina.get(linha.pagina).push(linha);
  });

  const materiais = [];

  porPagina.forEach((linhasPagina) => {
    const linhas = linhasPagina
      .slice()
      .sort((a, b) => a.ordem - b.ordem);

    const indiceCabecalho = linhas.findIndex((linha) => {
      const texto = normalizarTexto(linha.texto);

      return (
        texto.includes("item codigo") ||
        texto.includes("descricao do material")
      );
    });

    if (indiceCabecalho < 0) {
      return;
    }

    let indiceFim = linhas.findIndex((linha, indice) => {
      if (indice <= indiceCabecalho) {
        return false;
      }

      const texto = normalizarTexto(linha.texto);

      return (
        texto.includes("grupo planejamento") ||
        texto === "total" ||
        texto.includes("observacao") ||
        texto.includes("data liberacao")
      );
    });

    if (indiceFim < 0) {
      indiceFim = linhas.length;
    }

    const layout = detectarLayoutTabelaPDF(
      linhas,
      indiceCabecalho,
      indiceFim
    );

    const marcadores = [];

    for (let indice = indiceCabecalho + 1; indice < indiceFim; indice++) {
      const marcador = identificarLinhaMarcadorMaterial(
        linhas[indice],
        layout
      );

      if (marcador) {
        marcadores.push({
          ...marcador,
          indice
        });
      }
    }

    marcadores.forEach((marcador, posicao) => {
      const marcadorAnterior = marcadores[posicao - 1];
      const proximoMarcador = marcadores[posicao + 1];

      const inicio = marcadorAnterior
        ? Math.floor((marcadorAnterior.indice + marcador.indice) / 2) + 1
        : indiceCabecalho + 1;

      const fim = proximoMarcador
        ? Math.floor((marcador.indice + proximoMarcador.indice) / 2)
        : indiceFim - 1;

      const linhasDoItem = linhas
        .slice(inicio, fim + 1)
        .filter((linha) => {
          const texto = normalizarTexto(linha.texto);

          return (
            texto &&
            !linhaEhCabecalhoOuRodape(linha.texto) &&
            !texto.includes("grupo planejamento") &&
            !texto.includes("total")
          );
        });

      const descricao = extrairDescricaoPorCoordenada(
        linhasDoItem,
        layout
      );

      const unidade = extrairTextoZonaCoordenada(
        linhasDoItem,
        layout.unidadeInicio,
        layout.qtdInicio
      );

      const quantidadeTexto = extrairTextoZonaCoordenada(
        linhasDoItem,
        layout.qtdInicio,
        layout.precoUnitarioInicio
      );

      const precoUnitarioTexto = extrairTextoZonaCoordenada(
        linhasDoItem,
        layout.precoUnitarioInicio,
        layout.precoTotalInicio
      );

      const precoTotalTexto = extrairTextoZonaCoordenada(
        linhasDoItem,
        layout.precoTotalInicio,
        Number.POSITIVE_INFINITY
      );

      const fallbackFinal = extrairFinalMaterialDoTexto(
        linhasDoItem.map((linha) => linha.texto).join(" ")
      );

      const material = {
        itemOriginal: marcador.itemOriginal,

        codigo: marcador.codigo,

        descricao:
          descricao ||
          fallbackFinal.descricao ||
          "",

        unidade:
          normalizarUnidade(unidade) ||
          fallbackFinal.unidade ||
          "",

        quantidade:
          primeiroNumeroBR(quantidadeTexto) ||
          fallbackFinal.quantidade ||
          0,

        precoUnitario:
          primeiroNumeroBR(precoUnitarioTexto) ||
          fallbackFinal.precoUnitario ||
          0,

        precoTotal:
          ultimoNumeroBR(precoTotalTexto) ||
          fallbackFinal.precoTotal ||
          0,

        observacao: "Extraído da RM"
      };

      if (
        material.codigo &&
        material.descricao &&
        material.unidade &&
        material.quantidade > 0
      ) {
        materiais.push(material);
      }
    });
  });

  return removerMateriaisDuplicados(materiais);
}

function detectarLayoutTabelaPDF(linhas, indiceCabecalho, indiceFim) {
  const linhasCabecalho = linhas
    .slice(
      Math.max(0, indiceCabecalho - 2),
      Math.min(linhas.length, indiceCabecalho + 4)
    );

  const itensCabecalho = linhasCabecalho
    .flatMap((linha) => linha.itens || []);

  const itensTabela = linhas
    .slice(indiceCabecalho + 1, indiceFim)
    .flatMap((linha) => linha.itens || []);

  const todosX = itensTabela
    .map((item) => Number(item.x))
    .filter(Number.isFinite);

  const xMin = Math.min(...todosX, 0);
  const xMax = Math.max(...todosX, 800);
  const largura = Math.max(1, xMax - xMin);

  const buscarXCabecalho = (predicado) => {
    const encontrado = itensCabecalho.find((item) =>
      predicado(normalizarTexto(item.texto), item)
    );

    return encontrado ? Number(encontrado.x) : NaN;
  };

  let xCodigo = buscarXCabecalho((texto) => texto.includes("codigo"));
  let xDescricao = buscarXCabecalho((texto) => texto.includes("descricao"));
  let xUnidade = buscarXCabecalho((texto) => texto.includes("unidade"));
  let xQtd = buscarXCabecalho((texto) => texto === "qtd" || texto.includes("qtd"));

  const precosCabecalho = itensCabecalho
    .filter((item) => normalizarTexto(item.texto).includes("preco"))
    .map((item) => Number(item.x))
    .filter(Number.isFinite)
    .sort((a, b) => a - b);

  let xPrecoUnitario = precosCabecalho[0];
  let xPrecoTotal = precosCabecalho[precosCabecalho.length - 1];

  const unidadeXs = itensTabela
    .filter((item) => ehTextoUnidade(item.texto))
    .map((item) => Number(item.x))
    .filter(Number.isFinite);

  if (!Number.isFinite(xUnidade) && unidadeXs.length) {
    xUnidade = mediana(unidadeXs);
  }

  if (!Number.isFinite(xCodigo)) {
    xCodigo = xMin + largura * 0.08;
  }

  if (!Number.isFinite(xDescricao)) {
    xDescricao = xMin + largura * 0.16;
  }

  if (!Number.isFinite(xUnidade)) {
    xUnidade = xMin + largura * 0.56;
  }

  if (!Number.isFinite(xQtd)) {
    xQtd = xMin + largura * 0.68;
  }

  if (!Number.isFinite(xPrecoUnitario)) {
    xPrecoUnitario = xMin + largura * 0.78;
  }

  if (!Number.isFinite(xPrecoTotal)) {
    xPrecoTotal = xMin + largura * 0.88;
  }

  const descInicio = Math.min(
    xDescricao - 8,
    xCodigo + 25
  );

  return {
    descInicio,
    unidadeInicio: xUnidade - 10,
    qtdInicio: xQtd - 10,
    precoUnitarioInicio: xPrecoUnitario - 10,
    precoTotalInicio: xPrecoTotal - 10
  };
}

function identificarLinhaMarcadorMaterial(linha, layout) {
  const texto = String(linha?.texto || "").trim();

  const direto = texto.match(
    /^(\d{1,3})\s+(\d{2,10})\b/
  );

  if (direto) {
    return {
      itemOriginal: direto[1],
      codigo: direto[2]
    };
  }

  const itens = Array.isArray(linha?.itens)
    ? linha.itens.slice().sort((a, b) => a.x - b.x)
    : [];

  const itensAntesDescricao = itens.filter((item) =>
    Number(item.x) < layout.descInicio
  );

  const numeros = itensAntesDescricao
    .filter((item) => /^\d{1,10}$/.test(String(item.texto || "").trim()))
    .map((item) => String(item.texto || "").trim());

  if (numeros.length >= 2) {
    const itemOriginal = numeros[0];
    const codigo = numeros[1];

    if (
      /^\d{1,3}$/.test(itemOriginal) &&
      /^\d{2,10}$/.test(codigo)
    ) {
      return {
        itemOriginal,
        codigo
      };
    }
  }

  return null;
}

function extrairDescricaoPorCoordenada(linhasDoItem, layout) {
  const partes = [];

  linhasDoItem.forEach((linha) => {
    const itens = Array.isArray(linha.itens)
      ? linha.itens.slice().sort((a, b) => a.x - b.x)
      : [];

    itens.forEach((item) => {
      const x = Number(item.x);
      const texto = String(item.texto || "").trim();

      if (!texto) {
        return;
      }

      if (
        x >= layout.descInicio &&
        x < layout.unidadeInicio &&
        !ehTextoSomenteNumero(texto) &&
        !ehTextoUnidade(texto) &&
        !linhaEhCabecalhoOuRodape(texto)
      ) {
        partes.push(texto);
      }
    });
  });

  return limparTextoCampo(
    partes
      .join(" ")
      .replace(/\s+/g, " ")
  );
}

function extrairTextoZonaCoordenada(linhasDoItem, inicioX, fimX) {
  const partes = [];

  linhasDoItem.forEach((linha) => {
    const itens = Array.isArray(linha.itens)
      ? linha.itens.slice().sort((a, b) => a.x - b.x)
      : [];

    itens.forEach((item) => {
      const x = Number(item.x);

      if (x >= inicioX && x < fimX) {
        partes.push(String(item.texto || "").trim());
      }
    });
  });

  return partes
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function extrairFinalMaterialDoTexto(textoOriginal) {
  const texto = String(textoOriginal || "")
    .replace(/\s+/g, " ")
    .replace(/R\s+\$/g, "R$")
    .trim();

  const regex = new RegExp(
    `(.+?)\\s+${REGEX_UNIDADES_MATERIAL.source}\\s+([\\d.,]+)\\s+(?:R\\$\\s*)?([\\d.,]+)\\s+(?:R\\$\\s*)?([\\d.,]+)`,
    "i"
  );

  const match = texto.match(regex);

  if (!match) {
    return {
      descricao: "",
      unidade: "",
      quantidade: 0,
      precoUnitario: 0,
      precoTotal: 0
    };
  }

  let descricao = limparTextoCampo(match[1]);

  descricao = descricao
    .replace(/^\d{1,3}\s+\d{2,10}\s*/, "")
    .trim();

  return {
    descricao,
    unidade: normalizarUnidade(match[2]),
    quantidade: numeroBR(match[3]),
    precoUnitario: numeroBR(match[4]),
    precoTotal: numeroBR(match[5])
  };
}

function montarBlocosMateriais(linhas = []) {
  const blocos = [];

  let dentroTabela = false;
  let blocoAtual = [];

  const finalizarBloco = () => {
    if (blocoAtual.length) {
      blocos.push([...blocoAtual]);
    }

    blocoAtual = [];
  };

  for (let indice = 0; indice < linhas.length; indice++) {
    const linha = String(linhas[indice] || "")
      .replace(/\s+/g, " ")
      .trim();

    const proximaLinha = String(linhas[indice + 1] || "")
      .replace(/\s+/g, " ")
      .trim();

    if (!linha) {
      continue;
    }

    const textoNormalizado = normalizarTexto(linha);

    const encontrouCabecalho =
      textoNormalizado.includes("item codigo descricao") ||
      textoNormalizado.includes("item codigo descricao do material") ||
      textoNormalizado.includes("descricao do material unidade qtd") ||
      textoNormalizado.includes("preco unitario preco total");

    if (encontrouCabecalho) {
      dentroTabela = true;
      continue;
    }

    const chegouFimTabela =
      dentroTabela &&
      (
        textoNormalizado.includes("grupo planejamento") ||
        textoNormalizado === "total" ||
        textoNormalizado.includes("total geral") ||
        textoNormalizado.includes("observacao") ||
        textoNormalizado.includes("data liberacao") ||
        textoNormalizado.includes("sodexo inspetor") ||
        textoNormalizado.includes("fiscalizacao vale")
      );

    if (chegouFimTabela) {
      finalizarBloco();
      dentroTabela = false;
      continue;
    }

    const iniciaMaterial = linhaIniciaNovoMaterial(
      linha,
      proximaLinha
    );

    if (!dentroTabela && iniciaMaterial) {
      dentroTabela = true;
    }

    if (!dentroTabela) {
      continue;
    }

    if (linhaEhCabecalhoOuRodape(linha)) {
      continue;
    }

    if (iniciaMaterial) {
      finalizarBloco();
      blocoAtual.push(linha);
      continue;
    }

    if (blocoAtual.length) {
      blocoAtual.push(linha);
    }
  }

  finalizarBloco();

  return blocos;
}

function linhaIniciaNovoMaterial(linha, proximaLinha = "") {
  const atual = String(linha || "")
    .replace(/\s+/g, " ")
    .trim();

  const proxima = String(proximaLinha || "")
    .replace(/\s+/g, " ")
    .trim();

  if (/^\d{1,3}\s+\d{2,10}\b/.test(atual)) {
    return true;
  }

  if (
    /^\d{1,3}$/.test(atual) &&
    /^\d{2,10}\b/.test(proxima)
  ) {
    return true;
  }

  return false;
}

function extrairMateriaisPorTextoContinuo(linhas = []) {
  const texto = linhas
    .join(" ")
    .replace(/\s+/g, " ")
    .replace(/R\s+\$/g, "R$")
    .replace(/GRUPO\s+PLANEJAMENTO.*$/i, " ")
    .trim();

  if (!texto) {
    return [];
  }

  const materiais = [];
  const regexInicio = /(?:^|\s)(\d{1,3})\s+(\d{2,10})\s+/g;
  const inicios = [];

  let match;

  while ((match = regexInicio.exec(texto)) !== null) {
    inicios.push({
      index: match.index,
      item: match[1],
      codigo: match[2]
    });
  }

  for (let i = 0; i < inicios.length; i++) {
    const inicioAtual = inicios[i];
    const inicioProximo = inicios[i + 1];

    const bloco = texto
      .slice(
        inicioAtual.index,
        inicioProximo ? inicioProximo.index : texto.length
      )
      .trim();

    const material = analisarBlocoMaterial([bloco]);

    if (material) {
      materiais.push(material);
    }
  }

  return materiais;
}

function analisarBlocoMaterial(bloco = []) {
  const texto = bloco
    .join(" ")
    .replace(/\s+/g, " ")
    .replace(/R\s+\$/g, "R$")
    .replace(/GRUPO\s+PLANEJAMENTO.*$/i, "")
    .replace(/\bTOTAL\b.*$/i, "")
    .trim();

  if (!texto) {
    return null;
  }

  const inicio = texto.match(
    /^(\d{1,3})\s+(\d{2,10})\s+(.+)$/i
  );

  if (!inicio) {
    return analisarLinhaMaterial(texto);
  }

  const itemOriginal = inicio[1];
  const codigo = inicio[2];
  const restante = inicio[3];

  const unidades = [
    "Pe[çc]a",
    "Peca",
    "Pe[çc]as",
    "Pecas",
    "PÇ",
    "PC",
    "Unidade",
    "Unidades",
    "Unid\\.?",
    "UND",
    "und",
    "UN",
    "Kg",
    "KG",
    "kg",
    "Quilo",
    "Quilos",
    "m²",
    "M²",
    "m2",
    "M2",
    "m³",
    "M³",
    "m3",
    "M3",
    "Metro",
    "Metros",
    "M",
    "Lata",
    "Latas",
    "LT",
    "Litro",
    "Litros",
    "L",
    "Caixa",
    "Caixas",
    "CX",
    "Rolo",
    "Rolos",
    "Saco",
    "Sacos",
    "Barra",
    "Barras",
    "Par",
    "Pares",
    "Conjunto",
    "CJ",
    "Balde",
    "Baldes",
    "Gal[aã]o",
    "Gal[õo]es",
    "Galao",
    "Galoes",
    "Verba",
    "und"
  ].join("|");

  const regexFinal = new RegExp(
    `^(.+?)\\s+(${unidades})\\s+([\\d.,]+)\\s+(?:R\\$\\s*)?([\\d.,]+)\\s+(?:R\\$\\s*)?([\\d.,]+)$`,
    "i"
  );

  const match = restante.match(regexFinal);

  if (!match) {
    return analisarLinhaMaterial(texto);
  }

  const item = {
    itemOriginal,
    codigo,
    descricao: limparTextoCampo(match[1]),
    unidade: normalizarUnidade(match[2]),
    quantidade: numeroBR(match[3]),
    precoUnitario: numeroBR(match[4]),
    precoTotal: numeroBR(match[5]),
    observacao: "Extraído da RM"
  };

  if (
    item.codigo &&
    item.descricao &&
    item.unidade &&
    item.quantidade > 0
  ) {
    return item;
  }

  return null;
}

function analisarLinhaMaterial(linhaOriginal) {
  const linha = String(linhaOriginal || "")
    .replace(/\s+/g, " ")
    .replace(/R\s+\$/g, "R$")
    .trim();

  if (
    !linha ||
    linha.length < 12 ||
    linhaEhCabecalhoOuRodape(linha)
  ) {
    return null;
  }

  const regexComPreco =
    /^(\d+)?\s*(\d{2,10})\s+(.+?)\s+(Kg|KG|kg|Pe[çc]a|Peca|Pe[çc]as|Pecas|PÇ|PC|Unidade|Unidades|UN|UND|und|Unid\.?|m³|M³|m3|M3|m²|M²|m2|M2|Metro|Metros|M|Lata|Latas|LT|Caixa|Caixas|CX|Rolo|Rolos|Saco|Sacos|Barra|Barras|Par|Pares|Conjunto|CJ|Balde|Baldes|Litro|Litros|L|Gal[aã]o|Gal[õo]es|Galao|Galoes|Verba)\s+([\d.,]+)\s+(?:R\$\s*)?([\d.,]+)\s+(?:R\$\s*)?([\d.,]+)$/i;

  const match = linha.match(regexComPreco);

  if (match) {
    const item = {
      itemOriginal: match[1] || "",
      codigo: match[2],
      descricao: limparTextoCampo(match[3]),
      unidade: normalizarUnidade(match[4]),
      quantidade: numeroBR(match[5]),
      precoUnitario: numeroBR(match[6]),
      precoTotal: numeroBR(match[7]),
      observacao: "Extraído da RM"
    };

    if (
      item.codigo &&
      item.descricao &&
      item.unidade &&
      item.quantidade > 0
    ) {
      return item;
    }
  }

  return analisarLinhaMaterialSemPreco(linha);
}

function analisarLinhaMaterialSemPreco(linhaOriginal) {
  const linha = String(linhaOriginal || "")
    .replace(/\s+/g, " ")
    .trim();

  const qtdMatch = linha.match(
    /(?:^|\s)(\d+(?:[,.]\d{1,3})?)\s*$/
  );

  if (!qtdMatch) {
    return null;
  }

  const quantidade = numeroBR(qtdMatch[1]);

  if (
    !Number.isFinite(quantidade) ||
    quantidade <= 0
  ) {
    return null;
  }

  const antesQuantidade = linha
    .slice(0, qtdMatch.index)
    .trim();

  const unidadeMatch = antesQuantidade.match(
    /(Pe[çc]a|Peca|Pe[çc]as|Pecas|P[çc]|PÇ|PC|Unidade|Unidades|Unid\.?|UND|und|UN|Metro|Metros|M|M2|M²|m²|KG|Kg|kg|Quilo|Quilos|Lata|Latas|LT|Litro|Litros|L|Rolo|Rolos|Caixa|Caixas|CX|CJ|Conjunto|Balde|Baldes|Barra|Barras|Par|Pares|Saco|Sacos|Gal[aã]o|Gal[õo]es|Galao|Galoes|Verba|m³|M³|m3|M3)\s*$/i
  );

  if (!unidadeMatch) {
    return null;
  }

  const unidade = normalizarUnidade(unidadeMatch[1]);

  const antesUnidade = antesQuantidade
    .slice(0, unidadeMatch.index)
    .trim();

  const numeros = [...antesUnidade.matchAll(/\b\d{2,10}\b/g)];

  if (!numeros.length) {
    return null;
  }

  const codigoMatch = numeros[0];
  const codigo = codigoMatch[0];

  const inicioDescricao = codigoMatch.index + codigo.length;

  const descricao = antesUnidade
    .slice(inicioDescricao)
    .replace(/^[-–—:|]+/, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!descricao || descricao.length < 2) {
    return null;
  }

  return {
    itemOriginal: "",
    codigo,
    descricao,
    unidade,
    quantidade,
    precoUnitario: 0,
    precoTotal: 0,
    observacao: "Extraído sem preço"
  };
}

function removerMateriaisDuplicados(lista) {
  const mapa = new Map();

  lista.forEach((item, index) => {
    const itemOriginal = String(
      item.itemOriginal || ""
    ).trim();

    const chave = itemOriginal
      ? [
        "item",
        itemOriginal,
        normalizarTexto(item.codigo),
        normalizarTexto(item.descricao),
        normalizarTexto(item.unidade),
        Number(item.quantidade || 0).toFixed(2),
        Number(item.precoUnitario || 0).toFixed(2),
        Number(item.precoTotal || 0).toFixed(2)
      ].join("|")
      : [
        "sem-item",
        index,
        normalizarTexto(item.codigo),
        normalizarTexto(item.descricao),
        normalizarTexto(item.unidade),
        Number(item.quantidade || 0).toFixed(2),
        Number(item.precoUnitario || 0).toFixed(2),
        Number(item.precoTotal || 0).toFixed(2)
      ].join("|");

    if (!mapa.has(chave)) {
      mapa.set(chave, item);
    }
  });

  return Array.from(mapa.values())
    .sort((a, b) => {
      const itemA = Number(a.itemOriginal || 9999);
      const itemB = Number(b.itemOriginal || 9999);

      return itemA - itemB;
    });
}

function linhaEhCabecalhoOuRodape(linha) {
  const texto = normalizarTexto(linha);

  const proibidos = [
    "codigo descricao",
    "descricao do material",
    "unidade qtd",
    "unidade qtde",
    "preco unitario",
    "preco total",
    "pagina",
    "page",
    "total geral",
    "assinatura",
    "aprovador",
    "solicitante",
    "requisitante",
    "data de emissao",
    "observacao",
    "requisicao de material",
    "price list",
    "sodexo",
    "servicos de qualidade de vida"
  ];

  return proibidos.some((termo) => texto.includes(termo));
}

/* =====================================================
   TABELA DE MATERIAIS
===================================================== */

function renderizarTabelaMateriais() {
  const tbody = document.getElementById("tbodyMateriais");

  if (!tbody) {
    return;
  }

  tbody.innerHTML = "";

  if (!materiaisExtraidos.length) {
    tbody.innerHTML = `
      <tr>
        <td colspan="9">
          Nenhum material extraído. Importe e leia um PDF para iniciar.
        </td>
      </tr>
    `;

    return;
  }

  materiaisExtraidos.forEach((item, index) => {
    const tr = document.createElement("tr");

    tr.dataset.index = String(index);

    tr.innerHTML = `
      <td>
        ${index + 1}
      </td>

      <td>
        <input
          type="text"
          class="input-codigo"
          value="${escaparHTML(item.codigo)}"
          placeholder="Código"
        >
      </td>

      <td class="col-descricao">
        <input
          type="text"
          class="input-descricao"
          value="${escaparHTML(item.descricao)}"
          placeholder="Descrição do material"
        >
      </td>

      <td>
        <input
          type="text"
          class="input-unidade"
          value="${escaparHTML(item.unidade)}"
          placeholder="Unidade"
        >
      </td>

      <td>
        <input
          type="number"
          class="input-quantidade"
          min="0"
          step="0.01"
          value="${Number(item.quantidade || 0)}"
          placeholder="Qtd"
        >
      </td>

      <td>
        <input
          type="number"
          class="input-preco-unitario"
          min="0"
          step="0.01"
          value="${Number(item.precoUnitario || 0)}"
          placeholder="Preço unitário"
        >
      </td>

      <td>
        <input
          type="number"
          class="input-preco-total"
          min="0"
          step="0.01"
          value="${Number(item.precoTotal || 0)}"
          placeholder="Preço total"
        >
      </td>

      <td class="col-observacao">
        <input
          type="text"
          class="input-observacao"
          value="${escaparHTML(item.observacao || "")}"
          placeholder="Observação"
        >
      </td>

      <td>
        <button
          type="button"
          class="btn-remover-item"
          title="Remover item"
          data-index="${index}"
        >
          <i class="fa-solid fa-trash"></i>
        </button>
      </td>
    `;

    tbody.appendChild(tr);
  });

  tbody
    .querySelectorAll("input")
    .forEach((input) => {
      input.addEventListener("input", () => {
        sincronizarMateriaisDaTabela();
        atualizarResumoCadastro();
      });
    });

  tbody
    .querySelectorAll(".btn-remover-item")
    .forEach((botao) => {
      botao.addEventListener("click", () => {
        sincronizarMateriaisDaTabela();

        const index = Number(botao.dataset.index);

        materiaisExtraidos.splice(index, 1);

        renderizarTabelaMateriais();
        atualizarResumoCadastro();
      });
    });
}

function sincronizarMateriaisDaTabela() {
  const linhas = document.querySelectorAll(
    "#tbodyMateriais tr[data-index]"
  );

  const lista = [];

  linhas.forEach((linha) => {
    const codigo = linha.querySelector(".input-codigo")?.value || "";
    const descricao = linha.querySelector(".input-descricao")?.value || "";
    const unidade = linha.querySelector(".input-unidade")?.value || "";

    const quantidade = numeroBR(
      linha.querySelector(".input-quantidade")?.value || 0
    );

    const precoUnitario = numeroBR(
      linha.querySelector(".input-preco-unitario")?.value || 0
    );

    const precoTotal = numeroBR(
      linha.querySelector(".input-preco-total")?.value || 0
    );

    const observacao = linha.querySelector(".input-observacao")?.value || "";

    if (
      codigo.trim() ||
      descricao.trim() ||
      unidade.trim() ||
      quantidade > 0
    ) {
      lista.push({
        codigo: codigo.trim(),
        descricao: descricao.trim(),
        unidade: unidade.trim(),
        quantidade,
        precoUnitario,
        precoTotal,
        observacao: observacao.trim()
      });
    }
  });

  materiaisExtraidos = lista;
}

function adicionarMaterialManual() {
  sincronizarMateriaisDaTabela();

  materiaisExtraidos.push({
    codigo: "",
    descricao: "",
    unidade: "Unidade",
    quantidade: 1,
    precoUnitario: 0,
    precoTotal: 0,
    observacao: "Item adicionado manualmente"
  });

  renderizarTabelaMateriais();
  atualizarResumoCadastro();
}

function limparMateriais() {
  if (
    materiaisExtraidos.length > 0 &&
    !confirm("Deseja limpar todos os materiais da tabela?")
  ) {
    return;
  }

  materiaisExtraidos = [];

  renderizarTabelaMateriais();
  atualizarResumoCadastro();

  adicionarLog(
    "alerta",
    "Lista de materiais limpa pelo usuário."
  );
}

/* =====================================================
   MODAL DE CONFIRMAÇÃO
===================================================== */

function abrirModalConfirmacao() {
  sincronizarMateriaisDaTabela();

  const validacao = validarRequisicao();

  if (!validacao.ok) {
    alert(validacao.mensagem);
    adicionarLog("erro", validacao.mensagem);
    return;
  }

  setTexto("confirmRM", getValor("numeroRM") || "-");
  setTexto("confirmOM", getValor("numeroOM") || "-");
  setTexto("confirmLocalidade", getValor("localidade") || "-");
  setTexto("confirmContrato", getValor("contrato") || "-");
  setTexto("confirmTotalItens", String(materiaisExtraidos.length));

  setTexto(
    "confirmQuantidadeTotal",
    formatarNumero(calcularQuantidadeTotal())
  );

  setTexto(
    "confirmValorTotal",
    formatarMoedaBR(obterValorTotalConfirmacao())
  );

  const modal = document.getElementById("modalConfirmarSalvar");

  modal?.classList.add("ativo");
  modal?.setAttribute("aria-hidden", "false");

  document.body.classList.add("modal-aberto");
}

function fecharModalConfirmacao() {
  const modal = document.getElementById("modalConfirmarSalvar");

  modal?.classList.remove("ativo");
  modal?.setAttribute("aria-hidden", "true");

  document.body.classList.remove("modal-aberto");
}

/* =====================================================
   SALVAR NO FIREBASE
===================================================== */

async function salvarRequisicao() {
  sincronizarMateriaisDaTabela();

  const validacao = validarRequisicao();

  if (!validacao.ok) {
    alert(validacao.mensagem);
    return;
  }

  const btnConfirmar = document.getElementById("btnConfirmarSalvar");
  const textoOriginal = btnConfirmar?.innerHTML;

  try {
    if (btnConfirmar) {
      btnConfirmar.disabled = true;
      btnConfirmar.innerHTML =
        '<i class="fa-solid fa-spinner fa-spin"></i> Enviando...';
    }

    const payload = {
      numeroRM: getValor("numeroRM"),
      numeroOM: getValor("numeroOM"),
      titulo: getValor("tituloRequisicao"),

      contrato: getValor("contrato"),
      tipoCadastro: getValor("contrato"),

      regional: getValor("regional"),
      localidade: getValor("localidade"),
      centroCusto: getValor("centroCusto"),
      localRM: getValor("localRM"),
      viaRM: getValor("viaRM"),

      valorTotalRM: numeroBR(getValor("valorTotalRM")),

      solicitante: getValor("solicitante"),
      dataRequisicao: getValor("dataRequisicao"),

      status: "Pendente",
      statusAprovacao: "Pendente de Aprovação",
      aplicada: false,

      observacoes: getValor("observacoesRequisicao"),

      origemArquivo: arquivoSelecionado ? "PDF" : "Manual",

      tipoDocumento: "REQUISIÇÃO DE MATERIAL PRICE LIST",

      arquivo: {
        nome: arquivoSelecionado?.name || "",
        tamanho: arquivoSelecionado?.size || 0,

        tamanhoFormatado: arquivoSelecionado
          ? formatarTamanhoArquivo(arquivoSelecionado.size)
          : "",

        paginas: totalPaginasPDF || 0,
        mime: arquivoSelecionado?.type || ""
      },

      materiais: materiaisExtraidos.map((item, index) => ({
        item: index + 1,
        itemOriginal: item.itemOriginal || "",

        codigo: item.codigo || "",
        descricao: item.descricao || "",
        unidade: item.unidade || "",

        quantidade: numeroBR(item.quantidade),
        precoUnitario: numeroBR(item.precoUnitario),
        precoTotal: numeroBR(item.precoTotal),

        observacao: item.observacao || ""
      })),

      resumo: {
        totalMateriais: materiaisExtraidos.length,
        quantidadeTotal: calcularQuantidadeTotal(),
        valorTotalMateriais: calcularValorTotalMateriais(),
        valorTotalRM: obterValorTotalConfirmacao()
      },

      leituraPDF: {
        textoExtraido: limitarTextoFirestore(
          textoExtraidoCompleto,
          50000
        ),

        textoLimitado: textoExtraidoCompleto.length > 50000,

        paginasTexto: paginasTextoExtraido.map((pagina) => ({
          pagina: pagina.pagina,

          texto: limitarTextoFirestore(
            pagina.texto,
            15000
          )
        }))
      },

      criadoPor: {
        uid: obterUidUsuario(),
        nome: obterNomeUsuario(),
        email: obterEmailUsuario(),
        role: obterPerfilUsuario(),
        regional: obterRegionalUsuario()
      },

      criadoPorUid: obterUidUsuario(),
      criadoPorEmail: obterEmailUsuario(),
      criadoPorRegional: obterRegionalUsuario(),

      enviadoParaAprovacaoEm: serverTimestamp(),
      criadoEm: serverTimestamp(),
      atualizadoEm: serverTimestamp()
    };

    await addDoc(
      collection(db, COLECAO_RMS),
      payload
    );

    fecharModalConfirmacao();

    atualizarStatusTela(
      "RM enviada",
      "Requisição enviada para aprovação",
      "ok"
    );

    setBadgeConferencia(
      "Pendente de Aprovação",
      "pendente"
    );

    adicionarLog(
      "ok",
      "Requisição de materiais enviada para aprovação com sucesso."
    );

    alert("Requisição enviada para aprovação com sucesso!");

    rmsJaCarregadas = false;

    await carregarRMsCadastradas();

    abrirAba("cadastradas");
  } catch (error) {
    console.error("Erro ao salvar requisição:", error);

    adicionarLog(
      "erro",
      "Erro ao enviar a requisição para aprovação. Verifique as permissões do Firestore."
    );

    alert("Erro ao enviar a requisição. Verifique o console do navegador.");
  } finally {
    if (btnConfirmar) {
      btnConfirmar.disabled = false;

      btnConfirmar.innerHTML =
        textoOriginal ||
        '<i class="fa-solid fa-paper-plane"></i> Enviar para Aprovação';
    }
  }
}

function validarRequisicao() {
  if (!getValor("numeroRM")) {
    return {
      ok: false,
      mensagem: "Informe o número da RM."
    };
  }

  if (!getValor("numeroOM")) {
    return {
      ok: false,
      mensagem: "Informe o número da Ordem de Manutenção."
    };
  }

  if (!getValor("tituloRequisicao")) {
    return {
      ok: false,
      mensagem: "Informe a descrição da ordem."
    };
  }

  if (!getValor("contrato")) {
    return {
      ok: false,
      mensagem: "Selecione o contrato: Manutenção Predial ou Pequenas Obras."
    };
  }

  if (!CONTRATOS_VALIDOS.includes(getValor("contrato"))) {
    return {
      ok: false,
      mensagem: "Contrato inválido."
    };
  }

  if (!getValor("regional")) {
    return {
      ok: false,
      mensagem: "Informe a Regional da requisição."
    };
  }

  if (!getValor("localidade")) {
    return {
      ok: false,
      mensagem: "Informe a localidade da requisição."
    };
  }

  if (!materiaisExtraidos.length) {
    return {
      ok: false,
      mensagem: "Adicione pelo menos um material antes de enviar para aprovação."
    };
  }

  const itemInvalido = materiaisExtraidos.find((item) =>
    !item.codigo ||
    !item.descricao ||
    !item.unidade ||
    numeroBR(item.quantidade) <= 0
  );

  if (itemInvalido) {
    return {
      ok: false,
      mensagem: "Existe material sem código, descrição, unidade ou quantidade válida."
    };
  }

  return {
    ok: true,
    mensagem: ""
  };
}

/* =====================================================
   LIMPEZA
===================================================== */

function limparTudo() {
  if (
    arquivoSelecionado ||
    materiaisExtraidos.length > 0
  ) {
    const confirmar = confirm(
      "Deseja limpar os dados da importação atual?"
    );

    if (!confirmar) {
      return;
    }
  }

  arquivoSelecionado = null;
  textoExtraidoCompleto = "";
  paginasTextoExtraido = [];
  linhasPDFEstruturadas = [];
  materiaisExtraidos = [];
  totalPaginasPDF = 0;

  const arquivoPDF = document.getElementById("arquivoPDF");

  if (arquivoPDF) {
    arquivoPDF.value = "";
  }

  setTexto("nomeArquivo", "Nenhum arquivo selecionado");
  setTexto("tamanhoArquivo", "-");
  setTexto("paginasLidas", "0");

  setProgresso(0);

  limparFormulario();

  renderizarTabelaMateriais();
  atualizarResumoCadastro();

  const btnLerPDF = document.getElementById("btnLerPDF");

  if (btnLerPDF) {
    btnLerPDF.disabled = true;
  }

  atualizarStatusTela(
    "Aguardando PDF",
    "Importe um arquivo para iniciar",
    "pendente"
  );

  setBadgeConferencia(
    "Conferência pendente",
    "pendente"
  );

  adicionarLog(
    "info",
    "Tela limpa. Aguardando novo PDF."
  );
}

function limparFormulario() {
  [
    "numeroRM",
    "numeroOM",
    "tituloRequisicao",
    "contrato",
    "centroCusto",
    "localRM",
    "viaRM",
    "valorTotalRM",
    "solicitante",
    "observacoesRequisicao"
  ].forEach((id) => setValor(id, ""));

  setValor("regional", "");

  preencherLocalidades();

  setValor("localidade", "");

  preencherDataAtual();
}

/* =====================================================
   RESUMO E STATUS
===================================================== */

function atualizarResumoCadastro() {
  setTexto("totalMateriais", materiaisExtraidos.length);

  setTexto(
    "quantidadeTotal",
    formatarNumero(calcularQuantidadeTotal())
  );

  setTexto("resumoRM", getValor("numeroRM") || "-");
  setTexto("resumoQtdMateriais", materiaisExtraidos.length);
}

function atualizarStatusTela(titulo, subtitulo, tipo) {
  const status = document.getElementById("statusImportacao");

  if (status) {
    status.textContent = titulo;

    status.classList.remove(
      "status-ok-texto",
      "status-erro-texto",
      "status-alerta-texto",
      "status-pendente-texto",
      "status-processando-texto"
    );

    status.classList.add(
      `status-${tipo || "pendente"}-texto`
    );
  }

  const linhaStatus = status?.closest(".info-linha");

  if (linhaStatus) {
    linhaStatus.title = subtitulo || "";
  }
}

function setBadgeConferencia(texto, tipo) {
  const badge = document.getElementById("badgeConferencia");

  if (!badge) {
    return;
  }

  badge.textContent = texto;

  badge.classList.remove("ok", "erro");

  if (tipo === "ok") {
    badge.classList.add("ok");
  }

  if (tipo === "erro") {
    badge.classList.add("erro");
  }
}

function setProgresso(valor) {
  const porcentagem = Math.max(
    0,
    Math.min(100, Number(valor || 0))
  );

  const barra = document.getElementById("barraProgresso");
  const texto = document.getElementById("textoProgresso");

  if (barra) {
    barra.style.width = `${porcentagem}%`;
  }

  if (texto) {
    texto.textContent = `${porcentagem}%`;
  }
}

function calcularQuantidadeTotal() {
  return materiaisExtraidos.reduce(
    (total, item) => total + numeroBR(item.quantidade),
    0
  );
}

function calcularValorTotalMateriais() {
  return materiaisExtraidos.reduce(
    (total, item) => total + obterValorMaterial(item),
    0
  );
}

function obterValorMaterial(material) {
  const precoTotal = numeroBR(material?.precoTotal);

  if (precoTotal > 0) {
    return precoTotal;
  }

  const quantidade = numeroBR(material?.quantidade);
  const precoUnitario = numeroBR(material?.precoUnitario);

  return quantidade * precoUnitario;
}

function obterValorTotalConfirmacao() {
  const valorCampo = numeroBR(getValor("valorTotalRM"));

  if (valorCampo > 0) {
    return valorCampo;
  }

  return calcularValorTotalMateriais();
}

/* =====================================================
   LOCALIDADE / REGIONAL
===================================================== */

function preencherLocalidades(regionalSelecionada = "") {
  const select = document.getElementById("localidade");

  if (!select) {
    return;
  }

  const valorAtual = select.value;

  const localidades =
    regionalSelecionada &&
    LOCALIDADES_POR_REGIONAL[regionalSelecionada]
      ? LOCALIDADES_POR_REGIONAL[regionalSelecionada]
      : Object.values(LOCALIDADES_POR_REGIONAL).flat();

  select.innerHTML = '<option value="">Selecione</option>';

  localidades.forEach((localidade) => {
    const option = document.createElement("option");

    option.value = localidade;
    option.textContent = localidade;

    select.appendChild(option);
  });

  if (localidades.includes(valorAtual)) {
    select.value = valorAtual;
  }
}

function preencherRegionalPelaLocalidade(localidade) {
  if (!localidade) {
    return;
  }

  for (const [regional, localidades] of Object.entries(LOCALIDADES_POR_REGIONAL)) {
    if (
      localidades.some((item) =>
        normalizarTexto(item) === normalizarTexto(localidade)
      )
    ) {
      setValor("regional", regional);
      preencherLocalidades(regional);
      setValor("localidade", localidade);
      return;
    }
  }
}

/* =====================================================
   LOGS
===================================================== */

function adicionarLog(tipo, mensagem) {
  const box = document.getElementById("logImportacao");

  if (!box) {
    return;
  }

  const div = document.createElement("div");

  div.className = `log-item ${tipo || "info"}`;

  const icone =
    tipo === "ok"
      ? "fa-circle-check"
      : tipo === "erro"
      ? "fa-circle-xmark"
      : tipo === "alerta"
      ? "fa-triangle-exclamation"
      : "fa-circle-info";

  div.innerHTML = `
    <i class="fa-solid ${icone}"></i>
    <span>${escaparHTML(mensagem)}</span>
  `;

  box.prepend(div);
}

/* =====================================================
   UTILITÁRIOS
===================================================== */

function setTexto(id, valor) {
  const elemento = document.getElementById(id);

  if (elemento) {
    elemento.textContent = valor;
  }
}

function setTextoElemento(elemento, valor) {
  if (elemento) {
    elemento.textContent = valor;
  }
}

function setValor(id, valor) {
  const elemento = document.getElementById(id);

  if (elemento) {
    elemento.value = valor || "";
  }
}

function getValor(id) {
  return document
    .getElementById(id)
    ?.value
    ?.trim() || "";
}

function preencherDataAtual() {
  const hoje = new Date();
  const ano = hoje.getFullYear();

  const mes = String(hoje.getMonth() + 1)
    .padStart(2, "0");

  const dia = String(hoje.getDate())
    .padStart(2, "0");

  setValor("dataRequisicao", `${ano}-${mes}-${dia}`);
}

function formatarTamanhoArquivo(bytes) {
  const valor = Number(bytes || 0);

  if (valor < 1024) {
    return `${valor} B`;
  }

  if (valor < 1024 * 1024) {
    return `${(valor / 1024).toFixed(1)} KB`;
  }

  return `${(valor / (1024 * 1024)).toFixed(1)} MB`;
}

function numeroBR(valor) {
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

  let texto = String(valor)
    .trim()
    .replace("R$", "")
    .replace(/[^\d,.-]/g, "");

  if (!texto) {
    return 0;
  }

  if (texto.includes(",")) {
    texto = texto
      .replace(/\./g, "")
      .replace(",", ".");
  } else {
    const partes = texto.split(".");

    if (partes.length > 2) {
      const decimal = partes.pop();

      texto = partes.join("") + "." + decimal;
    }
  }

  const numero = Number(texto);

  return Number.isFinite(numero)
    ? numero
    : 0;
}

function primeiroNumeroBR(texto) {
  const match = String(texto || "").match(/[\d.]+,\d{1,3}|[\d]+/);

  return match
    ? numeroBR(match[0])
    : 0;
}

function ultimoNumeroBR(texto) {
  const matches = String(texto || "").match(/[\d.]+,\d{1,3}|[\d]+/g);

  if (!matches || !matches.length) {
    return 0;
  }

  return numeroBR(matches[matches.length - 1]);
}

function formatarNumero(valor) {
  return Number(valor || 0)
    .toLocaleString(
      "pt-BR",
      {
        minimumFractionDigits: 0,
        maximumFractionDigits: 2
      }
    );
}

function formatarMoedaBR(valor) {
  return numeroBR(valor).toLocaleString(
    "pt-BR",
    {
      style: "currency",
      currency: "BRL"
    }
  );
}

function formatarPercentual(valor) {
  return `${Number(valor || 0)
    .toFixed(2)
    .replace(".", ",")}%`;
}

function normalizarTexto(valor) {
  return String(valor || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[’´`]/g, "'")
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function limparTextoCampo(valor) {
  return String(valor || "")
    .replace(/\s+/g, " ")
    .replace(/^[:\-–—|]+/, "")
    .trim();
}

function normalizarUnidade(valor) {
  const texto = normalizarTexto(valor);

  if (
    texto.includes("peca") ||
    texto === "pc" ||
    texto === "pç"
  ) {
    return "Peça";
  }

  if (
    texto.includes("unidade") ||
    texto === "un" ||
    texto === "und"
  ) {
    return "Unidade";
  }

  if (
    texto === "m3" ||
    texto.includes("m³")
  ) {
    return "m³";
  }

  if (
    texto === "m2" ||
    texto.includes("m²")
  ) {
    return "m²";
  }

  if (
    texto === "m" ||
    texto.includes("metro")
  ) {
    return "Metro";
  }

  if (
    texto === "kg" ||
    texto.includes("quilo")
  ) {
    return "Kg";
  }

  if (
    texto === "l" ||
    texto.includes("litro")
  ) {
    return "Litro";
  }

  if (
    texto === "lt" ||
    texto.includes("lata")
  ) {
    return "Lata";
  }

  if (texto.includes("rolo")) {
    return "Rolo";
  }

  if (
    texto.includes("caixa") ||
    texto === "cx"
  ) {
    return "Caixa";
  }

  if (
    texto === "cj" ||
    texto.includes("conjunto")
  ) {
    return "Conjunto";
  }

  if (texto.includes("balde")) {
    return "Balde";
  }

  if (texto.includes("barra")) {
    return "Barra";
  }

  if (texto.includes("par")) {
    return "Par";
  }

  if (texto.includes("saco")) {
    return "Saco";
  }

  if (texto.includes("galao")) {
    return "Galão";
  }

  if (texto.includes("verba")) {
    return "Verba";
  }

  return limparTextoCampo(valor);
}

function ehTextoUnidade(valor) {
  return REGEX_UNIDADES_MATERIAL.test(String(valor || "").trim());
}

function ehTextoSomenteNumero(valor) {
  return /^[\d.,]+$/.test(String(valor || "").trim());
}

function limitarTextoFirestore(texto, limite) {
  const conteudo = String(texto || "");

  if (conteudo.length <= limite) {
    return conteudo;
  }

  return conteudo.slice(0, limite);
}

function escaparHTML(valor) {
  return String(valor || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function dataInputParaDate(valor, fimDoDia = false) {
  if (!valor) {
    return null;
  }

  const partes = String(valor).split("-");

  if (partes.length !== 3) {
    return null;
  }

  const data = new Date(
    Number(partes[0]),
    Number(partes[1]) - 1,
    Number(partes[2]),
    fimDoDia ? 23 : 0,
    fimDoDia ? 59 : 0,
    fimDoDia ? 59 : 0,
    fimDoDia ? 999 : 0
  );

  if (isNaN(data.getTime())) {
    return null;
  }

  return data;
}

function dataFirestoreParaDate(valor) {
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

  if (
    typeof valor === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(valor)
  ) {
    const partes = valor.split("-");

    return new Date(
      Number(partes[0]),
      Number(partes[1]) - 1,
      Number(partes[2])
    );
  }

  const data = new Date(valor);

  if (isNaN(data.getTime())) {
    return null;
  }

  return data;
}

function formatarDataBR(valor) {
  const data = dataFirestoreParaDate(valor);

  if (!data) {
    return "-";
  }

  return data.toLocaleDateString("pt-BR");
}

function formatarDataHoraBR(valor) {
  const data = dataFirestoreParaDate(valor);

  if (!data) {
    return "-";
  }

  return data.toLocaleString(
    "pt-BR",
    {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    }
  );
}

function obterValorRM(item) {
  const valorDireto = numeroBR(item?.valorTotalRM);

  if (valorDireto > 0) {
    return valorDireto;
  }

  const valorResumo = numeroBR(item?.resumo?.valorTotalRM);

  if (valorResumo > 0) {
    return valorResumo;
  }

  const valorMateriaisResumo = numeroBR(
    item?.resumo?.valorTotalMateriais
  );

  if (valorMateriaisResumo > 0) {
    return valorMateriaisResumo;
  }

  if (
    Array.isArray(item?.materiais) &&
    item.materiais.length
  ) {
    return item.materiais.reduce((total, material) => {
      return total + obterValorMaterial(material);
    }, 0);
  }

  return 0;
}

function limitarTexto(texto, limite) {
  const valor = String(texto || "");

  if (valor.length <= limite) {
    return valor;
  }

  return `${valor.slice(0, limite - 3)}...`;
}

function mediana(lista) {
  const valores = lista
    .map(Number)
    .filter(Number.isFinite)
    .sort((a, b) => a - b);

  if (!valores.length) {
    return NaN;
  }

  const meio = Math.floor(valores.length / 2);

  if (valores.length % 2) {
    return valores[meio];
  }

  return (valores[meio - 1] + valores[meio]) / 2;
}