/* =====================================================
   PLANEJAMENTO DA CURVA S
   Arquivo: planejamento.js
   Versão: v003

   Ajustes:
   - Removido botão Voltar.
   - Mantida proteção com authGuard.
   - Email e perfil são exibidos pelo authGuard no cabeçalho.
===================================================== */

import { db } from "./firebaseConfig.js";
import { protegerPagina } from "./authGuard.js";

import {
  collection,
  getDocs,
  doc,
  writeBatch,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.3/firebase-firestore.js";

/* =========================
   USUÁRIO LOGADO
========================= */

let usuarioLogadoGlobal = null;

/* =========================
   ELEMENTOS
========================= */

const selectObra =
  document.getElementById("obra");

const dataInicio =
  document.getElementById("dataInicio");

const dataFim =
  document.getElementById("dataFim");

const valorTotal =
  document.getElementById("valorTotal");

const tbody =
  document.getElementById("tbodyPlanejamento");

/* =========================
   VARIÁVEIS
========================= */

let planejamentoAtual = [];
let graficoFisico = null;
let graficoFinanceiro = null;
let obrasCadastradas = [];
let planejamentosExistentes = [];
let semanasGeradas = [];

/* =========================
   CHART
========================= */

const ChartJS =
  window.Chart;

const ChartDataLabelsPlugin =
  window.ChartDataLabels;

if (
  ChartJS &&
  ChartDataLabelsPlugin
) {
  ChartJS.register(
    ChartDataLabelsPlugin
  );
}

/* =========================
   TEXTO
========================= */

function normalizarTexto(valor) {
  return String(valor || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

/* =========================
   FORMATAR MOEDA
========================= */

function moeda(valor) {
  return Number(valor || 0).toLocaleString(
    "pt-BR",
    {
      style: "currency",
      currency: "BRL",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }
  );
}

/* =========================
   CONVERTER MOEDA PARA NÚMERO
========================= */

function moedaParaNumero(valor) {
  if (
    valor === null ||
    valor === undefined ||
    valor === ""
  ) {
    return 0;
  }

  if (
    typeof valor === "number"
  ) {
    return valor;
  }

  let valorLimpo =
    String(valor)
      .replace("R$", "")
      .replace(/\s/g, "")
      .replace(/\./g, "")
      .replace(",", ".")
      .trim();

  valorLimpo =
    valorLimpo.replace(/[^\d.-]/g, "");

  return Number(valorLimpo) || 0;
}

/* =========================
   FORMATAR PERCENTUAL
========================= */

function percentual(valor) {
  return `${Number(valor || 0)
    .toFixed(2)
    .replace(".", ",")}%`;
}

/* =========================
   PEGAR VALOR DA OBRA
========================= */

function obterValorObra(item) {
  return moedaParaNumero(
    item.valorObraNumero ||
    item.investimentoNumero ||
    item.valorObra ||
    item.valorOrcado ||
    item.valorOrçado ||
    item.valorTotal ||
    item.investimento ||
    item.orcado ||
    item.valor ||
    0
  );
}

/* =========================
   DATA LOCAL
========================= */

function criarDataLocal(valor) {
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

  if (
    typeof valor === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(valor)
  ) {
    const partes =
      valor.split("-");

    return new Date(
      Number(partes[0]),
      Number(partes[1]) - 1,
      Number(partes[2])
    );
  }

  if (
    typeof valor === "string" &&
    valor.includes("/")
  ) {
    const partes =
      valor.split("/");

    if (partes.length === 3) {
      return new Date(
        Number(partes[2]),
        Number(partes[1]) - 1,
        Number(partes[0])
      );
    }
  }

  const data =
    new Date(valor);

  if (
    isNaN(data.getTime())
  ) {
    return null;
  }

  return data;
}

/* =========================
   FORMATAR DATA PARA INPUT
========================= */

function formatarDataInput(data) {
  const dt =
    criarDataLocal(data);

  if (!dt) {
    return "";
  }

  const ano =
    dt.getFullYear();

  const mes =
    String(dt.getMonth() + 1)
      .padStart(2, "0");

  const dia =
    String(dt.getDate())
      .padStart(2, "0");

  return `${ano}-${mes}-${dia}`;
}

/* =========================
   FORMATAR DATA BR
========================= */

function formatarData(data) {
  const dt =
    criarDataLocal(data);

  if (!dt) {
    return "-";
  }

  return dt.toLocaleDateString(
    "pt-BR"
  );
}

/* =========================
   IDS DA OBRA
========================= */

function obterCodigoPrincipalObra(obra) {
  return (
    obra?.idObra ||
    obra?.idProjeto ||
    obra?.codigoObra ||
    obra?.obraId ||
    obra?.id ||
    obra?.docId ||
    ""
  );
}

function obterChavesObra(obra) {
  return [
    obra?.id,
    obra?.docId,
    obra?.firebaseId,
    obra?.obraId,
    obra?.obraDocId,
    obra?.idObra,
    obra?.idProjeto,
    obra?.codigoObra,
    obra?.nomeProjeto,
    obra?.nomeObra,
    obra?.obra
  ]
    .filter(Boolean)
    .map(normalizarTexto);
}

function obterChavesPlanejamento(item) {
  return [
    item?.obraId,
    item?.obraDocId,
    item?.idObra,
    item?.idProjeto,
    item?.codigoObra,
    item?.projetoId,
    item?.obra,
    item?.obraNome,
    item?.nomeObra,
    item?.nomeProjeto,
    item?.projeto
  ]
    .filter(Boolean)
    .map(normalizarTexto);
}

function registroPertenceAObra(
  registro,
  obra
) {
  const chavesObra =
    obterChavesObra(obra);

  const chavesRegistro =
    obterChavesPlanejamento(registro);

  return chavesRegistro.some((chave) =>
    chavesObra.includes(chave)
  );
}

/* =========================
   BUSCAR OBRA SELECIONADA
========================= */

function obterObraSelecionada() {
  const valorSelecionado =
    selectObra?.value || "";

  return (
    obrasCadastradas.find((obra) =>
      obra.id === valorSelecionado
    ) ||
    obrasCadastradas.find((obra) =>
      obterCodigoPrincipalObra(obra) === valorSelecionado
    ) ||
    obrasCadastradas.find((obra) =>
      obra.nomeProjeto === valorSelecionado
    ) ||
    null
  );
}

/* =========================
   CRIAR OPTION SEGURA
========================= */

function adicionarOption(
  select,
  valor,
  texto
) {
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

/* =========================
   LIMPAR SELECT
========================= */

function limparSelectObras() {
  if (!selectObra) {
    return;
  }

  selectObra.innerHTML = "";

  adicionarOption(
    selectObra,
    "",
    "Selecione uma obra"
  );
}

/* =========================
   MOSTRAR MENSAGEM NA TABELA
========================= */

function mostrarMensagemTabela(mensagem) {
  if (!tbody) {
    return;
  }

  tbody.innerHTML = "";

  const tr =
    document.createElement("tr");

  const td =
    document.createElement("td");

  td.colSpan =
    6;

  td.textContent =
    mensagem;

  tr.appendChild(td);

  tbody.appendChild(tr);
}

/* =========================
   VERIFICAR PLANEJAMENTO EXISTENTE
========================= */

function obraPossuiCurvaAtiva(obra) {
  return planejamentosExistentes.some((item) => {
    if (item.ativo === false) {
      return false;
    }

    return registroPertenceAObra(
      item,
      obra
    );
  });
}

function obterPlanejamentosAtivosDaObra(obra) {
  return planejamentosExistentes.filter((item) => {
    if (item.ativo === false) {
      return false;
    }

    return registroPertenceAObra(
      item,
      obra
    );
  });
}

/* =========================
   CARREGAR OBRAS
========================= */

async function carregarObras() {
  try {
    limparSelectObras();

    obrasCadastradas = [];
    planejamentosExistentes = [];

    /*
      RESTRIÇÃO DE ESCOPO: um usuário com perfil "planejador" só pode
      planejar obras da própria Regional. Administrador continua
      vendo obras de todas as Regionais normalmente.
    */
    const perfilUsuarioLogado =
      normalizarTexto(usuarioLogadoGlobal?.perfil);

    const usuarioEhAdministradorGeral =
      perfilUsuarioLogado === "administrador";

    const regionalDoUsuario =
      usuarioLogadoGlobal?.regional || "";

    const obrasSnapshot =
      await getDocs(
        collection(
          db,
          "obras"
        )
      );

    const planejamentoSnapshot =
      await getDocs(
        collection(
          db,
          "planejamentoCurvaS"
        )
      );

    planejamentoSnapshot.forEach((docItem) => {
      planejamentosExistentes.push({
        ...docItem.data(),
        docId: docItem.id,
        firebaseId: docItem.id
      });
    });

    const obrasTemp = [];

    obrasSnapshot.forEach((docItem) => {
      const item =
        docItem.data();

      const nomeObra =
        item.nomeProjeto ||
        item.nomeObra ||
        item.obraNome ||
        item.obra ||
        "";

      if (!nomeObra) {
        return;
      }

      if (
        !usuarioEhAdministradorGeral &&
        regionalDoUsuario &&
        (item.regional || "") !== regionalDoUsuario
      ) {
        return;
      }

      const obraTemReplanejamento =
        Boolean(
          item.replanejamentoNecessario ||
          item.reprogramacaoNecessaria
        );

      const valorObra =
        obterValorObra(item);

      const obraTratada = {
        id: docItem.id,
        docId: docItem.id,
        firebaseId: docItem.id,

        obraDocId: docItem.id,

        idProjeto:
          item.idProjeto ||
          item.idObra ||
          item.codigoObra ||
          "",

        idObra:
          item.idObra ||
          item.codigoObra ||
          item.idProjeto ||
          "",

        obraId:
          item.idObra ||
          item.codigoObra ||
          item.idProjeto ||
          item.obraId ||
          docItem.id,

        codigoObra:
          item.idObra ||
          item.codigoObra ||
          item.idProjeto ||
          item.obraId ||
          "",

        nomeProjeto:
          nomeObra,

        valorObra:
          valorObra,

        dataInicio:
          item.dataInicio ||
          item.dataInicioPrevisto ||
          item.inicioPrevisto ||
          item.inicio ||
          item.dataInicioObra ||
          item.dataInicial ||
          "",

        dataFim:
          item.dataFim ||
          item.dataTerminoPrevisto ||
          item.dataFimPrevisto ||
          item.dataTermino ||
          item.terminoPrevisto ||
          item.termino ||
          item.fim ||
          item.dataFimObra ||
          item.dataFinal ||
          "",

        localidade:
          item.localidade || "",

        regional:
          item.regional || "",

        centroCusto:
          item.centroCusto ||
          item.centroDeCusto ||
          item.numeroOM ||
          "",

        replanejamentoNecessario:
          obraTemReplanejamento,

        reprogramacaoNecessaria:
          obraTemReplanejamento
      };

      const possuiCurva =
        obraPossuiCurvaAtiva(
          obraTratada
        );

      if (
        possuiCurva &&
        !obraTemReplanejamento
      ) {
        return;
      }

      obraTratada.possuiCurvaAtiva =
        possuiCurva;

      obrasTemp.push(
        obraTratada
      );
    });

    obrasTemp.sort((a, b) =>
      String(a.nomeProjeto || "")
        .localeCompare(
          String(b.nomeProjeto || ""),
          "pt-BR"
        )
    );

    obrasTemp.forEach((obraTratada) => {
      obrasCadastradas.push(
        obraTratada
      );

      const codigo =
        obterCodigoPrincipalObra(
          obraTratada
        );

      const labelBase =
        codigo
          ? `${codigo} - ${obraTratada.nomeProjeto}`
          : obraTratada.nomeProjeto;

      adicionarOption(
        selectObra,
        obraTratada.id,
        obraTratada.replanejamentoNecessario
          ? `${labelBase} - Replanejamento necessário`
          : labelBase
      );
    });

    if (
      obrasCadastradas.length === 0 &&
      selectObra
    ) {
      adicionarOption(
        selectObra,
        "",
        "Nenhuma obra pendente de planejamento"
      );
    }
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

/* =========================
   PREENCHER DADOS DA OBRA
========================= */

function preencherDadosObra() {
  const obraSelecionada =
    obterObraSelecionada();

  if (!obraSelecionada) {
    if (valorTotal) {
      valorTotal.value = moeda(0);
    }

    if (dataInicio) {
      dataInicio.value = "";
    }

    if (dataFim) {
      dataFim.value = "";
    }

    planejamentoAtual = [];
    semanasGeradas = [];

    if (tbody) {
      tbody.innerHTML = "";
    }

    destruirGraficos();

    return;
  }

  if (valorTotal) {
    valorTotal.value =
      moeda(
        obraSelecionada.valorObra
      );
  }

  const inicio =
    formatarDataInput(
      obraSelecionada.dataInicio
    );

  const fim =
    formatarDataInput(
      obraSelecionada.dataFim
    );

  if (dataInicio) {
    dataInicio.value =
      inicio;
  }

  if (dataFim) {
    dataFim.value =
      fim;
  }

  planejamentoAtual = [];
  semanasGeradas = [];

  destruirGraficos();

  if (
    obraSelecionada.replanejamentoNecessario
  ) {
    mostrarMensagemTabela(
      "Esta obra teve as datas alteradas e precisa de replanejamento. Gere uma nova Curva S para substituir o planejamento anterior."
    );
  } else {
    if (tbody) {
      tbody.innerHTML = "";
    }
  }
}

/* =========================
   VALIDAR GERAÇÃO
========================= */

function validarCamposGeracao() {
  if (
    !selectObra?.value ||
    !dataInicio?.value ||
    !dataFim?.value
  ) {
    alert(
      "Preencha todos os campos antes de gerar o planejamento."
    );

    return false;
  }

  const inicio =
    criarDataLocal(
      dataInicio.value
    );

  const fim =
    criarDataLocal(
      dataFim.value
    );

  if (
    !inicio ||
    !fim
  ) {
    alert(
      "Datas inválidas."
    );

    return false;
  }

  if (fim < inicio) {
    alert(
      "A data final não pode ser menor que a data inicial."
    );

    return false;
  }

  return true;
}

/* =========================
   GERAR PLANEJAMENTO
========================= */

function gerarPlanejamento() {
  if (!tbody) {
    return;
  }

  if (!validarCamposGeracao()) {
    return;
  }

  tbody.innerHTML = "";
  planejamentoAtual = [];
  semanasGeradas = [];

  destruirGraficos();

  const inicio =
    criarDataLocal(
      dataInicio.value
    );

  const fim =
    criarDataLocal(
      dataFim.value
    );

  let dataAtual =
    new Date(inicio);

  let numeroSemana =
    1;

  while (dataAtual <= fim) {
    const inicioSemana =
      new Date(dataAtual);

    let fimSemana =
      new Date(dataAtual);

    fimSemana.setDate(
      fimSemana.getDate() + 6
    );

    if (fimSemana > fim) {
      fimSemana =
        new Date(fim);
    }

    semanasGeradas.push({
      numero:
        numeroSemana,

      label:
        `SEM ${numeroSemana}`,

      inicio:
        new Date(inicioSemana),

      fim:
        new Date(fimSemana)
    });

    dataAtual =
      new Date(fimSemana);

    dataAtual.setDate(
      dataAtual.getDate() + 1
    );

    numeroSemana++;
  }

  semanasGeradas.forEach((semana, index) => {
    const tr =
      document.createElement("tr");

    const tdSemana =
      document.createElement("td");

    tdSemana.textContent =
      semana.label;

    const tdPeriodo =
      document.createElement("td");

    tdPeriodo.textContent =
      `${formatarData(semana.inicio)} a ${formatarData(semana.fim)}`;

    const tdFisico =
      document.createElement("td");

    const inputFisico =
      document.createElement("input");

    inputFisico.type =
      "number";

    inputFisico.className =
      "input-fisico";

    inputFisico.dataset.index =
      String(index);

    inputFisico.placeholder =
      "0";

    inputFisico.min =
      "0";

    inputFisico.max =
      "100";

    inputFisico.step =
      "0.01";

    tdFisico.appendChild(
      inputFisico
    );

    const tdFisicoAcumulado =
      document.createElement("td");

    tdFisicoAcumulado.className =
      "fisico-acumulado";

    tdFisicoAcumulado.textContent =
      percentual(0);

    const tdFinanceiro =
      document.createElement("td");

    const inputFinanceiro =
      document.createElement("input");

    inputFinanceiro.type =
      "text";

    inputFinanceiro.inputMode =
      "decimal";

    inputFinanceiro.className =
      "input-financeiro";

    inputFinanceiro.dataset.index =
      String(index);

    inputFinanceiro.placeholder =
      "R$ 0,00";

    tdFinanceiro.appendChild(
      inputFinanceiro
    );

    const tdFinanceiroAcumulado =
      document.createElement("td");

    tdFinanceiroAcumulado.className =
      "financeiro-acumulado";

    tdFinanceiroAcumulado.textContent =
      moeda(0);

    tr.appendChild(tdSemana);
    tr.appendChild(tdPeriodo);
    tr.appendChild(tdFisico);
    tr.appendChild(tdFisicoAcumulado);
    tr.appendChild(tdFinanceiro);
    tr.appendChild(tdFinanceiroAcumulado);

    tbody.appendChild(tr);
  });

  ativarEventosInputs();

  atualizarTabela();
}

document
  .getElementById("btnGerarPlanejamento")
  ?.addEventListener("click", gerarPlanejamento);

/* =========================
   EVENTOS INPUTS
========================= */

function ativarEventosInputs() {
  const inputsFisico =
    document.querySelectorAll(
      ".input-fisico"
    );

  const inputsFinanceiro =
    document.querySelectorAll(
      ".input-financeiro"
    );

  inputsFinanceiro.forEach((input) => {
    input.addEventListener("input", (e) => {
      let v =
        e.target.value.replace(/\D/g, "");

      v =
        (
          Number(v || 0) / 100
        ).toLocaleString(
          "pt-BR",
          {
            style: "currency",
            currency: "BRL"
          }
        );

      e.target.value =
        v;

      atualizarTabela();
    });
  });

  inputsFisico.forEach((input) => {
    input.addEventListener("input", () => {
      const valor =
        Number(input.value || 0);

      if (valor < 0) {
        input.value = "0";
      }

      if (valor > 100) {
        input.value = "100";
      }

      atualizarTabela();
    });
  });
}

/* =========================
   ATUALIZAR TABELA
========================= */

function atualizarTabela() {
  planejamentoAtual = [];

  if (!tbody) {
    return;
  }

  const linhas =
    tbody.querySelectorAll("tr");

  let acumuladoFisico =
    0;

  let acumuladoFinanceiro =
    0;

  const labels = [];
  const dadosFisico = [];
  const dadosFinanceiro = [];

  const obraSelecionada =
    obterObraSelecionada();

  const codigoPrincipal =
    obterCodigoPrincipalObra(
      obraSelecionada
    );

  linhas.forEach((linha, index) => {
    const semanaInfo =
      semanasGeradas[index];

    const inputFisico =
      linha.querySelector(
        ".input-fisico"
      );

    const inputFinanceiro =
      linha.querySelector(
        ".input-financeiro"
      );

    if (
      !inputFisico ||
      !inputFinanceiro ||
      !semanaInfo
    ) {
      return;
    }

    const fisico =
      Number(inputFisico.value || 0);

    const financeiro =
      moedaParaNumero(
        inputFinanceiro.value || 0
      );

    acumuladoFisico +=
      fisico;

    acumuladoFinanceiro +=
      financeiro;

    if (acumuladoFisico > 100) {
      acumuladoFisico = 100;
    }

    const celulaFisicoAcumulado =
      linha.querySelector(
        ".fisico-acumulado"
      );

    const celulaFinanceiroAcumulado =
      linha.querySelector(
        ".financeiro-acumulado"
      );

    if (celulaFisicoAcumulado) {
      celulaFisicoAcumulado.textContent =
        percentual(acumuladoFisico);
    }

    if (celulaFinanceiroAcumulado) {
      celulaFinanceiroAcumulado.textContent =
        moeda(acumuladoFinanceiro);
    }

    planejamentoAtual.push({
      obra:
        obraSelecionada?.nomeProjeto || "",

      obraNome:
        obraSelecionada?.nomeProjeto || "",

      nomeProjeto:
        obraSelecionada?.nomeProjeto || "",

      obraDocId:
        obraSelecionada?.id || "",

      obraId:
        codigoPrincipal || "",

      idObra:
        obraSelecionada?.idObra ||
        codigoPrincipal ||
        "",

      codigoObra:
        codigoPrincipal || "",

      idProjeto:
        obraSelecionada?.idProjeto ||
        obraSelecionada?.idObra ||
        codigoPrincipal ||
        "",

      localidade:
        obraSelecionada?.localidade || "",

      regional:
        obraSelecionada?.regional || "",

      centroCusto:
        obraSelecionada?.centroCusto || "",

      valorTotalObra:
        moedaParaNumero(
          valorTotal?.value
        ),

      dataInicio:
        dataInicio?.value || "",

      dataFim:
        dataFim?.value || "",

      dataInicioPrevisto:
        dataInicio?.value || "",

      dataTerminoPrevisto:
        dataFim?.value || "",

      semana:
        semanaInfo.label,

      semanaNumero:
        semanaInfo.numero,

      ordemSemana:
        semanaInfo.numero,

      periodo:
        `${formatarData(semanaInfo.inicio)} a ${formatarData(semanaInfo.fim)}`,

      periodoInicio:
        formatarDataInput(
          semanaInfo.inicio
        ),

      periodoFim:
        formatarDataInput(
          semanaInfo.fim
        ),

      inicioSemana:
        formatarDataInput(
          semanaInfo.inicio
        ),

      fimSemana:
        formatarDataInput(
          semanaInfo.fim
        ),

      fisico:
        Number(fisico).toFixed(2),

      fisicoAcum:
        Number(acumuladoFisico).toFixed(2),

      fisicoAcumulado:
        percentual(acumuladoFisico),

      financeiro:
        Number(financeiro).toFixed(2),

      financeiroAcum:
        Number(acumuladoFinanceiro).toFixed(2),

      financeiroAcumulado:
        moeda(acumuladoFinanceiro),

      statusPlanejamento:
        "PLANEJADO",

      replanejamento:
        Boolean(
          obraSelecionada?.replanejamentoNecessario
        )
    });

    labels.push(
      semanaInfo.label
    );

    dadosFisico.push(
      acumuladoFisico
    );

    dadosFinanceiro.push(
      acumuladoFinanceiro
    );
  });

  criarGraficoFisico(
    labels,
    dadosFisico
  );

  criarGraficoFinanceiro(
    labels,
    dadosFinanceiro
  );
}

/* =========================
   VALIDAR PLANEJAMENTO
========================= */

function validarPlanejamentoAntesSalvar() {
  if (planejamentoAtual.length === 0) {
    alert(
      "Preencha ou gere o planejamento antes de salvar."
    );

    return false;
  }

  const somaFisica =
    planejamentoAtual.reduce((total, item) => {
      return total + Number(item.fisico || 0);
    }, 0);

  const somaFinanceira =
    planejamentoAtual.reduce((total, item) => {
      return total + Number(item.financeiro || 0);
    }, 0);

  const valorObraTotal =
    moedaParaNumero(
      valorTotal?.value
    );

  const toleranciaFinanceira =
    0.5;

  if (somaFisica <= 0) {
    alert(
      "Informe o avanço físico semanal do planejamento."
    );

    return false;
  }

  if (
    Math.abs(somaFisica - 100) > 0.01
  ) {
    alert(
      "O avanço físico total do planejamento deve fechar em 100,00%."
    );

    return false;
  }

  if (somaFinanceira <= 0) {
    alert(
      "Informe o valor financeiro semanal do planejamento."
    );

    return false;
  }

  if (
    valorObraTotal > 0 &&
    Math.abs(somaFinanceira - valorObraTotal) >
      toleranciaFinanceira
  ) {
    alert(
      "O somatório financeiro semanal deve ser igual ao valor total da obra."
    );

    return false;
  }

  return true;
}

/* =========================
   SALVAR
========================= */

async function salvarPlanejamento() {
  if (!usuarioLogadoGlobal) {
    alert(
      "Usuário não autenticado. Faça login novamente."
    );

    return;
  }

  atualizarTabela();

  if (!validarPlanejamentoAntesSalvar()) {
    return;
  }

  const obraSelecionada =
    obterObraSelecionada();

  if (!obraSelecionada) {
    alert(
      "Selecione uma obra válida para salvar o planejamento."
    );

    return;
  }

  const planejamentoEhReplanejamento =
    Boolean(
      obraSelecionada.replanejamentoNecessario ||
      obraSelecionada.reprogramacaoNecessaria
    );

  const mensagemConfirmacao =
    planejamentoEhReplanejamento
      ? "Deseja salvar este replanejamento? O planejamento anterior será marcado como substituído e a nova Curva S ficará ativa."
      : "Deseja realmente salvar este planejamento? Após salvar, a obra não aparecerá mais na lista de obras pendentes de planejamento.";

  const confirmar =
    confirm(
      mensagemConfirmacao
    );

  if (!confirmar) {
    return;
  }

  try {
    const batch =
      writeBatch(db);

    const versaoPlanejamento =
      Date.now();

    const planejamentosAntigos =
      planejamentoEhReplanejamento
        ? obterPlanejamentosAtivosDaObra(
            obraSelecionada
          )
        : [];

    planejamentosAntigos.forEach((item) => {
      if (!item.docId) {
        return;
      }

      const refAntigo =
        doc(
          db,
          "planejamentoCurvaS",
          item.docId
        );

      batch.update(
        refAntigo,
        {
          ativo:
            false,

          substituidoPorReplanejamento:
            true,

          substituidoEm:
            serverTimestamp(),

          substituidoPorUid:
            usuarioLogadoGlobal?.uid || "",

          substituidoPorEmail:
            usuarioLogadoGlobal?.email ||
            usuarioLogadoGlobal?.emailAuth ||
            "",

          motivoSubstituicao:
            "Replanejamento gerado após alteração das datas da obra."
        }
      );
    });

    planejamentoAtual.forEach((item) => {
      const refNovo =
        doc(
          collection(
            db,
            "planejamentoCurvaS"
          )
        );

      batch.set(
        refNovo,
        {
          ...item,

          ativo:
            true,

          tipoPlanejamento:
            planejamentoEhReplanejamento
              ? "REPLANEJAMENTO"
              : "PLANEJAMENTO_INICIAL",

          versaoPlanejamento,

          replanejamento:
            planejamentoEhReplanejamento,

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
        }
      );
    });

    const refObra =
      doc(
        db,
        "obras",
        obraSelecionada.id
      );

    batch.update(
      refObra,
      {
        dataInicio:
          dataInicio?.value || "",

        dataFim:
          dataFim?.value || "",

        dataInicioPrevisto:
          dataInicio?.value || "",

        dataTerminoPrevisto:
          dataFim?.value || "",

        dataFimPrevisto:
          dataFim?.value || "",

        planejamentoCurvaSAtivo:
          true,

        replanejamentoNecessario:
          false,

        reprogramacaoNecessaria:
          false,

        planejamentoAtualizadoEm:
          serverTimestamp(),

        planejamentoAtualizadoPorUid:
          usuarioLogadoGlobal?.uid || "",

        planejamentoAtualizadoPorEmail:
          usuarioLogadoGlobal?.email ||
          usuarioLogadoGlobal?.emailAuth ||
          "",

        versaoPlanejamentoAtual:
          versaoPlanejamento
      }
    );

    await batch.commit();

    alert(
      planejamentoEhReplanejamento
        ? "Replanejamento salvo com sucesso!"
        : "Planejamento salvo com sucesso!"
    );

    window.location.href =
      "./dashboard.html";
  } catch (error) {
    console.error(
      "Erro ao salvar planejamento:",
      error
    );

    alert(
      "Erro ao salvar planejamento. Verifique suas permissões no Firestore."
    );
  }
}

document
  .getElementById("btnSalvarPlanejamento")
  ?.addEventListener("click", salvarPlanejamento);

/* =========================
   DESTRUIR GRÁFICOS
========================= */

function destruirGraficos() {
  if (graficoFisico) {
    graficoFisico.destroy();
    graficoFisico = null;
  }

  if (graficoFinanceiro) {
    graficoFinanceiro.destroy();
    graficoFinanceiro = null;
  }
}

/* =========================
   GRÁFICO FÍSICO
========================= */

function criarGraficoFisico(
  labels,
  dados
) {
  const canvas =
    document.getElementById(
      "graficoFisico"
    );

  if (!canvas || !ChartJS) {
    return;
  }

  if (graficoFisico) {
    graficoFisico.destroy();
  }

  graficoFisico =
    new ChartJS(
      canvas,
      {
        type:
          "line",

        data:
          {
            labels,

            datasets:
              [
                {
                  label:
                    "Físico Acumulado",

                  data:
                    dados,

                  borderColor:
                    "#007E7A",

                  backgroundColor:
                    "rgba(0,126,122,0.08)",

                  borderWidth:
                    2,

                  tension:
                    0.4,

                  pointRadius:
                    4,

                  pointHoverRadius:
                    6,

                  fill:
                    true
                }
              ]
          },

        options:
          {
            responsive:
              true,

            maintainAspectRatio:
              false,

            plugins:
              {
                legend:
                  {
                    display:
                      true
                  },

                datalabels:
                  {
                    color:
                      "#111",

                    anchor:
                      "end",

                    align:
                      "top",

                    offset:
                      8,

                    font:
                      {
                        size:
                          10,

                        weight:
                          "bold"
                      },

                    formatter:
                      (value) => percentual(value)
                  },

                tooltip:
                  {
                    callbacks:
                      {
                        label:
                          (context) => {
                            return `${context.dataset.label}: ${percentual(context.raw || 0)}`;
                          }
                      }
                  }
              },

            scales:
              {
                y:
                  {
                    beginAtZero:
                      true,

                    max:
                      100,

                    ticks:
                      {
                        callback:
                          (value) => `${value}%`
                      }
                  }
              }
          }
      }
    );
}

/* =========================
   GRÁFICO FINANCEIRO
========================= */

function criarGraficoFinanceiro(
  labels,
  dados
) {
  const canvas =
    document.getElementById(
      "graficoFinanceiro"
    );

  if (!canvas || !ChartJS) {
    return;
  }

  if (graficoFinanceiro) {
    graficoFinanceiro.destroy();
  }

  graficoFinanceiro =
    new ChartJS(
      canvas,
      {
        type:
          "line",

        data:
          {
            labels,

            datasets:
              [
                {
                  label:
                    "Financeiro Acumulado",

                  data:
                    dados,

                  borderColor:
                    "#0ABB98",

                  backgroundColor:
                    "rgba(10,187,152,0.08)",

                  borderWidth:
                    2,

                  tension:
                    0.4,

                  pointRadius:
                    4,

                  pointHoverRadius:
                    6,

                  fill:
                    true
                }
              ]
          },

        options:
          {
            responsive:
              true,

            maintainAspectRatio:
              false,

            plugins:
              {
                legend:
                  {
                    display:
                      true
                  },

                datalabels:
                  {
                    color:
                      "#111",

                    anchor:
                      "end",

                    align:
                      "top",

                    offset:
                      8,

                    font:
                      {
                        size:
                          10,

                        weight:
                          "bold"
                      },

                    formatter:
                      (value) => moeda(value)
                  },

                tooltip:
                  {
                    callbacks:
                      {
                        label:
                          (context) => {
                            return `${context.dataset.label}: ${moeda(context.raw || 0)}`;
                          }
                      }
                  }
              },

            scales:
              {
                y:
                  {
                    beginAtZero:
                      true,

                    ticks:
                      {
                        callback:
                          (value) => moeda(value)
                      }
                  }
              }
          }
      }
    );
}

/* =========================
   EVENTOS
========================= */

function configurarEventos() {
  selectObra?.addEventListener(
    "change",
    preencherDadosObra
  );
}

/* =========================
   INIT
========================= */

document.addEventListener(
  "DOMContentLoaded",
  async () => {
    try {
      usuarioLogadoGlobal =
        await protegerPagina();

      configurarEventos();

      await carregarObras();
    } catch (error) {
      console.error(
        "Erro ao iniciar planejamento:",
        error
      );

      alert(
        "Erro ao iniciar a tela de planejamento."
      );
    }
  }
);