/* =====================================================
   GESTÃO DE OBRAS - CORRIGIDO
   Carrega obras nas coleções: obras e projetos
===================================================== */

import { db } from "./firebaseConfig.js";
import { protegerPagina } from "./authGuard.js";
import {
  collection,
  getDocs,
  doc,
  updateDoc,
  arrayUnion,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.3/firebase-firestore.js";

let usuarioLogadoGlobal = null;
let listaProjetos = [];
let obraSelecionadaParaEdicao = null;

const $ = (id) => document.getElementById(id);

const tbodyProjetos = $("tbodyProjetos");
const totalFiltrado = $("totalFiltrado");
const kpiTotal = $("kpiTotal");
const kpiValidadas = $("kpiValidadas");
const kpiPlanejadas = $("kpiPlanejadas");
const kpiAndamento = $("kpiAndamento");
const kpiParalisadas = $("kpiParalisadas");
const kpiConcluidas = $("kpiConcluidas");

const filtroRegional = $("filtroRegional");
const filtroLocalidade = $("filtroLocalidade");
const filtroAno = $("filtroAno");
const filtroGutNivel = $("filtroGutNivel");
const filtroStatus = $("filtroStatus");

const modalEditarDatas = $("modalEditarDatas");
const formEditarDatas = $("formEditarDatas");
const btnFecharModalEdicaoDatas = $("btnFecharModalEdicaoDatas");
const btnCancelarEdicaoDatas = $("btnCancelarEdicaoDatas");
const btnSalvarEdicaoDatas = $("btnSalvarEdicaoDatas");

const editObraDocId = $("editObraDocId");
const editPossuiPlanejamento = $("editPossuiPlanejamento");
const editPossuiRealizado = $("editPossuiRealizado");
const editDataInicioAnterior = $("editDataInicioAnterior");
const editDataFimAnterior = $("editDataFimAnterior");
const editObraNome = $("editObraNome");
const editCodigoObra = $("editCodigoObra");
const editStatusObra = $("editStatusObra");
const editRegionalObra = $("editRegionalObra");
const editLocalidadeObra = $("editLocalidadeObra");
const editDataInicioAtual = $("editDataInicioAtual");
const editDataFimAtual = $("editDataFimAtual");
const editDataInicio = $("editDataInicio");
const editDataFim = $("editDataFim");
const editJustificativa = $("editJustificativa");
const boxAvisoImpactoCurva = $("boxAvisoImpactoCurva");
const boxAvisoRealizado = $("boxAvisoRealizado");
const avisoImpactoCurva = $("avisoImpactoCurva");
const avisoRealizado = $("avisoRealizado");

const LOCALIDADES_POR_REGIONAL = {
  "Regional 1": [
    "Arari",
    "Vitoria do Mearim",
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
    "São Pedro d’agua branca"
  ]
};

const MAPA_LOCALIDADE_REGIONAL = {};

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

function normalizarLocalidade(valor) {
  return String(valor || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[’´`]/g, "'")
    .replace(/[^a-zA-Z0-9\s]/g, " ")
    .replace(/\bd\s+agua\b/gi, "dagua")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function registrarLocalidade(regional, localidadeOficial, variacoes = []) {
  [localidadeOficial, ...variacoes].forEach((nome) => {
    MAPA_LOCALIDADE_REGIONAL[normalizarLocalidade(nome)] = {
      regional,
      localidade: localidadeOficial
    };
  });
}

registrarLocalidade("Regional 1", "Arari");
registrarLocalidade("Regional 1", "Vitoria do Mearim", ["Vitória do Mearim"]);
registrarLocalidade("Regional 1", "Santa Inês", ["Santa Ines"]);
registrarLocalidade("Regional 1", "Alto Alegre do Pindaré", ["Alto Alegre do Pindare", "Alto Alegre"]);
registrarLocalidade("Regional 1", "Altamira");
registrarLocalidade("Regional 1", "Auzilândia", ["Auzilandia"]);
registrarLocalidade("Regional 1", "Vila Pindaré", ["Vila Pindare"]);
registrarLocalidade("Regional 1", "Mineirinho");
registrarLocalidade("Regional 2", "Açailândia", ["Acailandia"]);
registrarLocalidade("Regional 2", "Nova Vida");
registrarLocalidade("Regional 3", "Marabá", ["Maraba"]);
registrarLocalidade("Regional 3", "Itainópolis", ["Itainopolis"]);
registrarLocalidade("Regional 3", "São Pedro d’agua branca", [
  "São Pedro d’água branca",
  "São Pedro d'água branca",
  "São Pedro d'agua branca",
  "São Pedro dagua branca",
  "São Pedro d agua branca",
  "Sao Pedro d'agua branca",
  "Sao Pedro d'água branca",
  "Sao Pedro dagua branca",
  "Sao Pedro d agua branca"
]);

function normalizarRegional(valor) {
  const texto = normalizarTexto(valor);

  if (["regional 1", "regional 01", "regional01", "r1"].includes(texto)) {
    return "Regional 1";
  }

  if (["regional 2", "regional 02", "regional02", "r2"].includes(texto)) {
    return "Regional 2";
  }

  if (["regional 3", "regional 03", "regional03", "r3"].includes(texto)) {
    return "Regional 3";
  }

  return valor || "";
}

function normalizarStatus(status) {
  const texto = normalizarTexto(status);

  if (texto.includes("concl") || texto.includes("final")) {
    return "Concluído";
  }

  if (texto.includes("andamento") || texto.includes("execu")) {
    return "Em andamento";
  }

  if (texto.includes("paralis") || texto.includes("suspens")) {
    return "Paralisada";
  }

  if (texto.includes("planej")) {
    return "Planejado";
  }

  return status || "Planejado";
}

function numeroBRL(valor) {
  if (valor === null || valor === undefined || valor === "") {
    return 0;
  }

  if (typeof valor === "number") {
    return Number.isFinite(valor) ? valor : 0;
  }

  let texto = String(valor).trim().replace(/[^\d,.-]/g, "");

  if (!texto) {
    return 0;
  }

  if (texto.includes(",")) {
    texto = texto.replace(/\./g, "").replace(",", ".");
  } else {
    const partes = texto.split(".");

    if (partes.length > 2) {
      const decimal = partes.pop();
      texto = partes.join("") + "." + decimal;
    } else if (partes.length === 2 && partes[1].length === 3) {
      texto = partes.join("");
    }
  }

  const numero = Number(texto);
  return Number.isFinite(numero) ? numero : 0;
}

function moeda(valor) {
  return numeroBRL(valor).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL"
  });
}

function converterParaDate(valor) {
  if (!valor) {
    return null;
  }

  if (valor?.toDate) {
    return valor.toDate();
  }

  if (valor instanceof Date) {
    return Number.isNaN(valor.getTime()) ? null : valor;
  }

  if (typeof valor === "object" && valor.seconds) {
    return new Date(valor.seconds * 1000);
  }

  const texto = String(valor).trim();

  if (!texto) {
    return null;
  }

  if (texto.includes("/")) {
    const partes = texto.split("/");

    if (partes.length === 3) {
      const data = new Date(Number(partes[2]), Number(partes[1]) - 1, Number(partes[0]));
      return Number.isNaN(data.getTime()) ? null : data;
    }
  }

  if (texto.includes("-")) {
    const partes = texto.split("T")[0].split("-");

    if (partes.length === 3) {
      const data = new Date(Number(partes[0]), Number(partes[1]) - 1, Number(partes[2]));
      return Number.isNaN(data.getTime()) ? null : data;
    }
  }

  const data = new Date(texto);
  return Number.isNaN(data.getTime()) ? null : data;
}

function dataParaTempo(valor) {
  const data = converterParaDate(valor);
  return data ? data.getTime() : null;
}

function formatarData(valor) {
  const data = converterParaDate(valor);
  return data ? data.toLocaleDateString("pt-BR") : "-";
}

function dataParaInput(valor) {
  const data = converterParaDate(valor);

  if (!data) {
    return "";
  }

  const ano = data.getFullYear();
  const mes = String(data.getMonth() + 1).padStart(2, "0");
  const dia = String(data.getDate()).padStart(2, "0");

  return `${ano}-${mes}-${dia}`;
}

function obterAno(valor) {
  const data = converterParaDate(valor);
  return data ? String(data.getFullYear()) : "";
}

function extrairDatasPeriodo(periodo) {
  const texto = String(periodo || "");
  const datasBR = texto.match(/\d{2}\/\d{2}\/\d{4}/g);

  if (datasBR && datasBR.length >= 2) {
    return {
      inicio: datasBR[0],
      fim: datasBR[datasBR.length - 1]
    };
  }

  const datasISO = texto.match(/\d{4}-\d{2}-\d{2}/g);

  if (datasISO && datasISO.length >= 2) {
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

function usuarioEhAdministrador(usuario) {
  if (!usuario) {
    return false;
  }

  if (usuario.admin === true || usuario.isAdmin === true || usuario.administrador === true) {
    return true;
  }

  const texto = normalizarTexto([
    usuario.perfil,
    usuario.tipo,
    usuario.nivel,
    usuario.cargo,
    usuario.funcao,
    usuario.role,
    usuario.acesso,
    usuario.permissao,
    usuario.email
  ].filter(Boolean).join(" "));

  return texto.includes("admin") || texto.includes("administrador");
}

function aplicarVisibilidadeAdministrador() {
  const admin = usuarioEhAdministrador(usuarioLogadoGlobal);

  document.body.classList.toggle("usuario-admin", admin);

  document.querySelectorAll("[data-admin-only]").forEach((elemento) => {
    if (admin) {
      elemento.style.removeProperty("display");
      elemento.removeAttribute("aria-disabled");
    } else {
      elemento.style.display = "none";
      elemento.setAttribute("aria-disabled", "true");
    }
  });
}

function obterColspanTabela() {
  return usuarioEhAdministrador(usuarioLogadoGlobal) ? 11 : 10;
}

function obterNomeUsuario(usuario) {
  return usuario?.nome || usuario?.displayName || usuario?.usuario || usuario?.email || "Usuário não identificado";
}

function obterEmailUsuario(usuario) {
  return usuario?.email || usuario?.usuarioEmail || usuario?.login || "-";
}

function obterLocalidadeOriginal(obra) {
  return obra.localidade || obra.cidade || obra.site || obra.local || obra.localidadeObra || "";
}

function buscarLocalidadeNoMapa(localidade) {
  return MAPA_LOCALIDADE_REGIONAL[normalizarLocalidade(localidade)] || null;
}

function obterLocalidadeCorrigida(obra) {
  const original = obterLocalidadeOriginal(obra);
  const itemMapa = buscarLocalidadeNoMapa(original);
  return itemMapa ? itemMapa.localidade : original;
}

function obterRegionalPelaLocalidade(localidade) {
  const itemMapa = buscarLocalidadeNoMapa(localidade);
  return itemMapa ? itemMapa.regional : "";
}

function obterRegionalCorrigida(obra) {
  const localidade = obterLocalidadeCorrigida(obra);
  const regionalPelaLocalidade = obterRegionalPelaLocalidade(localidade);

  if (regionalPelaLocalidade) {
    return regionalPelaLocalidade;
  }

  return normalizarRegional(obra.regional || obra.regionalNome || obra.regionalObra || "");
}

function chaveMapa(valor) {
  return normalizarTexto(valor);
}

function chavesUnicas(lista) {
  return [...new Set(lista.filter(Boolean).map(chaveMapa).filter(Boolean))];
}

function obterCodigoObra(obra, docId) {
  return obra.idObra || obra.codigoObra || obra.codigo || obra.idProjeto || obra.obraId || docId || "-";
}

function obterNomeObra(obra) {
  return obra.nomeProjeto || obra.nomeObra || obra.projeto || obra.obra || obra.titulo || "-";
}

function obterClienteObra(obra) {
  return obra.cliente || obra.sponsor || obra.emailSponsor || obra.responsavel || "-";
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
    obra.nomeObra,
    obra.obra,
    obra.projeto
  ]);
}

function ordemPrioridade(valor) {
  const prioridade = normalizarTexto(valor);

  const mapa = {
    "critica": 1,
    "muito alta": 2,
    "alta": 3,
    "moderada": 4,
    "baixa": 5
  };

  return mapa[prioridade] || 99;
}

function calcularStatus(obra, custoExecucao, fisicoRealAcum) {
  const fisico = numeroBRL(
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

  if (fisico > 0 && fisico < 100) {
    return "Em andamento";
  }

  if (custoExecucao > 0 && fisico <= 0) {
    return "Paralisada";
  }

  const statusInformado = obra.status || obra.statusObra || obra.statusNovo || obra.fase || "";

  if (statusInformado) {
    return normalizarStatus(statusInformado);
  }

  return "Planejado";
}

function adicionarDatasMapa(mapa, chave, inicio, fim) {
  const chaveFinal = chaveMapa(chave);

  if (!chaveFinal) {
    return;
  }

  if (!mapa[chaveFinal]) {
    mapa[chaveFinal] = {
      inicio: "",
      fim: "",
      quantidadeRegistros: 0
    };
  }

  mapa[chaveFinal].quantidadeRegistros += 1;

  const tempoInicioNovo = dataParaTempo(inicio);
  const tempoFimNovo = dataParaTempo(fim);
  const tempoInicioAtual = dataParaTempo(mapa[chaveFinal].inicio);
  const tempoFimAtual = dataParaTempo(mapa[chaveFinal].fim);

  if (tempoInicioNovo !== null && (tempoInicioAtual === null || tempoInicioNovo < tempoInicioAtual)) {
    mapa[chaveFinal].inicio = inicio;
  }

  if (tempoFimNovo !== null && (tempoFimAtual === null || tempoFimNovo > tempoFimAtual)) {
    mapa[chaveFinal].fim = fim;
  }
}

function montarMapaDatas(snapshotCurva) {
  const mapaDatas = {};

  snapshotCurva.forEach((documento) => {
    const item = documento.data();
    const periodo = extrairDatasPeriodo(item.periodo);
    const inicio = item.dataInicio || item.dataInicioPrevisto || item.inicio || item.inicioPrevisto || periodo.inicio || "";
    const fim = item.dataFim || item.dataTerminoPrevisto || item.dataFimPrevisto || item.termino || item.fim || periodo.fim || "";
    const chaves = chavesUnicas([
      item.obraId,
      item.idObra,
      item.codigoObra,
      item.idProjeto,
      item.nomeProjeto,
      item.obraNome,
      item.nomeObra,
      item.obra,
      item.projeto
    ]);

    chaves.forEach((chave) => {
      adicionarDatasMapa(mapaDatas, chave, inicio, fim);
    });
  });

  return mapaDatas;
}

function obterOrdemRegistro(item) {
  const datas = [
    item.dataAtualizacao,
    item.atualizadoEm,
    item.criadoEm,
    item.dataRealizacao,
    item.dataLancamento,
    item.data
  ];

  for (const data of datas) {
    const tempo = dataParaTempo(data);

    if (tempo !== null) {
      return tempo;
    }
  }

  const semana = Number(String(item.semana || "").replace(/[^\d]/g, ""));
  return Number.isFinite(semana) ? semana : -1;
}

function obterValorCampo(item, campos) {
  for (const campo of campos) {
    if (item[campo] !== undefined && item[campo] !== null && item[campo] !== "") {
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

function montarMapaRealizado(snapshotRealizado) {
  const mapa = {};

  snapshotRealizado.forEach((documento) => {
    const item = documento.data();
    const chaves = chavesUnicas([
      item.obraId,
      item.idObra,
      item.codigoObra,
      item.idProjeto,
      item.nomeProjeto,
      item.obraNome,
      item.nomeObra,
      item.obra,
      item.projeto
    ]);

    chaves.forEach((chave) => {
      if (!mapa[chave]) {
        mapa[chave] = {
          financeiroRealAcum: 0,
          fisicoRealAcum: 0,
          ordemFinanceiro: -1,
          ordemFisico: -1,
          quantidadeRegistros: 0,
          somaFinanceiroSemanal: 0,
          somaFisicoSemanal: 0,
          possuiFinanceiroAcum: false,
          possuiFisicoAcum: false
        };
      }

      const grupo = mapa[chave];
      grupo.quantidadeRegistros += 1;

      const ordem = obterOrdemRegistro(item);

      const financeiroAcum = obterValorCampo(item, [
        "financeiroRealAcum",
        "financeiroRealizadoAcum",
        "financeiroAcumReal",
        "financeiroExecutadoAcum",
        "financeiroAcumuladoReal",
        "custoRealAcumulado",
        "custoAcumulado",
        "financeiroAcum"
      ]);

      const fisicoAcum = obterValorCampo(item, [
        "fisicoRealAcum",
        "fisicoRealizadoAcum",
        "fisicoAcumReal",
        "fisicoExecutadoAcum",
        "fisicoAcumuladoReal",
        "avancoFisicoAcumulado",
        "avancoFisicoNovo",
        "fisicoAcum"
      ]);

      if (financeiroAcum.existe) {
        grupo.possuiFinanceiroAcum = true;

        if (ordem > grupo.ordemFinanceiro || (ordem === grupo.ordemFinanceiro && financeiroAcum.valor > grupo.financeiroRealAcum)) {
          grupo.ordemFinanceiro = ordem;
          grupo.financeiroRealAcum = financeiroAcum.valor;
        }
      } else {
        grupo.somaFinanceiroSemanal += numeroBRL(
          item.financeiroReal ??
          item.financeiroRealizado ??
          item.custoSemana ??
          item.custoReal ??
          item.financeiroExecutado ??
          item.investimentoNovo ??
          0
        );
      }

      if (fisicoAcum.existe) {
        grupo.possuiFisicoAcum = true;

        if (ordem > grupo.ordemFisico || (ordem === grupo.ordemFisico && fisicoAcum.valor > grupo.fisicoRealAcum)) {
          grupo.ordemFisico = ordem;
          grupo.fisicoRealAcum = fisicoAcum.valor;
        }
      } else {
        grupo.somaFisicoSemanal += numeroBRL(
          item.fisicoReal ??
          item.fisicoRealizado ??
          item.avancoFisico ??
          item.avancoFisicoNovo ??
          item.fisico ??
          0
        );
      }
    });
  });

  Object.values(mapa).forEach((grupo) => {
    if (!grupo.possuiFinanceiroAcum) {
      grupo.financeiroRealAcum = grupo.somaFinanceiroSemanal;
    }

    if (!grupo.possuiFisicoAcum) {
      grupo.fisicoRealAcum = grupo.somaFisicoSemanal;
    }
  });

  return mapa;
}

function buscarNoMapa(mapa, chaves) {
  for (const chave of chaves) {
    if (mapa[chave]) {
      return mapa[chave];
    }
  }

  return null;
}

async function buscarColecao(nomeColecao) {
  try {
    return await getDocs(collection(db, nomeColecao));
  } catch (error) {
    console.warn(`Não foi possível carregar a coleção ${nomeColecao}:`, error);
    return {
      empty: true,
      size: 0,
      forEach: () => {}
    };
  }
}

function criarSnapshotVirtual(listaDocumentos) {
  return {
    empty: listaDocumentos.length === 0,
    size: listaDocumentos.length,
    forEach: (callback) => listaDocumentos.forEach(callback)
  };
}

async function buscarColecoesDeObras() {
  const nomesColecoes = ["obras", "projetos"];
  const documentos = [];

  for (const nomeColecao of nomesColecoes) {
    try {
      const snapshot = await getDocs(collection(db, nomeColecao));

      snapshot.forEach((documentoFirebase) => {
        documentos.push({
          id: documentoFirebase.id,
          ref: documentoFirebase.ref,
          data: () => ({
            ...documentoFirebase.data(),
            colecaoOrigem: nomeColecao
          })
        });
      });
    } catch (error) {
      console.warn(`Não foi possível carregar a coleção ${nomeColecao}:`, error);
    }
  }

  return criarSnapshotVirtual(documentos);
}

function limparSelect(select, textoPadrao) {
  if (!select) {
    return;
  }

  select.innerHTML = "";

  const option = document.createElement("option");
  option.value = "";
  option.textContent = textoPadrao;
  select.appendChild(option);
}

function adicionarOption(select, valor, texto = valor) {
  if (!select) {
    return;
  }

  const option = document.createElement("option");
  option.value = valor;
  option.textContent = texto;
  select.appendChild(option);
}

function criarCelulaTexto(texto, classe = "") {
  const td = document.createElement("td");

  if (classe) {
    td.className = classe;
  }

  td.textContent = texto || "-";
  return td;
}

function criarCelulaComElemento(elemento) {
  const td = document.createElement("td");
  td.appendChild(elemento);
  return td;
}

function criarBadgeStatus(status) {
  const statusFinal = normalizarStatus(status);
  const span = document.createElement("span");
  span.className = `badge ${normalizarTexto(statusFinal).replace(/\s+/g, "-")}`;
  span.textContent = statusFinal;
  return span;
}

function criarBadgePrioridade(prioridade) {
  if (!prioridade || prioridade === "-") {
    return document.createTextNode("-");
  }

  const span = document.createElement("span");
  span.className = `badge-prioridade prioridade-${normalizarTexto(prioridade).replace(/\s+/g, "-")}`;
  span.textContent = prioridade;
  return span;
}

function mostrarMensagemTabela(mensagem) {
  if (!tbodyProjetos) {
    return;
  }

  tbodyProjetos.innerHTML = "";

  const tr = document.createElement("tr");
  const td = document.createElement("td");
  td.colSpan = obterColspanTabela();
  td.textContent = mensagem;
  tr.appendChild(td);
  tbodyProjetos.appendChild(tr);
}

function criarCelulaAcoes(obra) {
  if (!usuarioEhAdministrador(usuarioLogadoGlobal)) {
    return null;
  }

  const td = document.createElement("td");
  td.className = "coluna-acoes";
  td.setAttribute("data-admin-only", "");

  const div = document.createElement("div");
  div.className = "acoes-tabela";

  const btnEditar = document.createElement("button");
  btnEditar.type = "button";
  btnEditar.className = "btn-editar-datas";
  btnEditar.title = "Editar datas da obra";
  btnEditar.innerHTML = '<i class="fa-solid fa-pen-to-square"></i>';
  btnEditar.addEventListener("click", (event) => {
    event.stopPropagation();
    abrirModalEdicaoDatas(obra);
  });

  div.appendChild(btnEditar);
  td.appendChild(div);
  return td;
}

async function carregarProjetos() {
  try {
    mostrarMensagemTabela("Carregando projetos...");

    const snapshotObras = await buscarColecoesDeObras();
    const snapshotCurva = await buscarColecao("planejamentoCurvaS");
    const snapshotRealizado = await buscarColecao("realizadoCurvaS");
    const mapaDatas = montarMapaDatas(snapshotCurva);
    const mapaRealizado = montarMapaRealizado(snapshotRealizado);

    listaProjetos = [];

    snapshotObras.forEach((documentoFirebase) => {
      const obra = documentoFirebase.data();
      const localidadeCorrigida = obterLocalidadeCorrigida(obra);
      const regionalCorrigida = obterRegionalCorrigida(obra);
      const chaves = obterChavesObra(obra, documentoFirebase.id);
      const datasCurva = buscarNoMapa(mapaDatas, chaves) || {};
      const realizado = buscarNoMapa(mapaRealizado, chaves) || {};

      const custoExecucao = numeroBRL(
        realizado.financeiroRealAcum ??
        obra.financeiroRealAcum ??
        obra.financeiroRealizadoAcum ??
        obra.financeiroAcumReal ??
        obra.financeiroExecutadoAcum ??
        obra.financeiroAcumuladoReal ??
        obra.custoRealAcumulado ??
        obra.valorExecutado ??
        obra.executado ??
        0
      );

      const fisicoRealAcum = numeroBRL(
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
        obra.dataInicio ||
        obra.dataInicioPrevisto ||
        obra.inicioPrevisto ||
        obra.inicio ||
        obra.dataInicioObra ||
        datasCurva.inicio ||
        "";

      const fimObra =
        obra.dataFim ||
        obra.dataTerminoPrevisto ||
        obra.dataFimPrevisto ||
        obra.dataTermino ||
        obra.terminoPrevisto ||
        obra.termino ||
        obra.fim ||
        obra.dataFimObra ||
        datasCurva.fim ||
        "";

      const possuiPlanejamento = Number(datasCurva.quantidadeRegistros || 0) > 0;
      const possuiRealizado = Number(realizado.quantidadeRegistros || 0) > 0 || custoExecucao > 0 || fisicoRealAcum > 0;

      listaProjetos.push({
        id: documentoFirebase.id,
        ...obra,
        colecaoOrigem: obra.colecaoOrigem || "obras",
        regional: regionalCorrigida,
        localidade: localidadeCorrigida,
        codigoObraTela: obterCodigoObra(obra, documentoFirebase.id),
        nomeObraTela: obterNomeObra(obra),
        inicioObraTela: inicioObra,
        fimObraTela: fimObra,
        custoExecucao,
        fisicoRealAcum,
        statusFinal: calcularStatus(obra, custoExecucao, fisicoRealAcum),
        possuiPlanejamento,
        possuiRealizado,
        prioridadeFinal: obra.gutNivel || obra.prioridade || obra.nivel || "-",
        clienteTela: obterClienteObra(obra)
      });
    });

    carregarFiltros();
    aplicarFiltros();
  } catch (error) {
    console.error("Erro ao carregar projetos:", error);
    mostrarMensagemTabela("Erro ao carregar projetos. Verifique suas permissões no Firestore.");
  }
}

function carregarRegionaisOficiais() {
  limparSelect(filtroRegional, "Todas");

  Object.keys(LOCALIDADES_POR_REGIONAL).forEach((regional) => {
    adicionarOption(filtroRegional, regional);
  });
}

function carregarLocalidadesPorRegional(regionalSelecionada = "") {
  limparSelect(filtroLocalidade, "Todas");

  const localidades = regionalSelecionada && LOCALIDADES_POR_REGIONAL[regionalSelecionada]
    ? LOCALIDADES_POR_REGIONAL[regionalSelecionada]
    : Object.values(LOCALIDADES_POR_REGIONAL).flat();

  localidades.forEach((localidade) => {
    adicionarOption(filtroLocalidade, localidade);
  });
}

function carregarAnosFiltro() {
  limparSelect(filtroAno, "Todos");

  const anos = [...new Set(
    listaProjetos
      .map((item) => obterAno(item.inicioObraTela) || obterAno(item.fimObraTela))
      .filter(Boolean)
  )].sort();

  anos.forEach((ano) => {
    adicionarOption(filtroAno, ano);
  });
}

function carregarFiltros() {
  const regionalAtual = filtroRegional?.value || "";
  const localidadeAtual = filtroLocalidade?.value || "";
  const anoAtual = filtroAno?.value || "";

  carregarRegionaisOficiais();

  if (regionalAtual && LOCALIDADES_POR_REGIONAL[regionalAtual]) {
    filtroRegional.value = regionalAtual;
  }

  carregarLocalidadesPorRegional(filtroRegional?.value || "");

  if (localidadeAtual && Array.from(filtroLocalidade.options).some((opcao) => opcao.value === localidadeAtual)) {
    filtroLocalidade.value = localidadeAtual;
  }

  carregarAnosFiltro();

  if (anoAtual && Array.from(filtroAno.options).some((opcao) => opcao.value === anoAtual)) {
    filtroAno.value = anoAtual;
  }
}

function aplicarFiltros() {
  let lista = [...listaProjetos];

  if (filtroRegional?.value) {
    lista = lista.filter((item) => {
      const regionalReal = obterRegionalPelaLocalidade(item.localidade) || normalizarRegional(item.regional);
      return regionalReal === filtroRegional.value;
    });
  }

  if (filtroLocalidade?.value) {
    lista = lista.filter((item) => normalizarLocalidade(item.localidade) === normalizarLocalidade(filtroLocalidade.value));
  }

  if (filtroAno?.value) {
    lista = lista.filter((item) => obterAno(item.inicioObraTela) === filtroAno.value || obterAno(item.fimObraTela) === filtroAno.value);
  }

  if (filtroGutNivel?.value) {
    lista = lista.filter((item) => normalizarTexto(item.prioridadeFinal) === normalizarTexto(filtroGutNivel.value));
  }

  if (filtroStatus?.value) {
    lista = lista.filter((item) => normalizarTexto(normalizarStatus(item.statusFinal)) === normalizarTexto(normalizarStatus(filtroStatus.value)));
  }

  lista.sort((a, b) => {
    const prioridadeA = ordemPrioridade(a.prioridadeFinal);
    const prioridadeB = ordemPrioridade(b.prioridadeFinal);

    if (prioridadeA !== prioridadeB) {
      return prioridadeA - prioridadeB;
    }

    const scoreA = numeroBRL(a.gutScore || a.score || 0);
    const scoreB = numeroBRL(b.gutScore || b.score || 0);

    if (scoreA !== scoreB) {
      return scoreB - scoreA;
    }

    return String(a.nomeObraTela).localeCompare(String(b.nomeObraTela), "pt-BR");
  });

  renderTabela(lista);
  atualizarKPIs(lista);
}

function renderTabela(lista) {
  if (!tbodyProjetos) {
    return;
  }

  tbodyProjetos.innerHTML = "";

  if (!lista.length) {
    mostrarMensagemTabela("Nenhum projeto encontrado.");
    return;
  }

  lista.forEach((obra) => {
    const tr = document.createElement("tr");

    tr.appendChild(criarCelulaTexto(obra.codigoObraTela, "codigoProjeto"));
    tr.appendChild(criarCelulaTexto(obra.nomeObraTela, "nomeProjeto"));
    tr.appendChild(criarCelulaTexto(obra.regional || "-"));
    tr.appendChild(criarCelulaTexto(obra.localidade || "-"));
    tr.appendChild(criarCelulaTexto(moeda(obra.custoExecucao), "valorExecucao"));
    tr.appendChild(criarCelulaTexto(formatarData(obra.inicioObraTela)));
    tr.appendChild(criarCelulaTexto(formatarData(obra.fimObraTela)));
    tr.appendChild(criarCelulaComElemento(criarBadgePrioridade(obra.prioridadeFinal)));
    tr.appendChild(criarCelulaTexto(obra.clienteTela || "-"));
    tr.appendChild(criarCelulaComElemento(criarBadgeStatus(obra.statusFinal)));

    const celulaAcoes = criarCelulaAcoes(obra);

    if (celulaAcoes) {
      tr.appendChild(celulaAcoes);
    }

    tbodyProjetos.appendChild(tr);
  });
}

function atualizarKPIs(lista) {
  const totalCusto = lista.reduce((soma, item) => soma + numeroBRL(item.custoExecucao), 0);

  if (totalFiltrado) {
    totalFiltrado.textContent = moeda(totalCusto);
  }

  if (kpiTotal) {
    kpiTotal.textContent = lista.length;
  }

  if (kpiValidadas) {
    kpiValidadas.textContent = lista.filter((item) => {
      const aprovacao = normalizarTexto(item.aprovacaoCliente || item.aprovacao || item.validacao || "");
      return ["aprovado", "aprovada", "validado", "validada", "sim"].includes(aprovacao);
    }).length;
  }

  if (kpiPlanejadas) {
    kpiPlanejadas.textContent = lista.filter((item) => normalizarTexto(normalizarStatus(item.statusFinal)) === "planejado").length;
  }

  if (kpiAndamento) {
    kpiAndamento.textContent = lista.filter((item) => normalizarTexto(normalizarStatus(item.statusFinal)) === "em andamento").length;
  }

  if (kpiParalisadas) {
    kpiParalisadas.textContent = lista.filter((item) => normalizarTexto(normalizarStatus(item.statusFinal)) === "paralisada").length;
  }

  if (kpiConcluidas) {
    kpiConcluidas.textContent = lista.filter((item) => normalizarTexto(normalizarStatus(item.statusFinal)) === "concluido").length;
  }
}

function abrirModalEdicaoDatas(obra) {
  if (!usuarioEhAdministrador(usuarioLogadoGlobal)) {
    alert("A alteração de datas é permitida somente para administrador.");
    return;
  }

  if (!modalEditarDatas) {
    return;
  }

  obraSelecionadaParaEdicao = obra;

  const dataInicioAtual = dataParaInput(obra.inicioObraTela);
  const dataFimAtual = dataParaInput(obra.fimObraTela);

  if (editObraDocId) editObraDocId.value = obra.id || "";
  if (editPossuiPlanejamento) editPossuiPlanejamento.value = obra.possuiPlanejamento ? "sim" : "nao";
  if (editPossuiRealizado) editPossuiRealizado.value = obra.possuiRealizado ? "sim" : "nao";
  if (editDataInicioAnterior) editDataInicioAnterior.value = dataInicioAtual;
  if (editDataFimAnterior) editDataFimAnterior.value = dataFimAtual;
  if (editObraNome) editObraNome.value = obra.nomeObraTela || "-";
  if (editCodigoObra) editCodigoObra.value = obra.codigoObraTela || "-";
  if (editStatusObra) editStatusObra.value = obra.statusFinal || "-";
  if (editRegionalObra) editRegionalObra.value = obra.regional || "-";
  if (editLocalidadeObra) editLocalidadeObra.value = obra.localidade || "-";
  if (editDataInicioAtual) editDataInicioAtual.value = formatarData(obra.inicioObraTela);
  if (editDataFimAtual) editDataFimAtual.value = formatarData(obra.fimObraTela);
  if (editDataInicio) editDataInicio.value = dataInicioAtual;
  if (editDataFim) editDataFim.value = dataFimAtual;
  if (editJustificativa) editJustificativa.value = "";

  if (boxAvisoImpactoCurva) {
    boxAvisoImpactoCurva.classList.toggle("ativo", Boolean(obra.possuiPlanejamento));
  }

  if (boxAvisoRealizado) {
    boxAvisoRealizado.classList.toggle("ativo", Boolean(obra.possuiRealizado));
  }

  if (avisoImpactoCurva) {
    avisoImpactoCurva.textContent = obra.possuiPlanejamento
      ? "Esta obra já possui Curva S planejada. Ao alterar as datas, a obra será marcada como replanejamento necessário."
      : "Esta obra ainda não possui Curva S planejada.";
  }

  if (avisoRealizado) {
    avisoRealizado.textContent = obra.possuiRealizado
      ? "Esta obra já possui realizado lançado. O realizado não será apagado, mas a alteração ficará registrada no histórico."
      : "Esta obra ainda não possui realizado lançado.";
  }

  modalEditarDatas.classList.add("ativo");
  modalEditarDatas.setAttribute("aria-hidden", "false");
  document.body.classList.add("modal-aberto");
}

function fecharModalEdicaoDatas() {
  if (!modalEditarDatas) {
    return;
  }

  modalEditarDatas.classList.remove("ativo");
  modalEditarDatas.setAttribute("aria-hidden", "true");
  document.body.classList.remove("modal-aberto");
  obraSelecionadaParaEdicao = null;

  if (formEditarDatas) {
    formEditarDatas.reset();
  }
}

async function salvarEdicaoDatas(event) {
  event.preventDefault();

  if (!usuarioEhAdministrador(usuarioLogadoGlobal)) {
    alert("A alteração de datas é permitida somente para administrador.");
    fecharModalEdicaoDatas();
    return;
  }

  const obraId = editObraDocId?.value || "";
  const novaDataInicio = editDataInicio?.value || "";
  const novaDataFim = editDataFim?.value || "";
  const dataInicioAnterior = editDataInicioAnterior?.value || "";
  const dataFimAnterior = editDataFimAnterior?.value || "";
  const possuiPlanejamento = editPossuiPlanejamento?.value === "sim";
  const possuiRealizado = editPossuiRealizado?.value === "sim";
  const justificativa = String(editJustificativa?.value || "").trim();

  if (!obraId) {
    alert("Não foi possível identificar a obra selecionada.");
    return;
  }

  if (!novaDataInicio || !novaDataFim) {
    alert("Informe a nova data de início e a nova data de término.");
    return;
  }

  const tempoInicio = dataParaTempo(novaDataInicio);
  const tempoFim = dataParaTempo(novaDataFim);

  if (tempoInicio === null || tempoFim === null) {
    alert("As datas informadas são inválidas.");
    return;
  }

  if (tempoFim < tempoInicio) {
    alert("A data de término não pode ser menor que a data de início.");
    return;
  }

  if (novaDataInicio === dataInicioAnterior && novaDataFim === dataFimAnterior) {
    alert("Nenhuma alteração foi identificada nas datas.");
    return;
  }

  if (!justificativa) {
    alert("Informe a justificativa da alteração.");
    return;
  }

  if (possuiPlanejamento) {
    const confirmar = window.confirm("Esta obra possui Curva S planejada. Ao alterar as datas, a obra será marcada como replanejamento necessário. Deseja continuar?");
    if (!confirmar) return;
  }

  if (possuiRealizado) {
    const confirmarRealizado = window.confirm("Esta obra possui realizado lançado. O realizado não será apagado, mas a alteração ficará registrada no histórico. Deseja continuar?");
    if (!confirmarRealizado) return;
  }

  const obraSelecionada = obraSelecionadaParaEdicao || listaProjetos.find((item) => item.id === obraId);
  const colecaoAtualizacao = obraSelecionada?.colecaoOrigem || "obras";

  const historico = {
    tipo: "ALTERACAO_DATAS_OBRA",
    dataInicioAnterior,
    dataFimAnterior,
    dataInicioNova: novaDataInicio,
    dataFimNova: novaDataFim,
    dataInicioAnteriorFormatada: formatarData(dataInicioAnterior),
    dataFimAnteriorFormatada: formatarData(dataFimAnterior),
    dataInicioNovaFormatada: formatarData(novaDataInicio),
    dataFimNovaFormatada: formatarData(novaDataFim),
    justificativa,
    possuiPlanejamento,
    possuiRealizado,
    alteradoPorNome: obterNomeUsuario(usuarioLogadoGlobal),
    alteradoPorEmail: obterEmailUsuario(usuarioLogadoGlobal),
    alteradoEm: new Date().toISOString()
  };

  const payloadAtualizacao = {
    dataInicio: novaDataInicio,
    dataFim: novaDataFim,
    dataInicioPrevisto: novaDataInicio,
    dataTerminoPrevisto: novaDataFim,
    dataFimPrevisto: novaDataFim,
    datasObraAtualizadas: true,
    datasObraAtualizadasEm: serverTimestamp(),
    datasObraAtualizadasPorNome: obterNomeUsuario(usuarioLogadoGlobal),
    datasObraAtualizadasPorEmail: obterEmailUsuario(usuarioLogadoGlobal),
    replanejamentoNecessario: Boolean(possuiPlanejamento),
    reprogramacaoNecessaria: Boolean(possuiPlanejamento),
    motivoReplanejamento: possuiPlanejamento
      ? "Datas da obra alteradas após existência de Curva S planejada."
      : "",
    historicoAlteracoesDatas: arrayUnion(historico)
  };

  try {
    if (btnSalvarEdicaoDatas) {
      btnSalvarEdicaoDatas.disabled = true;
      btnSalvarEdicaoDatas.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Salvando...';
    }

    await updateDoc(doc(db, colecaoAtualizacao, obraId), payloadAtualizacao);

    alert("Datas da obra atualizadas com sucesso.");

    fecharModalEdicaoDatas();
    await carregarProjetos();
  } catch (error) {
    console.error("Erro ao atualizar datas da obra:", error);
    alert("Erro ao atualizar as datas da obra. Verifique suas permissões no Firestore.");
  } finally {
    if (btnSalvarEdicaoDatas) {
      btnSalvarEdicaoDatas.disabled = false;
      btnSalvarEdicaoDatas.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Salvar Alterações';
    }
  }
}

function exportarPDF() {
  document.body.classList.add("exportando-pdf");

  setTimeout(() => {
    window.print();

    setTimeout(() => {
      document.body.classList.remove("exportando-pdf");
    }, 600);
  }, 100);
}

window.exportarPDF = exportarPDF;

function configurarEventos() {
  filtroRegional?.addEventListener("change", () => {
    carregarLocalidadesPorRegional(filtroRegional.value);

    if (filtroLocalidade) {
      filtroLocalidade.value = "";
    }

    aplicarFiltros();
  });

  filtroLocalidade?.addEventListener("change", aplicarFiltros);
  filtroAno?.addEventListener("change", aplicarFiltros);
  filtroGutNivel?.addEventListener("change", aplicarFiltros);
  filtroStatus?.addEventListener("change", aplicarFiltros);

  btnFecharModalEdicaoDatas?.addEventListener("click", fecharModalEdicaoDatas);
  btnCancelarEdicaoDatas?.addEventListener("click", fecharModalEdicaoDatas);

  modalEditarDatas?.addEventListener("click", (event) => {
    if (event.target === modalEditarDatas) {
      fecharModalEdicaoDatas();
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && modalEditarDatas?.classList.contains("ativo")) {
      fecharModalEdicaoDatas();
    }
  });

  formEditarDatas?.addEventListener("submit", salvarEdicaoDatas);
}

document.addEventListener("DOMContentLoaded", async () => {
  try {
    usuarioLogadoGlobal = await protegerPagina();

    aplicarVisibilidadeAdministrador();
    configurarEventos();
    await carregarProjetos();
  } catch (error) {
    console.error("Erro ao iniciar Gestão de Obras:", error);

    mostrarMensagemTabela("Erro ao iniciar a tela de Gestão de Obras. Verifique o login e as permissões.");

    alert("Erro ao iniciar a tela de Gestão de Obras.");
  }
});