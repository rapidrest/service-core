///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2020-2026 Jean-Philippe Steinmetz. All rights reserved.
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
import { createWebSocketStream, UWSWebSocketShim } from "../../../src/http/uWS/WebSocket";

function makeFakeWs(overrides: Partial<{ send: any; end: any }> = {}) {
    return {
        send: vi.fn().mockReturnValue(1),
        end: vi.fn(),
        ...overrides,
    };
}

describe("UWSWebSocketShim Tests", () => {
    describe("send", () => {
        it("sends string data as text (isBinary=false) and invokes cb with no error on success", () => {
            const ws = makeFakeWs();
            const shim = new UWSWebSocketShim(ws as any);
            const cb = vi.fn();
            shim.send("hello", cb);
            expect(ws.send).toHaveBeenCalledWith("hello", false);
            expect(cb).toHaveBeenCalledWith(undefined);
        });

        it("sends non-string data as a binary Buffer (isBinary=true)", () => {
            const ws = makeFakeWs();
            const shim = new UWSWebSocketShim(ws as any);
            shim.send(new Uint8Array([1, 2, 3]));
            expect(ws.send).toHaveBeenCalledWith(Buffer.from(new Uint8Array([1, 2, 3])), true);
        });

        it("invokes cb with an error only when uWS reports the message as dropped (2)", () => {
            const ws = makeFakeWs({ send: vi.fn().mockReturnValue(2) });
            const shim = new UWSWebSocketShim(ws as any);
            const cb = vi.fn();
            shim.send("hello", cb);
            expect(cb).toHaveBeenCalledWith(expect.any(Error));
        });

        it("does not report an error when uWS queued the message under backpressure (0)", () => {
            const ws = makeFakeWs({ send: vi.fn().mockReturnValue(0) });
            const shim = new UWSWebSocketShim(ws as any);
            const cb = vi.fn();
            shim.send("hello", cb);
            expect(cb).toHaveBeenCalledWith(undefined);
        });

        it("does not throw when no cb is provided and send succeeds", () => {
            const ws = makeFakeWs();
            const shim = new UWSWebSocketShim(ws as any);
            expect(() => shim.send("hello")).not.toThrow();
        });

        it("invokes cb with the thrown error when the underlying send throws", () => {
            const err = new Error("boom");
            const ws = makeFakeWs({
                send: vi.fn(() => {
                    throw err;
                }),
            });
            const shim = new UWSWebSocketShim(ws as any);
            const cb = vi.fn();
            shim.send("hello", cb);
            expect(cb).toHaveBeenCalledWith(err);
        });

        it("does not throw when send throws and no cb is provided", () => {
            const ws = makeFakeWs({
                send: vi.fn(() => {
                    throw new Error("boom");
                }),
            });
            const shim = new UWSWebSocketShim(ws as any);
            expect(() => shim.send("hello")).not.toThrow();
        });
    });

    describe("close", () => {
        it("delegates to the underlying ws.end with code and reason", () => {
            const ws = makeFakeWs();
            const shim = new UWSWebSocketShim(ws as any);
            shim.close(1000, "bye");
            expect(ws.end).toHaveBeenCalledWith(1000, "bye");
        });

        it("swallows errors thrown by ws.end", () => {
            const ws = makeFakeWs({
                end: vi.fn(() => {
                    throw new Error("already closed");
                }),
            });
            const shim = new UWSWebSocketShim(ws as any);
            expect(() => shim.close()).not.toThrow();
        });
    });
});

describe("createWebSocketStream Tests", () => {
    it("forwards writes to shim.send and invokes the write callback", async () => {
        const ws = makeFakeWs();
        const shim = new UWSWebSocketShim(ws as any);
        const duplex = createWebSocketStream(shim);
        const writeCb = vi.fn();

        await new Promise<void>((resolve) => {
            duplex.write("payload", () => {
                writeCb();
                resolve();
            });
        });

        // Duplex streams decode string writes into Buffers by default before handing them to `write()`.
        expect(ws.send).toHaveBeenCalledWith(Buffer.from("payload"), true);
        expect(writeCb).toHaveBeenCalled();
    });

    it("pushes incoming shim 'message' events as readable data", async () => {
        const ws = makeFakeWs();
        const shim = new UWSWebSocketShim(ws as any);
        const duplex = createWebSocketStream(shim);

        const received: any[] = await new Promise((resolve) => {
            const chunks: any[] = [];
            duplex.on("data", (chunk) => chunks.push(chunk));
            shim.emit("message", Buffer.from("hi"));
            setImmediate(() => resolve(chunks));
        });

        expect(received.length).toBe(1);
        expect(received[0].toString()).toBe("hi");
    });

    it("ends and destroys the duplex when the shim emits 'close'", async () => {
        const ws = makeFakeWs();
        const shim = new UWSWebSocketShim(ws as any);
        const duplex = createWebSocketStream(shim);

        const ended = new Promise<void>((resolve) => duplex.on("close", resolve));
        shim.emit("close");
        await ended;

        expect(duplex.destroyed).toBe(true);
    });

    it("closes the shim's underlying connection when the duplex is closed", async () => {
        const ws = makeFakeWs();
        const shim = new UWSWebSocketShim(ws as any);
        const duplex = createWebSocketStream(shim);

        const closed = new Promise<void>((resolve) => duplex.on("close", resolve));
        duplex.destroy();
        await closed;

        expect(ws.end).toHaveBeenCalledWith(1000, undefined);
    });

    it("calls shim.close(1000) when the writable side is finalized", () => {
        const ws = makeFakeWs();
        const shim = new UWSWebSocketShim(ws as any);
        const duplex = createWebSocketStream(shim);

        duplex.end();

        expect(ws.end).toHaveBeenCalledWith(1000, undefined);
    });
});

describe("UWSWebSocketShim send backpressure", () => {
    function make(buffered: { value: number }, sendStatus = 1) {
        const ws = {
            ...makeFakeWs({ send: vi.fn().mockReturnValue(sendStatus) }),
            getBufferedAmount: () => buffered.value,
        };
        return { ws, shim: new UWSWebSocketShim(ws as any) };
    }

    it("reports bufferedAmount from uWS, and 0 when the socket is gone", () => {
        const { shim } = make({ value: 123 });
        expect(shim.bufferedAmount).toBe(123);
        const gone = new UWSWebSocketShim({
            getBufferedAmount: () => {
                throw new Error("Invalid access of closed uWS.WebSocket");
            },
        } as any);
        expect(gone.bufferedAmount).toBe(0);
    });

    it("waitForDrain() resolves true at once when nothing is queued", async () => {
        const { shim } = make({ value: 0 });
        shim.send("a");
        expect(shim.writableNeedDrain).toBe(false);
        await expect(shim.waitForDrain()).resolves.toBe(true);
    });

    it.each([0, 2])("flags writableNeedDrain after a send that returned %s, until drain", async (status) => {
        const buffered = { value: 500 };
        const { shim } = make(buffered, status);
        const drained = vi.fn();
        shim.onDrain(drained);
        shim.send("a");
        expect(shim.writableNeedDrain).toBe(true);
        const waiting = shim.waitForDrain();
        // A drain event while data is still queued does not release anyone.
        shim.notifyDrain();
        expect(shim.writableNeedDrain).toBe(true);
        expect(drained).not.toHaveBeenCalled();
        buffered.value = 0;
        shim.notifyDrain();
        await expect(waiting).resolves.toBe(true);
        expect(shim.writableNeedDrain).toBe(false);
        expect(drained).toHaveBeenCalledTimes(1);
        // A drain with nobody waiting fires nothing.
        shim.notifyDrain();
        expect(drained).toHaveBeenCalledTimes(1);
    });

    it("waits when data is queued even without a flagged send, and releases on drain", async () => {
        const buffered = { value: 10 };
        const { shim } = make(buffered);
        const waiting = shim.waitForDrain();
        buffered.value = 0;
        shim.notifyDrain();
        await expect(waiting).resolves.toBe(true);
    });

    it("resolves pending and later waiters false once the socket closes, and never fires onDrain", async () => {
        const { shim } = make({ value: 10 }, 0);
        const drained = vi.fn();
        shim.onDrain(drained);
        shim.send("a");
        const waiting = shim.waitForDrain();
        shim.notifyClosed();
        await expect(waiting).resolves.toBe(false);
        await expect(shim.waitForDrain()).resolves.toBe(false);
        shim.send("b");
        expect(shim.writableNeedDrain).toBe(false);
        shim.notifyDrain();
        expect(drained).not.toHaveBeenCalled();
    });
});
