/**
 * Provides an explicit type declaration for `T | T[]`.
 */
export type OneOrMany<T> = T | T[];

/**
 * Provides an explicit type declaration for `T | null`.
 */
export type OneOrNull<T> = T | null;