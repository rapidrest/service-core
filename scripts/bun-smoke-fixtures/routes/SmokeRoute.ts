///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2020-2026 Jean-Philippe Steinmetz. All rights reserved.
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
import {
    Auth,
    Get,
    Param,
    Post,
    Request,
    Route,
    Socket,
    User,
    WebSocket,
} from "../../../src/decorators/RouteDecorators.js";
import type { IWebSocketShim } from "../../../src/http/IWebSocketShim.js";
import type { HttpRequest } from "../../../src/http/types.js";

/**
 * Minimal, database-free fixture route used by `scripts/bun-smoke-test.ts` to exercise the
 * Bun.serve()-backed HTTP adapter: `:param` matching, JSON body parsing, the 413 oversized-body
 * path, and both an open and an `@Auth`-protected WebSocket route (open/message/close roundtrip
 * plus the message-based LOGIN handshake).
 */
@Route("/")
class SmokeRoute {
    @Get("hello")
    protected async hello(): Promise<any> {
        return { msg: "Hello World!" };
    }

    @Get("echo/:id")
    protected async echoParam(@Param("id") id: string): Promise<any> {
        return { id };
    }

    @Post("echo")
    protected async echoBody(@Request req: HttpRequest): Promise<any> {
        return req.body;
    }

    @WebSocket("connect")
    protected wsConnect(@Socket socket: IWebSocketShim, @User user?: any): void {
        socket.on("message", (msg: any) => {
            socket.send(`echo ${msg}`);
        });
        socket.send(`hello ${user && user.uid ? user.uid : "guest"}`);
    }

    @Auth(["jwt"])
    @WebSocket("connect-secure")
    protected wsConnectSecure(@Socket socket: IWebSocketShim, @User user: any): void {
        socket.on("message", (msg: any) => {
            socket.send(`echo ${msg}`);
        });
        socket.send(`hello ${user.uid}`);
    }
}

export default SmokeRoute;
