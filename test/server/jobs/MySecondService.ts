///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2020-2026 Jean-Philippe Steinmetz. All rights reserved.
///////////////////////////////////////////////////////////////////////////////
import { BackgroundService } from "../../../src/BackgroundService";

export default class MySecondService extends BackgroundService {
    public counter: number;
    public started: boolean;
    public stopped: boolean;

    constructor() {
        super();

        this.counter = -1;
        this.started = false;
        this.stopped = true;
    }

    public get schedule(): string | undefined {
        return "* * * * * *";
    }

    public run(): void {
        this.counter++;
    }

    public start(): void {
        this.counter = 0;
        this.started = true;
        this.stopped = false;
    }

    public stop(): void {
        this.started = false;
        this.stopped = true;
    }
}
