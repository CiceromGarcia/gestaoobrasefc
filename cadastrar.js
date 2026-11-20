/* =====================================================
   CADASTRAR OBRA
   Arquivo: cadastrar.js
   Versão: v003

   Ajustes:
   - Mantida proteção com authGuard.
   - Cabeçalho com Email e Perfil é preenchido automaticamente.
   - Mantido botão Voltar para retornar ao Dashboard.
===================================================== */

import {
  app,
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

import {
  getFunctions,
  httpsCallable
} from "https://www.gstatic.com/firebasejs/10.12.3/firebase-functions.js";

const functions =
  getFunctions(app, "us-central1");

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

const areaM2 =
  document.getElementById("areaM2");

const dataInicioPrevisto =
  document.getElementById("dataInicioPrevisto");

const dataTerminoPrevisto =
  document.getElementById("dataTerminoPrevisto");

const complexidadeProjeto =
  document.getElementById("complexidadeProjeto");

const situacaoAtivo =
  document.getElementById("situacaoAtivo");

const docasScore =
  document.getElementById("docasScore");

const docasNivel =
  document.getElementById("docasNivel");

const docasBadge =
  document.querySelector(".docas-badge");

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

  "mineirinho": "Regional 1",

  "vila pindare": "Regional 1",
  "vila pindaré": "Regional 1",

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
  "são pedro d água branca": "Regional 3",
  "sao pedro dagua branca": "Regional 3",
  "são pedro dagua branca": "Regional 3"
};

function configurarRegionalAutomatica() {
  if (
    !localidade ||
    !regional
  ) {
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
   COMPLEXIDADE AUTOMÁTICA (A PARTIR DA PRIORIDADE GUT)
   A Matriz DOCAS pede uma Complexidade de Projeto Baixa/Média/Alta.
   Em vez de pedir de novo pro usuário, aproveitamos o nível de
   prioridade que a matriz GUT já calculou (Baixa/Moderada/Alta/
   Crítica), mapeando Crítica para Alta (não existe um 4º nível na
   Matriz DOCAS).
========================================= */

function mapearComplexidadeDaPrioridade(nivelGut) {
  if (nivelGut === "Baixa") {
    return "Baixa";
  }

  if (nivelGut === "Moderada") {
    return "Média";
  }

  if (
    nivelGut === "Alta" ||
    nivelGut === "Crítica"
  ) {
    return "Alta";
  }

  return "";
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

    if (complexidadeProjeto) {
      complexidadeProjeto.value =
        "";
    }

    calcularClassificacaoDocas();

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
    nivel =
      "Baixa";

    cor =
      "#22c55e";
  } else if (total <= 40) {
    nivel =
      "Moderada";

    cor =
      "#f59e0b";
  } else if (total <= 80) {
    nivel =
      "Alta";

    cor =
      "#ef4444";
  } else {
    nivel =
      "Crítica";

    cor =
      "#991b1b";
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

  if (complexidadeProjeto) {
    complexidadeProjeto.value =
      mapearComplexidadeDaPrioridade(nivel);
  }

  calcularClassificacaoDocas();
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
   CLASSIFICAR DEMANDA — MATRIZ DOCAS
   Pontua Duração/Orçamento/Complexidade/Área/Situação do ativo
   (1 a 3 pontos cada, Situação do ativo até 2 pontos) e classifica
   a demanda como Manutenção (total <= 5), Pequena obra/Reforma
   (total 6 a 10) ou Obra (total > 10) — mesma lógica da planilha
   "Anexo V - Matriz DOCAS".
========================================= */

function calcularDuracaoDias() {
  const inicio =
    obterValorCampo("dataInicioPrevisto");

  const fim =
    obterValorCampo("dataTerminoPrevisto");

  if (
    !dataValida(inicio) ||
    !dataValida(fim)
  ) {
    return null;
  }

  const dataInicio =
    new Date(inicio);

  const dataFim =
    new Date(fim);

  const diffMs =
    dataFim - dataInicio;

  if (diffMs < 0) {
    return null;
  }

  return Math.round(
    diffMs / (1000 * 60 * 60 * 24)
  );
}

function pontuarDuracaoDocas(dias) {
  if (dias <= 30) {
    return 1;
  }

  if (dias <= 90) {
    return 2;
  }

  return 3;
}

function pontuarOrcamentoDocas(valor) {
  if (valor <= 100000) {
    return 1;
  }

  if (valor <= 600000) {
    return 2;
  }

  return 3;
}

function pontuarAreaDocas(area) {
  if (area <= 100) {
    return 1;
  }

  if (area <= 200) {
    return 2;
  }

  return 3;
}

function pontuarComplexidadeDocas(complexidade) {
  if (complexidade === "Baixa") {
    return 1;
  }

  if (complexidade === "Média") {
    return 2;
  }

  if (complexidade === "Alta") {
    return 3;
  }

  return null;
}

function pontuarSituacaoAtivoDocas(situacao) {
  if (situacao === "Existente") {
    return 1;
  }

  if (situacao === "Não existente") {
    return 2;
  }

  return null;
}

function classificarTotalDocas(total) {
  if (total <= 5) {
    return "Manutenção";
  }

  if (total <= 10) {
    return "Pequena obra/Reforma";
  }

  return "Obra";
}

function calcularClassificacaoDocas() {
  if (
    !docasScore ||
    !docasNivel ||
    !docasBadge
  ) {
    return null;
  }

  const dias =
    calcularDuracaoDias();

  const valor =
    converterMoedaParaNumero(
      investimento?.value || ""
    );

  const area =
    Number(areaM2?.value);

  const complexidade =
    complexidadeProjeto?.value || "";

  const situacao =
    situacaoAtivo?.value || "";

  const camposCompletos =
    dias !== null &&
    valor > 0 &&
    areaM2?.value !== "" &&
    !isNaN(area) &&
    complexidade !== "" &&
    situacao !== "";

  if (!camposCompletos) {
    docasScore.textContent =
      "--";

    docasNivel.textContent =
      "D/O/C/A/S";

    docasBadge.style.background =
      "#007E7A";

    docasScore.style.color =
      "#fff";

    docasNivel.style.color =
      "#fff";

    return null;
  }

  const d =
    pontuarDuracaoDocas(dias);

  const o =
    pontuarOrcamentoDocas(valor);

  const c =
    pontuarComplexidadeDocas(complexidade);

  const a =
    pontuarAreaDocas(area);

  const s =
    pontuarSituacaoAtivoDocas(situacao);

  const total =
    d + o + c + a + s;

  const classificacao =
    classificarTotalDocas(total);

  docasScore.textContent =
    String(total);

  docasNivel.textContent =
    classificacao;

  let cor =
    "#007E7A";

  if (classificacao === "Manutenção") {
    cor =
      "#ef4444";
  } else if (classificacao === "Pequena obra/Reforma") {
    cor =
      "#22c55e";
  } else if (classificacao === "Obra") {
    cor =
      "#f59e0b";
  }

  docasBadge.style.background =
    cor;

  docasScore.style.color =
    "#fff";

  docasNivel.style.color =
    "#fff";

  return {
    duracaoDias: dias,
    valorOrcamento: valor,
    area,
    complexidade,
    situacaoAtivo: situacao,
    d,
    o,
    c,
    a,
    s,
    total,
    classificacao
  };
}

function configurarEventosDocas() {
  [
    situacaoAtivo,
    dataInicioPrevisto,
    dataTerminoPrevisto,
    areaM2
  ].forEach((campo) => {
    campo?.addEventListener(
      "change",
      calcularClassificacaoDocas
    );

    campo?.addEventListener(
      "input",
      calcularClassificacaoDocas
    );
  });

  investimento?.addEventListener(
    "input",
    calcularClassificacaoDocas
  );

  calcularClassificacaoDocas();
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
    (event) => {
      let valor =
        event.target.value
          .replace(/\D/g, "");

      valor =
        formatarMoedaBR(
          Number(valor) / 100
        );

      event.target.value =
        valor;
    }
  );
}

/* =========================================
   GERAR ID DA OBRA
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
    converterMoedaParaNumero(
      valorInvestimento
    ) <= 0
  ) {
    alert(
      "⚠️ Informe o valor orçado da obra."
    );

    investimento?.focus();

    return false;
  }

  if (
    !obterValorCampo(
      "dataInicioPrevisto"
    )
  ) {
    alert(
      "⚠️ Informe a data de início prevista."
    );

    document
      .getElementById("dataInicioPrevisto")
      ?.focus();

    return false;
  }

  if (
    !obterValorCampo(
      "dataTerminoPrevisto"
    )
  ) {
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

  if (!situacaoAtivo?.value) {
    alert(
      "⚠️ Selecione a Situação do Ativo para calcular a Classificação da Demanda (Matriz DOCAS)."
    );

    situacaoAtivo?.focus();

    return false;
  }

  const classificacaoDocas =
    calcularClassificacaoDocas();

  if (!classificacaoDocas) {
    alert(
      "⚠️ Não foi possível calcular a Classificação da Demanda (Matriz DOCAS). Confira Área, Valor da Obra e as datas de início/término."
    );

    return false;
  }

  if (classificacaoDocas.classificacao === "Manutenção") {
    alert(
      [
        "⚠️ Esta demanda foi classificada como MANUTENÇÃO pela Matriz DOCAS.",
        "",
        `Pontuação: ${classificacaoDocas.total} (Duração ${classificacaoDocas.d} + Orçamento ${classificacaoDocas.o} + Complexidade ${classificacaoDocas.c} + Área ${classificacaoDocas.a} + Situação do ativo ${classificacaoDocas.s})`,
        "",
        "Demandas de manutenção não são cadastradas aqui — siga o fluxo de manutenção."
      ].join("\n")
    );

    return false;
  }

  if (classificacaoDocas.classificacao === "Obra") {
    const desejaContinuar =
      confirm(
        [
          "⚠️ Esta demanda foi classificada como OBRA pela Matriz DOCAS (não Pequena obra/Reforma).",
          "",
          `Pontuação: ${classificacaoDocas.total} (Duração ${classificacaoDocas.d} + Orçamento ${classificacaoDocas.o} + Complexidade ${classificacaoDocas.c} + Área ${classificacaoDocas.a} + Situação do ativo ${classificacaoDocas.s})`,
          "",
          "Mesmo assim, deseja seguir com o planejamento desta obra?",
          "",
          "Se confirmar, uma mensagem de aviso será enviada por WhatsApp para os números cadastrados no sistema."
        ].join("\n")
      );

    if (!desejaContinuar) {
      return false;
    }
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

    codigoObra:
      novoId,

    obraId:
      novoId,

    /* =====================================
       DADOS GERAIS
    ===================================== */

    nomeProjeto:
      obterValorCampo("nomeProjeto"),

    nomeObra:
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

    valorOrcado:
      valorObraFormatado,

    valorObraNumero:
      valorObraNumero,

    investimentoNumero:
      valorObraNumero,

    valorOrcadoNumero:
      valorObraNumero,

    executado:
      "R$ 0,00",

    executadoNumero:
      0,

    valorExecutado:
      "R$ 0,00",

    valorExecutadoNumero:
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
       AVALIAÇÃO DE QUALIDADE (envio automático
       do pedido de pesquisa quando a obra for
       concluída — ver Cloud Function
       sendSurveyOnObraCompleted)
    ===================================== */

    emailAvaliacaoQualidade:
      obterValorCampo("emailAvaliacaoQualidade").toLowerCase(),

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

    dataFimPrevisto:
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
       CLASSIFICAÇÃO DA DEMANDA (MATRIZ DOCAS)
    ===================================== */

    complexidadeProjeto:
      complexidadeProjeto?.value || "",

    situacaoAtivo:
      situacaoAtivo?.value || "",

    docasPontuacao:
      docasScore?.textContent || "",

    classificacaoDocas:
      docasNivel?.textContent || "",

    /* =====================================
       AVANÇO E STATUS
    ===================================== */

    avancoFisico:
      0,

    status:
      "Planejado",

    fase:
      "Planejado",

    planejamentoCurvaSAtivo:
      false,

    replanejamentoNecessario:
      false,

    reprogramacaoNecessaria:
      false,

    /* =====================================
       ESCOPO
    ===================================== */

    escopo:
      obterValorCampo("escopoObra"),

    escopoObra:
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
      usuarioLogadoGlobal?.nome ||
      usuarioLogadoGlobal?.displayName ||
      "",

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

    // Toda obra cadastrada avisa por WhatsApp os números configurados
    // no sistema — falha aqui não deve travar o cadastro, que já foi
    // salvo com sucesso.
    const classificacaoAtual =
      calcularClassificacaoDocas();

    try {
      const notificarObraCadastrada =
        httpsCallable(
          functions,
          "notificarObraCadastrada"
        );

      await notificarObraCadastrada({
        nomeObra: dadosObra.nomeProjeto,
        codigoObra: dadosObra.idProjeto,
        localidade: dadosObra.localidade,
        regional: dadosObra.regional,
        valorObra: dadosObra.valorObra,
        classificacaoDocas:
          classificacaoAtual?.classificacao || "",
        pontuacao:
          classificacaoAtual?.total ?? "",
        solicitante:
          usuarioLogadoGlobal?.nome ||
          usuarioLogadoGlobal?.displayName ||
          usuarioLogadoGlobal?.email ||
          ""
      });
    } catch (erroNotificacao) {
      console.error(
        "Erro ao notificar via WhatsApp sobre nova obra cadastrada:",
        erroNotificacao
      );
    }

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

  configurarEventosDocas();

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