/* =====================================================
   AVALIAÇÃO DE QUALIDADE DA OBRA
   Arquivo: pesquisa.js

   Tela simples de pesquisa de satisfação: obra + 5 perguntas com
   nota de 1 a 5 estrelas + comentário opcional. Grava em
   pesquisasRespostas, que alimenta o cálculo do indicador IQO na
   tela de SLA (indicadores-estrategicos.js).
===================================================== */

import {
  db
} from "./firebaseConfig.js";

import {
  protegerPagina,
  usuarioEhAdministrador,
  usuarioEhPlanejador
} from "./authGuard.js";

import {
  collection,
  getDocs,
  addDoc,
  doc,
  updateDoc,
  query,
  where,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.3/firebase-firestore.js";

/* =========================================
   PERGUNTAS
========================================= */

const PERGUNTAS = [
  { id: "acabamento", texto: "Qualidade do acabamento e execução da obra" },
  { id: "prazo", texto: "Cumprimento do prazo de entrega combinado" },
  { id: "limpeza", texto: "Limpeza e organização da área após a obra" },
  { id: "especificacao", texto: "Atendimento às especificações solicitadas" },
  { id: "satisfacao", texto: "Satisfação geral com o serviço prestado" }
];

let usuarioLogadoGlobal = null;
let obras = [];

// Obras que já receberam uma avaliação (pesquisasRespostas) — não faz
// sentido pedir pra avaliar de novo, então elas somem da lista.
let obraIdsAvaliadas = new Set();

// Realizado da Curva S, usado só pra saber se cada obra já está
// Concluída (físico acumulado >= 100%) — mesma fonte de dados usada
// no dashboard e na tela de SLA.
let realizadosCurvaSCache = [];

const respostas = {};

// Quando a página é aberta a partir do link enviado por e-mail
// (Cloud Function sendSurveyOnObraCompleted), a URL já traz a obra e
// um token de referência pra marcar a pesquisa como respondida.
const parametrosUrl = new URLSearchParams(window.location.search);
const obraIdPreSelecionada = parametrosUrl.get("obraId") || "";
const tokenPesquisa = parametrosUrl.get("token") || "";

/* =========================================
   ELEMENTOS
========================================= */

const selectLocalidade = document.getElementById("selectLocalidade");
const selectObra = document.getElementById("selectObra");
const listaPerguntas = document.getElementById("listaPerguntas");
const inputComentario = document.getElementById("comentario");
const btnEnviar = document.getElementById("btnEnviar");
const listaPendentes = document.getElementById("listaPendentes");
const obraDetalhes = document.getElementById("obraDetalhes");

/* =========================================
   INICIALIZAÇÃO
========================================= */

document.addEventListener("DOMContentLoaded", async () => {
  try {
    usuarioLogadoGlobal = await protegerPagina();

    renderizarPerguntas();
    await carregarObraIdsAvaliadas();
    await carregarRealizadosCurvaS();
    await carregarObras();
    await carregarPendentes();
    await carregarRespondidas();

    selectLocalidade?.addEventListener("change", () => {
      preencherSelectObra();
      atualizarDetalhesObra();
    });

    selectObra?.addEventListener("change", atualizarDetalhesObra);
    atualizarDetalhesObra();

    btnEnviar?.addEventListener("click", enviarAvaliacao);

    configurarCardsRecolhiveis();
  } catch (erro) {
    console.error("Erro ao iniciar avaliação de qualidade:", erro);
    alert("Erro ao iniciar a tela de avaliação.");
  }
});

/* =========================================
   CARDS RECOLHÍVEIS (Pendentes / Respondidas)
========================================= */

function configurarCardsRecolhiveis() {
  document.querySelectorAll(".card-title-recolhivel").forEach((cabecalho) => {
    const alternar = () => {
      const card = cabecalho.closest(".card");
      const recolhido = card.classList.toggle("recolhido");
      cabecalho.setAttribute("aria-expanded", String(!recolhido));
    };

    cabecalho.setAttribute("aria-expanded", "true");
    cabecalho.addEventListener("click", alternar);
    cabecalho.addEventListener("keydown", (evento) => {
      if (evento.key === "Enter" || evento.key === " ") {
        evento.preventDefault();
        alternar();
      }
    });
  });
}

/* =========================================
   CARREGAR OBRAS
========================================= */

async function carregarObraIdsAvaliadas() {
  try {
    // A regra do Firestore só libera ler a coleção inteira sem filtro
    // pra Administrador Geral; os demais perfis só enxergam a própria
    // Regional, então aplicamos o mesmo filtro aqui na consulta pra
    // não cair num "permission denied" ao listar respostas de outras
    // Regionais.
    const consultaRespostas = usuarioEhAdministrador(usuarioLogadoGlobal)
      ? collection(db, "pesquisasRespostas")
      : query(
          collection(db, "pesquisasRespostas"),
          where("regional", "==", usuarioLogadoGlobal?.regional || "")
        );

    const snap = await getDocs(consultaRespostas);

    obraIdsAvaliadas = new Set(
      snap.docs.map((documento) => documento.data().obraId).filter(Boolean)
    );
  } catch (erro) {
    console.warn("Não foi possível verificar as obras já avaliadas:", erro);
    obraIdsAvaliadas = new Set();
  }
}

async function carregarRealizadosCurvaS() {
  try {
    const snap = await getDocs(collection(db, "realizadoCurvaS"));
    realizadosCurvaSCache = snap.docs.map((documento) => documento.data());
  } catch (erro) {
    console.warn("Não foi possível carregar o realizado da Curva S:", erro);
    realizadosCurvaSCache = [];
  }
}

async function carregarObras() {
  try {
    const snap = await getDocs(collection(db, "obras"));

    obras = snap.docs
      .map((documento) => ({ docId: documento.id, ...documento.data() }))
      .filter((obra) => !obraIdsAvaliadas.has(obra.docId))
      .map((obra) => ({ obra, avaliacao: avaliarConclusaoObra(obra) }))
      .filter(({ avaliacao }) => avaliacao.concluida)
      .map(({ obra, avaliacao }) => ({ ...obra, __dataConclusao: avaliacao.dataConclusao }))
      .sort((a, b) =>
        obterNomeObra(a).localeCompare(obterNomeObra(b), "pt-BR")
      );

    preencherSelectLocalidade();

    // Quando a página vem do link de e-mail, já filtra a Localidade
    // pela obra pré-selecionada, antes de montar a lista de obras.
    if (obraIdPreSelecionada) {
      const obraAlvo = obras.find((obra) => obra.docId === obraIdPreSelecionada);

      if (obraAlvo?.localidade && selectLocalidade) {
        selectLocalidade.value = obraAlvo.localidade;
      }
    }

    preencherSelectObra();

    if (
      obraIdPreSelecionada &&
      obras.some((obra) => obra.docId === obraIdPreSelecionada)
    ) {
      selectObra.value = obraIdPreSelecionada;
      selectObra.disabled = true;
      selectLocalidade && (selectLocalidade.disabled = true);
    }
  } catch (erro) {
    console.error("Erro ao carregar obras:", erro);

    if (selectObra) {
      selectObra.innerHTML = `<option value="">Erro ao carregar obras</option>`;
    }
  }
}

function preencherSelectLocalidade() {
  if (!selectLocalidade) {
    return;
  }

  const valorAtual = selectLocalidade.value;

  const localidades = [...new Set(
    obras
      .map((obra) => String(obra.localidade || "").trim())
      .filter(Boolean)
  )].sort((a, b) => a.localeCompare(b, "pt-BR"));

  selectLocalidade.innerHTML = `<option value="">Todas</option>`;

  localidades.forEach((localidade) => {
    const option = document.createElement("option");
    option.value = localidade;
    option.textContent = localidade;
    selectLocalidade.appendChild(option);
  });

  if (localidades.includes(valorAtual)) {
    selectLocalidade.value = valorAtual;
  }
}

function preencherSelectObra() {
  if (!selectObra) {
    return;
  }

  const valorAtual = selectObra.value;
  const localidadeSelecionada = selectLocalidade?.value || "";

  const obrasFiltradas = localidadeSelecionada
    ? obras.filter((obra) => String(obra.localidade || "").trim() === localidadeSelecionada)
    : obras;

  selectObra.innerHTML = `<option value="">Selecione a obra...</option>`;

  obrasFiltradas.forEach((obra) => {
    const option = document.createElement("option");
    option.value = obra.docId;
    option.textContent = obterNomeObra(obra);
    selectObra.appendChild(option);
  });

  if (obrasFiltradas.some((obra) => obra.docId === valorAtual)) {
    selectObra.value = valorAtual;
  }
}

/* =========================================
   PERGUNTAS / ESTRELAS
========================================= */

function renderizarPerguntas() {
  if (!listaPerguntas) {
    return;
  }

  listaPerguntas.innerHTML = PERGUNTAS.map((pergunta) => `
    <div class="pergunta-item" data-pergunta="${pergunta.id}">
      <span class="pergunta-texto">${pergunta.texto}</span>
      <div class="estrelas" data-pergunta="${pergunta.id}">
        ${[1, 2, 3, 4, 5].map((valor) => `
          <i class="fa-solid fa-star" data-valor="${valor}"></i>
        `).join("")}
      </div>
    </div>
  `).join("");

  listaPerguntas.querySelectorAll(".estrelas").forEach((grupo) => {
    const perguntaId = grupo.getAttribute("data-pergunta");

    grupo.querySelectorAll("i").forEach((estrela) => {
      estrela.addEventListener("click", () => {
        const valor = Number(estrela.getAttribute("data-valor"));
        definirNota(perguntaId, valor);
      });
    });
  });
}

function definirNota(perguntaId, valor) {
  respostas[perguntaId] = valor;

  const grupo = listaPerguntas.querySelector(`.estrelas[data-pergunta="${perguntaId}"]`);
  const item = listaPerguntas.querySelector(`.pergunta-item[data-pergunta="${perguntaId}"]`);

  if (grupo) {
    grupo.querySelectorAll("i").forEach((estrela) => {
      const estrelaValor = Number(estrela.getAttribute("data-valor"));
      estrela.classList.toggle("ativa", estrelaValor <= valor);
    });
  }

  if (item) {
    item.classList.add("respondida");
  }
}

/* =========================================
   ENVIAR AVALIAÇÃO
========================================= */

async function enviarAvaliacao() {
  const obraId = selectObra?.value || "";

  if (!obraId) {
    alert("Selecione a obra avaliada.");
    selectObra?.focus();
    return;
  }

  const perguntasSemNota = PERGUNTAS.filter((pergunta) => !respostas[pergunta.id]);

  if (perguntasSemNota.length > 0) {
    alert("Dê uma nota de 1 a 5 estrelas para todas as perguntas antes de enviar.");
    return;
  }

  const obraSelecionada = obras.find((obra) => obra.docId === obraId);

  const perguntasRespondidas = PERGUNTAS.map((pergunta) => ({
    id: pergunta.id,
    pergunta: pergunta.texto,
    nota: respostas[pergunta.id]
  }));

  const notaMedia =
    perguntasRespondidas.reduce((total, item) => total + item.nota, 0) /
    perguntasRespondidas.length;

  try {
    btnEnviar.disabled = true;
    btnEnviar.textContent = "Enviando...";

    await addDoc(collection(db, "pesquisasRespostas"), {
      obraId,
      obraNome: obraSelecionada ? obterNomeObra(obraSelecionada) : "",
      regional: obraSelecionada?.regional || "",
      localidade: obraSelecionada?.localidade || "",

      // Presente só quando a pesquisa veio do link automático de
      // e-mail — usado pela Cloud Function onSurveyAnswered pra
      // marcar o pedido como respondido.
      tokenRef: tokenPesquisa,

      perguntas: perguntasRespondidas,
      notaMedia,

      comentario: (inputComentario?.value || "").trim(),

      avaliadorUid: usuarioLogadoGlobal?.uid || "",
      avaliadorEmail:
        usuarioLogadoGlobal?.email ||
        usuarioLogadoGlobal?.emailAuth ||
        "",
      avaliadorNome: usuarioLogadoGlobal?.nome || "",

      criadoEm: serverTimestamp()
    });

    alert("Avaliação enviada com sucesso! Obrigado.");
    limparFormulario();
  } catch (erro) {
    console.error("Erro ao enviar avaliação:", erro);
    alert("Erro ao enviar a avaliação. Verifique suas permissões no Firestore.");
  } finally {
    btnEnviar.disabled = false;
    btnEnviar.innerHTML = `<i class="fa-solid fa-paper-plane"></i> Enviar Avaliação`;
  }
}

function limparFormulario() {
  if (selectObra) {
    selectObra.value = "";
  }

  if (inputComentario) {
    inputComentario.value = "";
  }

  Object.keys(respostas).forEach((chave) => {
    delete respostas[chave];
  });

  renderizarPerguntas();
  atualizarDetalhesObra();
}

/* =========================================
   DETALHES DA OBRA SELECIONADA
========================================= */

function atualizarDetalhesObra() {
  if (!obraDetalhes) {
    return;
  }

  const obraId = selectObra?.value || "";
  const obra = obras.find((item) => item.docId === obraId);

  if (!obra) {
    obraDetalhes.classList.remove("visivel");
    return;
  }

  setTexto("detalheRegional", obra.regional || "-");
  setTexto("detalheLocalidade", obra.localidade || "-");
  setTexto("detalheDataInicio", formatarDataObra(
    obra.dataInicio || obra.dataInicioPrevisto || obra.dataInicioObra
  ));
  setTexto("detalheDataFim", formatarDataObra(
    obra.dataFim || obra.dataTerminoPrevisto || obra.dataFimPrevisto || obra.dataFimObra
  ));

  obraDetalhes.classList.add("visivel");
}

function setTexto(id, valor) {
  const elemento = document.getElementById(id);

  if (elemento) {
    elemento.textContent = valor;
  }
}

function formatarDataObra(valor) {
  if (!valor) {
    return "-";
  }

  if (valor?.toDate) {
    return valor.toDate().toLocaleDateString("pt-BR");
  }

  if (valor instanceof Date) {
    return isNaN(valor.getTime()) ? "-" : valor.toLocaleDateString("pt-BR");
  }

  const texto = String(valor).trim();

  // Datas de <input type="date"> vêm como "AAAA-MM-DD".
  const partesISO = texto.match(/^(\d{4})-(\d{2})-(\d{2})/);

  if (partesISO) {
    return `${partesISO[3]}/${partesISO[2]}/${partesISO[1]}`;
  }

  return texto || "-";
}

/* =========================================
   PESQUISAS PENDENTES

   Mostra TODAS as obras Concluídas que ainda não foram avaliadas —
   ou seja, a mesma lista usada no seletor "Obra" do formulário acima
   (variável `obras`, já filtrada por obraEstaConcluida() e sem as que
   já têm resposta em pesquisasRespostas). Cruza essa lista com os
   documentos "pendente" de pesquisasObras pra saber quais já têm
   envio automático de e-mail agendado (e permitir trocar o
   destinatário) e quais ainda não têm — obra concluída sem
   emailAvaliacaoQualidade cadastrado, que só entra por essa tela.
   Trocar o e-mail aqui dispara automaticamente um novo envio (Cloud
   Function resendSurveyOnEmailChanged, que reage a mudanças no campo
   sponsorEmail dos documentos de pesquisasObras).
========================================= */

let podeEditarPendentes = false;

// Prazo pra responder a pesquisa: 5 dias úteis a contar da conclusão
// da obra. Depois disso, o status passa de "No prazo" pra "Pendente".
const PRAZO_DIAS_UTEIS_PESQUISA = 5;

async function carregarPendentes() {
  const secaoPendentes = document.getElementById("secaoPendentes");
  const secaoRespondidas = document.getElementById("secaoRespondidas");

  podeEditarPendentes =
    usuarioEhAdministrador(usuarioLogadoGlobal) ||
    usuarioEhPlanejador(usuarioLogadoGlobal);

  // Quem só vai responder a pesquisa (perfil "usuário") ou quem abriu
  // a página pelo link do e-mail (traz obraId/token na URL) não deve
  // ver essas áreas — só quem acessa direto a tela pra acompanhar.
  const abertoPeloLinkDeEmail = Boolean(obraIdPreSelecionada || tokenPesquisa);

  if (!podeEditarPendentes || abertoPeloLinkDeEmail) {
    podeEditarPendentes = false;
    secaoPendentes?.remove();
    secaoRespondidas?.remove();
    return;
  }

  if (!listaPendentes) {
    return;
  }

  try {
    const q = query(
      collection(db, "pesquisasObras"),
      where("status", "==", "pendente")
    );

    const snap = await getDocs(q);

    const pendentesPorObraId = new Map();

    snap.docs.forEach((documento) => {
      const dados = { docId: documento.id, ...documento.data() };

      if (dados.obraId) {
        pendentesPorObraId.set(dados.obraId, dados);
      }
    });

    const hoje = new Date();

    const itens = obras
      .map((obra) => {
        const diasUteis = contarDiasUteisEntre(obra.__dataConclusao, hoje);

        return {
          obraId: obra.docId,
          obraNome: obterNomeObra(obra),
          obraRegional: obra.regional || "",
          obraLocalidade: obra.localidade || "",
          idObra: obterIdObra(obra),
          regional: obra.regional || "-",
          localidade: obra.localidade || "-",
          dataInicio: formatarDataObra(
            obra.dataInicio || obra.dataInicioPrevisto || obra.dataInicioObra
          ),
          dataFim: formatarDataObra(
            obra.dataFim || obra.dataTerminoPrevisto || obra.dataFimPrevisto || obra.dataFimObra
          ),
          dataConclusao: formatarDataObra(obra.__dataConclusao),
          diasUteis,
          statusPrazo: diasUteis >= PRAZO_DIAS_UTEIS_PESQUISA ? "pendente" : "no-prazo",
          pendenteDoc: pendentesPorObraId.get(obra.docId) || null
        };
      })
      .sort((a, b) => {
        if (a.statusPrazo !== b.statusPrazo) {
          return a.statusPrazo === "pendente" ? -1 : 1;
        }

        return b.diasUteis - a.diasUteis;
      });

    renderizarPendentes(itens);
  } catch (erro) {
    console.error("Erro ao carregar pesquisas pendentes:", erro);

    listaPendentes.innerHTML = `
      <div class="pendente-vazio">
        Não foi possível carregar as pesquisas pendentes.
      </div>
    `;
  }
}

function formatarDataPendente(valor) {
  const data = valor?.toDate ? valor.toDate() : null;
  return data ? data.toLocaleDateString("pt-BR") : "-";
}

function renderizarPendentes(itens) {
  if (!listaPendentes) {
    return;
  }

  if (itens.length === 0) {
    listaPendentes.innerHTML = `
      <div class="pendente-vazio">
        Nenhuma obra concluída aguardando avaliação no momento.
      </div>
    `;
    return;
  }

  listaPendentes.innerHTML = itens.map((item) => {
    const pendente = item.pendenteDoc;

    const statusLabel = item.statusPrazo === "pendente" ? "Pendente" : "No prazo";
    const statusClasse = item.statusPrazo === "pendente" ? "atrasada" : "no-prazo";
    const emailFixo = pendente?.sponsorEmail || "";

    return `
    <div class="pendente-item" data-id="${pendente ? pendente.docId : ""}">

      <div class="pendente-cabecalho">
        <div class="pendente-obra-info">
          <div class="pendente-obra">${textoSeguro(item.obraNome)}</div>
          <div class="pendente-id">ID ${textoSeguro(item.idObra)}</div>
        </div>

        <span class="status-prazo-pill ${statusClasse}">${statusLabel}</span>
      </div>

      <div class="pendente-detalhes">

        <div class="obra-detalhe-item">
          <span>Regional</span>
          <strong>${textoSeguro(item.regional)}</strong>
        </div>

        <div class="obra-detalhe-item">
          <span>Localidade</span>
          <strong>${textoSeguro(item.localidade)}</strong>
        </div>

        <div class="obra-detalhe-item">
          <span>Data Início</span>
          <strong>${textoSeguro(item.dataInicio)}</strong>
        </div>

        <div class="obra-detalhe-item">
          <span>Data Fim</span>
          <strong>${textoSeguro(item.dataFim)}</strong>
        </div>

        <div class="obra-detalhe-item">
          <span>Concluída em</span>
          <strong>${textoSeguro(item.dataConclusao)}</strong>
        </div>

        <div class="obra-detalhe-item">
          <span>Aguardando resposta</span>
          <strong>${item.diasUteis} dia(s) útil(eis)</strong>
        </div>

      </div>

      <div class="pendente-rodape">
        ${pendente ? `
          <div class="pendente-email-grupo">
            <input
              type="email"
              value="${textoSeguro(emailFixo)}"
              placeholder="novo-email@empresa.com"
              ${podeEditarPendentes ? "" : "disabled"}
            >

            <button
              type="button"
              class="btn-salvar-email"
              ${podeEditarPendentes ? "" : "disabled"}
            >
              <i class="fa-solid fa-paper-plane"></i>
              Salvar e reenviar
            </button>
          </div>
        ` : `
          <div class="pendente-sem-email-aviso">
            <i class="fa-solid fa-circle-info"></i>
            Sem e-mail cadastrado pra envio automático — informe abaixo o e-mail de quem vai responder:
          </div>

          <div class="pendente-email-grupo">
            <input
              type="email"
              placeholder="email-do-responsavel@empresa.com"
              ${podeEditarPendentes ? "" : "disabled"}
            >

            <button
              type="button"
              class="btn-enviar-pesquisa"
              ${podeEditarPendentes ? "" : "disabled"}
            >
              <i class="fa-solid fa-paper-plane"></i>
              Enviar pesquisa
            </button>
          </div>
        `}
      </div>

    </div>
  `;
  }).join("");

  listaPendentes.querySelectorAll(".pendente-item").forEach((elemento, indice) => {
    const item = itens[indice];
    const docId = elemento.getAttribute("data-id");
    const input = elemento.querySelector("input");
    const botaoSalvar = elemento.querySelector(".btn-salvar-email");
    const botaoEnviar = elemento.querySelector(".btn-enviar-pesquisa");

    botaoSalvar?.addEventListener("click", () => {
      salvarNovoEmailPendente(docId, input?.value || "", botaoSalvar);
    });

    botaoEnviar?.addEventListener("click", () => {
      enviarPesquisaParaEmail(item, input?.value || "", botaoEnviar);
    });
  });
}

async function enviarPesquisaParaEmail(item, emailDigitado, botao) {
  const email = emailDigitado.trim().toLowerCase();

  if (!email || !email.includes("@")) {
    alert("Informe um e-mail válido.");
    return;
  }

  try {
    botao.disabled = true;
    botao.textContent = "Enviando...";

    const token =
      window.crypto?.randomUUID?.() ||
      `${Date.now()}-${Math.random().toString(16).slice(2)}`;

    const novoDocRef = await addDoc(collection(db, "pesquisasObras"), {
      obraId: item.obraId,
      obra: item.obraNome,
      regional: item.obraRegional,
      localidade: item.obraLocalidade,
      sponsorEmail: "",
      token,
      status: "pendente",
      sentCount: 0,
      createdAt: serverTimestamp(),
      lastSentAt: null
    });

    // Criar o documento sozinho não dispara e-mail (só
    // sendSurveyOnObraCompleted faz isso, reagindo à Curva S). Definir
    // o sponsorEmail logo em seguida é o que dispara o envio (Cloud
    // Function resendSurveyOnEmailChanged, que reage a mudanças nesse
    // campo) — reaproveita o mesmo fluxo já usado pra reenviar pra um
    // novo e-mail.
    await updateDoc(novoDocRef, { sponsorEmail: email });

    alert("Pesquisa enviada com sucesso!");
    await carregarPendentes();
  } catch (erro) {
    console.error("Erro ao enviar pesquisa:", erro);
    alert("Erro ao enviar a pesquisa. Verifique suas permissões no Firestore.");

    botao.disabled = false;
    botao.innerHTML = `<i class="fa-solid fa-paper-plane"></i> Enviar pesquisa`;
  }
}

async function salvarNovoEmailPendente(docId, novoEmail, botao) {
  const email = novoEmail.trim().toLowerCase();

  if (!email || !email.includes("@")) {
    alert("Informe um e-mail válido.");
    return;
  }

  try {
    botao.disabled = true;
    botao.textContent = "Enviando...";

    await updateDoc(doc(db, "pesquisasObras", docId), {
      sponsorEmail: email
    });

    alert("E-mail atualizado! A pesquisa foi reenviada para o novo destinatário.");
    await carregarPendentes();
  } catch (erro) {
    console.error("Erro ao atualizar e-mail da pesquisa pendente:", erro);
    alert("Erro ao atualizar o e-mail. Verifique suas permissões no Firestore.");

    botao.disabled = false;
    botao.innerHTML = `<i class="fa-solid fa-paper-plane"></i> Salvar e reenviar`;
  }
}

/* =========================================
   PESQUISAS RESPONDIDAS

   Mostra as avaliações já recebidas (pesquisasRespostas). A regra do
   Firestore já filtra por Regional sozinha — cada perfil só recebe de
   volta os documentos da própria Regional (Administrador Geral vê
   tudo), então aqui é só ler a coleção sem filtro nenhum no client.
========================================= */

async function carregarRespondidas() {
  if (!podeEditarPendentes) {
    return;
  }

  const listaRespondidas = document.getElementById("listaRespondidas");

  if (!listaRespondidas) {
    return;
  }

  try {
    const snap = await getDocs(collection(db, "pesquisasRespostas"));

    const respondidas = snap.docs
      .map((documento) => ({ docId: documento.id, ...documento.data() }))
      .sort((a, b) => obterDataOrdenacao2(b) - obterDataOrdenacao2(a));

    renderizarRespondidas(respondidas, listaRespondidas);
  } catch (erro) {
    console.error("Erro ao carregar pesquisas respondidas:", erro);

    listaRespondidas.innerHTML = `
      <div class="pendente-vazio">
        Não foi possível carregar as pesquisas respondidas.
      </div>
    `;
  }
}

function obterDataOrdenacao2(resposta) {
  return resposta?.criadoEm?.toDate
    ? resposta.criadoEm.toDate().getTime()
    : 0;
}

function renderizarEstrelasLeitura(nota) {
  const cheias = Math.round(Number(nota) || 0);

  return Array.from({ length: 5 }, (_, indice) =>
    indice < cheias ? "★" : "☆"
  ).join("");
}

function renderizarRespondidas(respondidas, listaRespondidas) {
  if (respondidas.length === 0) {
    listaRespondidas.innerHTML = `
      <div class="pendente-vazio">
        Nenhuma pesquisa respondida ainda.
      </div>
    `;
    return;
  }

  listaRespondidas.innerHTML = respondidas.map((resposta) => `
    <div class="respondida-item">

      <div class="respondida-cabecalho">

        <div>
          <div class="respondida-obra">${textoSeguro(resposta.obraNome || "Obra sem nome")}</div>
          <div class="respondida-meta">
            ${textoSeguro(resposta.regional || "-")} · ${textoSeguro(resposta.localidade || "-")}
            · ${formatarDataPendente(resposta.criadoEm)}
            ${resposta.avaliadorNome || resposta.avaliadorEmail
              ? `· avaliado por ${textoSeguro(resposta.avaliadorNome || resposta.avaliadorEmail)}`
              : ""}
          </div>
        </div>

        <div class="respondida-nota">
          <span class="estrelas-leitura">${renderizarEstrelasLeitura(resposta.notaMedia)}</span>
          <span>${Number(resposta.notaMedia || 0).toFixed(1)} / 5,0</span>
        </div>

      </div>

      ${(resposta.perguntas || []).length > 0 ? `
        <div class="respondida-perguntas">
          ${resposta.perguntas.map((pergunta) => `
            <span class="respondida-pergunta-item">
              ${textoSeguro(pergunta.pergunta)}: <strong>${textoSeguro(pergunta.nota)}★</strong>
            </span>
          `).join("")}
        </div>
      ` : ""}

      ${resposta.comentario ? `
        <div class="respondida-comentario">
          "${textoSeguro(resposta.comentario)}"
        </div>
      ` : ""}

    </div>
  `).join("");
}

/* =========================================
   STATUS DA OBRA (Concluída?)

   Réplica enxuta da mesma lógica usada em dashboard.js e
   indicadores-estrategicos.js pra decidir se uma obra já está
   Concluída (status manual OU físico acumulado >= 100%) — só essa
   obra fica apta a receber a pesquisa de qualidade.
========================================= */

function normalizarTextoObra(valor) {
  return String(valor || "")
    .toLowerCase()
    .trim()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

function converterPercentualObra(valor) {
  if (valor === null || valor === undefined || valor === "") {
    return 0;
  }

  if (typeof valor === "number") {
    return Number.isFinite(valor) ? valor : 0;
  }

  let texto = String(valor).replace("%", "").replace(/\s/g, "").trim();

  if (texto.includes(",")) {
    texto = texto.replace(/\./g, "").replace(",", ".");
  }

  texto = texto.replace(/[^\d.-]/g, "");

  return Number(texto) || 0;
}

function numeroSemanaObra(valor) {
  return parseInt(String(valor || "").replace(/\D/g, "")) || 0;
}

function obterDataGenericaObra(valor) {
  if (!valor) {
    return null;
  }

  if (valor?.toDate) {
    return valor.toDate();
  }

  if (valor?.seconds) {
    return new Date(valor.seconds * 1000);
  }

  const data = valor instanceof Date ? valor : new Date(valor);
  return isNaN(data.getTime()) ? null : data;
}

function obterTimestampComparacaoObra(item) {
  const data = obterDataGenericaObra(
    item?.atualizadoEm || item?.criadoEm || item?.dataAtualizacao || item?.dataRegistro
  );

  return data ? data.getTime() : 0;
}

function registroPertenceAObraLocal(registro, obra) {
  if (!registro || !obra) {
    return false;
  }

  const chavesObra = [
    obra.docId,
    obra.idProjeto,
    obra.idObra,
    obra.obraId,
    obra.codigoObra,
    obra.codigo,
    obra.nomeProjeto
  ].filter(Boolean).map(normalizarTextoObra);

  const chavesRegistro = [
    registro.obraId,
    registro.idObra,
    registro.idProjeto,
    registro.projetoId,
    registro.obraDocId,
    registro.codigoObra,
    registro.codigo,
    registro.obra,
    registro.obraNome,
    registro.nomeObra,
    registro.nomeProjeto,
    registro.projeto
  ].filter(Boolean).map(normalizarTextoObra);

  if (chavesRegistro.some((chave) => chavesObra.includes(chave))) {
    return true;
  }

  const nomeObra = normalizarTextoObra(obra.nomeProjeto);
  const nomeRegistro = normalizarTextoObra(
    registro.nomeProjeto || registro.nomeObra || registro.obraNome || registro.obra || registro.projeto
  );

  if (nomeObra && nomeRegistro && nomeObra === nomeRegistro) {
    return true;
  }

  const centroObra = normalizarTextoObra(obra.centroCusto);
  const centroRegistro = normalizarTextoObra(
    registro.centroCusto || registro.centroDeCusto || registro.centroCustoApropriacao
  );

  return Boolean(centroObra && centroRegistro && centroObra === centroRegistro && !nomeRegistro);
}

function deduplicarPorSemanaLocal(lista) {
  const mapa = new Map();

  lista.forEach((item) => {
    const numero = numeroSemanaObra(item.semana);

    if (numero <= 0) {
      return;
    }

    const existente = mapa.get(numero);

    if (!existente || obterTimestampComparacaoObra(item) >= obterTimestampComparacaoObra(existente)) {
      mapa.set(numero, item);
    }
  });

  return Array.from(mapa.values())
    .sort((a, b) => numeroSemanaObra(a.semana) - numeroSemanaObra(b.semana));
}

function obterFisicoRealizadoAcumuladoLocal(item) {
  if (!item) {
    return 0;
  }

  if (item.fisicoRealAcum !== undefined) return converterPercentualObra(item.fisicoRealAcum);
  if (item.fisicoAcum !== undefined) return converterPercentualObra(item.fisicoAcum);
  if (item.fisicoAcumulado !== undefined) return converterPercentualObra(item.fisicoAcumulado);
  if (item.avancoFisicoAcumulado !== undefined) return converterPercentualObra(item.avancoFisicoAcumulado);
  if (item.fisicoReal !== undefined) return converterPercentualObra(item.fisicoReal);
  if (item.avancoFisicoNovo !== undefined) return converterPercentualObra(item.avancoFisicoNovo);
  if (item.avancoFisico !== undefined) return converterPercentualObra(item.avancoFisico);

  return converterPercentualObra(item.fisico || 0);
}

function obterUltimoRealizadoObra(obra) {
  const realizados = deduplicarPorSemanaLocal(
    realizadosCurvaSCache.filter((item) => registroPertenceAObraLocal(item, obra))
  );

  return realizados[realizados.length - 1] || null;
}

// Decide se a obra já está Concluída e, se estiver, a partir de quando
// (usado pra contar os dias úteis do prazo de resposta da pesquisa).
// A data de conclusão é a do registro de realizado que fechou os
// 100% físico; na falta dele (obra marcada "Concluída" manualmente,
// sem lançamento na Curva S), cai pra Data Fim cadastrada.
function avaliarConclusaoObra(obra) {
  const statusManual = normalizarTextoObra(obra.status || obra.statusNovo || obra.fase || "");
  const ultimoRealizado = obterUltimoRealizadoObra(obra);
  const fisico = ultimoRealizado ? obterFisicoRealizadoAcumuladoLocal(ultimoRealizado) : 0;
  const concluida = statusManual.includes("concluid") || fisico >= 100;

  if (!concluida) {
    return { concluida: false, dataConclusao: null };
  }

  const dataConclusao =
    obterDataGenericaObra(ultimoRealizado?.criadoEm || ultimoRealizado?.atualizadoEm) ||
    obterDataGenericaObra(obra.dataFim || obra.dataTerminoPrevisto || obra.dataFimPrevisto || obra.dataFimObra);

  return { concluida: true, dataConclusao };
}

// Conta os dias úteis (seg. a sex., sem calendário de feriados) entre
// duas datas, sem contar o próprio dia inicial.
function contarDiasUteisEntre(dataInicio, dataFim) {
  if (!dataInicio || !dataFim) {
    return 0;
  }

  const cursor = new Date(dataInicio.getFullYear(), dataInicio.getMonth(), dataInicio.getDate());
  const fim = new Date(dataFim.getFullYear(), dataFim.getMonth(), dataFim.getDate());

  let dias = 0;

  while (cursor < fim) {
    cursor.setDate(cursor.getDate() + 1);

    const diaSemana = cursor.getDay();

    if (diaSemana !== 0 && diaSemana !== 6) {
      dias++;
    }
  }

  return dias;
}

/* =========================================
   OBRA - APOIO
========================================= */

function textoSeguro(valor) {
  return String(valor ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

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
    obra.idProjeto ||
    obra.idObra ||
    obra.codigoObra ||
    obra.codigo ||
    obra.docId ||
    "-"
  ).trim();
}
