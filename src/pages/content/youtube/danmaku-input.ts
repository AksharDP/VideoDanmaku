import { postComment, Comment } from "../api";
import { Danmaku } from "../danmaku/danmaku";

export class DanmakuInput {
    private _commentsCount: number = 0;
    private commentsCountListeners: Array<(count: number) => void> = [];
    private container: HTMLElement;
    private inputField: HTMLInputElement;
    private commentButton: HTMLButtonElement;
    private loginPrompt: HTMLElement;
    private styleButton: HTMLButtonElement;
    private styleMenu: HTMLElement;
    private charCountContainer: HTMLElement;
    private currentCharCount: HTMLElement;

    // New elements for style menu
    private colorBoxes: NodeListOf<HTMLElement>;
    private hexColorPreview: HTMLElement;
    private nativeColorPicker: HTMLInputElement; // Added for native color picker
    private positionOptions: NodeListOf<HTMLElement>;

    private videoPlayer: HTMLVideoElement;
    private danmaku: Danmaku; // Will be set to Danmaku instance if provided
    private selectedColor = "#ffffff"; // Default color
    private selectedPosition: "slide" | "top" | "bottom" = "slide"; // Default position
    private readonly MAX_CHARS = 350;

    /**
     * Optionally pass the Danmaku instance for local comment injection.
     */
    constructor(container: HTMLElement, videoPlayer: HTMLVideoElement, danmakuInstance: Danmaku) {
        // Try to initialize comments count from the element if present
        const commentsCountElement = document.getElementById("danmaku-comments-loaded");
        if (commentsCountElement) {
            const match = commentsCountElement.textContent?.match(/(\d+)/);
            if (match) {
                this._commentsCount = parseInt(match[1], 10);
            }
        }
        // Set up a listener to update the element whenever the count changes
        this.addCommentsCountListener((count) => {
            const el = document.getElementById("danmaku-comments-loaded");
            if (el) {
                el.textContent = `${count} comment${count === 1 ? '' : 's'} loaded`;
            }
        });

        this.container = container;
        this.videoPlayer = videoPlayer;
        this.danmaku = danmakuInstance;

        this.inputField = this.container.querySelector("#danmaku-input-field")!;
        this.commentButton = this.container.querySelector(".danmaku-comment-button")!;
        this.loginPrompt = this.container.querySelector("#danmaku-login-prompt")!;
        this.styleButton = this.container.querySelector(".danmaku-style-button")!;
        this.styleMenu = this.container.querySelector(".danmaku-style-menu")!;
        this.charCountContainer = this.container.querySelector("#danmaku-char-count")!;
        this.currentCharCount = this.container.querySelector("#current-char-count")!;

        // Initialize new elements
        this.colorBoxes = this.styleMenu.querySelectorAll(".color-box");
        this.hexColorInput = this.styleMenu.querySelector("#hex-color-input")!;
        this.positionOptions = this.styleMenu.querySelectorAll(".position-option");

        this.setupEventListeners();
        this.updateUIBasedOnAuth();

        // Set initial selected color and position
        this.updateSelectedColorUI(this.selectedColor);
        this.updateSelectedPositionUI(this.selectedPosition);

        chrome.storage.onChanged.addListener((changes, area) => {
            if (area === "local" && changes.authToken) {
                this.updateUIBasedOnAuth();
            }
        });
    }

    /**
     * Get the current comments count
     */
    public get commentsCount() {
        return this._commentsCount;
    }

    /**
     * Set the comments count and notify listeners
     */
    public set commentsCount(val: number) {
        this._commentsCount = val;
        this.commentsCountListeners.forEach(fn => fn(val));
    }

    /**
     * Add a listener for comments count changes
     */
    public addCommentsCountListener(fn: (count: number) => void) {
        this.commentsCountListeners.push(fn);
    }

    private setupEventListeners() {
        this.commentButton.addEventListener("click", () => this.handleCommentButtonClick());
        this.loginPrompt.addEventListener("click", () => this.openLoginPage());
        this.inputField.addEventListener("input", () => this.handleInput());

        this.styleButton.addEventListener("click", (e) => {
            e.stopPropagation();
            this.styleMenu.classList.toggle("open");
            this.styleButton.classList.toggle("open");
        });

        document.addEventListener("click", (e) => {
            if (!this.styleMenu.contains(e.target as Node) && e.target !== this.styleButton) {
                this.styleMenu.classList.remove("open");
                this.styleButton.classList.remove("open");
            }
        });

        // Prevent clicks inside the style menu from closing it
        this.styleMenu.addEventListener("click", (e) => {
            e.stopPropagation();
        });

        // Color selection
        this.colorBoxes.forEach(box => {
            box.addEventListener("click", () => {
                this.selectedColor = box.dataset.color || "#ffffff";
                this.updateSelectedColorUI(this.selectedColor);
                this.hexColorInput.value = this.selectedColor;
            });
        });

        this.hexColorInput.addEventListener("input", () => {
            const hex = this.hexColorInput.value;
            if (/^#[0-9A-Fa-f]{3}([0-9A-Fa-f]{3})?$/.test(hex)) {
                this.selectedColor = hex;
                this.hexColorPreview.style.backgroundColor = hex;
                this.nativeColorPicker.value = hex;
                this.updateSelectedColorUI(hex);
            } else {
                this.hexColorPreview.style.backgroundColor = "#ffffff"; // Reset preview on invalid input
            }
        });

        // Trigger native color picker on preview click
        this.hexColorPreview.addEventListener("click", () => {
            this.nativeColorPicker.click();
        });

        // Update selected color when native color picker changes
        this.nativeColorPicker.addEventListener("input", () => {
            const hex = this.nativeColorPicker.value;
            this.selectedColor = hex;
            this.hexColorInput.value = hex;
            this.hexColorPreview.style.backgroundColor = hex;
            this.updateSelectedColorUI(hex);
        });

        // Position selection
        this.positionOptions.forEach(option => {
            option.addEventListener("click", () => {
                const position = option.dataset.position as "slide" | "top" | "bottom";
                this.selectedPosition = position;
                this.updateSelectedPositionUI(position);
            });
        });
    }

    private updateSelectedColorUI(color: string) {
        this.colorBoxes.forEach(box => box.classList.remove('selected-color'));
        const selectedBox = Array.from(this.colorBoxes).find(box => box.dataset.color === color);
        if (selectedBox) {
            selectedBox.classList.add('selected-color');
        }
        this.hexColorPreview.style.backgroundColor = color;
    }

    private updateSelectedPositionUI(position: "slide" | "top" | "bottom") {
        this.positionOptions.forEach(option => option.classList.remove('selected-position'));
        const selectedOption = Array.from(this.positionOptions).find(option => option.dataset.position === position);
        if (selectedOption) {
            selectedOption.classList.add('selected-position');
        }
    }

    private handleInput() {
        const charCount = this.inputField.value.length;
        if (document.activeElement === this.inputField || charCount > 0) {
            this.charCountContainer.style.display = "block";
        } else {
            this.charCountContainer.style.display = "none";
        }

        if (this.currentCharCount) {
            this.currentCharCount.textContent = charCount.toString();
        }
        if (this.charCountContainer) {
            const maxCountText = `/${this.MAX_CHARS}`;
            Array.from(this.charCountContainer.childNodes).forEach((node) => {
                if (node.nodeType === Node.TEXT_NODE) {
                    this.charCountContainer.removeChild(node);
                }
            });
            this.charCountContainer.appendChild(document.createTextNode(maxCountText));
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
        if (this.commentButton.textContent === "Login/Signup") {
            this.openLoginPage();
        } else {
            this.submitComment();
        }
    }

    private async submitComment() {
        const text = this.inputField.value.trim();
        if (!text) return;

        const platform = "youtube";
        const videoId = new URLSearchParams(window.location.search).get("v") || "unknown";
        const time = this.videoPlayer.currentTime;

        const success = await postComment(platform, videoId, time, text, this.selectedColor, this.selectedPosition, "normal");

        if (success) {
            const localComment: Comment = {
                id: 0,
                content: text,
                time: time,
                color: this.selectedColor,
                userId: 0,
                scrollMode: this.selectedPosition,
                fontSize: "normal",
            };
            if (this.danmaku) {
                this.danmaku.addCommentToList(localComment);
            }
            this.commentsCount = this.commentsCount + 1;
            this.inputField.value = "";
            this.handleInput();
        } else {
            alert("Failed to post comment. You might need to log in again.");
            this.updateUIBasedOnAuth();
        }
    }

    private openLoginPage() {
        const event = new CustomEvent('danmaku-open-login');
        document.dispatchEvent(event);
    }

    private async updateUIBasedOnAuth() {
        const token = await new Promise<string | null>((resolve) => {
            chrome.storage.local.get("authToken", (result) => {
                resolve(result.authToken || null);
            });
        });

        if (token) {
            this.inputField.disabled = false;
            this.commentButton.disabled = false;
            this.commentButton.textContent = "Comment";
            this.loginPrompt.style.display = "none";
        } else {
            this.inputField.disabled = true;
            this.commentButton.disabled = true;
            this.commentButton.textContent = "Comment";
            this.loginPrompt.style.display = "flex";
        }
    }
}