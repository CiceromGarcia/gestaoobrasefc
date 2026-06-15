// index.js — Cloud Functions v2 (Node 20)
const admin = require("firebase-admin");
const nodemailer = require("nodemailer");
const { onDocumentWritten, onDocumentCreated } = require("firebase-functions/v2/firestore");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { onRequest } = require("firebase-functions/v2/https");
const { setGlobalOptions, logger } = require("firebase-functions/v2");

// Região/memória padrão
setGlobalOptions({ region: "us-central1", memory: "256MiB", timeoutSeconds: 60 });

admin.initializeApp();
const db = admin.firestore();

// ===== Config (legacy) =====
const legacyCfg =
  (require("firebase-functions").config && require("firebase-functions").config()) || {};
const smtp = legacyCfg.smtp || {};
const appCfg = legacyCfg.app || {};

// ===== Utils =====
const canonical = (s) =>
  (s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[’´`]/g, "'")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

const num = (x) => {
  if (typeof x === "string") {
    // aceita "R$ 1.234,56", "1.234,56", "1234.56", etc.
    const clean = x.replace(/[R$\s]/g, "").replace(/\./g, "").replace(/,/g, ".");
    const n = Number(clean);
    return Number.isFinite(n) ? n : 0;
  }
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
};

const safeDiv = (a, b) => {
  const A = Number(a);
  const B = Number(b);
  return B && Number.isFinite(A) && Number.isFinite(B) ? A / B : null;
};

// ciclo 1 = 21/12(ano-1) → 20/01(ano)
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
    { c: 12, s: [Y, 11, 21], e: [Y, 12, 20] },
  ];
  for (const { c, s, e } of mapa) {
    const S = new Date(s[0], s[1] - 1, s[2], 0, 0, 0);
    const E = new Date(e[0], e[1] - 1, e[2], 23, 59, 59);
    if (d >= S && d <= E) return { ano: E.getFullYear(), ciclo: c, start: S, end: E };
  }
  return { ano: Y, ciclo: 1, start: new Date(Y - 1, 11, 21), end: new Date(Y, 0, 20, 23, 59, 59) };
}

function toDate(v) {
  if (!v) return null;
  if (v.toDate) return v.toDate();
  if (v._seconds || v.seconds) return new Date((v._seconds || v.seconds) * 1000);
  if (typeof v === "number") {
    const d = new Date(v);
    return isNaN(d) ? null : d;
  }
  if (typeof v === "string") {
    const m2 = v.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (m2) return new Date(+m2[3], +m2[2] - 1, +m2[1], 12, 0, 0);
    const m = v.match(/^(\d{4})-W(\d{2})$/); // semana ISO
    if (m) {
      const y = +m[1],
        w = +m[2];
      const j4 = new Date(Date.UTC(y, 0, 4));
      const day = j4.getUTCDay() || 7;
      const mon = new Date(j4);
      mon.setUTCDate(j4.getUTCDate() - (day - 1) + (w - 1) * 7);
      return new Date(mon.getFullYear(), mon.getMonth(), mon.getDate());
    }
    const d = new Date(v);
    if (!isNaN(d)) return d;
  }
  const d = new Date(v);
  return isNaN(d) ? null : d;
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
    auth: { user: smtp.user, pass: smtp.pass },
  });
}

function fmtLinkPesquisa({ obra, localidade, regional, sponsorEmail, token }) {
  const base = appCfg.url || "https://SEU-HOST/pesquisa.html";
  const p = new URL(base);
  if (obra) p.searchParams.set("obra", obra);
  if (localidade) p.searchParams.set("localidade", localidade);
  if (regional) p.searchParams.set("regional", regional);
  if (sponsorEmail) p.searchParams.set("sponsor", sponsorEmail);
  if (token) p.searchParams.set("token", token);
  return p.toString();
}

const isConcluido = (v) => /conclu|finaliz/i.test(String(v || ""));

// ===================================================================
// 1) Enviar pesquisa quando uma obra ficar concluída
// ===================================================================
exports.sendSurveyOnProjectCompleted = onDocumentWritten(
  { document: "projetos_atualizados/{id}" },
  async (event) => {
    const after = event.data?.after?.data();
    const before = event.data?.before?.data();
    if (!after) return; // deletado
    if (before && before.statusNovo === after.statusNovo) return;
    if (!isConcluido(after.statusNovo)) return;

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
      proj?.sponsorEmail || proj?.emailSponsor || proj?.sponsor || proj?.email || "";
    if (!sponsorEmail) {
      logger.warn(`Projeto ${projetoId} sem sponsorEmail`);
      return;
    }

    // evita tarefa pendente duplicada
    const pend = await db
      .collection("pesquisasObras")
      .where("projetoId", "==", projetoId)
      .where("status", "==", "pendente")
      .limit(1)
      .get();
    if (!pend.empty) {
      logger.info(`Já existe pesquisa pendente para ${projetoId}, não duplicar.`);
    } else {
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
        lastSentAt: null,
      });

      const transport = buildTransport();
      if (!transport) return;
      const link = fmtLinkPesquisa({ obra, localidade, regional, sponsorEmail, token });
      try {
        await transport.sendMail({
          from: smtp.user,
          to: sponsorEmail,
          subject: `Pesquisa de Satisfação — ${obra}`,
          html: `<p>Olá,</p><p>A obra <b>${obra}</b> foi concluída. Por favor, responda a pesquisa:</p><p><a href="${link}" target="_blank">${link}</a></p><p>Obrigado!</p>`,
        });
        logger.info(`Pesquisa enviada para ${sponsorEmail} (projeto ${projetoId}).`);
      } catch (e) {
        logger.error("Falha ao enviar e-mail de pesquisa:", e);
      }
    }
  }
);

// ===================================================================
// 2) Marcar como respondida quando o sponsor enviar o formulário
// ===================================================================
exports.onSurveyAnswered = onDocumentCreated(
  { document: "pesquisasRespostas/{id}" },
  async (event) => {
    const data = event.data?.data();
    if (!data) return;

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
      respondedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    logger.info("Pesquisa marcada como respondida.");
  }
);

// ===================================================================
// 3) Reenvio recorrente de lembrete (até responder) — 08:00 SP
// ===================================================================
exports.remindPendingSurveys = onSchedule(
  { schedule: "0 8 * * *", timeZone: "America/Sao_Paulo" },
  async () => {
    const transport = buildTransport();
    if (!transport) return;

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

    for (const doc of pend.docs) {
      const x = doc.data();
      const last = x.lastSentAt?.toDate ? x.lastSentAt.toDate().getTime() : 0;
      if (last && now - last < DAY - 5 * 60 * 1000) continue; // ~1x/dia

      const link = fmtLinkPesquisa({
        obra: x.obra,
        localidade: x.localidade,
        regional: x.regional,
        sponsorEmail: x.sponsorEmail,
        token: x.token,
      });

      try {
        await transport.sendMail({
          from: smtp.user,
          to: x.sponsorEmail,
          subject: `Lembrete — Pesquisa de Satisfação (${x.obra})`,
          html: `<p>Olá,</p><p>Gentileza responder a pesquisa da obra <b>${x.obra}</b>:</p><p><a href="${link}" target="_blank">${link}</a></p><p>Obrigado!</p>`,
        });

        await doc.ref.update({
          lastSentAt: admin.firestore.FieldValue.serverTimestamp(),
          sentCount: (x.sentCount || 0) + 1,
        });
        enviados++;
      } catch (e) {
        logger.error("Falha ao enviar lembrete:", e);
      }
    }

    logger.info(`Lembretes enviados: ${enviados}`);
  }
);

// ===================================================================
// 4) Motor de Indicadores (rollups por ciclo) — existente
// ===================================================================
async function normalizeWeeklyDoc(projId, semId, data) {
  const projSnap = await db.collection("projetos").doc(projId).get();
  const p = projSnap.exists ? projSnap.data() : {};
  const regional = p?.regional || p?.regionalNome || "";
  const localidade = p?.localidade || p?.cidade || "";
  const nomeObra = p?.nomeProjeto || p?.nome || p?.projeto || projId;

  // base: fim da semana
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
    obraCanon: canonical(nomeObra),
  };
  const needUpdate = ["ano", "ciclo", "regionalCanon", "localidadeCanon", "obraCanon"].some(
    (k) => data[k] === undefined
  );
  if (needUpdate) {
    await db
      .collection("projetos")
      .doc(projId)
      .collection("cronogramaSemanal")
      .doc(semId)
      .set(patch, { merge: true });
  }
  return { ano, ciclo, meta: { regional, localidade, nomeObra } };
}

async function recomputeRollupForCycle(projId, ano, ciclo, metaHint) {
  // agrega semanas do ciclo
  const semRef = db.collection("projetos").doc(projId).collection("cronogramaSemanal");
  const q = await semRef.where("ano", "==", ano).where("ciclo", "==", ciclo).get();

  let fisPlan = 0,
    fisExec = 0,
    finPlan = 0,
    finExec = 0,
    lastUpd = null;

  q.forEach((doc) => {
    const d = doc.data() || {};
    fisPlan += num(d.avancFisicoPlanejado || d.fisicoPlanejado || d.percPlanFis || d.fisico_plan);
    fisExec += num(d.avancFisicoExecutado || d.fisicoExecutado || d.percExecFis || d.fisico_exec);
    finPlan += num(
      d.valorPlanejado || d.valorPlanejadoSemanal || d.financeiroPlanejado || d.valor_plan
    );
    finExec += num(
      d.valorExecutado || d.valorExecutadoSemanal || d.financeiroExecutado || d.valor_exec
    );
    const upd = toDate(d.atualizadoEm || d.updatedAt || d.updateAt || d.atualizado);
    if (upd && (!lastUpd || upd > lastUpd)) lastUpd = upd;
  });

  // metadados do projeto
  const projSnap = await db.collection("projetos").doc(projId).get();
  const p = projSnap.exists ? projSnap.data() : {};
  const regional = p?.regional || p?.regionalNome || metaHint?.regional || "";
  const localidade = p?.localidade || p?.cidade || metaHint?.localidade || "";
  const nomeObra = p?.nomeProjeto || p?.nome || p?.projeto || metaHint?.nomeObra || projId;

  // status canônico (simples)
  const rawStatus = p?.status || p?.situacao || p?.["situação"] || "";
  const s = canonical(rawStatus);
  let statusCanon = "em_execucao";
  if (/conclu|finaliz|encerr|entreg|complet|fechad/.test(s)) statusCanon = "concluido";

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
      : admin.firestore.FieldValue.serverTimestamp(),
  };

  // a) dentro do projeto
  await db
    .collection("projetos")
    .doc(projId)
    .collection("rollups")
    .doc(`${ano}-${ciclo}`)
    .set(payload, { merge: true });

  // b) coleção global (para queries por filtros)
  await db
    .collection("rollupsIndicadores")
    .doc(`${ano}-${ciclo}-${projId}`)
    .set(payload, { merge: true });
}

// Trigger: qualquer alteração numa semana → normaliza e recalcula o ciclo
exports.rollupCronogramaSemanalV2 = onDocumentWritten(
  { document: "projetos/{projId}/cronogramaSemanal/{semId}" },
  async (event) => {
    const { projId, semId } = event.params || {};
    const after = event.data?.after?.data();
    const before = event.data?.before?.data();
    const base = after || before || {};
    if (!projId || !semId) return;

    try {
      const { ano, ciclo, meta } = await normalizeWeeklyDoc(projId, semId, base);
      await recomputeRollupForCycle(projId, ano, ciclo, meta);
      logger.info(`[rollup] OK projeto=${projId} ciclo=${ano}-${ciclo}`);
    } catch (e) {
      logger.error("[rollup] falha:", e);
    }
  }
);

// Backfill HTTP: recalcula tudo para dados antigos
exports.backfillRollups = onRequest(
  { region: "us-central1", memory: "512MiB", timeoutSeconds: 540 },
  async (req, res) => {
    try {
      const token = String(req.query.token || "");
      const expected = String(appCfg.rollup_token || "TROQUE-ESTA-CHAVE");
      if (token !== expected) return res.status(401).send("unauthorized");

      const projSnap = await db.collection("projetos").get();
      let updated = 0,
        obras = 0;

      for (const pDoc of projSnap.docs) {
        const projId = pDoc.id;
        const semSnap = await db
          .collection("projetos")
          .doc(projId)
          .collection("cronogramaSemanal")
          .get();
        if (semSnap.empty) continue;
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

      res
        .status(200)
        .send(`Backfill concluído. Obras: ${obras}, rollups atualizados: ${updated}`);
    } catch (e) {
      logger.error("Backfill erro:", e);
      res.status(500).send("erro");
    }
  }
);

// ===================================================================
// 5) NOVO — Indicadores por obra (snapshot / semanal / mensal)
// ===================================================================

// Helpers período
function isoWeekId(dateLike) {
  const date = new Date(dateLike);
  const dayNum = (date.getUTCDay() + 6) % 7; // segunda=0
  date.setUTCDate(date.getUTCDate() - dayNum + 3);
  const firstThursday = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round(
    ((date - firstThursday) / 86400000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7
  );
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}
function ymId(dateLike) {
  const d = new Date(dateLike);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}
const THIS_YEAR = () => new Date().getFullYear();

// Leitura bases
async function readProjeto(projectId) {
  const snap = await db.collection("projetos").doc(projectId).get();
  return snap.exists ? { id: snap.id, ...snap.data() } : null;
}

async function readCronoSemanalLatest(projectId) {
  // subcoleção
  const sub = await db
    .collection("projetos")
    .doc(projectId)
    .collection("cronogramaSemanal")
    .orderBy("semanaIso", "desc")
    .limit(1)
    .get();
  if (!sub.empty) return { path: "sub", data: sub.docs[0].data() };

  // top-level
  const top = await db
    .collection("cronogramaSemanal")
    .where("projectId", "==", projectId)
    .orderBy("semanaIso", "desc")
    .limit(1)
    .get();
  if (!top.empty) return { path: "top", data: top.docs[0].data() };

  return null;
}

async function readCustos(projectId, semanaIso, yyyyMM) {
  // Semana
  const qSemana = await db
    .collection("custos")
    .where("projectId", "==", projectId)
    .where("semanaIso", "==", semanaIso)
    .get();
  let custoSemana = 0;
  qSemana.forEach((d) => (custoSemana += num(d.data().valor || 0)));

  // Mês (yyyyMM sem hífen)
  const qMes = await db
    .collection("custos")
    .where("projectId", "==", projectId)
    .where("yyyyMM", "==", yyyyMM.replace("-", ""))
    .get();
  let custoMes = 0;
  qMes.forEach((d) => (custoMes += num(d.data().valor || 0)));

  // Ano
  const qAno = await db
    .collection("custos")
    .where("projectId", "==", projectId)
    .where("ano", "==", THIS_YEAR())
    .get();
  let custoAno = 0;
  qAno.forEach((d) => (custoAno += num(d.data().valor || 0)));

  return { custoSemana, custoMes, custoAno };
}

// Cálculo e gravação
async function computeIndicatorsForProject(projectId) {
  const projeto = await readProjeto(projectId);
  if (!projeto) return;

  const agora = new Date();
  const semanaId = isoWeekId(agora);
  const mesId = ymId(agora);

  const crono = await readCronoSemanalLatest(projectId);
  const { custoSemana, custoMes, custoAno } = await readCustos(projectId, semanaId, mesId);

  const categoria = (projeto.categoriaObra || projeto.categoria || "").toString().toLowerCase();
  const status = (projeto.status || "Planejado").toString();
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
    crono?.data?.adFisico != null ? num(crono.data.adFisico) : num(projeto.avancoFisico);

  const orcado = num(projeto.custoAtualizado, num(projeto.custoOrcado));
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
    custoAtualizado: num(projeto.custoAtualizado, num(projeto.custoOrcado)),
    custoExecutadoPeriodo: custoSemana, // semanal
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
    sources: { usouCronogramaSemanal: Boolean(crono), usouCustos: true },
  };

  // SNAPSHOT
  await db.collection("indicadoresObra_snapshot").doc(projectId).set(
    {
      ...base,
      periodoTipo: "SNAPSHOT",
      periodoId: "_",
    },
    { merge: true }
  );

  // SEMANAL
  await db
    .collection("indicadoresObra_semanal")
    .doc(`${projectId}_${semanaId}`)
    .set(
      {
        ...base,
        periodoTipo: "SEMANA",
        periodoId: semanaId,
      },
      { merge: true }
    );

  // MENSAL (usa custo do mês no período)
  await db
    .collection("indicadoresObra_mensal")
    .doc(`${projectId}_${mesId}`)
    .set(
      {
        ...base,
        periodoTipo: "MES",
        periodoId: mesId,
        custoExecutadoPeriodo: custoMes,
      },
      { merge: true }
    );
}

// Triggers para manter indicadores atualizados
exports.onProjetoWriteIndicators = onDocumentWritten(
  { document: "projetos/{projectId}" },
  async (event) => {
    const { projectId } = event.params;
    await computeIndicatorsForProject(projectId);
  }
);

exports.onCronogramaWriteTopIndicators = onDocumentWritten(
  { document: "cronogramaSemanal/{docId}" },
  async (event) => {
    const after = event.data?.after?.data();
    const projectId = after?.projectId;
    if (projectId) await computeIndicatorsForProject(projectId);
  }
);

exports.onCronogramaWriteSubIndicators = onDocumentWritten(
  { document: "projetos/{projectId}/cronogramaSemanal/{semanaId}" },
  async (event) => {
    const { projectId } = event.params;
    await computeIndicatorsForProject(projectId);
  }
);

exports.onCustoWriteIndicators = onDocumentWritten(
  { document: "custos/{movId}" },
  async (event) => {
    const after = event.data?.after?.data();
    const projectId = after?.projectId;
    if (projectId) await computeIndicatorsForProject(projectId);
  }
);

// Endpoint HTTPS para recomputar (um ou todos)
exports.recomputeIndicators = onRequest(
  { region: "us-central1", memory: "512MiB", timeoutSeconds: 300 },
  async (req, res) => {
    try {
      const projectId = req.query.projectId && String(req.query.projectId);
      if (projectId) {
        await computeIndicatorsForProject(projectId);
        return res.status(200).send({ ok: true, projectId });
      }
      const snaps = await db.collection("projetos").get();
      const ids = snaps.docs.map((d) => d.id);
      for (const id of ids) {
        await computeIndicatorsForProject(id);
      }
      return res.status(200).send({ ok: true, processed: ids.length });
    } catch (e) {
      logger.error("recomputeIndicators erro:", e);
      return res.status(500).send({ ok: false, error: String(e) });
    }
  }
);
