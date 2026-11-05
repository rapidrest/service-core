///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2020-2026 Jean-Philippe Steinmetz. All rights reserved.
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
// A route that streams a response and then fails: the error can no longer be reported through the status line, and
// ending the body normally (with the error JSON as a last chunk) would hand the client a truncated payload that looks
// complete. `Server.handleError()` must abort the transfer instead. Runs against a real server and a real HTTP client.
import * as http from "http";
import { default as config } from "./config";
import { ApiError, ApiErrors, BulkError, ObjectFactory, Server } from "../src";
import { MongoMemoryServer } from "mongodb-memory-server";
import { ClassLoader, Logger } from "@rapidrest/core";
import { Get, Route, Response } from "../src/decorators/RouteDecorators";

const mongod: MongoMemoryServer = new MongoMemoryServer({
    instance: {
        port: 9999,
        dbName: "mongomemory-rrst-test",
    },
});
vi.setConfig({ testTimeout: 30000 });

const FIRST = "A".repeat(1024);
const SECOND = "B".repeat(1024);
const tick = () => new Promise((resolve) => setTimeout(resolve, 20));

/** What the abort listener of the first route saw, for the tests to inspect. */
const seen: { aborts: number } = { aborts: 0 };

@Route("/stream")
class StreamRoute {
    /** Streams two chunks, then fails with a plain error. */
    @Get("/plain")
    public async plain(@Response res: any): Promise<void> {
        res.onAbort(() => seen.aborts++);
        res.status(200).setHeader("content-type", "application/octet-stream");
        res.write(FIRST);
        await tick();
        res.write(SECOND);
        await tick();
        throw new Error("the disk read failed at 4 MB");
    }

    /** Streams one chunk, then fails with an `ApiError` (which would normally choose its own status). */
    @Get("/api-error")
    public async apiError(@Response res: any): Promise<void> {
        res.status(200).setHeader("content-type", "application/octet-stream");
        res.write(FIRST);
        await tick();
        throw new ApiError(ApiErrors.NOT_FOUND, 404, "the rest of the file is gone");
    }

    /** Streams one chunk, then fails with a `BulkError`. */
    @Get("/bulk")
    public async bulk(@Response res: any): Promise<void> {
        res.status(200).setHeader("content-type", "application/octet-stream");
        res.write(FIRST);
        await tick();
        throw new BulkError([new Error("one"), null], ApiErrors.BULK_CREATE_FAILURE, 400);
    }

    /** Streams one chunk, then throws a string. */
    @Get("/string")
    public async thrownString(@Response res: any): Promise<void> {
        res.status(200).setHeader("content-type", "application/octet-stream");
        res.write(FIRST);
        await tick();
        // eslint-disable-next-line no-throw-literal -- handleError() must cope with a thrown string
        throw "something went wrong";
    }

    /** Fails before a single byte was written. */
    @Get("/early")
    public async early(): Promise<void> {
        throw new Error("could not open the file");
    }

    /** Streams everything and ends normally. */
    @Get("/ok")
    public async ok(@Response res: any): Promise<void> {
        res.status(200).setHeader("content-type", "application/octet-stream");
        res.write(FIRST);
        await tick();
        res.end(SECOND);
    }
}

interface Outcome {
    status: number;
    body: string;
    complete: boolean;
    failed: boolean;
}

describe("Server aborts a response that fails after it started streaming", () => {
    const classLoader: ClassLoader = new ClassLoader("./test/server", true, true, config.get("class_loader:ignore"));
    const objectFactory: ObjectFactory = new ObjectFactory(config, Logger());
    const server: Server = new Server({ config, basePath: "./test/server", classLoader, objectFactory });

    beforeAll(async () => {
        classLoader.getClasses().set("routes.StreamRoute", StreamRoute);
        await mongod.start();
        await server.start();
    });

    afterAll(async () => {
        await server.stop();
        await objectFactory.destroy();
        await mongod.stop();
    });

    /** Issues a GET with Node's own HTTP client and reports how the transfer ended. */
    const get = (path: string) =>
        new Promise<Outcome>((resolve) => {
            let responded = false;
            const req = http.get({ host: "127.0.0.1", port: server.port, path }, (res) => {
                responded = true;
                let body = "";
                let failed = false;
                res.on("data", (chunk) => (body += chunk.toString()));
                res.on("aborted", () => (failed = true));
                res.on("error", () => (failed = true));
                res.on("close", () => resolve({ status: res.statusCode ?? 0, body, complete: res.complete, failed }));
            });
            // Also raised for a response that failed part way, which is reported through the response instead.
            req.on("error", () => !responded && resolve({ status: 0, body: "", complete: false, failed: true }));
        });

    it("cuts the transfer when a route throws after writing, so the client sees a failure and no error JSON", async () => {
        seen.aborts = 0;
        const result = await get("/stream/plain");
        expect(result.status).toBe(200);
        expect(result.complete).toBe(false);
        expect(result.failed).toBe(true);
        // Exactly what was written before the failure, with nothing appended.
        expect(result.body).toBe(FIRST + SECOND);
        expect(result.body).not.toContain("message");
        expect(result.body).not.toContain("500");
        await vi.waitFor(() => expect(seen.aborts).toBe(1));
    });

    it("does the same for an ApiError, which no longer gets to pick a status", async () => {
        const result = await get("/stream/api-error");
        expect(result.status).toBe(200);
        expect(result.complete).toBe(false);
        expect(result.failed).toBe(true);
        expect(result.body).toBe(FIRST);
    });

    it("does the same for a BulkError", async () => {
        const result = await get("/stream/bulk");
        expect(result.status).toBe(200);
        expect(result.complete).toBe(false);
        expect(result.failed).toBe(true);
        expect(result.body).toBe(FIRST);
    });

    it("does the same for a thrown string", async () => {
        const result = await get("/stream/string");
        expect(result.status).toBe(200);
        expect(result.complete).toBe(false);
        expect(result.failed).toBe(true);
        expect(result.body).toBe(FIRST);
    });

    it("still answers a failure before the first write with a normal 500 and its JSON", async () => {
        const result = await get("/stream/early");
        expect(result.status).toBe(500);
        expect(result.complete).toBe(true);
        expect(result.failed).toBe(false);
        expect(JSON.parse(result.body)).toMatchObject({ status: 500 });
    });

    it("leaves a stream that completes alone", async () => {
        const result = await get("/stream/ok");
        expect(result.status).toBe(200);
        expect(result.complete).toBe(true);
        expect(result.failed).toBe(false);
        expect(result.body).toBe(FIRST + SECOND);
    });
});
