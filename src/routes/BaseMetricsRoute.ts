///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2020-2026 Jean-Philippe Steinmetz
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
import * as prom from "prom-client";
import { ApiError, UserUtils, ObjectDecorators, type JWTUser } from "@rapidrest/core";
import { Auth, Get, Param, Route, ContentType, User } from "../decorators/RouteDecorators.js";
import { Description, Returns, Summary } from "../decorators/DocDecorators.js";
import { ApiErrorMessages, ApiErrors } from "../ApiErrors.js";
const { Config } = ObjectDecorators;

/**
 * The `BaseMetricsRoute` class provides a base set of endpoints for exposing Prometheus metrics.
 *
 * Exposed endpoints:
 *
 * | Name | HTTP Method | What it does |
 * | --- | --- | --- |
 * | `getMetrics` | `GET /<base_path>` | Returns all Prometheus metrics gathered by the system |
 * | `getSingleMetric` | `GET /<base_path>/:metric` | Returns a single Prometheus metric with the given name |
 *
 * Services that wish to provide metrics to be exposed via this route can register them using the global registry
 * from the provided `prom-client` dependency. See the `prom-client` documentation for more details.
 *
 * !!Note!! that the `BaseMetricsRoute` is not automatically registered with a server by default. You must create
 * your own class that extends `AdminRoute` and apply the desired base path with `@Route()`.
 *
 * @example
 * ```ts
 * import { BaseMetricsRoute, RouteDecorators } from "@rapidrest/service-core";
 * const { Route } = RouteDecorators;
 *
 * @Route("/metrics")
 * export class MetricsRoute extends BaseMetricsRoute {}
 * ```
 */
export class BaseMetricsRoute {
    @Config("metrics", { authRequired: true })
    protected metricsConfig = {
        authRequired: true,
    };

    protected registry: prom.Registry;

    @Config("trusted_roles")
    protected trustedRoles: string[] = [];

    constructor() {
        this.registry = prom.register;
    }

    @Summary("{{serviceName}} all Prometheus metrics")
    @Description("Returns all Prometheus metrics emitted by this service.")
    @Get()
    @ContentType(prom.register.contentType)
    @Returns([String])
    public async getMetrics(@User user?: JWTUser): Promise<string> {
        if (this.metricsConfig.authRequired && (!user || !UserUtils.hasRoles(user, this.trustedRoles))) {
            throw new ApiError(ApiErrors.AUTH_PERMISSION_FAILURE, 403, ApiErrorMessages.AUTH_PERMISSION_FAILURE);
        }
        return await this.registry.metrics();
    }

    @Summary("{{serviceName}} Prometheus metrics by name")
    @Description("Returns the Prometheus metric emitted by this service with the given name.")
    @Get("/:metric")
    @ContentType(prom.register.contentType)
    @Returns([String])
    public async getSingleMetric(@Param("metric") metric: any, @User user?: JWTUser): Promise<string> {
        if (this.metricsConfig.authRequired && (!user || !UserUtils.hasRoles(user, this.trustedRoles))) {
            throw new ApiError(ApiErrors.AUTH_PERMISSION_FAILURE, 403, ApiErrorMessages.AUTH_PERMISSION_FAILURE);
        }
        return await this.registry.getSingleMetricAsString(metric);
    }
}
