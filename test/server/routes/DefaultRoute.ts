///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2020-2026 Jean-Philippe Steinmetz
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
import { Route, Get, Options, User, Auth, WebSocket, Socket, Query } from "../../../src/decorators/RouteDecorators";
import { ApiError, Logger, ObjectDecorators } from "@rapidrest/core";
import * as ws from "ws";
import { Description, Returns, Summary } from "../../../src/decorators/DocDecorators";
import { ApiErrors, ApiErrorMessages } from "../../../src/ApiErrors";
const { Init } = ObjectDecorators;

@Route("/")
@Description("Handles processing of all HTTP requests to the `/` path.")
class DefaultRoute {
    /**
     * Initializes a new instance with the specified defaults.
     */
    constructor() {
        // NO-OP
    }

    @Init
    private async initialize() {
        // NO-OP
    }

    @Summary("Request")
    @Get("hello")
    @Description("Returns `Hello World!`.")
    @Returns([Object])
    protected async helloWorld(): Promise<any> {
        return { msg: "Hello World!" };
    }

    @Summary("Request")
    @Auth(["jwt"])
    @Get("token")
    @Description("Returns the user data for a valid authenticated user.")
    @Returns([Object])
    protected async authToken(@User user?: any): Promise<any> {
        return user;
    }

    @Summary("Request")
    @Get("error")
    @Description("Throws a 400-level error and returns the error as the response body.")
    @Returns([null])
    protected async throwError(): Promise<any> {
        throw new ApiError(ApiErrors.INVALID_REQUEST, 400, "This is a test.");
    }

    @Summary("Request")
    @Get("error500")
    @Description("Throws a 500-level ApiError, to exercise the server's error-logging (not just error-handling) path.")
    @Returns([null])
    protected async throwError500(): Promise<any> {
        throw new ApiError(ApiErrors.INTERNAL_ERROR, 500, "This is a 500-level test.");
    }

    @Summary("Request")
    @Get("error-raw")
    @Description("Throws a raw (non-ApiError) Error, to exercise the server's ApiError-wrapping fallback.")
    @Returns([null])
    protected async throwErrorRaw(): Promise<any> {
        throw new Error("This is a raw error test.");
    }

    @Summary("Request")
    @Get("error-string")
    @Description("Throws a literal string, to exercise the server's string-error handling.")
    @Returns([null])
    protected async throwErrorString(): Promise<any> {
        // eslint-disable-next-line no-throw-literal -- deliberately testing a non-Error throw
        throw "This is a raw string error test.";
    }

    @Summary("Request")
    @Options("capabilities")
    @Description(
        "Returns a custom JSON body instead of the framework's default CORS-preflight 204 - proves an " +
            "app-registered OPTIONS route takes precedence over the blanket preflight response.",
    )
    @Returns([Object])
    protected async optionsCapabilities(): Promise<any> {
        return { capabilities: ["foo", "bar"] };
    }

    @Summary("Request")
    @WebSocket("connect")
    @Description("Establishes a socket connection that responds to all messages with `echo ${msg}`.")
    protected wsConnect(@Socket ws: ws, @User user?: any): void {
        ws.on("message", (msg) => {
            ws.send(`echo ${msg}`);
        });
        ws.send(`hello ${user && user.uid ? user.uid : "guest"}`);
    }

    @Summary("Request")
    @Auth(["jwt"])
    @WebSocket("connect-secure")
    @Description("Establishes a secured socket connection that responds to all messages with `echo ${msg}`.")
    protected wsConnectSecure(@Socket ws: ws, @User user?: any): void {
        if (user) {
            ws.on("message", (msg) => {
                ws.send(`echo ${msg}`);
            });
            ws.send(`hello ${user.uid}`);
        } else {
            throw new ApiError(ApiErrors.AUTH_REQUIRED, 401, ApiErrorMessages.AUTH_REQUIRED);
        }
    }

    @Summary("Request")
    @WebSocket("connect-query")
    @Description(
        "Establishes a socket connection that responds to all messages with the query message and message `echo ${message} ${msg}` or `echo ${msg}`.",
    )
    protected wsConnectQuery(@Query("message") message, @Socket ws: ws, @User user?: any): void {
        ws.on("message", (msg) => {
            ws.send(`echo ${message ? `${message} ` : ""}${msg}`);
        });
        ws.send(`hello ${user && user.uid ? user.uid : "guest"}`);
    }

    @Summary("Request")
    @Auth(["jwt"])
    @WebSocket("connect-strict", { loginFallback: false, authCloseCode: 4001, authCloseReason: "auth required" })
    @Description("A secured socket that refuses an unauthenticated upgrade at once with close code 4001.")
    protected wsConnectStrict(@Socket ws: ws, @User user?: any): void {
        ws.on("message", (msg) => {
            ws.send(`echo ${msg}`);
        });
        ws.send(`hello ${user.uid}`);
    }

    @Summary("Request")
    @Auth(["jwt"])
    @WebSocket("connect-code", { authCloseCode: 4001 })
    @Description("A secured socket that keeps the LOGIN fallback but closes with 4001 when auth fails.")
    protected wsConnectCode(@Socket ws: ws, @User user?: any): void {
        ws.send(`hello ${user.uid}`);
    }

    @Summary("Request")
    @WebSocket("connect-flood", { maxBackpressure: 32 * 1024 * 1024, maxPayloadLength: 1024 })
    @Description("On `flood` sends large frames until the socket reports buffered data, then waits for the drain.")
    protected wsConnectFlood(@Socket ws: any): void {
        ws.send("ready");
        ws.on("message", async (msg: any) => {
            if (msg.toString() !== "flood") return;
            const chunk = Buffer.alloc(256 * 1024, 1);
            const events: string[] = [];
            ws.onDrain(() => events.push("onDrain"));
            for (let i = 0; i < 400 && ws.bufferedAmount < 1024 * 1024; i++) {
                ws.send(chunk);
            }
            events.push(`buffered=${ws.bufferedAmount > 0} needDrain=${ws.writableNeedDrain}`);
            const drained = await ws.waitForDrain();
            events.push(`drained=${drained} buffered=${ws.bufferedAmount} needDrain=${ws.writableNeedDrain}`);
            ws.send(`status ${events.join(" ")}`);
        });
    }
}

export default DefaultRoute;
