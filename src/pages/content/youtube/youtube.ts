import "./style.css";
import danmakuHtml from "./danmakuinput.html?raw";
import { DanmakuInput } from "./danmaku-input";
import {
    getComments,
    postComment,
} from "../api";
import { Danmaku } from "../danmaku/danmaku";
import { LoginModal } from "../login-modal";

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
    private loginModal: LoginModal = new LoginModal();

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
                this.loginModal.show();
            });
            
            // Listen for successful login to update UI
            document.addEventListener('danmaku-login-success', () => {
                this.updateUIBasedOnAuth();
            });
        } else {
            console.error("Could not find danmaku input container, video player, or danmaku instance");
        }
    }

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

        // Close login modal if it's open
        this.loginModal.closeModal();

        // Remove event listeners
        document.removeEventListener("danmaku-open-login", () => {
            this.loginModal.show();
        });
        document.removeEventListener("danmaku-login-success", () => {
            this.updateUIBasedOnAuth();
        });
    }
}
