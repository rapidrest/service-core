///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2020-2026 Jean-Philippe Steinmetz. All rights reserved.
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
/**
 * Provides an explicit type declaration for `T | T[]`.
 */
export type OneOrMany<T> = T | T[];

/**
 * Provides an explicit type declaration for `T | null`.
 */
export type OneOrNull<T> = T | null;
