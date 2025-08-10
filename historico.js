document.addEventListener("DOMContentLoaded", () => {
  const db = window.db;

  const selectRegional  = document.getElementById("selectRegional");
  const selectProjeto   = document.getElementById("selectProjeto");
  const tabelaHistorico = document.getElementById("tabelaHistorico");
  const btnVoltar       = document.getElementById("btnVoltar");
  const btnImprimir     = document.getElementById("btnImprimir");

  // resumo
  const resumoWrap      = document.getElementById("resumoProjeto");
  const resumoInicio    = document.getElementById("resumoInicio");
  const resumoTermino   = document.getElementById("resumoTermino");
  const resumoCusto     = document.getElementById("resumoCusto");
  const resumoExecutado = document.getElementById("resumoExecutado"); // NOVO

  const fmtBRL = v => Number(v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  const fmtDT  = ts => ts?.toDate ? ts.toDate().toLocaleString("pt-BR") : "-";
  const fmtPct = v => `${(Number(v || 0)).toFixed(2)}%`;

  const fmtDataSimples = (val) => {
    if (!val) return "-";
    if (val.toDate) return val.toDate().toLocaleDateString("pt-BR");
    if (typeof val === "string") {
      const d = new Date(val);
      return isNaN(d) ? val : d.toLocaleDateString("pt-BR");
    }
    return "-";
  };

  // helper p/ somar "R$ 1.000,00" / "1000,5" etc.
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

  async function carregarRegionais() {
    try {
      const snap = await db.collection("projetos").get();
      const regionais = [...new Set(snap.docs.map(d => d.data().regional).filter(Boolean))].sort();
      selectRegional.innerHTML = regionais.length
        ? `<option value="">Selecione a regional</option>` +
          regionais.map(r => `<option value="${r}">${r}</option>`).join("")
        : `<option value="">Nenhuma regional encontrada</option>`;
    } catch (err) {
      console.error("Erro ao carregar regionais:", err);
      selectRegional.innerHTML = `<option value="">Erro ao carregar regionais</option>`;
    }
  }

  async function carregarProjetos() {
    selectProjeto.innerHTML = `<option value="">Carregando...</option>`;
    const regionalSelecionada = selectRegional.value;

    if (!regionalSelecionada) {
      selectProjeto.innerHTML = `<option value="">Selecione uma regional primeiro</option>`;
      tabelaHistorico.innerHTML = `<tr><td colspan="4">Selecione um projeto para visualizar o histórico.</td></tr>`;
      resumoWrap.hidden = true;
      return;
    }

    try {
      const snap = await db.collection("projetos")
        .where("regional", "==", regionalSelecionada)
        .get();

      if (snap.empty) {
        selectProjeto.innerHTML = `<option value="">Nenhum projeto encontrado</option>`;
        tabelaHistorico.innerHTML = `<tr><td colspan="4">Nenhum projeto nessa regional.</td></tr>`;
        resumoWrap.hidden = true;
        return;
      }

      let opts = `<option value="">Selecione um projeto</option>`;
      snap.forEach(doc => {
        const d = doc.data();
        const nome = d.nomeProjeto || d.nome || "Sem nome";
        opts += `<option value="${doc.id}">${nome}</option>`;
      });
      selectProjeto.innerHTML = opts;
      tabelaHistorico.innerHTML = `<tr><td colspan="4">Selecione um projeto para visualizar o histórico.</td></tr>`;
      resumoWrap.hidden = true;
    } catch (err) {
      console.error("Erro ao carregar projetos:", err);
      selectProjeto.innerHTML = `<option value="">Erro ao carregar projetos</option>`;
      resumoWrap.hidden = true;
    }
  }

  async function carregarResumoProjeto(projetoId) {
    resumoInicio.textContent    = "-";
    resumoTermino.textContent   = "-";
    resumoCusto.textContent     = "-";
    resumoExecutado.textContent = "-"; // limpa executado
    resumoWrap.hidden = true;

    try {
      const doc = await db.collection("projetos").doc(projetoId).get();
      if (!doc.exists) return;

      const p = doc.data();
      const custoOrcado = p.investimento != null ? p.investimento : (p.custoOrcado != null ? p.custoOrcado : 0);

      resumoInicio.textContent  = fmtDataSimples(p.dataInicio);
      resumoTermino.textContent = fmtDataSimples(p.dataTermino);
      resumoCusto.textContent   = fmtBRL(custoOrcado);

      // executado será preenchido em carregarHistorico (após somar os incrementos)
      resumoWrap.hidden = false;
    } catch (e) {
      console.error("Erro ao carregar resumo do projeto:", e);
      resumoWrap.hidden = true;
    }
  }

  async function carregarHistorico() {
    tabelaHistorico.innerHTML = `<tr><td colspan="4">Carregando histórico...</td></tr>`;

    const projetoId = selectProjeto.value;
    if (!projetoId) {
      tabelaHistorico.innerHTML = `<tr><td colspan="4">Selecione um projeto para visualizar o histórico.</td></tr>`;
      resumoWrap.hidden = true;
      return;
    }

    // preenche início/término/orçado
    await carregarResumoProjeto(projetoId);

    try {
      const snap = await db.collection("projetos_atualizados")
        .where("projetoId", "==", projetoId)
        .orderBy("dataAtualizacao", "desc")
        .get();

      if (snap.empty) {
        tabelaHistorico.innerHTML = `<tr><td colspan="4">Nenhuma atualização encontrada para este projeto.</td></tr>`;
        resumoExecutado.textContent = fmtBRL(0); // executado = 0 quando não há histórico
        resumoWrap.hidden = false;
        return;
      }

      let totalExecutado = 0;
      let html = "";

      snap.forEach(doc => {
        const d = doc.data();

        // soma executado (incrementos)
        totalExecutado += toNum(d.investimentoNovo);

        html += `
          <tr>
            <td>${fmtDT(d.dataAtualizacao)}</td>
            <td>${fmtBRL(d.investimentoNovo)}</td>
            <td>${fmtPct(d.avancoFisicoNovo)}</td>
            <td>${d.statusNovo || "-"}</td>
          </tr>`;
      });

      tabelaHistorico.innerHTML = html;
      resumoExecutado.textContent = fmtBRL(totalExecutado); // mostra executado no resumo
      resumoWrap.hidden = false;
    } catch (err) {
      console.error("Erro ao carregar histórico:", err);
      tabelaHistorico.innerHTML = `<tr><td colspan="4">Erro ao carregar histórico.</td></tr>`;
    }
  }

  // Botões
  btnVoltar.addEventListener("click", () => (window.location.href = "menu.html"));
  btnImprimir.addEventListener("click", () => window.print());

  // Eventos
  selectRegional.addEventListener("change", carregarProjetos);
  selectProjeto.addEventListener("change", carregarHistorico);

  // Início
  carregarRegionais();
});
