export const CURVE_BUCKETS = ["0", "1", "2", "3", "4", "5", "6+"] as const;
export type CurveBucket = typeof CURVE_BUCKETS[number];
/** Desired nonland copy counts. Targets are soft; legality and locks always win. */
export type CurveTargets = Record<CurveBucket, number>;
