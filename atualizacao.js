import { db } from "./firebaseConfig.js";

import {

  collection,
  getDocs,
  addDoc

} from "https://www.gstatic.com/firebasejs/10.12.3/firebase-firestore.js";

/* =========================================
   ELEMENTOS
========================================= */

const filtroLocalidade =
document.getElementById("filtroLocalidade");

const filtroObra =
document.getElementById("filtroObra");

const dataInicio =
document.getElementById("dataInicio");

const dataFim =
document.getElementById("dataFim");

const valorObra =
document.getElementById("valorObra");

const tbodyPlanejado =
document.getElementById("tbodyPlanejado");

const btnSalvar =
document.getElementById("btnSalvar");

/* =========================================
   VARIÁVEIS
========================================= */

let obras = [];

/* =========================================
   FORMATAR MOEDA
========================================= */

function formatarMoeda(valor){

  return Number(valor || 0)
  .toLocaleString(
    "pt-BR",
    {
      minimumFractionDigits:2,
      maximumFractionDigits:2
    }
  );

}

/* =========================================
   CONVERTER MOEDA
========================================= */

function converterMoeda(valor){

  if(!valor) return 0;

  return Number(

    String(valor)

    .replace("R$","")

    .replace(/\./g,"")

    .replace(",",".")
  );

}

/* =========================================
   CARREGAR OBRAS
========================================= */

async function carregarObras(){

  const snapshot =
  await getDocs(
    collection(db,"obras")
  );

  obras = [];

  snapshot.forEach((doc)=>{

    obras.push({

      id:doc.id,

      ...doc.data()

    });

  });

  carregarLocalidades();

}

/* =========================================
   LOCALIDADES
========================================= */

function carregarLocalidades(){

  filtroLocalidade.innerHTML =
  `<option value="">Todas</option>`;

  const localidades =
  [...new Set(
    obras.map(
      item => item.localidade
    )
  )];

  localidades.forEach((localidade)=>{

    filtroLocalidade.innerHTML += `
      <option value="${localidade}">
        ${localidade}
      </option>
    `;

  });

}

/* =========================================
   OBRAS
========================================= */

async function carregarFiltroObras(){

  filtroObra.innerHTML =
  `<option value="">Selecione</option>`;

  /* =========================================
     BUSCAR OBRAS JÁ PLANEJADAS
  ========================================= */

  const planejadasSnapshot =
  await getDocs(
    collection(
      db,
      "planejamentoCurvaS"
    )
  );

  const obrasPlanejadas =
  [];

  planejadasSnapshot.forEach((doc)=>{

    const dados = doc.data();

    if(dados.obraId){

      obrasPlanejadas.push(
        dados.obraId
      );

    }

  });

  /* =========================================
     FILTRAR OBRAS
  ========================================= */

  let lista = [...obras];

  if(filtroLocalidade.value){

    lista = lista.filter(
      item =>
      item.localidade ===
      filtroLocalidade.value
    );

  }

  /* =========================================
     REMOVER PLANEJADAS
  ========================================= */

  lista = lista.filter(
    item =>
    !obrasPlanejadas.includes(
      item.id
    )
  );

  /* =========================================
     MONTAR SELECT
  ========================================= */

  lista.forEach((obra)=>{

    filtroObra.innerHTML += `
      <option value="${obra.id}">
        ${obra.nomeProjeto}
      </option>
    `;

  });

}

/* =========================================
   GERAR SEMANAS
========================================= */

function gerarPlanejamentoSemanal(){

  tbodyPlanejado.innerHTML = "";

  if(
    !dataInicio.value ||
    !dataFim.value ||
    !filtroObra.value
  ) return;

  const obraSelecionada =
  obras.find(
    item => item.id === filtroObra.value
  );

  /* =========================================
     VALOR OBRA
  ========================================= */

  const valorTotalObra =
  converterMoeda(

    obraSelecionada?.valorObra ||

    obraSelecionada?.investimento ||

    0
  );

  valorObra.value =

    "R$ " +

    valorTotalObra.toLocaleString(
      "pt-BR",
      {
        minimumFractionDigits:2,
        maximumFractionDigits:2
      }
    );

  const inicioObra =
  new Date(
    dataInicio.value + "T00:00:00"
  );

  const fimObra =
  new Date(
    dataFim.value + "T00:00:00"
  );

  if(fimObra < inicioObra){

    alert(
      "A data final não pode ser menor que a data inicial."
    );

    return;

  }

  let inicioSemana =
  new Date(inicioObra);

  let semana = 1;

  while(inicioSemana <= fimObra){

    let fimSemana =
    new Date(inicioSemana);

    fimSemana.setDate(
      fimSemana.getDate() + 6
    );

    if(fimSemana > fimObra){

      fimSemana =
      new Date(fimObra);

    }

    const periodo =

      inicioSemana
      .toLocaleDateString("pt-BR")

      +

      " a "

      +

      fimSemana
      .toLocaleDateString("pt-BR");

    tbodyPlanejado.innerHTML += `

      <tr>

        <td>
          SEM ${semana}
        </td>

        <td>
          ${periodo}
        </td>

        <!-- FÍSICO -->

        <td>

          <input
            type="number"
            class="fisico"
            placeholder="0">

        </td>

        <!-- FÍSICO ACUMULADO -->

        <td class="fisicoAcumulado">
          0%
        </td>

        <!-- FINANCEIRO -->

        <td>

          <input
            type="text"
            class="financeiro"
            placeholder="0,00">

        </td>

        <!-- FINANCEIRO ACUMULADO -->

        <td class="financeiroAcumulado">
          R$ 0,00
        </td>

      </tr>

    `;

    inicioSemana.setDate(
      inicioSemana.getDate() + 7
    );

    semana++;

  }

  setTimeout(()=>{

    document
    .querySelectorAll(
      ".fisico, .financeiro"
    )
    .forEach((input)=>{

      input.addEventListener(
        "input",
        atualizarAcumulados
      );

    });

  },100);

}

/* =========================================
   ACUMULADOS
========================================= */

function atualizarAcumulados(){

  const linhas =
  document.querySelectorAll(
    "#tbodyPlanejado tr"
  );

  let acumuladoFisico = 0;
  let acumuladoFinanceiro = 0;

  linhas.forEach((linha)=>{

    const inputFisico =
    linha.querySelector(".fisico");

    const inputFinanceiro =
    linha.querySelector(".financeiro");

    const tdFisicoAcumulado =
    linha.querySelector(
      ".fisicoAcumulado"
    );

    const tdFinanceiroAcumulado =
    linha.querySelector(
      ".financeiroAcumulado"
    );

    const fisico =
    Number(
      inputFisico.value || 0
    );

    const financeiro =
    converterMoeda(
      inputFinanceiro.value
    );

    acumuladoFisico += fisico;

    acumuladoFinanceiro += financeiro;

    tdFisicoAcumulado.innerText =

      acumuladoFisico
      .toFixed(2)
      .replace(".",",")

      + "%";

    tdFinanceiroAcumulado.innerText =

      "R$ " +

      acumuladoFinanceiro
      .toLocaleString(
        "pt-BR",
        {
          minimumFractionDigits:2,
          maximumFractionDigits:2
        }
      );

  });

}

/* =========================================
   SALVAR PLANEJAMENTO
========================================= */

btnSalvar.addEventListener(
  "click",
  async ()=>{

    if(!filtroObra.value){

      alert(
        "Selecione uma obra."
      );

      return;

    }

    const linhas =
    document.querySelectorAll(
      "#tbodyPlanejado tr"
    );

    if(!linhas.length){

      alert(
        "Nenhum planejamento gerado."
      );

      return;

    }

    try{

      /* =========================================
         SALVAR SEMANAS
      ========================================= */

      for(const linha of linhas){

        const semana =
        linha.children[0].innerText;

        const periodo =
        linha.children[1].innerText;

        const fisico =
        linha.querySelector(".fisico")
        .value;

        const fisicoAcumulado =
        linha.querySelector(
          ".fisicoAcumulado"
        ).innerText;

        const financeiro =
        linha.querySelector(".financeiro")
        .value;

        const financeiroAcumulado =
        linha.querySelector(
          ".financeiroAcumulado"
        ).innerText;

        await addDoc(

          collection(
            db,
            "planejamentoCurvaS"
          ),

          {

            obraId:
            filtroObra.value,

            obra:
            filtroObra.options[
              filtroObra.selectedIndex
            ].text,

            localidade:
            filtroLocalidade.value,

            semana,

            periodo,

            fisico,

            fisicoAcumulado,

            financeiro,

            financeiroAcumulado,

            valorTotalObra:
            valorObra.value,

            dataInicio:
            dataInicio.value,

            dataFim:
            dataFim.value,

            criadoEm:
            new Date()

          }

        );

      }

      /* =========================================
         REMOVER OBRA DO FILTRO
      ========================================= */

      obras = obras.filter(
        item =>
        item.id !== filtroObra.value
      );

      await carregarFiltroObras();

      /* =========================================
         LIMPAR TELA
      ========================================= */

      tbodyPlanejado.innerHTML = "";

      valorObra.value = "";

      dataInicio.value = "";

      dataFim.value = "";

      filtroObra.value = "";

      alert(
        "Planejamento salvo com sucesso!"
      );

    }catch(erro){

      console.error(erro);

      alert(
        "Erro ao salvar planejamento."
      );

    }

  }
);

/* =========================================
   EVENTOS
========================================= */

filtroLocalidade.addEventListener(
  "change",
  carregarFiltroObras
);

dataInicio.addEventListener(
  "change",
  gerarPlanejamentoSemanal
);

dataFim.addEventListener(
  "change",
  gerarPlanejamentoSemanal
);

filtroObra.addEventListener(
  "change",
  gerarPlanejamentoSemanal
);

/* =========================================
   INIT
========================================= */

carregarObras();