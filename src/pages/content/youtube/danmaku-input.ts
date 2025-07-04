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

    private colorBoxes: NodeListOf<HTMLElement>;
    private customColorPicker: HTMLInputElement;
    private positionOptions: NodeListOf<HTMLElement>;

    private videoPlayer: HTMLVideoElement;
    private danmaku: Danmaku;
    private selectedColor = "#ffffff";
    private selectedPosition: "slide" | "top" | "bottom" = "slide";
    private readonly MAX_CHARS = 350;

    constructor(
        container: HTMLElement,
        videoPlayer: HTMLVideoElement,
        danmakuInstance: Danmaku
    ) {
        const commentsCountElement = document.getElementById(
            "danmaku-comments-loaded"
        );
        if (commentsCountElement) {
            const match = commentsCountElement.textContent?.match(/(\d+)/);
            if (match) {
                this._commentsCount = parseInt(match[1], 10);
            }
        }
        this.addCommentsCountListener((count) => {
            const el = document.getElementById("danmaku-comments-loaded");
            if (el) {
                el.textContent = `${count} comment${
                    count === 1 ? "" : "s"
                } loaded`;
            }
        });

        this.container = container;
        this.videoPlayer = videoPlayer;
        this.danmaku = danmakuInstance;

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

        this.colorBoxes = this.styleMenu.querySelectorAll(".color-box:not(#custom-color-picker)");

        this.customColorPicker = this.styleMenu.querySelector(
            "#custom-color-picker"
        )!;;
        this.positionOptions =
            this.styleMenu.querySelectorAll(".position-option");

        this.setupEventListeners();
        this.updateUIBasedOnAuth();

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
        this.commentsCountListeners.forEach((fn) => fn(val));
    }

    /**
     * Add a listener for comments count changes
     */
    public addCommentsCountListener(fn: (count: number) => void) {
        this.commentsCountListeners.push(fn);
    }

    private setupEventListeners() {
        this.commentButton.addEventListener("click", () =>
            this.handleCommentButtonClick()
        );
        this.loginPrompt.addEventListener("click", () => this.openLoginPage());
        this.inputField.addEventListener("input", () => this.handleInput());

        this.styleButton.addEventListener("click", (e) => {
            e.stopPropagation();
            this.styleMenu.classList.toggle("open");
            this.styleButton.classList.toggle("open");
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

        this.styleMenu.addEventListener("click", (e) => {
            e.stopPropagation();
        });

        this.colorBoxes.forEach((box) => {
            box.addEventListener("click", () => {
                this.selectedColor = box.dataset.color || "#ffffff";
                this.updateSelectedColorUI(this.selectedColor);
            });
        });
        // When the user clicks on the color input
        this.customColorPicker.addEventListener("click", () => {
            this.selectedColor = this.customColorPicker.value;
            this.updateSelectedColorUI(this.customColorPicker.value);
        });
        // when the user changes the color in the input
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

        this.inputField.addEventListener("keydown", (e) => {
            if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                this.handleCommentButtonClick();
            }
        });
    }

    private updateSelectedColorUI(color: string) {
        // Remove selected class from all color boxes
        this.colorBoxes.forEach((box) =>
            box.classList.remove("selected-color")
        );
        this.customColorPicker.classList.remove("selected-color");
        
        // Check if the color matches any predefined color box
        const selectedBox = Array.from(this.colorBoxes).find(
            (box) => box.dataset.color === color
        );
        
        if (selectedBox) {
            // Select the predefined color box
            selectedBox.classList.add("selected-color");
        } else {
            // Select the custom color picker and update its value
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
            this.charCountContainer.appendChild(
                document.createTextNode(maxCountText)
            );
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
        const videoId =
            new URLSearchParams(window.location.search).get("v") || "unknown";
        const time = this.videoPlayer.currentTime;

        const success = await postComment(
            platform,
            videoId,
            time,
            text,
            this.selectedColor,
            this.selectedPosition,
            "normal"
        );

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
        const event = new CustomEvent("danmaku-open-login");
        document.dispatchEvent(event);
    }

    private async updateUIBasedOnAuth() {
        const token = await new Promise<string | null>((resolve) => {
            chrome.storage.local.get("authToken", (result) => {
                resolve(result.authToken || null);
            });
        });

        const isInputWrapperVisible = !token;
        this.inputField.style.visibility = isInputWrapperVisible ? 'hidden' : 'visible';
        this.loginPrompt.style.display = isInputWrapperVisible ? 'flex' : 'none';

        if (token) {
            this.inputField.disabled = false;
            this.commentButton.disabled = this.inputField.value.length > this.MAX_CHARS;
        } else {
            this.inputField.disabled = true;
            this.commentButton.disabled = true;
        }
    }
}
