import { db } from "./firebaseConfig.js";
import { collection, getDocs } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

async function carregarProjetos() {
    const tabela = document.getElementById("tabelaProjetos");
    tabela.innerHTML = "";
    let contador = 1;

    try {
        const querySnapshot = await getDocs(collection(db, "projetos"));

        querySnapshot.forEach((doc) => {
            const projeto = doc.data();

            const row = `
                <tr>
                    <td>#${String(contador).padStart(3, '0')}</td> 
                    <td>${projeto.nomeProjeto || ""}</td>
                    <td>${projeto.localidade || ""}</td>
                    <td>${projeto.regional || ""}</td>
                    <td>${projeto.centroCusto || ""}</td>
                    <td>R$ ${Number(projeto.investimento).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}</td>
                    <td>${projeto.dataInicio || ""}</td>
                    <td>${projeto.dataTermino || ""}</td>
                    <td>${projeto.status || "Novo"}</td>
                </tr>
            `;
            tabela.innerHTML += row;
            contador++;
        });
    } catch (error) {
        console.error("Erro ao carregar os projetos:", error);
    }
}

window.onload = carregarProjetos;






