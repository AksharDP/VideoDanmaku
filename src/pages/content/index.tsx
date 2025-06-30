import { createRoot } from "react-dom/client";
import "./style.css";
import danmakuHtml from "./danmakuinput.html?raw";

function waitForElement(
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

async function main() {
    let video_player;
    let watch_metadata;
    let title;

    video_player = document.getElementsByClassName("html5-main-video")[0];

    watch_metadata = await waitForElement("ytd-watch-metadata", 10000);

    if (!watch_metadata) {
        console.error(
            "Could not find ytd-watch-metadata element after waiting."
        );
        title = undefined;
    } else {
        title = (watch_metadata as HTMLElement).querySelector("#title");
    }

    if (import.meta.env.DEV) {
        console.log("YouTube page structure:", {
            video_player,
            watch_metadata,
            title,
        });
    }

    if (!video_player || !watch_metadata || !title) {
        console.error(
            "YouTube page structure has changed, unable to find video player or metadata."
        );
        return;
    }

    const tempDiv = document.createElement("div");
    tempDiv.innerHTML = danmakuHtml;
    const danmakuElement = tempDiv.firstElementChild;
    if (danmakuElement) {
        title.prepend(danmakuElement);

        setupDanmakuEventListeners();
    }
}

function setupDanmakuEventListeners() {
    const styleButton = document.querySelector(
        ".danmaku-style-button"
    ) as HTMLElement;
    const styleMenu = document.querySelector(
        ".danmaku-style-menu"
    ) as HTMLElement;
    const inputField = document.querySelector(
        "#danmaku-input-field"
    ) as HTMLInputElement;
    const chevronIcon = document.querySelector(".chevron-icon") as SVGElement;
    const submitButton = document.querySelector(
        ".danmaku-comment-button"
    ) as HTMLButtonElement;

    if (styleMenu) {
        styleMenu.style.userSelect = "none";
        styleMenu.style.webkitUserSelect = "none";
    }

    let selectedColor = "white";
    let previouslySelected: HTMLElement | null = null;

    styleButton?.addEventListener("click", function (event) {
        event.stopPropagation();
        if (styleMenu && chevronIcon) {
            const isOpen = styleMenu.classList.contains("open");

            if (isOpen) {
                styleButton.classList.remove("open");
                styleMenu.classList.remove("open");
                chevronIcon.classList.remove("chevron-up");
                chevronIcon.classList.add("chevron-down");
                chevronIcon.innerHTML = '<path d="m6 9 6 6 6-6"/>';
            } else {
                styleButton.classList.add("open");
                styleMenu.classList.add("open");
                chevronIcon.classList.remove("chevron-down");
                chevronIcon.classList.add("chevron-up");
                chevronIcon.innerHTML = '<path d="m18 15-6-6-6 6"/>';
            }
        }
    });

    document.querySelectorAll(".style-option").forEach((option) => {
        const optionElement = option as HTMLElement;

        optionElement.addEventListener("click", function () {
            const color = optionElement.dataset.color;

            if (color) {
                if (optionElement.classList.contains("selected-color")) {
                    optionElement.classList.remove("selected-color");
                    previouslySelected = null;
                    selectedColor = "white";
                    if (inputField) {
                        inputField.style.color = "#ffffff";
                    }
                } else {
                    selectedColor = color;

                    if (previouslySelected) {
                        previouslySelected.classList.remove("selected-color");
                    }

                    optionElement.classList.add("selected-color");

                    previouslySelected = optionElement;

                    if (inputField) {
                        inputField.style.color = getColorValue(color);
                    }
                }
            }
        });
    });

    if (inputField) {
        inputField.style.color = "#ffffff";
    }

    if (inputField && submitButton) {
        const updateButtonState = () => {
            submitButton.disabled = !inputField.value.trim();
        };
        inputField.addEventListener("input", updateButtonState);
        updateButtonState();
    }

    document.addEventListener("click", function (e) {
        if (
            styleButton &&
            styleMenu &&
            !styleButton.contains(e.target as Node) &&
            !styleMenu.contains(e.target as Node)
        ) {
            if (styleMenu.classList.contains("open")) {
                styleMenu.classList.remove("open");
                chevronIcon.classList.remove("chevron-up");
                chevronIcon.classList.add("chevron-down");
                chevronIcon.innerHTML = '<path d="m6 9 6 6 6-6"/>';
                styleButton.classList.remove("open");
            }
        }
    });
}

function getColorValue(color: string): string {
    const colorMap: { [key: string]: string } = {
        red: "#ff4444",
        green: "#44ff44",
        blue: "#4444ff",
        white: "#ffffff",
    };
    return colorMap[color] || "#ffffff";
}

main();
