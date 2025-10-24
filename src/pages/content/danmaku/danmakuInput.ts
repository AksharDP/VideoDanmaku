import { postComment, Comment, PostCommentResponse } from "../api";
import { Danmaku } from "./danmaku";
import { LoginModal } from "../modal-login/modal-login";
import danmakuHtml from "./danmakuInput.html?raw";
import { DensityMap, DensityMode, FontSize, ScrollMode } from "../interfaces/enum";
import { SiteAdapter } from "../interfaces/SiteAdapter";

export class DanmakuInput {
    private siteAdapter: SiteAdapter;
    private danmaku: Danmaku;
    private loginModal: LoginModal;
    private videoId: string;

    private container: HTMLElement;
    private inputField!: HTMLInputElement;
    private commentButton!: HTMLButtonElement;
    private loginPrompt!: HTMLElement;
    private styleButton!: HTMLButtonElement;
    private styleMenu!: HTMLElement;
    private settingsButton!: HTMLButtonElement;
    private settingsMenu!: HTMLElement;
    private charCountContainer!: HTMLElement;
    private currentCharCount!: HTMLElement;
    private toggleButton!: HTMLButtonElement;
    private commentsLoadedElement!: HTMLElement;
    private errorMessageElement!: HTMLParagraphElement;

    private colorBoxes!: NodeListOf<HTMLElement>;
    private customColorPicker!: HTMLInputElement;
    private positionOptions!: NodeListOf<HTMLElement>;

    // Settings controls
    private densityOptions!: NodeListOf<HTMLElement>;
    private speedSlider!: HTMLInputElement;
    private speedValue!: HTMLInputElement;
    private opacitySlider!: HTMLInputElement;
    private opacityValue!: HTMLInputElement;
    private fontSizeSlider!: HTMLInputElement;
    private fontSizeValue!: HTMLInputElement;

    private selectedColor = "#ffffff";
    private selectedPosition: ScrollMode = ScrollMode.SLIDE;

    private selectedDensity: DensityMode = DensityMode.NORMAL;
    private speedPercent = 100;
    private opacityPercent = 100;
    private fontSizePercent = 100;
    private readonly MAX_CHARS = 350;

    constructor(siteAdapter: SiteAdapter, danmaku: Danmaku, loginModal: LoginModal, videoId: string) {
        this.siteAdapter = siteAdapter;
        this.danmaku = danmaku;
        this.loginModal = loginModal;
        this.videoId = videoId;
        this.container = (() => {
            const template = document.createElement('template');
            template.innerHTML = danmakuHtml.trim();
            return template.content.firstElementChild as HTMLElement;
        })();

        // FIX: Check if chrome and chrome.storage are available before accessing
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.onChanged) {
            try {
                chrome.storage.onChanged.addListener((changes, area) => {
                    if (area === "local" && changes.authToken) {
                        this.updateUIBasedOnAuth();
                    }
                    if (area === "local" && changes.danmakuEnabled) {
                        this.updateToggleButton(changes.danmakuEnabled.newValue);
                        this.updateCommentsStatus(changes.danmakuEnabled.newValue, this.danmaku.getCommentsCount);
                    }
                });
            } catch (error) {
                console.warn("[DanmakuInput] Could not set up storage listener:", error);
            }
        } else {
            console.warn("[DanmakuInput] Chrome storage API not available");
        }
    }

    public init(): HTMLElement {
        // this.container.innerHTML = danmakuHtml;

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
        this.settingsButton = this.container.querySelector(
            ".danmaku-settings-button"
        )!;
        this.settingsMenu = this.container.querySelector(".danmaku-settings-menu")!;
        this.charCountContainer = this.container.querySelector(
            "#danmaku-char-count"
        )!;
        this.currentCharCount = this.container.querySelector(
            "#current-char-count"
        )!;
        this.toggleButton = this.container.querySelector(".danmaku-toggle-button")!;
        this.commentsLoadedElement = this.container.querySelector(
            "#danmaku-comments-loaded"
        )!;
        this.colorBoxes = this.styleMenu.querySelectorAll(
            ".color-box:not(#custom-color-picker)"
        );
        this.customColorPicker = this.styleMenu.querySelector(
            "#custom-color-picker"
        )!;
        this.positionOptions =
            this.styleMenu.querySelectorAll(".position-option");

        this.errorMessageElement = this.container.querySelector("#danmaku-error-message")!;

        // Settings elements
        this.densityOptions = this.settingsMenu.querySelectorAll(
            ".density-option"
        );
        this.speedSlider = this.settingsMenu.querySelector(
            "#danmaku-speed-slider"
        )!;
        this.speedValue = this.settingsMenu.querySelector(
            "#danmaku-speed-value"
        )!;
        this.opacitySlider = this.settingsMenu.querySelector(
            "#danmaku-opacity-slider"
        )!;
        this.opacityValue = this.settingsMenu.querySelector(
            "#danmaku-opacity-value"
        )!;
        this.fontSizeSlider = this.settingsMenu.querySelector(
            "#danmaku-fontsize-slider"
        )!;
        this.fontSizeValue = this.settingsMenu.querySelector(
            "#danmaku-fontsize-value"
        )!;

        this.setupEventListeners();
        this.updateUIBasedOnAuth();
        this.updateSelectedColorUI(this.selectedColor);
        this.updateSelectedPositionUI(this.selectedPosition);

        this.loadSettings();

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
        if (this.commentsLoadedElement) {
            this.commentsLoadedElement.textContent = `${count} comment${count === 1 ? "" : "s"
                } loaded`;
        } else {
            console.error(
                "DanmakuInput: Could not find #danmaku-comments-loaded element to update."
            );
        }
    }

    public updateCommentsStatus(isEnabled: boolean, commentsCount: number = 0): void {
        if (this.commentsLoadedElement) {
            if (isEnabled) {
                if (commentsCount > 0) {
                    this.commentsLoadedElement.textContent = `${commentsCount} comment${commentsCount === 1 ? "" : "s"
                        } loaded`;
                } else {
                    this.commentsLoadedElement.textContent = "Loading comments...";
                }
            } else {
                this.commentsLoadedElement.textContent = "Comments disabled";
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
            this.submitComment()
        );
        this.loginPrompt.addEventListener("click", () => this.openLoginPage());
        this.inputField.addEventListener("input", () => this.handleInput());
        this.inputField.addEventListener("keydown", (event) => {
            // Stop propagation to prevent video player from capturing keystrokes
            event.stopPropagation();
            this.clearError();
            if (event.key === "Enter") {
                event.preventDefault();
                if (this.inputField.value.trim()) {
                    this.submitComment();
                }
            }
        });

        // Prevent keystrokes on the entire container from reaching the video player
        this.container.addEventListener("keydown", (event) => {
            event.stopPropagation();
        });
        this.container.addEventListener("keyup", (event) => {
            event.stopPropagation();
        });
        this.container.addEventListener("keypress", (event) => {
            event.stopPropagation();
        })

        this.styleButton.addEventListener("click", (e) => {
            e.stopPropagation();
            // Close settings menu if open
            this.settingsMenu.classList.remove("open");
            this.settingsButton.classList.remove("open");
            // Toggle style menu
            this.styleMenu.classList.toggle("open");
            this.styleButton.classList.toggle("open");
        });

        this.settingsButton.addEventListener("click", (e) => {
            e.stopPropagation();
            // Close style menu if open
            this.styleMenu.classList.remove("open");
            this.styleButton.classList.remove("open");
            // Toggle settings menu
            this.settingsMenu.classList.toggle("open");
            this.settingsButton.classList.toggle("open");
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
            if (
                !this.settingsMenu.contains(e.target as Node) &&
                e.target !== this.settingsButton
            ) {
                this.settingsMenu.classList.remove("open");
                this.settingsButton.classList.remove("open");
            }
        });

        this.styleMenu.addEventListener("click", (e) => e.stopPropagation());
        this.settingsMenu.addEventListener("click", (e) => e.stopPropagation());

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
                let scrollMode: ScrollMode = option.dataset.position as ScrollMode;
                if (!scrollMode || !Object.values(ScrollMode).includes(scrollMode)) {
                    console.error("DanmakuInput: Invalid position option selected:", scrollMode);
                    scrollMode = ScrollMode.SLIDE;
                }
                this.selectedPosition = scrollMode;
                this.updateSelectedPositionUI(scrollMode);
            });
        });

        this.densityOptions.forEach((option) => {
            option.addEventListener("click", () => {
                let density = option.dataset.density as DensityMode;
                if (!density || !Object.values(DensityMode).includes(density)) {
                    console.error("DanmakuInput: Invalid density option selected:", density);
                    density = DensityMode.NORMAL;
                }
                this.selectedDensity = density;
                this.updateSelectedDensityUI(density);
                this.danmaku.setDensity(density);
                this.saveSettings();
            });
        });

        this.speedSlider.addEventListener("input", () => {
            this.speedPercent = parseInt(this.speedSlider.value, 10);
            this.speedValue.value = this.speedPercent.toString();
            this.danmaku.setSpeed(this.speedPercent);
            this.saveSettings();
        });

        this.speedValue.addEventListener("change", () => {
            let value = parseInt(this.speedValue.value, 10);
            if (isNaN(value)) value = 100;
            if (value < 0) value = 0;
            if (value > 200) value = 200;
            this.speedPercent = value;
            this.speedValue.value = value.toString();
            this.speedSlider.value = value.toString();
            this.danmaku.setSpeed(this.speedPercent);
            this.saveSettings();
        });

        this.opacitySlider.addEventListener("input", () => {
            this.opacityPercent = parseInt(this.opacitySlider.value, 10);
            this.opacityValue.value = this.opacityPercent.toString();
            this.danmaku.setOpacity(this.opacityPercent);
            this.saveSettings();
        });

        this.opacityValue.addEventListener("change", () => {
            let value = parseInt(this.opacityValue.value, 10);
            if (isNaN(value)) value = 100;
            if (value < 0) value = 0;
            if (value > 100) value = 100;
            this.opacityPercent = value;
            this.opacityValue.value = value.toString();
            this.opacitySlider.value = value.toString();
            this.danmaku.setOpacity(this.opacityPercent);
            this.saveSettings();
        });

        this.fontSizeSlider.addEventListener("input", () => {
            this.fontSizePercent = parseInt(this.fontSizeSlider.value, 10);
            this.fontSizeValue.value = this.fontSizePercent.toString();
            this.danmaku.setFontSize(this.fontSizePercent);
            this.saveSettings();
        });

        this.fontSizeValue.addEventListener("change", () => {
            let value = parseInt(this.fontSizeValue.value, 10);
            if (isNaN(value)) value = 100;
            if (value < 0) value = 0;
            if (value > 200) value = 200;
            this.fontSizePercent = value;
            this.fontSizeValue.value = value.toString();
            this.fontSizeSlider.value = value.toString();
            this.danmaku.setFontSize(this.fontSizePercent);
            this.saveSettings();
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
        // Remove selection from all color boxes and custom picker
        this.colorBoxes.forEach(box => box.classList.remove("selected-color"));
        this.customColorPicker.classList.remove("selected-color");

        // Try to find a color box matching the color
        const selectedBox = Array.from(this.colorBoxes).find(
            box => box.dataset.color?.toLowerCase() === color.toLowerCase()
        );

        if (selectedBox) {
            selectedBox.classList.add("selected-color");
        } else {
            this.customColorPicker.classList.add("selected-color");
            if (this.customColorPicker.value.toLowerCase() !== color.toLowerCase()) {
                this.customColorPicker.value = color;
            }
        }
    }

    private updateSelectedPositionUI(position: ScrollMode) {
        this.positionOptions.forEach(option =>
            option.classList.toggle(
                "selected-position",
                option.dataset.position === position
            )
        );
    }

    private updateSelectedDensityUI(density: DensityMode) {
        this.densityOptions.forEach(option =>
            option.classList.toggle(
                "selected-density",
                option.dataset.density === density
            )
        );
    }

    private handleInput() {
        if (!this.inputField || !this.currentCharCount || !this.charCountContainer) {
            console.error("DanmakuInput: Required elements not found.");
            this.showError("Input field or character count elements not found.");
            return;
        }
        this.clearError();

        const charCount = this.inputField.value.length;
        this.charCountContainer.style.display =
            document.activeElement === this.inputField || charCount > 0
                ? "flex"
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

    private async submitComment() {
        const content = this.inputField.value.trim();
        if (!content) return;

        const videoId = this.videoId;
        if (!videoId) {
            this.showError("Video ID not found.");
            return;
        }
        const currentTime = await this.siteAdapter.getCurrentTime();
        if (currentTime < 0) {
            this.showError("Video is not playing.");
            return;
        }

        const hexColorRegex = /^#([0-9A-Fa-f]{6}|[0-9A-Fa-f]{3})$/;
        if (!hexColorRegex.test(this.selectedColor)) {
            this.showError("Invalid color selected.");
            return;
        }

        if (!Object.values(ScrollMode).includes(this.selectedPosition)) {
            this.showError("Invalid position selected.");
            return;
        }

        const response: PostCommentResponse = await postComment(
            // "youtube",
            this.siteAdapter.domain,
            this.videoId,
            currentTime,
            content,
            this.selectedColor,
            this.selectedPosition,
            FontSize.NORMAL
        );

        if (response.success) {
            const localComment: Comment = {
                id: Date.now(),
                content: content,
                time: currentTime,
                color: this.selectedColor,
                userId: 0, // Placeholder for local comments
                scrollMode: this.selectedPosition,
                fontSize: FontSize.NORMAL,
            };
            this.danmaku.addComment(localComment); // UPDATED METHOD
            this.updateCommentsCount(this.danmaku.getCommentsCount);
            this.inputField.value = "";
            this.handleInput();
        } else {
            this.showError(response.error, response.status);
            await this.updateUIBasedOnAuth();
        }
    }

    private openLoginPage() {
        this.loginModal.show();
    }

    private showError(message: string = "An unexpected error occurred.", status?: number) {
        this.errorMessageElement.textContent = `Error ${status ? `${status} ` : ''}: ${message}`;
        this.errorMessageElement.style.display = "block";
    }

    private clearError() {
        this.errorMessageElement.textContent = "";
        this.errorMessageElement.style.display = "none";
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

    private saveSettings() {
        const settings = {
            density: this.selectedDensity,
            speed: this.speedPercent,
            opacity: this.opacityPercent,
            fontSize: this.fontSizePercent,
        };
        chrome.storage.local.set({ danmakuSettings: settings });
    }

    private loadSettings() {
        chrome.storage.local.get("danmakuSettings", (result) => {
            const settings = result.danmakuSettings;
            if (settings) {
                this.speedPercent = settings.speed ?? 100;
                this.opacityPercent = settings.opacity ?? 100;
                this.fontSizePercent = settings.fontSize ?? 100;
                this.selectedDensity = settings.density ?? DensityMode.NORMAL;
            }

            this.updateSelectedDensityUI(this.selectedDensity);
            this.danmaku.setDensity(this.selectedDensity);

            this.speedSlider.value = this.speedPercent.toString();
            this.speedValue.value = this.speedPercent.toString();
            this.danmaku.setSpeed(this.speedPercent);

            this.opacitySlider.value = this.opacityPercent.toString();
            this.opacityValue.value = this.opacityPercent.toString();
            this.danmaku.setOpacity(this.opacityPercent);

            this.fontSizeSlider.value = this.fontSizePercent.toString();
            this.fontSizeValue.value = this.fontSizePercent.toString();
            this.danmaku.setFontSize(this.fontSizePercent);
        });
    }
}
