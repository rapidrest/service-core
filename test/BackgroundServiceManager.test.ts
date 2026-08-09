///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2020-2026 Jean-Philippe Steinmetz
///////////////////////////////////////////////////////////////////////////////
import config from "./config";
import { BackgroundServiceManager } from "../src/BackgroundServiceManager";
import { ClassLoader, Logger } from "@rapidrest/core";
import MyFirstService from "./server/jobs/MyFirstService";
import MySecondService from "./server/jobs/MySecondService";
import MyThirdService from "./server/jobs/MyThirdService";
import { BackgroundService, ObjectFactory } from "../src";

// Not discovered via ClassLoader (defined here rather than under test/server/jobs) so it doesn't get swept
// into the `serviceClasses` map shared by the "start/stop multiple" test below.
class RepeatStartService extends BackgroundService {
    public static instantiations = 0;

    public constructor() {
        super();
        RepeatStartService.instantiations++;
    }

    public get schedule(): string | undefined {
        return "* * * * * *";
    }

    public async run(): Promise<void> {
        // no-op
    }

    public async start(): Promise<void> {
        // no-op
    }

    public async stop(): Promise<void> {
        // no-op
    }
}

class ThrowingRunService extends BackgroundService {
    public get schedule(): string | undefined {
        return "* * * * * *";
    }

    public run(): void {
        throw new Error("run() always fails");
    }

    public async start(): Promise<void> {
        // no-op
    }

    public async stop(): Promise<void> {
        // no-op
    }
}

class FailingStartService extends BackgroundService {
    public get schedule(): string | undefined {
        return undefined;
    }

    public async run(): Promise<void> {
        // no-op
    }

    public async start(): Promise<void> {
        throw new Error("start() always fails");
    }

    public async stop(): Promise<void> {
        // no-op
    }
}

vi.setConfig({ testTimeout: 10000 });

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
        const manager: BackgroundServiceManager = await objectFactory.newInstance(BackgroundServiceManager, {
            args: [objectFactory, serviceClasses],
        });
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
        const manager: BackgroundServiceManager = await objectFactory.newInstance(BackgroundServiceManager, {
            args: [objectFactory, serviceClasses],
        });
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

    it("Does not re-instantiate a scheduled service that has already been started.", async () => {
        RepeatStartService.instantiations = 0;
        const manager: BackgroundServiceManager = await objectFactory.newInstance(BackgroundServiceManager, {
            args: [objectFactory, {}],
        });

        await manager.start("test.RepeatStartService", RepeatStartService);
        expect(RepeatStartService.instantiations).toBe(1);

        // A second start() call for the same, already-scheduled service name must return immediately
        // without instantiating (or scheduling) it again.
        await manager.start("test.RepeatStartService", RepeatStartService);
        expect(RepeatStartService.instantiations).toBe(1);

        await manager.stop("test.RepeatStartService");
    });

    it("Logs rather than crashes when a scheduled service's run() throws.", async () => {
        const logger: any = Logger();
        const errorSpy = vi.spyOn(logger, "error");

        const manager: BackgroundServiceManager = await objectFactory.newInstance(BackgroundServiceManager, {
            args: [objectFactory, {}],
        });

        await manager.start("test.ThrowingRunService", ThrowingRunService);

        // Schedule fires once per second; wait long enough for at least one failing invocation.
        await new Promise<void>((resolve) => setTimeout(resolve, 1500));

        expect(
            errorSpy.mock.calls.some((call) =>
                String(call[0]).includes("Background service 'test.ThrowingRunService' failed during a scheduled run."),
            ),
        ).toBe(true);

        await manager.stop("test.ThrowingRunService");
        errorSpy.mockRestore();
    });

    it("Logs rather than crashes when a service fails to start.", async () => {
        const logger: any = Logger();
        const errorSpy = vi.spyOn(logger, "error");

        const manager: BackgroundServiceManager = await objectFactory.newInstance(BackgroundServiceManager, {
            args: [objectFactory, {}],
        });

        await expect(manager.start("test.FailingStartService", FailingStartService)).resolves.toBeUndefined();

        expect(errorSpy).toHaveBeenCalledWith("Failed to start service: test.FailingStartService");

        errorSpy.mockRestore();
    });
});
