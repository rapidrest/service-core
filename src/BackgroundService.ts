///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2020-2026 Jean-Philippe Steinmetz
///////////////////////////////////////////////////////////////////////////////
/**
 * The `BackgroundService` is an abstract base class for defining scheduled background services. A background service
 * executes in the background once on startup or on a set schedule (like a cron job) and performs additional processing.
 *
 * @author Jean-Philippe Steinmetz <rapidrests@gmail.com>
 */
export abstract class BackgroundService {
    /** The global application configuration that the service can reference. */
    protected config: any;
    /** The logging utility to use. */
    protected logger: any;

    constructor(config: any, logger: any) {
        this.config = config;
        this.logger = logger;
    }

    /**
     * Returns the desired execution interval that this service should be scheduled with. If `undefined` is returned
     * the service is executed only once.
     */
    public abstract get schedule(): string | undefined;

    /**
     * The processing function to execute at each scheduled interval.
     */
    public abstract run(): Promise<void> | void;

    /**
     * Initializes the background service with any defaults.
     */
    public abstract start(): Promise<void> | void;

    /**
     * Shuts down the background allowing the service to complete any outstanding tasks.
     */
    public abstract stop(): Promise<void> | void;
}
