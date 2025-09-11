import { postComment, Comment, PostCommentResponse } from "../api";
import { Danmaku } from "./danmaku";
import { LoginModal } from "../modal-login/modal-login";
import danmakuHtml from "./danmakuInput.html?raw";
import { DensityMode, FontSize, ScrollMode } from "../interfaces/enum";

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
        this.updateDensityUI(this.selectedDensity);

        // Initialize slider positions
        this.speedValue.value = this.speedPercent.toString();
        this.opacityValue.value = this.opacityPercent.toString();
        this.fontSizeValue.value = this.fontSizePercent.toString();

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
            this.commentsLoadedElement.textContent = `${count} comment${
                count === 1 ? "" : "s"
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
                    this.commentsLoadedElement.textContent = `${commentsCount} comment${
                        commentsCount === 1 ? "" : "s"
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
            this.clearError();
            if (event.key === "Enter") {
                event.preventDefault();
                if (this.inputField.value.trim()) {
                    this.submitComment();
                }
            }
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
                const position = option.dataset.position;
                let scrollMode: ScrollMode;
                switch (position) {
                    case "slide":
                        scrollMode = ScrollMode.SLIDE;
                        break;
                    case "top":
                        scrollMode = ScrollMode.TOP;
                        break;
                    case "bottom":
                        scrollMode = ScrollMode.BOTTOM;
                        break;
                    default:
                        scrollMode = ScrollMode.SLIDE;
                }
                this.selectedPosition = scrollMode;
                this.updateSelectedPositionUI(scrollMode);
            });
        });

        this.densityOptions.forEach((option) => {
            option.addEventListener("click", () => {
                const densityValue = option.dataset.density;
                let density: DensityMode;
                switch (densityValue) {
                    case "sparse":
                        density = DensityMode.SPARSE;
                        break;
                    case "normal":
                        density = DensityMode.NORMAL;
                        break;
                    case "dense":
                        density = DensityMode.DENSE;
                        break;
                    default:
                        density = DensityMode.NORMAL;
                }
                this.selectedDensity = density;
                this.updateDensityUI(density);
            });
        });

        this.speedSlider.addEventListener("input", () => {
            this.speedPercent = parseInt(this.speedSlider.value, 10);
            this.speedValue.value = this.speedPercent.toString();
            this.danmaku.setSpeed(this.speedPercent);
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
        });

        this.opacitySlider.addEventListener("input", () => {
            this.opacityPercent = parseInt(this.opacitySlider.value, 10);
            this.opacityValue.value = this.opacityPercent.toString();
            this.danmaku.setOpacity(this.opacityPercent);
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
        });

        this.fontSizeSlider.addEventListener("input", () => {
            this.fontSizePercent = parseInt(this.fontSizeSlider.value, 10);
            this.fontSizeValue.value = this.fontSizePercent.toString();
            this.danmaku.setFontSize(this.fontSizePercent);
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

    private updateSelectedPositionUI(position: ScrollMode) {
        this.positionOptions.forEach((option) =>
            option.classList.remove("selected-position")
        );

        // Convert enum value to string for comparison with HTML dataset
        let positionString: string;
        switch (position) {
            case ScrollMode.SLIDE:
                positionString = "slide";
                break;
            case ScrollMode.TOP:
                positionString = "top";
                break;
            case ScrollMode.BOTTOM:
                positionString = "bottom";
                break;
            default:
                positionString = "slide";
        }

        const selectedOption = Array.from(this.positionOptions).find(
            (option) => option.dataset.position === positionString
        );
        if (selectedOption) {
            selectedOption.classList.add("selected-position");
        }
    }

    private updateDensityUI(density: DensityMode) {
        // Update UI selection - convert enum value to string for comparison with dataset
        this.densityOptions.forEach((option) => {
            let densityString: string;
            switch (density) {
                case DensityMode.SPARSE:
                    densityString = "sparse";
                    break;
                case DensityMode.NORMAL:
                    densityString = "normal";
                    break;
                case DensityMode.DENSE:
                    densityString = "dense";
                    break;
                default:
                    densityString = "normal";
            }
            option.classList.toggle("selected-density", option.dataset.density === densityString);
        });

        // Apply density setting to danmaku
        this.danmaku.setDensity(density);
    }

    private updateSliderPosition(slider: HTMLInputElement, valueElement: HTMLElement) {
        const min = parseInt(slider.min, 10);
        const max = parseInt(slider.max, 10);
        const value = parseInt(slider.value, 10);

        // Calculate the percentage position of the slider value
        const percentage = ((value - min) / (max - min)) * 100;

        // Position the value element at the calculated percentage
        valueElement.style.left = `${percentage}%`;
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

    // private handleCommentButtonClick() {
    //     this.submitComment();
    // }

    private async submitComment() {
        const content = this.inputField.value.trim();
        if (!content) return;

        const videoId = this.videoId;
        if (!videoId) {
            this.showError("Video ID not found.");
            return;
        }
        const currentTime = this.danmaku.videoPlayer.currentTime * 1000;
        if (currentTime < 0) {
            this.showError("Video is not playing.");
            return;
        }
        // validate if selectedColor is valid hex color using regex
        const hexColorRegex = /^#([0-9A-Fa-f]{6}|[0-9A-Fa-f]{3})$/;
        if (!hexColorRegex.test(this.selectedColor)) {
            this.showError("Invalid color selected.");
            return;
        }
        // validate if selectedPosition is valid ScrollMode
        if (
            !Object.values(ScrollMode).includes(this.selectedPosition)
        ) {
            this.showError("Invalid position selected.");
            return;
        }
        // validate if fontSize is valid FontSize

        // if (!this.selectedColor)
        const response: PostCommentResponse = await postComment(
            "youtube",
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
                userId: 0,
                scrollMode: this.selectedPosition,
                fontSize: FontSize.NORMAL,
            };
            this.danmaku.addComment(localComment);
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
        this.errorMessageElement.textContent = `Error ${status ? `${status} `: ''}: ${message}`;
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
}