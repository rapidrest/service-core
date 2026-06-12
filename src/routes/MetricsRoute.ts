///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2020-2026 Jean-Philippe Steinmetz
///////////////////////////////////////////////////////////////////////////////
import * as prom from "prom-client";
import { ApiError, JWTUser, UserUtils, ObjectDecorators } from "@rapidrest/core";
import { Auth, Get, Param, Route, ContentType, User } from "../decorators/RouteDecorators.js";
import { Description, Returns, Summary } from "../decorators/DocDecorators.js";
import { ApiErrorMessages, ApiErrors } from "../ApiErrors.js";
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
    @Config("metrics")
    private metricsConfig = {
        authRequired: true,
    };

    private registry: prom.Registry;

    @Config("trusted_roles")
    private trustedRoles: string[] = [];

    constructor() {
        this.registry = prom.register;
    }

    @Summary("{{serviceName}} all Prometheus metrics")
    @Description("Returns all Prometheus metrics emitted by this service.")
    @Get()
    @ContentType(prom.register.contentType)
    @Returns([String])
    private async getMetrics(@User user?: JWTUser): Promise<string> {
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
    private async getSingleMetric(@Param("metric") metric: any, @User user?: JWTUser): Promise<string> {
        if (this.metricsConfig.authRequired && (!user || !UserUtils.hasRoles(user, this.trustedRoles))) {
            throw new ApiError(ApiErrors.AUTH_PERMISSION_FAILURE, 403, ApiErrorMessages.AUTH_PERMISSION_FAILURE);
        }
        return await this.registry.getSingleMetricAsString(metric);
    }
}
