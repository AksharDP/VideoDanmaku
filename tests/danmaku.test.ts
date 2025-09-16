import { expect, test, describe, beforeEach } from "bun:test";
import "./happydom";
import { Danmaku } from "../src/pages/content/danmaku/danmaku";
import { Comment } from "../src/pages/content/api";
import { DensityMode, ScrollMode, FontSize } from "../src/pages/content/interfaces/enum";

const unsortedComments: Comment[] = [
    { id: 1, content: "Quick brown fox jumps.", time: 7, color: "#1A2B3C", userId: 5, scrollMode: ScrollMode.TOP, fontSize: FontSize.NORMAL },
    { id: 2, content: "Lorem ipsum dolor sit.", time: 3, color: "#4D5E6F", userId: 12, scrollMode: ScrollMode.SLIDE, fontSize: FontSize.SMALL },
    { id: 3, content: "Vivamus sagittis nunc.", time: 12, color: "#7F8A9B", userId: 3, scrollMode: ScrollMode.BOTTOM, fontSize: FontSize.LARGE },
    { id: 4, content: "Pellentesque porttitor mauris.", time: 15, color: "#2C3D4E", userId: 8, scrollMode: ScrollMode.TOP, fontSize: FontSize.SMALL },
    { id: 5, content: "Consectetur adipiscing elit.", time: 1, color: "#9AB0C1", userId: 14, scrollMode: ScrollMode.SLIDE, fontSize: FontSize.NORMAL },
    { id: 6, content: "Nulla hendrerit quam.", time: 9, color: "#D4E5F6", userId: 2, scrollMode: ScrollMode.BOTTOM, fontSize: FontSize.NORMAL },
    { id: 7, content: "Sed fermentum nulla.", time: 6, color: "#112233", userId: 19, scrollMode: ScrollMode.TOP, fontSize: FontSize.LARGE },
    { id: 8, content: "Quisque non turpis.", time: 14, color: "#445566", userId: 7, scrollMode: ScrollMode.SLIDE, fontSize: FontSize.SMALL },
    { id: 9, content: "Aenean vitae ullamcorper.", time: 5, color: "#778899", userId: 1, scrollMode: ScrollMode.BOTTOM, fontSize: FontSize.NORMAL },
    { id: 10, content: "Fusce nec nibh.", time: 0, color: "#AABBCC", userId: 16, scrollMode: ScrollMode.TOP, fontSize: FontSize.SMALL },
    { id: 11, content: "Dolor sit amet consectetur.", time: 11, color: "#DDEEFF", userId: 10, scrollMode: ScrollMode.SLIDE, fontSize: FontSize.LARGE },
    { id: 12, content: "Etiam sagittis nunc.", time: 2, color: "#001122", userId: 4, scrollMode: ScrollMode.BOTTOM, fontSize: FontSize.NORMAL },
    { id: 13, content: "Pellentesque euismod.", time: 13, color: "#334455", userId: 18, scrollMode: ScrollMode.TOP, fontSize: FontSize.SMALL },
    { id: 14, content: "Mauris quis turpis.", time: 8, color: "#667788", userId: 6, scrollMode: ScrollMode.SLIDE, fontSize: FontSize.NORMAL },
    { id: 15, content: "Curabitur sit amet.", time: 4, color: "#99AABB", userId: 13, scrollMode: ScrollMode.BOTTOM, fontSize: FontSize.LARGE },
    { id: 16, content: "Integer luctus nulla.", time: 7, color: "#CCDDEE", userId: 9, scrollMode: ScrollMode.TOP, fontSize: FontSize.NORMAL },
    { id: 17, content: "Nam porta sapien.", time: 10, color: "#FFAA00", userId: 15, scrollMode: ScrollMode.SLIDE, fontSize: FontSize.SMALL },
    { id: 18, content: "Felis euismod.", time: 3, color: "#00BBFF", userId: 11, scrollMode: ScrollMode.BOTTOM, fontSize: FontSize.NORMAL },
    { id: 19, content: "Sed blandit felis.", time: 12, color: "#CC33AA", userId: 17, scrollMode: ScrollMode.TOP, fontSize: FontSize.LARGE },
    { id: 20, content: "Nunc eu urna.", time: 5, color: "#336699", userId: 20, scrollMode: ScrollMode.SLIDE, fontSize: FontSize.NORMAL }
];

describe("Danmaku Core Functionality", () => {

    let danmaku: Danmaku;
    let videoPlayer: HTMLVideoElement;
    let container: HTMLElement;

    beforeEach(() => {
        document.body.innerHTML = `
            <div id="danmaku-container" style="width: 1280px; height: 720px;"></div>
            <video id="test-video"></video>
        `;
        videoPlayer = document.getElementById("test-video") as HTMLVideoElement;
        container = document.getElementById("danmaku-container") as HTMLElement;
        danmaku = new Danmaku(videoPlayer, container);
        (danmaku as any).lastKnownWidth = 1280;
        (danmaku as any).lastKnownHeight = 720;
    });

    test("setComments sorts comments, updates count, and calculates layouts", () => {
        danmaku.setComments(unsortedComments);

        const comments = danmaku.getComments();
        const layout = (danmaku as any).commentLayout;
        const count = danmaku.getCommentsCount;

        expect(count).toBe(unsortedComments.length);
        expect(layout.length).toBe(unsortedComments.length);

        const sortedTimes = comments.map(c => c.time);
        expect(sortedTimes).toEqual([...sortedTimes].sort((a, b) => a - b));

        const layoutStartTimes = layout.map((l: any) => l.startTime);
        expect(layoutStartTimes).toEqual([...layoutStartTimes].sort((a: number, b: number) => a - b));

        layout.forEach((l: any) => {
            expect(l.width).toBeGreaterThan(0);
            expect(l.speed).toBeGreaterThan(0);
            expect(l.lane).toBeGreaterThanOrEqual(0);
            expect(l.startTime).toBeGreaterThanOrEqual(comments.find((c: Comment) => c.id === l.commentId)!.time);
        });
    });

    test("Layout should not have overlapping SLIDE comments in the same lane", () => {
        const slideComments = unsortedComments.filter(c => c.scrollMode === ScrollMode.SLIDE);
        danmaku.setComments(slideComments);
        const layout = (danmaku as any).commentLayout;

        const lanes: { [key: number]: { id: number, startTime: number, width: number, speed: number }[] } = {};
        layout.forEach((l: any) => {
            if (!lanes[l.lane]) {
                lanes[l.lane] = [];
            }
            lanes[l.lane].push({ id: l.commentId, startTime: l.startTime, width: l.width, speed: l.speed });
        });

        for (const lane in lanes) {
            const commentsInLane = lanes[lane].sort((a, b) => a.startTime - b.startTime);
            for (let i = 0; i < commentsInLane.length - 1; i++) {
                const c1 = commentsInLane[i];
                const c2 = commentsInLane[i + 1];
                const c1EnterTime = c1.startTime;
                const c1ExitTime = c1EnterTime + (c1.width / c1.speed) * 1000;
                const c2EnterTime = c2.startTime;
                expect(c2EnterTime).toBeGreaterThanOrEqual(c1ExitTime);
            }
        }
    });

    test("Layout correctly handles TOP and BOTTOM comments to avoid overlap", () => {
        const fixedComments = unsortedComments.filter(c => c.scrollMode !== ScrollMode.SLIDE);
        danmaku.setComments(fixedComments);
        const layout = (danmaku as any).commentLayout;

        const topLanes: { [key: number]: number[] } = {};
        const bottomLanes: { [key: number]: number[] } = {};

        layout.forEach((l: any) => {
            if (l.scrollMode === ScrollMode.TOP) {
                if (!topLanes[l.lane]) topLanes[l.lane] = [];
                topLanes[l.lane].push(l.startTime);
            } else {
                if (!bottomLanes[l.lane]) bottomLanes[l.lane] = [];
                bottomLanes[l.lane].push(l.startTime);
            }
        });

        for (const lane in topLanes) {
            topLanes[lane].sort((a, b) => a - b);
            for (let i = 0; i < topLanes[lane].length - 1; i++) {
                expect(topLanes[lane][i+1] - topLanes[lane][i]).toBeGreaterThanOrEqual(3500); // DURATION / 2 in ms
            }
        }
        for (const lane in bottomLanes) {
            bottomLanes[lane].sort((a, b) => a - b);
            for (let i = 0; i < bottomLanes[lane].length - 1; i++) {
                expect(bottomLanes[lane][i+1] - bottomLanes[lane][i]).toBeGreaterThanOrEqual(3500); // DURATION / 2 in ms
            }
        }
    });

    test("Handles empty comments gracefully", () => {
        danmaku.setComments([]);
        expect(danmaku.getCommentsCount).toBe(0);
        expect((danmaku as any).commentLayout.length).toBe(0);
    });

    test("Comments with same time are handled correctly in different lanes", () => {
        const sameTimeComments: Comment[] = [
            { id: 1, content: "A", time: 5, color: "#FFF", userId: 1, scrollMode: ScrollMode.SLIDE, fontSize: FontSize.NORMAL },
            { id: 2, content: "B", time: 5, color: "#000", userId: 2, scrollMode: ScrollMode.SLIDE, fontSize: FontSize.NORMAL },
            { id: 3, content: "C", time: 5, color: "#F00", userId: 3, scrollMode: ScrollMode.SLIDE, fontSize: FontSize.NORMAL }
        ];

        danmaku.setComments(sameTimeComments);
        expect((danmaku as any).commentLayout.length).toBe(3);
        const lanes = (danmaku as any).commentLayout.map((c: any) => c.lane);
        const uniqueLanes = [...new Set(lanes)];
        expect(uniqueLanes.length).toBe(3); // Each should be in a different lane
    });

    test("Density settings affect comment layout delays", () => {
        const closeTimeComments: Comment[] = new Array(50).fill(0).map((_, i) => ({
            id: i + 1,
            content: "Test",
            time: i * 10, // 10ms apart to force overlaps and delays
            color: "#FFF",
            userId: 1,
            scrollMode: ScrollMode.SLIDE,
            fontSize: FontSize.NORMAL
        }));

        // DENSE: Comments should be placed with minimal delays
        danmaku.setDensity(DensityMode.DENSE);
        danmaku.setComments(closeTimeComments);
        const denseLayout = (danmaku as any).commentLayout;
        const denseMaxStart = Math.max(...denseLayout.map((l: any) => l.startTime));

        // SPARSE: Comments should be more spread out (higher max startTime due to larger delays)
        danmaku.setDensity(DensityMode.SPARSE);
        danmaku.setComments(closeTimeComments);
        const sparseLayout = (danmaku as any).commentLayout;
        const sparseMaxStart = Math.max(...sparseLayout.map((l: any) => l.startTime));

        expect(sparseMaxStart).toBeGreaterThan(denseMaxStart);
    });

    test("play and pause methods control animation", () => {
        danmaku.setComments(unsortedComments.slice(0, 5));
        videoPlayer.currentTime = 1;

        danmaku.play();
        expect((danmaku as any).isRunning).toBe(true);

        danmaku.pause();
        expect((danmaku as any).isRunning).toBe(false);
    });

    test("resize recalculates layouts and updates lane counts", () => {
        danmaku.setComments(unsortedComments.slice(0, 5));
        const initialLayout = (danmaku as any).commentLayout.slice();
        const initialLaneCount = Math.floor(720 / (danmaku as any).laneHeight) - 1; // 23

        // Simulate resize
        (danmaku as any).lastKnownHeight = 360;
        danmaku.resize();

        const newLayout = (danmaku as any).commentLayout;
        const newLaneCount = Math.floor(360 / (danmaku as any).laneHeight) - 1; // 11

        expect(newLayout.length).toBe(initialLayout.length);
        const newLanes = newLayout.map((l: any) => l.lane);
        expect(Math.max(...newLanes)).toBeLessThanOrEqual(newLaneCount);
    });

    test("setSpeed affects speed multiplier and recalculates layouts", () => {
        danmaku.setSpeed(50); // 50%
        expect((danmaku as any).speedMultiplier).toBe(0.5);

        danmaku.setComments(unsortedComments.slice(0, 1));
        const slowSpeed = (danmaku as any).commentLayout[0].speed;

        danmaku.setSpeed(200); // 200%
        expect((danmaku as any).speedMultiplier).toBe(2);

        danmaku.setComments(unsortedComments.slice(0, 1));
        const fastSpeed = (danmaku as any).commentLayout[0].speed;

        expect(fastSpeed).toBeGreaterThan(slowSpeed);
    });

    test("setOpacity affects container opacity", () => {
        danmaku.setOpacity(50); // 50%
        expect(container.style.opacity).toBe("0.5");

        danmaku.setOpacity(100); // 100%
        expect(container.style.opacity).toBe("1");
    });

    test("setFontSize affects font size multiplier, lane height, and recalculates layouts", () => {
        const initialFontSize = (danmaku as any).fontSize;
        const initialLaneHeight = (danmaku as any).laneHeight;

        danmaku.setFontSize(50); // 50%
        expect((danmaku as any).fontSizeMultiplier).toBe(0.5);
        expect((danmaku as any).laneHeight).toBe(Math.floor(initialFontSize * 0.5 * 1.2));

        danmaku.setFontSize(150); // 150%
        expect((danmaku as any).fontSizeMultiplier).toBe(1.5);
        expect((danmaku as any).laneHeight).toBe(Math.floor(initialFontSize * 1.5 * 1.2));
    });

    test("addComment inserts in sorted order and updates layout", () => {
        danmaku.setComments(unsortedComments.slice(0, 5));
        const initialCount = danmaku.getCommentsCount;

        const newComment: Comment = { id: 100, content: "New", time: 10, color: "#FFF", userId: 100, scrollMode: ScrollMode.SLIDE, fontSize: FontSize.NORMAL };
        danmaku.addComment(newComment);

        expect(danmaku.getCommentsCount).toBe(initialCount + 1);
        expect(danmaku.getComments().some(c => c.id === 100)).toBe(true);
        const times = danmaku.getComments().map(c => c.time);
        expect(times).toEqual([...times].sort((a, b) => a - b));
    });

    test("toggleVisibility shows and hides comments", () => {
        danmaku.setComments(unsortedComments.slice(0, 5));

        danmaku.toggleVisibility(false);
        expect(container.style.display).toBe("none");

        danmaku.toggleVisibility(true);
        expect(container.style.display).toBe("");
    });

    test("clear removes all comments and layouts", () => {
        danmaku.setComments(unsortedComments.slice(0, 5));
        expect(danmaku.getCommentsCount).toBeGreaterThan(0);

        danmaku.clear();
        expect(danmaku.getCommentsCount).toBe(0);
        expect((danmaku as any).commentLayout.length).toBe(0);
    });

    test("emitComment renders comments correctly based on scrollMode", () => {
        const slideComment: Comment = { id: 1, content: "Slide", time: 0, color: "#FFF", userId: 1, scrollMode: ScrollMode.SLIDE, fontSize: FontSize.NORMAL };
        const topComment: Comment = { id: 2, content: "Top", time: 0, color: "#FFF", userId: 1, scrollMode: ScrollMode.TOP, fontSize: FontSize.NORMAL };
        const bottomComment: Comment = { id: 3, content: "Bottom", time: 0, color: "#FFF", userId: 1, scrollMode: ScrollMode.BOTTOM, fontSize: FontSize.NORMAL };

        danmaku.setComments([slideComment, topComment, bottomComment]);
        const layouts = (danmaku as any).commentLayout;

        videoPlayer.currentTime = 0;
        (danmaku as any).emitNewComments();

        const elements = Array.from(container.querySelectorAll('.danmaku-comment')) as HTMLElement[];
        expect(elements.length).toBe(3);

        // Slide
        const slideEl = elements.find(el => el.textContent === "Slide")!;
        expect(slideEl.style.top).toBe(`${layouts.find((l: any) => l.commentId === 1)!.lane * (danmaku as any).laneHeight}px`);
        expect(slideEl.classList.contains('danmaku-animation-slide')).toBe(true);

        // Top
        const topEl = elements.find(el => el.textContent === "Top")!;
        expect(topEl.style.top).toBe(`${layouts.find((l: any) => l.commentId === 2)!.lane * (danmaku as any).laneHeight}px`);
        expect(topEl.style.left).toBe('50%');
        expect(topEl.style.transform).toBe('translateX(-50%)');
        expect(topEl.classList.contains('danmaku-animation-top')).toBe(true);

        // Bottom
        const bottomEl = elements.find(el => el.textContent === "Bottom")!;
        const totalLanes = Math.floor(720 / (danmaku as any).laneHeight);
        const expectedTop = (totalLanes - 1 - layouts.find((l: any) => l.commentId === 3)!.lane) * (danmaku as any).laneHeight;
        expect(bottomEl.style.top).toBe(`${expectedTop}px`);
        expect(bottomEl.style.left).toBe('50%');
        expect(bottomEl.style.transform).toBe('translateX(-50%)');
        expect(bottomEl.classList.contains('danmaku-animation-bottom')).toBe(true);
    });


    test("Element pooling works correctly", () => {
        const comment: Comment = { id: 1, content: "Pooled", time: 0, color: "#FFF", userId: 1, scrollMode: ScrollMode.SLIDE, fontSize: FontSize.NORMAL };
        danmaku.setComments([comment]);
        videoPlayer.currentTime = 0;
        (danmaku as any).emitNewComments();

        expect((danmaku as any).commentPool.length).toBe(0); // Pool empty, created new
        const element = container.querySelector('.danmaku-comment') as HTMLElement;
        expect(element).toBeDefined();

        element.dispatchEvent(new Event('animationend'));
        expect(container.querySelectorAll('.danmaku-comment').length).toBe(0);
        expect((danmaku as any).commentPool.length).toBe(1); // Returned to pool

        // Emit again
        videoPlayer.currentTime = 0;
        danmaku.resyncCommentQueue();
        (danmaku as any).emitNewComments();
        expect((danmaku as any).commentPool.length).toBe(0); // Reused from pool
        expect(container.querySelectorAll('.danmaku-comment').length).toBe(1);
    });

    test("pause and play toggle animation-play-state", () => {
        danmaku.setComments(unsortedComments.slice(0, 3));
        videoPlayer.currentTime = 0;
        danmaku.play();
        (danmaku as any).emitNewComments();

        const elements = Array.from(container.querySelectorAll('.danmaku-comment')) as HTMLElement[];
        elements.forEach(el => expect(el.style.animationPlayState).toBe('running'));

        danmaku.pause();
        elements.forEach(el => expect(el.style.animationPlayState).toBe('paused'));
    });
});

describe("Danmaku Edge Cases and Synchronization", () => {
    let danmaku: Danmaku;
    let videoPlayer: HTMLVideoElement;
    let container: HTMLElement;

    beforeEach(() => {
        document.body.innerHTML = `
            <div id="danmaku-container" style="width: 1280px; height: 720px;"></div>
            <video id="test-video"></video>
        `;
        videoPlayer = document.getElementById("test-video") as HTMLVideoElement;
        container = document.getElementById("danmaku-container") as HTMLElement;
        danmaku = new Danmaku(videoPlayer, container);
        (danmaku as any).lastKnownWidth = 1280;
        (danmaku as any).lastKnownHeight = 720;
    });

    test("handles comments with negative time", () => {
        const negativeTimeComments: Comment[] = [
            { id: 1, content: "Negative", time: -5000, color: "#FFF", userId: 1, scrollMode: ScrollMode.SLIDE, fontSize: FontSize.NORMAL },
            { id: 2, content: "Zero", time: 0, color: "#000", userId: 2, scrollMode: ScrollMode.SLIDE, fontSize: FontSize.NORMAL }
        ];
        danmaku.setComments(negativeTimeComments);
        expect(danmaku.getCommentsCount).toBe(2);
        expect((danmaku as any).commentLayout.length).toBe(2);
        expect((danmaku as any).commentLayout[0].startTime).toBe(-5000);
    });

    test("handles very long comments", () => {
        const longComment: Comment = { id: 1, content: "A".repeat(1000), time: 1, color: "#FFF", userId: 1, scrollMode: ScrollMode.SLIDE, fontSize: FontSize.NORMAL };
        danmaku.setComments([longComment]);
        const layout = (danmaku as any).commentLayout[0];
        expect(layout.width).toBeGreaterThan(100);
    });

    test("handles zero width container", () => {
        (danmaku as any).lastKnownWidth = 0;
        danmaku.setComments(unsortedComments.slice(0, 1));
        expect(danmaku.getCommentsCount).toBe(1);
    });

    test("handles invalid scrollMode by skipping", () => {
        const invalidComment: Comment = { id: 1, content: "Test", time: 1, color: "#FFF", userId: 1, scrollMode: "invalid" as any, fontSize: FontSize.NORMAL };
        danmaku.setComments([invalidComment]);
        expect(danmaku.getCommentsCount).toBe(1);
        expect((danmaku as any).commentLayout.length).toBe(0);
    });

    test("play without comments does not crash", () => {
        danmaku.play();
        expect((danmaku as any).isRunning).toBe(true);
    });

    test("pause without playing does not crash", () => {
        danmaku.pause();
        expect((danmaku as any).isRunning).toBe(false);
    });

    test("setSpeed with invalid values clamps to min", () => {
        danmaku.setSpeed(-10);
        expect((danmaku as any).speedMultiplier).toBe(0.1);

        danmaku.setSpeed(0);
        expect((danmaku as any).speedMultiplier).toBe(0.1);
    });

    test("setFontSize with invalid values clamps to min", () => {
        danmaku.setFontSize(-10);
        expect((danmaku as any).fontSizeMultiplier).toBe(0.1);

        danmaku.setFontSize(0);
        expect((danmaku as any).fontSizeMultiplier).toBe(0.1);
    });

    test("resyncCommentQueue with no comments does not crash", () => {
        danmaku.resyncCommentQueue();
        // Should not throw
    });

    test("resyncCommentQueue correctly updates queue and re-emits in-progress comments", () => {
        const comments: Comment[] = [
            { id: 1, content: "Early", time: 0, color: "#FFF", userId: 1, scrollMode: ScrollMode.SLIDE, fontSize: FontSize.NORMAL },
            { id: 2, content: "Mid", time: 3000, color: "#FFF", userId: 1, scrollMode: ScrollMode.SLIDE, fontSize: FontSize.NORMAL },
            { id: 3, content: "Late", time: 10000, color: "#FFF", userId: 1, scrollMode: ScrollMode.SLIDE, fontSize: FontSize.NORMAL }
        ];
        danmaku.setComments(comments);

        videoPlayer.currentTime = 5; // 5 seconds
        danmaku.resyncCommentQueue();

        expect((danmaku as any).nextEmitIndex).toBe(2); // First after 5000 is index 2 (time 10000)
        const elements = Array.from(container.querySelectorAll('.danmaku-comment')) as HTMLElement[];
        expect(elements.length).toBe(2); // "Early" and "Mid" should be visible

        expect(elements.map(el => el.textContent)).toEqual(expect.arrayContaining(["Early", "Mid"]));

        // Check negative animation delay
        const midEl = elements.find(el => el.textContent === "Mid")!;
        expect(midEl.style.animationDelay).toBe('-2s');

        const earlyEl = elements.find(el => el.textContent === "Early")!;
        expect(earlyEl.style.animationDelay).toBe('-5s');
    });

    test("destroy cleans up resources", () => {
        danmaku.setComments(unsortedComments.slice(0, 5));
        danmaku.destroy();
        expect((danmaku as any).allComments.length).toBe(0);
        expect((danmaku as any).commentLayout.length).toBe(0);
    });
});