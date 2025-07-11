import { postComment, Comment } from "../api";
import { Danmaku } from "./danmaku";
import { LoginModal } from "../modal-login/modal-login";
import danmakuHtml from "./danmakuInput.html?raw";

export class DanmakuInput {
    private danmaku: Danmaku;
    private loginModal: LoginModal;
    private videoId: string;

    private container: HTMLElement;
    private inputField!: HTMLInputElement;
    private commentButton!: HTMLButtonElement;
    private loginPrompt!: HTMLElement;
    private styleButton!: HTMLButtonElement;
    private styleMenu!: HTMLElement;
    private charCountContainer!: HTMLElement;
    private currentCharCount!: HTMLElement;
    private toggleButton!: HTMLButtonElement;

    private colorBoxes!: NodeListOf<HTMLElement>;
    private customColorPicker!: HTMLInputElement;
    private positionOptions!: NodeListOf<HTMLElement>;

    private selectedColor = "#ffffff";
    private selectedPosition: "slide" | "top" | "bottom" = "slide";
    private readonly MAX_CHARS = 350;

    constructor(danmaku: Danmaku, loginModal: LoginModal, videoId: string) {
        this.danmaku = danmaku;
        this.loginModal = loginModal;
        this.videoId = videoId;
        this.container = document.createElement("div");

        chrome.storage.onChanged.addListener((changes, area) => {
            if (area === "local" && changes.authToken) {
                this.updateUIBasedOnAuth();
            }
            if (area === 'local' && changes.danmakuEnabled) {
                this.updateToggleButton(changes.danmakuEnabled.newValue);
                this.updateCommentsStatus(changes.danmakuEnabled.newValue, this.danmaku.getCommentsCount);
            }
        });
    }

    public init(): HTMLElement {
        this.container.innerHTML = danmakuHtml;

        this.inputField = this.container.querySelector("#danmaku-input-field")!;
        this.commentButton = this.container.querySelector(
            ".danmaku-comment-button"
        )!;
        this.loginPrompt = this.container.querySelector(
            "#danmaku-login-prompt"
        )!;
        this.styleButton = this.container.querySelector(
            ".danmaku-style-button"
        )!;
        this.styleMenu = this.container.querySelector(".danmaku-style-menu")!;
        this.charCountContainer = this.container.querySelector(
            "#danmaku-char-count"
        )!;
        this.currentCharCount = this.container.querySelector(
            "#current-char-count"
        )!;
        this.toggleButton = this.container.querySelector(".danmaku-toggle-button")!;
        this.colorBoxes = this.styleMenu.querySelectorAll(
            ".color-box:not(#custom-color-picker)"
        );
        this.customColorPicker = this.styleMenu.querySelector(
            "#custom-color-picker"
        )!;
        this.positionOptions =
            this.styleMenu.querySelectorAll(".position-option");

        this.setupEventListeners();
        this.updateUIBasedOnAuth();
        this.updateSelectedColorUI(this.selectedColor);
        this.updateSelectedPositionUI(this.selectedPosition);

        chrome.storage.local.get("danmakuEnabled", ({ danmakuEnabled }) => {
            const isEnabled = danmakuEnabled !== false;
            this.updateToggleButton(isEnabled);
            this.danmaku.toggleVisibility(isEnabled);
            this.updateCommentsStatus(isEnabled, this.danmaku.getCommentsCount);
        });

        return this.container;
    }

    public get containerDiv(): HTMLElement {
        return this.container;
    }

    public updateCommentsCount(count: number): void {
        const commentsLoadedEl = this.container.querySelector<HTMLElement>(
            "#danmaku-comments-loaded"
        );

        if (commentsLoadedEl) {
            commentsLoadedEl.textContent = `${count} comment${
                count === 1 ? "" : "s"
            } loaded`;
        } else {
            console.error(
                "DanmakuInput: Could not find #danmaku-comments-loaded element to update."
            );
        }
    }

    public updateCommentsStatus(isEnabled: boolean, commentsCount: number = 0): void {
        const commentsLoadedEl = this.container.querySelector<HTMLElement>(
            "#danmaku-comments-loaded"
        );

        if (commentsLoadedEl) {
            if (isEnabled) {
                if (commentsCount > 0) {
                    commentsLoadedEl.textContent = `${commentsCount} comment${
                        commentsCount === 1 ? "" : "s"
                    } loaded`;
                } else {
                    commentsLoadedEl.textContent = "Loading comments...";
                }
            } else {
                commentsLoadedEl.textContent = "Comments disabled";
            }
        } else {
            console.error(
                "DanmakuInput: Could not find #danmaku-comments-loaded element to update."
            );
        }
    }

    public updateVideoId(newVideoId: string): void {
        this.videoId = newVideoId;
    }

    private setupEventListeners() {
        this.commentButton.addEventListener("click", () =>
            this.handleCommentButtonClick()
        );
        this.loginPrompt.addEventListener("click", () => this.openLoginPage());
        this.inputField.addEventListener("input", () => this.handleInput());
        this.inputField.addEventListener("keydown", (e) => {
            if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                this.handleCommentButtonClick();
            }
        });

        this.styleButton.addEventListener("click", (e) => {
            e.stopPropagation();
            this.styleMenu.classList.toggle("open");
            this.styleButton.classList.toggle("open");
        });

        this.toggleButton.addEventListener("click", () => {
            const isEnabled = this.danmaku.toggleVisibility();
            chrome.storage.local.set({ danmakuEnabled: isEnabled });
            this.updateCommentsStatus(isEnabled, this.danmaku.getCommentsCount);
        });

        document.addEventListener("click", (e) => {
            if (
                !this.styleMenu.contains(e.target as Node) &&
                e.target !== this.styleButton
            ) {
                this.styleMenu.classList.remove("open");
                this.styleButton.classList.remove("open");
            }
        });

        this.styleMenu.addEventListener("click", (e) => e.stopPropagation());

        this.colorBoxes.forEach((box) => {
            box.addEventListener("click", () => {
                this.selectedColor = box.dataset.color || "#ffffff";
                this.updateSelectedColorUI(this.selectedColor);
            });
        });

        this.customColorPicker.addEventListener("click", () => {
            this.selectedColor = this.customColorPicker.value;
            this.updateSelectedColorUI(this.customColorPicker.value);
        });

        this.customColorPicker.addEventListener("input", () => {
            this.selectedColor = this.customColorPicker.value;
            this.updateSelectedColorUI(this.customColorPicker.value);
        });

        this.positionOptions.forEach((option) => {
            option.addEventListener("click", () => {
                const position = option.dataset.position as
                    | "slide"
                    | "top"
                    | "bottom";
                this.selectedPosition = position;
                this.updateSelectedPositionUI(position);
            });
        });
    }

    private updateToggleButton(isEnabled: boolean) {
        const enabledIcon = this.toggleButton.querySelector(".toggle-enabled");
        const disabledIcon = this.toggleButton.querySelector(".toggle-disabled");
        if (isEnabled) {
            enabledIcon?.setAttribute("style", "display: block");
            disabledIcon?.setAttribute("style", "display: none");
        } else {
            enabledIcon?.setAttribute("style", "display: none");
            disabledIcon?.setAttribute("style", "display: block");
        }
    }

    private updateSelectedColorUI(color: string) {
        this.colorBoxes.forEach((box) =>
            box.classList.remove("selected-color")
        );
        this.customColorPicker.classList.remove("selected-color");

        const selectedBox = Array.from(this.colorBoxes).find(
            (box) => box.dataset.color === color
        );

        if (selectedBox) {
            selectedBox.classList.add("selected-color");
        } else {
            this.customColorPicker.classList.add("selected-color");
            this.customColorPicker.value = color;
        }
    }

    private updateSelectedPositionUI(position: "slide" | "top" | "bottom") {
        this.positionOptions.forEach((option) =>
            option.classList.remove("selected-position")
        );
        const selectedOption = Array.from(this.positionOptions).find(
            (option) => option.dataset.position === position
        );
        if (selectedOption) {
            selectedOption.classList.add("selected-position");
        }
    }

    private handleInput() {
        const charCount = this.inputField.value.length;
        this.charCountContainer.style.display =
            document.activeElement === this.inputField || charCount > 0
                ? "block"
                : "none";

        if (this.currentCharCount) {
            this.currentCharCount.textContent = charCount.toString();
        }

        if (this.charCountContainer) {
            const maxCountText = `/${this.MAX_CHARS}`;
            if (!this.charCountContainer.textContent?.includes(maxCountText)) {
                this.charCountContainer.appendChild(
                    document.createTextNode(maxCountText)
                );
            }
        }

        if (charCount > this.MAX_CHARS) {
            this.inputField.classList.add("error");
            this.commentButton.disabled = true;
            this.currentCharCount.style.color = "red";
        } else {
            this.inputField.classList.remove("error");
            this.updateUIBasedOnAuth();
            this.currentCharCount.style.color = "";
        }
    }

    private handleCommentButtonClick() {
        this.submitComment();
    }

    private async submitComment() {
        const content = this.inputField.value.trim();
        if (!content) return;

        const currentTime = this.danmaku.getCurrentTime;
        const success = await postComment(
            "youtube",
            this.videoId,
            currentTime,
            content,
            this.selectedColor,
            this.selectedPosition,
            "normal"
        );

        if (success) {
            const localComment: Comment = {
                id: Date.now(),
                content: content,
                time: currentTime,
                color: this.selectedColor,
                userId: 0,
                scrollMode: this.selectedPosition,
                fontSize: "normal",
            };
            this.danmaku.addComment(localComment);
            this.updateCommentsCount(this.danmaku.getCommentsCount);
            this.inputField.value = "";
            this.handleInput();
        } else {
            alert("Failed to post comment. You might need to log in again.");
            this.updateUIBasedOnAuth();
        }
    }

    private openLoginPage() {
        this.loginModal.show();
    }

    private async updateUIBasedOnAuth() {
        const token = await new Promise<string | null>((resolve) => {
            chrome.storage.local.get("authToken", (result) => {
                resolve(result.authToken || null);
            });
        });

        const isLoggedIn = !!token;
        this.inputField.style.visibility = isLoggedIn ? "visible" : "hidden";
        this.loginPrompt.style.display = isLoggedIn ? "none" : "flex";

        this.inputField.disabled = !isLoggedIn;
        this.commentButton.disabled =
            !isLoggedIn || this.inputField.value.length > this.MAX_CHARS;
    }
}