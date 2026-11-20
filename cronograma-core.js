/* =====================================================
   CRONOGRAMA DA OBRA — NÚCLEO COMPARTILHADO
   Arquivo: cronograma-core.js

   Cálculo de datas em dias úteis, resumo e desenho do Gantt.
   Usado por cronograma.js (edição) e detalhe-obra.js (somente
   leitura), pra as duas telas sempre mostrarem o mesmo resultado.
===================================================== */

export const DIA_MS = 86400000;

/* =========================================
   DATAS
========================================= */

export function escaparHtml(valor) {
  return String(valor ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[c]));
}

export function analisarData(texto) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(texto || ""))) {
    throw new Error("Informe uma data válida (AAAA-MM-DD).");
  }

  const data = new Date(`${texto}T12:00:00Z`);

  if (isNaN(data) || data.toISOString().slice(0, 10) !== texto) {
    throw new Error("Informe uma data válida (AAAA-MM-DD).");
  }

  return data;
}

export function paraISO(data) {
  return data.toISOString().slice(0, 10);
}

export function somarDias(data, dias) {
  return new Date(data.getTime() + dias * DIA_MS);
}

export function formatarData(data) {
  return data
    ? data.toLocaleDateString("pt-BR", { timeZone: "UTC" })
    : "—";
}

// Formato do MS Project: dia da semana + data curta (ex.: "seg 28/09/26").
export function formatarDataProject(data) {
  if (!data) {
    return "—";
  }

  const diaSemana = new Intl.DateTimeFormat("pt-BR", {
    timeZone: "UTC",
    weekday: "short"
  })
    .format(data)
    .replace(".", "");

  const curta = data.toLocaleDateString("pt-BR", {
    timeZone: "UTC",
    day: "2-digit",
    month: "2-digit",
    year: "2-digit"
  });

  return `${diaSemana} ${curta}`;
}

export function hojeISO() {
  const agora = new Date();
  const ano = agora.getFullYear();
  const mes = String(agora.getMonth() + 1).padStart(2, "0");
  const dia = String(agora.getDate()).padStart(2, "0");

  return `${ano}-${mes}-${dia}`;
}

// Aceita AAAA-MM-DD ou DD/MM/AAAA e devolve sempre AAAA-MM-DD válido.
export function normalizarDataTexto(texto) {
  const limpo = String(texto || "").trim();
  const br = limpo.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  const candidato = br ? `${br[3]}-${br[2]}-${br[1]}` : limpo;

  analisarData(candidato);

  return candidato;
}

/* =========================================
   CALENDÁRIO (dias úteis)
========================================= */

// calendario = { sabado: boolean, feriados: ["AAAA-MM-DD", ...] }
// sabadosExtras = sábados específicos (AAAA-MM-DD) que a obra confirmou
// que vai trabalhar, além do calendário padrão. Domingo nunca é útil.
export function criarCalendario(calendario, sabadosExtras = []) {
  return {
    sabado: Boolean(calendario?.sabado),
    feriados: new Set(Array.isArray(calendario?.feriados) ? calendario.feriados : []),
    extras: new Set(Array.isArray(sabadosExtras) ? sabadosExtras : [])
  };
}

export function ehDiaUtil(data, cal) {
  const diaSemana = data.getUTCDay();

  if (diaSemana === 0) {
    return false;
  }

  const iso = paraISO(data);

  if (cal.feriados.has(iso)) {
    return false;
  }

  return diaSemana !== 6 || cal.sabado || cal.extras.has(iso);
}

export function proximoDiaUtil(data, cal) {
  let atual = data;
  let tentativas = 0;

  while (!ehDiaUtil(atual, cal)) {
    atual = somarDias(atual, 1);

    if (++tentativas > 3700) {
      throw new Error("Calendário sem dias de trabalho disponíveis.");
    }
  }

  return atual;
}

export function fimPorDiasUteis(inicio, duracao, cal) {
  let atual = proximoDiaUtil(inicio, cal);

  for (let i = 1; i < duracao; i++) {
    atual = proximoDiaUtil(somarDias(atual, 1), cal);
  }

  return atual;
}

/* =========================================
   CRONOGRAMA
   estado = { inicio: "AAAA-MM-DD", tasks: [{ id, name, duration,
   peso, progress, dependency, earliest }] }
========================================= */

export function calcularCronograma(estado, calendario) {
  const cal = criarCalendario(calendario, estado.sabados);
  const porId = new Map(estado.tasks.map((t) => [t.id, t]));
  const resultado = new Map();
  const visitando = new Set();
  const inicioProjeto = analisarData(estado.inicio);

  function visitar(id) {
    if (resultado.has(id)) {
      return resultado.get(id);
    }

    if (visitando.has(id)) {
      throw new Error("Há um ciclo entre predecessoras.");
    }

    const tarefa = porId.get(id);

    if (!tarefa) {
      throw new Error("Predecessora inexistente.");
    }

    visitando.add(id);

    let inicio = inicioProjeto;

    if (tarefa.earliest && analisarData(tarefa.earliest) > inicio) {
      inicio = analisarData(tarefa.earliest);
    }

    if (tarefa.dependency) {
      const depois = somarDias(visitar(tarefa.dependency).fim, 1);

      if (depois > inicio) {
        inicio = depois;
      }
    }

    inicio = proximoDiaUtil(inicio, cal);

    const item = {
      inicio,
      fim: fimPorDiasUteis(inicio, tarefa.duration, cal)
    };

    resultado.set(id, item);
    visitando.delete(id);

    return item;
  }

  estado.tasks.forEach((t) => visitar(t.id));

  return resultado;
}

export function somaPesos(estado) {
  return estado.tasks.reduce((total, t) => total + Number(t.peso || 0), 0);
}

// Avanço geral ponderado pelo peso de cada atividade. Se nenhuma tem
// peso informado, cai pra ponderação pela duração.
export function avancoGeral(estado) {
  const pesoTotal = somaPesos(estado);

  if (pesoTotal > 0) {
    return (
      estado.tasks.reduce((total, t) => total + Number(t.peso || 0) * t.progress, 0) /
      pesoTotal
    );
  }

  const duracaoTotal = estado.tasks.reduce((total, t) => total + t.duration, 0);

  return duracaoTotal > 0
    ? estado.tasks.reduce((total, t) => total + t.duration * t.progress, 0) / duracaoTotal
    : 0;
}

export function resumirCronograma(estado, calendario, datas) {
  const cal = criarCalendario(calendario, estado.sabados);

  if (!estado.tasks.length) {
    return {
      quantidade: 0,
      primeiro: null,
      ultimo: null,
      diasCorridos: 0,
      diasUteis: 0,
      somaPesos: 0,
      avanco: 0
    };
  }

  const primeiro = proximoDiaUtil(analisarData(estado.inicio), cal);
  let ultimo = primeiro;

  for (const item of datas.values()) {
    if (item.fim > ultimo) {
      ultimo = item.fim;
    }
  }

  const diasCorridos = Math.round((ultimo - primeiro) / DIA_MS) + 1;
  let diasUteis = 0;

  for (let i = 0; i < Math.min(diasCorridos, 4000); i++) {
    if (ehDiaUtil(somarDias(primeiro, i), cal)) {
      diasUteis++;
    }
  }

  return {
    quantidade: estado.tasks.length,
    primeiro,
    ultimo,
    diasCorridos,
    diasUteis,
    somaPesos: somaPesos(estado),
    avanco: avancoGeral(estado)
  };
}

export function formatarPeso(valor) {
  return `${Number(valor || 0).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`;
}

/* =========================================
   GANTT (HTML)
========================================= */

function nomeDiaSemana(data) {
  return new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC", weekday: "short" })
    .format(data)
    .replace(".", "");
}

function classeDiaNaoUtil(data, cal) {
  if (ehDiaUtil(data, cal)) {
    return "";
  }

  return cal.feriados.has(paraISO(data)) ? "cr-feriado" : "cr-fimsemana";
}

export function montarGanttHTML(estado, calendario, opcoes = {}) {
  const {
    escala = "dia",
    editavel = false,
    vazioTitulo = "Nenhuma atividade cadastrada",
    vazioTexto = ""
  } = opcoes;

  if (!estado.tasks.length) {
    return `<div class="cr-vazio"><strong>${escaparHtml(vazioTitulo)}</strong>${escaparHtml(vazioTexto)}</div>`;
  }

  let datas;

  try {
    datas = calcularCronograma(estado, calendario);
  } catch (erro) {
    return `<div class="cr-vazio">${escaparHtml(erro.message)}</div>`;
  }

  const cal = criarCalendario(calendario, estado.sabados);
  const resumo = resumirCronograma(estado, calendario, datas);
  const primeiro = resumo.primeiro;
  const larguraDia = escala === "semana" ? 22 : 32;
  const totalDias = Math.max(21, Math.min(370, resumo.diasCorridos + 7));
  const dias = Array.from({ length: totalDias }, (_, i) => somarDias(primeiro, i));
  const hoje = hojeISO();
  const hojeData = analisarData(hoje);
  const indiceHoje = dias.findIndex((d) => paraISO(d) === hoje);
  const estiloDia = `flex-basis:${larguraDia}px;width:${larguraDia}px`;

  const cabecalhoDias = dias
    .map((dia, i) => {
      const rotulo =
        i === 0 || dia.getUTCDate() === 1
          ? new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC", month: "short" }).format(dia)
          : dia.getUTCDate();

      return `<div class="cr-dia ${classeDiaNaoUtil(dia, cal)}" style="${estiloDia}" title="${escaparHtml(formatarData(dia))}"><b>${escaparHtml(rotulo)}</b><span>${escaparHtml(nomeDiaSemana(dia))}</span></div>`;
    })
    .join("");

  const grade = dias
    .map((dia) => `<div class="cr-grade-dia ${classeDiaNaoUtil(dia, cal)}" style="${estiloDia}"></div>`)
    .join("");

  const linhas = estado.tasks
    .map((tarefa, indice) => {
      const item = datas.get(tarefa.id);
      const deslocamento = Math.round((item.inicio - primeiro) / DIA_MS);
      const comprimento = Math.round((item.fim - item.inicio) / DIA_MS) + 1;
      const atrasada = tarefa.progress < 100 && item.fim < hojeData;
      const predecessora = tarefa.dependency
        ? estado.tasks.find((x) => x.id === tarefa.dependency)
        : null;
      const numeroPredecessora = tarefa.dependency
        ? estado.tasks.findIndex((x) => x.id === tarefa.dependency) + 1
        : 0;

      const acoes = editavel
        ? `<td class="cr-col-acao"><button type="button" class="cr-icone" data-cr-editar="${escaparHtml(tarefa.id)}" aria-label="Editar ${escaparHtml(tarefa.name)}" title="Editar"><i class="fa-solid fa-pen"></i></button><button type="button" class="cr-icone cr-perigo" data-cr-excluir="${escaparHtml(tarefa.id)}" aria-label="Excluir ${escaparHtml(tarefa.name)}" title="Excluir"><i class="fa-solid fa-trash"></i></button></td>`
        : "";

      return `<tr>
        <td class="cr-fixa cr-col-id">${indice + 1}</td>
        <td class="cr-fixa cr-col-nome" title="${escaparHtml(tarefa.name)}"><span class="cr-nome">${escaparHtml(tarefa.name)}</span><span class="cr-sub">${predecessora ? `Após ${escaparHtml(predecessora.name)}` : "Sem predecessora"}</span></td>
        <td class="cr-col-duracao cr-num">${tarefa.duration} ${tarefa.duration === 1 ? "dia" : "dias"}</td>
        <td class="cr-col-data cr-num">${escaparHtml(formatarDataProject(item.inicio))}</td>
        <td class="cr-col-data cr-num">${escaparHtml(formatarDataProject(item.fim))}</td>
        <td class="cr-col-dep">${numeroPredecessora ? `#${numeroPredecessora}` : "—"}</td>
        <td class="cr-col-peso cr-num">${escaparHtml(formatarPeso(tarefa.peso))}</td>
        <td class="cr-col-avanco"><span class="cr-barra-avanco"><i style="width:${tarefa.progress}%"></i></span><span class="cr-avanco-texto">${tarefa.progress}%</span></td>
        ${acoes}
        <td class="cr-linha-tempo"><div class="cr-gantt" style="width:${totalDias * larguraDia}px">${grade}<div class="cr-barra ${atrasada ? "cr-atrasada" : ""}" title="${escaparHtml(tarefa.name)}: ${escaparHtml(formatarData(item.inicio))} a ${escaparHtml(formatarData(item.fim))} · ${tarefa.progress}%" style="left:${deslocamento * larguraDia + 2}px;width:${comprimento * larguraDia - 4}px"><i style="width:${tarefa.progress}%"></i></div>${indiceHoje >= 0 ? `<div class="cr-hoje" style="left:${indiceHoje * larguraDia + larguraDia / 2}px"></div>` : ""}</div></td>
      </tr>`;
    })
    .join("");

  return `<table class="cr-tabela"><thead><tr>
    <th class="cr-fixa cr-col-id">#</th>
    <th class="cr-fixa cr-col-nome">Atividade</th>
    <th class="cr-col-duracao">Duração</th>
    <th class="cr-col-data">Início</th>
    <th class="cr-col-data">Fim</th>
    <th class="cr-col-dep">Dep.</th>
    <th class="cr-col-peso">Peso</th>
    <th class="cr-col-avanco">Avanço</th>
    ${editavel ? '<th class="cr-col-acao">Ações</th>' : ""}
    <th class="cr-linha-tempo" style="width:${totalDias * larguraDia}px"><div class="cr-dias" style="width:${totalDias * larguraDia}px">${cabecalhoDias}</div></th>
  </tr></thead><tbody>${linhas}</tbody></table>`;
}

/* =========================================
   CURVA S PLANEJADA A PARTIR DO CRONOGRAMA
========================================= */

// Físico planejado ACUMULADO (0 a 100) ao fim de cada data informada
// (AAAA-MM-DD). Cada atividade contribui com o seu peso multiplicado
// pela fração dos seus dias úteis já decorridos. Os pesos são
// normalizados pela soma (se não fecham em 100%, o resultado final
// continua fechando em 100%); sem nenhum peso, pondera pela duração.
export function fisicoAcumuladoPorData(estado, calendario, datasLimiteISO) {
  const cal = criarCalendario(calendario, estado.sabados);
  const datas = calcularCronograma(estado, calendario);
  const usarPeso = somaPesos(estado) > 0;
  const pesoDe = (t) => (usarPeso ? Number(t.peso || 0) : t.duration);
  const total = estado.tasks.reduce((soma, t) => soma + pesoDe(t), 0);

  if (total <= 0) {
    return datasLimiteISO.map(() => 0);
  }

  return datasLimiteISO.map((iso) => {
    const limite = analisarData(iso);
    let acumulado = 0;

    estado.tasks.forEach((tarefa) => {
      const item = datas.get(tarefa.id);

      if (limite < item.inicio) {
        return;
      }

      const ate = limite < item.fim ? limite : item.fim;
      let diasFeitos = 0;

      for (let dia = item.inicio; dia <= ate; dia = somarDias(dia, 1)) {
        if (ehDiaUtil(dia, cal)) {
          diasFeitos++;
        }
      }

      acumulado += pesoDe(tarefa) * Math.min(1, diasFeitos / tarefa.duration);
    });

    return (acumulado / total) * 100;
  });
}
