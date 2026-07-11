///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2020-2026 Jean-Philippe Steinmetz
///////////////////////////////////////////////////////////////////////////////
import { Get, Request, Response } from "../decorators/RouteDecorators.js";
import { Summary } from "../decorators/DocDecorators.js";
import { HttpRequest, HttpResponse } from "../http/types.js";
import * as fs from "fs";
import * as path from "path";
import { ObjectDecorators } from "@rapidrest/core";
const { Config, Init } = ObjectDecorators;

/** MIME types for static file serving. */
const MIME_TYPES: Record<string, string> = {
    ".html": "text/html",
    ".css": "text/css",
    ".js": "application/javascript",
    ".mjs": "application/javascript",
    ".json": "application/json",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
    ".ttf": "font/ttf",
    ".txt": "text/plain",
    ".map": "application/json",
};

/**
 * The `BaseStaticRoute` class provides a single endpoint for serving static files from a designated path on the filesystem (e.g. `./public`).
 * Uses the path specified in the project configuration key `static_files`. Default is `public`.
 *
 * Exposed endpoints:
 *
 * | Name | HTTP Method | What it does |
 * | --- | --- | --- |
 * | `get` | `GET /<base_path>/*` | Serves static files from the configured `static_files`. |
 *
 * !!Note!! that the `BaseStaticRoute` is not automatically registered with a server by default. You must create
 * your own class that extends `AdminRoute` and apply the desired base path with `@Route()`.
 *
 * @example
 * ```ts
 * import { BaseStaticRoute, RouteDecorators } from "@rapidrest/service-core";
 * const { Route } = RouteDecorators;
 *
 * @Route("/static")
 * export class StaticRoute extends BaseStaticRoute {}
 * ```
 *
 * @author Jean-Philippe Steinmetz
 */
@Summary("Serves static files from the filesystem.")
export class BaseStaticRoute {
    /**
     * The URL prefix derived from `@Route` metadata at init time.
     * E.g. `@Route("/app/*")` → prefix = "/app". Used to strip the prefix from req.path
     * before resolving app page files, and to scope the dev-reload SSE endpoint.
     */
    protected routePrefix: string = "";

    /** The location of the static files to serve. Defaults to `./public`. */
    @Config("static_files", "public")
    protected readonly staticDir: string = "public";

    @Init
    protected async init() {
        // Derive the route prefix from @Route metadata so page resolution is prefix-agnostic.
        // @Route("/app/*") → prefix "/app", @Route("/*") → prefix ""
        const routePaths: string[] = Reflect.getMetadata("rrst:routePaths", Object.getPrototypeOf(this)) || [];
        this.routePrefix = (routePaths[0] || "")
            .replace(/\/\*$/, "") // strip trailing /*
            .replace(/\/$/, ""); // strip trailing /
    }

    /**
     * Resolve a file in the static directory by trying multiple extensions in order.
     * If the path segment ends in a `/`, `index.html` is automatically appended.
     *
     * @returns The full path to the file on disk if exists, otherwise `null`.
     */
    private resolveFile(segment: string): string | null {
        let file = path.resolve(process.cwd(), this.staticDir, segment.replace(/^\//, ""));
        if (file.endsWith("/")) {
            file += "index.html";
        }

        if (fs.existsSync(file)) {
            return file;
        }

        return null;
    }

    @Get("/*")
    public async get(@Request req: HttpRequest, @Response res: HttpResponse): Promise<any> {
        // Strip the route prefix (e.g. "/app" from "/app/pets" → "/pets") so the page
        // file resolution is independent of where the route is mounted.
        const subPath =
            this.routePrefix && req.path.startsWith(this.routePrefix)
                ? req.path.slice(this.routePrefix.length) || "/"
                : req.path;

        const requestedPath = subPath === "/" ? "index.html" : subPath.replace(/^\/+/, "");
        const filePath = this.resolveFile(requestedPath);
        if (!filePath) {
            res.status(404).end();
            return;
        }

        try {
            const ext = path.extname(filePath);
            const data = await fs.promises.readFile(filePath);
            res.setHeader("content-type", MIME_TYPES[ext] || "application/octet-stream");
            res.end(data);
        } catch {
            res.status(404).end();
        }
    }
}
