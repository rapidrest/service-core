///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2020-2026 Jean-Philippe Steinmetz. All rights reserved.
///////////////////////////////////////////////////////////////////////////////
import { extractParamNames, makeWsStubResponse, runChain } from "../../src/http/MiddlewareChain";
import type { HttpRequest, HttpResponse, RequestHandler } from "../../src/http/types";

function makeReq(): HttpRequest {
    return { headers: {}, socket: {} } as HttpRequest;
}

function makeRes(): HttpResponse {
    let ended = false;
    const statusCalls: number[] = [];
    const jsonCalls: any[] = [];
    return {
        statusCode: 200,
        headersSent: false,
        get writableEnded() {
            return ended;
        },
        set writableEnded(v: boolean) {
            ended = v;
        },
        status(code: number) {
            statusCalls.push(code);
            return this;
        },
        setHeader() {
            return this;
        },
        appendHeader() {
            return this;
        },
        getHeader() {
            return undefined;
        },
        json(body: any) {
            jsonCalls.push(body);
            ended = true;
            return this;
        },
        send() {
            ended = true;
            return this;
        },
        end() {
            ended = true;
        },
        onFinish() {
            // no-op for these tests
        },
        // test hooks
        _statusCalls: statusCalls,
        _jsonCalls: jsonCalls,
    } as HttpResponse & { _statusCalls: number[]; _jsonCalls: any[] };
}

describe("runChain Tests", () => {
    it("runs sync handlers in sequence when each calls next() synchronously", async () => {
        const order: number[] = [];
        const handlers: RequestHandler[] = [
            (req, res, next) => {
                order.push(1);
                next();
            },
            (req, res, next) => {
                order.push(2);
                next();
            },
        ];
        await runChain(handlers, makeReq(), makeRes());
        expect(order).toEqual([1, 2]);
    });

    it("stops the chain when a sync handler ends the response without calling next()", async () => {
        const order: number[] = [];
        const res = makeRes();
        const handlers: RequestHandler[] = [
            (req, r, next) => {
                order.push(1);
                r.send();
            },
            (req, r, next) => {
                order.push(2);
                next();
            },
        ];
        await runChain(handlers, makeReq(), res);
        expect(order).toEqual([1]);
    });

    it("waits for next() called asynchronously from a sync handler", async () => {
        const order: number[] = [];
        const handlers: RequestHandler[] = [
            (req, res, next) => {
                order.push(1);
                setTimeout(() => next(), 0);
            },
            (req, res, next) => {
                order.push(2);
                next();
            },
        ];
        await runChain(handlers, makeReq(), makeRes());
        expect(order).toEqual([1, 2]);
    });

    it("awaits an async handler that calls next() after an await", async () => {
        const order: number[] = [];
        const handlers: RequestHandler[] = [
            async (req, res, next) => {
                order.push(1);
                await Promise.resolve();
                next();
            },
            (req, res, next) => {
                order.push(2);
                next();
            },
        ];
        await runChain(handlers, makeReq(), makeRes());
        expect(order).toEqual([1, 2]);
    });

    it("stops the chain when an async handler resolves without calling next()", async () => {
        const order: number[] = [];
        const res = makeRes();
        const handlers: RequestHandler[] = [
            async (req, r, next) => {
                order.push(1);
                r.send();
                await Promise.resolve();
            },
            (req, r, next) => {
                order.push(2);
                next();
            },
        ];
        await runChain(handlers, makeReq(), res);
        expect(order).toEqual([1]);
    });

    it("does not double-resolve when next() is called synchronously before an async handler's promise settles", async () => {
        const order: number[] = [];
        const handlers: RequestHandler[] = [
            async (req, res, next) => {
                next();
                order.push(1);
                return Promise.resolve();
            },
            (req, res, next) => {
                order.push(2);
                next();
            },
        ];
        await runChain(handlers, makeReq(), makeRes());
        expect(order).toEqual([1, 2]);
    });

    it("routes to an error handler when a sync handler throws", async () => {
        const seen: any[] = [];
        const handlers: RequestHandler[] = [
            () => {
                throw new Error("sync boom");
            },
            (req, res, next) => {
                // normal handler must be skipped while an error is pending
                seen.push("normal-skipped-check");
                next();
            },
            ((err: any, req: any, res: any, next: any) => {
                seen.push(err.message);
                next();
            }) as any,
        ];
        await runChain(handlers, makeReq(), makeRes());
        expect(seen).toEqual(["sync boom"]);
    });

    it("routes to an error handler when an async handler rejects", async () => {
        const seen: any[] = [];
        const handlers: RequestHandler[] = [
            async () => {
                throw new Error("async boom");
            },
            ((err: any, req: any, res: any, next: any) => {
                seen.push(err.message);
                next();
            }) as any,
        ];
        await runChain(handlers, makeReq(), makeRes());
        expect(seen).toEqual(["async boom"]);
    });

    it("skips error handlers when there is no pending error", async () => {
        const seen: string[] = [];
        const handlers: RequestHandler[] = [
            (req, res, next) => {
                seen.push("normal");
                next();
            },
            ((_err: any, req: any, res: any, next: any) => {
                seen.push("error-handler");
                next();
            }) as any,
        ];
        await runChain(handlers, makeReq(), makeRes());
        expect(seen).toEqual(["normal"]);
    });

    it("propagates a new error when an error handler calls next(err)", async () => {
        const seen: string[] = [];
        const handlers: RequestHandler[] = [
            () => {
                throw new Error("first");
            },
            ((err: any, req: any, res: any, next: any) => {
                seen.push(err.message);
                next(new Error("second"));
            }) as any,
            ((err: any, req: any, res: any, next: any) => {
                seen.push(err.message);
                next();
            }) as any,
        ];
        await runChain(handlers, makeReq(), makeRes());
        expect(seen).toEqual(["first", "second"]);
    });

    it("clears the error when an error handler calls next() with no argument", async () => {
        const seen: string[] = [];
        const handlers: RequestHandler[] = [
            () => {
                throw new Error("first");
            },
            ((err: any, req: any, res: any, next: any) => {
                seen.push(err.message);
                next();
            }) as any,
            (req, res, next) => {
                seen.push("normal-runs-again");
                next();
            },
        ];
        await runChain(handlers, makeReq(), makeRes());
        expect(seen).toEqual(["first", "normal-runs-again"]);
    });

    it("sends a 500 response for an unhandled error at the end of the chain", async () => {
        const res: any = makeRes();
        const handlers: RequestHandler[] = [
            () => {
                throw new Error("unhandled");
            },
        ];
        await runChain(handlers, makeReq(), res);
        expect(res._statusCalls).toEqual([500]);
        expect(res._jsonCalls[0]).toEqual({ message: "unhandled", status: 500 });
    });

    it("falls back to a generic message when the unhandled error has none", async () => {
        const res: any = makeRes();
        const handlers: RequestHandler[] = [
            () => {
                // eslint-disable-next-line no-throw-literal
                throw { notAnError: true };
            },
        ];
        await runChain(handlers, makeReq(), res);
        expect(res._jsonCalls[0]).toEqual({ message: "Internal Server Error", status: 500 });
    });

    it("does not send a 500 response if the response was already ended", async () => {
        const res: any = makeRes();
        const handlers: RequestHandler[] = [
            (req, r, next) => {
                r.send();
                next(new Error("too late"));
            },
        ];
        await runChain(handlers, makeReq(), res);
        expect(res._statusCalls).toEqual([]);
    });
});

describe("runChain double-settle guards", () => {
    it("ignores a second call to next() from the same handler", async () => {
        const order: number[] = [];
        const handlers: RequestHandler[] = [
            (req, res, next) => {
                next();
                next(); // second call must be a no-op
                order.push(1);
            },
            (req, res, next) => {
                order.push(2);
                next();
            },
        ];
        await runChain(handlers, makeReq(), makeRes());
        expect(order).toEqual([1, 2]);
    });

    it("ignores an async rejection after next() was already called synchronously", async () => {
        const order: number[] = [];
        const handlers: RequestHandler[] = [
            async (req, res, next) => {
                next();
                order.push(1);
                throw new Error("too late to matter");
            },
            (req, res, next) => {
                order.push(2);
                next();
            },
        ];
        await runChain(handlers, makeReq(), makeRes());
        expect(order).toEqual([1, 2]);
    });

    it("ignores a synchronous throw after next() was already called", async () => {
        const order: number[] = [];
        const handlers: RequestHandler[] = [
            (req, res, next) => {
                next();
                order.push(1);
                throw new Error("too late to matter");
            },
            (req, res, next) => {
                order.push(2);
                next();
            },
        ];
        await runChain(handlers, makeReq(), makeRes());
        expect(order).toEqual([1, 2]);
    });
});

describe("extractParamNames Tests", () => {
    it("extracts multiple param names", () => {
        expect(extractParamNames("/users/:uid/:version")).toEqual(["uid", "version"]);
    });

    it("returns an empty array when there are no params", () => {
        expect(extractParamNames("/users")).toEqual([]);
    });

    it("handles a single param", () => {
        expect(extractParamNames("/users/:id")).toEqual(["id"]);
    });
});

describe("makeWsStubResponse Tests", () => {
    it("tracks writableEnded and statusCode defaults", () => {
        const res = makeWsStubResponse();
        expect(res.statusCode).toBe(101);
        expect(res.headersSent).toBe(true);
        expect(res.writableEnded).toBe(false);
    });

    it("status/setHeader/json/send are chainable/no-op", () => {
        const res = makeWsStubResponse();
        expect(res.status(200)).toBe(res);
        expect(res.setHeader("x", "y")).toBe(res);
        expect(res.getHeader("x")).toBeUndefined();
        expect(res.json({})).toBeUndefined();
        expect(res.send("data")).toBeUndefined();
    });

    it("sets writableEnded and fires onFinish handlers when end() is called", async () => {
        const res = makeWsStubResponse();
        let called = false;
        res.onFinish(() => {
            called = true;
        });
        res.end();
        expect(res.writableEnded).toBe(true);
        await new Promise((resolve) => setImmediate(resolve));
        expect(called).toBe(true);
    });

    it("invokes onFinish handlers registered after end() has already fired", async () => {
        const res = makeWsStubResponse();
        res.end();
        let called = false;
        res.onFinish(() => {
            called = true;
        });
        await new Promise((resolve) => setImmediate(resolve));
        expect(called).toBe(true);
    });

    it("swallows errors thrown by finish handlers", async () => {
        const res = makeWsStubResponse();
        res.onFinish(() => {
            throw new Error("boom");
        });
        expect(() => res.end()).not.toThrow();
        await new Promise((resolve) => setImmediate(resolve));
    });

    it("does not fire finish handlers twice when end() is called multiple times", async () => {
        const res = makeWsStubResponse();
        let count = 0;
        res.onFinish(() => {
            count++;
        });
        res.end();
        res.end();
        await new Promise((resolve) => setImmediate(resolve));
        expect(count).toBe(1);
    });
});
