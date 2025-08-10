// Importando configurações do Firebase
import { db } from "./firebaseConfig.js";
import { collection, addDoc, doc, getDoc, setDoc, updateDoc } from "https://www.gstatic.com/firebasejs/10.12.3/firebase-firestore.js";

// Função para gerar ID sequencial automaticamente (com contador seguro)
async function gerarIdProjeto() {
    const contadorRef = doc(db, "contador", "projetos");
    const contadorSnap = await getDoc(contadorRef);

    let novoNumero = 1;
    if (contadorSnap.exists()) {
        novoNumero = contadorSnap.data().total + 1;
        await updateDoc(contadorRef, { total: novoNumero });
    } else {
        await setDoc(contadorRef, { total: 1 });
    }

    return `PRJ-${novoNumero.toString().padStart(3, '0')}`;
}

// Captura o evento de envio do formulário
document.getElementById("formProjeto").addEventListener("submit", async (e) => {
    e.preventDefault();

    try {
        // Coletando os valores dos campos do formulário
        const nome = document.getElementById("nomeProjeto").value.trim();
        const localidade = document.getElementById("localidade").value.trim();
        const regional = document.getElementById("regional").value.trim();
        const centroCusto = document.getElementById("centroCusto").value.trim();
        const dataInicio = document.getElementById("dataInicio").value;
        const dataTermino = document.getElementById("dataTermino").value;
        const emailSponsor = document.getElementById("emailSponsor").value.trim();
        const investimento = parseFloat(document.getElementById("investimento").value) || 0;

        // Validação dos campos obrigatórios
        if (!nome || !localidade || !regional || !centroCusto) {
            alert("⚠️ Preencha todos os campos obrigatórios!");
            return;
        }

        // Gerando ID do projeto com segurança
        const idProjeto = await gerarIdProjeto();

        // Salvando dados no Firestore
        await addDoc(collection(db, "projetos"), {
            idProjeto: idProjeto,
            status: "Planejado",
            nome: nome,
            localidade: localidade,
            regional: regional,
            centroCusto: centroCusto,
            dataInicio: dataInicio,
            dataTermino: dataTermino,
            emailSponsor: emailSponsor,
            investimento: investimento
        });

        // Mensagem de sucesso
        alert("✅ Projeto cadastrado com sucesso!");

        // 🔹 Limpar todos os campos do formulário
        const form = document.getElementById("formProjeto");
        form.reset();

        // Forçar limpeza manual (caso algum campo não seja resetado)
        document.querySelectorAll("#formProjeto input, #formProjeto select").forEach(el => {
            el.value = "";
        });

        console.log("✔ Campos limpos com sucesso.");

        // ✅ Redirecionar após 300ms (garante atualização do DOM)
        setTimeout(() => {
            window.location.href = "menu.html";
        }, 300);

    } catch (error) {
        console.error("❌ Erro ao cadastrar projeto: ", error);
        alert("❌ Erro ao salvar o projeto: " + error.message);
    }
});
