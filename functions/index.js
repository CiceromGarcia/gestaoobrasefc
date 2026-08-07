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
    "pesquisasObras"
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

exports.sincronizarClaimAdmin = onDocumentWritten(
  {
    document: "usuariosSistema/{uid}"
  },
  async (event) => {
    const { uid } = event.params;
    const after = event.data?.after?.exists ? event.data.after.data() : null;

    if (!after) {
      // Documento excluído: por segurança, remove a claim.
      try {
        await admin.auth().setCustomUserClaims(uid, { admin: false });
      } catch (e) {
        logger.warn(`[sincronizarClaimAdmin] usuário ${uid} não existe mais no Auth.`, e);
      }
      return;
    }

    const perfil = canonical(after.perfil || after.role || after.tipo || "");
    const status = canonical(after.status || "");
    const deveSerAdmin =
      status === "ativo" &&
      (perfil === "administrador" || perfil === "admin" || perfil === "adm");

    try {
      const usuarioAuth = await admin.auth().getUser(uid);
      const jaEhAdmin = usuarioAuth.customClaims?.admin === true;

      if (jaEhAdmin === deveSerAdmin) {
        return; // nada mudou, evita escrita desnecessária
      }

      await admin.auth().setCustomUserClaims(uid, { admin: deveSerAdmin });

      logger.info(
        `[sincronizarClaimAdmin] uid=${uid} admin=${deveSerAdmin}`
      );
    } catch (e) {
      logger.error(`[sincronizarClaimAdmin] falha ao sincronizar uid=${uid}`, e);
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
    timeoutSeconds: 540,
    enforceAppCheck: true
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