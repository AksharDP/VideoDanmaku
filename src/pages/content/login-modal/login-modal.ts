import { login, signup, type LoginRequest, type SignupRequest } from "../api";
import "../css/login-modal.css";

export class LoginModal {
    private modalElement: HTMLElement | null = null;

    constructor() {
        this.bindMethods();
    }

    private bindMethods() {
        this.closeModal = this.closeModal.bind(this);
    }

    public show(): void {
        if (document.getElementById("danmaku-login-modal")) return;

        this.createModal();
        this.loadAndAppendForm().then(() => {
            this.setupEventListeners();
        });
    }

    private createModal(): void {
        const modalOverlay = document.createElement("div");
        modalOverlay.id = "danmaku-login-modal";
        modalOverlay.className = "danmaku-modal-overlay";

        const modalContent = document.createElement("div");
        modalContent.className = "danmaku-modal-content";

        const closeButton = document.createElement("button");
        closeButton.className = "danmaku-modal-close";
        closeButton.innerHTML = "&times;";
        closeButton.onclick = this.closeModal;

        modalContent.appendChild(closeButton);
        modalOverlay.appendChild(modalContent);
        document.body.appendChild(modalOverlay);

        this.modalElement = modalOverlay;

        this.modalElement.addEventListener("mousedown", (event) => {
            if (event.target === this.modalElement) {
                this.closeModal();
            }
        });
    }

    private async loadAndAppendForm(): Promise<void> {
        try {
            const response = await fetch(chrome.runtime.getURL('src/pages/content/login-modal/login-modal.html'));
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            const html = await response.text();
            const modalContent = this.modalElement?.querySelector('.danmaku-modal-content');
            if (modalContent) {
                const loginForm = document.createElement("div");
                loginForm.className = "danmaku-login-form";
                loginForm.innerHTML = html;
                modalContent.appendChild(loginForm);
            }
        } catch (error) {
            console.error("Failed to load login form HTML:", error);
            // Optionally, display an error message to the user
        }
    }

    private setupEventListeners(): void {
        const loginBtn = document.getElementById("danmaku-login-btn");
        const signupBtn = document.getElementById("danmaku-signup-btn");
        const switchToSignup = document.getElementById("danmaku-switch-to-signup");
        const switchToLogin = document.getElementById("danmaku-switch-to-login");

        // Add real-time validation listeners
        const emailUsernameInput = document.getElementById("danmaku-email-username") as HTMLInputElement;
        const signupEmailInput = document.getElementById("danmaku-signup-email") as HTMLInputElement;
        const usernameInput = document.getElementById("danmaku-username") as HTMLInputElement;
        const passwordInput = document.getElementById("danmaku-password") as HTMLInputElement;
        const signupPasswordInput = document.getElementById("danmaku-signup-password") as HTMLInputElement;
        const confirmPasswordInput = document.getElementById("danmaku-confirm-password") as HTMLInputElement;

        // Real-time validation
        emailUsernameInput?.addEventListener("input", () => this.validateEmailOrUsername(emailUsernameInput));
        signupEmailInput?.addEventListener("input", () => this.validateEmail(signupEmailInput));
        usernameInput?.addEventListener("input", () => this.validateUsername(usernameInput));
        passwordInput?.addEventListener("input", () => this.validatePassword(passwordInput, "danmaku-password-error"));
        signupPasswordInput?.addEventListener("input", () => {
            this.validatePassword(signupPasswordInput, "danmaku-signup-password-error");
            if (confirmPasswordInput?.value) {
                this.validatePasswordMatch(signupPasswordInput, confirmPasswordInput);
            }
        });
        confirmPasswordInput?.addEventListener("input", () => this.validatePasswordMatch(signupPasswordInput, confirmPasswordInput));

        loginBtn?.addEventListener("click", () => this.handleLogin());
        signupBtn?.addEventListener("click", () => this.handleSignup());

        switchToSignup?.addEventListener("click", () => this.switchToSignupMode());
        switchToLogin?.addEventListener("click", () => this.switchToLoginMode());

        // Update button states initially
        this.updateButtonStates();
    }

    private validateEmail(input: HTMLInputElement): boolean {
        const email = input.value.trim();
        const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
        const errorElement = document.getElementById("danmaku-signup-email-error");

        if (!email) {
            this.setFieldError(input, errorElement, "Email is required");
            return false;
        }

        if (email.length > 254) {
            this.setFieldError(input, errorElement, "Email must be 254 characters or less");
            return false;
        }

        if (!emailRegex.test(email)) {
            this.setFieldError(input, errorElement, "Please enter a valid email address");
            return false;
        }

        this.setFieldValid(input, errorElement);
        return true;
    }

    private validateEmailOrUsername(input: HTMLInputElement): boolean {
        const value = input.value.trim();
        const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
        const usernameRegex = /^[a-zA-Z0-9_-]{3,32}$/;
        const errorElement = document.getElementById("danmaku-email-username-error");

        if (!value) {
            this.setFieldError(input, errorElement, "Email or username is required");
            return false;
        }

        if (value.includes("@")) {
            if (value.length > 254) {
                this.setFieldError(input, errorElement, "Email must be 254 characters or less");
                return false;
            }
            if (!emailRegex.test(value)) {
                this.setFieldError(input, errorElement, "Please enter a valid email address");
                return false;
            }
        } else {
            if (value.length > 32) {
                this.setFieldError(input, errorElement, "Username must be 32 characters or less");
                return false;
            }
            if (!usernameRegex.test(value)) {
                this.setFieldError(input, errorElement, "Username must be 3-32 characters, alphanumeric, underscore, or hyphen only");
                return false;
            }
        }

        this.setFieldValid(input, errorElement);
        return true;
    }

    private validateUsername(input: HTMLInputElement): boolean {
        const username = input.value.trim();
        const usernameRegex = /^[a-zA-Z0-9_-]{3,32}$/;
        const errorElement = document.getElementById("danmaku-username-error");

        if (!username) {
            this.setFieldError(input, errorElement, "Username is required");
            return false;
        }

        if (username.length < 3) {
            this.setFieldError(input, errorElement, "Username must be at least 3 characters");
            return false;
        }

        if (username.length > 32) {
            this.setFieldError(input, errorElement, "Username must be 32 characters or less");
            return false;
        }

        if (!usernameRegex.test(username)) {
            this.setFieldError(input, errorElement, "Username can only contain letters, numbers, underscores, and hyphens");
            return false;
        }

        this.setFieldValid(input, errorElement);
        return true;
    }

    private validatePassword(input: HTMLInputElement, errorElementId: string): boolean {
        const password = input.value;
        const errorElement = document.getElementById(errorElementId);

        if (!password) {
            this.setFieldError(input, errorElement, "Password is required");
            return false;
        }

        if (password.length < 8) {
            this.setFieldError(input, errorElement, "Password must be at least 8 characters");
            return false;
        }

        if (password.length > 128) {
            this.setFieldError(input, errorElement, "Password must be 128 characters or less");
            return false;
        }

        const hasUpperCase = /[A-Z]/.test(password);
        const hasLowerCase = /[a-z]/.test(password);
        const hasNumbers = /\d/.test(password);
        const hasSpecialChar = /[!@#$%^&*(),.?":{}|<>]/.test(password);

        const strengthChecks = [hasUpperCase, hasLowerCase, hasNumbers, hasSpecialChar];
        const passedChecks = strengthChecks.filter(Boolean).length;

        if (passedChecks < 2) {
            this.setFieldError(input, errorElement, "Password should include uppercase, lowercase, numbers, or special characters");
            return false;
        }

        if (/^(.)\1+$/.test(password)) {
            this.setFieldError(input, errorElement, "Password cannot be all the same character");
            return false;
        }

        if (/^(012345|123456|234567|345678|456789|567890|678901|789012|890123|901234)/.test(password)) {
            this.setFieldError(input, errorElement, "Password cannot be a simple sequence");
            return false;
        }

        const unsafeChars = /[<>'"&]/;
        if (unsafeChars.test(password)) {
            this.setFieldError(input, errorElement, "Password cannot contain < > ' \" & characters");
            return false;
        }

        this.setFieldValid(input, errorElement);
        return true;
    }

    private validatePasswordMatch(passwordInput: HTMLInputElement, confirmInput: HTMLInputElement): boolean {
        const password = passwordInput.value;
        const confirmPassword = confirmInput.value;
        const errorElement = document.getElementById("danmaku-confirm-password-error");

        if (!confirmPassword) {
            this.setFieldError(confirmInput, errorElement, "Please confirm your password");
            return false;
        }

        if (password !== confirmPassword) {
            this.setFieldError(confirmInput, errorElement, "Passwords do not match");
            return false;
        }

        this.setFieldValid(confirmInput, errorElement);
        return true;
    }

    private setFieldError(input: HTMLInputElement, errorElement: HTMLElement | null, message: string): void {
        input.classList.remove("valid");
        input.classList.add("error");
        if (errorElement) {
            errorElement.textContent = message;
        }
        this.updateButtonStates();
    }

    private setFieldValid(input: HTMLInputElement, errorElement: HTMLElement | null): void {
        input.classList.remove("error");
        input.classList.add("valid");
        if (errorElement) {
            errorElement.textContent = "";
        }
        this.updateButtonStates();
    }

    private updateButtonStates(): void {
        const loginBtn = document.getElementById("danmaku-login-btn") as HTMLButtonElement;
        const signupBtn = document.getElementById("danmaku-signup-btn") as HTMLButtonElement;
        const loginMode = document.getElementById("danmaku-login-mode");
        const signupMode = document.getElementById("danmaku-signup-mode");

        if (loginBtn && loginMode && loginMode.style.display !== "none") {
            const emailUsernameInput = document.getElementById("danmaku-email-username") as HTMLInputElement;
            const passwordInput = document.getElementById("danmaku-password") as HTMLInputElement;

            const isValid = emailUsernameInput?.value.trim() &&
                           passwordInput?.value &&
                           !emailUsernameInput?.classList.contains("error") &&
                           !passwordInput?.classList.contains("error");

            loginBtn.disabled = !isValid;
        }

        if (signupBtn && signupMode && signupMode.style.display !== "none") {
            const emailInput = document.getElementById("danmaku-signup-email") as HTMLInputElement;
            const usernameInput = document.getElementById("danmaku-username") as HTMLInputElement;
            const passwordInput = document.getElementById("danmaku-signup-password") as HTMLInputElement;
            const confirmInput = document.getElementById("danmaku-confirm-password") as HTMLInputElement;

            const isValid = emailInput?.value.trim() &&
                           usernameInput?.value.trim() &&
                           passwordInput?.value &&
                           confirmInput?.value &&
                           !emailInput?.classList.contains("error") &&
                           !usernameInput?.classList.contains("error") &&
                           !passwordInput?.classList.contains("error") &&
                           !confirmInput?.classList.contains("error");

            signupBtn.disabled = !isValid;
        }
    }

    private switchToSignupMode(): void {
        const loginMode = document.getElementById("danmaku-login-mode");
        const signupMode = document.getElementById("danmaku-signup-mode");
        const title = document.getElementById("danmaku-modal-title");

        if (loginMode && signupMode && title) {
            loginMode.style.display = "none";
            signupMode.style.display = "flex";
            title.textContent = "Create Account";
        }

        this.hideError();
        this.updateButtonStates();
    }

    private switchToLoginMode(): void {
        const loginMode = document.getElementById("danmaku-login-mode");
        const signupMode = document.getElementById("danmaku-signup-mode");
        const title = document.getElementById("danmaku-modal-title");

        if (loginMode && signupMode && title) {
            loginMode.style.display = "flex";
            signupMode.style.display = "none";
            title.textContent = "Welcome";
        }

        this.hideError();
        this.updateButtonStates();
    }

    private async handleLogin(): Promise<void> {
        const emailOrUsername = (document.getElementById("danmaku-email-username") as HTMLInputElement)?.value;
        const password = (document.getElementById("danmaku-password") as HTMLInputElement)?.value;
        const rememberMe = (document.getElementById("danmaku-remember-me") as HTMLInputElement)?.checked || false;

        // Validate before submitting
        const emailUsernameInput = document.getElementById("danmaku-email-username") as HTMLInputElement;
        const passwordInput = document.getElementById("danmaku-password") as HTMLInputElement;

        const isEmailUsernameValid = this.validateEmailOrUsername(emailUsernameInput);
        const isPasswordValid = this.validatePassword(passwordInput, "danmaku-password-error");

        if (!isEmailUsernameValid || !isPasswordValid) {
            this.showError("Please fix the errors above");
            return;
        }

        const loginData: LoginRequest = {
            emailOrUsername,
            password,
            rememberMe,
        };

        const result = await login(loginData);

        if (result.success && result.token) {
            chrome.storage.local.set({ authToken: result.token });
            this.closeModal();
            this.dispatchLoginSuccess();
        } else {
            this.showError(result.error || "Login failed");
        }
    }

    private async handleSignup(): Promise<void> {
        const email = (document.getElementById("danmaku-signup-email") as HTMLInputElement)?.value;
        const username = (document.getElementById("danmaku-username") as HTMLInputElement)?.value;
        const password = (document.getElementById("danmaku-signup-password") as HTMLInputElement)?.value;

        // Validate all fields before submitting
        const emailInput = document.getElementById("danmaku-signup-email") as HTMLInputElement;
        const usernameInput = document.getElementById("danmaku-username") as HTMLInputElement;
        const passwordInput = document.getElementById("danmaku-signup-password") as HTMLInputElement;
        const confirmInput = document.getElementById("danmaku-confirm-password") as HTMLInputElement;

        const isEmailValid = this.validateEmail(emailInput);
        const isUsernameValid = this.validateUsername(usernameInput);
        const isPasswordValid = this.validatePassword(passwordInput, "danmaku-signup-password-error");
        const isPasswordMatchValid = this.validatePasswordMatch(passwordInput, confirmInput);

        if (!isEmailValid || !isUsernameValid || !isPasswordValid || !isPasswordMatchValid) {
            this.showError("Please fix the errors above");
            return;
        }

        const signupData: SignupRequest = {
            email,
            username,
            password,
        };

        const result = await signup(signupData);

        if (result.success) {
            // Auto-login after successful signup
            await this.performLogin(email, password);
        } else {
            this.showError(result.error || "Signup failed");
        }
    }

    private async performLogin(emailOrUsername: string, password: string): Promise<void> {
        const loginData: LoginRequest = {
            emailOrUsername,
            password,
            rememberMe: false,
        };

        const result = await login(loginData);

        if (result.success && result.token) {
            chrome.storage.local.set({ authToken: result.token });
            this.closeModal();
            this.dispatchLoginSuccess();
        } else {
            this.showError("Login after signup failed. Please try logging in manually.");
        }
    }

    private showError(message: string): void {
        const errorDiv = document.getElementById("danmaku-login-error");
        if (errorDiv) {
            errorDiv.textContent = message;
            errorDiv.style.display = "block";
        }
    }

    private hideError(): void {
        const errorDiv = document.getElementById("danmaku-login-error");
        if (errorDiv) {
            errorDiv.style.display = "none";
        }
    }

    private dispatchLoginSuccess(): void {
        const event = new CustomEvent("danmaku-login-success");
        document.dispatchEvent(event);
    }

    public closeModal(): void {
        if (this.modalElement) {
            this.modalElement.remove();
            this.modalElement = null;
        }
    }
}
