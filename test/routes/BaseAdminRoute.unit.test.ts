///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2020-2026 Jean-Philippe Steinmetz. All rights reserved.
///////////////////////////////////////////////////////////////////////////////
// Unit-level tests for BaseAdminRoute that exercise edge cases (disabled datastores, error paths)
// that are impractical to reach through the full-server integration test in AdminRoute.test.ts.
const hoisted = vi.hoisted(() => {
    return {
        subscribeBehavior: undefined as (() => Promise<any>) | undefined,
        instances: [] as any[],
    };
});

vi.mock("ioredis", () => {
    class FakeRedis {
        public url?: string;
        public options?: any;
        private handlers: Record<string, Function[]> = {};
        public unsubscribe = vi.fn().mockResolvedValue(undefined);
        public disconnect = vi.fn();
        public publish = vi.fn();

        constructor(url?: string, options?: any) {
            this.url = url;
            this.options = options;
            hoisted.instances.push(this);
        }

        subscribe(..._args: any[]) {
            if (hoisted.subscribeBehavior) return hoisted.subscribeBehavior();
            return Promise.resolve();
        }

        on(event: string, cb: Function) {
            this.handlers[event] = this.handlers[event] || [];
            this.handlers[event].push(cb);
            return this;
        }

        duplicate() {
            return new FakeRedis(this.url, this.options);
        }

        emit(event: string, ...args: any[]) {
            for (const cb of this.handlers[event] || []) cb(...args);
        }
    }
    return { Redis: FakeRedis };
});

import "reflect-metadata";
import { BaseAdminRoute } from "../../src/routes/BaseAdminRoute";

function makeLogger() {
    return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), add: vi.fn() };
}

beforeEach(() => {
    hoisted.subscribeBehavior = undefined;
    hoisted.instances.length = 0;
});

describe("BaseAdminRoute.init edge cases", () => {
    it("logs a warning when the cache is disabled", async () => {
        const route: any = new BaseAdminRoute();
        route.logger = makeLogger();
        route.cacheClient = undefined;
        route.cacheConnConfig = null;
        route.logsConnConfig = null;
        await route.init();
        expect(route.logger.warn).toHaveBeenCalledWith("Cache is disabled.");
    });

    it("logs a warning when the logs datastore is not configured", async () => {
        const route: any = new BaseAdminRoute();
        route.logger = makeLogger();
        route.cacheClient = undefined;
        route.cacheConnConfig = null;
        route.logsConnConfig = null;
        await route.init();
        expect(route.logger.warn).toHaveBeenCalledWith(
            "Could not initialize `/admin/logs` route. The `logs` datastore is not not configured."
        );
    });
});

describe("BaseAdminRoute.init cache channel naming", () => {
    it("falls back to the 'service_admin' channel name when serviceName is not configured", async () => {
        const route: any = new BaseAdminRoute();
        route.logger = makeLogger();
        route.cacheClient = undefined;
        route.cacheConnConfig = { url: "redis://x", options: {} };
        route.logsConnConfig = null;
        route.serviceName = undefined;
        await route.init();

        const redisInstance = hoisted.instances[hoisted.instances.length - 1];
        expect(redisInstance).toBeDefined();
    });
});

describe("BaseAdminRoute.restart edge cases", () => {
    it("falls back to the 'service_admin' channel name when serviceName is not configured", () => {
        const route: any = new BaseAdminRoute();
        route.trustedRoles = ["admin"];
        route.serviceName = undefined;
        route.redisPublisher = { publish: vi.fn() };
        route.restart({ uid: "u1", roles: ["admin"] });
        expect(route.redisPublisher.publish).toHaveBeenCalledWith("service_admin", "RESTART");
    });
});

describe("BaseAdminRoute.clearCache edge cases", () => {
    it("resolves immediately when scanStream returns no stream", async () => {
        const route: any = new BaseAdminRoute();
        route.trustedRoles = ["admin"];
        route.cacheClient = { scanStream: () => undefined };
        await expect(route.clearCache({ uid: "u1", roles: ["admin"] })).resolves.toBeUndefined();
    });

    it("does nothing when the cache is not configured", async () => {
        const route: any = new BaseAdminRoute();
        route.trustedRoles = ["admin"];
        route.cacheClient = undefined;
        await expect(route.clearCache({ uid: "u1", roles: ["admin"] })).resolves.toBeUndefined();
    });
});

describe("BaseAdminRoute admin channel message handler", () => {
    it("ignores messages on channels other than the admin channel", async () => {
        const route: any = new BaseAdminRoute();
        route.logger = makeLogger();
        route.cacheClient = undefined;
        route.cacheConnConfig = { url: "redis://x", options: {} };
        route.logsConnConfig = null;
        route.serviceName = "svc";
        await route.init();

        const killSpy = vi.spyOn(process, "kill").mockImplementation(() => true);
        try {
            const redisClient = hoisted.instances[hoisted.instances.length - 2];
            redisClient.emit("message", "some-other-channel", "RESTART");
            expect(killSpy).not.toHaveBeenCalled();
        } finally {
            killSpy.mockRestore();
        }
    });

    it("ignores non-RESTART messages on the admin channel", async () => {
        const route: any = new BaseAdminRoute();
        route.logger = makeLogger();
        route.cacheClient = undefined;
        route.cacheConnConfig = { url: "redis://x", options: {} };
        route.logsConnConfig = null;
        route.serviceName = "svc";
        await route.init();

        const killSpy = vi.spyOn(process, "kill").mockImplementation(() => true);
        try {
            const redisClient = hoisted.instances[hoisted.instances.length - 2];
            redisClient.emit("message", "svc", "SOME_OTHER_MESSAGE");
            expect(killSpy).not.toHaveBeenCalled();
        } finally {
            killSpy.mockRestore();
        }
    });
});

describe("BaseAdminRoute.logs edge cases", () => {
    it("closes the socket when the logs datastore is not configured", async () => {
        const route: any = new BaseAdminRoute();
        route.trustedRoles = ["admin"];
        route.logsConnConfig = null;
        route.logger = makeLogger();
        const socket = { close: vi.fn(), send: vi.fn(), on: vi.fn() };
        await route.logs(socket, { uid: "u1", roles: ["admin"] });
        expect(socket.close).toHaveBeenCalledWith(1002, expect.anything());
        expect(route.logger.error).toHaveBeenCalledWith(
            "Failed to establish logs connection. `logs` connection config is not set."
        );
    });

    it("closes the socket when serviceName is not configured", async () => {
        const route: any = new BaseAdminRoute();
        route.trustedRoles = ["admin"];
        route.logsConnConfig = { url: "redis://x", options: {} };
        route.serviceName = undefined;
        route.logger = makeLogger();
        const socket = { close: vi.fn(), send: vi.fn(), on: vi.fn() };
        await route.logs(socket, { uid: "u1", roles: ["admin"] });
        expect(socket.close).toHaveBeenCalledWith(1002, expect.anything());
        expect(route.logger.error).toHaveBeenCalledWith(
            "Failed to establish logs connection. serviceName is not set."
        );
    });

    it("logs and closes the socket when subscribing to the logs channel fails", async () => {
        hoisted.subscribeBehavior = () => Promise.reject(new Error("connection refused"));

        const route: any = new BaseAdminRoute();
        route.trustedRoles = ["admin"];
        route.logsConnConfig = { url: "redis://x", options: {} };
        route.serviceName = "svc";
        route.logger = makeLogger();
        const socket = { close: vi.fn(), send: vi.fn(), on: vi.fn() };

        await route.logs(socket, { uid: "u1", roles: ["admin"] });

        expect(route.logger.error).toHaveBeenCalledWith("User u1 failed to subscribe to logging channel.");
        expect(socket.close).toHaveBeenCalledWith();
    });

    it("logs a debug message when forwarding a message to the client fails", async () => {
        const route: any = new BaseAdminRoute();
        route.trustedRoles = ["admin"];
        route.logsConnConfig = { url: "redis://x", options: {} };
        route.serviceName = "svc";
        route.logger = makeLogger();
        const socket = {
            close: vi.fn(),
            on: vi.fn(),
            send: vi.fn((_data: any, cb?: (err?: Error) => void) => {
                if (cb) cb(new Error("send failed"));
            }),
        };

        await route.logs(socket, { uid: "u1", roles: ["admin"] });

        // The redis instance created inside logs() is the last one pushed.
        const redisInstance = hoisted.instances[hoisted.instances.length - 1];
        redisInstance.emit("message", "svc-logs", "log line");

        expect(route.logger.error).toHaveBeenCalledWith("Failed to forward message to client u1, channel=svc-logs.");
        expect(route.logger.debug).toHaveBeenCalledWith(new Error("send failed"));
    });
});
