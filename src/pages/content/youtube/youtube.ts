import "./style.css";
import danmakuHtml from "./danmakuinput.html?raw";
import { DanmakuInput } from "./danmaku-input";
import {
    getComments,
    postComment,
    login,
    signup,
    type LoginRequest,
    type SignupRequest,
} from "../api";
import { Danmaku } from "../danmaku/danmaku";

export interface SiteAdapter {
    getDanmakuHtml(): string;
    getVideoPlayer(): Promise<HTMLVideoElement | null>;
    getVideoId(): string | null;
    getTitle(): Promise<Element | null>;
    setupEventListeners(): Promise<void>;
    initializeDanmaku(): Promise<void>;
    destroy(): void;
}

export class YouTubeAdapter implements SiteAdapter {
    private danmaku: Danmaku | null = null;
    private commentsCount: number = 0;

    getDanmakuHtml(): string {
        return danmakuHtml;
    }

    async getVideoPlayer(): Promise<HTMLVideoElement | null> {
        return (
            (await this.waitForElement(
                ".html5-main-video"
            )) as HTMLVideoElement) || null;
    }

    getVideoId(): string | null {
        const params = new URLSearchParams(window.location.search);
        return params.get("v");
    }

    async getTitle(): Promise<Element | null> {
        const watchMetadata = await this.waitForElement(
            "ytd-watch-metadata",
            10000
        );
        if (!watchMetadata) {
            console.error(
                "Could not find ytd-watch-metadata element after waiting."
            );
            return null;
        }
        return (watchMetadata as HTMLElement).querySelector("#title");
    }

    async initializeDanmaku() {
        const videoPlayer = await this.getVideoPlayer();
        const videoId = this.getVideoId();

        if (videoPlayer && videoId) {
            this.danmaku = new Danmaku(videoPlayer);
            const videoDuration = videoPlayer.duration;
            const commentLimit =
                videoDuration < 60
                    ? 200
                    : videoDuration < 300
                    ? 1000
                    : videoDuration < 600
                    ? 2000
                    : videoDuration < 1800
                    ? 18000
                    : 36000;
            try {
                const comments = await getComments("youtube", videoId, commentLimit);
                this.danmaku.loadComments(comments);
                this.updateCommentsCount(comments.length);
            } catch (error) {
                console.error("Failed to load comments:", error);
                this.updateCommentsCountError();
            }
        }
    }

    private updateCommentsCount(count: number): void {
        this.commentsCount = count;
        const commentsCountElement = document.getElementById("danmaku-comments-loaded");
        if (commentsCountElement) {
            commentsCountElement.textContent = `${count} comment${count === 1 ? "" : "s"} loaded`;
        }
    }

    private updateCommentsCountError(): void {
        const commentsCountElement = document.getElementById("danmaku-comments-loaded");
        if (commentsCountElement) {
            commentsCountElement.textContent = "Failed to load comments";
            commentsCountElement.style.color = "#ff4444";
        }
    }

    async setupEventListeners(): Promise<void> {
        const container = (await this.waitForElement(
            ".danmaku-input-container"
        )) as HTMLElement;
        const videoPlayer = await this.getVideoPlayer();
        
        if (container && videoPlayer && this.danmaku) {
            // Pass the Danmaku instance to DanmakuInput for local comment injection
            new DanmakuInput(container, videoPlayer, this.danmaku);
            // Listen for the custom login event
            document.addEventListener('danmaku-open-login', () => {
                this.createLoginModal();
            });
        } else {
            console.error("Could not find danmaku input container, video player, or danmaku instance");
        }
    }

    private createLoginModal() {
        if (document.getElementById("danmaku-login-modal")) return;

        const modalOverlay = document.createElement("div");
        modalOverlay.id = "danmaku-login-modal";
        modalOverlay.className = "danmaku-modal-overlay";

        const modalContent = document.createElement("div");
        modalContent.className = "danmaku-modal-content";

        const closeButton = document.createElement("button");
        closeButton.className = "danmaku-modal-close";
        closeButton.innerHTML = "&times;";
        closeButton.onclick = () => this.closeLoginModal();

        const loginForm = document.createElement("div");
        loginForm.className = "danmaku-login-form";
        loginForm.innerHTML = `
            <h2 id="danmaku-modal-title">Welcome</h2>
            
            <!-- Login Mode Fields -->
            <div id="danmaku-login-mode" class="danmaku-mode-section">
                <div class="danmaku-form-group">
                    <input type="text" id="danmaku-email-username" placeholder="Enter email or username" required>
                    <div class="danmaku-field-error" id="danmaku-email-username-error"></div>
                </div>
                <div class="danmaku-form-group">
                    <input type="password" id="danmaku-password" placeholder="Password" required>
                    <div class="danmaku-field-error" id="danmaku-password-error"></div>
                </div>
                <div class="danmaku-checkbox-group">
                    <label class="danmaku-checkbox-label">
                        <input type="checkbox" id="danmaku-remember-me" class="danmaku-checkbox">
                        <span class="danmaku-checkbox-text">Remember me</span>
                    </label>
                </div>
                <button type="button" id="danmaku-login-btn" class="danmaku-primary-btn">Login</button>
                
                <div class="danmaku-divider">
                    <span>OR</span>
                </div>
                
                <button type="button" id="danmaku-switch-to-signup" class="danmaku-secondary-btn">Sign Up</button>
            </div>
            
            <!-- Signup Mode Fields -->
            <div id="danmaku-signup-mode" class="danmaku-mode-section" style="display: none;">
                <div class="danmaku-form-group">
                    <input type="email" id="danmaku-signup-email" placeholder="Email" required>
                    <div class="danmaku-field-error" id="danmaku-signup-email-error"></div>
                </div>
                <div class="danmaku-form-group">
                    <input type="text" id="danmaku-username" placeholder="Username" required>
                    <div class="danmaku-field-error" id="danmaku-username-error"></div>
                </div>
                <div class="danmaku-form-group">
                    <input type="password" id="danmaku-signup-password" placeholder="Password" required>
                    <div class="danmaku-field-error" id="danmaku-signup-password-error"></div>
                </div>
                <div class="danmaku-form-group">
                    <input type="password" id="danmaku-confirm-password" placeholder="Confirm Password" required>
                    <div class="danmaku-field-error" id="danmaku-confirm-password-error"></div>
                </div>
                <button type="button" id="danmaku-signup-btn" class="danmaku-primary-btn">Create Account</button>
                
                <div class="danmaku-divider">
                    <span>OR</span>
                </div>
                
                <button type="button" id="danmaku-switch-to-login" class="danmaku-secondary-btn">Login</button>
            </div>
            
            <div id="danmaku-login-error" class="danmaku-error" style="display: none;"></div>
        `;

        modalContent.appendChild(closeButton);
        modalContent.appendChild(loginForm);
        modalOverlay.appendChild(modalContent);
        document.body.appendChild(modalOverlay);

        this.addLoginModalStyles();
        this.setupLoginFormListeners();
    }

    private addLoginModalStyles() {
        const style = document.createElement("style");
        style.textContent = `
            .danmaku-modal-overlay {
                position: fixed;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                background: rgba(0, 0, 0, 0.8);
                display: flex;
                justify-content: center;
                align-items: center;
                z-index: 10000;
            }
            .danmaku-modal-content {
                background: #1a1a1a;
                border-radius: 12px;
                padding: 30px;
                max-width: 400px;
                width: 90%;
                position: relative;
                color: white;
                display: flex;
                flex-direction: column;
                align-items: center;
            }
            .danmaku-modal-close {
                position: absolute;
                top: 15px;
                right: 20px;
                background: none;
                border: none;
                font-size: 28px;
                color: #ccc;
                cursor: pointer;
                z-index: 1;
            }
            .danmaku-login-form {
                width: 100%;
                display: flex;
                flex-direction: column;
                align-items: center;
                gap: 16px;
            }
            .danmaku-login-form h2 {
                margin: 0 0 20px 0;
                color: white;
                text-align: center;
                font-size: 24px;
            }
            .danmaku-mode-section {
                width: 100%;
                display: flex;
                flex-direction: column;
                align-items: center;
                gap: 16px;
            }
            .danmaku-form-group {
                width: 100%;
            }
            .danmaku-form-group input {
                width: 100%;
                padding: 12px 16px;
                border: 1px solid #333;
                border-radius: 8px;
                background: #2a2a2a;
                color: white;
                box-sizing: border-box;
                font-size: 14px;
                transition: border-color 0.2s;
            }
            .danmaku-form-group input:focus {
                outline: none;
                border-color: #0066cc;
            }
            .danmaku-form-group input.error {
                border-color: #ff4444;
            }
            .danmaku-form-group input.valid {
                border-color: #44ff44;
            }
            .danmaku-field-error {
                margin-top: 4px;
                font-size: 12px;
                color: #ff4444;
                min-height: 16px;
                line-height: 1.3;
            }
            .danmaku-checkbox-group {
                width: 100%;
                display: flex;
                justify-content: flex-start;
                margin: 8px 0;
            }
            .danmaku-checkbox-label {
                display: flex;
                align-items: center;
                cursor: pointer;
                gap: 8px;
                font-size: 14px;
                color: #ccc;
            }
            .danmaku-checkbox {
                width: 16px;
                height: 16px;
                border: 1px solid #555;
                border-radius: 3px;
                background: #2a2a2a;
                cursor: pointer;
                appearance: none;
                position: relative;
                display: flex;
                align-items: center;
                justify-content: center;
            }
            .danmaku-checkbox:checked {
                background: #0066cc;
                border-color: #0066cc;
            }
            .danmaku-checkbox:checked::after {
                content: '✓';
                position: absolute;
                top: 50%;
                left: 50%;
                transform: translate(-50%, -50%);
                color: white;
                font-size: 10px;
                font-weight: bold;
                line-height: 1;
            }
            .danmaku-checkbox-text {
                user-select: none;
            }
            .danmaku-primary-btn {
                width: 90%;
                padding: 12px 16px;
                border: none;
                border-radius: 8px;
                background: #0066cc;
                color: white;
                cursor: pointer;
                font-size: 16px;
                font-weight: 500;
                transition: background-color 0.2s;
            }
            .danmaku-primary-btn:hover:not(:disabled) {
                background: #0052a3;
            }
            .danmaku-primary-btn:disabled {
                background: #444;
                cursor: not-allowed;
                opacity: 0.6;
            }
            .danmaku-secondary-btn {
                width: 90%;
                padding: 12px 16px;
                border: 1px solid #333;
                border-radius: 8px;
                background: transparent;
                color: white;
                cursor: pointer;
                font-size: 16px;
                font-weight: 500;
                transition: all 0.2s;
            }
            .danmaku-secondary-btn:hover {
                background: #333;
                border-color: #555;
            }
            .danmaku-divider {
                width: 100%;
                display: flex;
                align-items: center;
                margin: 8px 0;
            }
            .danmaku-divider::before,
            .danmaku-divider::after {
                content: '';
                flex: 1;
                height: 1px;
                background: #333;
            }
            .danmaku-divider span {
                padding: 0 16px;
                color: #ccc;
                font-size: 14px;
            }
            .danmaku-error {
                color: #ff4444;
                text-align: center;
                margin-top: 10px;
                font-size: 14px;
            }
        `;
        document.head.appendChild(style);
    }

    private setupLoginFormListeners() {
        const loginBtn = document.getElementById("danmaku-login-btn");
        const signupBtn = document.getElementById("danmaku-signup-btn");
        const switchToSignup = document.getElementById(
            "danmaku-switch-to-signup"
        );
        const switchToLogin = document.getElementById(
            "danmaku-switch-to-login"
        );

        // Add real-time validation listeners
        const emailUsernameInput = document.getElementById(
            "danmaku-email-username"
        ) as HTMLInputElement;
        const signupEmailInput = document.getElementById(
            "danmaku-signup-email"
        ) as HTMLInputElement;
        const usernameInput = document.getElementById(
            "danmaku-username"
        ) as HTMLInputElement;
        const passwordInput = document.getElementById(
            "danmaku-password"
        ) as HTMLInputElement;
        const signupPasswordInput = document.getElementById(
            "danmaku-signup-password"
        ) as HTMLInputElement;
        const confirmPasswordInput = document.getElementById(
            "danmaku-confirm-password"
        ) as HTMLInputElement;

        // Real-time validation
        emailUsernameInput?.addEventListener("input", () =>
            this.validateEmailOrUsername(emailUsernameInput)
        );
        signupEmailInput?.addEventListener("input", () =>
            this.validateEmail(signupEmailInput)
        );
        usernameInput?.addEventListener("input", () =>
            this.validateUsername(usernameInput)
        );
        passwordInput?.addEventListener("input", () =>
            this.validatePassword(passwordInput, "danmaku-password-error")
        );
        signupPasswordInput?.addEventListener("input", () => {
            this.validatePassword(
                signupPasswordInput,
                "danmaku-signup-password-error"
            );
            // Also revalidate confirm password if it has content
            if (confirmPasswordInput?.value) {
                this.validatePasswordMatch(
                    signupPasswordInput,
                    confirmPasswordInput
                );
            }
        });
        confirmPasswordInput?.addEventListener("input", () =>
            this.validatePasswordMatch(
                signupPasswordInput,
                confirmPasswordInput
            )
        );

        loginBtn?.addEventListener("click", () => this.handleLogin());
        signupBtn?.addEventListener("click", () => this.handleSignup());

        switchToSignup?.addEventListener("click", () =>
            this.switchToSignupMode()
        );
        switchToLogin?.addEventListener("click", () =>
            this.switchToLoginMode()
        );

        // Update button states initially
        this.updateButtonStates();
    }

    // Validation methods based on server schema constraints
    private validateEmail(input: HTMLInputElement): boolean {
        const email = input.value.trim();
        const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
        const errorElement = document.getElementById(
            "danmaku-signup-email-error"
        );

        if (!email) {
            this.setFieldError(input, errorElement, "Email is required");
            return false;
        }

        // Server constraint: varchar(254) - exact database limit
        if (email.length > 254) {
            this.setFieldError(
                input,
                errorElement,
                "Email must be 254 characters or less"
            );
            return false;
        }

        if (!emailRegex.test(email)) {
            this.setFieldError(
                input,
                errorElement,
                "Please enter a valid email address"
            );
            return false;
        }

        this.setFieldValid(input, errorElement);
        return true;
    }

    private validateEmailOrUsername(input: HTMLInputElement): boolean {
        const value = input.value.trim();
        const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
        const usernameRegex = /^[a-zA-Z0-9_-]{3,32}$/;
        const errorElement = document.getElementById(
            "danmaku-email-username-error"
        );

        if (!value) {
            this.setFieldError(
                input,
                errorElement,
                "Email or username is required"
            );
            return false;
        }

        // Check if it looks like an email
        if (value.includes("@")) {
            // Server constraint: varchar(254) - exact database limit
            if (value.length > 254) {
                this.setFieldError(
                    input,
                    errorElement,
                    "Email must be 254 characters or less"
                );
                return false;
            }
            if (!emailRegex.test(value)) {
                this.setFieldError(
                    input,
                    errorElement,
                    "Please enter a valid email address"
                );
                return false;
            }
        } else {
            // Validate as username - Server constraint: varchar(32)
            if (value.length > 32) {
                this.setFieldError(
                    input,
                    errorElement,
                    "Username must be 32 characters or less"
                );
                return false;
            }
            if (!usernameRegex.test(value)) {
                this.setFieldError(
                    input,
                    errorElement,
                    "Username must be 3-32 characters, alphanumeric, underscore, or hyphen only"
                );
                return false;
            }
        }

        this.setFieldValid(input, errorElement);
        return true;
    }

    private validateUsername(input: HTMLInputElement): boolean {
        const username = input.value.trim();
        // Server constraint: varchar(32) - exact database limit
        const usernameRegex = /^[a-zA-Z0-9_-]{3,32}$/;
        const errorElement = document.getElementById("danmaku-username-error");

        if (!username) {
            this.setFieldError(input, errorElement, "Username is required");
            return false;
        }

        if (username.length < 3) {
            this.setFieldError(
                input,
                errorElement,
                "Username must be at least 3 characters"
            );
            return false;
        }

        // Server constraint: varchar(32) - exact database limit
        if (username.length > 32) {
            this.setFieldError(
                input,
                errorElement,
                "Username must be 32 characters or less"
            );
            return false;
        }

        if (!usernameRegex.test(username)) {
            this.setFieldError(
                input,
                errorElement,
                "Username can only contain letters, numbers, underscores, and hyphens"
            );
            return false;
        }

        this.setFieldValid(input, errorElement);
        return true;
    }

    private validatePassword(
        input: HTMLInputElement,
        errorElementId: string
    ): boolean {
        const password = input.value;
        const errorElement = document.getElementById(errorElementId);

        if (!password) {
            this.setFieldError(input, errorElement, "Password is required");
            return false;
        }

        // Server constraint from auth.ts: minimum 8 characters
        if (password.length < 8) {
            this.setFieldError(
                input,
                errorElement,
                "Password must be at least 8 characters"
            );
            return false;
        }

        // Practical limit for raw password (before hashing)
        // Note: Server stores hashed password (varchar(64)), but we limit raw password to reasonable length
        if (password.length > 128) {
            this.setFieldError(
                input,
                errorElement,
                "Password must be 128 characters or less"
            );
            return false;
        }

        // Additional security recommendations
        const hasUpperCase = /[A-Z]/.test(password);
        const hasLowerCase = /[a-z]/.test(password);
        const hasNumbers = /\d/.test(password);
        const hasSpecialChar = /[!@#$%^&*(),.?":{}|<>]/.test(password);

        const strengthChecks = [
            hasUpperCase,
            hasLowerCase,
            hasNumbers,
            hasSpecialChar,
        ];
        const passedChecks = strengthChecks.filter(Boolean).length;

        if (passedChecks < 2) {
            this.setFieldError(
                input,
                errorElement,
                "Password should include uppercase, lowercase, numbers, or special characters"
            );
            return false;
        }

        // Check for common weak patterns
        if (/^(.)\1+$/.test(password)) {
            // All same character
            this.setFieldError(
                input,
                errorElement,
                "Password cannot be all the same character"
            );
            return false;
        }

        if (
            /^(012345|123456|234567|345678|456789|567890|678901|789012|890123|901234)/.test(
                password
            )
        ) {
            this.setFieldError(
                input,
                errorElement,
                "Password cannot be a simple sequence"
            );
            return false;
        }

        // Check for potentially unsafe characters that might cause issues with sanitization
        const unsafeChars = /[<>'"&]/;
        if (unsafeChars.test(password)) {
            this.setFieldError(
                input,
                errorElement,
                "Password cannot contain < > ' \" & characters"
            );
            return false;
        }

        this.setFieldValid(input, errorElement);
        return true;
    }

    private validatePasswordMatch(
        passwordInput: HTMLInputElement,
        confirmInput: HTMLInputElement
    ): boolean {
        const password = passwordInput.value;
        const confirmPassword = confirmInput.value;
        const errorElement = document.getElementById(
            "danmaku-confirm-password-error"
        );

        if (!confirmPassword) {
            this.setFieldError(
                confirmInput,
                errorElement,
                "Please confirm your password"
            );
            return false;
        }

        if (password !== confirmPassword) {
            this.setFieldError(
                confirmInput,
                errorElement,
                "Passwords do not match"
            );
            return false;
        }

        this.setFieldValid(confirmInput, errorElement);
        return true;
    }

    private setFieldError(
        input: HTMLInputElement,
        errorElement: HTMLElement | null,
        message: string
    ) {
        input.classList.remove("valid");
        input.classList.add("error");
        if (errorElement) {
            errorElement.textContent = message;
        }
        this.updateButtonStates();
    }

    private setFieldValid(
        input: HTMLInputElement,
        errorElement: HTMLElement | null
    ) {
        input.classList.remove("error");
        input.classList.add("valid");
        if (errorElement) {
            errorElement.textContent = "";
        }
        this.updateButtonStates();
    }

    private updateButtonStates() {
        const loginBtn = document.getElementById(
            "danmaku-login-btn"
        ) as HTMLButtonElement;
        const signupBtn = document.getElementById(
            "danmaku-signup-btn"
        ) as HTMLButtonElement;
        const loginMode = document.getElementById("danmaku-login-mode");
        const signupMode = document.getElementById("danmaku-signup-mode");

        if (loginBtn && loginMode && loginMode.style.display !== "none") {
            const emailUsernameInput = document.getElementById(
                "danmaku-email-username"
            ) as HTMLInputElement;
            const passwordInput = document.getElementById(
                "danmaku-password"
            ) as HTMLInputElement;

            const isValid =
                emailUsernameInput?.value.trim() &&
                passwordInput?.value &&
                !emailUsernameInput?.classList.contains("error") &&
                !passwordInput?.classList.contains("error");

            loginBtn.disabled = !isValid;
        }

        if (signupBtn && signupMode && signupMode.style.display !== "none") {
            const emailInput = document.getElementById(
                "danmaku-signup-email"
            ) as HTMLInputElement;
            const usernameInput = document.getElementById(
                "danmaku-username"
            ) as HTMLInputElement;
            const passwordInput = document.getElementById(
                "danmaku-signup-password"
            ) as HTMLInputElement;
            const confirmInput = document.getElementById(
                "danmaku-confirm-password"
            ) as HTMLInputElement;

            const isValid =
                emailInput?.value.trim() &&
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

    private switchToSignupMode() {
        const loginMode = document.getElementById("danmaku-login-mode");
        const signupMode = document.getElementById("danmaku-signup-mode");
        const title = document.getElementById("danmaku-modal-title");

        if (loginMode && signupMode && title) {
            loginMode.style.display = "none";
            signupMode.style.display = "flex";
            title.textContent = "Create Account";
        }

        this.hideLoginError();
        this.updateButtonStates();
    }

    private switchToLoginMode() {
        const loginMode = document.getElementById("danmaku-login-mode");
        const signupMode = document.getElementById("danmaku-signup-mode");
        const title = document.getElementById("danmaku-modal-title");

        if (loginMode && signupMode && title) {
            loginMode.style.display = "flex";
            signupMode.style.display = "none";
            title.textContent = "Welcome";
        }

        this.hideLoginError();
        this.updateButtonStates();
    }

    private async handleLogin() {
        const emailOrUsername = (
            document.getElementById(
                "danmaku-email-username"
            ) as HTMLInputElement
        )?.value;
        const password = (
            document.getElementById("danmaku-password") as HTMLInputElement
        )?.value;
        const rememberMe =
            (document.getElementById("danmaku-remember-me") as HTMLInputElement)
                ?.checked || false;

        // Validate before submitting
        const emailUsernameInput = document.getElementById(
            "danmaku-email-username"
        ) as HTMLInputElement;
        const passwordInput = document.getElementById(
            "danmaku-password"
        ) as HTMLInputElement;

        const isEmailUsernameValid =
            this.validateEmailOrUsername(emailUsernameInput);
        const isPasswordValid = this.validatePassword(
            passwordInput,
            "danmaku-password-error"
        );

        if (!isEmailUsernameValid || !isPasswordValid) {
            this.showLoginError("Please fix the errors above");
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
            this.closeLoginModal();
            this.updateUIBasedOnAuth();
        } else {
            this.showLoginError(result.error || "Login failed");
        }
    }

    private async handleSignup() {
        const email = (
            document.getElementById("danmaku-signup-email") as HTMLInputElement
        )?.value;
        const username = (
            document.getElementById("danmaku-username") as HTMLInputElement
        )?.value;
        const password = (
            document.getElementById(
                "danmaku-signup-password"
            ) as HTMLInputElement
        )?.value;
        const confirmPassword = (
            document.getElementById(
                "danmaku-confirm-password"
            ) as HTMLInputElement
        )?.value;

        // Validate all fields before submitting
        const emailInput = document.getElementById(
            "danmaku-signup-email"
        ) as HTMLInputElement;
        const usernameInput = document.getElementById(
            "danmaku-username"
        ) as HTMLInputElement;
        const passwordInput = document.getElementById(
            "danmaku-signup-password"
        ) as HTMLInputElement;
        const confirmInput = document.getElementById(
            "danmaku-confirm-password"
        ) as HTMLInputElement;

        const isEmailValid = this.validateEmail(emailInput);
        const isUsernameValid = this.validateUsername(usernameInput);
        const isPasswordValid = this.validatePassword(
            passwordInput,
            "danmaku-signup-password-error"
        );
        const isPasswordMatchValid = this.validatePasswordMatch(
            passwordInput,
            confirmInput
        );

        if (
            !isEmailValid ||
            !isUsernameValid ||
            !isPasswordValid ||
            !isPasswordMatchValid
        ) {
            this.showLoginError("Please fix the errors above");
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
            this.showLoginError(result.error || "Signup failed");
        }
    }

    private async performLogin(emailOrUsername: string, password: string) {
        const loginData: LoginRequest = {
            emailOrUsername,
            password,
            rememberMe: false,
        };

        const result = await login(loginData);

        if (result.success && result.token) {
            chrome.storage.local.set({ authToken: result.token });
            this.closeLoginModal();
            this.updateUIBasedOnAuth();
        } else {
            this.showLoginError(
                "Login after signup failed. Please try logging in manually."
            );
        }
    }

    private showLoginError(message: string) {
        const errorDiv = document.getElementById("danmaku-login-error");
        if (errorDiv) {
            errorDiv.textContent = message;
            errorDiv.style.display = "block";
        }
    }

    private hideLoginError() {
        const errorDiv = document.getElementById("danmaku-login-error");
        if (errorDiv) {
            errorDiv.style.display = "none";
        }
    }

    private closeLoginModal = () => {
        const modal = document.getElementById("danmaku-login-modal");
        if (modal) {
            modal.remove();
        }
    };

    private async updateUIBasedOnAuth() {
        const inputField = document.querySelector(
            "#danmaku-input-field"
        ) as HTMLInputElement;
        const submitButton = document.querySelector(
            ".danmaku-comment-button"
        ) as HTMLButtonElement;
        const loginPrompt = document.querySelector(
            "#danmaku-login-prompt"
        ) as HTMLElement;

        if (!inputField || !submitButton || !loginPrompt) return;

        const token = await new Promise<string | null>((resolve) => {
            chrome.storage.local.get("authToken", (result) => {
                resolve(result.authToken || null);
            });
        });

        if (token) {
            inputField.style.display = "";
            loginPrompt.style.display = "none";
            submitButton.textContent = "Submit";
            submitButton.disabled = !inputField.value.trim();
        } else {
            inputField.style.display = "none";
            loginPrompt.style.display = "flex";
            submitButton.textContent = "Login/Signup";
            submitButton.disabled = false;
        }
    }

    private async handleCommentSubmit(color: string) {
        const inputField = document.querySelector(
            "#danmaku-input-field"
        ) as HTMLInputElement;
        if (!inputField || !this.danmaku) return;

        const text = inputField.value.trim();
        if (!text) return;

        const videoId = this.getVideoId();
        const videoPlayer = await this.getVideoPlayer();
        if (!videoId || !videoPlayer) return;

        const success = await postComment(
            "youtube",
            videoId,
            videoPlayer.currentTime,
            text,
            this.getColorValue(color),
            "slide",
            "normal"
        );

        if (success) {
            this.danmaku.addDanmaku({
                id: 0, // Will be set by backend
                content: text,
                time: videoPlayer.currentTime,
                color: this.getColorValue(color),
                userId: 0, // Will be set by backend
                scrollMode: "slide",
                fontSize: "normal",
            });
            inputField.value = "";
            const submitButton = document.querySelector(
                ".danmaku-comment-button"
            ) as HTMLButtonElement;
            if (submitButton) submitButton.disabled = true;
            
            // Update comments count
            this.updateCommentsCount(this.commentsCount + 1);
        } else {
            alert("Failed to post comment. Please try logging in again.");
            this.updateUIBasedOnAuth();
        }
    }

    private waitForElement(
        selector: string,
        timeout = 10000
    ): Promise<Element | null> {
        return new Promise((resolve) => {
            const start = Date.now();
            function check() {
                const el = document.querySelector(selector);
                if (el) return resolve(el);
                if (Date.now() - start > timeout) return resolve(null);
                setTimeout(check, 200);
            }
            check();
        });
    }

    private getColorValue(color: string): string {
        const colorMap: { [key: string]: string } = {
            red: "#ff4444",
            green: "#44ff44",
            blue: "#4444ff",
            white: "#ffffff",
        };
        return colorMap[color] || "#ffffff";
    }

    destroy(): void {
        if (this.danmaku) {
            this.danmaku.stop();
            this.danmaku = null;
        }

        const danmakuContainer = document.querySelector(
            ".danmaku-input-container"
        );
        if (danmakuContainer) {
            danmakuContainer.remove();
        }

        // Remove event listeners if they were added to specific elements
        // that are not removed with the danmakuContainer
        document.removeEventListener("danmaku-open-login", () => {
            this.createLoginModal();
        });
    }
}
