document.getElementById("loginForm").addEventListener("submit", function(e){
    e.preventDefault();

    let user = document.getElementById("username").value;
    let pass = document.getElementById("password").value;

    // Lista de usuários autorizados
    if(
        (user === "admin" && pass === "12345") ||
        (user === "Regional 1" && pass === "@reg123") ||
        (user === "Regional 2" && pass === "#reg234") ||
        (user === "Regional 3" && pass === "&reg345")
    ){
        window.location.href = "menu.html";
    } else {
        alert("Usuário ou senha incorretos!");
    }
});

