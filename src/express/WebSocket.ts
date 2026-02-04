///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2020-2026 Jean-Philippe Steinmetz
///////////////////////////////////////////////////////////////////////////////
import { ServerResponse } from "http";
import { Application, Request } from "express";
import WebSocket, { Server as WebSocketServer } from "ws";

/**
 * HTTP request type for handling WebSockets.
 */
export interface RequestWS extends Request {
    /**
     * The associated WebSocket connection with this request.
     */
    websocket: WebSocket | undefined;

    /**
     * Indicates if the request is a websocket request that has been handled.
     */
    wsHandled: boolean;
}

/**
 * Enables and registers WebSocket support to the given Expressjs application and WebSocket server.
 *
 * @param app The Expressjs application to add WebSocket support to.
 * @param wss The WebSocketServer server that will be configured for Express.
 */
export function addWebSocket(app: Application, wss: WebSocketServer): any {
    wss.on("connection", async (socket: WebSocket, request: RequestWS) => {
        // Set the socket onto the request so that the Express handler has access to it
        request.websocket = socket;
        // We add `.websocket` to the url to let Express know this is a websocket specific request. Any handlers
        // marked with the @WebSocket decorator will have registered their paths this way too.
        try {
            // Support websocket passing query params
            let queryIndex = request.url?.indexOf("?");
            if (queryIndex > 0 && /[\w/]+?[\w]+=.+/.test(request.url)) {
                // Handle / before ?
                let pathLength = queryIndex;
                if (request.url[queryIndex - 1] === "/") {
                    pathLength = queryIndex - 1;
                }
                request.url = `${request.url.slice(0, pathLength)}.websocket${request.url.slice(queryIndex)}`;
            } else {
                request.url += ".websocket";
            }
        } catch (err) {
            request.url += ".websocket";
        }

        const response: ServerResponse = new ServerResponse(request);
        // Shouldn't need to cast `response` as any here but for some reason compiler isn't liking it
        // despite the function declaration clearly accepting the `ServerResponse` type.
        app(request, response as any, (err: any) => {
            // If `wsHandled` is not set to true or an error was thrown then we did not handle the WebSocket request properly.
            // Close the connection and exit.
            if (err || !request.wsHandled) {
                socket.close();
            }
        });
    });

    // Add WebSocket server to app
    (app as any).wss = wss;

    return app;
}
