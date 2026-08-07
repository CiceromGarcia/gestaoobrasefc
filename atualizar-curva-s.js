/* =====================================================
   ATUALIZAR CURVA S - PROTEGIDO COM AUTH GUARD
   Arquivo: atualizar-curva-s.js
   Versão: v003

   Correções:
   - Cria permissão específica para lançar Curva S.
   - Campo de permissão: podeLancarCurvaS: true
   - Usuário comum autorizado pode lançar realizado da Curva S.
   - Usuário comum NÃO altera status da obra.
   - Administrador, gestor, planejador, engenharia e editor mantêm acesso total.
   - Firestore continua protegido por regras.
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
  query,
  where,
  addDoc,
  doc,
  updateDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.3/firebase-firestore.js";

/* =========================================
   CONFIGURAÇÕES
========================================= */

/*
  SEGURANÇA: lista fixa de e-mails admin removida (ficava exposta
  via "Ver código-fonte"). Perfil salvo no Firestore é a única
  fonte de verdade.
*/

const COLECAO_OBRAS =
"obras";

const COLECAO_PLANEJAMENTO =
"planejamentoCurvaS";

const COLECAO_REALIZADO =
"realizadoCurvaS";

/* =========================================
   USUÁRIO LOGADO
========================================= */

let usuarioLogadoGlobal = null;

/* =========================================
   ELEMENTOS
========================================= */

const filtroRegional =
document.getElementById("filtroRegional");

const filtroLocalidade =
document.getElementById("filtroLocalidade");

const filtroObra =
document.getElementById("filtroObra");

const valorObra =
document.getElementById("valorObra");

const valorExecutado =
document.getElementById("valorExecutado");

const barraProgressoExecutado =
document.getElementById("barraProgressoExecutado");

const barraProgressoExecutadoTexto =
document.getElementById("barraProgressoExecutadoTexto");

const tabelaSemanas =
document.getElementById("tabelaSemanas");

const btnSalvar =
document.getElementById("btnSalvar");

const semanaSelecionadaLabel =
document.getElementById("semanaSelecionadaLabel");

const inputFisicoReal =
document.getElementById("fisicoReal");

const inputFinanceiroReal =
document.getElementById("financeiroReal");

const selectLancamentoOrigem =
document.getElementById("lancamentoOrigem");

const boxLancamentoCentroCusto =
document.getElementById("boxLancamentoCentroCusto");

const inputLancamentoCentroCusto =
document.getElementById("lancamentoCentroCusto");

const inputLancamentoValor =
document.getElementById("lancamentoValor");

const btnAdicionarLancamento =
document.getElementById("btnAdicionarLancamento");

const tbodyLancamentos =
document.getElementById("tbodyLancamentos");

const avisoSemLancamentos =
document.getElementById("avisoSemLancamentos");

let lancamentosSemanaAtual = [];

const inputAnomalias =
document.getElementById("anomalias");

/* =========================================
   ELEMENTOS DA ANOMALIA
========================================= */

const selectTemAnomalia =
document.getElementById("temAnomalia");

const selectTipoAnomalia =
document.getElementById("tipoAnomalia");

const selectCriticidadeAnomalia =
document.getElementById("criticidadeAnomalia");

const selectImpactoAnomalia =
document.getElementById("impactoAnomalia");

const selectStatusAnomalia =
document.getElementById("statusAnomalia");

const inputPrazoTratativaAnomalia =
document.getElementById("prazoTratativaAnomalia");

const inputDescricaoAnomalia =
document.getElementById("descricaoAnomalia");

const inputAcaoCorretivaAnomalia =
document.getElementById("acaoCorretivaAnomalia");

const inputResponsavelAnomalia =
document.getElementById("responsavelAnomalia");

/* =========================================
   ELEMENTOS STATUS DA OBRA
========================================= */

const statusObra =
document.getElementById("statusObra");

const motivoParalisacao =
document.getElementById("motivoParalisacao");

const btnSalvarStatusObra =
document.getElementById("btnSalvarStatusObra");

const btnReativarObra =
document.getElementById("btnReativarObra");

const statusObraLabel =
document.getElementById("statusObraLabel");

/* =========================================
   ELEMENTOS DO TOPO
========================================= */

const usuarioEmailTopo =
document.getElementById("usuarioEmailTopo");

const usuarioPerfilTopo =
document.getElementById("usuarioPerfilTopo");

const usuarioLogadoInfo =
document.getElementById("usuarioLogadoInfo");

/* =========================================
   VARIÁVEIS
========================================= */

let obras = [];

let planejamentosObra = [];

let realizadosObra = [];

let obraSelecionada = null;

let semanaSelecionada = null;

let modoEdicao = false;

let realizadoEmEdicaoId = null;

/* =========================================
   INICIALIZAÇÃO
========================================= */

document.addEventListener(
  "DOMContentLoaded",
  iniciarTela
);

async function iniciarTela() {

  try {

    usuarioLogadoGlobal =
    await protegerPagina();

    atualizarCabecalhoUsuario();

    configurarEventos();

    configurarMascaraFinanceiro();
    configurarEventosLancamentos();

    configurarStatusObra();

    atualizarEstadoAnomalia();

    aplicarPermissoesNaTela();

    await carregarObras();

    const obraIdNaUrl = new URLSearchParams(window.location.search).get("obraId");

    if (obraIdNaUrl && filtroObra) {
      const existeNaLista = Array.from(filtroObra.options).some(
        (opcao) => opcao.value === obraIdNaUrl
      );

      if (existeNaLista) {
        filtroObra.value = obraIdNaUrl;
        await selecionarObra();
      }
    }

  } catch (error) {

    console.error(
      "Erro ao iniciar atualização da Curva S:",
      error
    );

    alert(
      "Erro ao iniciar a tela. Faça login novamente."
    );

  }

}

/* =========================================
   NORMALIZAÇÃO
========================================= */

function normalizarTexto(valor) {

  return String(valor || "")
    .toLowerCase()
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

}

function emailNormalizado(valor) {

  return String(valor || "")
    .toLowerCase()
    .trim();

}

function textoLimpo(valor) {

  return String(valor || "")
    .trim()
    .replace(/\s+/g, " ");

}

/* =========================================
   PERFIL E PERMISSÕES
========================================= */

function usuarioEhAdministrador(usuario) {

  const perfil =
  normalizarTexto(
    usuario?.perfil
  );

  return (
    perfil === "administrador" ||
    perfil === "admin" ||
    perfil === "adm" ||
    perfil === "administrator" ||
    usuario?.admin === true ||
    usuario?.isAdmin === true
  );

}

function usuarioPodeLancarCurvaS(usuario) {

  if (usuarioEhAdministrador(usuario)) {
    return true;
  }

  const perfil =
  normalizarTexto(
    usuario?.perfil
  );

  return (
    [
      "gestor",
      "planejador",
      "engenharia",
      "editor"
    ].includes(perfil) ||
    usuario?.podeLancarCurvaS === true ||
    usuario?.permissaoCurvaS === true ||
    usuario?.podeAtualizarCurvaS === true
  );

}

function usuarioPodeEditarStatusObra(usuario) {

  if (usuarioEhAdministrador(usuario)) {
    return true;
  }

  const perfil =
  normalizarTexto(
    usuario?.perfil
  );

  return [
    "gestor",
    "planejador",
    "engenharia",
    "editor"
  ].includes(perfil);

}

function usuarioPodeCorrigirRealizado(usuario) {

  return usuarioEhAdministrador(usuario);

}

function usuarioPodeEditarObras(usuario) {

  return usuarioPodeEditarStatusObra(usuario);

}

function obterRegionalUsuario() {

  return (
    usuarioLogadoGlobal?.regional ||
    usuarioLogadoGlobal?.regionalUsuario ||
    ""
  );

}

function usuarioTemEscopoNaRegional(regional) {

  if (usuarioEhAdministrador(usuarioLogadoGlobal)) {
    return true;
  }

  const regionalUsuario =
  normalizarTexto(
    obterRegionalUsuario()
  );

  const regionalRegistro =
  normalizarTexto(
    regional
  );

  if (!regionalUsuario) {
    return true;
  }

  return regionalUsuario === regionalRegistro;

}

/* =========================================
   CABEÇALHO DO USUÁRIO
========================================= */

function atualizarCabecalhoUsuario() {

  const email =
  usuarioLogadoGlobal?.email ||
  usuarioLogadoGlobal?.emailAuth ||
  "";

  const perfil =
  usuarioLogadoGlobal?.perfil ||
  "";

  if (usuarioEmailTopo) {
    usuarioEmailTopo.textContent =
    email || "Não informado";
  }

  if (usuarioPerfilTopo) {

    const permissao =
    usuarioPodeLancarCurvaS(usuarioLogadoGlobal)
    ? " • Pode lançar Curva S"
    : "";

    usuarioPerfilTopo.textContent =
    `${perfil || "Não informado"}${permissao}`;

  }

  if (usuarioLogadoInfo) {

    usuarioLogadoInfo.classList.toggle(
      "perfil-administrador",
      usuarioEhAdministrador(usuarioLogadoGlobal)
    );

    usuarioLogadoInfo.classList.toggle(
      "perfil-sem-permissao",
      !usuarioPodeLancarCurvaS(usuarioLogadoGlobal)
    );

  }

}

/* =========================================
   APLICAR PERMISSÕES NA TELA
========================================= */

function aplicarPermissoesNaTela() {

  const podeLancarCurvaS =
  usuarioPodeLancarCurvaS(
    usuarioLogadoGlobal
  );

  const podeEditarStatusObra =
  usuarioPodeEditarStatusObra(
    usuarioLogadoGlobal
  );

  if (btnSalvar) {

    btnSalvar.disabled =
    !podeLancarCurvaS;

    if (!podeLancarCurvaS) {

      btnSalvar.textContent =
      "Sem permissão para salvar";

    } else if (modoEdicao) {

      btnSalvar.textContent =
      "Salvar Correção";

    } else {

      btnSalvar.textContent =
      "Salvar Atualização";

    }

  }

  [
    inputFisicoReal,
    selectLancamentoOrigem,
    inputLancamentoCentroCusto,
    inputLancamentoValor,
    btnAdicionarLancamento,
    selectTemAnomalia
  ]
    .filter(Boolean)
    .forEach((campo) => {

      campo.disabled =
      !podeLancarCurvaS;

    });

  if (btnSalvarStatusObra) {
    btnSalvarStatusObra.disabled =
    !podeEditarStatusObra;
  }

  if (btnReativarObra) {
    btnReativarObra.disabled =
    !podeEditarStatusObra;
  }

  if (statusObra) {
    statusObra.disabled =
    !podeEditarStatusObra;
  }

  if (motivoParalisacao) {

    const deveHabilitar =
    podeEditarStatusObra &&
    statusObra?.value === "Paralisada";

    motivoParalisacao.disabled =
    !deveHabilitar;

  }

  atualizarEstadoAnomalia();

}

/* =========================================
   EVENTOS
========================================= */

function configurarEventos() {

  filtroRegional?.addEventListener(
    "change",
    () => {

      filtroLocalidade.value =
      "";

      filtroObra.value =
      "";

      obraSelecionada =
      null;

      carregarLocalidades();

      carregarObrasSelect();

      limparTela();

    }
  );

  filtroLocalidade?.addEventListener(
    "change",
    () => {

      filtroObra.value =
      "";

      obraSelecionada =
      null;

      carregarObrasSelect();

      limparTela();

    }
  );

  filtroObra?.addEventListener(
    "change",
    selecionarObra
  );

  btnSalvar?.addEventListener(
    "click",
    salvarAtualizacaoRealizado
  );

  selectTemAnomalia?.addEventListener(
    "change",
    atualizarEstadoAnomalia
  );

}

/* =========================================
   STATUS - ALTERAR SELECT
========================================= */

function configurarStatusObra() {

  statusObra?.addEventListener(
    "change",
    () => {

      if (!motivoParalisacao) {
        return;
      }

      if (statusObra.value === "Paralisada") {

        motivoParalisacao.disabled =
        !usuarioPodeEditarStatusObra(usuarioLogadoGlobal);

        if (!motivoParalisacao.disabled) {
          motivoParalisacao.focus();
        }

      } else {

        motivoParalisacao.disabled =
        true;

        motivoParalisacao.value =
        "";

      }

    }
  );

  btnSalvarStatusObra?.addEventListener(
    "click",
    salvarStatusObra
  );

  btnReativarObra?.addEventListener(
    "click",
    reativarObra
  );

}

/* =========================================
   CARREGAR OBRAS
========================================= */

/* =========================================
   STATUS REAL DA OBRA (mesma regra do dashboard.js / gestaodeobras.js)
========================================= */

function obterOrdemRealizado(item) {
  const semanaNumero = Number(
    String(item.semana || "")
      .replace(/[^\d]/g, "")
  );

  if (Number.isFinite(semanaNumero) && semanaNumero > 0) {
    return semanaNumero;
  }

  const inicioPeriodo = String(item.periodo || "")
    .split(/\s+a\s+/i)[0];

  const partes = inicioPeriodo.split("/");

  if (partes.length === 3) {
    const data = new Date(
      Number(partes[2]),
      Number(partes[1]) - 1,
      Number(partes[0])
    );

    if (!Number.isNaN(data.getTime())) {
      return data.getTime();
    }
  }

  const datas = [
    item.dataAtualizacao,
    item.atualizadoEm,
    item.criadoEm
  ];

  for (const data of datas) {
    if (data?.toDate) {
      return data.toDate().getTime();
    }
  }

  return -1;
}

function construirMapaUltimoRealizado(snapshotRealizado) {
  const mapaPorId = new Map();
  const mapaPorNome = new Map();

  snapshotRealizado.forEach((documento) => {
    const item = documento.data();

    const chaveNome = normalizarTexto(
      item.obra ||
      item.obraNome ||
      item.nomeObra ||
      ""
    );

    const registro = {
      ordem: obterOrdemRealizado(item),
      fisicoRealAcum: Number(
        item.fisicoRealAcum ??
        item.fisicoReal ??
        0
      ),
      financeiroRealAcum: converterMoeda(
        item.financeiroRealAcum ??
        item.financeiroReal ??
        0
      )
    };

    if (item.obraId) {
      const existenteId = mapaPorId.get(item.obraId);

      if (!existenteId || registro.ordem > existenteId.ordem) {
        mapaPorId.set(item.obraId, registro);
      }
    }

    if (chaveNome) {
      const existenteNome = mapaPorNome.get(chaveNome);

      if (!existenteNome || registro.ordem > existenteNome.ordem) {
        mapaPorNome.set(chaveNome, registro);
      }
    }
  });

  return { mapaPorId, mapaPorNome };
}

function calcularStatusRealObra(obra, ultimoRealizado) {
  const statusManual = normalizarTexto(
    obra.status ||
    obra.fase ||
    ""
  );

  const fisico = Number(
    ultimoRealizado?.fisicoRealAcum ?? 0
  );

  const financeiro = Number(
    ultimoRealizado?.financeiroRealAcum ?? 0
  );

  if (statusManual.includes("paralis")) {
    return "Paralisada";
  }

  if (statusManual.includes("concl") || fisico >= 100) {
    return "Concluído";
  }

  if (fisico > 0 && fisico < 100) {
    return "Em andamento";
  }

  if (financeiro > 0 && fisico === 0) {
    return "Paralisada";
  }

  if (statusManual.includes("andamento") || statusManual.includes("execu")) {
    return "Em andamento";
  }

  return "Planejado";
}

async function carregarObras() {

  try {

    const snapshot =
    await getDocs(
      collection(
        db,
        COLECAO_OBRAS
      )
    );

    /*
      Carrega o realizado (Curva S) de todas as obras de uma vez, pra
      calcular o status real de cada uma (igual ao dashboard.js e ao
      gestaodeobras.js) e poder filtrar o dropdown só pelas que estão
      "Em andamento" de verdade — não pelo status manual sozinho.
    */
    const snapshotRealizado =
    await getDocs(
      collection(
        db,
        COLECAO_REALIZADO
      )
    );

    const mapasRealizado =
    construirMapaUltimoRealizado(snapshotRealizado);

    obras =
    [];

    snapshot.forEach((docRef) => {

      const dados =
      docRef.data();

      const obra =
      normalizarObra({
        id: docRef.id,
        ...dados
      });

      const ultimoRealizado =
      mapasRealizado.mapaPorId.get(obra.id) ||
      mapasRealizado.mapaPorNome.get(
        normalizarTexto(obra.nome)
      ) ||
      null;

      obra.statusCalculado =
      calcularStatusRealObra(
        obra,
        ultimoRealizado
      );

      if (
        usuarioTemEscopoNaRegional(
          obra.regional
        )
      ) {

        obras.push(obra);

      }

    });

    obras.sort(
      (a, b) => {

        return String(a.nome || "")
          .localeCompare(
            String(b.nome || ""),
            "pt-BR"
          );

      }
    );

    carregarRegionais();

    carregarLocalidades();

    carregarObrasSelect();

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

function normalizarObra(obra) {

  /*
    CORREÇÃO: faltava "nomeProjeto" nesta lista — é o campo que o
    resto do sistema usa (cadastro, dashboard, gestão de obras). Sem
    ele, o nome ficava vazio pra quase toda obra, e o dropdown caía
    no fallback (o ID bruto do documento no Firestore).
  */
  const nome =
  obra.nomeProjeto ||
  obra.nome ||
  obra.nomeObra ||
  obra.obra ||
  obra.titulo ||
  obra.descricao ||
  "";

  const regional =
  obra.regional ||
  obra.regiao ||
  obra.regionalObra ||
  "";

  const localidade =
  obra.localidade ||
  obra.cidade ||
  obra.site ||
  "";

  const valor =
  obra.valorOrcado ||
  obra.valorTotal ||
  obra.valorObra ||
  obra.orcamento ||
  obra.custoOrcado ||
  obra.custoTotal ||
  0;

  return {
    ...obra,

    nome,
    obraNome: nome,
    obra: nome,

    regional,
    localidade,

    valorOrcado:
    converterMoeda(valor),

    status:
    obra.status ||
    obra.fase ||
    "Em andamento",

    fase:
    obra.fase ||
    obra.status ||
    "Em andamento",

    motivoParalisacao:
    obra.motivoParalisacao ||
    ""
  };

}

function carregarRegionais() {

  if (!filtroRegional) {
    return;
  }

  const regionalUsuario =
  obterRegionalUsuario();

  const regionais =
  Array.from(
    new Set(
      obras
        .map((obra) => obra.regional)
        .filter(Boolean)
    )
  ).sort(
    (a, b) => a.localeCompare(b, "pt-BR")
  );

  filtroRegional.innerHTML =
  `<option value="">Regional</option>`;

  regionais.forEach((regional) => {

    const option =
    document.createElement("option");

    option.value =
    regional;

    option.textContent =
    regional;

    filtroRegional.appendChild(option);

  });

  if (
    !usuarioEhAdministrador(usuarioLogadoGlobal) &&
    regionalUsuario
  ) {

    filtroRegional.value =
    regionalUsuario;

    filtroRegional.disabled =
    true;

  }

}

function carregarLocalidades() {

  if (!filtroLocalidade) {
    return;
  }

  const regionalSelecionada =
  filtroRegional?.value || "";

  const localidades =
  Array.from(
    new Set(
      obras
        .filter((obra) => {

          return (
            (
              !regionalSelecionada ||
              obra.regional === regionalSelecionada
            ) &&
            obra.statusCalculado === "Em andamento"
          );

        })
        .map((obra) => obra.localidade)
        .filter(Boolean)
    )
  ).sort(
    (a, b) => a.localeCompare(b, "pt-BR")
  );

  filtroLocalidade.innerHTML =
  `<option value="">Localidade</option>`;

  localidades.forEach((localidade) => {

    const option =
    document.createElement("option");

    option.value =
    localidade;

    option.textContent =
    localidade;

    filtroLocalidade.appendChild(option);

  });

}

function carregarObrasSelect() {

  if (!filtroObra) {
    return;
  }

  const regionalSelecionada =
  filtroRegional?.value || "";

  const localidadeSelecionada =
  filtroLocalidade?.value || "";

  const obrasFiltradas =
  obras.filter((obra) => {

    const passaRegional =
    !regionalSelecionada ||
    obra.regional === regionalSelecionada;

    const passaLocalidade =
    !localidadeSelecionada ||
    obra.localidade === localidadeSelecionada;

    const passaStatus =
    obra.statusCalculado === "Em andamento" ||
    obra.statusCalculado === "Planejado";

    return (
      passaRegional &&
      passaLocalidade &&
      passaStatus
    );

  });

  filtroObra.innerHTML =
  `<option value="">Obra</option>`;

  obrasFiltradas.forEach((obra) => {

    const option =
    document.createElement("option");

    option.value =
    obra.id;

    option.textContent =
    obra.nome || obra.id;

    filtroObra.appendChild(option);

  });

}

/* =========================================
   SELECIONAR OBRA
========================================= */

async function selecionarObra() {

  const idObra =
  filtroObra?.value || "";

  obraSelecionada =
  obras.find((obra) => obra.id === idObra) ||
  null;

  limparCamposAtualizacao();

  if (!obraSelecionada) {

    limparTela();
    return;

  }

  if (valorObra) {
    valorObra.value =
    formatarMoeda(
      obraSelecionada.valorOrcado
    );
  }

  aplicarStatusVisualObra();

  await carregarPlanejamentoERealizado();

}

/* =========================================
   STATUS VISUAL DA OBRA
========================================= */

function obraEstaParalisada(obra) {

  const status =
  normalizarTexto(
    obra?.status ||
    obra?.fase ||
    ""
  );

  return (
    status === "paralisada" ||
    status === "paralisado"
  );

}

function aplicarStatusVisualObra() {

  if (!obraSelecionada) {

    limparStatusObra();
    return;

  }

  const paralisada =
  obraEstaParalisada(
    obraSelecionada
  );

  if (statusObra) {

    statusObra.value =
    paralisada
    ? "Paralisada"
    : "Em andamento";

  }

  if (motivoParalisacao) {

    motivoParalisacao.value =
    obraSelecionada.motivoParalisacao || "";

    motivoParalisacao.disabled =
    !(
      paralisada &&
      usuarioPodeEditarStatusObra(usuarioLogadoGlobal)
    );

  }

  if (statusObraLabel) {

    statusObraLabel.textContent =
    paralisada
    ? "Obra paralisada"
    : "Obra em andamento";

  }

  aplicarPermissoesNaTela();

}

/* =========================================
   CARREGAR PLANEJAMENTO E REALIZADO
========================================= */

async function carregarPlanejamentoERealizado() {

  if (!obraSelecionada) {
    return;
  }

  try {

    planejamentosObra =
    await buscarPlanejamentoDaObra(
      obraSelecionada
    );

    realizadosObra =
    await buscarRealizadosDaObra(
      obraSelecionada
    );

    atualizarValorExecutado();

    renderizarTabelaSemanas();

  } catch (error) {

    console.error(
      "Erro ao carregar planejamento:",
      error
    );

    alert(
      "Erro ao carregar planejamento da obra."
    );

  }

}

async function buscarPlanejamentoDaObra(obra) {

  const resultados = [];

  const consultas = [
    query(
      collection(db, COLECAO_PLANEJAMENTO),
      where("obraId", "==", obra.id)
    )
  ];

  if (obra.nome) {

    consultas.push(
      query(
        collection(db, COLECAO_PLANEJAMENTO),
        where("obra", "==", obra.nome)
      )
    );

    consultas.push(
      query(
        collection(db, COLECAO_PLANEJAMENTO),
        where("obraNome", "==", obra.nome)
      )
    );

  }

  for (const consulta of consultas) {

    const snapshot =
    await getDocs(consulta);

    snapshot.forEach((docRef) => {

      if (
        !resultados.some(
          (item) => item.id === docRef.id
        )
      ) {

        resultados.push({
          id: docRef.id,
          ...docRef.data()
        });

      }

    });

  }

  return resultados
    .filter((item) => item.ativo !== false)
    .sort(ordenarPorSemana);

}

async function buscarRealizadosDaObra(obra) {

  const resultados = [];

  const consultas = [
    query(
      collection(db, COLECAO_REALIZADO),
      where("obraId", "==", obra.id)
    )
  ];

  if (obra.nome) {

    consultas.push(
      query(
        collection(db, COLECAO_REALIZADO),
        where("obra", "==", obra.nome)
      )
    );

    consultas.push(
      query(
        collection(db, COLECAO_REALIZADO),
        where("obraNome", "==", obra.nome)
      )
    );

  }

  for (const consulta of consultas) {

    const snapshot =
    await getDocs(consulta);

    snapshot.forEach((docRef) => {

      if (
        !resultados.some(
          (item) => item.id === docRef.id
        )
      ) {

        resultados.push({
          id: docRef.id,
          ...docRef.data()
        });

      }

    });

  }

  return resultados.sort(
    ordenarPorSemana
  );

}

function ordenarPorSemana(a, b) {

  const semanaA =
  Number(
    a.semanaNumero ||
    obterNumeroSemana(a.semana)
  );

  const semanaB =
  Number(
    b.semanaNumero ||
    obterNumeroSemana(b.semana)
  );

  return semanaA - semanaB;

}

function encontrarRealizadoDaSemana(planejado) {

  const semanaNumero =
  Number(
    planejado.semanaNumero ||
    obterNumeroSemana(planejado.semana)
  );

  const semanaTexto =
  normalizarTexto(
    planejado.semana
  );

  return realizadosObra.find((realizado) => {

    const semanaNumeroReal =
    Number(
      realizado.semanaNumero ||
      obterNumeroSemana(realizado.semana)
    );

    const semanaTextoReal =
    normalizarTexto(
      realizado.semana
    );

    return (
      (
        semanaNumero &&
        semanaNumeroReal &&
        semanaNumero === semanaNumeroReal
      )
      ||
      (
        semanaTexto &&
        semanaTextoReal &&
        semanaTexto === semanaTextoReal
      )
    );

  }) || null;

}

/* =========================================
   RENDERIZAR TABELA
========================================= */

function renderizarTabelaSemanas() {

  if (!tabelaSemanas) {
    return;
  }

  tabelaSemanas.innerHTML =
  "";

  if (!obraSelecionada) {

    tabelaSemanas.innerHTML =
    `
      <tr>
        <td colspan="9">
          Selecione uma obra para carregar o planejamento.
        </td>
      </tr>
    `;

    return;

  }

  if (!planejamentosObra.length) {

    tabelaSemanas.innerHTML =
    `
      <tr>
        <td colspan="9">
          Nenhum planejamento encontrado para esta obra.
        </td>
      </tr>
    `;

    return;

  }

  planejamentosObra.forEach((planejado) => {

    const realizado =
    encontrarRealizadoDaSemana(
      planejado
    );

    const fisicoPlanejadoRaw =
    planejado.fisicoAcum ??
    planejado.fisico ??
    planejado.fisicoPlanejado ??
    0;

    const financeiroPlanejadoRaw =
    planejado.financeiroAcum ??
    planejado.financeiro ??
    planejado.financeiroPlanejado ??
    0;

    const centroCusto =
    realizado
    ? (
        realizado.centroCustoApropriacao ||
        realizado.centroCusto ||
        "-"
      )
    : "-";

    const classeFisico =
    realizado &&
    obterFisicoRealizado(realizado) < converterPercentual(fisicoPlanejadoRaw)
    ? "texto-vermelho"
    : "";

    const classeFinanceiro =
    realizado &&
    obterFinanceiroRealizado(realizado) < converterMoeda(financeiroPlanejadoRaw)
    ? "texto-vermelho"
    : "";

    const possuiAnomalia =
    realizado
    ? realizadoPossuiAnomalia(realizado)
    : false;

    const classeAnomalia =
    possuiAnomalia
    ? "texto-vermelho"
    : "";

    const tr =
    document.createElement("tr");

    tr.appendChild(
      criarCelulaTexto(
        planejado.semana || "-"
      )
    );

    tr.appendChild(
      criarCelulaTexto(
        planejado.periodo || "-"
      )
    );

    tr.appendChild(
      criarCelulaTexto(
        formatarPercentual(
          fisicoPlanejadoRaw
        )
      )
    );

    tr.appendChild(
      criarCelulaTexto(
        formatarMoeda(
          financeiroPlanejadoRaw
        )
      )
    );

    tr.appendChild(
      criarCelulaTexto(
        realizado
        ? formatarPercentual(
            obterFisicoRealizado(realizado)
          )
        : "-",
        classeFisico
      )
    );

    tr.appendChild(
      criarCelulaTexto(
        realizado
        ? formatarMoeda(
            obterFinanceiroRealizado(realizado)
          )
        : "-",
        classeFinanceiro
      )
    );

    tr.appendChild(
      criarCelulaTexto(
        centroCusto
      )
    );

    tr.appendChild(
      criarCelulaTexto(
        realizado
        ? obterResumoAnomalia(realizado)
        : "-",
        classeAnomalia
      )
    );

    tr.appendChild(
      criarCelulaTexto(
        realizado
        ? formatarDataAtualizacao(realizado)
        : "-"
      )
    );

    if (realizado) {

      tr.classList.add(
        "linha-bloqueada"
      );

      tr.title =
      usuarioPodeCorrigirRealizado(usuarioLogadoGlobal)
      ? "Duplo clique para corrigir esta atualização."
      : "Semana já atualizada. Correção permitida apenas para administrador.";

      tr.addEventListener(
        "dblclick",
        () => {

          prepararCorrecaoRealizado(
            tr,
            planejado,
            realizado
          );

        }
      );

    } else {

      tr.addEventListener(
        "click",
        () => {

          selecionarSemanaPendente(
            tr,
            planejado
          );

        }
      );

    }

    tabelaSemanas.appendChild(
      tr
    );

  });

}

function criarCelulaTexto(valor, classe = "") {

  const td =
  document.createElement("td");

  td.textContent =
  valor ?? "-";

  if (classe) {

    td.classList.add(
      classe
    );

  }

  return td;

}

/* =========================================
   SELECIONAR SEMANA PENDENTE
========================================= */

function selecionarSemanaPendente(tr, item) {

  if (!usuarioPodeLancarCurvaS(usuarioLogadoGlobal)) {

    alert(
      "Você não tem permissão para lançar atualização da Curva S."
    );

    return;

  }

  if (!obraSelecionada) {

    alert(
      "Selecione uma obra."
    );

    return;

  }

  document
    .querySelectorAll("#tabelaSemanas tr")
    .forEach((linha) => {

      linha.classList.remove(
        "selecionada"
      );

    });

  tr.classList.add(
    "selecionada"
  );

  modoEdicao =
  false;

  realizadoEmEdicaoId =
  null;

  semanaSelecionada =
  item;

  limparCamposFormularioSemana();

  if (semanaSelecionadaLabel) {

    semanaSelecionadaLabel.textContent =
    item.semana ||
    "Semana selecionada";

  }

  if (btnSalvar) {

    btnSalvar.textContent =
    "Salvar Atualização";

  }

  aplicarPermissoesNaTela();

}

/* =========================================
   PREPARAR CORREÇÃO
========================================= */

function prepararCorrecaoRealizado(tr, item, realizado) {

  if (!usuarioPodeCorrigirRealizado(usuarioLogadoGlobal)) {

    alert(
      "Você não tem permissão para corrigir semanas já atualizadas."
    );

    return;

  }

  document
    .querySelectorAll("#tabelaSemanas tr")
    .forEach((linha) => {

      linha.classList.remove(
        "selecionada"
      );

    });

  tr.classList.add(
    "selecionada"
  );

  modoEdicao =
  true;

  realizadoEmEdicaoId =
  realizado.id;

  semanaSelecionada =
  item;

  if (semanaSelecionadaLabel) {

    semanaSelecionadaLabel.textContent =
    `${item.semana || "Semana"} - Correção`;

  }

  if (inputFisicoReal) {

    inputFisicoReal.value =
    obterFisicoRealizado(
      realizado
    );

  }

  lancamentosSemanaAtual = obterLancamentosRealizado(realizado);

  renderizarLancamentos();

  preencherCamposAnomalia(
    realizado
  );

  if (btnSalvar) {
    btnSalvar.textContent =
    "Salvar Correção";
  }

  aplicarPermissoesNaTela();

}

/* =========================================
   SALVAR ATUALIZAÇÃO
========================================= */

async function salvarAtualizacaoRealizado() {

  if (!usuarioLogadoGlobal) {

    alert(
      "Usuário não autenticado. Faça login novamente."
    );

    return;

  }

  if (!usuarioPodeLancarCurvaS(usuarioLogadoGlobal)) {

    alert(
      "Você não tem permissão para salvar atualização da Curva S."
    );

    return;

  }

  if (
    modoEdicao &&
    !usuarioPodeCorrigirRealizado(usuarioLogadoGlobal)
  ) {

    alert(
      "A correção de semanas já atualizadas é permitida apenas para administrador."
    );

    return;

  }

  if (!obraSelecionada) {

    alert(
      "Selecione uma obra."
    );

    return;

  }

  if (!semanaSelecionada) {

    alert(
      "Selecione uma semana pendente para atualizar."
    );

    return;

  }

  const fisicoReal =
  converterPercentual(
    inputFisicoReal?.value
  );

  if (
    fisicoReal < 0 ||
    fisicoReal > 100
  ) {

    alert(
      "Informe o físico realizado entre 0 e 100%."
    );

    inputFisicoReal?.focus();

    return;

  }

  if (lancamentosSemanaAtual.length === 0) {

    alert(
      "Adicione pelo menos um lançamento financeiro para esta semana (Centro de Custo, Cartão de Suprimentos, etc.)."
    );

    inputLancamentoValor?.focus();

    return;

  }

  if (
    selectTemAnomalia?.value === "Sim" &&
    !validarCamposAnomalia()
  ) {
    return;
  }

  try {

    if (btnSalvar) {
      btnSalvar.disabled =
      true;
      btnSalvar.textContent =
      "Salvando...";
    }

    const dadosAtualizacao =
    montarDadosRealizado({
      fisicoReal
    });

    if (
      modoEdicao &&
      realizadoEmEdicaoId
    ) {

      await updateDoc(
        doc(
          db,
          COLECAO_REALIZADO,
          realizadoEmEdicaoId
        ),
        {
          ...dadosAtualizacao,

          corrigidoPorUid:
          usuarioLogadoGlobal?.uid || "",

          corrigidoPorEmail:
          usuarioLogadoGlobal?.email ||
          usuarioLogadoGlobal?.emailAuth ||
          "",

          corrigidoPorNome:
          usuarioLogadoGlobal?.nome || "",

          corrigidoEm:
          serverTimestamp(),

          atualizadoEm:
          serverTimestamp()
        }
      );

      alert(
        "Correção salva com sucesso!"
      );

    } else {

      await addDoc(
        collection(
          db,
          COLECAO_REALIZADO
        ),
        {
          ...dadosAtualizacao,

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

      alert(
        "Atualização salva com sucesso!"
      );

    }

    await carregarPlanejamentoERealizado();

    limparCamposAtualizacao();

  } catch (error) {

    console.error(
      "Erro ao salvar atualização:",
      error
    );

    alert(
      "Erro ao salvar atualização. Verifique se o usuário possui o campo podeLancarCurvaS: true e se as regras do Firestore foram publicadas."
    );

  } finally {

    aplicarPermissoesNaTela();

  }

}

/* =========================================
   LANÇAMENTOS FINANCEIROS DA SEMANA
   (múltiplas origens: Centro de Custo,
   Cartão de Suprimentos, etc.)
========================================= */

function obterLancamentosRealizado(realizado) {
  const lista = realizado?.lancamentosFinanceiros;

  if (Array.isArray(lista) && lista.length > 0) {
    return lista.map((item) => ({
      origem: item.origem || "Centro de Custo",
      centroCusto: item.centroCusto || "",
      valor: converterMoeda(item.valor || 0)
    }));
  }

  // Registro antigo (anterior a esta funcionalidade): sintetiza um
  // único lançamento a partir dos campos legados, sem perder dado.
  const valorLegado = obterFinanceiroRealizado(realizado);

  if (!realizado || valorLegado <= 0) {
    return [];
  }

  const centroLegado =
    realizado.centroCustoApropriacao ||
    realizado.centroCusto ||
    "";

  return [
    {
      origem: "Centro de Custo",
      centroCusto: centroLegado,
      valor: valorLegado
    }
  ];
}

function textoSeguro(valor) {
  return String(valor ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function calcularTotalLancamentos() {
  return lancamentosSemanaAtual.reduce(
    (soma, item) => soma + converterMoeda(item.valor || 0),
    0
  );
}

function renderizarLancamentos() {
  if (tbodyLancamentos) {
    tbodyLancamentos.innerHTML = lancamentosSemanaAtual
      .map((item, indice) => {
        return `
          <tr>
            <td>${textoSeguro(item.origem)}</td>
            <td>${textoSeguro(item.centroCusto || "-")}</td>
            <td>${formatarMoeda(item.valor)}</td>
            <td>
              <button
                type="button"
                class="btn-remover-lancamento"
                data-indice="${indice}"
                title="Remover lançamento"
              >
                <i class="fa-solid fa-trash-can"></i>
              </button>
            </td>
          </tr>
        `;
      })
      .join("");
  }

  if (avisoSemLancamentos) {
    avisoSemLancamentos.classList.toggle(
      "ativo",
      lancamentosSemanaAtual.length === 0
    );
  }

  if (inputFinanceiroReal) {
    inputFinanceiroReal.value = formatarMoeda(
      calcularTotalLancamentos()
    );
  }
}

function atualizarVisibilidadeCentroCusto() {
  // O campo de Centro de Custo agora fica sempre visível: mesmo para
  // "Cartão de Suprimentos" é útil registrar em qual centro de custo
  // essa compra deve ser apropriada.
  if (boxLancamentoCentroCusto) {
    boxLancamentoCentroCusto.style.display = "";
  }
}

function adicionarLancamento() {
  const origem = selectLancamentoOrigem?.value || "Centro de Custo";
  const centroCusto = textoLimpo(inputLancamentoCentroCusto?.value);
  const valor = converterMoeda(inputLancamentoValor?.value);

  if (!centroCusto) {
    alert("Informe o centro de custo deste lançamento.");
    inputLancamentoCentroCusto?.focus();
    return;
  }

  if (valor <= 0) {
    alert("Informe um valor válido para o lançamento.");
    inputLancamentoValor?.focus();
    return;
  }

  lancamentosSemanaAtual.push({
    origem,
    centroCusto,
    valor
  });

  if (inputLancamentoCentroCusto) {
    inputLancamentoCentroCusto.value = "";
  }

  if (inputLancamentoValor) {
    inputLancamentoValor.value = "";
  }

  renderizarLancamentos();
}

function removerLancamento(indice) {
  lancamentosSemanaAtual.splice(indice, 1);
  renderizarLancamentos();
}

function resumoCentroCustoLancamentos() {
  const partes = lancamentosSemanaAtual.map((item) => {
    return item.origem === "Centro de Custo"
      ? item.centroCusto
      : `${item.centroCusto} (Cartão de Suprimentos)`;
  });

  return [...new Set(partes)].join(", ");
}

function configurarEventosLancamentos() {
  selectLancamentoOrigem?.addEventListener(
    "change",
    atualizarVisibilidadeCentroCusto
  );

  inputLancamentoValor?.addEventListener("input", (event) => {
    const digitos = event.target.value.replace(/\D/g, "");
    event.target.value = formatarMoeda(Number(digitos) / 100);
  });

  btnAdicionarLancamento?.addEventListener("click", adicionarLancamento);

  tbodyLancamentos?.addEventListener("click", (event) => {
    const botao = event.target.closest(".btn-remover-lancamento");

    if (!botao) {
      return;
    }

    removerLancamento(Number(botao.dataset.indice));
  });

  atualizarVisibilidadeCentroCusto();
  renderizarLancamentos();
}

function montarDadosRealizado({
  fisicoReal
}) {

  const financeiroReal = calcularTotalLancamentos();

  const centroCustoApropriacao = resumoCentroCustoLancamentos();

  const semanaNumero =
  Number(
    semanaSelecionada.semanaNumero ||
    obterNumeroSemana(
      semanaSelecionada.semana
    )
  );

  const fisicoPlanejado =
  converterPercentual(
    semanaSelecionada.fisicoAcum ??
    semanaSelecionada.fisico ??
    semanaSelecionada.fisicoPlanejado ??
    0
  );

  const financeiroPlanejado =
  converterMoeda(
    semanaSelecionada.financeiroAcum ??
    semanaSelecionada.financeiro ??
    semanaSelecionada.financeiroPlanejado ??
    0
  );

  const dadosAnomalia =
  obterDadosAnomalia();

  return {
    obraId:
    obraSelecionada.id,

    obra:
    obraSelecionada.nome,

    obraNome:
    obraSelecionada.nome,

    regional:
    obraSelecionada.regional,

    localidade:
    obraSelecionada.localidade,

    semana:
    semanaSelecionada.semana || "",

    semanaNumero,

    periodo:
    semanaSelecionada.periodo || "",

    fisicoPlanejado,

    financeiroPlanejado,

    fisicoReal,

    financeiroReal,

    centroCustoApropriacao,

    centroCusto:
    centroCustoApropriacao,

    lancamentosFinanceiros:
    lancamentosSemanaAtual.map((item) => ({
      origem: item.origem,
      centroCusto: item.centroCusto || "",
      valor: converterMoeda(item.valor)
    })),

    ...dadosAnomalia,

    atualizadoPorUid:
    usuarioLogadoGlobal?.uid || "",

    atualizadoPorEmail:
    usuarioLogadoGlobal?.email ||
    usuarioLogadoGlobal?.emailAuth ||
    "",

    atualizadoPorNome:
    usuarioLogadoGlobal?.nome || ""
  };

}

/* =========================================
   STATUS DA OBRA
========================================= */

async function salvarStatusObra() {

  if (!usuarioLogadoGlobal) {

    alert(
      "Usuário não autenticado. Faça login novamente."
    );

    return;

  }

  if (!usuarioPodeEditarStatusObra(usuarioLogadoGlobal)) {

    alert(
      "Você não tem permissão para alterar o status da obra."
    );

    return;

  }

  if (!obraSelecionada) {

    alert(
      "Selecione uma obra."
    );

    return;

  }

  if (!statusObra?.value) {

    alert(
      "Selecione o status da obra."
    );

    return;

  }

  if (
    statusObra.value === "Paralisada" &&
    !motivoParalisacao?.value.trim()
  ) {

    alert(
      "Informe o motivo da paralisação."
    );

    motivoParalisacao?.focus();

    return;

  }

  try {

    const dadosAtualizacao = {
      status:
      statusObra.value,

      fase:
      statusObra.value,

      motivoParalisacao:
      statusObra.value === "Paralisada"
      ? motivoParalisacao.value.trim()
      : "",

      atualizadoPorUid:
      usuarioLogadoGlobal?.uid || "",

      atualizadoPorEmail:
      usuarioLogadoGlobal?.email ||
      usuarioLogadoGlobal?.emailAuth ||
      "",

      atualizadoPorNome:
      usuarioLogadoGlobal?.nome || "",

      atualizadoEm:
      serverTimestamp()
    };

    if (statusObra.value === "Paralisada") {

      dadosAtualizacao.paralisadaEm =
      serverTimestamp();

    }

    await updateDoc(
      doc(
        db,
        COLECAO_OBRAS,
        obraSelecionada.id
      ),
      dadosAtualizacao
    );

    obraSelecionada = {
      ...obraSelecionada,
      ...dadosAtualizacao
    };

    alert(
      "Status da obra atualizado com sucesso!"
    );

    aplicarStatusVisualObra();

    await carregarObras();

  } catch (error) {

    console.error(
      "Erro ao salvar status:",
      error
    );

    alert(
      "Erro ao salvar status da obra. Verifique suas permissões."
    );

  }

}

async function reativarObra() {

  if (!usuarioLogadoGlobal) {

    alert(
      "Usuário não autenticado. Faça login novamente."
    );

    return;

  }

  if (!usuarioPodeEditarStatusObra(usuarioLogadoGlobal)) {

    alert(
      "Você não tem permissão para reativar obras."
    );

    return;

  }

  if (!obraSelecionada) {

    alert(
      "Selecione uma obra."
    );

    return;

  }

  const confirmar =
  confirm(
    "Deseja reativar esta obra?"
  );

  if (!confirmar) {
    return;
  }

  try {

    await updateDoc(
      doc(
        db,
        COLECAO_OBRAS,
        obraSelecionada.id
      ),
      {
        status:
        "Em andamento",

        fase:
        "Em andamento",

        motivoParalisacao:
        "",

        reativadaPorUid:
        usuarioLogadoGlobal?.uid || "",

        reativadaPorEmail:
        usuarioLogadoGlobal?.email ||
        usuarioLogadoGlobal?.emailAuth ||
        "",

        reativadaPorNome:
        usuarioLogadoGlobal?.nome || "",

        reativadaEm:
        serverTimestamp(),

        atualizadoEm:
        serverTimestamp()
      }
    );

    obraSelecionada.status =
    "Em andamento";

    obraSelecionada.fase =
    "Em andamento";

    obraSelecionada.motivoParalisacao =
    "";

    alert(
      "Obra reativada com sucesso!"
    );

    aplicarStatusVisualObra();

    await carregarObras();

  } catch (error) {

    console.error(
      "Erro ao reativar obra:",
      error
    );

    alert(
      "Erro ao reativar obra. Verifique suas permissões."
    );

  }

}

/* =========================================
   ANOMALIAS
========================================= */

function obterCamposAnomalia() {

  return [
    selectTipoAnomalia,
    selectCriticidadeAnomalia,
    selectImpactoAnomalia,
    selectStatusAnomalia,
    inputPrazoTratativaAnomalia,
    inputDescricaoAnomalia,
    inputAcaoCorretivaAnomalia,
    inputResponsavelAnomalia
  ].filter(Boolean);

}

function atualizarEstadoAnomalia() {

  const houveAnomalia =
  selectTemAnomalia?.value === "Sim";

  definirCamposAnomaliaHabilitados(
    houveAnomalia
  );

  if (
    !houveAnomalia &&
    !modoEdicao
  ) {

    limparCamposAnomalia();

  }

}

function definirCamposAnomaliaHabilitados(habilitar) {

  const podeLancarCurvaS =
  usuarioPodeLancarCurvaS(
    usuarioLogadoGlobal
  );

  obterCamposAnomalia()
    .forEach((campo) => {

      campo.disabled =
      !habilitar ||
      !podeLancarCurvaS;

    });

}

function limparCamposAnomalia() {

  [
    selectTipoAnomalia,
    selectCriticidadeAnomalia,
    selectImpactoAnomalia,
    selectStatusAnomalia,
    inputPrazoTratativaAnomalia,
    inputDescricaoAnomalia,
    inputAcaoCorretivaAnomalia,
    inputResponsavelAnomalia
  ]
    .filter(Boolean)
    .forEach((campo) => {

      campo.value =
      "";

    });

  if (inputAnomalias) {
    inputAnomalias.value =
    "";
  }

}

function validarCamposAnomalia() {

  if (!selectTipoAnomalia?.value) {

    alert(
      "Selecione o tipo da anomalia."
    );

    selectTipoAnomalia?.focus();

    return false;

  }

  if (!selectCriticidadeAnomalia?.value) {

    alert(
      "Selecione a criticidade da anomalia."
    );

    selectCriticidadeAnomalia?.focus();

    return false;

  }

  if (!inputDescricaoAnomalia?.value.trim()) {

    alert(
      "Descreva a anomalia."
    );

    inputDescricaoAnomalia?.focus();

    return false;

  }

  return true;

}

function obterDadosAnomalia() {

  const houveAnomalia =
  selectTemAnomalia?.value === "Sim";

  const descricao =
  textoLimpo(
    inputDescricaoAnomalia?.value
  );

  const acao =
  textoLimpo(
    inputAcaoCorretivaAnomalia?.value
  );

  const responsavel =
  textoLimpo(
    inputResponsavelAnomalia?.value
  );

  const anomaliasTexto =
  houveAnomalia
  ? descricao
  : "";

  if (inputAnomalias) {
    inputAnomalias.value =
    anomaliasTexto;
  }

  return {
    temAnomalia:
    houveAnomalia
    ? "Sim"
    : "Não",

    possuiAnomalia:
    houveAnomalia,

    tipoAnomalia:
    houveAnomalia
    ? selectTipoAnomalia?.value || ""
    : "",

    criticidadeAnomalia:
    houveAnomalia
    ? selectCriticidadeAnomalia?.value || ""
    : "",

    impactoAnomalia:
    houveAnomalia
    ? selectImpactoAnomalia?.value || ""
    : "",

    statusAnomalia:
    houveAnomalia
    ? selectStatusAnomalia?.value || "Aberta"
    : "",

    prazoTratativaAnomalia:
    houveAnomalia
    ? inputPrazoTratativaAnomalia?.value || ""
    : "",

    descricaoAnomalia:
    houveAnomalia
    ? descricao
    : "",

    acaoCorretivaAnomalia:
    houveAnomalia
    ? acao
    : "",

    responsavelAnomalia:
    houveAnomalia
    ? responsavel
    : "",

    anomalias:
    anomaliasTexto
  };

}

function preencherCamposAnomalia(realizado) {

  const possui =
  realizadoPossuiAnomalia(
    realizado
  );

  if (selectTemAnomalia) {
    selectTemAnomalia.value =
    possui
    ? "Sim"
    : "Não";
  }

  if (selectTipoAnomalia) {
    selectTipoAnomalia.value =
    realizado.tipoAnomalia || "";
  }

  if (selectCriticidadeAnomalia) {
    selectCriticidadeAnomalia.value =
    realizado.criticidadeAnomalia || "";
  }

  if (selectImpactoAnomalia) {
    selectImpactoAnomalia.value =
    realizado.impactoAnomalia || "";
  }

  if (selectStatusAnomalia) {
    selectStatusAnomalia.value =
    realizado.statusAnomalia || "";
  }

  if (inputPrazoTratativaAnomalia) {
    inputPrazoTratativaAnomalia.value =
    normalizarDataParaInput(
      realizado.prazoTratativaAnomalia
    );
  }

  if (inputDescricaoAnomalia) {
    inputDescricaoAnomalia.value =
    realizado.descricaoAnomalia ||
    realizado.anomalias ||
    "";
  }

  if (inputAcaoCorretivaAnomalia) {
    inputAcaoCorretivaAnomalia.value =
    realizado.acaoCorretivaAnomalia || "";
  }

  if (inputResponsavelAnomalia) {
    inputResponsavelAnomalia.value =
    realizado.responsavelAnomalia || "";
  }

  atualizarEstadoAnomalia();

}

function realizadoPossuiAnomalia(realizado) {

  return (
    realizado?.possuiAnomalia === true ||
    realizado?.temAnomalia === "Sim" ||
    Boolean(realizado?.anomalias) ||
    Boolean(realizado?.descricaoAnomalia)
  );

}

function obterResumoAnomalia(realizado) {

  if (!realizadoPossuiAnomalia(realizado)) {
    return "Não";
  }

  return (
    realizado.tipoAnomalia ||
    realizado.descricaoAnomalia ||
    realizado.anomalias ||
    "Sim"
  );

}

function obterCriticidadeAnomalia(realizado) {

  return (
    realizado?.criticidadeAnomalia ||
    "-"
  );

}

function obterClasseCriticidadeAnomalia(realizado) {

  const criticidade =
  normalizarTexto(
    realizado?.criticidadeAnomalia
  );

  if (
    criticidade === "alta" ||
    criticidade === "critica"
  ) {
    return "texto-vermelho";
  }

  if (
    criticidade === "baixa"
  ) {
    return "texto-verde";
  }

  return "";

}

/* =========================================
   LIMPAR CAMPOS
========================================= */

function limparCamposFormularioSemana() {

  if (inputFisicoReal) {
    inputFisicoReal.value =
    "";
  }

  if (inputFinanceiroReal) {
    inputFinanceiroReal.value =
    "";
  }

  lancamentosSemanaAtual = [];

  if (inputLancamentoCentroCusto) {
    inputLancamentoCentroCusto.value = "";
  }

  if (inputLancamentoValor) {
    inputLancamentoValor.value = "";
  }

  renderizarLancamentos();

  if (selectTemAnomalia) {
    selectTemAnomalia.value =
    "Não";
  }

  limparCamposAnomalia();

  atualizarEstadoAnomalia();

}

function limparCamposAtualizacao() {

  limparCamposFormularioSemana();

  semanaSelecionada =
  null;

  modoEdicao =
  false;

  realizadoEmEdicaoId =
  null;

  if (btnSalvar) {

    btnSalvar.textContent =
    usuarioPodeLancarCurvaS(usuarioLogadoGlobal)
    ? "Salvar Atualização"
    : "Sem permissão para salvar";

  }

  if (semanaSelecionadaLabel) {

    semanaSelecionadaLabel.textContent =
    "Nenhuma semana selecionada";

  }

  aplicarPermissoesNaTela();

}

function limparStatusObra() {

  if (statusObra) {
    statusObra.value =
    "";
  }

  if (motivoParalisacao) {

    motivoParalisacao.value =
    "";

    motivoParalisacao.disabled =
    true;

  }

  if (statusObraLabel) {

    statusObraLabel.textContent =
    "Nenhuma obra selecionada";

  }

  aplicarPermissoesNaTela();

}

function limparTela() {

  planejamentosObra =
  [];

  realizadosObra =
  [];

  if (tabelaSemanas) {

    tabelaSemanas.innerHTML =
    `
      <tr>
        <td colspan="9">
          Selecione uma obra para carregar o planejamento.
        </td>
      </tr>
    `;

  }

  if (valorObra) {
    valorObra.value =
    "";
  }

  if (valorExecutado) {
    valorExecutado.value =
    "";
  }

  atualizarBarraProgressoExecutado(0, 0);

  limparCamposAtualizacao();

  limparStatusObra();

}

/* =========================================
   VALORES E FORMATADORES
========================================= */

function atualizarValorExecutado() {

  /*
    CORREÇÃO: este valor é ACUMULADO a cada semana (cada registro já
    representa o total até aquela semana) — não é um valor "da
    semana" que deva ser somado com os outros. Somar tudo (como
    estava antes) multiplicava o valor real várias vezes. O certo é
    pegar só o registro da semana mais recente (usando a mesma
    ordenação por número de semana/período já usada no resto do
    arquivo, não a ordem em que o Firestore devolveu os documentos).
  */

  const ultimoRealizado =
  [...realizadosObra].sort(
    (a, b) => obterOrdemRealizado(a) - obterOrdemRealizado(b)
  ).pop();

  const totalExecutado =
  ultimoRealizado
  ? converterMoeda(
    ultimoRealizado.financeiroRealAcum ??
    ultimoRealizado.financeiroReal ??
    0
  )
  : 0;

  if (valorExecutado) {

    valorExecutado.value =
    formatarMoeda(
      totalExecutado
    );

  }

  atualizarBarraProgressoExecutado(
    totalExecutado,
    converterMoeda(
      obraSelecionada?.valorOrcado
    )
  );

}

/*
  Barra de progresso do Valor Executado em relação ao Valor Orçado.
  A barra visual fica travada em 100% de largura (não estoura o
  card), mas o texto ao lado mostra o percentual real — inclusive
  acima de 100%, com a cor mudando pra vermelho como alerta.
*/
function atualizarBarraProgressoExecutado(totalExecutado, valorOrcadoObra) {

  if (!barraProgressoExecutado || !barraProgressoExecutadoTexto) {
    return;
  }

  if (!valorOrcadoObra || valorOrcadoObra <= 0) {
    barraProgressoExecutado.style.width = "0%";
    barraProgressoExecutado.classList.remove("progresso-alerta");
    barraProgressoExecutadoTexto.textContent = "0%";
    return;
  }

  const percentual =
  (totalExecutado / valorOrcadoObra) * 100;

  const percentualVisual =
  Math.min(Math.max(percentual, 0), 100);

  barraProgressoExecutado.style.width =
  `${percentualVisual}%`;

  barraProgressoExecutado.classList.toggle(
    "progresso-alerta",
    percentual > 100
  );

  barraProgressoExecutadoTexto.textContent =
  `${percentual.toFixed(2)}%`;

}

function obterFisicoRealizado(realizado) {

  return converterPercentual(
    realizado?.fisicoReal ??
    realizado?.fisicoRealizado ??
    0
  );

}

function obterFinanceiroRealizado(realizado) {

  return converterMoeda(
    realizado?.financeiroReal ??
    realizado?.financeiroRealizado ??
    0
  );

}

function converterMoeda(valor) {

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

function formatarMoeda(valor) {

  const numero =
  converterMoeda(
    valor
  );

  return numero.toLocaleString(
    "pt-BR",
    {
      style: "currency",
      currency: "BRL",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }
  );

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
    return valor;
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

function formatarPercentual(valor) {

  if (
    valor === null ||
    valor === undefined ||
    valor === ""
  ) {
    return "-";
  }

  const numero =
  converterPercentual(
    valor
  );

  return numero.toLocaleString(
    "pt-BR",
    {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }
  ) + "%";

}

function aplicarMascaraMoeda(valor) {

  let somenteNumeros =
  String(valor || "")
    .replace(/\D/g, "");

  if (!somenteNumeros) {
    return "";
  }

  return (
    Number(
      somenteNumeros
    ) / 100
  ).toLocaleString(
    "pt-BR",
    {
      style: "currency",
      currency: "BRL"
    }
  );

}

function configurarMascaraFinanceiro() {

  inputFinanceiroReal?.addEventListener(
    "input",
    (e) => {

      e.target.value =
      aplicarMascaraMoeda(
        e.target.value
      );

    }
  );

}

/* =========================================
   DATAS
========================================= */

function obterNumeroSemana(semana) {

  const numero =
  String(semana || "")
    .match(/\d+/);

  return numero
  ? Number(numero[0])
  : 0;

}

function obterData(valor) {

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

  const data =
  new Date(valor);

  return isNaN(data.getTime())
  ? null
  : data;

}

function formatarDataAtualizacao(realizado) {

  const data =
  obterData(
    realizado?.atualizadoEm ||
    realizado?.criadoEm ||
    realizado?.dataAtualizacao
  );

  if (!data) {
    return "-";
  }

  return data.toLocaleDateString(
    "pt-BR"
  ) + " " + data.toLocaleTimeString(
    "pt-BR",
    {
      hour: "2-digit",
      minute: "2-digit"
    }
  );

}

function normalizarDataParaInput(valor) {

  if (!valor) {
    return "";
  }

  if (
    typeof valor === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(valor)
  ) {
    return valor;
  }

  const data =
  obterData(valor);

  if (!data) {
    return "";
  }

  const ano =
  data.getFullYear();

  const mes =
  String(data.getMonth() + 1)
    .padStart(2, "0");

  const dia =
  String(data.getDate())
    .padStart(2, "0");

  return `${ano}-${mes}-${dia}`;

}