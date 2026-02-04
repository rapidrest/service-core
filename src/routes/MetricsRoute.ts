///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2020-2026 Jean-Philippe Steinmetz
///////////////////////////////////////////////////////////////////////////////
import * as prom from "prom-client";
import { Get, Param, Route, ContentType } from "../decorators/RouteDecorators.js";
import { Description, Returns, Summary } from "../decorators/DocDecorators.js";
import { ObjectDecorators } from "@rapidrest/core";
const { Config } = ObjectDecorators;

/**
 * Handles all REST API requests for the endpoint `/metrics'. This route handler produces Prometheus compatible metrics
 * for use with a Prometheus based server.
 *
 * Services that wish to provide metrics to be exposed via this route can register them using the global registry
 * from the provided `prom-client` dependency. See the `prom-client` documentation for more details.
 */
@Route("/metrics")
export class MetricsRoute {
    private registry: prom.Registry;

    constructor() {
        this.registry = prom.register;
    }

    @Summary("{{serviceName}} all Prometheus metrics")
    @Description("Returns all Prometheus metrics emitted by this service.")
    @Get()
    @ContentType(prom.register.contentType)
    @Returns([String])
    private async getMetrics(): Promise<string> {
        return await this.registry.metrics();
    }

    @Summary("{{serviceName}} Prometheus metrics by name")
    @Description("Returns the Prometheus metric emitted by this service with the given name.")
    @Get("/:metric")
    @ContentType(prom.register.contentType)
    @Returns([String])
    private async getSingleMetric(@Param("metric") metric: any): Promise<string> {
        return await this.registry.getSingleMetricAsString(metric);
    }
}
