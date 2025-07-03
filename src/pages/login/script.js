document.addEventListener("DOMContentLoaded", () => {
    const API_BASE_URL = "http://localhost:3000"; // Replace with your actual API base URL

    const loginContainer = document.getElementById("login-container");
    const signupContainer = document.getElementById("signup-container");
    const showSignup = document.getElementById("show-signup");
    const showLogin = document.getElementById("show-login");

    const loginForm = document.getElementById("login-form");
    const signupForm = document.getElementById("signup-form");

    const loginMessage = document.getElementById("login-message");
    const signupMessage = document.getElementById("signup-message");

    showSignup.addEventListener("click", (e) => {
        e.preventDefault();
        loginContainer.classList.add("hidden");
        signupContainer.classList.remove("hidden");
    });

    showLogin.addEventListener("click", (e) => {
        e.preventDefault();
        signupContainer.classList.add("hidden");
        loginContainer.classList.remove("hidden");
    });

    loginForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        const emailOrUsername = document.getElementById("login-emailOrUsername").value;
        const password = document.getElementById("login-password").value;
        const rememberMe = document.getElementById("remember-me").checked;

        try {
            const response = await fetch(`${API_BASE_URL}/auth/login`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ emailOrUsername, password, rememberMe }),
            });

            const data = await response.json();

            if (response.ok) {
                loginMessage.textContent = "Login successful! Closing...";
                loginMessage.className = "message success";
                chrome.storage.local.set({ authToken: data.token }, () => {
                    setTimeout(() => {
                        window.parent.postMessage({ action: "loginSuccess" }, "*");
                    }, 1500);
                });
            } else {
                loginMessage.textContent = data.error || "Login failed.";
                loginMessage.className = "message error";
            }
        } catch (error) {
            loginMessage.textContent = "An error occurred. Please try again.";
            loginMessage.className = "message error";
        }
    });

    signupForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        const email = document.getElementById("signup-email").value;
        const username = document.getElementById("signup-username").value;
        const password = document.getElementById("signup-password").value;

        try {
            const response = await fetch(`${API_BASE_URL}/auth/signup`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ email, username, password }),
            });

            const data = await response.json();

            if (response.ok) {
                signupMessage.textContent = "Signup successful! Please log in.";
                signupMessage.className = "message success";
                setTimeout(() => {
                    signupContainer.classList.add("hidden");
                    loginContainer.classList.remove("hidden");
                    signupMessage.textContent = "";
                    document.getElementById("login-emailOrUsername").value = username;
                }, 2000);
            } else {
                signupMessage.textContent = data.error || "Signup failed.";
                signupMessage.className = "message error";
            }
        } catch (error) {
            signupMessage.textContent = "An error occurred. Please try again.";
            signupMessage.className = "message error";
        }
    });
});
