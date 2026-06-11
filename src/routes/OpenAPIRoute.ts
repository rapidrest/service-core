///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2020-2026 Jean-Philippe Steinmetz
///////////////////////////////////////////////////////////////////////////////
import { ObjectDecorators } from "@rapidrest/core";
import { OpenApiSpec } from "../OpenApiSpec.js";
import { Description, Returns, Summary } from "../decorators/DocDecorators.js";
import { Get, Route, ContentType } from "../decorators/RouteDecorators.js";
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
 * The `OpenAPIRoute` provides default routes to expose the service's OpenAPI specification.
 *
 * - `GET /` — Swagger UI HTML (loads swagger-ui-dist from CDN)
 * - `GET /openapi.json` — raw OpenAPI specification as JSON
 * - `GET /openapi.yaml` — raw OpenAPI specification as YAML
 *
 * @author Jean-Philippe Steinmetz
 */
@Route("/")
export class OpenAPIRoute {
    /** The underlying OpenAPI specification. */
    @Inject(OpenApiSpec)
    private apiSpec: OpenApiSpec = new OpenApiSpec();

    @Summary("{{serviceName}} OpenAPI, HTLM format")
    @Description("Returns the OpenAPI specification for the service in HTML format.")
    @Get()
    @ContentType("text/html")
    @Returns([String])
    public getHTML(): string {
        return swaggerHtml("/openapi.json");
    }

    @Summary("{{serviceName}} API docs")
    @Description("Returns the OpenAPI specification for the service in HTML format.")
    @Get("api-docs")
    @ContentType("text/html")
    @Returns([String])
    public getAPIDocs(): string {
        return swaggerHtml("/openapi.json");
    }

    @Summary("{{serviceName}} OpenAPI, JSON format")
    @Description("Returns the OpenAPI specification for the service in JSON format.")
    @Get("openapi.json")
    @Returns([String])
    public getJSON(): any {
        return this.apiSpec.getSpec();
    }

    @Summary("{{serviceName}} OpenAPI, YAML format")
    @Description("Returns the OpenAPI specification for the service in YAML format.")
    @Get("openapi.yaml")
    @ContentType("text/yaml")
    @Returns([String])
    public getYAML(): string {
        return this.apiSpec.getSpecAsYaml();
    }
}
