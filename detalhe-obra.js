/* =====================================================
   FICHA DA OBRA (detalhe-obra.js)
   Visão 360° de uma obra: identificação, resumo
   físico-financeiro, Curva S completa (com origem dos
   lançamentos), anomalias e histórico de alterações.
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
  query,
  where
} from "https://www.gstatic.com/firebasejs/10.12.3/firebase-firestore.js";

const auth = getAuth();

/* =========================
   ELEMENTOS
========================= */

const $ = (id) => document.getElementById(id);

const usuarioLogadoInfo = $("usuarioLogadoInfo");
const usuarioEmailTopo = $("usuarioEmailTopo");
const usuarioPerfilTopo = $("usuarioPerfilTopo");

const tituloObra = $("tituloObra");
const subtituloObra = $("subtituloObra");

const carregandoObra = $("carregandoObra");
const obraNaoEncontrada = $("obraNaoEncontrada");
const conteudoObra = $("conteudoObra");

const gridIdentificacao = $("gridIdentificacao");
const kpisResumoObra = $("kpisResumoObra");
const tbodyCurvaSObra = $("tbodyCurvaSObra");

const listaAnomalias = $("listaAnomalias");
const semAnomalias = $("semAnomalias");

const listaHistorico = $("listaHistorico");
const semHistorico = $("semHistorico");

const btnAtualizarCurvaSObra = $("btnAtualizarCurvaSObra");
const btnEditarObraDetalhe = $("btnEditarObraDetalhe");
const btnImprimirFicha = $("btnImprimirFicha");
const relatorioMetaImpressao = $("relatorioMetaImpressao");

let usuarioLogadoGlobal = null;
let obraAtual = null;
let obraAtualId = "";

/* =========================
   AUTENTICAÇÃO / PERFIL
   (mesmo padrão usado em gestaodeobras.js)
========================= */

function normalizarEmail(valor) {
  return String(valor || "").trim().toLowerCase();
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

function obterPerfilPermissao(usuario) {
  return normalizarTexto(obterPerfilUsuario(usuario));
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

    temporizador = setTimeout(() => {
      finalizar(auth.currentUser);
    }, timeoutMs);
  });
}

async function buscarPerfilUsuarioFirestore(usuarioBase) {
  const uid = obterUidUsuario(usuarioBase);
  const email = obterEmailUsuario(usuarioBase);

  if (uid) {
    try {
      const snapshotUsuario = await getDoc(doc(db, "usuariosSistema", uid));

      if (snapshotUsuario.exists()) {
        return { id: snapshotUsuario.id, ...snapshotUsuario.data() };
      }
    } catch (error) {
      console.warn("Não foi possível buscar o perfil do usuário pelo UID:", error);
    }
  }

  if (email) {
    const camposEmail = ["email", "emailAuth", "usuarioEmail", "login"];

    for (const campo of camposEmail) {
      try {
        const resultado = await getDocs(
          query(collection(db, "usuariosSistema"), where(campo, "==", email))
        );

        if (!resultado.empty) {
          const documentoUsuario = resultado.docs[0];
          return { id: documentoUsuario.id, ...documentoUsuario.data() };
        }
      } catch (error) {
        console.warn(`Não foi possível buscar o perfil pelo campo ${campo}:`, error);
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

    email: normalizarEmail(
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

    uid: perfilFirestore?.uid || usuarioBase.uid || perfilFirestore?.id || "",

    email: normalizarEmail(
      perfilFirestore?.email || perfilFirestore?.emailAuth || usuarioBase.email || ""
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

  const status = normalizarTexto(usuario.status || usuario.statusUsuario || usuario.situacao || "");

  if (!status) {
    return true;
  }

  return !["inativo", "bloqueado", "bloqueada", "pendente", "reprovado", "reprovada"].includes(status);
}

function obterPerfilEfetivoGestao(usuario) {
  return obterPerfilPermissao(usuario) || "usuario";
}

function usuarioEhAdministradorGeral(usuario) {
  if (!usuario || !usuarioEstaAtivoParaPermissao(usuario)) {
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

function obterNomePerfilExibicao(usuario) {
  if (usuarioEhAdministradorGeral(usuario)) {
    return "Administrador Geral";
  }

  if (obterPerfilEfetivoGestao(usuario) === "planejador") {
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

    usuarioLogadoInfo.classList.toggle("perfil-administrador", administrador);
    usuarioLogadoInfo.classList.toggle("perfil-sem-permissao", !administrador);
  }
}

function aplicarVisibilidadeAdministrador() {
  const adminGeral = usuarioEhAdministradorGeral(usuarioLogadoGlobal);

  document.body.classList.toggle("usuario-admin", adminGeral);
  document.body.classList.toggle("usuario-admin-geral", adminGeral);

  document.querySelectorAll("[data-admin-only]").forEach((elemento) => {
    elemento.style.display = adminGeral ? "" : "none";
  });
}

/* =========================
   UTILITÁRIOS DE DADOS
========================= */

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
  return numeroBRL(valor).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function percentual(valor) {
  return `${Number(valor || 0).toFixed(2).replace(".", ",")}%`;
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
      return new Date(Number(partes[2]), Number(partes[1]) - 1, Number(partes[0]));
    }
  }

  const data = new Date(texto);
  return Number.isNaN(data.getTime()) ? null : data;
}

function formatarData(valor) {
  const data = converterParaDate(valor);
  return data ? data.toLocaleDateString("pt-BR") : "-";
}

function formatarDataHora(valor) {
  const data = converterParaDate(valor);
  return data ? data.toLocaleString("pt-BR") : "-";
}

function numeroSemana(valor) {
  return parseInt(String(valor || "").replace(/\D/g, "")) || 0;
}

function obterCodigoObra(obra) {
  return obra.idProjeto || obra.idObra || obra.codigoObra || obra.obraId || obra.codigo || "-";
}

function obterNomeObra(obra) {
  return obra.nomeProjeto || obra.nomeObra || obra.projeto || obra.obra || obra.titulo || "-";
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

function calcularStatus(obra, custoExecucao, fisicoRealAcum) {
  const statusInformadoBruto = obra.status || obra.statusObra || obra.statusNovo || obra.fase || "";
  const statusInformado = statusInformadoBruto ? normalizarStatus(statusInformadoBruto) : "";

  if (statusInformado === "Paralisada") {
    return "Paralisada";
  }

  if (statusInformado === "Concluído" || fisicoRealAcum >= 100) {
    return "Concluído";
  }

  if (fisicoRealAcum > 0 && fisicoRealAcum < 100) {
    return "Em andamento";
  }

  if (custoExecucao > 0 && fisicoRealAcum <= 0) {
    return "Paralisada";
  }

  return statusInformado || "Planejado";
}

/* =========================
   CARREGAR DADOS DA OBRA
========================= */

async function buscarObraPorId(id) {
  for (const nomeColecao of ["obras", "projetos"]) {
    try {
      const snapshot = await getDoc(doc(db, nomeColecao, id));

      if (snapshot.exists()) {
        return { id: snapshot.id, colecaoOrigem: nomeColecao, ...snapshot.data() };
      }
    } catch (error) {
      console.warn(`Erro ao buscar obra em "${nomeColecao}":`, error);
    }
  }

  return null;
}

function obterTimestampComparacao(item) {
  const data = converterParaDate(
    item?.atualizadoEm || item?.criadoEm || item?.dataAtualizacao || item?.dataRegistro
  );

  return data ? data.getTime() : 0;
}

function deduplicarPorSemana(lista) {
  const mapa = new Map();

  lista.forEach((item) => {
    const numero = Number(item.semanaNumero || numeroSemana(item.semana));

    if (!numero) {
      return;
    }

    const existente = mapa.get(numero);

    if (!existente || obterTimestampComparacao(item) >= obterTimestampComparacao(existente)) {
      mapa.set(numero, item);
    }
  });

  return Array.from(mapa.values());
}

async function buscarPorObra(nomeColecao, obra) {
  const resultados = [];

  const nome = obterNomeObra(obra);

  const consultas = [
    query(collection(db, nomeColecao), where("obraId", "==", obra.id))
  ];

  if (nome && nome !== "-") {
    consultas.push(query(collection(db, nomeColecao), where("obra", "==", nome)));
    consultas.push(query(collection(db, nomeColecao), where("obraNome", "==", nome)));
  }

  for (const consulta of consultas) {
    try {
      const snapshot = await getDocs(consulta);

      snapshot.forEach((docRef) => {
        if (!resultados.some((item) => item.id === docRef.id)) {
          resultados.push({ id: docRef.id, ...docRef.data() });
        }
      });
    } catch (error) {
      console.warn(`Erro ao consultar "${nomeColecao}":`, error);
    }
  }

  return resultados.sort((a, b) => {
    const semanaA = Number(a.semanaNumero || numeroSemana(a.semana));
    const semanaB = Number(b.semanaNumero || numeroSemana(b.semana));
    return semanaA - semanaB;
  });
}

/* =========================
   RENDERIZAÇÃO — IDENTIFICAÇÃO
========================= */

function criarItemIdentificacao(label, valor) {
  const div = document.createElement("div");
  div.className = "item-identificacao";

  const lbl = document.createElement("label");
  lbl.textContent = label;

  const span = document.createElement("span");
  span.textContent = valor || "-";

  div.appendChild(lbl);
  div.appendChild(span);

  return div;
}

function renderizarIdentificacao(obra, statusFinal) {
  if (!gridIdentificacao) {
    return;
  }

  gridIdentificacao.innerHTML = "";

  const itens = [
    ["Código", obterCodigoObra(obra)],
    ["Status", normalizarStatus(statusFinal)],
    ["Regional", obra.regional || "-"],
    ["Localidade", obra.localidade || "-"],
    ["Centro de Custo", obra.centroCusto || "-"],
    ["Prioridade (GUT)", obra.gutNivel || obra.nivel || "-"],
    ["Data de Início", formatarData(obra.dataInicio || obra.dataInicioPrevisto)],
    ["Data de Término", formatarData(obra.dataFim || obra.dataTerminoPrevisto)]
  ];

  itens.forEach(([label, valor]) => {
    gridIdentificacao.appendChild(criarItemIdentificacao(label, valor));
  });
}

/* =========================
   RENDERIZAÇÃO — RESUMO KPIs
========================= */

function criarKpiCard(icone, label, valor) {
  const div = document.createElement("div");
  div.className = "kpi-card";

  div.innerHTML = `
    <div class="kpi-icon"><i class="fa-solid ${icone}"></i></div>
    <div>
      <small>${label}</small>
      <h2>${valor}</h2>
    </div>
  `;

  return div;
}

function renderizarResumo(orcado, executado, fisicoAtual, afo) {
  if (!kpisResumoObra) {
    return;
  }

  const desvio = orcado - executado;

  kpisResumoObra.innerHTML = "";

  kpisResumoObra.appendChild(criarKpiCard("fa-sack-dollar", "Orçado", moeda(orcado)));
  kpisResumoObra.appendChild(criarKpiCard("fa-money-bill-wave", "Executado", moeda(executado)));
  kpisResumoObra.appendChild(criarKpiCard("fa-scale-unbalanced", "Desvio", moeda(desvio)));
  kpisResumoObra.appendChild(criarKpiCard("fa-person-digging", "Físico", percentual(fisicoAtual)));
  kpisResumoObra.appendChild(criarKpiCard("fa-gauge-high", "AFO", percentual(afo)));
}

/* =========================
   RENDERIZAÇÃO — CURVA S
========================= */

function textoSeguro(valor) {
  return String(valor ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function resumoOrigemLancamentos(realizado) {
  const lista = realizado?.lancamentosFinanceiros;

  if (Array.isArray(lista) && lista.length > 0) {
    const partes = lista.map((item) => {
      return item.origem === "Cartão de Suprimentos"
        ? `${item.centroCusto || "-"} (Cartão de Suprimentos)`
        : item.centroCusto || "-";
    });

    return [...new Set(partes)].join(", ");
  }

  return realizado?.centroCustoApropriacao || realizado?.centroCusto || "-";
}

function renderizarCurvaS(semanas) {
  if (!tbodyCurvaSObra) {
    return;
  }

  tbodyCurvaSObra.innerHTML = "";

  if (!semanas.length) {
    tbodyCurvaSObra.innerHTML = `
      <tr><td colspan="8">Nenhum planejamento de Curva S lançado para esta obra.</td></tr>
    `;
    return;
  }

  semanas.forEach(({ planejado, realizado }) => {
    const fisicoPlanejado = planejado?.fisicoAcum ?? planejado?.fisico ?? planejado?.fisicoPlanejado ?? 0;
    const financeiroPlanejado = planejado?.financeiroAcum ?? planejado?.financeiro ?? planejado?.financeiroPlanejado ?? 0;

    const fisicoRealizado = realizado ? (realizado.fisicoReal ?? 0) : null;
    const financeiroRealizado = realizado ? (realizado.financeiroReal ?? 0) : null;

    const tr = document.createElement("tr");

    tr.innerHTML = `
      <td>${textoSeguro(planejado?.semana || realizado?.semana || "-")}</td>
      <td>${textoSeguro(planejado?.periodo || realizado?.periodo || "-")}</td>
      <td>${percentual(fisicoPlanejado)}</td>
      <td>${fisicoRealizado === null ? "-" : percentual(fisicoRealizado)}</td>
      <td>${moeda(financeiroPlanejado)}</td>
      <td>${financeiroRealizado === null ? "-" : moeda(financeiroRealizado)}</td>
      <td>${textoSeguro(realizado ? resumoOrigemLancamentos(realizado) : "-")}</td>
      <td>${realizado && obraTemAnomalia(realizado) ? "⚠️ " + textoSeguro(realizado.tipoAnomalia || realizado.categoriaAnomalia || "Sim") : "-"}</td>
    `;

    tbodyCurvaSObra.appendChild(tr);
  });
}

/* =========================
   RENDERIZAÇÃO — ANOMALIAS
========================= */

function obraTemAnomalia(item) {
  return Boolean(
    item.houveAnomalia === true ||
    item.temAnomalia === "Sim" ||
    item.possuiAnomalia === true ||
    item.tipoAnomalia ||
    item.categoriaAnomalia ||
    item.categoria ||
    item.criticidadeAnomalia ||
    item.severidade ||
    item.gravidadeAnomalia ||
    item.impactoAnomalia ||
    item.impactoPrincipal ||
    item.descricaoAnomalia ||
    item.observacaoAnomalia
  );
}

function obterStatusAnomaliaItem(item) {
  return (
    item.statusAnomalia ||
    item.statusTratativa ||
    item.statusProblema ||
    item.status ||
    "Aberta"
  );
}

function renderizarAnomalias(realizados) {
  if (!listaAnomalias || !semAnomalias) {
    return;
  }

  const comAnomalia = realizados.filter(obraTemAnomalia);

  listaAnomalias.innerHTML = "";

  semAnomalias.classList.toggle("ativo", comAnomalia.length === 0);

  comAnomalia.forEach((item) => {
    const div = document.createElement("div");

    const statusItem = obterStatusAnomaliaItem(item);
    const statusClasse = normalizarTexto(statusItem).replace(/\s+/g, "-");
    div.className = `card-anomalia status-${statusClasse}`;

    const tipo = item.tipoAnomalia || item.categoriaAnomalia || item.categoria || "Sem tipo";
    const criticidade = item.criticidadeAnomalia || item.severidade || item.gravidadeAnomalia || "-";
    const descricao = item.descricaoAnomalia || item.observacaoAnomalia || item.anomalias || "Sem descrição.";
    const responsavel = item.responsavelAnomalia || item.responsavel || "-";
    const prazo = item.prazoTratativaAnomalia || item.prazoTratativa || item.prazo || "";

    div.innerHTML = `
      <div class="cabecalho-anomalia">
        <span class="semana-anomalia">${textoSeguro(item.semana || "-")}</span>
        <span class="tag">${textoSeguro(tipo)}</span>
        <span class="tag">${textoSeguro(criticidade)}</span>
        <span class="tag">${textoSeguro(statusItem)}</span>
      </div>
      <div class="descricao">${textoSeguro(descricao)}</div>
      <div class="meta">
        Responsável: ${textoSeguro(responsavel)}
        ${prazo ? " · Prazo: " + textoSeguro(formatarData(prazo)) : ""}
      </div>
    `;

    listaAnomalias.appendChild(div);
  });
}

/* =========================
   RENDERIZAÇÃO — HISTÓRICO
========================= */

function renderizarHistorico(obra) {
  if (!listaHistorico || !semHistorico) {
    return;
  }

  const historico = Array.isArray(obra.historicoAlteracoesDatas)
    ? [...obra.historicoAlteracoesDatas]
    : [];

  historico.sort((a, b) => new Date(b.alteradoEm || 0) - new Date(a.alteradoEm || 0));

  listaHistorico.innerHTML = "";
  semHistorico.classList.toggle("ativo", historico.length === 0);

  historico.forEach((item) => {
    const div = document.createElement("div");
    div.className = "item-historico";

    const campos = [];

    if (item.nomeAnterior !== undefined && item.nomeAnterior !== item.nomeNovo) {
      campos.push(`<div class="campo-alterado">Nome: <strong>${textoSeguro(item.nomeAnterior || "-")}</strong> → <strong>${textoSeguro(item.nomeNovo || "-")}</strong></div>`);
    }

    if (item.localidadeAnterior !== undefined && item.localidadeAnterior !== item.localidadeNova) {
      campos.push(`<div class="campo-alterado">Localidade: <strong>${textoSeguro(item.localidadeAnterior || "-")}</strong> → <strong>${textoSeguro(item.localidadeNova || "-")}</strong></div>`);
    }

    if (item.valorOrcadoAnterior !== undefined && item.valorOrcadoAnterior !== item.valorOrcadoNovo) {
      campos.push(`<div class="campo-alterado">Orçamento: <strong>${textoSeguro(item.valorOrcadoAnterior || "-")}</strong> → <strong>${textoSeguro(item.valorOrcadoNovo || "-")}</strong></div>`);
    }

    if (item.dataInicioAnteriorFormatada !== item.dataInicioNovaFormatada) {
      campos.push(`<div class="campo-alterado">Início: <strong>${textoSeguro(item.dataInicioAnteriorFormatada || "-")}</strong> → <strong>${textoSeguro(item.dataInicioNovaFormatada || "-")}</strong></div>`);
    }

    if (item.dataFimAnteriorFormatada !== item.dataFimNovaFormatada) {
      campos.push(`<div class="campo-alterado">Término: <strong>${textoSeguro(item.dataFimAnteriorFormatada || "-")}</strong> → <strong>${textoSeguro(item.dataFimNovaFormatada || "-")}</strong></div>`);
    }

    div.innerHTML = `
      <div class="data-historico">${textoSeguro(formatarDataHora(item.alteradoEm))} — ${textoSeguro(item.alteradoPorNome || item.alteradoPorEmail || "Usuário")}</div>
      <div class="titulo-historico">Alteração no cadastro da obra</div>
      <div class="campos-historico">${campos.join("") || "<div class=\"campo-alterado\">Nenhum campo específico identificado.</div>"}</div>
      ${item.justificativa ? `<div class="justificativa-historico">"${textoSeguro(item.justificativa)}"</div>` : ""}
    `;

    listaHistorico.appendChild(div);
  });
}

/* =========================
   ORQUESTRAÇÃO
========================= */

async function carregarFichaDaObra() {
  const id = new URLSearchParams(window.location.search).get("id");

  if (!id) {
    carregandoObra.style.display = "none";
    obraNaoEncontrada.style.display = "block";
    return;
  }

  const obra = await buscarObraPorId(id);

  if (!obra) {
    carregandoObra.style.display = "none";
    obraNaoEncontrada.style.display = "block";
    return;
  }

  obraAtual = obra;
  obraAtualId = id;

  const [planejamentosBrutos, realizadosBrutos] = await Promise.all([
    buscarPorObra("planejamentoCurvaS", obra),
    buscarPorObra("realizadoCurvaS", obra)
  ]);

  // Deduplica por semana: se existir mais de um lançamento pra mesma
  // semana (ex.: sobra de um replanejamento anterior que não foi
  // limpo), fica só com o mais recente.
  const planejamentos = deduplicarPorSemana(planejamentosBrutos).sort(
    (a, b) => Number(a.semanaNumero || numeroSemana(a.semana)) - Number(b.semanaNumero || numeroSemana(b.semana))
  );

  const realizados = deduplicarPorSemana(realizadosBrutos).sort(
    (a, b) => Number(a.semanaNumero || numeroSemana(a.semana)) - Number(b.semanaNumero || numeroSemana(b.semana))
  );

  // Junta cada semana planejada com o realizado correspondente (por
  // número de semana), e inclui semanas que só têm realizado (sem
  // planejamento formal, caso raro mas possível).
  const mapaRealizadoPorSemana = new Map();

  realizados.forEach((item) => {
    const numero = Number(item.semanaNumero || numeroSemana(item.semana));
    mapaRealizadoPorSemana.set(numero, item);
  });

  const semanasFinal = planejamentos.map((planejado) => {
    const numero = Number(planejado.semanaNumero || numeroSemana(planejado.semana));
    return { planejado, realizado: mapaRealizadoPorSemana.get(numero) || null };
  });

  const semanasComPlanejamento = new Set(
    planejamentos.map((p) => Number(p.semanaNumero || numeroSemana(p.semana)))
  );

  realizados.forEach((realizado) => {
    const numero = Number(realizado.semanaNumero || numeroSemana(realizado.semana));

    if (!semanasComPlanejamento.has(numero)) {
      semanasFinal.push({ planejado: null, realizado });
    }
  });

  semanasFinal.sort((a, b) => {
    const semanaA = Number((a.planejado || a.realizado)?.semanaNumero || numeroSemana((a.planejado || a.realizado)?.semana));
    const semanaB = Number((b.planejado || b.realizado)?.semanaNumero || numeroSemana((b.planejado || b.realizado)?.semana));
    return semanaA - semanaB;
  });

  // Físico/financeiro atuais = último realizado lançado (maior semana)
  const ultimoRealizado = realizados.length ? realizados[realizados.length - 1] : null;

  const fisicoAtual = numeroBRL(ultimoRealizado?.fisicoReal || 0);
  const executado = numeroBRL(ultimoRealizado?.financeiroReal || 0);

  const orcado = numeroBRL(
    obra.investimento ?? obra.valorObra ?? obra.valorOrcado ?? obra.orcamento ?? 0
  );

  const numeroSemanaAtual = ultimoRealizado
    ? Number(ultimoRealizado.semanaNumero || numeroSemana(ultimoRealizado.semana))
    : 0;

  const planejadoDaSemanaAtual = planejamentos.find(
    (p) => Number(p.semanaNumero || numeroSemana(p.semana)) === numeroSemanaAtual
  );

  const fisicoPlanejadoAteSemana = numeroBRL(
    planejadoDaSemanaAtual?.fisicoAcum ??
    planejadoDaSemanaAtual?.fisico ??
    planejadoDaSemanaAtual?.fisicoPlanejado ??
    0
  );

  const afo = fisicoPlanejadoAteSemana > 0 ? (fisicoAtual / fisicoPlanejadoAteSemana) * 100 : 0;

  const statusFinal = calcularStatus(obra, executado, fisicoAtual);

  // Cabeçalho
  const nomeObra = obterNomeObra(obra);
  tituloObra.textContent = nomeObra;
  subtituloObra.textContent = `${obterCodigoObra(obra)} · ${obra.localidade || "-"} · ${normalizarStatus(statusFinal)}`;
  document.title = `Ficha da Obra — ${nomeObra}`;

  renderizarIdentificacao(obra, statusFinal);
  renderizarResumo(orcado, executado, fisicoAtual, afo);
  renderizarCurvaS(semanasFinal);
  renderizarAnomalias(realizados);
  renderizarHistorico(obra);

  carregandoObra.style.display = "none";
  conteudoObra.style.display = "block";
}

/* =========================
   AÇÕES DO CABEÇALHO
========================= */

function imprimirFicha() {
  const tituloAnterior = document.title;
  const nomeObra = obraAtual ? obterNomeObra(obraAtual) : "Obra";
  const codigo = obraAtual ? obterCodigoObra(obraAtual) : "";

  document.title = `Ficha da Obra - ${codigo} ${nomeObra}`.trim();

  if (relatorioMetaImpressao) {
    const geradoPor =
      obterEmailUsuario(usuarioLogadoGlobal) || "usuário não identificado";

    relatorioMetaImpressao.textContent =
      `Relatório gerado em ${new Date().toLocaleString("pt-BR")} por ${geradoPor}`;
  }

  document.body.classList.add("modo-impressao-ficha");

  window.setTimeout(() => {
    window.print();
  }, 150);

  window.setTimeout(() => {
    document.body.classList.remove("modo-impressao-ficha");
    document.title = tituloAnterior;
  }, 1500);
}

function configurarEventos() {
  btnAtualizarCurvaSObra?.addEventListener("click", () => {
    window.location.href = `atualizar-curva-s.html?obraId=${encodeURIComponent(obraAtualId)}`;
  });

  btnEditarObraDetalhe?.addEventListener("click", () => {
    window.location.href = `gestaodeobras.html?editarObraId=${encodeURIComponent(obraAtualId)}`;
  });

  btnImprimirFicha?.addEventListener("click", imprimirFicha);
}

/* =========================
   INICIALIZAÇÃO
========================= */

document.addEventListener("DOMContentLoaded", async () => {
  configurarEventos();

  let concluido = false;

  const watchdog = window.setTimeout(() => {
    if (concluido) {
      return;
    }

    console.error(
      "Ficha da obra: tempo limite atingido (15s) esperando protegerPagina()/carregamento dos dados."
    );

    carregandoObra.style.display = "none";
    obraNaoEncontrada.style.display = "block";
    obraNaoEncontrada.textContent =
      "A página demorou demais para carregar (tempo limite). Verifique sua conexão, " +
      "abra o Console (F12) para ver detalhes e tente recarregar a página.";
  }, 15000);

  try {
    const usuarioProtegido = await protegerPagina();

    if (!usuarioProtegido) {
      // protegerPagina já redirecionou a página (login inválido,
      // usuário inativo, sem permissão etc.) — não há mais nada a
      // fazer aqui.
      concluido = true;
      window.clearTimeout(watchdog);
      return;
    }

    usuarioLogadoGlobal = await carregarUsuarioCompleto(usuarioProtegido);

    exibirUsuarioLogadoNoTopo();
    aplicarVisibilidadeAdministrador();

    await carregarFichaDaObra();

    concluido = true;
    window.clearTimeout(watchdog);
  } catch (error) {
    concluido = true;
    window.clearTimeout(watchdog);

    console.error("Erro ao carregar a ficha da obra:", error);

    carregandoObra.style.display = "none";
    obraNaoEncontrada.style.display = "block";
    obraNaoEncontrada.textContent =
      "Erro ao carregar a ficha da obra. Verifique o login e tente novamente.";
  }
});