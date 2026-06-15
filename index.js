// index.js — Cloud Functions v2 (Node 20)
const admin = require("firebase-admin");
const nodemailer = require("nodemailer");
const { onDocumentWritten, onDocumentCreated } = require("firebase-functions/v2/firestore");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { onRequest } = require("firebase-functions/v2/https");
const { setGlobalOptions, logger } = require("firebase-functions/v2");
// === v1 (compat) para o gatilho Firestore 1ª geração:
const functionsV1 = require("firebase-functions");

setGlobalOptions({ region: "us-central1", memory: "256MiB", timeoutSeconds: 60 });

admin.initializeApp();
const db = admin.firestore();

// ---------- Config (LEGACY + .env fallback) ----------
let legacyCfg = {};
try {
  const fns = require("firebase-functions");
  legacyCfg = (typeof fns.config === "function") ? (fns.config() || {}) : {};
} catch (e) {
  logger.warn("[boot] functions.config() indisponível; seguindo com config vazia.");
  legacyCfg = {};
}

// Preferir variáveis de ambiente (.env) e cair no legacy se faltar
const smtp = {
  host: process.env.SMTP_HOST || legacyCfg.smtp?.host || "",
  user: process.env.SMTP_USER || legacyCfg.smtp?.user || "",
  pass: process.env.SMTP_PASS || legacyCfg.smtp?.pass || "",
  port: process.env.SMTP_PORT || legacyCfg.smtp?.port || 587,
  secure: (process.env.SMTP_SECURE || legacyCfg.smtp?.secure || "false")
};
const appCfg = {
  url: process.env.APP_URL || legacyCfg.app?.url || "https://SEU-HOST/pesquisa.html",
  rollup_token: process.env.ROLLUP_TOKEN || legacyCfg.app?.rollup_token || "TROQUE-ESTA-CHAVE"
};

// ===== utils =====
const canonical = (s)=>(s||"")
  .normalize("NFD").replace(/[\u0300-\u036f]/g,"")
  .replace(/[’´`]/g,"'").replace(/\s+/g," ")
  .trim().toLowerCase();

const num = (x)=> {
  if (typeof x === "string") {
    const clean = x.replace(/[R$\s]/g,"").replace(/\./g,"").replace(/,/g,".");
    const n = Number(clean); return Number.isFinite(n) ? n : 0;
  }
  const n = Number(x); return Number.isFinite(n) ? n : 0;
};

// ciclo 1 = 21/12(ano-1)→20/01(ano)
function cicloDoDia(d){
  const Y = d.getFullYear();
  const mapa = [
    {c:1,  s:[Y-1,12,21], e:[Y,1,20]},
    {c:2,  s:[Y,1,21],    e:[Y,2,20]},
    {c:3,  s:[Y,2,21],    e:[Y,3,20]},
    {c:4,  s:[Y,3,21],    e:[Y,4,20]},
    {c:5,  s:[Y,4,21],    e:[Y,5,20]},
    {c:6,  s:[Y,5,21],    e:[Y,6,20]},
    {c:7,  s:[Y,6,21],    e:[Y,7,20]},
    {c:8,  s:[Y,7,21],    e:[Y,8,20]},
    {c:9,  s:[Y,8,21],    e:[Y,9,20]},
    {c:10, s:[Y,9,21],    e:[Y,10,20]},
    {c:11, s:[Y,10,21],   e:[Y,11,20]},
    {c:12, s:[Y,11,21],   e:[Y,12,20]},
  ];
  for (const {c,s,e} of mapa){
    const S = new Date(s[0],s[1]-1,s[2],0,0,0);
    const E = new Date(e[0],e[1]-1,e[2],23,59,59);
    if (d>=S && d<=E) return { ano: E.getFullYear(), ciclo: c, start:S, end:E };
  }
  return { ano:Y, ciclo:1, start:new Date(Y-1,11,21), end:new Date(Y,0,20,23,59,59) };
}

function toDate(v){
  if (!v) return null;
  if (v.toDate) return v.toDate();
  if (v._seconds || v.seconds) return new Date((v._seconds||v.seconds)*1000);
  if (typeof v==="number"){ const d=new Date(v); return isNaN(d)?null:d; }
  if (typeof v==="string"){
    const m2=v.match(/^(\d{2})\/(\d{2})\/(\d{4})$/); if(m2) return new Date(+m2[3],+m2[2]-1,+m2[1],12,0,0);
    const m=v.match(/^(\d{4})-W(\d{2})$/);
    if(m){ const y=+m[1], w=+m[2]; const j4=new Date(Date.UTC(y,0,4)); const day=j4.getUTCDay()||7; const mon=new Date(j4); mon.setUTCDate(j4.getUTCDate()-(day-1)+(w-1)*7); return new Date(mon.getFullYear(),mon.getMonth(),mon.getDate()); }
    const d=new Date(v); if(!isNaN(d)) return d;
  }
  const d=new Date(v); return isNaN(d)?null:d;
}

// ===== e-mail =====
function buildTransport(){
  if(!smtp.host || !smtp.user || !smtp.pass){
    logger.error("SMTP ausente (defina SMTP_HOST/USER/PASS ou functions:config smtp.*).");
    return null;
  }
  return nodemailer.createTransport({
    host:smtp.host,
    port:Number(smtp.port||587),
    secure:String(smtp.secure||"false")==="true",
    auth:{ user:smtp.user, pass:smtp.pass }
  });
}
function fmtLinkPesquisa({ obra, localidade, regional, sponsorEmail, token }){
  const p = new URL(appCfg.url);
  if (obra) p.searchParams.set("obra", obra);
  if (localidade) p.searchParams.set("localidade", localidade);
  if (regional) p.searchParams.set("regional", regional);
  if (sponsorEmail) p.searchParams.set("sponsor", sponsorEmail);
  if (token) p.searchParams.set("token", token);
  return p.toString();
}
const isConcluido = (v)=>/conclu|finaliz/i.test(String(v||""));

// ===== 1) Pesquisa ao concluir obra =====
exports.sendSurveyOnProjectCompleted = onDocumentWritten(
  { document: "projetos_atualizados/{id}" },
  async (event)=>{
    const after = event.data?.after?.data();
    const before = event.data?.before?.data();
    if(!after) return;
    if (before && before.statusNovo === after.statusNovo) return;
    if (!isConcluido(after.statusNovo)) return;

    const projetoId = String(after.projetoId||"").trim();
    if(!projetoId){ logger.warn("Atualização sem projetoId"); return; }

    const projSnap = await db.collection("projetos").doc(projetoId).get();
    const proj = projSnap.exists ? projSnap.data() : {};
    const obra = proj?.nomeProjeto || proj?.nome || "Obra";
    const regional = after.regional || proj?.regional || "";
    const localidade = after.localidade || proj?.localidade || "";
    const sponsorEmail = proj?.sponsorEmail || proj?.emailSponsor || proj?.sponsor || proj?.email || "";
    if(!sponsorEmail){ logger.warn(`Projeto ${projetoId} sem sponsorEmail`); return; }

    const token = require("crypto").randomBytes(20).toString("hex");
    await db.collection("pesquisasObras").add({
      projetoId, obra, regional, localidade, sponsorEmail, token,
      status:"pendente", sentCount:0,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      lastSentAt: null,
    });

    const transport = buildTransport(); if(!transport) return;
    const link = fmtLinkPesquisa({ obra, localidade, regional, sponsorEmail, token });
    await transport.sendMail({
      from:smtp.user, to:sponsorEmail, subject:`Pesquisa de Satisfação — ${obra}`,
      html:`<p>Olá,</p><p>A obra <b>${obra}</b> foi concluída. Por favor, responda a pesquisa:</p><p><a href="${link}" target="_blank">${link}</a></p><p>Obrigado!</p>`
    });
    logger.info(`Pesquisa enviada para ${sponsorEmail} (projeto ${projetoId}).`);
  }
);

// ===== 2) Marcar pesquisa como respondida =====
exports.onSurveyAnswered = onDocumentCreated(
  { document: "pesquisasRespostas/{id}" },
  async (event)=>{
    const data = event.data?.data(); if(!data) return;
    const token = String(data.tokenRef||"").trim(); if(!token){ logger.warn("Resposta sem tokenRef"); return; }

    const q = await db.collection("pesquisasObras").where("token","==",token).where("status","==","pendente").limit(1).get();
    if(q.empty){ logger.warn("Token não encontrado ou já respondido"); return; }

    await q.docs[0].ref.update({ status:"respondida", respondedAt: admin.firestore.FieldValue.serverTimestamp() });
    logger.info("Pesquisa marcada como respondida.");
  }
);

// ===== 3) Lembrete diário =====
exports.remindPendingSurveys = onSchedule(
  { schedule:"0 8 * * *", timeZone:"America/Sao_Paulo" },
  async ()=>{
    const transport = buildTransport(); if(!transport) return;
    const pend = await db.collection("pesquisasObras").where("status","==","pendente").get();
    if(pend.empty){ logger.info("Nenhuma pesquisa pendente."); return; }

    const now=Date.now(), DAY=86400000; let enviados=0;
    for(const doc of pend.docs){
      const x=doc.data(); const last=x.lastSentAt?.toDate ? x.lastSentAt.toDate().getTime() : 0;
      if(last && now-last < DAY-5*60*1000) continue;

      const link = fmtLinkPesquisa({ obra:x.obra, localidade:x.localidade, regional:x.regional, sponsorEmail:x.sponsorEmail, token:x.token });
      try{
        await transport.sendMail({ from:smtp.user, to:x.sponsorEmail, subject:`Lembrete — Pesquisa de Satisfação (${x.obra})`, html:`<p>Olá,</p><p>Gentileza responder a pesquisa da obra <b>${x.obra}</b>:</p><p><a href="${link}" target="_blank">${link}</a></p><p>Obrigado!</p>` });
        await doc.ref.update({ lastSentAt: admin.firestore.FieldValue.serverTimestamp(), sentCount:(x.sentCount||0)+1 });
        enviados++;
      }catch(e){ logger.error("Falha ao enviar lembrete:", e); }
    }
    logger.info(`Lembretes enviados: ${enviados}`);
  }
);

// ===== 4) Motor de Indicadores =====
async function normalizeWeeklyDoc(projId, semId, data){
  const projSnap = await db.collection("projetos").doc(projId).get();
  const p = projSnap.exists ? projSnap.data() : {};
  const regional = p?.regional || p?.regionalNome || "";
  const localidade = p?.localidade || p?.cidade || "";
  const nomeObra = p?.nomeProjeto || p?.nome || p?.projeto || projId;

  const fim = toDate(data.fimSemanaUTC) || toDate(data.fim) || toDate(data.semanaISO) || toDate(data.semana) || toDate(data.inicioSemanaUTC) || new Date();
  const { ano, ciclo } = cicloDoDia(fim);

  const patch = { ano, ciclo, regionalCanon: canonical(regional), localidadeCanon: canonical(localidade), obraCanon: canonical(nomeObra) };
  const needUpdate = ["ano","ciclo","regionalCanon","localidadeCanon","obraCanon"].some(k=> data[k]===undefined);
  if(needUpdate){
    await db.collection("projetos").doc(projId).collection("cronogramaSemanal").doc(semId).set(patch,{ merge:true });
  }
  return { ano, ciclo, meta:{ regional, localidade, nomeObra } };
}

async function recomputeRollupForCycle(projId, ano, ciclo, metaHint){
  const semRef = db.collection("projetos").doc(projId).collection("cronogramaSemanal");
  const q = await semRef.where("ano","==",ano).where("ciclo","==",ciclo).get();

  let fisPlan=0, fisExec=0, finPlan=0, finExec=0, lastUpd=null;
  q.forEach(doc=>{
    const d=doc.data()||{};
    fisPlan += num(d.avancFisicoPlanejado || d.fisicoPlanejado || d.percPlanFis || d.fisico_plan);
    fisExec += num(d.avancFisicoExecutado || d.fisicoExecutado || d.percExecFis || d.fisico_exec);
    finPlan += num(d.valorPlanejado || d.valorPlanejadoSemanal || d.financeiroPlanejado || d.valor_plan);
    finExec += num(d.valorExecutado || d.valorExecutadoSemanal || d.financeiroExecutado || d.valor_exec);
    const upd = toDate(d.atualizadoEm || d.updatedAt || d.updateAt || d.atualizado);
    if(upd && (!lastUpd || upd>lastUpd)) lastUpd=upd;
  });

  const projSnap = await db.collection("projetos").doc(projId).get();
  const p = projSnap.exists ? projSnap.data() : {};
  const regional   = p?.regional   || p?.regionalNome || metaHint?.regional   || "";
  const localidade = p?.localidade || p?.cidade       || metaHint?.localidade || "";
  const nomeObra   = p?.nomeProjeto|| p?.nome         || p?.projeto           || metaHint?.nomeObra || projId;

  const rawStatus = p?.status || p?.situacao || p?.situação || "";
  const s = canonical(rawStatus);
  let statusCanon = "em_execucao";
  if (/conclu|finaliz|encerr|entreg|complet|fechad/.test(s)) statusCanon = "concluido";

  const adFisico     = fisPlan>0 ? (fisExec/fisPlan)*100 : null;
  const adFinanceiro = finPlan>0 ? (finExec/finPlan)*100 : null;

  const payload = {
    ano, ciclo, projetoId: projId, nomeProjeto: nomeObra,
    regional, localidade,
    regionalCanon: canonical(regional),
    localidadeCanon: canonical(localidade),
    obraCanon: canonical(nomeObra),
    statusCanon,
    fisicoPlanPct:+Number(fisPlan).toFixed(3),
    fisicoExecPct:+Number(fisExec).toFixed(3),
    finPlanValor:+Number(finPlan).toFixed(2),
    finExecValor:+Number(finExec).toFixed(2),
    adFisicoPct: adFisico==null?null:+Number(adFisico).toFixed(2),
    adFinanceiroPct: adFinanceiro==null?null:+Number(adFinanceiro).toFixed(2),
    lastUpdatedAt: lastUpd ? admin.firestore.Timestamp.fromDate(lastUpd) : admin.firestore.FieldValue.serverTimestamp(),
  };

  await db.collection("projetos").doc(projId).collection("rollups").doc(`${ano}-${ciclo}`).set(payload,{merge:true});
  await db.collection("rollupsIndicadores").doc(`${ano}-${ciclo}-${projId}`).set(payload,{merge:true});
}

// === gatilho por semana (Firestore) — V2 (comentado para não implantar enquanto dá erro de healthcheck)
// exports.rollupCronogramaSemanalV2 = onDocumentWritten(
//   { document: "projetos/{projId}/cronogramaSemanal/{semId}" },
//   async (event)=>{
//     const { projId, semId } = event.params || {};
//     const after = event.data?.after?.data();
//     const before = event.data?.before?.data();
//     const base = after || before || {};
//     if(!projId || !semId) return;
//     try{
//       const { ano, ciclo, meta } = await normalizeWeeklyDoc(projId, semId, base);
//       await recomputeRollupForCycle(projId, ano, ciclo, meta);
//       logger.info(`[rollup] OK projeto=${projId} ciclo=${ano}-${ciclo}`);
//     }catch(e){ logger.error("[rollup] falha:", e); }
//   }
// );

// === NOVO: gatilho por semana (Firestore) — V1 estável (1ª geração)
exports.rollupCronogramaSemanalV1 =
  functionsV1
    .region("us-central1")
    .runWith({ memory: "256MB", timeoutSeconds: 60 })
    .firestore
    .document("projetos/{projId}/cronogramaSemanal/{semId}")
    .onWrite(async (change, context) => {
      const { projId, semId } = context.params || {};
      const base = change.after.exists ? (change.after.data() || {}) : (change.before.data() || {});
      if (!projId || !semId) return;
      try {
        const { ano, ciclo, meta } = await normalizeWeeklyDoc(projId, semId, base);
        await recomputeRollupForCycle(projId, ano, ciclo, meta);
        functionsV1.logger.info(`[rollup-v1] OK projeto=${projId} ciclo=${ano}-${ciclo}`);
      } catch (e) {
        functionsV1.logger.error("[rollup-v1] falha:", e);
      }
    });

// === backfill HTTP (mantém mesmo nome)
exports.backfillRollups = onRequest(
  { region:"us-central1", memory:"512MiB", timeoutSeconds:540 },
  async (req,res)=>{
    try{
      const token = String(req.query.token||"");
      const expected = String(appCfg.rollup_token || "TROQUE-ESTA-CHAVE");
      if(token !== expected) return res.status(401).send("unauthorized");

      const projSnap = await db.collection("projetos").get();
      let updated=0, obras=0;
      for(const pDoc of projSnap.docs){
        const projId = pDoc.id;
        const semSnap = await db.collection("projetos").doc(projId).collection("cronogramaSemanal").get();
        if(semSnap.empty) continue;
        obras++;

        const combos=new Set();
        for(const sDoc of semSnap.docs){
          const d=sDoc.data()||{};
          const norm = await normalizeWeeklyDoc(projId, sDoc.id, d);
          combos.add(`${norm.ano}-${norm.ciclo}`);
        }
        for(const k of combos){
          const [ano,ciclo]=k.split("-").map(Number);
          await recomputeRollupForCycle(projId, ano, ciclo);
          updated++;
        }
      }
      res.status(200).send(`Backfill concluído. Obras: ${obras}, rollups atualizados: ${updated}`);
    }catch(e){
      logger.error("Backfill erro:", e);
      res.status(500).send("erro");
    }
  }
);
