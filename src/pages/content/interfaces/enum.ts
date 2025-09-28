export enum DensityMode {
    SPARSE = "sparse",
    NORMAL = "normal",
    DENSE = "dense"
}
// delay in milliseconds
export const DensityMap = {
    [DensityMode.SPARSE]: {
        delay: 1000,
    },
    [DensityMode.NORMAL]: {
        delay: 100,
    },
    [DensityMode.DENSE]: {
        delay: 20,
    }
} as const;

export type DensityModeType = `${DensityMode}`;

export enum FontSize {
    SMALL = "small",
    NORMAL = "normal",
    LARGE = "large",
}

export const FontMap = {
    [FontSize.SMALL]: 18,
    [FontSize.NORMAL]: 24,
    [FontSize.LARGE]: 32,
} as const;

export enum ScrollMode {
    SLIDE = "slide",
    TOP = "top",
    BOTTOM = "bottom",
}
