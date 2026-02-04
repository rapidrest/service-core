///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2020-2026 Jean-Philippe Steinmetz
///////////////////////////////////////////////////////////////////////////////
import { Get, Route } from "../decorators/RouteDecorators.js";
import { Description, Returns, Summary } from "../decorators/DocDecorators.js";
import { ObjectDecorators } from "@rapidrest/core";
import { StatusExtraData } from "../models/StatusExtraData.js";
const { Config, Inject } = ObjectDecorators;

/**
 * The `StatusRoute` provides a default `/status` endpoint the returns metadata information about the service such as
 * name, version.
 *
 * @author Jean-Philippe Steinmetz
 */
@Route("/status")
export class StatusRoute {
    @Config()
    private config: any;

    @Inject(StatusExtraData)
    private statusExtraData: StatusExtraData | undefined;


    @Summary("{{serviceName}} servrice and operational status")
    @Description("Returns information about the service and it's operational status.")
    @Get()
    @Returns([Object])
    private get(): any {
        return {
            name: this.config.get("service_name"),
            time: new Date().toISOString(),
            version: this.config.get("version"),
            ...this.statusExtraData?.data
        };
    }
}
