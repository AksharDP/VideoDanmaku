// @ts-expect-error bun:test not found error, but still works
import { expect, test, describe, beforeEach } from "bun:test";
import { Danmaku } from "src/pages/content/danmaku/danmaku";
import { Comment } from "src/pages/content/api";
import { DensityMode, ScrollMode, FontSize } from "src/pages/content/interfaces/enum";

describe("Danmaku Core Functionality", () => {

    let danmaku: Danmaku;
    let videoPlayer: HTMLVideoElement;
    let container: HTMLElement;
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

    beforeEach(() => {
        document.body.innerHTML = `
            <div id="danmaku-container" style="width: 1280px; height: 720px;"></div>
            <video id="test-video"></video>
        `;
        videoPlayer = document.getElementById("test-video") as HTMLVideoElement;
        container = document.getElementById("danmaku-container") as HTMLElement;
        danmaku = new Danmaku(videoPlayer, container);
    });

    test("setComments sorts comments, updates count, and calculates layouts", () => {
        danmaku.setComments(unsortedComments);

        const comments = danmaku.getComments();
        const layout = danmaku.commentLayout;
        const count = danmaku.getCommentsCount;

        expect(count).toBe(unsortedComments.length);
        expect(layout.length).toBeLessThanOrEqual(unsortedComments.length);

        const sortedTimes = comments.map(c => c.time);
        expect(sortedTimes).toEqual([...sortedTimes].sort((a, b) => a - b));

        layout.forEach(l => {
            expect(l.width).toBeGreaterThan(0);
            expect(l.speed).toBeGreaterThan(0);
            expect(l.lane).toBeGreaterThanOrEqual(0);
        });
    });

    test("Layout should not have overlapping SLIDE comments in the same lane", () => {
        const slideComments = unsortedComments.filter(c => c.scrollMode === ScrollMode.SLIDE);
        danmaku.setComments(slideComments);
        const layout = danmaku.commentLayout;

        const lanes: { [key: number]: { id: number, startTime: number, width: number, speed: number }[] } = {};
        layout.forEach(l => {
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
                const c1ExitTime = c1EnterTime + (c1.width / c1.speed);
                const c2EnterTime = c2.startTime;
                expect(c2EnterTime).toBeGreaterThanOrEqual(c1ExitTime);
            }
        }
    });

    test("Layout correctly handles TOP and BOTTOM comments to avoid overlap", () => {
        const fixedComments = unsortedComments.filter(c => c.scrollMode !== ScrollMode.SLIDE);
        danmaku.setComments(fixedComments);
        const layout = danmaku.commentLayout;

        const topLanes: { [key: number]: number[] } = {};
        const bottomLanes: { [key: number]: number[] } = {};

        layout.forEach(l => {
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
                expect(topLanes[lane][i+1] - topLanes[lane][i]).toBeGreaterThanOrEqual(3.5); // DURATION / 2
            }
        }
        for (const lane in bottomLanes) {
            bottomLanes[lane].sort((a, b) => a - b);
            for (let i = 0; i < bottomLanes[lane].length - 1; i++) {
                expect(bottomLanes[lane][i+1] - bottomLanes[lane][i]).toBeGreaterThanOrEqual(3.5); // DURATION / 2
            }
        }
    });


    test("Handles empty comments gracefully", () => {
        danmaku.setComments([]);
        expect(danmaku.getCommentsCount).toBe(0);
        expect(danmaku.commentLayout.length).toBe(0);
    });

    test("Comments with same time are handled correctly", () => {
        const sameTimeComments: Comment[] = [
            { id: 1, content: "A", time: 5, color: "#FFF", userId: 1, scrollMode: ScrollMode.SLIDE, fontSize: FontSize.NORMAL },
            { id: 2, content: "B", time: 5, color: "#000", userId: 2, scrollMode: ScrollMode.SLIDE, fontSize: FontSize.NORMAL },
            { id: 3, content: "C", time: 5, color: "#F00", userId: 3, scrollMode: ScrollMode.SLIDE, fontSize: FontSize.NORMAL }
        ];

        danmaku.setComments(sameTimeComments);
        expect(danmaku.commentLayout.length).toBe(3);
        const lanes = danmaku.commentLayout.map(c => c.lane);
        const uniqueLanes = [...new Set(lanes)];
        expect(uniqueLanes.length).toBe(3); // Each should be in a different lane
    });

    test("Density settings affect comment layout", () => {
        const denseComments: Comment[] = [
            { id: 1, content: "A", time: 1, color: "#FFF", userId: 1, scrollMode: ScrollMode.SLIDE, fontSize: FontSize.NORMAL },
            { id: 2, content: "B", time: 1.1, color: "#000", userId: 2, scrollMode: ScrollMode.SLIDE, fontSize: FontSize.NORMAL },
        ];

        // DENSE: Both comments should be placed, possibly in the same lane
        danmaku.setDensity(DensityMode.DENSE);
        danmaku.setComments(denseComments);
        const denseLayout = danmaku.commentLayout;
        expect(denseLayout.length).toBe(2);

        // SPARSE: Both comments should be placed, but in different lanes
        danmaku.setDensity(DensityMode.SPARSE);
        danmaku.setComments(denseComments);
        const sparseLayout = danmaku.commentLayout;
        expect(sparseLayout.length).toBe(2);
        expect(sparseLayout[0].lane).not.toBe(sparseLayout[1].lane);
    });
});