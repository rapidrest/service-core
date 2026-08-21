///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2020-2026 Jean-Philippe Steinmetz. All rights reserved.
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////

/** Returns `true` when the current process is running under the Bun runtime. */
export function isBunRuntime(): boolean {
    return typeof (globalThis as any).Bun !== "undefined";
}
