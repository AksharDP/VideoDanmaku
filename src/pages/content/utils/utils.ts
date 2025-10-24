export async function waitForElement(selector: string, attempts = 15, intervalMs = 1000): Promise<Element | null> {
    const first = document.querySelector(selector);
    if (first) return first;

    return new Promise((resolve) => {
        let tries = 0;
        const id = setInterval(() => {
            tries += 1;
            const el = document.querySelector(selector);
            if (el) {
                clearInterval(id);
                resolve(el);
                return;
            }
            if (tries >= attempts) {
                clearInterval(id);
                resolve(null);
            }
        }, intervalMs);
    });
}

export async function waitForPlayer(selector: string): Promise<HTMLVideoElement | null> {
    return new Promise((resolve) => {
        let observer: MutationObserver | null = null;
        const checkForPlayer = () => {
            const player = document.querySelector(selector) as HTMLVideoElement;
            if (player) {
                if (observer) {
                    observer.disconnect();
                }
                resolve(player);
                return true;
            }
            return false;
        };
        if (checkForPlayer()) {
            return;
        }
        observer = new MutationObserver(() => {
            checkForPlayer();
        });
        observer.observe(document.body, { childList: true, subtree: true });
        setTimeout(() => {
            if (observer) {
                observer.disconnect();
            }
            resolve(null);
        }, 15000);
    });
}