///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2020-2026 Jean-Philippe Steinmetz. All rights reserved.
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
vi.mock("redis", () => {
    throw new Error("Cannot find module 'redis'");
});

import { importRedis } from "../../src/database/ConnectionKinds";

describe("importRedis", () => {
    it("throws a helpful peer-dependency error when 'redis' can't be imported", async () => {
        await expect(importRedis()).rejects.toThrow(
            "This feature requires the optional peer dependency 'redis'. Install it with: yarn add redis",
        );
    });
});
