/* =====================================================
   VERIFICAÇÃO DE SESSÃO (tela inicial)
   Extraído do <script> inline do index.html para que a página
   funcione com uma Content-Security-Policy estrita (sem
   'unsafe-inline' em script-src). Script inline é bloqueado por
   uma CSP correta — e é exatamente esse tipo de bloqueio que nos
   protege caso um dia um ataque de XSS tente injetar <script>.
===================================================== */

import {
  protegerPagina
} from "./authGuard.js";

const PAGINA_DASHBOARD =
"./dashboard.html";

const tituloStatus =
document.getElementById("tituloStatus");

const textoStatus =
document.getElementById("textoStatus");

async function iniciar() {

  try {

    if (tituloStatus) {
      tituloStatus.textContent =
      "Verificando acesso...";
    }

    if (textoStatus) {
      textoStatus.textContent =
      "Validando usuário, status e permissões.";
    }

    await protegerPagina();

    document.title =
    "Abrindo dashboard...";

    if (tituloStatus) {
      tituloStatus.textContent =
      "Acesso autorizado";
    }

    if (textoStatus) {
      textoStatus.textContent =
      "Abrindo o painel executivo.";
    }

    window.location.replace(
      PAGINA_DASHBOARD
    );

  } catch (error) {

    console.error(
      "Erro ao verificar sessão:",
      error
    );

    if (tituloStatus) {
      tituloStatus.textContent =
      "Falha ao verificar sessão";
    }

    if (textoStatus) {
      textoStatus.textContent =
      "Redirecionando para a tela de login.";
    }

  }

}

iniciar();