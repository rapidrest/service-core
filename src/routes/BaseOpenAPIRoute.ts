///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2020-2026 Jean-Philippe Steinmetz
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
import { ObjectDecorators } from "@rapidrest/core";
import { OpenApiSpec } from "../OpenApiSpec.js";
import { Description, Returns, Summary } from "../decorators/DocDecorators.js";
import { Get, ContentType } from "../decorators/RouteDecorators.js";
const { Inject } = ObjectDecorators;

/** Inline Swagger UI HTML page — loads swagger-ui-dist from CDN so there is no npm dependency. */
function swaggerHtml(specUrl: string): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>API Documentation</title>
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist/swagger-ui.css">
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist/swagger-ui-bundle.js"></script>
  <script>
    SwaggerUIBundle({
      url: "${specUrl}",
      dom_id: "#swagger-ui",
      presets: [SwaggerUIBundle.presets.apis, SwaggerUIBundle.SwaggerUIStandalonePreset],
      layout: "BaseLayout"
    });
  </script>
</body>
</html>`;
}

/**
 * The `BaseOpenAPIRoute` class provides a base set of endpoints exposing the server's OpenAPI specification.
 *
 * Exposed endpoints:
 *
 * | Name | HTTP Method | What it does |
 * | --- | --- | --- |
 * | `getHTML` | `GET /<base_path>` | Swagger UI HTML (loads swagger-ui-dist from CDN) |
 * | `getJSON` | `GET /<base_path>/json` | raw OpenAPI specification as JSON |
 * | `getYAML` | `GET /<base_path>/yaml` | raw OpenAPI specification as YAML |
 *
 * !!Note!! that the `BaseAdminRoute` is not automatically registered with a server by default. You must create
 * your own class that extends `AdminRoute` and apply the desired base path with `@Route()`.
 *
 * @example
 * ```ts
 * import { BaseOpenAPIRoute, RouteDecorators } from "@rapidrest/service-core";
 * const { Route } = RouteDecorators;
 *
 * @Route("/openapi")
 * export class OpenAPIRoute extends BaseOpenAPIRoute {}
 * ```
 *
 * @author Jean-Philippe Steinmetz
 */
export class BaseOpenAPIRoute {
    /** The underlying OpenAPI specification. */
    @Inject(OpenApiSpec)
    protected apiSpec: OpenApiSpec = new OpenApiSpec();

    @Summary("{{serviceName}} API docs")
    @Description("Returns the OpenAPI specification for the service in HTML format.")
    @Get()
    @ContentType("text/html")
    @Returns([String])
    public getHTML(): string {
        return swaggerHtml("/openapi.json");
    }

    @Summary("{{serviceName}} OpenAPI, JSON format")
    @Description("Returns the OpenAPI specification for the service in JSON format.")
    @Get("json")
    @Returns([String])
    public getJSON(): any {
        return this.apiSpec.getSpec();
    }

    @Summary("{{serviceName}} OpenAPI, YAML format")
    @Description("Returns the OpenAPI specification for the service in YAML format.")
    @Get("yaml")
    @ContentType("text/yaml")
    @Returns([String])
    public getYAML(): string {
        return this.apiSpec.getSpecAsYaml();
    }
}
