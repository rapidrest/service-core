///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2020-2026 Jean-Philippe Steinmetz. All rights reserved.
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
import { BunWebSocketShim, type WebSocketSendTarget } from "../../../src/http/bun/BunWebSocket";

function makeFakeTarget(overrides: Partial<{ send: any; close: any }> = {}): WebSocketSendTarget {
    return {
        send: vi.fn().mockReturnValue(1),
        close: vi.fn(),
        ...overrides,
    };
}

describe("BunWebSocketShim Tests", () => {
    describe("send", () => {
        it("sends string data as-is and invokes cb with no error on success", () => {
            const target = makeFakeTarget();
            const shim = new BunWebSocketShim(target);
            const cb = vi.fn();
            shim.send("hello", cb);
            expect(target.send).toHaveBeenCalledWith("hello");
            expect(cb).toHaveBeenCalledWith(undefined);
        });

        it("wraps non-string data in a Buffer before sending", () => {
            const target = makeFakeTarget();
            const shim = new BunWebSocketShim(target);
            shim.send(new Uint8Array([1, 2, 3]));
            expect(target.send).toHaveBeenCalledWith(Buffer.from(new Uint8Array([1, 2, 3])));
        });

        it("invokes cb with an error when send() returns 0 (dropped due to backpressure)", () => {
            const target = makeFakeTarget({ send: vi.fn().mockReturnValue(0) });
            const shim = new BunWebSocketShim(target);
            const cb = vi.fn();
            shim.send("hello", cb);
            expect(cb).toHaveBeenCalledWith(expect.any(Error));
        });

        it("treats a negative return value (queued, not dropped) as success", () => {
            const target = makeFakeTarget({ send: vi.fn().mockReturnValue(-5) });
            const shim = new BunWebSocketShim(target);
            const cb = vi.fn();
            shim.send("hello", cb);
            expect(cb).toHaveBeenCalledWith(undefined);
        });

        it("treats a positive return value as success", () => {
            const target = makeFakeTarget({ send: vi.fn().mockReturnValue(42) });
            const shim = new BunWebSocketShim(target);
            const cb = vi.fn();
            shim.send("hello", cb);
            expect(cb).toHaveBeenCalledWith(undefined);
        });

        it("does not throw when no cb is provided, regardless of the send result", () => {
            for (const result of [0, -1, 1]) {
                const target = makeFakeTarget({ send: vi.fn().mockReturnValue(result) });
                const shim = new BunWebSocketShim(target);
                expect(() => shim.send("hello")).not.toThrow();
            }
        });

        it("invokes cb with the thrown error when the underlying send throws", () => {
            const err = new Error("boom");
            const target = makeFakeTarget({
                send: vi.fn(() => {
                    throw err;
                }),
            });
            const shim = new BunWebSocketShim(target);
            const cb = vi.fn();
            shim.send("hello", cb);
            expect(cb).toHaveBeenCalledWith(err);
        });

        it("does not throw when send throws and no cb is provided", () => {
            const target = makeFakeTarget({
                send: vi.fn(() => {
                    throw new Error("boom");
                }),
            });
            const shim = new BunWebSocketShim(target);
            expect(() => shim.send("hello")).not.toThrow();
        });
    });

    describe("close", () => {
        it("delegates to the underlying target with the given code/reason", () => {
            const target = makeFakeTarget();
            const shim = new BunWebSocketShim(target);
            shim.close(1000, "bye");
            expect(target.close).toHaveBeenCalledWith(1000, "bye");
        });

        it("delegates with no args when none are given", () => {
            const target = makeFakeTarget();
            const shim = new BunWebSocketShim(target);
            shim.close();
            expect(target.close).toHaveBeenCalledWith(undefined, undefined);
        });

        it("swallows a throw from the underlying target's close()", () => {
            const target = makeFakeTarget({
                close: vi.fn(() => {
                    throw new Error("already closed");
                }),
            });
            const shim = new BunWebSocketShim(target);
            expect(() => shim.close()).not.toThrow();
        });
    });

    it("starts with readyState OPEN (1)", () => {
        const shim = new BunWebSocketShim(makeFakeTarget());
        expect(shim.readyState).toBe(1);
    });

    it("is a real EventEmitter", () => {
        const shim = new BunWebSocketShim(makeFakeTarget());
        const received: any[] = [];
        shim.on("custom", (payload: any) => received.push(payload));
        shim.emit("custom", { a: 1 });
        expect(received).toEqual([{ a: 1 }]);
    });
});
