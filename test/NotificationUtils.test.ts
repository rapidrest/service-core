///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2020-2026 Jean-Philippe Steinmetz. All rights reserved.
///////////////////////////////////////////////////////////////////////////////
import { NotificationUtils } from "../src/NotificationUtils";

describe("NotificationUtils Tests", () => {
    it("publishes to each uid when given an array", () => {
        const redis = { publish: vi.fn() };
        const utils = new NotificationUtils(redis as any);
        utils.sendMessage(["uid1", "uid2"], "type", "action", { a: 1 });
        expect(redis.publish).toHaveBeenCalledTimes(2);
        expect(redis.publish).toHaveBeenNthCalledWith(
            1,
            "uid1",
            JSON.stringify({ type: "type", action: "action", data: { a: 1 } })
        );
        expect(redis.publish).toHaveBeenNthCalledWith(
            2,
            "uid2",
            JSON.stringify({ type: "type", action: "action", data: { a: 1 } })
        );
    });

    it("publishes to a single uid when given a string", () => {
        const redis = { publish: vi.fn() };
        const utils = new NotificationUtils(redis as any);
        utils.sendMessage("uid1", "type", "action", { a: 1 });
        expect(redis.publish).toHaveBeenCalledWith(
            "uid1",
            JSON.stringify({ type: "type", action: "action", data: { a: 1 } })
        );
    });
});
