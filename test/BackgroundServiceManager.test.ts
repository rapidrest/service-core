///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2020-2026 Jean-Philippe Steinmetz
///////////////////////////////////////////////////////////////////////////////
import "reflect-metadata";
import { describe, it, expect, vi, beforeEach } from "vitest";
import config from "./config.js";
import { BackgroundServiceManager } from "../src/BackgroundServiceManager.js";
import { ClassLoader, Logger } from "@rapidrest/core";
import MyFirstService from "./server/jobs/MyFirstService.js";
import MySecondService from "./server/jobs/MySecondService.js";
import MyThirdService from "./server/jobs/MyThirdService.js";
import { BackgroundService, ObjectFactory } from "../src/index.js";

describe("BackgroundServiceManager Tests", () => {
    const objectFactory: ObjectFactory = new ObjectFactory(config, Logger());
    const serviceClasses: any = {};

    beforeAll(async () => {
        const classLoader: ClassLoader = new ClassLoader("./test/server");
        await classLoader.load();
        for (const [name, clazz] of classLoader.getClasses().entries()) {
            if (clazz.prototype instanceof BackgroundService) {
                serviceClasses[name] = clazz;
            }
        }
    });

    afterAll(async () => {
        await objectFactory.destroy();
    })

    it("Can start/stop single background service.", async () => {
        const manager: BackgroundServiceManager = new BackgroundServiceManager(objectFactory, serviceClasses, config, Logger());
        await manager.start("jobs.MyFirstService");
        const service: MyFirstService = manager.getService("jobs.MyFirstService") as MyFirstService;
        expect(service).toBeDefined();
        expect(service.counter).toBe(0);
        expect(service.started).toBe(true);
        expect(service.stopped).toBe(false);

        const service2: MySecondService = manager.getService("jobs.MySecondService") as MySecondService;
        expect(service2).not.toBeDefined();
        const service3: MyThirdService = manager.getService("jobs.MyThirdService") as MyThirdService;
        expect(service3).not.toBeDefined();

        return await new Promise<void>((resolve) => {
            setTimeout(async () => {
                const service: MyFirstService = manager.getService("jobs.MyFirstService") as MyFirstService;
                expect(service).toBeDefined();
                expect(service.counter).toBeGreaterThanOrEqual(5);
                expect(service.started).toBe(true);
                expect(service.stopped).toBe(false);

                await manager.stop("jobs.MyFirstService");
                expect(service.started).toBe(false);
                expect(service.stopped).toBe(true);
                resolve();
            }, 5000);
        });
    });

    it("Can start/stop multiple background services.", async () => {
        const manager: BackgroundServiceManager = new BackgroundServiceManager(objectFactory, serviceClasses, config, Logger());
        await manager.startAll();
        const service: MyFirstService = manager.getService("jobs.MyFirstService") as MyFirstService;
        expect(service).toBeDefined();
        expect(service.counter).toBe(0);
        expect(service.started).toBe(true);
        expect(service.stopped).toBe(false);

        const service2: MySecondService = manager.getService("jobs.MySecondService") as MySecondService;
        expect(service2).toBeDefined();
        expect(service2.counter).toBe(0);
        expect(service2.started).toBe(true);
        expect(service2.stopped).toBe(false);

        const service3: MyThirdService = manager.getService("jobs.MyThirdService") as MyThirdService;
        expect(service3).toBeDefined();
        expect(service3.counter).toBe(1);
        expect(service3.started).toBe(true);
        expect(service3.stopped).toBe(true);

        return await new Promise<void>((resolve) => {
            setTimeout(async () => {
                const service: MyFirstService = manager.getService("jobs.MyFirstService") as MyFirstService;
                const service2: MySecondService = manager.getService("jobs.MySecondService") as MySecondService;
                const service3: MyThirdService = manager.getService("jobs.MyThirdService") as MyThirdService;

                await manager.stopAll();

                expect(service.counter).toBeGreaterThanOrEqual(5);
                expect(service2.counter).toBeGreaterThanOrEqual(5);
                expect(service3.counter).toBeLessThan(5);
                expect(service.started).toBe(false);
                expect(service.stopped).toBe(true);
                expect(service2.started).toBe(false);
                expect(service2.stopped).toBe(true);
                expect(service3.started).toBe(true);
                expect(service3.stopped).toBe(true);
                resolve();
            }, 5000);
        });
    });
});
