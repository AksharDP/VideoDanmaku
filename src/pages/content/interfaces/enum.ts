export enum DensityMode {
    SPARSE = "sparse",
    NORMAL = "normal",
    DENSE = "dense"
}

export const DensityConfig = {
    [DensityMode.SPARSE]: {
        delay: 200, // 2 seconds
        description: "Sparse - 2 second delay between comments on same lane"
    },
    [DensityMode.NORMAL]: {
        delay: 100, // 1 second
        description: "Normal - 1 second delay between comments on same lane"
    },
    [DensityMode.DENSE]: {
        delay: 0, // No delay
        description: "Dense - No delay between comments"
    }
} as const;

export type DensityModeType = `${DensityMode}`;

// export type FontSize = {
//     SMALL: "small",
//     NORMAL: "normal",
//     LARGE: "large",
// }

export enum FontSize {
    SMALL = "small",
    NORMAL = "normal",
    LARGE = "large",
}

export enum ScrollMode {
    SLIDE = "slide",
    TOP = "top",
    BOTTOM = "bottom",
}