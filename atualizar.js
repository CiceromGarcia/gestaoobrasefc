// Configuração do Firebase
const firebaseConfig = {
    apiKey: "AIzaSyCIN_N1vkthW3G9E7HubFg-C_61-WnFSRU",
    authDomain: "queops-84feb.firebaseapp.com",
    projectId: "queops-84feb",
    storageBucket: "queops-84feb.firebasestorage.app",
    messagingSenderId: "415710636047",
    appId: "1:415710636047:web:58feb0b3fa8b5bcc199b7a"
};

firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();

// Função para atualizar projeto
document.getElementById("formAtualizar").addEventListener("submit", async (e) => {
    e.preventDefault();

    // Captura os dados do formulário
    const projetoId = document.getElementById("projetoId").value.trim();
    const investimentoNovo = parseFloat(document.getElementById("investimentoNovo").value) || 0;
    const avancoFisicoNovo = parseFloat(document.getElementById("avancoFisicoNovo").value) || 0;
    const statusNovo = document.getElementById("statusNovo").value;
    const dataAtualizacao = new Date();

    if (!projetoId) {
        alert("Selecione um projeto para atualizar!");
        return;
    }

    try {
        // ✅ Adiciona um novo documento sem apagar o histórico
        await db.collection("projetos_atualizados").add({
            projetoId: projetoId,
            investimentoNovo: investimentoNovo, // valor da atualização
            avancoFisicoNovo: avancoFisicoNovo,
            statusNovo: statusNovo,
            dataAtualizacao: dataAtualizacao
        });

        alert("Atualização registrada com sucesso!");
        document.getElementById("formAtualizar").reset();

    } catch (error) {
        console.error("Erro ao atualizar projeto: ", error);
        alert("Erro ao atualizar o projeto. Tente novamente.");
    }
});

