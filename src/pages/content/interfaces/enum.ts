export enum DensityMode {
    SPARSE = "sparse",
    NORMAL = "normal",
    DENSE = "dense"
}

export const DensityConfig = {
    [DensityMode.SPARSE]: {
        delay: 300,
        description: "Sparse - 300 millisecond delay between comments on same lane"
    },
    [DensityMode.NORMAL]: {
        delay: 100,
        description: "Normal - 100 millisecond delay between comments on same lane"
    },
    [DensityMode.DENSE]: {
        delay: 0,
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
