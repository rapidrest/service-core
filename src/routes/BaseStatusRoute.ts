///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2020-2026 Jean-Philippe Steinmetz
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
import { Get } from "../decorators/RouteDecorators.js";
import { Description, Returns, Summary } from "../decorators/DocDecorators.js";
import { ObjectDecorators } from "@rapidrest/core";
import { StatusExtraData } from "../models/StatusExtraData.js";
const { Config, Inject } = ObjectDecorators;

/**
 * The `BaseStatusRoute` class provides a base set of endpoints exposing status metadata information about the server.
 *
 * Included Metadata:
 * | Name | Description |
 * | --- | --- |
 * | `name` | The name of the server (e.g. `petstore_example`) |
 * | `time` | The current UTC timestamp of the server |
 * | `version` | The release version of the server. (e.g. `1.0.0`) |
 *
 * Exposed endpoints:
 *
 * | Name | HTTP Method | What it does |
 * | --- | --- | --- |
 * | `get` | `GET /<base_path>` | Returns the server's status metadata |
 *
 * !!Note!! that the `BaseAdminRoute` is not automatically registered with a server by default. You must create
 * your own class that extends `AdminRoute` and apply the desired base path with `@Route()`.
 *
 * @example
 * ```ts
 * import { BaseStatusRoute, RouteDecorators } from "@rapidrest/service-core";
 * const { Route } = RouteDecorators;
 *
 * @Route("/status")
 * export class StatusRoute extends BaseStatusRoute {}
 * ```
 *
 * @author Jean-Philippe Steinmetz
 */
export class BaseStatusRoute {
    @Config("service_name")
    protected serviceName: any;
    @Config("version")
    protected serviceVersion: any;

    @Inject(StatusExtraData)
    protected statusExtraData: StatusExtraData | undefined;

    @Summary("Server status")
    @Description("Returns information about the server and it's operational status.")
    @Get()
    @Returns([Object])
    public get(): any {
        return {
            name: this.serviceName,
            time: Date.now(),
            version: this.serviceVersion,
            ...this.statusExtraData?.data,
        };
    }
}
