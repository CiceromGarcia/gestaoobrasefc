// index.js — Cloud Functions v2 (Node 20)
const admin = require("firebase-admin");
const nodemailer = require("nodemailer");

// Compat v1: o trigger de Auth (auth.user().onCreate) ainda não tem
// equivalente nativo no SDK v2, então usamos o pacote v1 só pra isso.
const functionsV1 = require("firebase-functions/v1");
const { onDocumentWritten, onDocumentCreated } = require("firebase-functions/v2/firestore");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { onRequest, onCall, HttpsError } = require("firebase-functions/v2/https");
const { setGlobalOptions, logger } = require("firebase-functions/v2");

setGlobalOptions({
  region: "us-central1",
  memory: "256MiB",
  timeoutSeconds: 60
});

admin.initializeApp();

const db = admin.firestore();

/*
  SEGURANÇA: a lista fixa de e-mails de administrador foi REMOVIDA.
  Ela ficava exposta no código-fonte do cliente (authGuard.js) e
  era redundante — o Firestore (usuariosSistema) já é a fonte da
  verdade. Agora usamos CUSTOM CLAIMS sincronizadas automaticamente
  a partir do Firestore (ver trigger `sincronizarClaimAdmin` abaixo).

  Para promover o primeiro administrador do sistema: crie/edite o
  documento em usuariosSistema/{uid} pelo Console do Firebase com
  perfil = "administrador" e status = "ativo". A claim é aplicada
  automaticamente pela função de sincronização.
*/

// ===== Config via variáveis de ambiente (functions.config() foi descontinuado) =====
const smtp = {
  host: process.env.SMTP_HOST || "",
  port: process.env.SMTP_PORT || "587",
  secure: process.env.SMTP_SECURE || "false",
  user: process.env.SMTP_USER || "",
  pass: process.env.SMTP_PASS || ""
};
const appCfg = {
  url: process.env.APP_URL || "https://SEU-HOST/pesquisa.html",
  rollup_token: process.env.ROLLUP_TOKEN || ""
};
const callmebot = {
  phone: process.env.CALLMEBOT_PHONE || "",
  apikey: process.env.CALLMEBOT_APIKEY || ""
};

// ===== Utils gerais =====
const canonical = (s) =>
  String(s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[’´`]/g, "'")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

const num = (x) => {
  if (typeof x === "string") {
    const clean = x
      .replace(/[R$\s]/g, "")
      .replace(/\./g, "")
      .replace(/,/g, ".");

    const n = Number(clean);
    return Number.isFinite(n) ? n : 0;
  }

  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
};

const safeDiv = (a, b) => {
  const A = Number(a);
  const B = Number(b);

  return B && Number.isFinite(A) && Number.isFinite(B)
    ? A / B
    : null;
};

function toDate(v) {
  if (!v) {
    return null;
  }

  if (v.toDate) {
    return v.toDate();
  }

  if (v._seconds || v.seconds) {
    return new Date((v._seconds || v.seconds) * 1000);
  }

  if (typeof v === "number") {
    const d = new Date(v);
    return isNaN(d) ? null : d;
  }

  if (typeof v === "string") {
    const m2 = v.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);

    if (m2) {
      return new Date(+m2[3], +m2[2] - 1, +m2[1], 12, 0, 0);
    }

    const m = v.match(/^(\d{4})-W(\d{2})$/);

    if (m) {
      const y = +m[1];
      const w = +m[2];

      const j4 = new Date(Date.UTC(y, 0, 4));
      const day = j4.getUTCDay() || 7;

      const mon = new Date(j4);
      mon.setUTCDate(j4.getUTCDate() - (day - 1) + (w - 1) * 7);

      return new Date(mon.getFullYear(), mon.getMonth(), mon.getDate());
    }

    const d = new Date(v);

    if (!isNaN(d)) {
      return d;
    }
  }

  const d = new Date(v);

  return isNaN(d) ? null : d;
}

function cicloDoDia(d) {
  const Y = d.getFullYear();

  const mapa = [
    { c: 1, s: [Y - 1, 12, 21], e: [Y, 1, 20] },
    { c: 2, s: [Y, 1, 21], e: [Y, 2, 20] },
    { c: 3, s: [Y, 2, 21], e: [Y, 3, 20] },
    { c: 4, s: [Y, 3, 21], e: [Y, 4, 20] },
    { c: 5, s: [Y, 4, 21], e: [Y, 5, 20] },
    { c: 6, s: [Y, 5, 21], e: [Y, 6, 20] },
    { c: 7, s: [Y, 6, 21], e: [Y, 7, 20] },
    { c: 8, s: [Y, 7, 21], e: [Y, 8, 20] },
    { c: 9, s: [Y, 8, 21], e: [Y, 9, 20] },
    { c: 10, s: [Y, 9, 21], e: [Y, 10, 20] },
    { c: 11, s: [Y, 10, 21], e: [Y, 11, 20] },
    { c: 12, s: [Y, 11, 21], e: [Y, 12, 20] }
  ];

  for (const { c, s, e } of mapa) {
    const S = new Date(s[0], s[1] - 1, s[2], 0, 0, 0);
    const E = new Date(e[0], e[1] - 1, e[2], 23, 59, 59);

    if (d >= S && d <= E) {
      return {
        ano: E.getFullYear(),
        ciclo: c,
        start: S,
        end: E
      };
    }
  }

  return {
    ano: Y,
    ciclo: 1,
    start: new Date(Y - 1, 11, 21),
    end: new Date(Y, 0, 20, 23, 59, 59)
  };
}

// ===== Email =====
function buildTransport() {
  if (!smtp.host || !smtp.user || !smtp.pass) {
    logger.error("SMTP ausente em functions:config");
    return null;
  }

  return nodemailer.createTransport({
    host: smtp.host,
    port: Number(smtp.port || 587),
    secure: String(smtp.secure || "false") === "true",
    auth: {
      user: smtp.user,
      pass: smtp.pass
    }
  });
}

// ===== WhatsApp (CallMeBot) =====
// Serviço não-oficial e gratuito (api.callmebot.com). Requer que o número
// de destino tenha previamente autorizado o bot pelo próprio WhatsApp
// (ver instruções em .env.example). Falha aqui nunca deve derrubar o
// envio de e-mail, por isso quem chama trata o erro separadamente.
async function enviarWhatsAppCallMeBot(texto) {
  if (!callmebot.phone || !callmebot.apikey) {
    logger.warn("enviarWhatsAppCallMeBot: CALLMEBOT_PHONE/CALLMEBOT_APIKEY ausentes.");
    return { ok: false, motivo: "não configurado" };
  }

  const url = `https://api.callmebot.com/whatsapp.php?phone=${encodeURIComponent(callmebot.phone)}&text=${encodeURIComponent(texto)}&apikey=${encodeURIComponent(callmebot.apikey)}`;

  const resposta = await fetch(url);
  const corpo = await resposta.text();

  if (!resposta.ok) {
    throw new Error(`CallMeBot respondeu ${resposta.status}: ${corpo}`);
  }

  return { ok: true, corpo };
}

const aguardarMs = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Manda várias mensagens em sequência pro mesmo número, com uma pequena
// pausa entre cada uma (o CallMeBot enfileira/rejeita se chegar rápido
// demais). Continua tentando as próximas mesmo se uma falhar, pra não
// perder o resto do resumo por causa de uma falha pontual.
async function enviarWhatsAppCallMeBotEmPartes(partes) {
  const resultados = [];

  for (let i = 0; i < partes.length; i++) {
    if (i > 0) {
      await aguardarMs(3000);
    }

    try {
      resultados.push(await enviarWhatsAppCallMeBot(partes[i]));
    } catch (e) {
      logger.error(`enviarWhatsAppCallMeBotEmPartes: falha na parte ${i + 1}/${partes.length}:`, e);
      resultados.push({ ok: false, motivo: e.message });
    }
  }

  return resultados;
}

function fmtLinkPesquisa({ obra, localidade, regional, sponsorEmail, token }) {
  const base = appCfg.url || "https://SEU-HOST/pesquisa.html";
  const p = new URL(base);

  if (obra) {
    p.searchParams.set("obra", obra);
  }

  if (localidade) {
    p.searchParams.set("localidade", localidade);
  }

  if (regional) {
    p.searchParams.set("regional", regional);
  }

  if (sponsorEmail) {
    p.searchParams.set("sponsor", sponsorEmail);
  }

  if (token) {
    p.searchParams.set("token", token);
  }

  return p.toString();
}

const isConcluido = (v) => /conclu|finaliz/i.test(String(v || ""));

/* ===================================================================
   1) Enviar pesquisa quando uma obra ficar concluída
=================================================================== */

exports.sendSurveyOnProjectCompleted = onDocumentWritten(
  {
    document: "projetos_atualizados/{id}"
  },
  async (event) => {
    const after = event.data?.after?.data();
    const before = event.data?.before?.data();

    if (!after) {
      return;
    }

    if (before && before.statusNovo === after.statusNovo) {
      return;
    }

    if (!isConcluido(after.statusNovo)) {
      return;
    }

    const projetoId = String(after.projetoId || "").trim();

    if (!projetoId) {
      logger.warn("Atualização sem projetoId");
      return;
    }

    const projSnap = await db.collection("projetos").doc(projetoId).get();
    const proj = projSnap.exists ? projSnap.data() : {};

    const obra = proj?.nomeProjeto || proj?.nome || "Obra";
    const regional = after.regional || proj?.regional || "";
    const localidade = after.localidade || proj?.localidade || "";

    const sponsorEmail =
      proj?.sponsorEmail ||
      proj?.emailSponsor ||
      proj?.sponsor ||
      proj?.email ||
      "";

    if (!sponsorEmail) {
      logger.warn(`Projeto ${projetoId} sem sponsorEmail`);
      return;
    }

    const pend = await db
      .collection("pesquisasObras")
      .where("projetoId", "==", projetoId)
      .where("status", "==", "pendente")
      .limit(1)
      .get();

    if (!pend.empty) {
      logger.info(`Já existe pesquisa pendente para ${projetoId}.`);
      return;
    }

    const token = require("crypto").randomBytes(20).toString("hex");

    await db.collection("pesquisasObras").add({
      projetoId,
      obra,
      regional,
      localidade,
      sponsorEmail,
      token,
      status: "pendente",
      sentCount: 0,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      lastSentAt: null
    });

    const transport = buildTransport();

    if (!transport) {
      return;
    }

    const link = fmtLinkPesquisa({
      obra,
      localidade,
      regional,
      sponsorEmail,
      token
    });

    try {
      await transport.sendMail({
        from: smtp.user,
        to: sponsorEmail,
        subject: `Pesquisa de Satisfação — ${obra}`,
        html: `
          <p>Olá,</p>
          <p>A obra <b>${obra}</b> foi concluída. Por favor, responda a pesquisa:</p>
          <p><a href="${link}" target="_blank">${link}</a></p>
          <p>Obrigado!</p>
        `
      });

      logger.info(`Pesquisa enviada para ${sponsorEmail} - projeto ${projetoId}.`);
    } catch (e) {
      logger.error("Falha ao enviar e-mail de pesquisa:", e);
    }
  }
);

/* ===================================================================
   2) Marcar pesquisa como respondida
=================================================================== */

exports.onSurveyAnswered = onDocumentCreated(
  {
    document: "pesquisasRespostas/{id}"
  },
  async (event) => {
    const data = event.data?.data();

    if (!data) {
      return;
    }

    const token = String(data.tokenRef || "").trim();

    if (!token) {
      logger.warn("Resposta sem tokenRef");
      return;
    }

    const q = await db
      .collection("pesquisasObras")
      .where("token", "==", token)
      .where("status", "==", "pendente")
      .limit(1)
      .get();

    if (q.empty) {
      logger.warn("Token não encontrado ou já respondido");
      return;
    }

    await q.docs[0].ref.update({
      status: "respondida",
      respondedAt: admin.firestore.FieldValue.serverTimestamp()
    });

    logger.info("Pesquisa marcada como respondida.");
  }
);

/* ===================================================================
   3) Lembrete diário de pesquisas pendentes
=================================================================== */

exports.remindPendingSurveys = onSchedule(
  {
    schedule: "0 8 * * *",
    timeZone: "America/Sao_Paulo"
  },
  async () => {
    const transport = buildTransport();

    if (!transport) {
      return;
    }

    const pend = await db
      .collection("pesquisasObras")
      .where("status", "==", "pendente")
      .get();

    if (pend.empty) {
      logger.info("Nenhuma pesquisa pendente.");
      return;
    }

    const now = Date.now();
    const DAY = 24 * 60 * 60 * 1000;
    let enviados = 0;

    for (const docSnap of pend.docs) {
      const x = docSnap.data();
      const last = x.lastSentAt?.toDate ? x.lastSentAt.toDate().getTime() : 0;

      if (last && now - last < DAY - 5 * 60 * 1000) {
        continue;
      }

      const link = fmtLinkPesquisa({
        obra: x.obra,
        localidade: x.localidade,
        regional: x.regional,
        sponsorEmail: x.sponsorEmail,
        token: x.token
      });

      try {
        await transport.sendMail({
          from: smtp.user,
          to: x.sponsorEmail,
          subject: `Lembrete — Pesquisa de Satisfação (${x.obra})`,
          html: `
            <p>Olá,</p>
            <p>Gentileza responder a pesquisa da obra <b>${x.obra}</b>:</p>
            <p><a href="${link}" target="_blank">${link}</a></p>
            <p>Obrigado!</p>
          `
        });

        await docSnap.ref.update({
          lastSentAt: admin.firestore.FieldValue.serverTimestamp(),
          sentCount: (x.sentCount || 0) + 1
        });

        enviados++;
      } catch (e) {
        logger.error("Falha ao enviar lembrete:", e);
      }
    }

    logger.info(`Lembretes enviados: ${enviados}`);
  }
);

/* ===================================================================
   3.1) RESUMO SEMANAL DE OBRAS EM ANDAMENTO (E-MAIL)

   Envia, toda segunda-feira às 8h (America/Sao_Paulo), um e-mail com a
   lista de obras "Em andamento" para os destinatários configurados.

   O status "Em andamento" aqui é calculado com A MESMA REGRA usada no
   dashboard (dashboard.js: calcularStatusObra e funções de apoio) —
   não é só o campo `status` salvo no cadastro da obra, e sim o status
   combinado com o avanço físico mais recente lançado na Curva S. As
   funções abaixo (sufixo "Dash") são um port fiel dessas funções do
   client para o backend, só para esse e-mail — mantidas separadas das
   funções `num`/`toDate`/`canonical` já existentes (usadas pelo motor
   de indicadores) para não alterar o comportamento delas.
=================================================================== */

// Envia só para o e-mail do Cicero: o fan-out para o resto do time
// (adriana.santos.silva, crislane.campos, andre.oliveira, jeydson.cutrim,
// c0706341 — todos @vale.com) é feito por uma regra de encaminhamento
// interno no próprio Outlook, já que o SMTP corporativo está bloqueado
// e o remetente real (Gmail) não deveria mandar direto pra caixas
// externas ao domínio dele em nome da empresa.
const RESUMO_OBRAS_ANDAMENTO_EMAILS_PADRAO = [
  "cicero.garcia@vale.com"
];

function destinatariosResumoObrasAndamento() {
  const viaEnv = String(process.env.RESUMO_OBRAS_ANDAMENTO_EMAILS || "")
    .split(",")
    .map((email) => email.trim())
    .filter(Boolean);

  return viaEnv.length ? viaEnv : RESUMO_OBRAS_ANDAMENTO_EMAILS_PADRAO;
}

// ---- Utilitários de texto/número/percentual (port de dashboard.js) ----

function normalizarTextoDash(valor) {
  return String(valor || "")
    .toLowerCase()
    .trim()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

function normalizarStatusDash(valor) {
  const texto = normalizarTextoDash(valor);

  if (texto === "planejado" || texto === "planejada") {
    return "planejada";
  }

  if (
    texto === "em andamento" ||
    texto === "andamento" ||
    texto === "execucao" ||
    texto === "execução"
  ) {
    return "em andamento";
  }

  if (texto === "concluido" || texto === "concluida") {
    return "concluida";
  }

  if (texto === "paralisado" || texto === "paralisada") {
    return "paralisada";
  }

  return texto;
}

function converterValorDash(valor) {
  if (valor === null || valor === undefined || valor === "") {
    return 0;
  }

  if (typeof valor === "number") {
    if (!Number.isFinite(valor)) {
      return 0;
    }

    if (Number.isInteger(valor) && Math.abs(valor) >= 10000000) {
      return valor / 100;
    }

    return valor;
  }

  let texto = String(valor).replace(/R\$/gi, "").replace(/\s/g, "").trim();

  if (!texto) {
    return 0;
  }

  const temVirgula = texto.includes(",");
  const temPonto = texto.includes(".");
  const somenteNumeros = texto.replace(/\D/g, "");

  if (temVirgula) {
    texto = texto.replace(/\./g, "").replace(",", ".");

    const convertido = Number(texto) || 0;

    if (convertido >= 100000000 && temPonto) {
      return convertido / 100;
    }

    return convertido;
  }

  texto = texto.replace(/[^\d.-]/g, "");

  const convertido = Number(texto) || 0;

  if (
    !temVirgula &&
    !temPonto &&
    somenteNumeros.length >= 8 &&
    convertido >= 10000000
  ) {
    return convertido / 100;
  }

  return convertido;
}

function converterPercentualDash(valor) {
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

function valorTemPercentualDash(valor) {
  return String(valor || "").includes("%");
}

function limitarPercentualDash(valor) {
  const numero = Number(valor || 0);

  if (!Number.isFinite(numero)) {
    return 0;
  }

  return Math.min(Math.max(numero, 0), 100);
}

function financeiroParaPercentualDash(valorFinanceiro, valorBase) {
  const base = Number(valorBase || 0);

  if (base <= 0) {
    return 0;
  }

  return (Number(valorFinanceiro || 0) / base) * 100;
}

function percentualParaFinanceiroDash(valorPercentual, valorBase) {
  const base = Number(valorBase || 0);

  if (base <= 0) {
    return 0;
  }

  return (Number(valorPercentual || 0) / 100) * base;
}

// ---- Datas (port de dashboard.js) ----

function converterDataBRParaDateDash(valor) {
  if (!valor) {
    return null;
  }

  const partes = String(valor).trim().split("/");

  if (partes.length !== 3) {
    return null;
  }

  const data = new Date(Number(partes[2]), Number(partes[1]) - 1, Number(partes[0]));

  return isNaN(data.getTime()) ? null : data;
}

function converterDataISOParaDateDash(valor) {
  if (!valor) {
    return null;
  }

  const texto = String(valor).trim().split("T")[0];
  const match = texto.match(/^(\d{4})-(\d{2})-(\d{2})$/);

  if (!match) {
    return null;
  }

  const data = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));

  return isNaN(data.getTime()) ? null : data;
}

function obterDataGenericaDash(valor) {
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
    return isNaN(valor.getTime()) ? null : valor;
  }

  if (typeof valor === "string") {
    const texto = valor.trim();

    if (!texto) {
      return null;
    }

    if (texto.includes("/")) {
      return converterDataBRParaDateDash(texto);
    }

    if (/^\d{4}-\d{2}-\d{2}/.test(texto)) {
      return converterDataISOParaDateDash(texto);
    }
  }

  const data = new Date(valor);

  return isNaN(data.getTime()) ? null : data;
}

function formatarDataDash(data) {
  const dt = obterDataGenericaDash(data);

  return dt ? dt.toLocaleDateString("pt-BR") : "-";
}

function formatarDataHoraDash(data) {
  const dt = obterDataGenericaDash(data);

  if (!dt) {
    return "-";
  }

  const dataFmt = dt.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
  const horaFmt = dt.toLocaleTimeString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    hour: "2-digit",
    minute: "2-digit"
  });

  return `${dataFmt} ${horaFmt}`;
}

function textoUltimaAtualizacaoDash(item) {
  if (!item.ultimaAtualizacaoNome && !item.ultimaAtualizacaoData) {
    return "Sem lançamento de realizado ainda";
  }

  const nome = item.ultimaAtualizacaoNome || "desconhecido";
  const quando = formatarDataHoraDash(item.ultimaAtualizacaoData);

  return `Atualizado por ${nome} em ${quando}`;
}

function obterDataInicioObraDash(dados) {
  return obterDataGenericaDash(
    dados.dataInicio ||
    dados.dataInicioPrevisto ||
    dados.inicioPrevisto ||
    dados.inicio ||
    dados.dataInicioObra ||
    dados.dataInicial ||
    dados.inicioObra ||
    ""
  );
}

function obterDataFimObraDash(dados) {
  return obterDataGenericaDash(
    dados.dataFim ||
    dados.dataTerminoPrevisto ||
    dados.dataFimPrevisto ||
    dados.dataTermino ||
    dados.terminoPrevisto ||
    dados.termino ||
    dados.fim ||
    dados.dataFimObra ||
    dados.dataFinal ||
    dados.terminoObra ||
    ""
  );
}

function extrairDatasPeriodoDash(periodo) {
  if (!periodo) {
    return { inicio: null, fim: null };
  }

  const texto = String(periodo).replace(/\s+/g, " ").trim();

  const matchBR = texto.match(/(\d{2}\/\d{2}\/\d{4})\s*a\s*(\d{2}\/\d{2}\/\d{4})/i);

  if (matchBR) {
    return {
      inicio: converterDataBRParaDateDash(matchBR[1]),
      fim: converterDataBRParaDateDash(matchBR[2])
    };
  }

  const matchISO = texto.match(/(\d{4}-\d{2}-\d{2})\s*a\s*(\d{4}-\d{2}-\d{2})/i);

  if (matchISO) {
    return {
      inicio: converterDataISOParaDateDash(matchISO[1]),
      fim: converterDataISOParaDateDash(matchISO[2])
    };
  }

  return { inicio: null, fim: null };
}

function obterDatasDoPlanejamentoDash(item) {
  const datasPeriodo = extrairDatasPeriodoDash(item.periodo);

  let inicio = datasPeriodo.inicio;
  let fim = datasPeriodo.fim;

  if (!inicio) {
    inicio = obterDataGenericaDash(item.dataInicio || item.inicio || item.dataInicial);
  }

  if (!fim) {
    fim = obterDataGenericaDash(item.dataFim || item.fim || item.dataFinal);
  }

  return { inicio, fim };
}

// ---- Semanas / realizado / planejado (port de dashboard.js) ----

function numeroSemanaDash(valor) {
  return parseInt(String(valor || "").replace(/\D/g, "")) || 0;
}

function obterTimestampComparacaoDash(item) {
  const data = obterDataGenericaDash(
    item?.atualizadoEm || item?.criadoEm || item?.dataAtualizacao || item?.dataRegistro
  );

  return data ? data.getTime() : 0;
}

function obterFisicoRealizadoAcumuladoDash(item) {
  if (!item) {
    return 0;
  }

  if (item.fisicoRealAcum !== undefined) return converterPercentualDash(item.fisicoRealAcum);
  if (item.fisicoAcum !== undefined) return converterPercentualDash(item.fisicoAcum);
  if (item.fisicoAcumulado !== undefined) return converterPercentualDash(item.fisicoAcumulado);
  if (item.avancoFisicoAcumulado !== undefined) return converterPercentualDash(item.avancoFisicoAcumulado);
  if (item.fisicoReal !== undefined) return converterPercentualDash(item.fisicoReal);
  if (item.avancoFisicoNovo !== undefined) return converterPercentualDash(item.avancoFisicoNovo);
  if (item.avancoFisico !== undefined) return converterPercentualDash(item.avancoFisico);

  return converterPercentualDash(item.fisico || 0);
}

function obterFinanceiroRealizadoValorAcumuladoDash(item, valorBase) {
  if (!item) {
    return 0;
  }

  const candidatos = [
    item.financeiroRealAcum,
    item.financeiroAcum,
    item.financeiroRealAcumulado,
    item.financeiroAcumulado,
    item.valorExecutado,
    item.executado,
    item.financeiroReal,
    item.investimentoNovo,
    item.custoSemana,
    item.custo,
    item.financeiro
  ];

  for (const valor of candidatos) {
    if (valor === undefined || valor === null || valor === "") {
      continue;
    }

    if (valorTemPercentualDash(valor)) {
      return percentualParaFinanceiroDash(converterPercentualDash(valor), valorBase);
    }

    return converterValorDash(valor);
  }

  return 0;
}

function obterValorOrcadoObraDash(dados) {
  const camposTexto = [
    dados.valorObra, dados.valorOrcado, dados.valorOrçado, dados.investimento,
    dados.valorInvestimento, dados.orcamento, dados.orçamento, dados.orcado,
    dados.orçado, dados.valorTotal, dados.custoTotal, dados.custoOrcado,
    dados.orcadoTotal, dados.orcamentoTotal, dados.orçamentoTotal, dados.investimentoTotal
  ];

  for (const valor of camposTexto) {
    if (typeof valor !== "string") {
      continue;
    }

    const convertido = converterValorDash(valor);

    if (convertido > 0) {
      return convertido;
    }
  }

  const camposNumericos = [
    dados.valorObraNumero, dados.valorObraNumerico, dados.valorOrcadoNumero,
    dados.valorOrçadoNumero, dados.investimentoNumero, dados.investimentoTotalNumero,
    dados.valorInvestimentoNumero, dados.orcamentoNumero, dados.orçamentoNumero,
    dados.orcadoNumero, dados.orçadoNumero, dados.valorTotalNumero, dados.valorTotalNumerico,
    dados.custoTotalNumero, dados.custoOrcadoNumero, dados.valorObra, dados.valorOrcado,
    dados.valorOrçado, dados.investimento, dados.valorInvestimento, dados.orcamento,
    dados.orçamento, dados.orcado, dados.orçado, dados.valorTotal, dados.custoTotal,
    dados.custoOrcado, dados.orcadoTotal, dados.orcamentoTotal, dados.orçamentoTotal,
    dados.investimentoTotal, dados.valor, dados.custoTotal
  ];

  for (const valor of camposNumericos) {
    const convertido = converterValorDash(valor);

    if (convertido > 0) {
      return convertido;
    }
  }

  return 0;
}

function obterFinanceiroPlanejadoPercentualItemDash(item, valorBase) {
  const candidatosPercentuais = [
    item.financeiroAcumPercentual, item.financeiroPlanejadoAcumPercentual,
    item.financeiroPlanejadoPercentualAcum, item.financeiroPercentualAcum,
    item.percentualFinanceiroAcum, item.percentualFinanceiroPlanejado, item.financeiroPercentual
  ];

  for (const valor of candidatosPercentuais) {
    if (valor !== undefined && valor !== null && valor !== "") {
      return limitarPercentualDash(converterPercentualDash(valor));
    }
  }

  const candidatosAcumulados = [
    item.financeiroAcum, item.financeiroPlanejadoAcum,
    item.financeiroPlanejadoAcumulado, item.financeiroAcumulado, item.financeiroAcumuladoCalculado
  ];

  for (const valor of candidatosAcumulados) {
    if (valor === undefined || valor === null || valor === "") {
      continue;
    }

    if (valorTemPercentualDash(valor)) {
      return limitarPercentualDash(converterPercentualDash(valor));
    }

    const convertido = converterValorDash(valor);

    if (convertido <= 100) {
      return limitarPercentualDash(convertido);
    }

    return limitarPercentualDash(financeiroParaPercentualDash(convertido, valorBase));
  }

  const candidatosSemanais = [item.financeiro, item.financeiroPlanejado, item.valorPlanejado];

  for (const valor of candidatosSemanais) {
    if (valor === undefined || valor === null || valor === "") {
      continue;
    }

    if (valorTemPercentualDash(valor)) {
      return limitarPercentualDash(converterPercentualDash(valor));
    }

    const convertido = converterValorDash(valor);

    if (convertido <= 100) {
      return limitarPercentualDash(convertido);
    }

    return limitarPercentualDash(financeiroParaPercentualDash(convertido, valorBase));
  }

  return 0;
}

// ---- Match obra <-> Curva S e deduplicação (port de dashboard.js) ----

function registroPertenceAObraDash(registro, obra) {
  if (!registro || !obra) {
    return false;
  }

  const chavesObra = [
    obra.firebaseId, obra.docId, obra.idProjeto, obra.idObra,
    obra.obraId, obra.codigoObra, obra.codigo, obra.nomeProjeto
  ].filter(Boolean).map(normalizarTextoDash);

  const chavesRegistro = [
    registro.obraId, registro.idObra, registro.idProjeto, registro.projetoId,
    registro.obraDocId, registro.codigoObra, registro.codigo, registro.obra,
    registro.obraNome, registro.nomeObra, registro.nomeProjeto, registro.projeto
  ].filter(Boolean).map(normalizarTextoDash);

  if (chavesRegistro.some((chave) => chavesObra.includes(chave))) {
    return true;
  }

  const nomeObra = normalizarTextoDash(obra.nomeProjeto);

  const nomeRegistro = normalizarTextoDash(
    registro.nomeProjeto || registro.nomeObra || registro.obraNome ||
    registro.obra || registro.projeto
  );

  const centroObra = normalizarTextoDash(obra.centroCusto);

  const centroRegistro = normalizarTextoDash(
    registro.centroCusto || registro.centroDeCusto || registro.centroCustoApropriacao
  );

  if (nomeObra && nomeRegistro && nomeObra === nomeRegistro) {
    return true;
  }

  if (centroObra && centroRegistro && centroObra === centroRegistro && !nomeRegistro) {
    return true;
  }

  return false;
}

function deduplicarPorSemanaDash(lista) {
  const mapa = new Map();

  lista.forEach((item) => {
    const numero = numeroSemanaDash(item.semana);

    if (numero <= 0) {
      return;
    }

    const existente = mapa.get(numero);

    if (!existente) {
      mapa.set(numero, item);
      return;
    }

    if (obterTimestampComparacaoDash(item) >= obterTimestampComparacaoDash(existente)) {
      mapa.set(numero, item);
    }
  });

  return Array.from(mapa.values()).sort(
    (a, b) => numeroSemanaDash(a.semana) - numeroSemanaDash(b.semana)
  );
}

// ---- Status da obra (port de dashboard.js: calcularStatusObra) ----

function calcularStatusObraDash(dadosObra, executadoFisico, executadoFinanceiro) {
  const statusManual = normalizarStatusDash(
    dadosObra.status || dadosObra.statusNovo || dadosObra.fase || ""
  );

  const fisico = Number(executadoFisico || 0);
  const financeiro = Number(executadoFinanceiro || 0);

  if (statusManual === "paralisada") {
    return "Paralisada";
  }

  if (statusManual === "concluida" || fisico >= 100) {
    return "Concluída";
  }

  if (fisico > 0 && fisico < 100) {
    return "Em andamento";
  }

  if (financeiro > 0 && fisico === 0) {
    return "Paralisada";
  }

  if (statusManual === "em andamento") {
    return "Em andamento";
  }

  return "Planejada";
}

// ---- Formatação para o e-mail ----

function moedaDash(valor) {
  return Number(valor || 0).toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

function moedaCompletaDash(valor) {
  return `R$ ${moedaDash(valor)}`;
}

function percentualDash(valor) {
  return `${Number(valor || 0).toFixed(2).replace(".", ",")}%`;
}

// ---- Cálculo principal (port de dashboard.js: carregarObrasFirebase) ----

async function calcularTodasObrasComStatusDash() {
  const [obrasSnap, planSnap, realSnap] = await Promise.all([
    db.collection("obras").get(),
    db.collection("planejamentoCurvaS").get(),
    db.collection("realizadoCurvaS").get()
  ]);

  const mapDocs = (snap) =>
    snap.docs.map((d) => ({ firebaseId: d.id, docId: d.id, ...d.data() }));

  const obrasBanco = mapDocs(obrasSnap);
  const planejamentosBanco = mapDocs(planSnap);
  const realizadosBanco = mapDocs(realSnap);

  const resultado = [];
  let contadorId = 1;

  for (const dados of obrasBanco) {
    const idPadrao =
      dados.idProjeto || dados.idObra || dados.codigoObra ||
      `OBR-${String(contadorId).padStart(4, "0")}`;

    contadorId++;

    const nomeProjeto =
      dados.nomeProjeto || dados.nomeObra || dados.obraNome || dados.obra || "-";

    const investimentoObra = obterValorOrcadoObraDash(dados);

    const obraBase = {
      firebaseId: dados.firebaseId,
      docId: dados.docId,
      idProjeto: idPadrao,
      idObra: dados.idObra || "",
      obraId: dados.obraId || "",
      codigoObra: dados.codigoObra || dados.codigo || "",
      nomeProjeto,
      regional: dados.regional || dados.regiao || dados.regionalObra || "-",
      localidade: dados.localidade || "-",
      centroCusto: dados.centroCusto || dados.centroDeCusto || dados.numeroOM || "-"
    };

    let planejamentoListaResumo = deduplicarPorSemanaDash(
      planejamentosBanco.filter((item) => registroPertenceAObraDash(item, obraBase))
    );

    let dataInicioPlanejamento = null;
    let dataFimPlanejamento = null;
    let acumuladoFisicoPlanejadoResumo = 0;
    let planejadoFisicoFinal = 0;
    const planejadoFisicoPorSemana = new Map();

    planejamentoListaResumo.forEach((item) => {
      const datasPlanejamento = obterDatasDoPlanejamentoDash(item);

      if (
        datasPlanejamento.inicio &&
        (!dataInicioPlanejamento || datasPlanejamento.inicio < dataInicioPlanejamento)
      ) {
        dataInicioPlanejamento = datasPlanejamento.inicio;
      }

      if (
        datasPlanejamento.fim &&
        (!dataFimPlanejamento || datasPlanejamento.fim > dataFimPlanejamento)
      ) {
        dataFimPlanejamento = datasPlanejamento.fim;
      }

      const fisicoSemana = converterPercentualDash(item.fisico || item.fisicoPlanejado || 0);

      acumuladoFisicoPlanejadoResumo =
        item.fisicoAcum !== undefined ? converterPercentualDash(item.fisicoAcum) :
        item.fisicoAcumulado !== undefined ? converterPercentualDash(item.fisicoAcumulado) :
        acumuladoFisicoPlanejadoResumo + fisicoSemana;

      planejadoFisicoFinal = acumuladoFisicoPlanejadoResumo;

      const numeroDaSemana = numeroSemanaDash(item.semana);

      if (numeroDaSemana > 0) {
        planejadoFisicoPorSemana.set(numeroDaSemana, acumuladoFisicoPlanejadoResumo);
      }
    });

    const dataInicioExibicao = obterDataInicioObraDash(dados) || dataInicioPlanejamento;
    const dataFimExibicao = obterDataFimObraDash(dados) || dataFimPlanejamento;

    let realizadoListaResumo = deduplicarPorSemanaDash(
      realizadosBanco.filter((item) => registroPertenceAObraDash(item, obraBase))
    );

    const ultimoRealizado = realizadoListaResumo[realizadoListaResumo.length - 1];

    // Quem alimentou o último lançamento de "realizado" e quando — o campo
    // atualizadoPor* é preenchido tanto na criação quanto na correção do
    // registro (ver montarDadosRealizado em atualizar-curva-s.js), então
    // sempre reflete o último planejador que mexeu nesse dado.
    const ultimaAtualizacaoNome = ultimoRealizado
      ? (ultimoRealizado.atualizadoPorNome || ultimoRealizado.criadoPorNome || "")
      : "";

    const ultimaAtualizacaoData = ultimoRealizado
      ? (ultimoRealizado.atualizadoEm || ultimoRealizado.criadoEm || null)
      : null;

    const executadoFisico = ultimoRealizado
      ? obterFisicoRealizadoAcumuladoDash(ultimoRealizado)
      : 0;

    const executadoFinanceiro = ultimoRealizado
      ? obterFinanceiroRealizadoValorAcumuladoDash(ultimoRealizado, investimentoObra)
      : converterValorDash(dados.valorExecutado || dados.executado || 0);

    const statusCalculado = calcularStatusObraDash(dados, executadoFisico, executadoFinanceiro);

    const numeroSemanaUltimoRealizado = ultimoRealizado
      ? numeroSemanaDash(ultimoRealizado.semana)
      : 0;

    const planejadoFisicoAteSemanaAtual =
      planejadoFisicoPorSemana.get(numeroSemanaUltimoRealizado) || planejadoFisicoFinal || 0;

    const afo = planejadoFisicoAteSemanaAtual > 0
      ? (executadoFisico / planejadoFisicoAteSemanaAtual) * 100
      : 0;

    resultado.push({
      idProjeto: idPadrao,
      nomeProjeto,
      regional: obraBase.regional,
      localidade: obraBase.localidade,
      centroCusto: obraBase.centroCusto,
      dataInicioObra: dataInicioExibicao,
      dataFimObra: dataFimExibicao,
      investimento: investimentoObra,
      executado: executadoFinanceiro,
      avancoFisico: executadoFisico,
      afo,
      fase: statusCalculado,
      ultimaAtualizacaoNome,
      ultimaAtualizacaoData
    });
  }

  return resultado;
}

async function calcularResumoObrasEmAndamento() {
  const todas = await calcularTodasObrasComStatusDash();

  return todas.filter((item) => normalizarStatusDash(item.fase) === "em andamento");
}

async function calcularResumoObrasParalisadas() {
  const todas = await calcularTodasObrasComStatusDash();

  return todas.filter((item) => normalizarStatusDash(item.fase) === "paralisada");
}

// ---- Semáforo de saúde da obra (port de dashboard.js: obterCategoriaSemaforo) ----
// Mesmos limiares usados no mini-resumo do dashboard: AFO >= 95% = saudável,
// >= 90% = atenção, abaixo disso = crítica.

function obterCategoriaSemaforoDash(afo) {
  const valor = Number(afo || 0);

  if (valor >= 95) {
    return "saudavel";
  }

  if (valor >= 90) {
    return "atencao";
  }

  return "critica";
}

// Obra sem nenhum lançamento de avanço físico/financeiro ainda dá
// AFO = 0 (0 dividido por qualquer planejado), o que cai na faixa de
// "crítica" — mas isso não é uma obra atrasada, é uma obra que ainda
// não teve nenhuma semana atualizada. Trata como categoria própria pra
// não soar alarme falso.
function obraSemLancamentoDash(item) {
  return Number(item.avancoFisico || 0) === 0 && Number(item.executado || 0) === 0;
}

function linhaObraHtmlDash(item) {
  const desvio = item.investimento - item.executado;
  const corDesvio = desvio < 0 ? "#C0392B" : "#0B2545";

  const corAfo =
    item.afo >= 95 ? "#1E824C" :
    item.afo >= 90 ? "#C77700" :
    "#C0392B";

  return `
    <tr>
      <td style="padding:6px 8px;border:1px solid #eee;">${item.idProjeto}</td>
      <td style="padding:6px 8px;border:1px solid #eee;">${item.nomeProjeto}</td>
      <td style="padding:6px 8px;border:1px solid #eee;">${item.localidade}</td>
      <td style="padding:6px 8px;border:1px solid #eee;text-align:center;">${formatarDataDash(item.dataInicioObra)}</td>
      <td style="padding:6px 8px;border:1px solid #eee;text-align:center;">${formatarDataDash(item.dataFimObra)}</td>
      <td style="padding:6px 8px;border:1px solid #eee;text-align:center;">${item.centroCusto}</td>
      <td style="padding:6px 8px;border:1px solid #eee;text-align:right;">${moedaCompletaDash(item.investimento)}</td>
      <td style="padding:6px 8px;border:1px solid #eee;text-align:right;">${moedaCompletaDash(item.executado)}</td>
      <td style="padding:6px 8px;border:1px solid #eee;text-align:right;color:${corDesvio};">${moedaCompletaDash(desvio)}</td>
      <td style="padding:6px 8px;border:1px solid #eee;text-align:center;">${percentualDash(item.avancoFisico)}</td>
      <td style="padding:6px 8px;border:1px solid #eee;text-align:center;color:${corAfo};font-weight:700;">${percentualDash(item.afo)}</td>
      <td style="padding:6px 8px;border:1px solid #eee;font-size:11px;color:#555;">${textoUltimaAtualizacaoDash(item)}</td>
    </tr>
  `;
}

function tabelaObrasHtmlDash(lista) {
  const corpoTabela = lista.length
    ? lista.map(linhaObraHtmlDash).join("")
    : `<tr><td colspan="12" style="padding:12px;text-align:center;">Nenhuma obra nesta categoria.</td></tr>`;

  return `
    <div style="overflow-x:auto;">
      <table style="border-collapse:collapse;width:100%;font-size:12px;margin-bottom:20px;">
        <thead>
          <tr style="background:#007E7A;color:#fff;">
            <th style="padding:8px;">ID</th>
            <th style="padding:8px;">Nome Obra</th>
            <th style="padding:8px;">Localidade</th>
            <th style="padding:8px;">Dt Início</th>
            <th style="padding:8px;">Dt Conclusão</th>
            <th style="padding:8px;">Centro Custo</th>
            <th style="padding:8px;">Orçado(R$)</th>
            <th style="padding:8px;">Executado(R$)</th>
            <th style="padding:8px;">Desvio(R$)</th>
            <th style="padding:8px;">Físico(%)</th>
            <th style="padding:8px;">AFO(%)</th>
            <th style="padding:8px;">Última Atualização</th>
          </tr>
        </thead>
        <tbody>
          ${corpoTabela}
        </tbody>
      </table>
    </div>
  `;
}

function blocoCategoriaHtmlDash(titulo, cor, lista) {
  return `
    <h3 style="color:${cor};border-left:4px solid ${cor};padding-left:8px;margin:20px 0 8px;">
      ${titulo} (${lista.length})
    </h3>
    ${tabelaObrasHtmlDash(lista)}
  `;
}

function linhaObraParalisadaHtmlDash(item) {
  return `
    <tr>
      <td style="padding:6px 8px;border:1px solid #eee;">${item.idProjeto}</td>
      <td style="padding:6px 8px;border:1px solid #eee;">${item.nomeProjeto}</td>
      <td style="padding:6px 8px;border:1px solid #eee;">${item.regional}</td>
      <td style="padding:6px 8px;border:1px solid #eee;">${item.localidade}</td>
      <td style="padding:6px 8px;border:1px solid #eee;text-align:center;">${percentualDash(item.avancoFisico)}</td>
    </tr>
  `;
}

function tabelaObrasParalisadasHtmlDash(lista) {
  const corpoTabela = lista.length
    ? lista.map(linhaObraParalisadaHtmlDash).join("")
    : `<tr><td colspan="5" style="padding:12px;text-align:center;">Nenhuma obra paralisada.</td></tr>`;

  return `
    <div style="overflow-x:auto;">
      <table style="border-collapse:collapse;width:100%;font-size:12px;margin-bottom:20px;">
        <thead>
          <tr style="background:#7f8c8d;color:#fff;">
            <th style="padding:8px;">ID</th>
            <th style="padding:8px;">Nome Obra</th>
            <th style="padding:8px;">Regional</th>
            <th style="padding:8px;">Localidade</th>
            <th style="padding:8px;">Físico(%)</th>
          </tr>
        </thead>
        <tbody>
          ${corpoTabela}
        </tbody>
      </table>
    </div>
  `;
}

function blocoObrasParalisadasHtmlDash(lista) {
  return `
    <h3 style="color:#5f6b6d;border-left:4px solid #5f6b6d;padding-left:8px;margin:20px 0 8px;">
      ⏸ Paralisadas (${lista.length})
    </h3>
    ${tabelaObrasParalisadasHtmlDash(lista)}
  `;
}

function montarHtmlResumoObrasEmAndamento(lista, paralisadas = []) {
  const semLancamento = lista.filter(obraSemLancamentoDash);
  const criticas = lista.filter(
    (item) => !obraSemLancamentoDash(item) && obterCategoriaSemaforoDash(item.afo) === "critica"
  );
  const atencao = lista.filter((item) => obterCategoriaSemaforoDash(item.afo) === "atencao");
  const saudaveis = lista.filter((item) => obterCategoriaSemaforoDash(item.afo) === "saudavel");

  return `
    <div style="font-family:'Segoe UI',Arial,sans-serif;color:#1a1a1a;">
      <h2 style="color:#007E7A;margin-bottom:4px;">Obras em andamento</h2>
      <p style="margin-top:0;color:#444;">
        Resumo semanal automático — ${lista.length} obra(s) em andamento
        (mesmo critério de saúde do dashboard, baseado no AFO):
        <span style="color:#C0392B;font-weight:700;">${criticas.length} crítica(s)</span> ·
        <span style="color:#C77700;font-weight:700;">${atencao.length} em atenção</span> ·
        <span style="color:#1E824C;font-weight:700;">${saudaveis.length} saudável(is)</span> ·
        <span style="color:#5f6b6d;font-weight:700;">${semLancamento.length} sem lançamento</span>
        · <span style="color:#5f6b6d;font-weight:700;">${paralisadas.length} paralisada(s)</span>.
      </p>

      ${blocoCategoriaHtmlDash("🔴 Críticas — AFO abaixo de 90%", "#C0392B", criticas)}
      ${blocoCategoriaHtmlDash("🟡 Atenção — AFO entre 90% e 94,99%", "#C77700", atencao)}
      ${blocoCategoriaHtmlDash("🟢 Saudáveis — AFO igual ou acima de 95%", "#1E824C", saudaveis)}
      ${blocoCategoriaHtmlDash("⚪ Sem lançamento — nenhum avanço físico/financeiro registrado ainda", "#7f8c8d", semLancamento)}
      ${blocoObrasParalisadasHtmlDash(paralisadas)}

      <p style="color:#94a3b8;font-size:11px;margin-top:16px;">
        E-mail automático gerado pelo sistema de Gestão de Obras. Não responda esta mensagem.
      </p>
    </div>
  `;
}

// Versão em texto puro do mesmo resumo, para WhatsApp (CallMeBot não
// suporta HTML nem "cards" de verdade — só a formatação nativa do
// WhatsApp: *negrito*, _itálico_ e linhas divisórias com caractere
// repetido, que é o truque padrão pra simular um cabeçalho/cartão).
//
// Retorna um ARRAY de mensagens (não uma string só): com muitas obras
// saudáveis, o texto único passava de algum limite de tamanho do
// CallMeBot e a cauda da mensagem (justamente a seção de saudáveis)
// chegava cortada no WhatsApp. Quebrando em partes menores, cada
// mensagem individual fica bem abaixo desse limite.
function montarPartesResumoObrasEmAndamento(lista, paralisadas = []) {
  const semLancamento = lista.filter(obraSemLancamentoDash);
  const criticas = lista.filter(
    (item) => !obraSemLancamentoDash(item) && obterCategoriaSemaforoDash(item.afo) === "critica"
  );
  const atencao = lista.filter((item) => obterCategoriaSemaforoDash(item.afo) === "atencao");
  const saudaveis = lista.filter((item) => obterCategoriaSemaforoDash(item.afo) === "saudavel");

  // "▬" (bloco largo) quebra em duas linhas em telas estreitas de celular
  // e fica com aparência de linha "cortada" — "─" é mais fino e cabe
  // numa linha só na maioria dos aparelhos.
  const divisor = "─".repeat(18);

  // Críticas/atenção precisam de mais contexto (é onde a atenção do
  // gestor deve ir), então ficam com bloco completo. Saudáveis entram
  // resumidas numa linha só — com muitas obras saudáveis, o bloco
  // completo deixava a mensagem longa demais e o CallMeBot cortava o
  // final do texto (cauda perdida, que era justamente essa seção).
  const linhaDetalhada = (item) =>
    [
      `*${item.nomeProjeto}*`,
      `📍 ${item.localidade}`,
      `📈 Físico ${percentualDash(item.avancoFisico)} · AFO ${percentualDash(item.afo)}`,
      `💰 Orçado ${moedaCompletaDash(item.investimento)} · Executado ${moedaCompletaDash(item.executado)}`,
      `🕒 _${textoUltimaAtualizacaoDash(item)}_`
    ].join("\n");

  const linhaResumida = (item) =>
    `✅ *${item.nomeProjeto}* (${item.localidade}) — AFO ${percentualDash(item.afo)}`;

  const linhaSemLancamento = (item) =>
    `⚪ *${item.nomeProjeto}* (${item.localidade})`;

  const linhaParalisada = (item) =>
    `⏸ *${item.nomeProjeto}*\n  ${item.regional} · ${item.localidade} · Físico ${percentualDash(item.avancoFisico)}`;

  const blocoLista = (itens, linha, separador) =>
    itens.length ? itens.map(linha).join(separador) : "Nenhuma.";

  const secao = (titulo, subtitulo, itens, linha = linhaDetalhada, separador = "\n\n") =>
    [`${titulo} _(${subtitulo})_`, ``, blocoLista(itens, linha, separador), divisor].join("\n");

  const dataEnvio = new Date().toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });

  const parte1 = [
    `📊 *RESUMO SEMANAL — OBRAS EM ANDAMENTO*`,
    divisor,
    `🗓️ ${dataEnvio}`,
    ``,
    `*Total:* ${lista.length} obra(s)`,
    `🔴 ${criticas.length} crítica(s)  ·  🟡 ${atencao.length} atenção  ·  🟢 ${saudaveis.length} saudável(is)  ·  ⚪ ${semLancamento.length} sem lançamento`,
    divisor,
    ``,
    secao("🔴 *CRÍTICAS*", "AFO abaixo de 90%", criticas),
    ``,
    secao("🟡 *ATENÇÃO*", "AFO entre 90% e 94,99%", atencao)
  ].join("\n");

  const parte2 = [
    secao(
      "🟢 *SAUDÁVEIS*",
      "AFO igual ou acima de 95%",
      saudaveis,
      linhaResumida,
      "\n"
    ),
    ``,
    secao(
      "⚪ *SEM LANÇAMENTO*",
      "nenhum avanço registrado ainda",
      semLancamento,
      linhaSemLancamento,
      "\n"
    )
  ].join("\n");

  const parte3 = [
    `⏸ *PARALISADAS* (${paralisadas.length})`,
    ``,
    blocoLista(paralisadas, linhaParalisada, "\n\n")
  ].join("\n");

  return [parte1, parte2, parte3];
}

exports.enviarResumoObrasEmAndamentoSemanal = onSchedule(
  {
    schedule: "0 8 * * 1",
    timeZone: "America/Sao_Paulo"
  },
  async () => {
    const transport = buildTransport();

    if (!transport) {
      logger.warn("enviarResumoObrasEmAndamentoSemanal: SMTP não configurado, e-mail não enviado.");
      return;
    }

    const destinatarios = destinatariosResumoObrasAndamento();

    if (!destinatarios.length) {
      logger.warn("enviarResumoObrasEmAndamentoSemanal: nenhum destinatário configurado.");
      return;
    }

    try {
      const lista = await calcularResumoObrasEmAndamento();
      const paralisadas = await calcularResumoObrasParalisadas();
      const html = montarHtmlResumoObrasEmAndamento(lista, paralisadas);

      await transport.sendMail({
        from: smtp.user,
        to: destinatarios.join(","),
        subject: `Resumo Semanal — ${lista.length} Obra(s) em Andamento`,
        html
      });

      logger.info(
        `[enviarResumoObrasEmAndamentoSemanal] E-mail enviado. obras=${lista.length} destinatarios=${destinatarios.length}`
      );

      try {
        const partesWhatsApp = montarPartesResumoObrasEmAndamento(lista, paralisadas);
        const resultadosWhatsApp = await enviarWhatsAppCallMeBotEmPartes(partesWhatsApp);
        const enviados = resultadosWhatsApp.filter((r) => r.ok).length;

        logger.info(
          `[enviarResumoObrasEmAndamentoSemanal] WhatsApp: ${enviados}/${partesWhatsApp.length} parte(s) enviada(s)`
        );
      } catch (eWhatsApp) {
        logger.error("[enviarResumoObrasEmAndamentoSemanal] Falha ao enviar WhatsApp:", eWhatsApp);
      }
    } catch (e) {
      logger.error("[enviarResumoObrasEmAndamentoSemanal] Falha ao gerar/enviar resumo:", e);
    }
  }
);

/* ===================================================================
   3.2) TESTE MANUAL DO RESUMO SEMANAL (sem esperar segunda-feira)

   Endpoint HTTP protegido por login de administrador (mesmo esquema de
   exigirAdminHttp usado em backfillRollups/recomputeIndicators). Gera e
   envia o MESMO e-mail do resumo semanal, mas só para o endereço
   informado — não mexe nos destinatários reais, então dá pra testar
   quantas vezes quiser sem incomodar o resto do time.

   Uso (depois de dar deploy):
     https://SEU-HOST-DAS-FUNCTIONS/testarResumoObrasEmAndamento?email=voce@vale.com
   com o header "Authorization: Bearer <ID token de um admin>".
=================================================================== */

exports.testarResumoObrasEmAndamento = onRequest(
  {
    region: "us-central1",
    memory: "512MiB",
    timeoutSeconds: 120,
    // CORS liberado só para este endpoint de teste, pra dar pra chamar
    // com fetch() direto do console do navegador (sem precisar de
    // terminal/curl) — continua exigindo login de admin (exigirAdminHttp).
    cors: true
  },
  async (req, res) => {
    try {
      const decoded = await exigirAdminHttp(req);

      const transport = buildTransport();

      if (!transport) {
        return res.status(503).send("SMTP não configurado (variáveis SMTP_* ausentes).");
      }

      const emailDestino = String(req.query.email || decoded.email || "").trim();

      if (!emailDestino) {
        return res.status(400).send(
          "Informe o e-mail de destino em ?email=voce@vale.com"
        );
      }

      const lista = await calcularResumoObrasEmAndamento();
      const paralisadas = await calcularResumoObrasParalisadas();

      const avisoTeste = `
        <div style="background:#fff3cd;border:1px solid #ffe69c;padding:10px 14px;margin-bottom:12px;font-family:'Segoe UI',Arial,sans-serif;font-size:13px;">
          <strong>Este é um envio de TESTE</strong>, disparado manualmente por ${decoded.email || decoded.uid}.
          O envio real acontece toda segunda-feira às 8h para a lista oficial de destinatários.
        </div>
      `;

      const html = avisoTeste + montarHtmlResumoObrasEmAndamento(lista, paralisadas);

      await transport.sendMail({
        from: smtp.user,
        to: emailDestino,
        subject: `[TESTE] Resumo Semanal — ${lista.length} Obra(s) em Andamento`,
        html
      });

      logger.info(
        `[testarResumoObrasEmAndamento] Teste enviado para ${emailDestino} por ${decoded.email || decoded.uid}. obras=${lista.length}`
      );

      return res.status(200).send(
        `OK: e-mail de teste enviado para ${emailDestino}. Obras em andamento encontradas: ${lista.length}.`
      );
    } catch (e) {
      logger.error("[testarResumoObrasEmAndamento] erro:", e);

      return res
        .status(e.statusCode || 500)
        .send(e.statusCode ? e.message : "Erro ao enviar e-mail de teste.");
    }
  }
);

/* ===================================================================
   3.3) TESTE MANUAL DO RESUMO SEMANAL POR WHATSAPP (CallMeBot)

   Mesmo esquema de proteção do teste por e-mail (login de admin via
   exigirAdminHttp). Manda pro número já configurado em CALLMEBOT_PHONE
   (o CallMeBot só manda pro número que autorizou o bot, não dá pra
   escolher destinatário livremente).

   Uso (depois de dar deploy):
     https://SEU-HOST-DAS-FUNCTIONS/testarResumoObrasWhatsApp
   com o header "Authorization: Bearer <ID token de um admin>".
=================================================================== */

exports.testarResumoObrasWhatsApp = onRequest(
  {
    region: "us-central1",
    memory: "512MiB",
    timeoutSeconds: 120,
    cors: true
  },
  async (req, res) => {
    try {
      const decoded = await exigirAdminHttp(req);

      if (!callmebot.phone || !callmebot.apikey) {
        return res.status(503).send(
          "CallMeBot não configurado (variáveis CALLMEBOT_PHONE/CALLMEBOT_APIKEY ausentes)."
        );
      }

      const lista = await calcularResumoObrasEmAndamento();
      const paralisadas = await calcularResumoObrasParalisadas();
      const partes = montarPartesResumoObrasEmAndamento(lista, paralisadas);

      partes[0] = `[TESTE disparado por ${decoded.email || decoded.uid}]\n\n${partes[0]}`;

      const resultados = await enviarWhatsAppCallMeBotEmPartes(partes);
      const enviados = resultados.filter((r) => r.ok).length;

      logger.info(
        `[testarResumoObrasWhatsApp] Teste enviado por ${decoded.email || decoded.uid}. obras=${lista.length} partes=${enviados}/${partes.length}`
      );

      return res.status(200).send(
        `OK: ${enviados}/${partes.length} mensagem(ns) de teste enviada(s) via WhatsApp. Obras em andamento encontradas: ${lista.length}.`
      );
    } catch (e) {
      logger.error("[testarResumoObrasWhatsApp] erro:", e);

      return res
        .status(e.statusCode || 500)
        .send(e.statusCode ? e.message : "Erro ao enviar WhatsApp de teste.");
    }
  }
);

/* ===================================================================
   4) Motor de Indicadores - Rollups por ciclo
=================================================================== */

async function normalizeWeeklyDoc(projId, semId, data) {
  const projSnap = await db.collection("projetos").doc(projId).get();
  const p = projSnap.exists ? projSnap.data() : {};

  const regional = p?.regional || p?.regionalNome || "";
  const localidade = p?.localidade || p?.cidade || "";
  const nomeObra = p?.nomeProjeto || p?.nome || p?.projeto || projId;

  const fim =
    toDate(data.fimSemanaUTC) ||
    toDate(data.fim) ||
    toDate(data.semanaISO) ||
    toDate(data.semana) ||
    toDate(data.inicioSemanaUTC) ||
    new Date();

  const { ano, ciclo } = cicloDoDia(fim);

  const patch = {
    ano,
    ciclo,
    regionalCanon: canonical(regional),
    localidadeCanon: canonical(localidade),
    obraCanon: canonical(nomeObra)
  };

  const needUpdate = [
    "ano",
    "ciclo",
    "regionalCanon",
    "localidadeCanon",
    "obraCanon"
  ].some((k) => data[k] === undefined);

  if (needUpdate) {
    await db
      .collection("projetos")
      .doc(projId)
      .collection("cronogramaSemanal")
      .doc(semId)
      .set(patch, { merge: true });
  }

  return {
    ano,
    ciclo,
    meta: {
      regional,
      localidade,
      nomeObra
    }
  };
}

async function recomputeRollupForCycle(projId, ano, ciclo, metaHint) {
  const semRef = db
    .collection("projetos")
    .doc(projId)
    .collection("cronogramaSemanal");

  const q = await semRef
    .where("ano", "==", ano)
    .where("ciclo", "==", ciclo)
    .get();

  let fisPlan = 0;
  let fisExec = 0;
  let finPlan = 0;
  let finExec = 0;
  let lastUpd = null;

  q.forEach((docSnap) => {
    const d = docSnap.data() || {};

    fisPlan += num(
      d.avancFisicoPlanejado ||
      d.fisicoPlanejado ||
      d.percPlanFis ||
      d.fisico_plan
    );

    fisExec += num(
      d.avancFisicoExecutado ||
      d.fisicoExecutado ||
      d.percExecFis ||
      d.fisico_exec
    );

    finPlan += num(
      d.valorPlanejado ||
      d.valorPlanejadoSemanal ||
      d.financeiroPlanejado ||
      d.valor_plan
    );

    finExec += num(
      d.valorExecutado ||
      d.valorExecutadoSemanal ||
      d.financeiroExecutado ||
      d.valor_exec
    );

    const upd = toDate(
      d.atualizadoEm ||
      d.updatedAt ||
      d.updateAt ||
      d.atualizado
    );

    if (upd && (!lastUpd || upd > lastUpd)) {
      lastUpd = upd;
    }
  });

  const projSnap = await db.collection("projetos").doc(projId).get();
  const p = projSnap.exists ? projSnap.data() : {};

  const regional = p?.regional || p?.regionalNome || metaHint?.regional || "";
  const localidade = p?.localidade || p?.cidade || metaHint?.localidade || "";
  const nomeObra = p?.nomeProjeto || p?.nome || p?.projeto || metaHint?.nomeObra || projId;

  const rawStatus = p?.status || p?.situacao || p?.["situação"] || "";
  const s = canonical(rawStatus);

  let statusCanon = "em_execucao";

  if (/conclu|finaliz|encerr|entreg|complet|fechad/.test(s)) {
    statusCanon = "concluido";
  }

  const adFisico = fisPlan > 0 ? (fisExec / fisPlan) * 100 : null;
  const adFinanceiro = finPlan > 0 ? (finExec / finPlan) * 100 : null;

  const payload = {
    ano,
    ciclo,
    projetoId: projId,
    nomeProjeto: nomeObra,
    regional,
    localidade,
    regionalCanon: canonical(regional),
    localidadeCanon: canonical(localidade),
    obraCanon: canonical(nomeObra),
    statusCanon,
    fisicoPlanPct: +Number(fisPlan).toFixed(3),
    fisicoExecPct: +Number(fisExec).toFixed(3),
    finPlanValor: +Number(finPlan).toFixed(2),
    finExecValor: +Number(finExec).toFixed(2),
    adFisicoPct: adFisico == null ? null : +Number(adFisico).toFixed(2),
    adFinanceiroPct: adFinanceiro == null ? null : +Number(adFinanceiro).toFixed(2),
    lastUpdatedAt: lastUpd
      ? admin.firestore.Timestamp.fromDate(lastUpd)
      : admin.firestore.FieldValue.serverTimestamp()
  };

  await db
    .collection("projetos")
    .doc(projId)
    .collection("rollups")
    .doc(`${ano}-${ciclo}`)
    .set(payload, { merge: true });

  await db
    .collection("rollupsIndicadores")
    .doc(`${ano}-${ciclo}-${projId}`)
    .set(payload, { merge: true });
}

exports.rollupCronogramaSemanalV2 = onDocumentWritten(
  {
    document: "projetos/{projId}/cronogramaSemanal/{semId}"
  },
  async (event) => {
    const { projId, semId } = event.params || {};
    const after = event.data?.after?.data();
    const before = event.data?.before?.data();
    const base = after || before || {};

    if (!projId || !semId) {
      return;
    }

    try {
      const { ano, ciclo, meta } = await normalizeWeeklyDoc(projId, semId, base);
      await recomputeRollupForCycle(projId, ano, ciclo, meta);

      logger.info(`[rollup] OK projeto=${projId} ciclo=${ano}-${ciclo}`);
    } catch (e) {
      logger.error("[rollup] falha:", e);
    }
  }
);

exports.backfillRollups = onRequest(
  {
    region: "us-central1",
    memory: "512MiB",
    timeoutSeconds: 540,
    enforceAppCheck: true
  },
  async (req, res) => {
    try {
      // SEGURANÇA: não existe mais valor padrão ("TROQUE-ESTA-CHAVE").
      // Se a chave não estiver configurada em functions:config, o
      // endpoint falha fechado (nega o acesso) em vez de aceitar um
      // token adivinhável/conhecido publicamente.
      const expected = String(appCfg.rollup_token || "");

      if (!expected) {
        logger.error("backfillRollups: appCfg.rollup_token não configurado.");
        return res.status(503).send("Endpoint não configurado.");
      }

      const token = String(req.query.token || "");

      if (
        token.length !== expected.length ||
        !require("crypto").timingSafeEqual(
          Buffer.from(token),
          Buffer.from(expected)
        )
      ) {
        return res.status(401).send("unauthorized");
      }

      // Além do token, exige também um admin autenticado.
      await exigirAdminHttp(req);

      const projSnap = await db.collection("projetos").get();

      let updated = 0;
      let obras = 0;

      for (const pDoc of projSnap.docs) {
        const projId = pDoc.id;

        const semSnap = await db
          .collection("projetos")
          .doc(projId)
          .collection("cronogramaSemanal")
          .get();

        if (semSnap.empty) {
          continue;
        }

        obras++;

        const combos = new Set();

        for (const sDoc of semSnap.docs) {
          const d = sDoc.data() || {};
          const norm = await normalizeWeeklyDoc(projId, sDoc.id, d);

          combos.add(`${norm.ano}-${norm.ciclo}`);
        }

        for (const k of combos) {
          const [ano, ciclo] = k.split("-").map(Number);

          await recomputeRollupForCycle(projId, ano, ciclo);
          updated++;
        }
      }

      return res
        .status(200)
        .send(`Backfill concluído. Obras: ${obras}, rollups atualizados: ${updated}`);
    } catch (e) {
      logger.error("Backfill erro:", e);
      return res.status(e.statusCode || 500).send(e.statusCode ? e.message : "erro");
    }
  }
);

/* ===================================================================
   5) Indicadores por obra
=================================================================== */

function isoWeekId(dateLike) {
  const date = new Date(dateLike);
  const dayNum = (date.getUTCDay() + 6) % 7;

  date.setUTCDate(date.getUTCDate() - dayNum + 3);

  const firstThursday = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));

  const week =
    1 +
    Math.round(
      ((date - firstThursday) / 86400000 -
        3 +
        ((firstThursday.getUTCDay() + 6) % 7)) /
        7
    );

  return `${date.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

function ymId(dateLike) {
  const d = new Date(dateLike);

  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

const THIS_YEAR = () => new Date().getFullYear();

async function readProjeto(projectId) {
  const snap = await db.collection("projetos").doc(projectId).get();

  return snap.exists
    ? {
      id: snap.id,
      ...snap.data()
    }
    : null;
}

async function readCronoSemanalLatest(projectId) {
  const sub = await db
    .collection("projetos")
    .doc(projectId)
    .collection("cronogramaSemanal")
    .orderBy("semanaIso", "desc")
    .limit(1)
    .get();

  if (!sub.empty) {
    return {
      path: "sub",
      data: sub.docs[0].data()
    };
  }

  const top = await db
    .collection("cronogramaSemanal")
    .where("projectId", "==", projectId)
    .orderBy("semanaIso", "desc")
    .limit(1)
    .get();

  if (!top.empty) {
    return {
      path: "top",
      data: top.docs[0].data()
    };
  }

  return null;
}

async function readCustos(projectId, semanaIso, yyyyMM) {
  const qSemana = await db
    .collection("custos")
    .where("projectId", "==", projectId)
    .where("semanaIso", "==", semanaIso)
    .get();

  let custoSemana = 0;

  qSemana.forEach((d) => {
    custoSemana += num(d.data().valor || 0);
  });

  const qMes = await db
    .collection("custos")
    .where("projectId", "==", projectId)
    .where("yyyyMM", "==", yyyyMM.replace("-", ""))
    .get();

  let custoMes = 0;

  qMes.forEach((d) => {
    custoMes += num(d.data().valor || 0);
  });

  const qAno = await db
    .collection("custos")
    .where("projectId", "==", projectId)
    .where("ano", "==", THIS_YEAR())
    .get();

  let custoAno = 0;

  qAno.forEach((d) => {
    custoAno += num(d.data().valor || 0);
  });

  return {
    custoSemana,
    custoMes,
    custoAno
  };
}

async function computeIndicatorsForProject(projectId) {
  const projeto = await readProjeto(projectId);

  if (!projeto) {
    return;
  }

  const agora = new Date();
  const semanaId = isoWeekId(agora);
  const mesId = ymId(agora);

  const crono = await readCronoSemanalLatest(projectId);

  const { custoSemana, custoMes, custoAno } = await readCustos(
    projectId,
    semanaId,
    mesId
  );

  const categoria = String(
    projeto.categoriaObra ||
    projeto.categoria ||
    ""
  ).toLowerCase();

  const status = String(projeto.status || "Planejado");
  const regional = projeto.regional || "";
  const localidade = projeto.localidade || "";
  const nomeProjeto = projeto.nomeProjeto || projeto.nome || "";

  const areaConstruida = num(projeto.areaConstruida);
  const areaReformada = num(projeto.areaReformada);
  const areaPavimentada = num(projeto.areaPavimentada);

  const gravidade = num(projeto.gravidade);
  const urgencia = num(projeto.urgencia);
  const tendencia = num(projeto.tendencia);
  const prioridadeGUT = gravidade * urgencia * tendencia || 0;

  const adFisico =
    crono?.data?.adFisico != null
      ? num(crono.data.adFisico)
      : num(projeto.avancoFisico);

  const orcado = num(projeto.custoAtualizado || projeto.custoOrcado);
  const adFinanceiro = orcado > 0 ? (custoAno / orcado) * 100 : 0;

  const cm2Construcao = safeDiv(custoSemana, areaConstruida);
  const cm2Reforma = safeDiv(custoSemana, areaReformada);
  const cm2Pavimentacao = safeDiv(custoSemana, areaPavimentada);

  const base = {
    projectId,
    projectNome: nomeProjeto,
    regional,
    localidade,
    categoriaObra: categoria,
    status,
    dataInicioReal: projeto.dataInicioReal || projeto.dataInicio || null,
    dataFimReal: projeto.dataFimReal || projeto.dataTermino || null,
    gravidade,
    urgencia,
    tendencia,
    prioridadeGUT,
    custoOrcado: num(projeto.custoOrcado),
    custoAtualizado: num(projeto.custoAtualizado || projeto.custoOrcado),
    custoExecutadoPeriodo: custoSemana,
    custoExecutadoAcumuladoAno: custoAno,
    areaConstruida,
    areaReformada,
    areaPavimentada,
    cm2Construcao,
    cm2Reforma,
    cm2Pavimentacao,
    adFisico,
    adFinanceiro,
    lastComputedAt: new Date().toISOString(),
    version: "v1.0",
    sources: {
      usouCronogramaSemanal: Boolean(crono),
      usouCustos: true
    }
  };

  await db
    .collection("indicadoresObra_snapshot")
    .doc(projectId)
    .set(
      {
        ...base,
        periodoTipo: "SNAPSHOT",
        periodoId: "_"
      },
      {
        merge: true
      }
    );

  await db
    .collection("indicadoresObra_semanal")
    .doc(`${projectId}_${semanaId}`)
    .set(
      {
        ...base,
        periodoTipo: "SEMANA",
        periodoId: semanaId
      },
      {
        merge: true
      }
    );

  await db
    .collection("indicadoresObra_mensal")
    .doc(`${projectId}_${mesId}`)
    .set(
      {
        ...base,
        periodoTipo: "MES",
        periodoId: mesId,
        custoExecutadoPeriodo: custoMes
      },
      {
        merge: true
      }
    );
}

exports.onProjetoWriteIndicators = onDocumentWritten(
  {
    document: "projetos/{projectId}"
  },
  async (event) => {
    const { projectId } = event.params;

    await computeIndicatorsForProject(projectId);
  }
);

exports.onCronogramaWriteTopIndicators = onDocumentWritten(
  {
    document: "cronogramaSemanal/{docId}"
  },
  async (event) => {
    const after = event.data?.after?.data();
    const projectId = after?.projectId;

    if (projectId) {
      await computeIndicatorsForProject(projectId);
    }
  }
);

exports.onCronogramaWriteSubIndicators = onDocumentWritten(
  {
    document: "projetos/{projectId}/cronogramaSemanal/{semanaId}"
  },
  async (event) => {
    const { projectId } = event.params;

    await computeIndicatorsForProject(projectId);
  }
);

exports.onCustoWriteIndicators = onDocumentWritten(
  {
    document: "custos/{movId}"
  },
  async (event) => {
    const after = event.data?.after?.data();
    const projectId = after?.projectId;

    if (projectId) {
      await computeIndicatorsForProject(projectId);
    }
  }
);

exports.recomputeIndicators = onRequest(
  {
    region: "us-central1",
    memory: "512MiB",
    timeoutSeconds: 300,
    enforceAppCheck: true
  },
  async (req, res) => {
    try {
      // SEGURANÇA: este endpoint era público (onRequest sem checagem
      // nenhuma), permitindo que qualquer pessoa na internet disparasse
      // recomputação em massa de TODOS os projetos (custo/DoS). Agora
      // exige um usuário administrador autenticado.
      await exigirAdminHttp(req);

      const projectId = req.query.projectId && String(req.query.projectId);

      if (projectId) {
        await computeIndicatorsForProject(projectId);

        return res.status(200).send({
          ok: true,
          projectId
        });
      }

      const snaps = await db.collection("projetos").get();
      const ids = snaps.docs.map((d) => d.id);

      for (const id of ids) {
        await computeIndicatorsForProject(id);
      }

      return res.status(200).send({
        ok: true,
        processed: ids.length
      });
    } catch (e) {
      logger.error("recomputeIndicators erro:", e);

      return res.status(e.statusCode || 500).send({
        ok: false,
        error: e.statusCode ? e.message : String(e)
      });
    }
  }
);

/* ===================================================================
   6) EXCLUIR OBRA COMPLETA
=================================================================== */

function textoSeguro(valor) {
  return String(valor || "").trim();
}

function valorValidoParaBusca(valor) {
  const texto = textoSeguro(valor);

  if (!texto) {
    return "";
  }

  if (texto === "-") {
    return "";
  }

  return texto;
}

function gerarChavesObra(dados = {}, entrada = {}) {
  const valores = [
    entrada.obraDocId,
    entrada.codigoObra,
    entrada.nomeObra,
    entrada.colecaoOrigem,

    dados.id,
    dados.uid,
    dados.docId,
    dados.obraDocId,
    dados.obraId,
    dados.idObra,
    dados.codigoObra,
    dados.codigo,
    dados.idProjeto,
    dados.projetoId,
    dados.projectId,
    dados.nomeProjeto,
    dados.nomeObra,
    dados.obraNome,
    dados.obra,
    dados.projeto,
    dados.titulo
  ];

  return [
    ...new Set(
      valores
        .map(valorValidoParaBusca)
        .filter(Boolean)
    )
  ];
}

/* ===================================================================
   SEGURANÇA — VALIDAÇÃO DE ADMIN PARA ENDPOINTS HTTP (onRequest)
   Endpoints onRequest não recebem "request.auth" automaticamente como
   os onCall. Por isso, endpoints administrativos (recompute/backfill)
   agora exigem um ID Token do Firebase Auth no header Authorization,
   validado e conferido contra o cadastro em usuariosSistema.
=================================================================== */

async function exigirAdminHttp(req) {
  const authHeader = String(req.headers.authorization || "");
  const match = authHeader.match(/^Bearer (.+)$/i);

  if (!match) {
    const erro = new Error("Token de autenticação ausente.");
    erro.statusCode = 401;
    throw erro;
  }

  let decoded;

  try {
    decoded = await admin.auth().verifyIdToken(match[1]);
  } catch (e) {
    const erro = new Error("Token de autenticação inválido.");
    erro.statusCode = 401;
    throw erro;
  }

  // Caminho rápido: claim já sincronizada no token (sem leitura no Firestore).
  if (decoded.admin === true) {
    return decoded;
  }

  // Fallback: claim pode ainda não ter propagado (ex.: usuário acabou de
  // ser promovido e não atualizou o token). Confere direto no Firestore.
  const usuarioSnap = await db
    .collection("usuariosSistema")
    .doc(decoded.uid)
    .get();

  if (!usuarioSnap.exists) {
    const erro = new Error("Usuário não encontrado em usuariosSistema.");
    erro.statusCode = 403;
    throw erro;
  }

  const usuario = usuarioSnap.data() || {};
  const perfil = canonical(usuario.perfil || usuario.role || usuario.tipo || "");
  const status = canonical(usuario.status || "");
  const ativo = status === "ativo";
  const admin_ = perfil === "administrador" || perfil === "admin" || perfil === "adm";

  if (!ativo || !admin_) {
    const erro = new Error("Apenas administrador ativo pode executar esta operação.");
    erro.statusCode = 403;
    throw erro;
  }

  return decoded;
}

async function usuarioCallableEhAdmin(auth) {
  if (!auth?.uid) {
    throw new HttpsError(
      "unauthenticated",
      "Usuário não autenticado."
    );
  }

  // Caminho rápido: claim já sincronizada no token (sem leitura no Firestore).
  if (auth.token?.admin === true) {
    return true;
  }

  // Fallback: claim pode ainda não ter propagado. Confere no Firestore.
  const usuarioSnap = await db
    .collection("usuariosSistema")
    .doc(auth.uid)
    .get();

  if (!usuarioSnap.exists) {
    throw new HttpsError(
      "permission-denied",
      "Usuário não encontrado em usuariosSistema."
    );
  }

  const usuario = usuarioSnap.data() || {};
  const perfil = canonical(usuario.perfil || usuario.role || usuario.tipo || "");
  const status = canonical(usuario.status || "");

  const ativo = status === "ativo";

  const admin =
    perfil === "administrador" ||
    perfil === "admin" ||
    perfil === "adm" ||
    usuario.admin === true ||
    usuario.isAdmin === true;

  if (!ativo || !admin) {
    throw new HttpsError(
      "permission-denied",
      "Apenas administrador ativo pode excluir obra completa."
    );
  }

  return true;
}

async function obterDocumentoObraPrincipal(entrada) {
  const obraDocId = textoSeguro(entrada.obraDocId);
  const colecaoOrigem = textoSeguro(entrada.colecaoOrigem);

  const tentativas = [];

  if (obraDocId && colecaoOrigem) {
    tentativas.push({
      colecao: colecaoOrigem,
      id: obraDocId
    });
  }

  if (obraDocId) {
    tentativas.push({
      colecao: "obras",
      id: obraDocId
    });

    tentativas.push({
      colecao: "projetos",
      id: obraDocId
    });
  }

  const codigoObra = textoSeguro(entrada.codigoObra);

  if (codigoObra) {
    tentativas.push({
      colecao: "obras",
      id: codigoObra
    });

    tentativas.push({
      colecao: "projetos",
      id: codigoObra
    });
  }

  for (const tentativa of tentativas) {
    const snap = await db
      .collection(tentativa.colecao)
      .doc(tentativa.id)
      .get();

    if (snap.exists) {
      return {
        ref: snap.ref,
        id: snap.id,
        colecao: tentativa.colecao,
        dados: snap.data() || {}
      };
    }
  }

  return null;
}

async function adicionarDocRefsPorCampo({
  refsMap,
  colecao,
  campo,
  valores
}) {
  const valoresValidos = [
    ...new Set(
      valores
        .map(valorValidoParaBusca)
        .filter(Boolean)
    )
  ];

  for (const valor of valoresValidos) {
    try {
      const snap = await db
        .collection(colecao)
        .where(campo, "==", valor)
        .get();

      snap.forEach((docSnap) => {
        refsMap.set(docSnap.ref.path, docSnap.ref);
      });
    } catch (error) {
      logger.warn(
        `[excluirObraCompleta] Consulta ignorada: ${colecao}.${campo}=${valor}`,
        error
      );
    }
  }
}

async function adicionarDocRefsPorId({
  refsMap,
  colecao,
  valores
}) {
  const valoresValidos = [
    ...new Set(
      valores
        .map(valorValidoParaBusca)
        .filter(Boolean)
    )
  ];

  for (const valor of valoresValidos) {
    try {
      const ref = db.collection(colecao).doc(valor);
      const snap = await ref.get();

      if (snap.exists) {
        refsMap.set(ref.path, ref);
      }
    } catch (error) {
      logger.warn(
        `[excluirObraCompleta] Busca por ID ignorada: ${colecao}/${valor}`,
        error
      );
    }
  }
}

async function coletarDocsRelacionados({
  chaves,
  obraPrincipal
}) {
  const refsMap = new Map();

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
    "obra",
    "obraNome",
    "nomeObra",
    "nomeProjeto",
    "projeto"
  ];

  for (const colecao of colecoesPrincipais) {
    await adicionarDocRefsPorId({
      refsMap,
      colecao,
      valores: chaves
    });

    for (const campo of camposRelacionamento) {
      await adicionarDocRefsPorCampo({
        refsMap,
        colecao,
        campo,
        valores: chaves
      });
    }
  }

  for (const colecao of colecoesRelacionadas) {
    await adicionarDocRefsPorId({
      refsMap,
      colecao,
      valores: chaves
    });

    for (const campo of camposRelacionamento) {
      await adicionarDocRefsPorCampo({
        refsMap,
        colecao,
        campo,
        valores: chaves
      });
    }
  }

  if (obraPrincipal?.ref) {
    refsMap.set(obraPrincipal.ref.path, obraPrincipal.ref);
  }

  return refsMap;
}

async function adicionarSubcolecoesConhecidas({
  refsMap,
  chaves
}) {
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
      const docRef = db.collection(colecaoRaiz).doc(chave);

      for (const subcolecao of subcolecoes) {
        try {
          const snap = await docRef.collection(subcolecao).get();

          snap.forEach((docSnap) => {
            refsMap.set(docSnap.ref.path, docSnap.ref);
          });
        } catch (error) {
          logger.warn(
            `[excluirObraCompleta] Subcoleção ignorada: ${colecaoRaiz}/${chave}/${subcolecao}`,
            error
          );
        }
      }
    }
  }
}

function contarPorColecao(refs) {
  const resumo = {};

  refs.forEach((ref) => {
    const partes = ref.path.split("/");
    const colecao = partes.length >= 2
      ? partes[partes.length - 2]
      : partes[0];

    resumo[colecao] = (resumo[colecao] || 0) + 1;
  });

  return resumo;
}

async function apagarEmLotes(refs) {
  const listaRefs = Array.from(refs.values());
  const tamanhoLote = 450;

  let totalExcluido = 0;

  for (let i = 0; i < listaRefs.length; i += tamanhoLote) {
    const parte = listaRefs.slice(i, i + tamanhoLote);
    const batch = db.batch();

    parte.forEach((ref) => {
      batch.delete(ref);
    });

    await batch.commit();

    totalExcluido += parte.length;
  }

  return totalExcluido;
}

/* ===================================================================
   7) SINCRONIZAÇÃO DE CUSTOM CLAIMS (admin) A PARTIR DO FIRESTORE
   Sempre que usuariosSistema/{uid} é criado/alterado, este trigger
   define (ou remove) a custom claim "admin" no token do usuário,
   de acordo com perfil == "administrador" && status == "ativo".
   Isso substitui a antiga lista fixa de e-mails: o Firestore continua
   sendo a ÚNICA fonte da verdade, e a claim é só um "cache" no token
   para checagens rápidas e sem leitura extra no banco.

   IMPORTANTE: claims só valem no PRÓXIMO login/refresh do token do
   usuário. Se você promover alguém a administrador, peça para a
   pessoa sair e entrar novamente (ou o app pode forçar isso chamando
   `getIdToken(true)` após detectar mudança de perfil).
=================================================================== */

// Perfis que podem enviar foto na Curva S — usado pelo storage.rules via
// a claim perfilCurvaS, sem precisar consultar o Firestore a partir do
// Storage (recurso cross-service que exige permissão de IAM extra e não
// é confiável logo após o Storage ser criado no projeto).
const PERFIS_COM_ACESSO_CURVA_S = [
  "gestor",
  "planejador",
  "engenharia",
  "editor"
];

// Extraído pra ser reaproveitado tanto pelo trigger (dispara a cada
// escrita em usuariosSistema/{uid}) quanto pelo backfill manual abaixo
// (corrige de uma vez usuários cadastrados antes dessa claim existir,
// que só seriam sincronizados na próxima vez que o cadastro deles fosse
// editado — o que pode nunca acontecer).
async function calcularESincronizarClaims(uid, dadosUsuario) {
  const perfil = canonical(dadosUsuario.perfil || dadosUsuario.role || dadosUsuario.tipo || "");
  const status = canonical(dadosUsuario.status || "");
  const ativo = status === "ativo";

  const deveSerAdmin =
    ativo &&
    (perfil === "administrador" || perfil === "admin" || perfil === "adm");

  const devePerfilCurvaS =
    ativo && PERFIS_COM_ACESSO_CURVA_S.includes(perfil)
    ? perfil
    : "";

  const usuarioAuth = await admin.auth().getUser(uid);
  const claimsAtuais = usuarioAuth.customClaims || {};

  const jaEhAdmin = claimsAtuais.admin === true;
  const perfilCurvaSAtual = claimsAtuais.perfilCurvaS || "";

  if (
    jaEhAdmin === deveSerAdmin &&
    perfilCurvaSAtual === devePerfilCurvaS
  ) {
    return { alterado: false, admin: deveSerAdmin, perfilCurvaS: devePerfilCurvaS };
  }

  await admin.auth().setCustomUserClaims(uid, {
    admin: deveSerAdmin,
    perfilCurvaS: devePerfilCurvaS
  });

  return { alterado: true, admin: deveSerAdmin, perfilCurvaS: devePerfilCurvaS };
}

exports.sincronizarClaimAdmin = onDocumentWritten(
  {
    document: "usuariosSistema/{uid}"
  },
  async (event) => {
    const { uid } = event.params;
    const after = event.data?.after?.exists ? event.data.after.data() : null;

    if (!after) {
      // Documento excluído: por segurança, remove as claims.
      try {
        await admin.auth().setCustomUserClaims(uid, { admin: false, perfilCurvaS: "" });
      } catch (e) {
        logger.warn(`[sincronizarClaimAdmin] usuário ${uid} não existe mais no Auth.`, e);
      }
      return;
    }

    try {
      const resultado = await calcularESincronizarClaims(uid, after);

      if (resultado.alterado) {
        logger.info(
          `[sincronizarClaimAdmin] uid=${uid} admin=${resultado.admin} perfilCurvaS=${resultado.perfilCurvaS || "-"}`
        );
      }
    } catch (e) {
      logger.error(`[sincronizarClaimAdmin] falha ao sincronizar uid=${uid}`, e);
    }
  }
);

/* ===================================================================
   7.1) BACKFILL MANUAL DAS CLAIMS (admin/perfilCurvaS)

   Corrige de uma vez usuários cujo cadastro não foi regravado desde que
   a claim perfilCurvaS passou a existir (upload de foto na Curva S) —
   sem isso, eles só seriam sincronizados na próxima edição do cadastro,
   o que pode nunca acontecer.

   Uso (depois de dar deploy):
     https://SEU-HOST-DAS-FUNCTIONS/backfillClaimsUsuarios
   com o header "Authorization: Bearer <ID token de um admin>".
=================================================================== */

exports.backfillClaimsUsuarios = onRequest(
  {
    region: "us-central1",
    memory: "256MiB",
    timeoutSeconds: 120,
    cors: true
  },
  async (req, res) => {
    try {
      const decoded = await exigirAdminHttp(req);

      const snapshot = await db.collection("usuariosSistema").get();

      let alterados = 0;
      let falhas = 0;

      for (const docSnap of snapshot.docs) {
        try {
          const resultado = await calcularESincronizarClaims(docSnap.id, docSnap.data());

          if (resultado.alterado) {
            alterados++;
          }
        } catch (e) {
          falhas++;
          logger.warn(`[backfillClaimsUsuarios] falha uid=${docSnap.id}`, e);
        }
      }

      logger.info(
        `[backfillClaimsUsuarios] disparado por ${decoded.email || decoded.uid}. total=${snapshot.size} alterados=${alterados} falhas=${falhas}`
      );

      return res.status(200).send(
        `OK: ${snapshot.size} usuário(s) verificado(s), ${alterados} claim(s) atualizada(s), ${falhas} falha(s).`
      );
    } catch (e) {
      logger.error("[backfillClaimsUsuarios] erro:", e);

      return res
        .status(e.statusCode || 500)
        .send(e.statusCode ? e.message : "Erro ao sincronizar claims.");
    }
  }
);

/* ===================================================================
   8) REDE DE SEGURANÇA — CRIAR PERFIL AO CADASTRAR NO AUTH
   Hoje o cadastro (login.js) já grava o documento em usuariosSistema
   logo após criar a conta no Firebase Auth. Este trigger é só uma
   rede de segurança para o caso raro de a conexão cair entre os dois
   passos, deixando um login válido sem perfil correspondente.

   IMPORTANTE (diferente da versão antiga que existia no index.js da
   raiz do projeto): este trigger NÃO promove ninguém a administrador
   por e-mail. Todo mundo entra como "usuario"/"pendente" — igual ao
   fluxo normal do login.js — e só é promovido depois, manualmente,
   por um administrador (ou por você, direto no Firestore, no caso
   do primeiro admin do sistema).
=================================================================== */

exports.criarPerfilUsuarioSistema = functionsV1
  .region("us-central1")
  .auth.user()
  .onCreate(async (userRecord) => {
    try {
      const usuarioRef = db.collection("usuariosSistema").doc(userRecord.uid);
      const snap = await usuarioRef.get();

      if (snap.exists) {
        // Já foi criado pelo cliente (fluxo normal) — não sobrescreve.
        return;
      }

      const email = String(userRecord.email || "").trim().toLowerCase();
      const nome = userRecord.displayName || email || "Usuário";

      await usuarioRef.set({
        uid: userRecord.uid,
        nome,
        email,
        perfil: "usuario",
        status: "pendente",
        criadoEm: admin.firestore.FieldValue.serverTimestamp(),
        atualizadoEm: admin.firestore.FieldValue.serverTimestamp(),
        origem: "auth-onCreate-fallback"
      });

      logger.info(`[criarPerfilUsuarioSistema] perfil criado (fallback) para ${email}`);
    } catch (e) {
      logger.error("[criarPerfilUsuarioSistema] falha:", e);
    }
  });

exports.excluirObraCompleta = onCall(
  {
    region: "us-central1",
    memory: "1GiB",
    timeoutSeconds: 540
    // Nota: enforceAppCheck fica desligado pelo mesmo motivo descrito em
    // excluirUsuarioCompleto — a site key do App Check ainda não foi
    // configurada em firebaseConfig.js. A checagem de admin abaixo já é a
    // proteção real; pode reativar "enforceAppCheck: true" assim que a
    // site key for configurada no cliente.
  },
  async (request) => {
    await usuarioCallableEhAdmin(request.auth);

    const entrada = request.data || {};
    const obraDocId = textoSeguro(entrada.obraDocId);
    const codigoObra = textoSeguro(entrada.codigoObra);
    const nomeObra = textoSeguro(entrada.nomeObra);
    const confirmacao = textoSeguro(entrada.confirmacao);

    if (confirmacao !== "EXCLUIR") {
      throw new HttpsError(
        "failed-precondition",
        "Confirmação inválida. Digite EXCLUIR para confirmar."
      );
    }

    if (!obraDocId && !codigoObra && !nomeObra) {
      throw new HttpsError(
        "invalid-argument",
        "Informe obraDocId, codigoObra ou nomeObra."
      );
    }

    const obraPrincipal = await obterDocumentoObraPrincipal(entrada);

    const dadosObra = obraPrincipal?.dados || {};

    const chaves = gerarChavesObra(dadosObra, entrada);

    if (!chaves.length) {
      throw new HttpsError(
        "invalid-argument",
        "Não foi possível gerar chaves para localizar os dados da obra."
      );
    }

    const refsMap = await coletarDocsRelacionados({
      chaves,
      obraPrincipal
    });

    await adicionarSubcolecoesConhecidas({
      refsMap,
      chaves
    });

    const refs = Array.from(refsMap.values());
    const resumoPorColecao = contarPorColecao(refs);

    const email = String(request.auth.token?.email || "").toLowerCase();

    const auditoriaRef = await db.collection("auditoriaExclusoesObras").add({
      tipo: "EXCLUSAO_OBRA_COMPLETA",
      status: "EM_PROCESSAMENTO",
      obraDocId,
      codigoObra,
      nomeObra,
      colecaoOrigem: entrada.colecaoOrigem || "",
      chavesBusca: chaves,
      resumoPorColecao,
      totalDocumentosLocalizados: refs.length,
      obraPrincipalEncontrada: Boolean(obraPrincipal),
      obraPrincipalPath: obraPrincipal?.ref?.path || "",
      obraSnapshot: dadosObra,
      solicitadoPorUid: request.auth.uid,
      solicitadoPorEmail: email,
      solicitadoEm: admin.firestore.FieldValue.serverTimestamp()
    });

    try {
      const totalExcluido = await apagarEmLotes(refsMap);

      await auditoriaRef.update({
        status: "CONCLUIDA",
        totalDocumentosExcluidos: totalExcluido,
        concluidoEm: admin.firestore.FieldValue.serverTimestamp()
      });

      logger.info(
        `[excluirObraCompleta] Obra excluída. total=${totalExcluido}, usuario=${email}`
      );

      return {
        ok: true,
        mensagem: "Obra excluída com sucesso.",
        totalDocumentosLocalizados: refs.length,
        totalDocumentosExcluidos: totalExcluido,
        resumoPorColecao,
        auditoriaId: auditoriaRef.id
      };
    } catch (error) {
      await auditoriaRef.update({
        status: "ERRO",
        erro: String(error?.message || error),
        erroEm: admin.firestore.FieldValue.serverTimestamp()
      });

      logger.error("[excluirObraCompleta] Erro ao excluir obra:", error);

      throw new HttpsError(
        "internal",
        "Erro ao excluir a obra completa.",
        {
          auditoriaId: auditoriaRef.id
        }
      );
    }
  }
);

/*
  excluirUsuarioCompleto
  -----------------------
  Apagar só o documento em usuariosSistema (feito hoje pelo
  admin-painel.js direto pelo cliente) deixa a conta de login
  (Firebase Authentication) órfã — o e-mail continua "ocupado" e a
  pessoa não consegue se cadastrar de novo, mesmo sem nenhum dado
  dela no Firestore.

  Apagar a conta de Authentication de OUTRO usuário só pode ser
  feito pelo servidor (Admin SDK), por isso essa função existe:
  ela apaga o(s) documento(s) em usuariosSistema E a conta de
  Authentication correspondente, numa única chamada.
*/
exports.excluirUsuarioCompleto = onCall(
  {
    region: "us-central1",
    memory: "256MiB",
    timeoutSeconds: 60
    // Nota: enforceAppCheck fica desligado por enquanto porque a site
    // key do App Check ainda não foi configurada em firebaseConfig.js
    // (veja o comentário no topo daquele arquivo) — com ela ligada e
    // o App Check ainda não inicializado no cliente, toda chamada
    // seria bloqueada. A checagem de admin acima já é a proteção real;
    // pode reativar "enforceAppCheck: true" assim que configurar a
    // site key.
  },
  async (request) => {
    await usuarioCallableEhAdmin(request.auth);

    const entrada = request.data || {};
    const uidAlvo = String(entrada.uid || "").trim();
    const emailAlvo = String(entrada.email || "").trim().toLowerCase();

    if (!uidAlvo && !emailAlvo) {
      throw new HttpsError(
        "invalid-argument",
        "Informe o uid ou o e-mail do usuário a excluir."
      );
    }

    if (uidAlvo && uidAlvo === request.auth.uid) {
      throw new HttpsError(
        "failed-precondition",
        "Você não pode excluir o próprio usuário logado."
      );
    }

    try {
      // Localiza todos os documentos em usuariosSistema para esse
      // uid/e-mail (pode haver mais de um registro legado).
      const docsParaExcluir = new Map();

      if (uidAlvo) {
        const snapshotPorId = await db.collection("usuariosSistema").doc(uidAlvo).get();

        if (snapshotPorId.exists) {
          docsParaExcluir.set(snapshotPorId.id, snapshotPorId.ref);
        }
      }

      if (emailAlvo) {
        const camposEmail = ["email", "emailAuth", "usuarioEmail", "login"];

        for (const campo of camposEmail) {
          const resultado = await db
            .collection("usuariosSistema")
            .where(campo, "==", emailAlvo)
            .get();

          resultado.forEach((documento) => {
            docsParaExcluir.set(documento.id, documento.ref);
          });
        }
      }

      // Descobre o uid real da conta de Authentication a apagar.
      let uidAuth = uidAlvo || "";

      if (!uidAuth && docsParaExcluir.size > 0) {
        uidAuth = docsParaExcluir.keys().next().value;
      }

      let authExcluido = false;
      let authErro = "";

      const tentarExcluirAuthPorUid = async (uid) => {
        try {
          await admin.auth().deleteUser(uid);
          return true;
        } catch (error) {
          if (error?.code === "auth/user-not-found") {
            return true;
          }

          authErro = String(error?.message || error);
          logger.error("[excluirUsuarioCompleto] Erro ao excluir do Authentication:", error);
          return false;
        }
      };

      if (uidAuth) {
        authExcluido = await tentarExcluirAuthPorUid(uidAuth);
      }

      // Se ainda não conseguiu (ex.: uid do documento não bate com o
      // uid real do Authentication), tenta localizar pelo e-mail.
      if (!authExcluido && emailAlvo) {
        try {
          const usuarioAuth = await admin.auth().getUserByEmail(emailAlvo);
          authExcluido = await tentarExcluirAuthPorUid(usuarioAuth.uid);
        } catch (error) {
          if (error?.code === "auth/user-not-found") {
            authExcluido = true;
          } else {
            authErro = authErro || String(error?.message || error);
          }
        }
      }

      if (docsParaExcluir.size > 0) {
        const lote = db.batch();

        docsParaExcluir.forEach((ref) => {
          lote.delete(ref);
        });

        await lote.commit();
      }

      const solicitante = String(request.auth.token?.email || request.auth.uid);

      logger.info(
        `[excluirUsuarioCompleto] uid=${uidAuth || "-"} email=${emailAlvo || "-"} ` +
        `authExcluido=${authExcluido} documentosExcluidos=${docsParaExcluir.size} ` +
        `solicitadoPor=${solicitante}`
      );

      return {
        ok: true,
        authExcluido,
        authErro,
        documentosExcluidos: docsParaExcluir.size
      };
    } catch (error) {
      // Se já é um HttpsError (ex.: lançado acima), deixa passar como está.
      if (error instanceof HttpsError) {
        throw error;
      }

      logger.error("[excluirUsuarioCompleto] Erro inesperado:", error);

      throw new HttpsError(
        "internal",
        `Erro inesperado ao excluir usuário: ${String(error?.message || error)}`
      );
    }
  }
);