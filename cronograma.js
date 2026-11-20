/* =====================================================
   CRONOGRAMA DA OBRA
   Arquivo: cronograma.js

   Edição do cronograma de uma obra (atividades, predecessoras,
   pesos e avanço) com linha do tempo em dias úteis. Só Administrador
   e Planejador editam; os demais perfis apenas visualizam.

   Dados:
   - cronogramasObra/{obraId}          → um documento por obra
   - configuracoesSistema/calendario   → feriados e sábado útil
                                         (padrão único do sistema)
===================================================== */

import { db } from "./firebaseConfig.js";

import {
  protegerPagina,
  usuarioEhAdministrador,
  usuarioEhPlanejador
} from "./authGuard.js";

import {
  collection,
  getDocs,
  getDoc,
  setDoc,
  doc,
  runTransaction,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.3/firebase-firestore.js";

import {
  analisarData,
  paraISO,
  hojeISO,
  formatarData,
  formatarPeso,
  normalizarDataTexto,
  calcularCronograma,
  resumirCronograma,
  avancoGeral,
  criarCalendario,
  ehDiaUtil,
  proximoDiaUtil,
  somarDias,
  montarGanttHTML,
  escaparHtml
} from "./cronograma-core.js?v=004";

/* =========================================
   ESTADO
========================================= */

const COLECAO_CRONOGRAMA = "cronogramasObra";
const COLECAO_CONFIG = "configuracoesSistema";
const DOC_CALENDARIO = "calendario";
const LIMITE_ATIVIDADES = 500;

let usuarioLogado = null;
let podeEditar = false;
let obras = [];
let obrasConcluidas = new Set();
let calendario = { sabado: false, feriados: [] };
let estado = null;
let escala = "dia";
let atividadeEmEdicao = null;
let alterado = false;

const $ = (id) => document.getElementById(id);

/* =========================================
   INICIALIZAÇÃO
========================================= */

document.addEventListener("DOMContentLoaded", async () => {
  try {
    usuarioLogado = await protegerPagina();

    if (!usuarioLogado) {
      return;
    }

    podeEditar =
      usuarioEhAdministrador(usuarioLogado) ||
      usuarioEhPlanejador(usuarioLogado);

    $("btnCalendario").hidden = !podeEditar;
    $("btnAtividade").hidden = !podeEditar;
    $("btnSalvar").hidden = !podeEditar;
    $("btnGerarCurvaS").hidden = !podeEditar;

    configurarEventos();

    await Promise.all([carregarCalendario(), carregarObras(), carregarCronogramasConcluidos()]);

    preencherLocalidades();
    preencherObras(new URLSearchParams(window.location.search).get("obraId") || "");

    const obraIdUrl = new URLSearchParams(window.location.search).get("obraId");

    if (obraIdUrl && obras.some((obra) => obra.docId === obraIdUrl)) {
      selecionarLocalidadeDaObra(obraIdUrl);
      preencherObras(obraIdUrl);
      $("selectObra").value = obraIdUrl;
      await abrirObra(obraIdUrl);
    } else {
      atualizarTela();
    }
  } catch (erro) {
    console.error("Erro ao iniciar o cronograma:", erro);
    alert("Erro ao iniciar a tela de cronograma.");
  }
});

window.addEventListener("beforeunload", (evento) => {
  if (alterado) {
    evento.preventDefault();
    evento.returnValue = "";
  }
});

/* =========================================
   DADOS
========================================= */

function obterNomeObra(obra) {
  return String(
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
  ).trim();
}

function obterIdObra(obra) {
  return String(
    obra.idProjeto || obra.idObra || obra.codigoObra || obra.codigo || ""
  ).trim();
}

function dataDaObraParaISO(valor) {
  if (!valor) {
    return "";
  }

  if (valor?.toDate) {
    const data = valor.toDate();
    const mes = String(data.getMonth() + 1).padStart(2, "0");
    const dia = String(data.getDate()).padStart(2, "0");

    return `${data.getFullYear()}-${mes}-${dia}`;
  }

  try {
    return normalizarDataTexto(String(valor).slice(0, 10));
  } catch {
    return "";
  }
}

// Data Início/Data Fim cadastradas da obra (mesma referência mostrada
// no cadastro e usada como prazo do cronograma) — só pra exibir,
// mesmo fallback de campos usado no resto do sistema.
function obterPrazoObra(obra) {
  return {
    inicioISO: dataDaObraParaISO(
      obra?.dataInicio || obra?.dataInicioPrevisto || obra?.dataInicioObra
    ),
    fimISO: dataDaObraParaISO(
      obra?.dataFim || obra?.dataTerminoPrevisto || obra?.dataFimPrevisto || obra?.dataFimObra
    )
  };
}

async function carregarObras() {
  try {
    const snap = await getDocs(collection(db, "obras"));

    obras = snap.docs
      .map((documento) => ({ docId: documento.id, ...documento.data() }))
      .sort((a, b) => obterNomeObra(a).localeCompare(obterNomeObra(b), "pt-BR"));
  } catch (erro) {
    console.error("Erro ao carregar obras:", erro);
    $("selectObra").innerHTML = `<option value="">Erro ao carregar obras</option>`;
  }
}

// Cronograma 100% executado = avanço geral (ponderado pelo peso) em
// 100%. Essas obras saem da lista de seleção.
async function carregarCronogramasConcluidos() {
  try {
    const snap = await getDocs(collection(db, COLECAO_CRONOGRAMA));

    obrasConcluidas = new Set(
      snap.docs
        .filter((documento) => {
          const tarefas = Array.isArray(documento.data().tasks)
            ? documento.data().tasks.map(sanitizarAtividade)
            : [];

          return tarefas.length > 0 && avancoGeral({ tasks: tarefas }) >= 99.999;
        })
        .map((documento) => documento.id)
    );
  } catch (erro) {
    console.warn("Não foi possível verificar os cronogramas concluídos:", erro);
    obrasConcluidas = new Set();
  }
}

function preencherLocalidades() {
  const select = $("selectLocalidade");

  const localidades = [...new Set(
    obras.map((obra) => String(obra.localidade || "").trim()).filter(Boolean)
  )].sort((a, b) => a.localeCompare(b, "pt-BR"));

  select.innerHTML = `<option value="">Todas</option>`;

  localidades.forEach((localidade) => {
    const option = document.createElement("option");
    option.value = localidade;
    option.textContent = localidade;
    select.appendChild(option);
  });
}

function selecionarLocalidadeDaObra(obraId) {
  const obra = obras.find((item) => item.docId === obraId);
  const localidade = String(obra?.localidade || "").trim();
  const select = $("selectLocalidade");

  if (localidade && [...select.options].some((o) => o.value === localidade)) {
    select.value = localidade;
  }
}

// A obra atualmente selecionada (ou a pedida na URL) continua na lista
// mesmo que o cronograma dela esteja 100% executado.
function preencherObras(obraIdManter = "") {
  const select = $("selectObra");
  const localidade = $("selectLocalidade").value;
  const mostrarConcluidos = $("mostrarConcluidos").checked;
  const manter = obraIdManter || estado?.obraId || "";

  select.innerHTML = `<option value="">Selecione a obra...</option>`;

  obras
    .filter((obra) => !localidade || String(obra.localidade || "").trim() === localidade)
    .filter((obra) =>
      mostrarConcluidos || obra.docId === manter || !obrasConcluidas.has(obra.docId)
    )
    .forEach((obra) => {
      const option = document.createElement("option");
      const codigo = obterIdObra(obra);

      option.value = obra.docId;
      option.textContent = codigo
        ? `${codigo} — ${obterNomeObra(obra)}`
        : obterNomeObra(obra);

      select.appendChild(option);
    });

  select.value = [...select.options].some((o) => o.value === manter) ? manter : "";
}

async function carregarCalendario() {
  try {
    const snap = await getDoc(doc(db, COLECAO_CONFIG, DOC_CALENDARIO));

    if (snap.exists()) {
      const dados = snap.data();

      calendario = {
        sabado: Boolean(dados.sabado),
        feriados: Array.isArray(dados.feriados) ? dados.feriados : []
      };
    }
  } catch (erro) {
    console.warn("Não foi possível carregar o calendário padrão:", erro);
  }
}

function sanitizarAtividade(bruta) {
  return {
    id: String(bruta?.id || ""),
    name: String(bruta?.name || "").slice(0, 90),
    duration: Math.max(1, Math.min(1000, Math.round(Number(bruta?.duration) || 1))),
    peso: Math.max(0, Math.min(100, Number(bruta?.peso) || 0)),
    progress: Math.max(0, Math.min(100, Math.round(Number(bruta?.progress) || 0))),
    dependency: String(bruta?.dependency || ""),
    earliest: String(bruta?.earliest || "")
  };
}

async function abrirObra(obraId) {
  const obra = obras.find((item) => item.docId === obraId);

  if (!obra) {
    estado = null;
    alterado = false;
    atualizarTela();
    return;
  }

  try {
    const snap = await getDoc(doc(db, COLECAO_CRONOGRAMA, obraId));

    if (snap.exists()) {
      const dados = snap.data();

      estado = {
        obraId,
        obraNome: obterNomeObra(obra),
        versao: Number(dados.versao || 0),
        existe: true,
        inicio: dados.inicio || dataDaObraParaISO(obra.dataInicioPrevisto) || hojeISO(),
        tasks: Array.isArray(dados.tasks) ? dados.tasks.map(sanitizarAtividade) : [],
        sabados: sanitizarSabados(dados.sabados)
      };
    } else {
      estado = {
        obraId,
        obraNome: obterNomeObra(obra),
        versao: 0,
        existe: false,
        inicio: dataDaObraParaISO(obra.dataInicioPrevisto) || hojeISO(),
        tasks: [],
        sabados: []
      };
    }

    // A data-base pode ter vindo do cadastro da obra (sem validação de
    // fim de semana) ou de um cronograma salvo antes desta regra
    // existir — corrige em silêncio, sem marcar como alterado.
    estado.inicio = snapDiaUtilSemPerguntar(estado.inicio);

    alterado = false;
    atualizarTela();
  } catch (erro) {
    console.error("Erro ao carregar o cronograma:", erro);
    estado = null;
    atualizarTela();
    avisar("Não foi possível carregar o cronograma desta obra.");
  }
}

/* =========================================
   TELA
========================================= */

function atualizarTela() {
  const gantt = $("gantt");

  $("inicioObra").disabled = !podeEditar || !estado;
  $("btnAtividade").disabled = !podeEditar || !estado;
  $("btnSalvar").disabled = !podeEditar || !estado || !alterado;
  $("btnGerarCurvaS").disabled =
    !podeEditar || !estado || alterado || !estado.existe || estado.tasks.length === 0;
  $("btnSalvar").classList.toggle("pendente-salvar", alterado);

  if (!estado) {
    $("inicioObra").value = "";
    $("resumoAtividades").textContent = "0";
    $("resumoConclusao").textContent = "—";
    $("resumoDiasUteis").textContent = "0";
    $("resumoPesos").textContent = "0%";
    $("resumoAvanco").textContent = "0%";
    $("cardPesos").classList.remove("alerta");
    $("textoPeriodo").textContent =
      "As datas são recalculadas ao editar atividades ou predecessoras.";
    $("dicaCronograma").textContent =
      "Selecione uma obra para ver ou montar o cronograma.";

    gantt.innerHTML = `<div class="cr-vazio"><strong>Nenhuma obra selecionada</strong>Escolha uma obra acima.</div>`;
    return;
  }

  $("inicioObra").value = estado.inicio;

  let resumo;

  try {
    resumo = resumirCronograma(estado, calendario, calcularCronograma(estado, calendario));
  } catch {
    resumo = resumirCronograma({ ...estado, tasks: [] }, calendario, new Map());
  }

  $("resumoAtividades").textContent = String(resumo.quantidade);
  $("resumoConclusao").textContent = resumo.ultimo ? formatarData(resumo.ultimo) : "—";
  $("resumoDiasUteis").textContent = String(resumo.diasUteis);
  $("resumoPesos").textContent = formatarPeso(resumo.somaPesos);
  $("resumoAvanco").textContent = `${Math.round(resumo.avanco)}%`;

  const pesosFora = estado.tasks.length > 0 && Math.abs(resumo.somaPesos - 100) > 0.01;

  $("cardPesos").classList.toggle("alerta", pesosFora);

  $("textoPeriodo").textContent = resumo.quantidade
    ? `${formatarData(resumo.primeiro)} a ${formatarData(resumo.ultimo)} · ${resumo.diasCorridos} dias corridos`
    : "Adicione a primeira atividade para começar.";

  $("dicaCronograma").textContent = montarDica(pesosFora, resumo.somaPesos);

  gantt.innerHTML = montarGanttHTML(estado, calendario, {
    escala,
    editavel: podeEditar,
    vazioTitulo: "O cronograma desta obra está vazio",
    vazioTexto: podeEditar
      ? " Clique em “Atividade” para começar a planejar."
      : " Ainda não há cronograma cadastrado para esta obra."
  });
}

function montarDica(pesosFora, soma) {
  const partes = [];

  if (!podeEditar) {
    partes.push("Somente visualização — apenas Administrador e Planejador editam o cronograma.");
  } else if (alterado) {
    partes.push("Há alterações não salvas — clique em “Salvar cronograma”.");
  } else if (!estado.existe) {
    partes.push("Esta obra ainda não tem cronograma salvo.");
  } else {
    partes.push("Cronograma salvo.");
  }

  if (pesosFora) {
    partes.push(`A soma dos pesos está em ${formatarPeso(soma)} — o ideal é 100%.`);
  }

  return partes.join(" ");
}

function marcarAlterado() {
  alterado = true;
  atualizarTela();
}

let temporizadorAviso = null;

function avisar(mensagem) {
  const toast = $("toast");

  toast.textContent = mensagem;
  toast.classList.add("visivel");

  clearTimeout(temporizadorAviso);
  temporizadorAviso = setTimeout(() => toast.classList.remove("visivel"), 3200);
}

/* =========================================
   EVENTOS
========================================= */

function configurarEventos() {
  $("selectObra").addEventListener("change", async (evento) => {
    const novoId = evento.target.value;

    if (alterado && !confirm("Há alterações não salvas neste cronograma. Trocar de obra e descartá-las?")) {
      evento.target.value = estado?.obraId || "";
      return;
    }

    alterado = false;
    await abrirObra(novoId);
    preencherObras();
  });

  $("selectLocalidade").addEventListener("change", () => {
    const obraAtual = obras.find((obra) => obra.docId === estado?.obraId);
    const localidade = $("selectLocalidade").value;
    const saiDaLista =
      obraAtual && localidade && String(obraAtual.localidade || "").trim() !== localidade;

    if (saiDaLista) {
      if (alterado && !confirm("Há alterações não salvas neste cronograma. Trocar de Localidade e descartá-las?")) {
        selecionarLocalidadeDaObra(obraAtual.docId);
        return;
      }

      estado = null;
      alterado = false;
      atualizarTela();
    }

    preencherObras();
  });

  $("mostrarConcluidos").addEventListener("change", () => preencherObras());

  $("inicioObra").addEventListener("change", (evento) => {
    try {
      analisarData(evento.target.value);
    } catch (erro) {
      avisar(erro.message);
      evento.target.value = estado.inicio;
      return;
    }

    const resultado = ajustarInicioCronograma(evento.target.value);

    estado.inicio = resultado.iso;
    evento.target.value = resultado.iso;

    if (resultado.aviso) {
      avisar(resultado.aviso);
    }

    marcarAlterado();
  });

  $("escalaDia").addEventListener("click", () => definirEscala("dia"));
  $("escalaSemana").addEventListener("click", () => definirEscala("semana"));

  $("btnAtividade").addEventListener("click", () => abrirAtividade());
  $("btnSalvar").addEventListener("click", salvarCronograma);
  $("btnGerarCurvaS").addEventListener("click", gerarCurvaS);
  $("btnCsv").addEventListener("click", exportarCsv);
  $("btnImprimir").addEventListener("click", () => window.print());

  $("gantt").addEventListener("click", (evento) => {
    const editar = evento.target.closest("[data-cr-editar]");
    const excluir = evento.target.closest("[data-cr-excluir]");

    if (editar) {
      abrirAtividade(editar.dataset.crEditar);
    }

    if (excluir) {
      excluirAtividade(excluir.dataset.crExcluir);
    }
  });

  $("fecharAtividade").addEventListener("click", () => $("dialogoAtividade").close());
  $("cancelarAtividade").addEventListener("click", () => $("dialogoAtividade").close());
  $("formAtividade").addEventListener("submit", salvarAtividade);

  $("atividadePeso").addEventListener("input", () => {
    const maximo = pesoDisponivel();

    if (Number($("atividadePeso").value) > maximo) {
      $("atividadePeso").value = maximo;
    }

    atualizarGuiaAtividade();
  });

  $("atividadeDuracao").addEventListener("input", () => recalcularDatas("duracao"));
  $("atividadePredecessora").addEventListener("change", () => recalcularDatas("predecessora"));

  $("atividadeInicio").addEventListener("change", aoAlterarInicio);

  $("dialogoAtividade").addEventListener("close", () => {
    // Fechou sem salvar: descarta os sábados confirmados durante a edição.
    if (!atividadeSalva && estado) {
      estado.sabados = sabadosAoAbrir;
    }
  });

  $("atividadeFim").addEventListener("change", aoAlterarFim);

  $("btnCalendario").addEventListener("click", abrirCalendario);
  $("fecharCalendario").addEventListener("click", () => $("dialogoCalendario").close());
  $("cancelarCalendario").addEventListener("click", () => $("dialogoCalendario").close());
  $("salvarCalendario").addEventListener("click", salvarCalendario);
}

function definirEscala(nova) {
  escala = nova;
  $("escalaDia").classList.toggle("ativo", nova === "dia");
  $("escalaSemana").classList.toggle("ativo", nova === "semana");
  atualizarTela();
}

/* =========================================
   ATIVIDADES
========================================= */

function mostrarErro(elemento, mensagem) {
  elemento.textContent = mensagem;
  elemento.classList.add("visivel");
}

function abrirAtividade(id = null) {
  if (!estado || !podeEditar) {
    return;
  }

  atividadeEmEdicao = id;
  sabadosAoAbrir = [...(estado.sabados || [])];
  atividadeSalva = false;

  const atividade = estado.tasks.find((t) => t.id === id);
  $("tituloAtividade").textContent = atividade ? "Editar atividade" : "Nova atividade";
  $("atividadeNome").value = atividade?.name || "";
  $("atividadeDuracao").value = atividade?.duration ?? 5;
  $("atividadePeso").value = atividade ? atividade.peso : 0;
  $("atividadePeso").max = String(pesoDisponivel());
  $("atividadeAvanco").value = atividade?.progress ?? 0;
  inicioDigitado = atividade?.earliest || "";

  const prazoObra = obterPrazoObra(obras.find((o) => o.docId === estado.obraId));

  $("guiaPrazoObra").textContent =
    prazoObra.inicioISO && prazoObra.fimISO
      ? `${dataCurta(analisarData(prazoObra.inicioISO))} a ${dataCurta(analisarData(prazoObra.fimISO))}`
      : "Não cadastrado";

  $("atividadePredecessora").innerHTML =
    `<option value="">Sem predecessora</option>` +
    estado.tasks
      .filter((t) => t.id !== id)
      .map((t) => `<option value="${escaparHtml(t.id)}">${escaparHtml(t.name)}</option>`)
      .join("");

  // Nova atividade já vem encadeada após a última cadastrada (dá pra
  // trocar por "Sem predecessora" pra iniciar em paralelo).
  const ultima = estado.tasks[estado.tasks.length - 1];

  $("atividadePredecessora").value = atividade
    ? atividade.dependency || ""
    : ultima?.id || "";

  $("dicaPredecessora").textContent =
    estado.tasks.filter((t) => t.id !== id).length === 0
      ? "Esta é a primeira atividade. Salve-a e, nas próximas, escolha aqui a que precisa terminar antes."
      : "A atividade começa no próximo dia útil após o fim da predecessora. Escolha “Sem predecessora” para iniciar em paralelo.";

  $("erroAtividade").classList.remove("visivel");
  atualizarGuiaAtividade();
  recalcularDatas();

  $("dialogoAtividade").showModal();
  $("atividadeNome").focus();
}

function dataCurta(data) {
  return data.toLocaleDateString("pt-BR", { timeZone: "UTC" });
}

function arredondar2(valor) {
  return Math.round(valor * 100) / 100;
}

function pesoDeOutras() {
  return estado.tasks
    .filter((t) => t.id !== atividadeEmEdicao)
    .reduce((total, t) => total + Number(t.peso || 0), 0);
}

// Quanto ainda cabe de peso pra esta atividade (teto: 100% na obra).
function pesoDisponivel() {
  return arredondar2(Math.max(0, 100 - pesoDeOutras()));
}

function diasUteisApos(dataBase, dataFinal) {
  const cal = criarCalendario(calendario, estado.sabados);
  let dias = 0;

  for (let dia = somarDias(dataBase, 1); dia <= dataFinal; dia = somarDias(dia, 1)) {
    if (ehDiaUtil(dia, cal)) {
      dias++;
    }
  }

  return dias;
}

function definirGuia(idValor, texto, classe = "") {
  const elemento = $(idValor);

  elemento.textContent = texto;
  elemento.className = `guia-valor ${classe}`.trim();
}

function atualizarGuiaAtividade() {
  if (!estado) {
    return;
  }

  const outros = pesoDeOutras();
  const digitado = Number($("atividadePeso").value) || 0;
  const distribuido = arredondar2(outros + digitado);
  const restante = arredondar2(100 - distribuido);

  definirGuia(
    "guiaPeso",
    `${formatarPeso(distribuido)} de 100%`,
    restante < 0 ? "erro" : restante === 0 ? "ok" : ""
  );

  $("guiaPesoBarra").style.width = `${Math.min(100, distribuido)}%`;
  $("guiaPesoBarra").classList.toggle("excedeu", restante < 0);
  $("guiaPesoDetalhe").textContent =
    restante < 0
      ? `Excedeu ${formatarPeso(-restante)}`
      : `Restam ${formatarPeso(restante)} · outras atividades: ${formatarPeso(outros)}`;
}

/* ---- datas da atividade (Início / Fim / Duração) ---- */

// Início digitado pelo usuário (vira "início mínimo" da atividade). Só
// vale se for depois do início natural (o que a predecessora ou o
// início do cronograma já determinam); caso contrário fica vazio pra a
// atividade continuar acompanhando as predecessoras sozinha.
let inicioDigitado = "";

function simularAtividade(duracao, dependencia, inicioMinimo) {
  const candidata = {
    id: atividadeEmEdicao || "__nova__",
    name: "",
    duration: duracao,
    peso: 0,
    progress: 0,
    dependency: dependencia,
    earliest: inicioMinimo
  };

  const simulado = {
    inicio: estado.inicio,
    sabados: estado.sabados,
    tasks: atividadeEmEdicao
      ? estado.tasks.map((t) => (t.id === atividadeEmEdicao ? candidata : t))
      : [...estado.tasks, candidata]
  };

  const datas = calcularCronograma(simulado, calendario);

  return { item: datas.get(candidata.id), simulado, datas };
}

function definirDicaDatas(texto, aviso = false) {
  const elemento = $("dicaDatas");

  elemento.textContent = texto;
  elemento.classList.toggle("aviso", aviso);
}

const DICA_DATAS_PADRAO =
  "O início e o fim são calculados pela predecessora e pela duração. Alterar o Início define “não começa antes de”; alterar o Fim recalcula a duração em dias úteis.";

function recalcularDatas(origem = "", avisoExterno = "") {
  if (!estado) {
    return;
  }

  const duracao = Number($("atividadeDuracao").value);

  if (!Number.isInteger(duracao) || duracao < 1) {
    $("atividadeFim").value = "";
    definirGuia("guiaPrazo", "—");
    $("guiaPrazoDetalhe").textContent = "Informe a duração em dias úteis.";
    return;
  }

  const dependencia = $("atividadePredecessora").value;
  let aviso = avisoExterno;

  try {
    const natural = simularAtividade(duracao, dependencia, "").item.inicio;
    const naturalISO = paraISO(natural);

    if (inicioDigitado && inicioDigitado <= naturalISO) {
      if (origem === "inicio" && inicioDigitado < naturalISO) {
        aviso = `Início ajustado para ${dataCurta(natural)}: a atividade não pode começar antes do início do cronograma nem antes do fim da predecessora.`;
      }

      inicioDigitado = "";
    }

    const { item, simulado, datas } = simularAtividade(duracao, dependencia, inicioDigitado);
    const resumo = resumirCronograma(simulado, calendario, datas);

    $("atividadeInicio").value = paraISO(item.inicio);
    $("atividadeFim").value = paraISO(item.fim);

    definirDicaDatas(aviso || DICA_DATAS_PADRAO, Boolean(aviso));

    const obra = obras.find((o) => o.docId === estado.obraId);
    const prazoISO = obterPrazoObra(obra).fimISO;

    let detalhe = `${resumo.diasUteis} dias úteis no total`;
    let classe = "";

    if (prazoISO) {
      const prazo = analisarData(prazoISO);

      if (resumo.ultimo > prazo) {
        classe = "erro";
        detalhe += ` · ${diasUteisApos(prazo, resumo.ultimo)} dias úteis além do prazo da obra (${dataCurta(prazo)})`;
      } else {
        classe = "ok";
        detalhe += ` · dentro do prazo da obra (${dataCurta(prazo)})`;
      }
    }

    definirGuia("guiaPrazo", dataCurta(resumo.ultimo), classe);
    $("guiaPrazoDetalhe").textContent = detalhe;
  } catch (falha) {
    $("atividadeFim").value = "";
    definirDicaDatas(falha.message, true);
    definirGuia("guiaPrazo", "—");
    $("guiaPrazoDetalhe").textContent = "";
  }
}

let sabadosAoAbrir = [];
let atividadeSalva = false;

function sanitizarSabados(lista) {
  if (!Array.isArray(lista)) {
    return [];
  }

  return [...new Set(lista)].filter((iso) => {
    try {
      return analisarData(iso).getUTCDay() === 6;
    } catch {
      return false;
    }
  });
}

// Só ficam gravados os sábados que realmente caem dentro de alguma
// atividade — evita "sábados fantasmas" mudando o cronograma depois.
function podarSabadosExtras() {
  if (!estado.sabados?.length) {
    return;
  }

  const intervalos = [...calcularCronograma(estado, calendario).values()].map((item) => [
    paraISO(item.inicio),
    paraISO(item.fim)
  ]);

  estado.sabados = estado.sabados.filter((iso) =>
    intervalos.some(([inicio, fim]) => iso >= inicio && iso <= fim)
  );
}

// Sábado fora do calendário: pergunta se a obra vai trabalhar. Sim →
// esse sábado vira dia útil no cronograma da obra. Domingo nunca.
// Ajusta silenciosamente uma data pro dia útil mais próximo, sem
// perguntar nada — usado só ao abrir/criar o cronograma (a data-base
// da obra pode ter sido cadastrada num fim de semana sem essa
// validação existir no cadastro).
function snapDiaUtilSemPerguntar(iso) {
  try {
    return paraISO(
      proximoDiaUtil(analisarData(iso), criarCalendario(calendario, estado?.sabados || []))
    );
  } catch {
    return iso;
  }
}

// Mesma regra de sábado/domingo usada no diálogo de atividade,
// aplicada à data-base do cronograma (Início do cronograma) quando o
// usuário a edita manualmente.
function ajustarInicioCronograma(iso) {
  let data;

  try {
    data = analisarData(iso);
  } catch {
    return { iso, aviso: "" };
  }

  const cal = criarCalendario(calendario, estado.sabados);

  if (ehDiaUtil(data, cal)) {
    return { iso, aviso: "" };
  }

  if (data.getUTCDay() === 0) {
    return {
      iso: snapDiaUtilSemPerguntar(iso),
      aviso: "Domingo nunca é dia de trabalho — o início foi movido para o próximo dia útil."
    };
  }

  if (confirmarSabado(data)) {
    return { iso, aviso: "" };
  }

  return { iso: snapDiaUtilSemPerguntar(iso), aviso: "O início foi movido para o próximo dia útil." };
}

function confirmarSabado(data) {
  const cal = criarCalendario(calendario, estado.sabados);
  const iso = paraISO(data);

  if (data.getUTCDay() !== 6 || ehDiaUtil(data, cal) || cal.feriados.has(iso)) {
    return false;
  }

  const trabalha = confirm(
    `${dataCurta(data)} é um sábado. Vai trabalhar neste sábado?\n\n` +
    "OK: sim, esse sábado passa a ser dia útil neste cronograma.\n" +
    "Cancelar: não, a data é ajustada para o dia útil mais próximo."
  );

  if (trabalha) {
    estado.sabados = [...new Set([...(estado.sabados || []), iso])];
  }

  return trabalha;
}

function aoAlterarInicio() {
  const iso = $("atividadeInicio").value;

  inicioDigitado = iso;

  let aviso = "";

  if (iso) {
    let data = null;

    try {
      data = analisarData(iso);
    } catch {
      data = null;
    }

    if (data && !ehDiaUtil(data, criarCalendario(calendario, estado.sabados))) {
      if (data.getUTCDay() === 0) {
        aviso = "Domingo nunca é dia de trabalho — o início foi movido para o próximo dia útil.";
      } else if (confirmarSabado(data)) {
        recalcularDatas("inicio");
        return;
      } else {
        aviso = "O início foi movido para o próximo dia útil.";
      }

      inicioDigitado = paraISO(
        proximoDiaUtil(data, criarCalendario(calendario, estado.sabados))
      );
    }
  }

  recalcularDatas("inicio", aviso);
}

// Fim digitado → recalcula a duração (dias úteis entre o início e o fim).
function aoAlterarFim() {
  const fimISO = $("atividadeFim").value;
  const inicioISO = $("atividadeInicio").value;

  if (!fimISO || !inicioISO) {
    recalcularDatas();
    return;
  }

  let inicio;
  let fim;

  try {
    inicio = analisarData(inicioISO);
    fim = analisarData(fimISO);
  } catch {
    recalcularDatas();
    return;
  }

  if (fim < inicio) {
    recalcularDatas("", "O fim não pode ser anterior ao início.");
    return;
  }

  let avisoDomingo = "";

  if (!ehDiaUtil(fim, criarCalendario(calendario, estado.sabados))) {
    if (fim.getUTCDay() === 0) {
      avisoDomingo = "Domingo nunca é dia de trabalho.";
    } else {
      confirmarSabado(fim);
    }
  }

  const cal = criarCalendario(calendario, estado.sabados);
  let dias = 0;

  for (let dia = inicio; dia <= fim; dia = somarDias(dia, 1)) {
    if (ehDiaUtil(dia, cal)) {
      dias++;
    }
  }

  if (dias < 1) {
    recalcularDatas("", "Não há dia útil entre o início e o fim informados.");
    return;
  }

  if (dias > 1000) {
    recalcularDatas("", "A duração máxima é de 1000 dias úteis.");
    return;
  }

  $("atividadeDuracao").value = String(dias);

  recalcularDatas("fim");

  if ($("atividadeFim").value !== fimISO) {
    definirDicaDatas(
      `${avisoDomingo ? `${avisoDomingo} ` : ""}Fim ajustado para ${dataCurta(analisarData($("atividadeFim").value))} (último dia útil). Duração: ${dias} ${dias === 1 ? "dia útil" : "dias úteis"}.`,
      true
    );
  }
}

function salvarAtividade(evento) {
  evento.preventDefault();

  const erro = $("erroAtividade");

  const tarefa = {
    id: atividadeEmEdicao || `a${crypto.randomUUID()}`,
    name: $("atividadeNome").value.trim(),
    duration: Number($("atividadeDuracao").value),
    peso: Number($("atividadePeso").value),
    progress: Number($("atividadeAvanco").value),
    dependency: $("atividadePredecessora").value,
    earliest: inicioDigitado
  };

  if (
    !tarefa.name ||
    !Number.isInteger(tarefa.duration) || tarefa.duration < 1 || tarefa.duration > 1000 ||
    !Number.isFinite(tarefa.peso) || tarefa.peso < 0 || tarefa.peso > 100 ||
    !Number.isInteger(tarefa.progress) || tarefa.progress < 0 || tarefa.progress > 100
  ) {
    mostrarErro(erro, "Preencha o nome, a duração (1 a 1000), o peso (0 a 100) e o avanço (0 a 100).");
    return;
  }

  if (tarefa.peso > pesoDisponivel() + 0.001) {
    mostrarErro(
      erro,
      `O peso máximo disponível para esta atividade é ${formatarPeso(pesoDisponivel())} — o total da obra não pode passar de 100%.`
    );
    return;
  }

  if (!atividadeEmEdicao && estado.tasks.length >= LIMITE_ATIVIDADES) {
    mostrarErro(erro, `O limite é de ${LIMITE_ATIVIDADES} atividades por obra.`);
    return;
  }

  if (tarefa.earliest) {
    try {
      analisarData(tarefa.earliest);
    } catch (falha) {
      mostrarErro(erro, falha.message);
      return;
    }
  }

  const anteriores = estado.tasks;

  estado.tasks = atividadeEmEdicao
    ? anteriores.map((t) => (t.id === atividadeEmEdicao ? tarefa : t))
    : [...anteriores, tarefa];

  try {
    calcularCronograma(estado, calendario);
  } catch (falha) {
    estado.tasks = anteriores;
    mostrarErro(erro, falha.message);
    return;
  }

  atividadeSalva = true;
  $("dialogoAtividade").close();
  marcarAlterado();
  avisar("Atividade salva. Lembre-se de salvar o cronograma.");
}

function excluirAtividade(id) {
  const tarefa = estado.tasks.find((t) => t.id === id);

  if (!tarefa) {
    return;
  }

  const dependentes = estado.tasks.filter((t) => t.dependency === id);

  const mensagem =
    `Excluir “${tarefa.name}”?` +
    (dependentes.length
      ? " As atividades que dependem dela ficarão sem predecessora."
      : "");

  if (!confirm(mensagem)) {
    return;
  }

  estado.tasks = estado.tasks
    .filter((t) => t.id !== id)
    .map((t) => (t.dependency === id ? { ...t, dependency: "" } : t));

  marcarAlterado();
  avisar("Atividade excluída. Lembre-se de salvar o cronograma.");
}

/* =========================================
   SALVAR
========================================= */

async function gravarCronograma(referencia, forcar) {
  const tarefas = estado.tasks.map((t) => ({
    id: t.id,
    name: t.name,
    duration: t.duration,
    peso: t.peso,
    progress: t.progress,
    dependency: t.dependency,
    earliest: t.earliest
  }));

  return runTransaction(db, async (transacao) => {
    const atual = await transacao.get(referencia);
    const versaoAtual = atual.exists() ? Number(atual.data().versao || 0) : 0;

    if (!forcar && versaoAtual !== estado.versao) {
      const conflito = new Error("conflito");
      conflito.conflito = true;
      throw conflito;
    }

    const novaVersao = versaoAtual + 1;

    transacao.set(referencia, {
      obraId: estado.obraId,
      obraNome: estado.obraNome,
      inicio: estado.inicio,
      sabados: estado.sabados || [],
      tasks: tarefas,
      versao: novaVersao,
      criadoEm: atual.exists()
        ? (atual.data().criadoEm || serverTimestamp())
        : serverTimestamp(),
      atualizadoEm: serverTimestamp(),
      atualizadoPorUid: usuarioLogado?.uid || "",
      atualizadoPorEmail: usuarioLogado?.email || usuarioLogado?.emailAuth || "",
      atualizadoPorNome: usuarioLogado?.nome || ""
    });

    return novaVersao;
  });
}

async function salvarCronograma() {
  if (!estado || !podeEditar || !alterado) {
    return;
  }

  try {
    calcularCronograma(estado, calendario);
  } catch (erro) {
    avisar(erro.message);
    return;
  }

  podarSabadosExtras();

  const referencia = doc(db, COLECAO_CRONOGRAMA, estado.obraId);
  const botao = $("btnSalvar");

  botao.disabled = true;

  try {
    let novaVersao;

    try {
      novaVersao = await gravarCronograma(referencia, false);
    } catch (erro) {
      if (!erro.conflito) {
        throw erro;
      }

      const sobrescrever = confirm(
        "Outra pessoa salvou este cronograma depois que você o abriu. Sobrescrever com a sua versão?"
      );

      if (!sobrescrever) {
        avisar("Nada foi salvo. Reabra a obra para ver a versão mais recente.");
        botao.disabled = false;
        return;
      }

      novaVersao = await gravarCronograma(referencia, true);
    }

    estado.versao = novaVersao;
    estado.existe = true;
    alterado = false;

    if (estado.tasks.length > 0 && avancoGeral(estado) >= 99.999) {
      obrasConcluidas.add(estado.obraId);
    } else {
      obrasConcluidas.delete(estado.obraId);
    }
    atualizarTela();
    avisar("Cronograma salvo.");
  } catch (erro) {
    console.error("Erro ao salvar o cronograma:", erro);
    alert("Erro ao salvar o cronograma. Verifique suas permissões.");
    botao.disabled = false;
  }
}

/* =========================================
   GERAR CURVA S PLANEJADA
   Abre o Planejamento da Obra já preenchido com o cronograma salvo.
========================================= */

function gerarCurvaS() {
  if (!estado || !podeEditar || alterado || !estado.existe) {
    return;
  }

  const obra = obras.find((item) => item.docId === estado.obraId);

  const jaTemCurva =
    obra?.planejamentoCurvaSAtivo === true &&
    !obra?.replanejamentoNecessario;

  if (
    jaTemCurva &&
    !confirm(
      "Esta obra já tem Curva S planejada. Gerar uma nova vai SUBSTITUIR o planejamento atual (o anterior fica no histórico como substituído) e muda a linha de base usada no AFO e no SLA. Continuar?"
    )
  ) {
    return;
  }

  window.location.href =
    `planejamento.html?obraId=${encodeURIComponent(estado.obraId)}&origem=cronograma`;
}

/* =========================================
   CALENDÁRIO PADRÃO
========================================= */

function abrirCalendario() {
  $("calendarioSabado").checked = calendario.sabado;
  $("calendarioFeriados").value = calendario.feriados.join("\n");
  $("erroCalendario").classList.remove("visivel");
  $("dialogoCalendario").showModal();
}

async function salvarCalendario() {
  const erro = $("erroCalendario");

  let feriados;

  try {
    feriados = [...new Set(
      $("calendarioFeriados").value
        .split(/[\n,;]+/)
        .map((linha) => linha.trim())
        .filter(Boolean)
        .map(normalizarDataTexto)
    )].sort();
  } catch (falha) {
    mostrarErro(erro, falha.message);
    return;
  }

  const novo = {
    sabado: $("calendarioSabado").checked,
    feriados
  };

  try {
    await setDoc(doc(db, COLECAO_CONFIG, DOC_CALENDARIO), {
      ...novo,
      atualizadoEm: serverTimestamp(),
      atualizadoPorUid: usuarioLogado?.uid || "",
      atualizadoPorEmail: usuarioLogado?.email || usuarioLogado?.emailAuth || ""
    });

    calendario = novo;
    $("dialogoCalendario").close();
    atualizarTela();
    avisar("Calendário padrão atualizado.");
  } catch (falha) {
    console.error("Erro ao salvar o calendário:", falha);
    mostrarErro(erro, "Não foi possível salvar o calendário. Verifique suas permissões.");
  }
}

/* =========================================
   EXPORTAR
========================================= */

function baixarArquivo(nome, tipo, conteudo) {
  const url = URL.createObjectURL(new Blob([conteudo], { type: tipo }));
  const link = document.createElement("a");

  link.href = url;
  link.download = nome;
  document.body.append(link);
  link.click();
  link.remove();

  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function exportarCsv() {
  if (!estado || !estado.tasks.length) {
    avisar("Não há atividades para exportar.");
    return;
  }

  let datas;

  try {
    datas = calcularCronograma(estado, calendario);
  } catch (erro) {
    avisar(erro.message);
    return;
  }

  const linhas = [
    ["Nº", "Atividade", "Duração (dias úteis)", "Início", "Fim", "Predecessora", "Peso (%)", "Avanço (%)"],
    ...estado.tasks.map((t, i) => [
      i + 1,
      t.name,
      t.duration,
      paraISO(datas.get(t.id).inicio),
      paraISO(datas.get(t.id).fim),
      t.dependency ? estado.tasks.findIndex((x) => x.id === t.dependency) + 1 : "",
      String(t.peso).replace(".", ","),
      t.progress
    ])
  ];

  const csv = linhas
    .map((linha) => linha.map((valor) => `"${String(valor).replace(/"/g, '""')}"`).join(";"))
    .join("\r\n");

  const nomeArquivo =
    (estado.obraNome
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "cronograma") + ".csv";

  baixarArquivo(nomeArquivo, "text/csv;charset=utf-8", `﻿${csv}`);
  avisar("Planilha CSV exportada.");
}
