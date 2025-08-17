// ===============================
//   Firebase Config
// ===============================
const firebaseConfig = {
    apiKey: "AIzaSyCIN_N1vkthW3G9E7HubFg-C_61-WnFSRU",
    authDomain: "queops-84feb.firebaseapp.com",
    projectId: "queops-84feb",
    storageBucket: "queops-84feb.appspot.com",
    messagingSenderId: "415710636047",
    appId: "1:415710636047:web:58feb0b3fa8b5bcc199b7a"
};

firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();

let projetos = [];
let chartStatus, chartCustos;

// ===============================
//   CARREGAR PROJETOS
// ===============================
function carregarProjetos() {
  const toNum = (v) => {
    if (typeof v === "number") return v;
    if (typeof v === "string") {
      return Number(
        v.replace(/\s/g, "")
         .replace("R$", "")
         .replace(/\./g, "")
         .replace(",", ".")
         .replace("%", "")
      ) || 0;
    }
    return 0;
  };

  db.collection("projetos_atualizados")
    .onSnapshot((snapshot) => {
      const somas = new Map(); // { projetoId -> { custo, avanco } }
      const meta  = new Map(); // { projetoId -> { _ts, nomeProjeto, ... , ano } }

      snapshot.forEach(doc => {
        const d  = doc.data();

        // 🔹 NORMALIZA o id (resolve espaços, null, etc.)
        const idRaw = d.projetoId;
        const id = (idRaw === undefined || idRaw === null) ? "" : String(idRaw).trim();
        if (!id) return; // sem id, ignora

        const incCusto  = toNum(d.investimentoNovo);
        const incAvanco = toNum(d.avancoFisicoNovo);
        const ts        = d.dataAtualizacao?.toMillis?.() || 0;

        // soma incrementos
        const s = somas.get(id) || { custo: 0, avanco: 0, count: 0 };
        s.custo  += incCusto;
        s.avanco += incAvanco;
        s.count  += 1;
        somas.set(id, s);

        // doc mais recente p/ metadados
        const m = meta.get(id);
        if (!m || ts > (m._ts || 0)) {
          meta.set(id, {
            _ts: ts,
            nomeProjeto: d.nomeProjeto || "-",
            localidade:  d.localidade  || "-",
            regional:    d.regional    || "-",
            statusNovo:  d.statusNovo  || "-",
            ano: d.dataAtualizacao
              ? new Date(d.dataAtualizacao.toDate()).getFullYear()
              : "Não informado"
          });
        }
      });

      // (DEBUG) Veja no console quantos docs entraram por projeto
      // Abra o DevTools (F12) > Console
      const debugRows = Array.from(somas.entries()).map(([id, s]) => ({
        projetoId: id,
        docs: s.count,
        somaAvanco: s.avanco,
        somaCusto: s.custo
      }));
      console.table(debugRows);

      // monta array final
      projetos = Array.from(somas.keys()).map(id => {
        const s = somas.get(id);
        const m = meta.get(id) || {};
        return {
          nomeProjeto: m.nomeProjeto || "-",
          localidade:  m.localidade  || "-",
          regional:    m.regional    || "-",
          statusNovo:  m.statusNovo  || "-",
          investimentoTotal: s.custo,
          avancoTotal: Math.min(100, s.avanco), // soma de TODOS os incrementos
          ano: m.ano || "Não informado"
        };
      });

      if (projetos.length === 0) {
        document.getElementById("tabelaProjetos").innerHTML =
          `<tr><td colspan="6" style="text-align:center;">Nenhum projeto encontrado</td></tr>`;
        document.getElementById("totalObras").textContent = 0;
        document.getElementById("planejadas").textContent = 0;
        document.getElementById("andamento").textContent = 0;
        document.getElementById("paralisadas").textContent = 0;
        document.getElementById("concluidas").textContent = 0;
        if (chartStatus) chartStatus.destroy();
        if (chartCustos) chartCustos.destroy();
        return;
      }
      // DEBUG: ver agrupamento e somas
const debug = [];
somas.forEach((v, k) => {
  const m = meta.get(k);
  debug.push({
    projetoId: k,
    docs: v.count ?? 'n/a',
    somaAvanco: v.avanco,
    somaCusto: v.custo,
    nome: m?.nomeProjeto
  });
});
console.table(debug);


      preencherFiltros();
      atualizarIndicadores();
    });
}


// ===============================
//   PREENCHER FILTROS
// ===============================
function preencherFiltros() {
    const anos = [...new Set(projetos.map(p => (p.ano || "Não informado")))]; 
    const regionais = [...new Set(projetos.map(p => p.regional))];
    const localidades = [...new Set(projetos.map(p => p.localidade))];

    document.getElementById("filtroAno").innerHTML =
        `<option value="">Todos os anos</option>` +
        anos.map(a => `<option value="${a}">${a}</option>`).join("");

    document.getElementById("filtroRegional").innerHTML =
        `<option value="">Todas as regionais</option>` +
        regionais.map(r => `<option value="${r}">${r}</option>`).join("");

    document.getElementById("filtroLocalidade").innerHTML =
        `<option value="">Todas as localidades</option>` +
        localidades.map(l => `<option value="${l}">${l}</option>`).join("");
}

// ===============================
//   ATUALIZAR INDICADORES
// ===============================
function atualizarIndicadores() {
    const ano = document.getElementById("filtroAno").value;
    const regional = document.getElementById("filtroRegional").value;
    const localidade = document.getElementById("filtroLocalidade").value;

    let filtrados = projetos.filter(p => 
        (!ano || p.ano == ano) &&
        (!regional || p.regional == regional) &&
        (!localidade || p.localidade == localidade)
    );

    document.getElementById("totalObras").textContent = filtrados.length;
    document.getElementById("planejadas").textContent = filtrados.filter(p => p.statusNovo === "Planejado").length;
    document.getElementById("andamento").textContent = filtrados.filter(p => p.statusNovo === "Em andamento").length;
    document.getElementById("paralisadas").textContent = filtrados.filter(p => p.statusNovo === "Paralisado").length;
    document.getElementById("concluidas").textContent = filtrados.filter(p => p.statusNovo === "Concluído").length;

    const tabela = document.getElementById("tabelaProjetos");
    tabela.innerHTML = filtrados.map(p => `
        <tr>
            <td>${p.nomeProjeto || "-"}</td>
            <td>${p.localidade || "-"}</td>
            <td>${p.regional || "-"}</td>
            <td>R$ ${(p.investimentoTotal).toLocaleString('pt-BR', {minimumFractionDigits: 2})}</td>
            <td>${(p.avancoTotal).toFixed(2)}%</td>
            <td>${p.statusNovo || "-"}</td>
        </tr>
    `).join("");

    gerarGraficos(filtrados);
}

// ===============================
//   GERAR GRÁFICOS
// ===============================
function gerarGraficos(dados) {
    const statusCounts = { "Planejado": 0, "Em andamento": 0, "Paralisado": 0, "Concluído": 0 };
    const custosRegionais = {};

    dados.forEach(p => {
        statusCounts[p.statusNovo] = (statusCounts[p.statusNovo] || 0) + 1;

        let custoReal = parseFloat(p.investimentoTotal) || 0;
        custosRegionais[p.regional] = (custosRegionais[p.regional] || 0) + custoReal;
    });

    if(chartStatus) chartStatus.destroy();
    chartStatus = new Chart(document.getElementById("graficoStatus"), {
        type: 'bar',
        data: {
            labels: Object.keys(statusCounts),
            datasets: [{
                label: 'Quantidade de Obras',
                data: Object.values(statusCounts),
                backgroundColor: ["#999", "#007E7A", "#f39c12", "#27ae60"],
                borderRadius: 6
            }]
        },
        options: { responsive: true, maintainAspectRatio: false }
    });

    if(chartCustos) chartCustos.destroy();
    chartCustos = new Chart(document.getElementById("graficoCustos"), {
        type: 'bar',
        data: {
            labels: Object.keys(custosRegionais),
            datasets: [{
                label: 'Custos (R$)',
                data: Object.values(custosRegionais),
                backgroundColor: "#007E7A",
                borderRadius: 6
            }]
        },
        options: { responsive: true, maintainAspectRatio: false }
    });
}

document.getElementById("filtroAno").addEventListener("change", atualizarIndicadores);
document.getElementById("filtroRegional").addEventListener("change", atualizarIndicadores);
document.getElementById("filtroLocalidade").addEventListener("change", atualizarIndicadores);

carregarProjetos();






