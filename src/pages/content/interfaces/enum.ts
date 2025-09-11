export enum DensityMode {
    SPARSE = "sparse",
    NORMAL = "normal",
    DENSE = "dense"
}
// delay in milliseconds
export const DensityConfig = {
    [DensityMode.SPARSE]: {
        delay: 300,
    },
    [DensityMode.NORMAL]: {
        delay: 100,
    },
    [DensityMode.DENSE]: {
        delay: 20,
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
