/* =====================================================
   GESTÃO DE OBRAS - v313
   Painel de obras + edição de datas + exclusão somente por Administrador Geral
   Cabeçalho padronizado via HTML/CSS + permissões por perfil
   Coluna Cliente removida da tabela
   Versão SEM Cloud Functions / SEM Blaze
===================================================== */

import { db } from "./firebaseConfig.js";

import {
  getAuth,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.3/firebase-auth.js";

import { protegerPagina } from "./authGuard.js";

import {
  collection,
  getDocs,
  getDoc,
  doc,
  updateDoc,
  addDoc,
  writeBatch,
  query,
  where,
  arrayUnion,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.3/firebase-firestore.js";

const auth = getAuth();

/* =========================
   VARIÁVEIS GLOBAIS
========================= */

let usuarioLogadoGlobal = null;
let listaProjetos = [];
let obraSelecionadaParaEdicao = null;
let obraSelecionadaParaExclusao = null;

/* =========================
   ELEMENTOS
========================= */

const $ = (id) => document.getElementById(id);

const usuarioLogadoInfo = $("usuarioLogadoInfo");
const usuarioEmailTopo = $("usuarioEmailTopo");
const usuarioPerfilTopo = $("usuarioPerfilTopo");

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
const editValorOrcado = $("editValorOrcado");
const editJustificativa = $("editJustificativa");

const boxAvisoImpactoCurva = $("boxAvisoImpactoCurva");
const boxAvisoRealizado = $("boxAvisoRealizado");
const avisoImpactoCurva = $("avisoImpactoCurva");
const avisoRealizado = $("avisoRealizado");

const modalExcluirObra = $("modalExcluirObra");
const formExcluirObra = $("formExcluirObra");

const btnFecharModalExcluirObra = $("btnFecharModalExcluirObra");
const btnCancelarExcluirObra = $("btnCancelarExcluirObra");
const btnConfirmarExcluirObra = $("btnConfirmarExcluirObra");

const excluirObraDocId = $("excluirObraDocId");
const excluirCodigoObra = $("excluirCodigoObra");
const excluirNomeObra = $("excluirNomeObra");
const excluirObraNomeVisual = $("excluirObraNomeVisual");
const excluirCodigoObraVisual = $("excluirCodigoObraVisual");
const excluirRegionalObra = $("excluirRegionalObra");
const excluirLocalidadeObra = $("excluirLocalidadeObra");
const excluirStatusObra = $("excluirStatusObra");

/* =========================
   REGIONAIS
========================= */

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
registrarLocalidade("Regional 1", "Alto Alegre do Pindaré", [
  "Alto Alegre do Pindare",
  "Alto Alegre"
]);
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

/* =========================
   UTILITÁRIOS
========================= */

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

  let texto = String(valor)
    .trim()
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
    } else if (partes.length === 2 && partes[1].length === 3) {
      texto = partes.join("");
    }
  }

  const numero = Number(texto);

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
      const data = new Date(
        Number(partes[2]),
        Number(partes[1]) - 1,
        Number(partes[0])
      );

      return Number.isNaN(data.getTime()) ? null : data;
    }
  }

  if (texto.includes("-")) {
    const partes = texto
      .split("T")[0]
      .split("-");

    if (partes.length === 3) {
      const data = new Date(
        Number(partes[0]),
        Number(partes[1]) - 1,
        Number(partes[2])
      );

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

  return data
    ? data.toLocaleDateString("pt-BR")
    : "-";
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

/* =========================
   PERMISSÕES E USUÁRIO LOGADO
========================= */

/*
  SEGURANÇA: lista fixa de e-mails admin removida (ficava exposta
  via "Ver código-fonte"). Perfil salvo no Firestore é a única
  fonte de verdade.
*/

function normalizarEmail(valor) {
  return String(valor || "")
    .trim()
    .toLowerCase();
}

function obterEmailUsuario(usuario) {
  return normalizarEmail(
    usuario?.email ||
    usuario?.emailAuth ||
    usuario?.usuarioEmail ||
    usuario?.login ||
    usuario?.user?.email ||
    auth.currentUser?.email ||
    ""
  );
}

function obterUidUsuario(usuario) {
  return String(
    usuario?.uid ||
    usuario?.user?.uid ||
    usuario?.auth?.uid ||
    auth.currentUser?.uid ||
    ""
  ).trim();
}

function obterPerfilUsuario(usuario) {
  return String(
    usuario?.perfil ||
    usuario?.role ||
    usuario?.tipo ||
    usuario?.nivel ||
    usuario?.nivelAcesso ||
    usuario?.cargo ||
    usuario?.funcao ||
    usuario?.acesso ||
    usuario?.permissao ||
    ""
  ).trim();
}

function obterPerfilPermissao(usuario) {
  return normalizarTexto(obterPerfilUsuario(usuario));
}

function obterNomeUsuario(usuario) {
  return (
    usuario?.nome ||
    usuario?.displayName ||
    usuario?.usuario ||
    obterEmailUsuario(usuario) ||
    "Usuário não identificado"
  );
}

function aguardarUsuarioAuthentication(timeoutMs = 6000) {
  if (auth.currentUser) {
    return Promise.resolve(auth.currentUser);
  }

  return new Promise((resolve) => {
    let finalizado = false;
    let cancelarObservacao = () => {};
    let temporizador = null;

    const finalizar = (usuario) => {
      if (finalizado) {
        return;
      }

      finalizado = true;

      if (temporizador) {
        clearTimeout(temporizador);
      }

      cancelarObservacao();

      resolve(usuario || null);
    };

    cancelarObservacao = onAuthStateChanged(
      auth,
      (usuario) => finalizar(usuario),
      () => finalizar(null)
    );

    temporizador = setTimeout(
      () => {
        finalizar(auth.currentUser);
      },
      timeoutMs
    );
  });
}

async function buscarPerfilUsuarioFirestore(usuarioBase) {
  const uid = obterUidUsuario(usuarioBase);
  const email = obterEmailUsuario(usuarioBase);

  if (uid) {
    try {
      const snapshotUsuario = await getDoc(
        doc(
          db,
          "usuariosSistema",
          uid
        )
      );

      if (snapshotUsuario.exists()) {
        return {
          id: snapshotUsuario.id,
          ...snapshotUsuario.data()
        };
      }
    } catch (error) {
      console.warn(
        "Não foi possível buscar o perfil do usuário pelo UID:",
        error
      );
    }
  }

  if (email) {
    const camposEmail = [
      "email",
      "emailAuth",
      "usuarioEmail",
      "login"
    ];

    for (const campo of camposEmail) {
      try {
        const resultado = await getDocs(
          query(
            collection(
              db,
              "usuariosSistema"
            ),
            where(
              campo,
              "==",
              email
            )
          )
        );

        if (!resultado.empty) {
          const documentoUsuario = resultado.docs[0];

          return {
            id: documentoUsuario.id,
            ...documentoUsuario.data()
          };
        }
      } catch (error) {
        console.warn(
          `Não foi possível buscar o perfil pelo campo ${campo}:`,
          error
        );
      }
    }
  }

  return null;
}

async function carregarUsuarioCompleto(usuarioProtegido) {
  const usuarioAuthentication = await aguardarUsuarioAuthentication();

  const usuarioBase = {
    ...(usuarioProtegido || {}),

    uid:
      usuarioAuthentication?.uid ||
      usuarioProtegido?.uid ||
      usuarioProtegido?.user?.uid ||
      "",

    email:
      normalizarEmail(
        usuarioAuthentication?.email ||
        usuarioProtegido?.email ||
        usuarioProtegido?.emailAuth ||
        usuarioProtegido?.user?.email ||
        ""
      ),

    displayName:
      usuarioProtegido?.displayName ||
      usuarioAuthentication?.displayName ||
      ""
  };

  const perfilFirestore = await buscarPerfilUsuarioFirestore(usuarioBase);

  return {
    ...usuarioBase,
    ...(perfilFirestore || {}),

    uid:
      perfilFirestore?.uid ||
      usuarioBase.uid ||
      perfilFirestore?.id ||
      "",

    email:
      normalizarEmail(
        perfilFirestore?.email ||
        perfilFirestore?.emailAuth ||
        usuarioBase.email ||
        ""
      )
  };
}

function usuarioEstaAtivoParaPermissao(usuario) {
  if (!usuario) {
    return false;
  }

  if (usuario.ativo === false || usuario.active === false) {
    return false;
  }

  const status = normalizarTexto(
    usuario.status ||
    usuario.statusUsuario ||
    usuario.situacao ||
    ""
  );

  if (!status) {
    return true;
  }

  return ![
    "inativo",
    "bloqueado",
    "bloqueada",
    "pendente",
    "reprovado",
    "reprovada"
  ].includes(status);
}

function obterPerfilEfetivoGestao(usuario) {
  const perfilBanco = obterPerfilPermissao(usuario);

  if (perfilBanco) {
    return perfilBanco;
  }

  return "usuario";
}

function usuarioEhAdministradorGeral(usuario) {
  if (!usuario) {
    return false;
  }

  if (!usuarioEstaAtivoParaPermissao(usuario)) {
    return false;
  }

  const perfilEfetivo = obterPerfilEfetivoGestao(usuario);

  return (
    usuario.admin === true ||
    usuario.isAdmin === true ||
    usuario.administrador === true ||
    [
      "administrador",
      "admin",
      "adm",
      "administrator",
      "administrador geral",
      "administradorgeral",
      "admin geral",
      "adm geral"
    ].includes(perfilEfetivo)
  );
}

function usuarioEhAdministradorRegional() {
  return false;
}

function usuarioEhAdministrador(usuario) {
  return usuarioEhAdministradorGeral(usuario);
}

function usuarioPodeExcluirObra(usuario) {
  return usuarioEhAdministradorGeral(usuario);
}

function obterNomePerfilExibicao(usuario) {
  const perfilEfetivo = obterPerfilEfetivoGestao(usuario);

  if (usuarioEhAdministradorGeral(usuario)) {
    return "Administrador Geral";
  }

  if (perfilEfetivo === "planejador") {
    return "Planejador";
  }

  return "Usuário";
}

function exibirUsuarioLogadoNoTopo() {
  const email = obterEmailUsuario(usuarioLogadoGlobal) || "Email não identificado";
  const perfil = obterNomePerfilExibicao(usuarioLogadoGlobal);

  if (usuarioEmailTopo) {
    usuarioEmailTopo.textContent = email;
  }

  if (usuarioPerfilTopo) {
    usuarioPerfilTopo.textContent = perfil;
  }

  if (usuarioLogadoInfo) {
    const administrador = usuarioEhAdministradorGeral(usuarioLogadoGlobal);

    usuarioLogadoInfo.classList.toggle(
      "perfil-administrador",
      administrador
    );

    usuarioLogadoInfo.classList.toggle(
      "perfil-sem-permissao",
      !administrador
    );
  }
}

function aplicarVisibilidadeAdministrador() {
  const adminGeral = usuarioEhAdministradorGeral(usuarioLogadoGlobal);

  document.body.classList.toggle(
    "usuario-admin",
    adminGeral
  );

  document.body.classList.toggle(
    "usuario-admin-geral",
    adminGeral
  );

  document.body.classList.toggle(
    "usuario-admin-regional",
    false
  );

  document
    .querySelectorAll("[data-admin-only]")
    .forEach((elemento) => {
      if (adminGeral) {
        elemento.style.removeProperty("display");
        elemento.removeAttribute("aria-disabled");
      } else {
        elemento.style.display = "none";
        elemento.setAttribute("aria-disabled", "true");
      }
    });

  console.info(
    "Permissão da Gestão de Obras:",
    {
      uid: obterUidUsuario(usuarioLogadoGlobal),
      email: obterEmailUsuario(usuarioLogadoGlobal),
      perfilBanco: obterPerfilUsuario(usuarioLogadoGlobal),
      perfilEfetivo: obterPerfilEfetivoGestao(usuarioLogadoGlobal),
      perfilExibido: obterNomePerfilExibicao(usuarioLogadoGlobal),
      administradorGeral: adminGeral,
      administradorRegional: false,
      podeEditarObra: adminGeral,
      podeExcluirObra: adminGeral
    }
  );
}

function atualizarBloqueioScrollModal() {
  const existeModalAberto = Boolean(
    modalEditarDatas?.classList.contains("ativo") ||
    modalExcluirObra?.classList.contains("ativo")
  );

  document.body.classList.toggle(
    "modal-aberto",
    existeModalAberto
  );
}

function obterColspanTabela() {
  return usuarioEhAdministradorGeral(usuarioLogadoGlobal)
    ? 10
    : 9;
}

/* =========================
   DADOS DA OBRA
========================= */

function obterLocalidadeOriginal(obra) {
  return (
    obra.localidade ||
    obra.cidade ||
    obra.site ||
    obra.local ||
    obra.localidadeObra ||
    ""
  );
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

  return normalizarRegional(
    obra.regional ||
    obra.regionalNome ||
    obra.regionalObra ||
    ""
  );
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

function obterCodigoObra(obra, docId) {
  return (
    obra.idObra ||
    obra.codigoObra ||
    obra.codigo ||
    obra.idProjeto ||
    obra.obraId ||
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
    obra.titulo ||
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
    obra.projetoId,
    obra.projectId,
    obra.obraDocId,
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

  const statusInformadoBruto =
    obra.status ||
    obra.statusObra ||
    obra.statusNovo ||
    obra.fase ||
    "";

  const statusInformado = statusInformadoBruto
    ? normalizarStatus(statusInformadoBruto)
    : "";

  /*
    CORREÇÃO: antes, esta função checava o avanço físico (fisico > 0)
    ANTES do status manual — então uma obra marcada manualmente como
    "Paralisada" continuava aparecendo como "Em andamento" se tivesse
    algum avanço físico já lançado antes da paralisação. Isso divergia
    do dashboard.js, que sempre respeita o status manual "Paralisada"
    em primeiro lugar. Agora a ordem de prioridade é a mesma nos dois
    arquivos: status manual > avanço físico > custo sem avanço.
  */
  if (statusInformado === "Paralisada") {
    return "Paralisada";
  }

  if (statusInformado === "Concluído" || fisico >= 100) {
    return "Concluído";
  }

  if (fisico > 0 && fisico < 100) {
    return "Em andamento";
  }

  if (custoExecucao > 0 && fisico <= 0) {
    return "Paralisada";
  }

  if (statusInformado) {
    return statusInformado;
  }

  return "Planejado";
}

/* =========================
   MAPAS DE PLANEJADO / REALIZADO
========================= */

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

  if (
    tempoInicioNovo !== null &&
    (
      tempoInicioAtual === null ||
      tempoInicioNovo < tempoInicioAtual
    )
  ) {
    mapa[chaveFinal].inicio = inicio;
  }

  if (
    tempoFimNovo !== null &&
    (
      tempoFimAtual === null ||
      tempoFimNovo > tempoFimAtual
    )
  ) {
    mapa[chaveFinal].fim = fim;
  }
}

function montarMapaDatas(snapshotCurva) {
  const mapaDatas = {};

  snapshotCurva.forEach((documento) => {
    const item = documento.data();
    const periodo = extrairDatasPeriodo(item.periodo);

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

    const chaves = chavesUnicas([
      item.obraDocId,
      item.obraId,
      item.idObra,
      item.codigoObra,
      item.idProjeto,
      item.projetoId,
      item.projectId,
      item.nomeProjeto,
      item.obraNome,
      item.nomeObra,
      item.obra,
      item.projeto
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

function obterOrdemRegistro(item) {
  /*
    CORREÇÃO: esta função decidia "qual semana é a mais recente"
    usando datas de AUDITORIA (dataAtualizacao/atualizadoEm/criadoEm)
    — ou seja, a data da última EDIÇÃO do documento, não a semana em
    si. Isso quebra quando alguém edita um registro antigo por outro
    motivo (ex.: corrigir o status de uma anomalia semanas depois):
    o registro antigo passa a "parecer" mais recente que semanas
    seguintes de verdade, e o sistema exibe dados de avanço físico e
    financeiro desatualizados/errados.

    Agora a ordem é decidida primeiro pelo número da semana (ex.:
    "SEM 4" → 4), depois pela data de início do período (ex.:
    "13/06/2026 a 18/06/2026"), e só em último caso (registros muito
    antigos sem nenhum desses campos) pelas datas de auditoria.
  */

  const semanaNumero = Number(
    String(item.semana || "")
      .replace(/[^\d]/g, "")
  );

  if (Number.isFinite(semanaNumero) && semanaNumero > 0) {
    return semanaNumero;
  }

  const inicioPeriodo = String(item.periodo || "")
    .split(/\s+a\s+/i)[0];

  const tempoPeriodo = dataParaTempo(inicioPeriodo);

  if (tempoPeriodo !== null) {
    return tempoPeriodo;
  }

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

  return -1;
}

function obterValorCampo(item, campos) {
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

function montarMapaRealizado(snapshotRealizado) {
  const mapa = {};

  snapshotRealizado.forEach((documento) => {
    const item = documento.data();

    const chaves = chavesUnicas([
      item.obraDocId,
      item.obraId,
      item.idObra,
      item.codigoObra,
      item.idProjeto,
      item.projetoId,
      item.projectId,
      item.nomeProjeto,
      item.obraNome,
      item.nomeObra,
      item.obra,
      item.projeto
    ]);

    /*
      CORREÇÃO: a versão anterior desta função tratava o campo
      financeiro e o campo físico de forma independente, decidindo
      separadamente "esse campo é acumulado ou é semanal" para cada
      um. Isso quebrava sempre que, entre os lançamentos semanais de
      uma mesma obra, uns traziam o campo "*RealAcum" preenchido e
      outros não (ex.: mudança de padrão de preenchimento ao longo do
      tempo) — o sistema então ignorava os lançamentos mais recentes
      sem esse campo específico e travava no último valor "Acum"
      encontrado, mesmo que semanas mais novas (já em 100%) existissem.

      Agora seguimos a mesma regra já usada e validada em
      atualizar-curva-s.js: para cada obra, olhamos TODOS os
      lançamentos e ficamos com o registro de maior "ordem" (semana
      mais alta e, na ausência dela, data mais recente) e usamos os
      valores acumulados desse único registro — sem misturar campos
      de registros diferentes.
    */
    const ordem = obterOrdemRegistro(item);

    const fisicoRealAcum = numeroBRL(
      item.fisicoRealAcum ??
      item.fisicoRealizadoAcum ??
      item.fisicoAcumReal ??
      item.fisicoExecutadoAcum ??
      item.fisicoAcumuladoReal ??
      item.avancoFisicoAcumulado ??
      item.avancoFisicoNovo ??
      item.fisicoAcum ??
      item.fisicoReal ??
      item.fisicoRealizado ??
      item.avancoFisico ??
      item.fisico ??
      0
    );

    const financeiroRealAcum = numeroBRL(
      item.financeiroRealAcum ??
      item.financeiroRealizadoAcum ??
      item.financeiroAcumReal ??
      item.financeiroExecutadoAcum ??
      item.financeiroAcumuladoReal ??
      item.custoRealAcumulado ??
      item.custoAcumulado ??
      item.financeiroAcum ??
      item.financeiroReal ??
      item.financeiroRealizado ??
      item.custoSemana ??
      item.custoReal ??
      item.financeiroExecutado ??
      item.investimentoNovo ??
      0
    );

    chaves.forEach((chave) => {
      if (!mapa[chave]) {
        mapa[chave] = {
          financeiroRealAcum: 0,
          fisicoRealAcum: 0,
          ordem: -1,
          quantidadeRegistros: 0
        };
      }

      const grupo = mapa[chave];
      grupo.quantidadeRegistros += 1;

      if (ordem >= grupo.ordem) {
        grupo.ordem = ordem;
        grupo.fisicoRealAcum = fisicoRealAcum;
        grupo.financeiroRealAcum = financeiroRealAcum;
      }
    });
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

/* =========================
   FIRESTORE - BUSCAS
========================= */

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
  const nomesColecoes = [
    "obras",
    "projetos"
  ];

  const documentos = [];

  for (const nomeColecao of nomesColecoes) {
    try {
      const snapshot = await getDocs(
        collection(
          db,
          nomeColecao
        )
      );

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
      console.warn(
        `Não foi possível carregar a coleção ${nomeColecao}:`,
        error
      );
    }
  }

  return criarSnapshotVirtual(documentos);
}

/* =========================
   ELEMENTOS DA TELA
========================= */

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

/* =========================
   AÇÕES DA TABELA
========================= */

function criarCelulaAcoes(obra) {
  if (!usuarioEhAdministradorGeral(usuarioLogadoGlobal)) {
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
  btnEditar.setAttribute("aria-label", "Editar datas da obra");
  btnEditar.innerHTML = '<i class="fa-solid fa-pen-to-square"></i>';

  btnEditar.addEventListener(
    "click",
    (event) => {
      event.preventDefault();
      event.stopPropagation();

      abrirModalEdicaoDatas(obra);
    }
  );

  const btnExcluir = document.createElement("button");

  btnExcluir.type = "button";
  btnExcluir.className = "btn-excluir-obra";
  btnExcluir.title = "Excluir obra completa";
  btnExcluir.setAttribute("aria-label", "Excluir obra completa");
  btnExcluir.innerHTML = '<i class="fa-solid fa-trash-can"></i>';

  btnExcluir.addEventListener(
    "click",
    (event) => {
      event.preventDefault();
      event.stopPropagation();

      if (!usuarioPodeExcluirObra(usuarioLogadoGlobal)) {
        alert("A exclusão é permitida somente para Administrador Geral.");
        return;
      }

      abrirModalExcluirObra(obra);
    }
  );

  div.appendChild(btnEditar);
  div.appendChild(btnExcluir);

  td.appendChild(div);

  return td;
}

/* =========================
   CARREGAR PROJETOS
========================= */

/* =========================
   DIAGNÓSTICO (temporário)
   Uso no console do navegador, nesta tela:
   diagnosticarObra("OBR-0012")
========================= */
window.diagnosticarObra = function (codigo) {
  const alvo = (listaProjetos || []).find((item) => {
    return (
      normalizarTexto(item.codigoObraTela) === normalizarTexto(codigo) ||
      normalizarTexto(item.id) === normalizarTexto(codigo)
    );
  });

  if (!alvo) {
    console.warn("Obra não encontrada na lista carregada:", codigo);
    return;
  }

  console.log("========================================");
  console.log("DIAGNÓSTICO DA OBRA:", codigo);
  console.log("status bruto salvo no documento da obra:", alvo._debugStatusBruto);
  console.log("statusFinal calculado (o que aparece na tela):", alvo.statusFinal);
  console.log("fisicoRealAcum usado no cálculo:", alvo.fisicoRealAcum);
  console.log("custoExecucao usado no cálculo:", alvo.custoExecucao);
  console.log("possuiRealizado (achou algum lançamento de realizado?):", alvo.possuiRealizado);
  console.log("grupo de 'realizado' encontrado/casado para essa obra:", alvo._debugRealizado);
  console.log("objeto completo da obra (todos os campos do Firestore):", alvo);
  console.log("========================================");

  return alvo;
};

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

      const possuiPlanejamento =
        Number(
          datasCurva.quantidadeRegistros ||
          0
        ) > 0;

      const possuiRealizado =
        Number(
          realizado.quantidadeRegistros ||
          0
        ) > 0 ||
        custoExecucao > 0 ||
        fisicoRealAcum > 0;

      listaProjetos.push({
        id: documentoFirebase.id,

        ...obra,

        colecaoOrigem:
          obra.colecaoOrigem ||
          "obras",

        regional:
          regionalCorrigida,

        localidade:
          localidadeCorrigida,

        codigoObraTela:
          obterCodigoObra(
            obra,
            documentoFirebase.id
          ),

        nomeObraTela:
          obterNomeObra(obra),

        inicioObraTela:
          inicioObra,

        fimObraTela:
          fimObra,

        custoExecucao:
          custoExecucao,

        fisicoRealAcum:
          fisicoRealAcum,

        statusFinal:
          calcularStatus(
            obra,
            custoExecucao,
            fisicoRealAcum
          ),

        possuiPlanejamento:
          possuiPlanejamento,

        possuiRealizado:
          possuiRealizado,

        prioridadeFinal:
          obra.gutNivel ||
          obra.prioridade ||
          obra.nivel ||
          "-",

        _debugRealizado: {
          ...realizado
        },

        _debugStatusBruto:
          obra.status ||
          obra.statusObra ||
          obra.statusNovo ||
          obra.fase ||
          "(vazio)"
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

/* =========================
   FILTROS
========================= */

function carregarRegionaisOficiais() {
  limparSelect(
    filtroRegional,
    "Todas"
  );

  Object
    .keys(LOCALIDADES_POR_REGIONAL)
    .forEach((regional) => {
      adicionarOption(
        filtroRegional,
        regional
      );
    });
}

function carregarLocalidadesPorRegional(regionalSelecionada = "") {
  limparSelect(
    filtroLocalidade,
    "Todas"
  );

  const localidades =
    regionalSelecionada &&
    LOCALIDADES_POR_REGIONAL[regionalSelecionada]
      ? LOCALIDADES_POR_REGIONAL[regionalSelecionada]
      : Object
          .values(LOCALIDADES_POR_REGIONAL)
          .flat();

  localidades.forEach((localidade) => {
    adicionarOption(
      filtroLocalidade,
      localidade
    );
  });
}

function carregarAnosFiltro() {
  limparSelect(
    filtroAno,
    "Todos"
  );

  const anos = [
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

function carregarFiltros() {
  const regionalAtual = filtroRegional?.value || "";
  const localidadeAtual = filtroLocalidade?.value || "";
  const anoAtual = filtroAno?.value || "";

  carregarRegionaisOficiais();

  if (
    regionalAtual &&
    LOCALIDADES_POR_REGIONAL[regionalAtual]
  ) {
    filtroRegional.value = regionalAtual;
  }

  carregarLocalidadesPorRegional(
    filtroRegional?.value || ""
  );

  if (
    localidadeAtual &&
    Array
      .from(filtroLocalidade.options)
      .some((opcao) => opcao.value === localidadeAtual)
  ) {
    filtroLocalidade.value = localidadeAtual;
  }

  carregarAnosFiltro();

  if (
    anoAtual &&
    Array
      .from(filtroAno.options)
      .some((opcao) => opcao.value === anoAtual)
  ) {
    filtroAno.value = anoAtual;
  }
}

function aplicarFiltros() {
  let lista = [...listaProjetos];

  if (filtroRegional?.value) {
    lista = lista.filter((item) => {
      const regionalReal =
        obterRegionalPelaLocalidade(item.localidade) ||
        normalizarRegional(item.regional);

      return regionalReal === filtroRegional.value;
    });
  }

  if (filtroLocalidade?.value) {
    lista = lista.filter((item) =>
      normalizarLocalidade(item.localidade) ===
      normalizarLocalidade(filtroLocalidade.value)
    );
  }

  if (filtroAno?.value) {
    lista = lista.filter((item) =>
      obterAno(item.inicioObraTela) === filtroAno.value ||
      obterAno(item.fimObraTela) === filtroAno.value
    );
  }

  if (filtroGutNivel?.value) {
    lista = lista.filter((item) =>
      normalizarTexto(item.prioridadeFinal) ===
      normalizarTexto(filtroGutNivel.value)
    );
  }

  if (filtroStatus?.value) {
    lista = lista.filter((item) =>
      normalizarTexto(
        normalizarStatus(item.statusFinal)
      ) ===
      normalizarTexto(
        normalizarStatus(filtroStatus.value)
      )
    );
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

    return String(a.nomeObraTela)
      .localeCompare(
        String(b.nomeObraTela),
        "pt-BR"
      );
  });

  renderTabela(lista);

  atualizarKPIs(lista);
}

/* =========================
   TABELA
========================= */

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

    tr.style.cursor = "pointer";
    tr.title = "Ver detalhes da obra";

    tr.addEventListener("click", () => {
      window.location.href =
        "detalhe-obra.html?id=" + encodeURIComponent(obra.id);
    });

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
        formatarData(obra.inicioObraTela)
      )
    );

    tr.appendChild(
      criarCelulaTexto(
        formatarData(obra.fimObraTela)
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
      criarCelulaComElemento(
        criarBadgeStatus(
          obra.statusFinal
        )
      )
    );

    const celulaAcoes = criarCelulaAcoes(obra);

    if (celulaAcoes) {
      tr.appendChild(celulaAcoes);
    }

    tbodyProjetos.appendChild(tr);
  });
}

/* =========================
   INDICADORES
========================= */

function atualizarKPIs(lista) {
  const totalCusto = lista.reduce(
    (soma, item) =>
      soma +
      numeroBRL(item.custoExecucao),
    0
  );

  if (totalFiltrado) {
    totalFiltrado.textContent = moeda(totalCusto);
  }

  if (kpiTotal) {
    kpiTotal.textContent = lista.length;
  }

  if (kpiValidadas) {
    kpiValidadas.textContent =
      lista.filter((item) => {
        const aprovacao = normalizarTexto(
          item.aprovacaoCliente ||
          item.aprovacao ||
          item.validacao ||
          ""
        );

        return [
          "aprovado",
          "aprovada",
          "validado",
          "validada",
          "sim"
        ].includes(aprovacao);
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

/* =========================
   MODAL EDITAR DATAS
========================= */

function preencherSelectLocalidades(selectEl, localidadeSelecionada) {
  if (!selectEl) {
    return;
  }

  const todasLocalidades = Object.values(LOCALIDADES_POR_REGIONAL)
    .flat()
    .sort((a, b) => a.localeCompare(b, "pt-BR"));

  const jaTemSelecionada = todasLocalidades.some(
    (nome) => normalizarLocalidade(nome) === normalizarLocalidade(localidadeSelecionada)
  );

  const opcoes = jaTemSelecionada || !localidadeSelecionada
    ? todasLocalidades
    : [localidadeSelecionada, ...todasLocalidades];

  selectEl.innerHTML = opcoes
    .map((nome) => `<option value="${textoSeguro(nome)}">${textoSeguro(nome)}</option>`)
    .join("");

  selectEl.value = localidadeSelecionada || "";
}

function abrirModalEdicaoDatas(obra) {
  if (!usuarioEhAdministradorGeral(usuarioLogadoGlobal)) {
    alert("A alteração de datas é permitida somente para Administrador Geral.");
    return;
  }

  if (!modalEditarDatas) {
    return;
  }

  obraSelecionadaParaEdicao = obra;

  const dataInicioAtual = dataParaInput(obra.inicioObraTela);
  const dataFimAtual = dataParaInput(obra.fimObraTela);

  if (editObraDocId) {
    editObraDocId.value = obra.id || "";
  }

  if (editPossuiPlanejamento) {
    editPossuiPlanejamento.value = obra.possuiPlanejamento ? "sim" : "nao";
  }

  if (editPossuiRealizado) {
    editPossuiRealizado.value = obra.possuiRealizado ? "sim" : "nao";
  }

  if (editDataInicioAnterior) {
    editDataInicioAnterior.value = dataInicioAtual;
  }

  if (editDataFimAnterior) {
    editDataFimAnterior.value = dataFimAtual;
  }

  if (editObraNome) {
    editObraNome.value = obra.nomeObraTela || "-";
  }

  if (editCodigoObra) {
    editCodigoObra.value = obra.codigoObraTela || "-";
  }

  if (editStatusObra) {
    editStatusObra.value = obra.statusFinal || "-";
  }

  if (editRegionalObra) {
    editRegionalObra.value = obra.regional || "-";
  }

  if (editLocalidadeObra) {
    preencherSelectLocalidades(editLocalidadeObra, obra.localidade || "");
  }

  if (editValorOrcado) {
    editValorOrcado.value = moeda(
      obra.investimento ??
      obra.valorObra ??
      obra.valorOrcado ??
      obra.orcamento ??
      0
    );
  }

  if (editDataInicioAtual) {
    editDataInicioAtual.value = formatarData(obra.inicioObraTela);
  }

  if (editDataFimAtual) {
    editDataFimAtual.value = formatarData(obra.fimObraTela);
  }

  if (editDataInicio) {
    editDataInicio.value = dataInicioAtual;
  }

  if (editDataFim) {
    editDataFim.value = dataFimAtual;
  }

  if (editJustificativa) {
    editJustificativa.value = "";
  }

  if (boxAvisoImpactoCurva) {
    boxAvisoImpactoCurva.classList.toggle(
      "ativo",
      Boolean(obra.possuiPlanejamento)
    );
  }

  if (boxAvisoRealizado) {
    boxAvisoRealizado.classList.toggle(
      "ativo",
      Boolean(obra.possuiRealizado)
    );
  }

  if (avisoImpactoCurva) {
    avisoImpactoCurva.textContent =
      obra.possuiPlanejamento
        ? "Esta obra já possui Curva S planejada. Ao alterar as datas, a obra será marcada como replanejamento necessário."
        : "Esta obra ainda não possui Curva S planejada.";
  }

  if (avisoRealizado) {
    avisoRealizado.textContent =
      obra.possuiRealizado
        ? "Esta obra já possui realizado lançado. O realizado não será apagado, mas a alteração ficará registrada no histórico."
        : "Esta obra ainda não possui realizado lançado.";
  }

  modalEditarDatas.classList.add("ativo");
  modalEditarDatas.setAttribute("aria-hidden", "false");

  atualizarBloqueioScrollModal();
}

function fecharModalEdicaoDatas() {
  if (!modalEditarDatas) {
    return;
  }

  modalEditarDatas.classList.remove("ativo");
  modalEditarDatas.setAttribute("aria-hidden", "true");

  obraSelecionadaParaEdicao = null;

  if (formEditarDatas) {
    formEditarDatas.reset();
  }

  if (boxAvisoImpactoCurva) {
    boxAvisoImpactoCurva.classList.remove("ativo");
  }

  if (boxAvisoRealizado) {
    boxAvisoRealizado.classList.remove("ativo");
  }

  atualizarBloqueioScrollModal();
}

async function salvarEdicaoDatas(event) {
  event.preventDefault();

  if (!usuarioEhAdministradorGeral(usuarioLogadoGlobal)) {
    alert("A alteração de datas é permitida somente para Administrador Geral.");
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

  const novoNome = String(editObraNome?.value || "").trim();
  const novaLocalidade = String(editLocalidadeObra?.value || "").trim();
  const novoValorOrcadoNumero = numeroBRL(editValorOrcado?.value || 0);
  const novoValorOrcadoFormatado = moeda(novoValorOrcadoNumero);

  if (!obraId) {
    alert("Não foi possível identificar a obra selecionada.");
    return;
  }

  if (!novoNome) {
    alert("Informe o nome da obra.");
    editObraNome?.focus();
    return;
  }

  if (!novaLocalidade) {
    alert("Selecione a localidade da obra.");
    editLocalidadeObra?.focus();
    return;
  }

  if (novoValorOrcadoNumero <= 0) {
    alert("Informe um orçamento válido para a obra.");
    editValorOrcado?.focus();
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

  const obraSelecionada =
    obraSelecionadaParaEdicao ||
    listaProjetos.find((item) => item.id === obraId);

  if (!obraSelecionada) {
    alert("A obra selecionada não foi localizada na lista carregada.");
    return;
  }

  const nomeAnterior = obraSelecionada.nomeObraTela || "";
  const localidadeAnterior = obraSelecionada.localidade || "";
  const valorOrcadoAnteriorNumero = numeroBRL(
    obraSelecionada.investimento ??
    obraSelecionada.valorObra ??
    obraSelecionada.valorOrcado ??
    obraSelecionada.orcamento ??
    0
  );

  const datasAlteradas =
    novaDataInicio !== dataInicioAnterior ||
    novaDataFim !== dataFimAnterior;

  const nomeAlterado = novoNome !== nomeAnterior;
  const localidadeAlterada = novaLocalidade !== localidadeAnterior;
  const valorAlterado = novoValorOrcadoNumero !== valorOrcadoAnteriorNumero;

  if (
    !datasAlteradas &&
    !nomeAlterado &&
    !localidadeAlterada &&
    !valorAlterado
  ) {
    alert("Nenhuma alteração foi identificada.");
    return;
  }

  if (!justificativa) {
    alert("Informe a justificativa da alteração.");
    editJustificativa?.focus();
    return;
  }

  if (possuiPlanejamento && datasAlteradas) {
    const confirmarPlanejamento = window.confirm(
      [
        "Esta obra já possui Curva S planejada.",
        "",
        "Ao alterar as datas, a obra será marcada como replanejamento necessário.",
        "",
        "Deseja continuar?"
      ].join("\n")
    );

    if (!confirmarPlanejamento) {
      return;
    }
  }

  if (possuiPlanejamento && valorAlterado) {
    const confirmarValor = window.confirm(
      [
        "Esta obra já possui Curva S planejada.",
        "",
        "Alterar o orçamento muda a base usada para calcular os percentuais",
        "planejados/executados. Revise a Curva S depois de salvar.",
        "",
        "Deseja continuar?"
      ].join("\n")
    );

    if (!confirmarValor) {
      return;
    }
  }

  if (possuiRealizado && (datasAlteradas || valorAlterado)) {
    const confirmarRealizado = window.confirm(
      [
        "Esta obra já possui realizado lançado.",
        "",
        "O realizado não será apagado, mas a alteração ficará registrada no histórico.",
        "",
        "Deseja continuar?"
      ].join("\n")
    );

    if (!confirmarRealizado) {
      return;
    }
  }

  const colecaoAtualizacao = obraSelecionada.colecaoOrigem || "obras";

  const usuarioUid = obterUidUsuario(usuarioLogadoGlobal);
  const usuarioEmail = obterEmailUsuario(usuarioLogadoGlobal);
  const usuarioNome = obterNomeUsuario(usuarioLogadoGlobal);
  const usuarioPerfil = obterNomePerfilExibicao(usuarioLogadoGlobal);

  const regionalNova =
    obterRegionalPelaLocalidade(novaLocalidade) ||
    obraSelecionada.regional ||
    "";

  const historico = {
    tipo: "ALTERACAO_OBRA",
    camposAlterados: [
      datasAlteradas ? "datas" : null,
      nomeAlterado ? "nome" : null,
      localidadeAlterada ? "localidade" : null,
      valorAlterado ? "orcamento" : null
    ].filter(Boolean),

    nomeAnterior,
    nomeNovo: novoNome,

    localidadeAnterior,
    localidadeNova: novaLocalidade,

    valorOrcadoAnterior: moeda(valorOrcadoAnteriorNumero),
    valorOrcadoNovo: novoValorOrcadoFormatado,

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
    alteradoPorUid: usuarioUid,
    alteradoPorNome: usuarioNome,
    alteradoPorEmail: usuarioEmail,
    alteradoPorPerfil: usuarioPerfil,
    alteradoEm: new Date().toISOString()
  };

  const payloadAtualizacao = {
    nomeProjeto: novoNome,
    nomeObra: novoNome,

    localidade: novaLocalidade,
    regional: regionalNova,

    valorObra: novoValorOrcadoFormatado,
    investimento: novoValorOrcadoFormatado,
    valorOrcado: novoValorOrcadoFormatado,
    valorObraNumero: novoValorOrcadoNumero,
    investimentoNumero: novoValorOrcadoNumero,
    valorOrcadoNumero: novoValorOrcadoNumero,

    dataInicio: novaDataInicio,
    dataFim: novaDataFim,
    dataInicioPrevisto: novaDataInicio,
    dataTerminoPrevisto: novaDataFim,
    dataFimPrevisto: novaDataFim,

    datasObraAtualizadas: true,
    datasObraAtualizadasEm: serverTimestamp(),
    datasObraAtualizadasPorUid: usuarioUid,
    datasObraAtualizadasPorNome: usuarioNome,
    datasObraAtualizadasPorEmail: usuarioEmail,
    datasObraAtualizadasPorPerfil: usuarioPerfil,

    replanejamentoNecessario: Boolean(possuiPlanejamento && datasAlteradas),
    reprogramacaoNecessaria: Boolean(possuiPlanejamento && datasAlteradas),
    motivoReplanejamento: (possuiPlanejamento && datasAlteradas) ? justificativa : "",

    historicoAlteracoesDatas: arrayUnion(historico)
  };

  try {
    if (btnSalvarEdicaoDatas) {
      btnSalvarEdicaoDatas.disabled = true;
      btnSalvarEdicaoDatas.innerHTML =
        '<i class="fa-solid fa-spinner fa-spin"></i> Salvando...';
    }

    await updateDoc(
      doc(
        db,
        colecaoAtualizacao,
        obraId
      ),
      payloadAtualizacao
    );

    alert("Obra atualizada com sucesso.");

    fecharModalEdicaoDatas();

    await carregarProjetos();
  } catch (error) {
    console.error(
      "Erro ao atualizar as datas da obra:",
      error
    );

    if (error?.code === "permission-denied") {
      alert(
        "O Firestore recusou a alteração. Verifique se o perfil exibido no cabeçalho possui permissão de Administrador Geral."
      );
    } else {
      alert(
        "Erro ao atualizar as datas da obra. Verifique sua conexão e tente novamente."
      );
    }
  } finally {
    if (btnSalvarEdicaoDatas) {
      btnSalvarEdicaoDatas.disabled = false;
      btnSalvarEdicaoDatas.innerHTML =
        '<i class="fa-solid fa-floppy-disk"></i> Salvar Alterações';
    }
  }
}

/* =========================
   EXCLUSÃO COMPLETA DA OBRA
========================= */

function textoSeguro(valor) {
  return String(valor || "").trim();
}

function valorValidoParaBusca(valor) {
  const texto = textoSeguro(valor);

  if (!texto || texto === "-") {
    return "";
  }

  return texto;
}

function gerarChavesObraParaExclusao(obra = {}) {
  const valores = [
    obra.id,
    obra.docId,
    obra.uid,
    obra.firebaseId,
    obra.obraDocId,
    obra.obraId,
    obra.idObra,
    obra.codigoObra,
    obra.codigo,
    obra.idProjeto,
    obra.projetoId,
    obra.projectId,
    obra.codigoObraTela,
    obra.nomeObraTela,
    obra.nomeProjeto,
    obra.nomeObra,
    obra.obraNome,
    obra.obra,
    obra.projeto,
    obra.titulo
  ];

  return [
    ...new Set(
      valores
        .map(valorValidoParaBusca)
        .filter(Boolean)
    )
  ];
}

function adicionarRefAoMapa(refsMap, referencia) {
  if (!referencia?.path) {
    return;
  }

  refsMap.set(
    referencia.path,
    referencia
  );
}

async function adicionarRefsPorId(refsMap, nomeColecao, valores) {
  const valoresValidos = [
    ...new Set(
      valores
        .map(valorValidoParaBusca)
        .filter(Boolean)
    )
  ];

  for (const valor of valoresValidos) {
    try {
      if (valor.includes("/")) {
        continue;
      }

      const referencia = doc(
        db,
        nomeColecao,
        valor
      );

      const documento = await getDoc(referencia);

      if (documento.exists()) {
        adicionarRefAoMapa(
          refsMap,
          documento.ref
        );
      }
    } catch (error) {
      console.warn(
        `Busca por ID ignorada: ${nomeColecao}/${valor}`,
        error
      );
    }
  }
}

async function adicionarRefsPorCampo(refsMap, nomeColecao, campo, valores) {
  const valoresValidos = [
    ...new Set(
      valores
        .map(valorValidoParaBusca)
        .filter(Boolean)
    )
  ];

  for (const valor of valoresValidos) {
    try {
      const consulta = query(
        collection(
          db,
          nomeColecao
        ),
        where(
          campo,
          "==",
          valor
        )
      );

      const resultado = await getDocs(consulta);

      resultado.forEach((documento) => {
        adicionarRefAoMapa(
          refsMap,
          documento.ref
        );
      });
    } catch (error) {
      console.warn(
        `Consulta ignorada: ${nomeColecao}.${campo}=${valor}`,
        error
      );
    }
  }
}

async function adicionarSubcolecoesConhecidas(refsMap, chaves) {
  const colecoesRaiz = [
    "projetos",
    "obras"
  ];

  const subcolecoes = [
    "cronogramaSemanal",
    "rollups"
  ];

  for (const colecaoRaiz of colecoesRaiz) {
    for (const chave of chaves) {
      if (!chave || chave.includes("/")) {
        continue;
      }

      for (const subcolecao of subcolecoes) {
        try {
          const resultado = await getDocs(
            collection(
              db,
              colecaoRaiz,
              chave,
              subcolecao
            )
          );

          resultado.forEach((documento) => {
            adicionarRefAoMapa(
              refsMap,
              documento.ref
            );
          });
        } catch (error) {
          console.warn(
            `Subcoleção ignorada: ${colecaoRaiz}/${chave}/${subcolecao}`,
            error
          );
        }
      }
    }
  }
}

async function adicionarRefSelecionadaSeExistir(refsMap, colecao, id) {
  if (!colecao || !id || String(id).includes("/")) {
    return;
  }

  try {
    const referencia = doc(
      db,
      colecao,
      id
    );

    const documento = await getDoc(referencia);

    if (documento.exists()) {
      adicionarRefAoMapa(
        refsMap,
        documento.ref
      );
    }
  } catch (error) {
    console.warn(
      `Documento principal ignorado: ${colecao}/${id}`,
      error
    );
  }
}

async function coletarReferenciasDaObra(obra) {
  const refsMap = new Map();

  const chaves = gerarChavesObraParaExclusao(obra);

  const colecoesPrincipais = [
    "obras",
    "projetos"
  ];

  const colecoesRelacionadas = [
    "planejamentoCurvaS",
    "realizadoCurvaS",
    "projetos_atualizados",
    "anomalias",
    "custos",
    "cronogramaSemanal",
    "rollupsIndicadores",
    "indicadoresObra_snapshot",
    "indicadoresObra_semanal",
    "indicadoresObra_mensal",
    "pesquisasObras",
    "pesquisasRespostas"
  ];

  const camposRelacionamento = [
    "obraDocId",
    "obraId",
    "idObra",
    "codigoObra",
    "codigo",
    "idProjeto",
    "projetoId",
    "projectId",
    "projectID",
    "obra",
    "obraNome",
    "nomeObra",
    "nomeProjeto",
    "projeto"
  ];

  await adicionarRefSelecionadaSeExistir(
    refsMap,
    obra.colecaoOrigem || "obras",
    obra.id
  );

  if ((obra.colecaoOrigem || "obras") !== "obras") {
    await adicionarRefSelecionadaSeExistir(
      refsMap,
      "obras",
      obra.id
    );
  }

  for (const nomeColecao of colecoesPrincipais) {
    await adicionarRefsPorId(
      refsMap,
      nomeColecao,
      chaves
    );

    for (const campo of camposRelacionamento) {
      await adicionarRefsPorCampo(
        refsMap,
        nomeColecao,
        campo,
        chaves
      );
    }
  }

  for (const nomeColecao of colecoesRelacionadas) {
    await adicionarRefsPorId(
      refsMap,
      nomeColecao,
      chaves
    );

    for (const campo of camposRelacionamento) {
      await adicionarRefsPorCampo(
        refsMap,
        nomeColecao,
        campo,
        chaves
      );
    }
  }

  await adicionarSubcolecoesConhecidas(
    refsMap,
    chaves
  );

  return {
    refsMap,
    chaves
  };
}

function contarPorColecao(refsMap) {
  const resumo = {};

  refsMap.forEach((referencia) => {
    const partes = referencia.path.split("/");

    const nomeColecao =
      partes.length >= 2
        ? partes[partes.length - 2]
        : partes[0];

    resumo[nomeColecao] =
      (resumo[nomeColecao] || 0) + 1;
  });

  return resumo;
}

async function apagarEmLotes(refsMap) {
  const referencias = Array.from(refsMap.values());
  const tamanhoLote = 450;

  let totalExcluido = 0;

  for (
    let indice = 0;
    indice < referencias.length;
    indice += tamanhoLote
  ) {
    const parte = referencias.slice(
      indice,
      indice + tamanhoLote
    );

    const lote = writeBatch(db);

    parte.forEach((referencia) => {
      lote.delete(referencia);
    });

    await lote.commit();

    totalExcluido += parte.length;
  }

  return totalExcluido;
}

/* =========================
   MODAL DE EXCLUSÃO
========================= */

function abrirModalExcluirObra(obra) {
  if (!usuarioPodeExcluirObra(usuarioLogadoGlobal)) {
    alert("A exclusão é permitida somente para Administrador Geral.");
    return;
  }

  if (!obra || !modalExcluirObra) {
    return;
  }

  obraSelecionadaParaExclusao = obra;

  if (excluirObraDocId) {
    excluirObraDocId.value = obra.id || "";
  }

  if (excluirCodigoObra) {
    excluirCodigoObra.value =
      obra.codigoObraTela ||
      obra.codigoObra ||
      obra.codigo ||
      "";
  }

  if (excluirNomeObra) {
    excluirNomeObra.value =
      obra.nomeObraTela ||
      obra.nomeProjeto ||
      obra.nomeObra ||
      "";
  }

  if (excluirObraNomeVisual) {
    excluirObraNomeVisual.value =
      obra.nomeObraTela ||
      obra.nomeProjeto ||
      obra.nomeObra ||
      "-";
  }

  if (excluirCodigoObraVisual) {
    excluirCodigoObraVisual.value =
      obra.codigoObraTela ||
      obra.codigoObra ||
      obra.codigo ||
      obra.id ||
      "-";
  }

  if (excluirRegionalObra) {
    excluirRegionalObra.value = obra.regional || "-";
  }

  if (excluirLocalidadeObra) {
    excluirLocalidadeObra.value = obra.localidade || "-";
  }

  if (excluirStatusObra) {
    excluirStatusObra.value =
      obra.statusFinal ||
      obra.status ||
      "-";
  }

  modalExcluirObra.classList.add("ativo");
  modalExcluirObra.setAttribute("aria-hidden", "false");

  atualizarBloqueioScrollModal();
}

function fecharModalExcluirObra() {
  if (!modalExcluirObra) {
    return;
  }

  modalExcluirObra.classList.remove("ativo");
  modalExcluirObra.setAttribute("aria-hidden", "true");

  obraSelecionadaParaExclusao = null;

  if (formExcluirObra) {
    formExcluirObra.reset();
  }

  atualizarBloqueioScrollModal();
}

function formatarResumoColecoes(resumo) {
  const itens = Object.entries(resumo || {});

  if (!itens.length) {
    return "Nenhum documento relacionado localizado.";
  }

  return itens
    .sort(([colecaoA], [colecaoB]) =>
      colecaoA.localeCompare(
        colecaoB,
        "pt-BR"
      )
    )
    .map(([colecao, quantidade]) =>
      `• ${colecao}: ${quantidade}`
    )
    .join("\n");
}

/* =========================
   AUDITORIA DA EXCLUSÃO
========================= */

async function registrarAuditoriaExclusao(obra, dadosExclusao) {
  const usuarioUid = obterUidUsuario(usuarioLogadoGlobal);
  const usuarioEmail = obterEmailUsuario(usuarioLogadoGlobal);
  const usuarioNome = obterNomeUsuario(usuarioLogadoGlobal);
  const usuarioPerfil = obterNomePerfilExibicao(usuarioLogadoGlobal);

  const payloadAuditoria = {
    tipo: "EXCLUSAO_COMPLETA_OBRA",

    obraDocId: obra.id || "",
    colecaoOrigem: obra.colecaoOrigem || "obras",

    codigoObra:
      obra.codigoObraTela ||
      obra.codigoObra ||
      obra.codigo ||
      "",

    nomeObra:
      obra.nomeObraTela ||
      obra.nomeProjeto ||
      obra.nomeObra ||
      "",

    regional: obra.regional || "",
    localidade: obra.localidade || "",
    status: obra.statusFinal || obra.status || "",

    dataInicio:
      dataParaInput(
        obra.inicioObraTela ||
        obra.dataInicio ||
        obra.dataInicioPrevisto
      ),

    dataFim:
      dataParaInput(
        obra.fimObraTela ||
        obra.dataFim ||
        obra.dataTerminoPrevisto
      ),

    prioridade:
      obra.prioridadeFinal ||
      obra.gutNivel ||
      obra.prioridade ||
      "",

    custoExecucao: numeroBRL(obra.custoExecucao),
    totalDocumentosExcluidos: dadosExclusao.totalExcluido || 0,
    documentosPorColecao: dadosExclusao.resumoColecoes || {},
    chavesUtilizadas: dadosExclusao.chaves || [],

    excluidoPorUid: usuarioUid,
    excluidoPorNome: usuarioNome,
    excluidoPorEmail: usuarioEmail,
    excluidoPorPerfil: usuarioPerfil,

    excluidoEm: serverTimestamp(),
    excluidoEmISO: new Date().toISOString()
  };

  return addDoc(
    collection(
      db,
      "historicoExclusoesObras"
    ),
    payloadAuditoria
  );
}

/* =========================
   EXCLUSÃO DEFINITIVA
========================= */

async function excluirObraCompleta(event) {
  event.preventDefault();

  if (!usuarioPodeExcluirObra(usuarioLogadoGlobal)) {
    alert("A exclusão é permitida somente para Administrador Geral.");
    fecharModalExcluirObra();
    return;
  }

  const obra = obraSelecionadaParaExclusao;

  if (!obra) {
    alert("Nenhuma obra foi selecionada para exclusão.");
    return;
  }

  const obraId =
    excluirObraDocId?.value ||
    obra.id ||
    "";

  const codigoObra =
    excluirCodigoObra?.value ||
    obra.codigoObraTela ||
    obra.codigoObra ||
    obra.codigo ||
    obraId ||
    "-";

  const nomeObra =
    excluirNomeObra?.value ||
    obra.nomeObraTela ||
    obra.nomeProjeto ||
    obra.nomeObra ||
    "-";

  if (!obraId) {
    alert("Não foi possível identificar o documento da obra.");
    return;
  }

  const primeiraConfirmacao = window.confirm(
    [
      "ATENÇÃO",
      "",
      "Você está prestes a excluir definitivamente esta obra:",
      "",
      `Código: ${codigoObra}`,
      `Obra: ${nomeObra}`,
      "",
      "Também serão pesquisados e excluídos os registros vinculados.",
      "",
      "Deseja iniciar a verificação?"
    ].join("\n")
  );

  if (!primeiraConfirmacao) {
    return;
  }

  const textoOriginalBotao =
    btnConfirmarExcluirObra?.innerHTML ||
    '<i class="fa-solid fa-trash-can"></i> Excluir definitivamente';

  try {
    if (btnConfirmarExcluirObra) {
      btnConfirmarExcluirObra.disabled = true;
      btnConfirmarExcluirObra.innerHTML =
        '<i class="fa-solid fa-spinner fa-spin"></i> Localizando dados...';
    }

    const {
      refsMap,
      chaves
    } = await coletarReferenciasDaObra(obra);

    const totalLocalizado = refsMap.size;
    const resumoColecoes = contarPorColecao(refsMap);

    if (totalLocalizado <= 0) {
      alert("Nenhum documento foi localizado para exclusão.");
      return;
    }

    const resumoTexto = formatarResumoColecoes(resumoColecoes);

    const segundaConfirmacao = window.confirm(
      [
        "CONFIRMAÇÃO FINAL",
        "",
        `Código: ${codigoObra}`,
        `Obra: ${nomeObra}`,
        "",
        `Documentos localizados: ${totalLocalizado}`,
        "",
        resumoTexto,
        "",
        "Esta ação é definitiva e não poderá ser desfeita.",
        "",
        "Clique em OK para excluir todos os registros."
      ].join("\n")
    );

    if (!segundaConfirmacao) {
      return;
    }

    if (btnConfirmarExcluirObra) {
      btnConfirmarExcluirObra.innerHTML =
        '<i class="fa-solid fa-spinner fa-spin"></i> Excluindo registros...';
    }

    const totalExcluido = await apagarEmLotes(refsMap);

    let auditoriaRegistrada = true;

    try {
      await registrarAuditoriaExclusao(
        obra,
        {
          totalExcluido,
          resumoColecoes,
          chaves
        }
      );
    } catch (erroAuditoria) {
      auditoriaRegistrada = false;

      console.error(
        "A obra foi excluída, mas não foi possível registrar a auditoria:",
        erroAuditoria
      );
    }

    fecharModalExcluirObra();

    listaProjetos = listaProjetos.filter(
      (item) =>
        !(
          item.id === obra.id &&
          item.colecaoOrigem === obra.colecaoOrigem
        )
    );

    aplicarFiltros();

    await carregarProjetos();

    const mensagemSucesso = [
      "Obra excluída com sucesso.",
      "",
      `Código: ${codigoObra}`,
      `Obra: ${nomeObra}`,
      `Documentos excluídos: ${totalExcluido}`
    ];

    if (!auditoriaRegistrada) {
      mensagemSucesso.push(
        "",
        "Atenção: a exclusão foi concluída, mas o registro de auditoria não pôde ser salvo."
      );
    }

    alert(
      mensagemSucesso.join("\n")
    );
  } catch (error) {
    console.error(
      "Erro ao excluir a obra completa:",
      error
    );

    if (error?.code === "permission-denied") {
      alert(
        [
          "O Firestore recusou a exclusão.",
          "",
          "Confirme se o perfil mostrado no cabeçalho é:",
          "• Administrador Geral.",
          "",
          "Também verifique se as regras atualizadas do Firestore foram publicadas."
        ].join("\n")
      );
    } else if (error?.code === "unavailable") {
      alert(
        "O Firebase está temporariamente indisponível. Verifique a conexão e tente novamente."
      );
    } else {
      alert(
        [
          "Não foi possível concluir a exclusão da obra.",
          "",
          `Detalhes: ${error?.message || "Erro desconhecido."}`
        ].join("\n")
      );
    }
  } finally {
    if (btnConfirmarExcluirObra) {
      btnConfirmarExcluirObra.disabled = false;
      btnConfirmarExcluirObra.innerHTML = textoOriginalBotao;
    }
  }
}

/* =========================
   EXPORTAR PDF
========================= */

function exportarPDF() {
  const tituloAnterior = document.title;

  document.title =
    `Painel Executivo de Obras - ${new Date()
      .toLocaleDateString("pt-BR")
      .replace(/\//g, "-")}`;

  document.body.classList.add("modo-exportacao-pdf");

  window.setTimeout(
    () => {
      window.print();
    },
    250
  );

  window.setTimeout(
    () => {
      document.body.classList.remove("modo-exportacao-pdf");
      document.title = tituloAnterior;
    },
    1500
  );
}

document
  .getElementById("btnExportarPdfGestao")
  ?.addEventListener("click", exportarPDF);

/* =========================
   EVENTOS
========================= */

function configurarEventosFiltros() {
  filtroRegional?.addEventListener(
    "change",
    () => {
      carregarLocalidadesPorRegional(filtroRegional.value);
      aplicarFiltros();
    }
  );

  filtroLocalidade?.addEventListener("change", aplicarFiltros);
  filtroAno?.addEventListener("change", aplicarFiltros);
  filtroGutNivel?.addEventListener("change", aplicarFiltros);
  filtroStatus?.addEventListener("change", aplicarFiltros);
}

function configurarEventosModalDatas() {
  btnFecharModalEdicaoDatas?.addEventListener(
    "click",
    fecharModalEdicaoDatas
  );

  btnCancelarEdicaoDatas?.addEventListener(
    "click",
    fecharModalEdicaoDatas
  );

  formEditarDatas?.addEventListener(
    "submit",
    salvarEdicaoDatas
  );

  modalEditarDatas?.addEventListener(
    "click",
    (event) => {
      if (event.target === modalEditarDatas) {
        fecharModalEdicaoDatas();
      }
    }
  );

  editLocalidadeObra?.addEventListener("change", () => {
    if (!editRegionalObra) {
      return;
    }

    const regionalPrevista = obterRegionalPelaLocalidade(
      editLocalidadeObra.value
    );

    editRegionalObra.value = regionalPrevista || editRegionalObra.value;
  });

  editValorOrcado?.addEventListener("input", (event) => {
    const digitos = event.target.value.replace(/\D/g, "");

    event.target.value = moeda(Number(digitos) / 100);
  });
}

function configurarEventosModalExclusao() {
  btnFecharModalExcluirObra?.addEventListener(
    "click",
    fecharModalExcluirObra
  );

  btnCancelarExcluirObra?.addEventListener(
    "click",
    fecharModalExcluirObra
  );

  formExcluirObra?.addEventListener(
    "submit",
    excluirObraCompleta
  );

  modalExcluirObra?.addEventListener(
    "click",
    (event) => {
      if (event.target === modalExcluirObra) {
        fecharModalExcluirObra();
      }
    }
  );
}

function configurarEventosTeclado() {
  document.addEventListener(
    "keydown",
    (event) => {
      if (event.key !== "Escape") {
        return;
      }

      if (modalExcluirObra?.classList.contains("ativo")) {
        fecharModalExcluirObra();
        return;
      }

      if (modalEditarDatas?.classList.contains("ativo")) {
        fecharModalEdicaoDatas();
      }
    }
  );
}

function configurarEventos() {
  configurarEventosFiltros();
  configurarEventosModalDatas();
  configurarEventosModalExclusao();
  configurarEventosTeclado();
}

/* =========================
   VALIDAÇÃO DA TELA
========================= */

function validarElementosPrincipais() {
  const elementosObrigatorios = [
    {
      elemento: tbodyProjetos,
      nome: "tbodyProjetos"
    },
    {
      elemento: filtroRegional,
      nome: "filtroRegional"
    },
    {
      elemento: filtroLocalidade,
      nome: "filtroLocalidade"
    },
    {
      elemento: usuarioEmailTopo,
      nome: "usuarioEmailTopo"
    },
    {
      elemento: usuarioPerfilTopo,
      nome: "usuarioPerfilTopo"
    }
  ];

  const elementosAusentes =
    elementosObrigatorios
      .filter((item) => !item.elemento)
      .map((item) => item.nome);

  if (elementosAusentes.length) {
    console.warn(
      "Elementos não encontrados no HTML:",
      elementosAusentes
    );
  }
}

function exibirErroIdentificacaoUsuario(erro) {
  console.error(
    "Erro ao identificar o usuário:",
    erro
  );

  const emailAuth = normalizarEmail(auth.currentUser?.email || "");

  if (usuarioEmailTopo) {
    usuarioEmailTopo.textContent =
      emailAuth ||
      "Email não identificado";
  }

  if (usuarioPerfilTopo) {
    usuarioPerfilTopo.textContent =
      "Perfil não identificado";
  }

  if (usuarioLogadoInfo) {
    usuarioLogadoInfo.classList.remove("perfil-administrador");
    usuarioLogadoInfo.classList.add("perfil-sem-permissao");
  }

  document.body.classList.remove(
    "usuario-admin",
    "usuario-admin-geral",
    "usuario-admin-regional"
  );

  document
    .querySelectorAll("[data-admin-only]")
    .forEach((elemento) => {
      elemento.style.display = "none";
      elemento.setAttribute("aria-disabled", "true");
    });
}

/* =========================
   USUÁRIOS PENDENTES DE APROVAÇÃO
========================= */

let listaUsuariosPendentesCache = [];

async function verificarUsuariosPendentes() {
  const botao = document.getElementById("btnUsuariosPendentes");
  const texto = document.getElementById("textoUsuariosPendentes");

  if (!botao || !texto) {
    return;
  }

  if (!usuarioEhAdministradorGeral(usuarioLogadoGlobal)) {
    botao.style.display = "none";
    return;
  }

  try {
    const snapshot = await getDocs(
      query(
        collection(db, "usuariosSistema"),
        where("status", "==", "pendente")
      )
    );

    listaUsuariosPendentesCache = snapshot.docs.map((documento) => ({
      id: documento.id,
      ...documento.data()
    }));

    const quantidade = listaUsuariosPendentesCache.length;

    if (quantidade === 0) {
      botao.style.display = "none";
      return;
    }

    texto.textContent =
      quantidade === 1
        ? "1 usuário aguardando"
        : `${quantidade} usuários aguardando`;

    botao.style.display = "inline-flex";
  } catch (error) {
    console.warn("Não foi possível verificar usuários pendentes:", error);
    botao.style.display = "none";
  }
}

function exibirListaUsuariosPendentes() {
  if (!listaUsuariosPendentesCache.length) {
    alert("Nenhum usuário pendente no momento.");
    return;
  }

  const linhas = listaUsuariosPendentesCache.map((usuario) => {
    const nome = usuario.nome || "(sem nome)";
    const email = usuario.email || usuario.emailAuth || "(sem e-mail)";
    return `• ${nome} — ${email}`;
  });

  alert(
    [
      "Usuários aguardando aprovação:",
      "",
      ...linhas,
      "",
      "Aprove ou reprove esses usuários no Firebase Console, na coleção usuariosSistema."
    ].join("\n")
  );
}

/* =========================
   INICIALIZAÇÃO
========================= */

document.addEventListener(
  "DOMContentLoaded",
  async () => {
    validarElementosPrincipais();

    try {
      const usuarioProtegido = await protegerPagina();

      usuarioLogadoGlobal = await carregarUsuarioCompleto(usuarioProtegido);

      exibirUsuarioLogadoNoTopo();

      aplicarVisibilidadeAdministrador();

      configurarEventos();

      document
        .getElementById("btnUsuariosPendentes")
        ?.addEventListener("click", exibirListaUsuariosPendentes);

      verificarUsuariosPendentes();

      await carregarProjetos();

      const editarObraIdNaUrl = new URLSearchParams(window.location.search).get(
        "editarObraId"
      );

      if (editarObraIdNaUrl) {
        const obraParaEditar = listaProjetos.find(
          (item) => item.id === editarObraIdNaUrl
        );

        if (obraParaEditar) {
          abrirModalEdicaoDatas(obraParaEditar);
        }
      }
    } catch (error) {
      exibirErroIdentificacaoUsuario(error);

      mostrarMensagemTabela(
        "Erro ao iniciar a Gestão de Obras. Verifique o login, o perfil do usuário e as permissões do Firestore."
      );

      alert(
        [
          "Não foi possível iniciar a Gestão de Obras.",
          "",
          "Verifique:",
          "• se o usuário está autenticado;",
          "• se existe um cadastro em usuariosSistema;",
          "• se o campo perfil está preenchido;",
          "• se as regras do Firestore foram publicadas."
        ].join("\n")
      );
    }
  }
);