///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2020-2026 Jean-Philippe Steinmetz
///////////////////////////////////////////////////////////////////////////////
import { default as config } from "../config";
import { BaseStaticRoute, ObjectFactory, Server } from "../../src";
import { MongoMemoryServer } from "mongodb-memory-server";
import * as fs from "fs";
import * as path from "path";
import * as http from "http";

import { ClassLoader, Logger } from "@rapidrest/core";
import { Route } from "../../src/decorators/RouteDecorators";
import { request } from "../../src/test/request.js";

const mongod: MongoMemoryServer = new MongoMemoryServer({
    instance: {
        port: 9999,
        dbName: "mongomemory-rrst-test",
    },
});
vi.setConfig({ testTimeout: 30000 });

@Route("/static")
class StaticRoute extends BaseStaticRoute {}

/**
 * Issues a raw HTTP GET with the given literal request-line path. Used instead of the axios-based
 * `request()` helper for path-traversal checks because axios (like browsers) normalizes `..` segments
 * out of a URL before it's ever sent, which would silently defeat the point of the test — a raw,
 * non-normalizing client (e.g. curl) sends the literal bytes as-is.
 */
function rawGet(port: number, rawPath: string): Promise<{ status: number; body: string }> {
    return new Promise((resolve, reject) => {
        const req = http.request({ host: "localhost", port, path: rawPath, method: "GET" }, (res) => {
            let body = "";
            res.on("data", (chunk) => (body += chunk));
            res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
        });
        req.on("error", reject);
        req.end();
    });
}

describe("BaseStaticRoute Tests", () => {
    const basePath = "/static";
    const classLoader: ClassLoader = new ClassLoader("./test/server", true, true, config.get("class_loader:ignore"));
    const objectFactory: ObjectFactory = new ObjectFactory(config, Logger());
    const server: Server = new Server({ config, basePath: "./test/server", classLoader, objectFactory });

    beforeAll(async () => {
        config.set("static_files", "./test/static");

        // Register the test route class with the class loader
        classLoader.getClasses().set("routes.StaticRoute", StaticRoute);

        await mongod.start();
        await server.start();
    });

    afterAll(async () => {
        await server.stop();
        await objectFactory.destroy();
        await mongod.stop();
    });

    it("Returns a 404 for the base path without a trailing slash (the `/*` route requires it).", async () => {
        const result = await request(server).get(basePath);
        expect(result.status).toBe(404);
    });

    it("Serves the root index.html when requesting the base path with a trailing slash.", async () => {
        const result = await request(server).get(`${basePath}/`);
        expect(result.status).toBe(200);
        expect(result.type).toBe("text/html");
        expect(result.text).toContain("Home Page");
    });

    it("Serves a plain text file with the correct content type.", async () => {
        const result = await request(server).get(`${basePath}/hello.txt`);
        expect(result.status).toBe(200);
        expect(result.type).toBe("text/plain");
        expect(result.text).toBe(fs.readFileSync(path.resolve("./test/static/hello.txt"), "utf-8"));
    });

    it("Serves a CSS file with the correct content type.", async () => {
        const result = await request(server).get(`${basePath}/style.css`);
        expect(result.status).toBe(200);
        expect(result.type).toBe("text/css");
        expect(result.text).toContain("color: red");
    });

    it("Serves a JSON file with the correct content type.", async () => {
        const result = await request(server).get(`${basePath}/data.json`);
        expect(result.status).toBe(200);
        expect(result.type).toBe("application/json");
        expect(result.body).toEqual({ ok: true });
    });

    it("Serves a file nested in a subdirectory when requested directly.", async () => {
        const result = await request(server).get(`${basePath}/sub/page.html`);
        expect(result.status).toBe(200);
        expect(result.type).toBe("text/html");
        expect(result.text).toContain("Sub Page");
    });

    it("Serves an unrecognized extension as application/octet-stream.", async () => {
        const result = await request(server).get(`${basePath}/data.bin`);
        expect(result.status).toBe(200);
        expect(result.type).toBe("application/octet-stream");
    });

    it("Returns a 404 for a file that does not exist.", async () => {
        const result = await request(server).get(`${basePath}/does-not-exist.html`);
        expect(result.status).toBe(404);
    });

    it("Returns a 404 for a nested directory requested without an explicit file.", async () => {
        // resolveFile()'s trailing-slash → index.html logic never triggers in practice because
        // path.resolve() strips trailing slashes before the check runs, so this resolves to the
        // directory itself, which fails to read as a file.
        const result = await request(server).get(`${basePath}/sub/`);
        expect(result.status).toBe(404);
    });

    it("Does not require authentication to serve files.", async () => {
        const result = await request(server).get(`${basePath}/hello.txt`);
        expect(result.status).toBe(200);
    });

    it("Blocks path traversal outside of the configured static directory.", async () => {
        // A normalizing client (axios, browsers) collapses `..` before the request is ever sent, so this
        // has to go over a raw socket to prove the server itself rejects an escaping path.
        const result = await rawGet(server.port, `${basePath}/../outside-static.txt`);
        expect(result.status).toBe(404);
        expect(result.body).not.toContain("SHOULD_NOT_BE_ACCESSIBLE");
    });
});
