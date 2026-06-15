/* =====================================================
   PLANEJAMENTO DA OBRA - PROTEGIDO COM AUTH GUARD
===================================================== */

import {
  db
} from "./firebaseConfig.js";

import {
  protegerPagina
} from "./authGuard.js";

import {
  collection,
  getDocs,
  addDoc,
  query,
  orderBy,
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

const btnVoltar =
document.getElementById("btnVoltar");

/* =========================
   VARIÁVEIS
========================= */

let planejamentoAtual = [];

let graficoFisico = null;

let graficoFinanceiro = null;

let obrasCadastradas = [];

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
   FORMATAR MOEDA
========================= */

function moeda(valor) {

  return Number(valor || 0)
    .toLocaleString(
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

  if (typeof valor === "number") {
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
  valorLimpo.replace(
    /[^\d.-]/g,
    ""
  );

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

  const data =
  new Date(valor);

  if (isNaN(data)) {
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

  if (!data) {
    return "-";
  }

  return data.toLocaleDateString(
    "pt-BR"
  );

}

/* =========================
   CRIAR OPTION SEGURA
========================= */

function adicionarOption(select, valor, texto) {

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
   CARREGAR OBRAS
========================= */

async function carregarObras() {

  try {

    limparSelectObras();

    obrasCadastradas = [];

    const obrasSnapshot =
    await getDocs(
      query(
        collection(
          db,
          "obras"
        ),
        orderBy("nomeProjeto")
      )
    );

    const planejamentoSnapshot =
    await getDocs(
      collection(
        db,
        "planejamentoCurvaS"
      )
    );

    const obrasComCurva =
    new Set();

    planejamentoSnapshot.forEach((docItem) => {

      const item =
      docItem.data();

      if (item.obra) {
        obrasComCurva.add(item.obra);
      }

      if (item.obraId) {
        obrasComCurva.add(item.obraId);
      }

    });

    obrasSnapshot.forEach((docItem) => {

      const item =
      docItem.data();

      const nomeObra =
      item.nomeProjeto || "";

      if (!nomeObra) {
        return;
      }

      if (
        obrasComCurva.has(nomeObra) ||
        obrasComCurva.has(docItem.id)
      ) {
        return;
      }

      const valorObra =
      obterValorObra(item);

      const obraTratada = {

        id:
        docItem.id,

        idProjeto:
        item.idProjeto ||
        item.idObra ||
        "",

        nomeProjeto:
        nomeObra,

        valorObra:
        valorObra,

        dataInicio:
        item.dataInicio ||
        item.dataInicioPrevisto ||
        item.inicio ||
        item.dataInicial ||
        "",

        dataFim:
        item.dataFim ||
        item.dataTermino ||
        item.dataTerminoPrevisto ||
        item.fim ||
        item.dataFinal ||
        "",

        localidade:
        item.localidade || "",

        regional:
        item.regional || "",

        centroCusto:
        item.centroCusto || ""

      };

      obrasCadastradas.push(
        obraTratada
      );

      adicionarOption(
        selectObra,
        nomeObra,
        nomeObra
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

  const nomeSelecionado =
  selectObra?.value || "";

  const obraSelecionada =
  obrasCadastradas.find((obra) => {

    return obra.nomeProjeto ===
    nomeSelecionado;

  });

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
    dataInicio.value = inicio;
  }

  if (dataFim) {
    dataFim.value = fim;
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

  if (!inicio || !fim) {

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

  destruirGraficos();

  const inicio =
  criarDataLocal(
    dataInicio.value
  );

  const fim =
  criarDataLocal(
    dataFim.value
  );

  const semanas = [];

  let dataAtual =
  new Date(inicio);

  let numeroSemana = 1;

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

    semanas.push({

      semana:
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

  semanas.forEach((semana, index) => {

    const tr =
    document.createElement("tr");

    const tdSemana =
    document.createElement("td");

    tdSemana.textContent =
    semana.semana;

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
    "0%";

    const tdFinanceiro =
    document.createElement("td");

    const inputFinanceiro =
    document.createElement("input");

    inputFinanceiro.type =
    "text";

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
    "R$ 0,00";

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

window.gerarPlanejamento =
gerarPlanejamento;

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

    input.addEventListener(
      "input",
      (e) => {

        let v =
        e.target.value
          .replace(/\D/g, "");

        v =
        (Number(v || 0) / 100)
          .toLocaleString(
            "pt-BR",
            {
              style: "currency",
              currency: "BRL"
            }
          );

        e.target.value =
        v;

        atualizarTabela();

      }
    );

  });

  inputsFisico.forEach((input) => {

    input.addEventListener(
      "input",
      () => {

        const valor =
        Number(input.value || 0);

        if (valor < 0) {
          input.value = "0";
        }

        if (valor > 100) {
          input.value = "100";
        }

        atualizarTabela();

      }
    );

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

  let acumuladoFisico = 0;

  let acumuladoFinanceiro = 0;

  const labels = [];

  const dadosFisico = [];

  const dadosFinanceiro = [];

  const obraSelecionada =
  obrasCadastradas.find((obra) => {

    return obra.nomeProjeto ===
    selectObra?.value;

  });

  linhas.forEach((linha) => {

    const semana =
    linha.children[0]?.textContent || "";

    const periodo =
    linha.children[1]?.textContent || "";

    const fisico =
    Number(
      linha.querySelector(".input-fisico")?.value || 0
    );

    const financeiro =
    moedaParaNumero(
      linha.querySelector(".input-financeiro")?.value || 0
    );

    acumuladoFisico += fisico;

    acumuladoFinanceiro += financeiro;

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
      percentual(
        acumuladoFisico
      );

    }

    if (celulaFinanceiroAcumulado) {

      celulaFinanceiroAcumulado.textContent =
      moeda(
        acumuladoFinanceiro
      );

    }

    planejamentoAtual.push({

      obra:
      selectObra?.value || "",

      obraId:
      obraSelecionada?.id || "",

      idProjeto:
      obraSelecionada?.idProjeto || "",

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

      semana,

      periodo,

      fisico:
      fisico.toFixed(2),

      fisicoAcum:
      acumuladoFisico.toFixed(2),

      fisicoAcumulado:
      percentual(
        acumuladoFisico
      ),

      financeiro:
      financeiro.toFixed(2),

      financeiroAcum:
      acumuladoFinanceiro.toFixed(2),

      financeiroAcumulado:
      moeda(
        acumuladoFinanceiro
      )

    });

    labels.push(
      semana
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

  if (somaFisica <= 0) {

    alert(
      "Informe o avanço físico semanal do planejamento."
    );

    return false;

  }

  if (somaFisica > 100) {

    alert(
      "O avanço físico total não pode ultrapassar 100%."
    );

    return false;

  }

  if (somaFinanceira <= 0) {

    alert(
      "Informe o valor financeiro semanal do planejamento."
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

  const confirmar =
  confirm(
    "Deseja realmente salvar este planejamento? Após salvar, a obra não aparecerá mais na lista de obras pendentes de planejamento."
  );

  if (!confirmar) {
    return;
  }

  try {

    for (const item of planejamentoAtual) {

      await addDoc(
        collection(
          db,
          "planejamentoCurvaS"
        ),
        {
          ...item,

          criadoPorUid:
          usuarioLogadoGlobal?.uid || "",

          criadoPorEmail:
          usuarioLogadoGlobal?.email ||
          usuarioLogadoGlobal?.emailAuth ||
          "",

          criadoPorNome:
          usuarioLogadoGlobal?.nome || "",

          criadoEm:
          serverTimestamp(),

          atualizadoEm:
          serverTimestamp()
        }
      );

    }

    alert(
      "Planejamento salvo com sucesso!"
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

window.salvarPlanejamento =
salvarPlanejamento;

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

  if (
    !canvas ||
    !ChartJS
  ) {
    return;
  }

  if (graficoFisico) {
    graficoFisico.destroy();
  }

  graficoFisico =
  new ChartJS(
    canvas,
    {
      type: "line",

      data: {
        labels,
        datasets: [
          {
            label: "Físico Acumulado",
            data: dados,
            borderColor: "#007E7A",
            backgroundColor: "rgba(0,126,122,0.08)",
            borderWidth: 2,
            tension: 0.4,
            pointRadius: 4,
            pointHoverRadius: 6,
            fill: true
          }
        ]
      },

      options: {
        responsive: true,
        maintainAspectRatio: false,

        plugins: {
          legend: {
            display: true
          },

          datalabels: {
            color: "#111",
            anchor: "end",
            align: "top",
            offset: 8,
            font: {
              size: 10,
              weight: "bold"
            },
            formatter: (value) => {
              return percentual(value);
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

  if (
    !canvas ||
    !ChartJS
  ) {
    return;
  }

  if (graficoFinanceiro) {
    graficoFinanceiro.destroy();
  }

  graficoFinanceiro =
  new ChartJS(
    canvas,
    {
      type: "line",

      data: {
        labels,
        datasets: [
          {
            label: "Financeiro Acumulado",
            data: dados,
            borderColor: "#0ABB98",
            backgroundColor: "rgba(10,187,152,0.08)",
            borderWidth: 2,
            tension: 0.4,
            pointRadius: 4,
            pointHoverRadius: 6,
            fill: true
          }
        ]
      },

      options: {
        responsive: true,
        maintainAspectRatio: false,

        plugins: {
          legend: {
            display: true
          },

          datalabels: {
            color: "#111",
            anchor: "end",
            align: "top",
            offset: 8,
            font: {
              size: 10,
              weight: "bold"
            },
            formatter: (value) => {
              return moeda(value);
            }
          },

          tooltip: {
            callbacks: {
              label: (context) => {
                return `${context.dataset.label}: ${moeda(context.raw || 0)}`;
              }
            }
          }
        },

        scales: {
          y: {
            beginAtZero: true,
            ticks: {
              callback: (value) => moeda(value)
            }
          }
        }
      }
    }
  );

}

/* =========================
   BOTÃO VOLTAR
========================= */

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

/* =========================
   EVENTOS
========================= */

function configurarEventos() {

  selectObra?.addEventListener(
    "change",
    preencherDadosObra
  );

  configurarBotaoVoltar();

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