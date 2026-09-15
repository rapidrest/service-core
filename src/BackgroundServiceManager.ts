///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2020-2026 Jean-Philippe Steinmetz
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
import { BackgroundService } from "./BackgroundService.js";
import * as schedule from "node-schedule";
import { ObjectFactory } from "./ObjectFactory.js";
import { ObjectDecorators } from "@rapidrest/core";
const { Config, Logger } = ObjectDecorators;

/**
 * The `BackgroundServiceManager` manages all configured background services in the application. It is responsible for
 * initializing the jobs, scheduling them and performing any related shutdown tasks. See the `BackgroundService`
 * class for details on how to create a background service class to be used by this manager.
 *
 * ## Usage
 * To use the manager instantiate a new object and provide the required constructor arguments. Then simply call the
 * `startAll` function. When shutting your application down you should call the `stopAll` function.
 *
 * ```
 * import { BackgroundServiceManager } from "@rapidrest/service-core";
 *
 * const manager: BackgroundServiceManager = new BackgroundServiceManager(objectFactory, serviceClasses, config, logger);
 * await manager.startAll();
 * ...
 * await manager.stopAll();
 * ```
 *
 * You may optionally start and stop individual services using the `start` and `stop` functions respectively.
 *
 * ```
 * await manager.start("MyService");
 * ...
 * await manger.stop("MyService");
 * ```
 * @author Jean-Philippe Steinmetz <rapidrests@gmail.com>
 */
export class BackgroundServiceManager {
    @Config()
    private readonly config: any;
    private classes: {};
    private jobs: any = {};
    @Logger
    private readonly logger: any;
    private objectFactory: ObjectFactory;
    // Tracks which scheduled services currently have a `run()` in flight, so a new scheduled tick that fires
    // before the previous one finished can be skipped instead of starting an overlapping, concurrent run.
    private runningJobs: Set<string> = new Set();
    private services: any = {};

    constructor(objectFactory: ObjectFactory, classes: {}) {
        this.classes = classes;
        this.objectFactory = objectFactory;
    }

    /**
     * Returns the service instance with the given name.
     *
     * @param name The name of the background service to retrieve.
     */
    public getService(name: string): BackgroundService | undefined {
        return this.services[name];
    }

    /**
     * Starts all configured background services.
     */
    public async startAll(): Promise<void> {
        // Go through all loaded background job classes and start each one
        if (this.classes) {
            for (const name in this.classes) {
                const clazz: any = this.classes[name];
                if (clazz.prototype instanceof BackgroundService) {
                    await this.start(name, clazz);
                }
            }
        }
    }

    /**
     * Starts the background service with the given name.
     *
     * @param serviceName The name of the background service to start.
     * @param clazz The class type of the service to start. If not specified the name is used to lookup the class type.
     * @param args The list of arguments to pass into the service constructor
     */
    public async start(serviceName: string, clazz?: any, ...args: any): Promise<void> {
        // Check that the job hasn't already been started
        if (this.jobs[serviceName]) {
            return;
        }

        // Look for the class definition with the given name if not already given
        clazz = clazz ? clazz : this.classes[serviceName];

        if (clazz) {
            let service: BackgroundService | undefined = undefined;
            let startedService: BackgroundService | undefined = undefined;
            try {
                this.logger.info("Starting service " + serviceName + "...");

                // Instantiate the service class
                const instance: BackgroundService = await this.objectFactory.newInstance(clazz, {
                    name: serviceName,
                    initialize: true,
                    args: [...args],
                });
                service = instance;
                this.services[serviceName] = instance;

                // Reject an invalid schedule before starting the service. `scheduleJob()` returns `null` for a spec
                // it can't parse, which would otherwise only surface after `start()` had already run, leaving a
                // started service that nothing ever stops.
                if (instance.schedule && !BackgroundServiceManager.isValidSchedule(instance.schedule)) {
                    throw new Error(`Invalid schedule '${instance.schedule}' for background service '${serviceName}'.`);
                }

                // Initialize the service
                await instance.start();
                startedService = instance;

                // Schedule the service for background execution. Guard against overlapping runs: node-schedule
                // fires on every tick regardless of whether the previous invocation's `run()` has settled, so a
                // service whose `run()` occasionally outlasts its own interval would otherwise get a second,
                // concurrent invocation racing the first against the same external resources/DB writes.
                if (instance.schedule) {
                    const scheduled: BackgroundService = instance;
                    const job: schedule.Job | null = schedule.scheduleJob(scheduled.schedule!, async () => {
                        if (this.runningJobs.has(serviceName)) {
                            this.logger.warn(
                                `Background service '${serviceName}' is still running from a previous scheduled tick; skipping this invocation to avoid an overlapping run.`,
                            );
                            return;
                        }
                        this.runningJobs.add(serviceName);
                        try {
                            await scheduled.run();
                        } finally {
                            this.runningJobs.delete(serviceName);
                        }
                    });
                    if (!job) {
                        throw new Error(
                            `Failed to schedule background service '${serviceName}' with schedule '${scheduled.schedule}'.`,
                        );
                    }
                    job.on("error", (err: any) => {
                        this.logger.error(`Background service '${serviceName}' failed during a scheduled run.`);
                        this.logger.debug(err);
                    });
                    this.jobs[serviceName] = job;
                } else {
                    // One time execution services are run once and then immediately cleaned up
                    await instance.run();
                    startedService = undefined;
                    await instance.stop();
                    await this.objectFactory.destroy(instance);
                }
            } catch (err) {
                this.logger.error(`Failed to start service: ${serviceName}`);
                this.logger.debug(err);

                // Don't leave a half-started service behind: `stopAll()` only stops services that have a job.
                if (this.jobs[serviceName]) {
                    this.jobs[serviceName].cancel(false);
                    delete this.jobs[serviceName];
                }
                if (startedService) {
                    try {
                        await startedService.stop();
                    } catch (stopErr) {
                        this.logger.debug(stopErr);
                    }
                }
                if (this.services[serviceName] === service) {
                    delete this.services[serviceName];
                }
            }
        }
    }

    /**
     * Returns `true` if node-schedule accepts the given schedule, without scheduling anything.
     *
     * @param spec The cron string, date or recurrence rule to validate.
     */
    private static isValidSchedule(spec: any): boolean {
        const probe: schedule.Job = new schedule.Job("rrst:schedule-probe");
        const valid: boolean = probe.schedule(spec);
        probe.cancel();
        return valid;
    }

    /**
     * Stops all currently active background services that are owned by the manager.
     */
    public async stopAll(): Promise<void> {
        for (const jobName in this.jobs) {
            await this.stop(jobName);
        }

        // Clear the local state
        this.jobs = {};
        this.services = {};
    }

    /**
     * Stops the background service with the given name.
     *
     * @param serviceName The name of the background service to stop.
     */
    public async stop(serviceName: string): Promise<void> {
        this.logger.info("Stopping background service " + serviceName + "...");

        // Cancel the background execution schedule
        if (this.jobs[serviceName]) {
            this.jobs[serviceName].cancel(false);
        }

        // Shut it down
        if (this.services[serviceName]) {
            await this.services[serviceName].stop();
        }
    }
}
