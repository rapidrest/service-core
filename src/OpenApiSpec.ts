///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2020-2026 Jean-Philippe Steinmetz
///////////////////////////////////////////////////////////////////////////////
import { oas31 as oa } from "openapi3-ts";
import { DocumentsData } from "./decorators/DocDecorators.js";
import merge from "deepmerge";
import _ from "lodash";
import { ObjectDecorators, StringUtils } from "@rapidrest/core";
const { Config, Init } = ObjectDecorators;

/**
 * `OpenApiSpec` is a container for an OpenAPI specification.
 *
 * This class wraps the behavior of openapi-ts to make it easier to build an OpenAPI
 * specification dynamically at runtime using the server RapidREST information.
 *
 * @author Jean-Philippe Steinmetz <rapidrests@gmail.com>
 */
export class OpenApiSpec {
    private _builder: oa.OpenApiBuilder;

    @Config()
    private config?: any;

    constructor(spec?: oa.OpenAPIObject) {
        this._builder = oa.OpenApiBuilder.create(spec);
    }

    public get builder(): oa.OpenApiBuilder {
        return this._builder;
    }

    public set builder(value: oa.OpenApiBuilder) {
        this._builder = value;
    }

    public get openapi(): string {
        return this._builder.getSpec().openapi;
    }

    public get info(): oa.InfoObject {
        return this._builder.getSpec().info;
    }

    public get servers(): oa.ServerObject[] | undefined {
        return this._builder.getSpec().servers;
    }

    public get paths(): oa.PathsObject | undefined {
        return this._builder.getSpec().paths;
    }

    public get components(): oa.ComponentsObject | undefined {
        return this._builder.getSpec().components;
    }

    public get security(): oa.SecurityRequirementObject[] | undefined {
        return this._builder.getSpec().security;
    }

    public get tags(): oa.TagObject[] | undefined {
        return this._builder.getSpec().tags;
    }

    public get externalDocs(): oa.ExternalDocumentationObject | undefined {
        return this._builder.getSpec().externalDocs;
    }

    public get webhooks(): oa.PathsObject | undefined {
        return this._builder.getSpec().webhooks;
    }

    @Init
    private init(): void {
        this.addInfo({
            title: this.config.get("title"),
            description: this.config.get("description"),
            termsOfService: this.config.get("termsOfService"),
            contact: this.config.get("contact"),
            license: this.config.get("license"),
            version: this.config.get("version"),
        });
        this.addParameter("id", {
            description: "The unique identifier of the resource.",
            name: "id",
            in: "path",
            required: true,
            schema: {
                type: "string",
            },
        });
        this.addParameter("page", {
            description: "The index of the current page when retrieving paginated results.",
            name: "page",
            in: "query",
            required: false,
            schema: {
                type: "number",
            },
        });
        this.addParameter("limit", {
            description: "The maximum number of records to retrieve.",
            name: "limit",
            in: "query",
            required: false,
            schema: {
                type: "number",
            },
        });
        this.addParameter("sort", {
            description: "The property and direction with which to sort the results by.",
            name: "sort",
            in: "query",
            required: false,
            schema: {
                oneOf: [
                    {
                        description: "The name of the property to sort by, in ascending order.",
                        type: "string",
                        example: "propertyName",
                    },
                    {
                        description: "The name of the property to sort by, in ascending order.",
                        type: "object",
                        example: {
                            "<propertyName>": "<direction>",
                        },
                    },
                ],
            },
        });
        this.addParameter("version", {
            description: "The unique version of the resource.",
            name: "version",
            in: "query",
            required: false,
            schema: {
                type: "number",
            },
        });
        this.addSchema("Error", {
            description: "Describes an error that has occurred within the service.",
            type: "object",
            properties: {
                message: {
                    description: "The textual description of the error.",
                    type: "string",
                },
                stack: {
                    description: "The stack trace of the error. Only available when `environment` is set to `dev`.",
                    type: "object",
                },
                status: {
                    description: "The HTTP status code of the error.",
                    type: "number",
                    example: 400,
                },
            },
        });

        // Add the URL to this cluster
        this.addServer({
            url: this.config.get("cluster_url"),
        });
    }

    public getSpec(): oa.OpenAPIObject {
        return this._builder.getSpec();
    }

    public getSpecAsJson(replacer?: (key: string, value: unknown) => unknown, space?: string | number): string {
        return this._builder.getSpecAsJson(replacer, space);
    }

    public getSpecAsYaml(): string {
        return this._builder.getSpecAsYaml();
    }

    public addOpenApiVersion(openApiVersion: string): OpenApiSpec {
        this._builder.addOpenApiVersion(openApiVersion);
        return this;
    }

    public addInfo(info: oa.InfoObject): OpenApiSpec {
        this._builder.addInfo(info);
        return this;
    }

    public addContact(contact: oa.ContactObject): OpenApiSpec {
        this._builder.addContact(contact);
        return this;
    }

    public addLicense(license: oa.LicenseObject): OpenApiSpec {
        this._builder.addLicense(license);
        return this;
    }

    public addTitle(title: string): OpenApiSpec {
        this._builder.addTitle(title);
        return this;
    }

    public addDescription(description: string): OpenApiSpec {
        this._builder.addDescription(description);
        return this;
    }

    public addTermsOfService(termsOfService: string): OpenApiSpec {
        this._builder.addTermsOfService(termsOfService);
        return this;
    }

    public addVersion(version: string): OpenApiSpec {
        this._builder.addVersion(version);
        return this;
    }

    public addPath(path: string, pathItem: oa.PathItemObject): OpenApiSpec {
        this._builder.addPath(path, pathItem);
        return this;
    }

    public addSchema(name: string, schema: oa.SchemaObject | oa.ReferenceObject): OpenApiSpec {
        this._builder.addSchema(name, schema);
        return this;
    }

    public addResponse(name: string, response: oa.ResponseObject | oa.ReferenceObject): OpenApiSpec {
        this._builder.addResponse(name, response);
        return this;
    }

    public addParameter(name: string, parameter: oa.ParameterObject | oa.ReferenceObject): OpenApiSpec {
        this._builder.addParameter(name, parameter);
        return this;
    }

    public addExample(name: string, example: oa.ExampleObject | oa.ReferenceObject): OpenApiSpec {
        this._builder.addExample(name, example);
        return this;
    }

    public addRequestBody(name: string, reqBody: oa.RequestBodyObject | oa.ReferenceObject): OpenApiSpec {
        this._builder.addRequestBody(name, reqBody);
        return this;
    }

    public addHeader(name: string, header: oa.HeaderObject | oa.ReferenceObject): OpenApiSpec {
        this._builder.addHeader(name, header);
        return this;
    }

    public addSecurityScheme(name: string, secScheme: oa.SecuritySchemeObject | oa.ReferenceObject): OpenApiSpec {
        this._builder.addSecurityScheme(name, secScheme);
        return this;
    }

    public addLink(name: string, link: oa.LinkObject | oa.ReferenceObject): OpenApiSpec {
        this._builder.addLink(name, link);
        return this;
    }

    public addCallback(name: string, callback: oa.CallbackObject | oa.ReferenceObject): OpenApiSpec {
        this._builder.addCallback(name, callback);
        return this;
    }

    public addServer(server: oa.ServerObject): OpenApiSpec {
        this._builder.addServer(server);
        return this;
    }

    public addTag(tag: oa.TagObject): OpenApiSpec {
        this._builder.addTag(tag);
        return this;
    }

    public addExternalDocs(extDoc: oa.ExternalDocumentationObject): OpenApiSpec {
        this._builder.addExternalDocs(extDoc);
        return this;
    }

    public addWebhook(webhook: string, webhookItem: oa.PathItemObject): OpenApiSpec {
        this._builder.addWebhook(webhook, webhookItem);
        return this;
    }

    /**
     * Adds a RapidREST model class to the OpenAPI specification as a schema.
     *
     * @param name The name of the model to add.
     * @param clazz The class prototype to build the schema from.
     */
    public addModel(name: string, clazz: any): OpenApiSpec {
        const schema: oa.SchemaObject = this.createSchemaClass(clazz);
        this._builder.addSchema(name, schema);
        return this;
    }

    /**
     * Adds a RapidREST route handler to the OpenAPI specification.
     *
     * @param name The name of the route handler. (e.g. findAll)
     * @param path The complete path of the route handler. (e.g. `/my/resources/:id`)
     * @param method The HTTP verb type that the route handler processes. (e.g. `GET`)
     * @param metadata The object containing all API information about the route handler.
     * @param docs The object containing all documentation information about the route handler.
     * @param routeClass The parent route class that the route handler belongs to.
     */
    public addRoute(
        name: string,
        path: string,
        method: string,
        metadata: any,
        docs: DocumentsData,
        routeClass: any
    ): OpenApiSpec {
        const { after, authRequired, before } = metadata;
        let { authStrategies } = metadata;
        const { description, example, summary, tags } = docs;
        const contentType = metadata.contentType || "application/json";
        const data: oa.PathItemObject = {};
        const mParams: (oa.ParameterObject | oa.ReferenceObject)[] = [];
        let aclInfo: any =
            Reflect.getMetadata("rrst:acl", routeClass) || Reflect.getMetadata("rrst:acl", routeClass, name);
        let requestTypes: any = Reflect.getMetadata("design:type", routeClass, name);
        let returnTypes: any = Reflect.getMetadata("design:returntype", routeClass, name);
        let security: oa.SecurityRequirementObject[] | undefined = authRequired ? [] : undefined;
        let requestSchemas: (oa.SchemaObject | oa.ReferenceObject)[] = [];
        const responseSchemas: (oa.SchemaObject | oa.ReferenceObject)[] = [];

        // Extract all path parameters
        const parameters: (oa.ParameterObject | oa.ReferenceObject)[] = [];
        const regex = new RegExp(/(:[a-zA-Z0-9\-_+]+)/g);
        const matches: RegExpMatchArray | null = path.match(regex);
        if (matches) {
            for (const param of matches) {
                const name: string = param.substring(1);
                const ref: oa.ReferenceObject | undefined = this.getParameterReference(name);
                if (ref) {
                    parameters.push(ref);
                } else {
                    parameters.push({
                        name,
                        in: "path",
                        required: true,
                        schema: {
                            type: "string",
                        },
                    });
                }
            }
        }

        if (parameters.length > 0) {
            data.parameters = parameters;
        }

        // Does the endpoint use query params?
        const argMetadata: any = Reflect.getMetadata("rrst:args", Object.getPrototypeOf(routeClass), name);
        let hasQuery: boolean = false;
        for (const key in argMetadata) {
            const i: number = Number(key);
            if (argMetadata[i][0] === "query") {
                hasQuery = true;
                const qName: string | undefined = argMetadata[i][1];
                if (qName && !["page", "limit", "sort"].includes(qName)) {
                    const ref: oa.ReferenceObject | undefined = this.getParameterReference(qName);
                    if (ref) {
                        mParams.push(ref);
                    } else {
                        mParams.push({
                            name,
                            in: "query",
                            schema: {
                                type: "string",
                            },
                        });
                    }
                }
            }
        }
        // When the query is referenced as a function arg it's likely because this is a search function.
        // However, this isn't always the case. For example, endpoints that have document version tracking
        // may use the query parameter to refer to a specific version or have operands such as `purge`.
        // In these cases we don't want to list search query parameters. Unfortunately there's no easy
        // way to gaurantee detectin of this so we will do something dirty and assume anytime there's a
        // `:id` in the path, that it is not in fact a search endpoint.
        if (hasQuery && !path.includes(":id")) {
            // The following casts are really dirty, but we know for sure the params exist.
            mParams.push(this.getParameterReference("limit") as any);
            mParams.push(this.getParameterReference("page") as any);
            mParams.push(this.getParameterReference("sort") as any);
        }

        if (authRequired && !authStrategies) {
            authStrategies = ["jwt"];
        }

        if (after) {
            data["x-after"] = after;
        }

        if (before) {
            data["x-before"] = before;
        }

        // Make sure return type info is always expressed as an array
        if (!Array.isArray(requestTypes)) {
            // Ignore the Function type, it means an explicit request type wasn't provided
            requestTypes = requestTypes?.name.toLowerCase() !== "function" ? [requestTypes] : [];
        }

        // Create the list of accepted request schemas based on the metadata
        for (const typeInfo of requestTypes) {
            if (typeInfo) {
                if (typeInfo) {
                    requestSchemas.push(this.createSchemaObject(typeInfo));
                }
            }
        }

        if (routeClass.modelClass) {
            // Look up reference to schema for route's associated data model (where applicable)
            const fqn: string = routeClass.modelClass.fqn || routeClass.modelClass.name;
            let schema: oa.SchemaObject | oa.ReferenceObject | undefined = this.getSchemaReference(fqn);
            // If no reference was found we'll create the schema definition now and link it
            if (!schema) {
                this.addModel(fqn, routeClass.modelClass);
                schema = this.getSchemaReference(fqn);
            }

            if (schema) {
                aclInfo = Reflect.getMetadata("rrst:classACL", routeClass.modelClass) || aclInfo;
                data["x-schema"] = fqn;

                // If the request schemas aren't explicitly declared we will infer them based on the method
                // type and model class.
                if (requestSchemas.length === 0 && ["patch", "post", "put"].includes(method.toLowerCase())) {
                    requestSchemas.push(schema);
                }
            }
        }

        data["x-name"] = routeClass._fqn || routeClass.fqn || routeClass.constructor.fqn || routeClass.constructor.name;

        // Convert the list of authStrategies to a SecurityRequirementObject array
        if (security) {
            for (const authStrategy of authStrategies) {
                security.push({ [authStrategy]: [] });
            }
        }

        // Make sure return type info is always expressed as an array
        if (!Array.isArray(returnTypes)) {
            // Ignore the Function type, it means an explicit request type wasn't provided
            // Treat Promises as standard objects, we don't know for sure if the promise has a return value,
            // but it's a fairly safe assumption.
            if (returnTypes) {
                if (returnTypes.name.toLowerCase() !== "promise") {
                    returnTypes = [Object];
                } else if (returnTypes.name.toLowerCase() !== "function") {
                    returnTypes = [returnTypes];
                }
            } else {
                returnTypes = [];
            }
        }

        for (const typeInfo of returnTypes) {
            if (typeInfo) {
                responseSchemas.push(this.createSchemaObject(typeInfo));
            }
        }

        // If the path has `.websocket` at the end, make sure to add the `x-upgrade` extension
        // Also remove all response schemas since they don't apply.
        if (path.includes(".websocket")) {
            data["x-upgrade"] = true;
            responseSchemas.splice(0, responseSchemas.length);
        }
        const errorContent = {
            ["application/json"]: {
                schema: this.getSchemaReference("Error"),
            },
        };
        // Finally add the operation object for the given method
        const opObject: oa.OperationObject = {
            description,
            parameters: mParams.length > 0 ? mParams : undefined,
            requestBody:
                requestSchemas.length > 0
                    ? {
                          content: {
                              [contentType]: {
                                  example: example,
                                  schema:
                                      requestSchemas.length > 1
                                          ? {
                                                oneOf: requestSchemas,
                                            }
                                          : requestSchemas[0],
                              },
                          },
                      }
                    : undefined,
            responses: {
                ["200"]:
                    responseSchemas.length > 0
                        ? {
                              description: "Returned when the operation is successful.",
                              content: {
                                  [contentType]: {
                                      schema:
                                          responseSchemas.length > 1
                                              ? {
                                                    oneOf: responseSchemas,
                                                }
                                              : responseSchemas[0],
                                  },
                              },
                          }
                        : undefined,
                ["204"]:
                    responseSchemas.length === 0
                        ? {
                              description: "No Content",
                          }
                        : undefined,
                ["400"]:
                    requestSchemas.length > 0
                        ? {
                              description: "Returned when the request content is invalid.",
                              content: errorContent,
                          }
                        : undefined,
                ["401"]: authRequired
                    ? {
                          description: "Returned when a valid authentication token is not provided.",
                          content: errorContent,
                      }
                    : undefined,
                ["403"]: aclInfo
                    ? {
                          description: "Returned when the user does not have permission to perform this action.",
                          content: errorContent,
                      }
                    : undefined,
            },
            security,
            summary:
                summary &&
                StringUtils.findAndReplace(summary, {
                    serviceName: `${this.config.get("service_name")} -` || "Service -",
                }),
            tags,
            "x-name": name,
        };

        data[method] = opObject;

        this._builder.addPath(path, data);

        return this;
    }

    /**
     * Determines if the given type is a primitive or built-in class type.
     * @param value
     * @returns
     */
    private isBuiltInType(value: any): boolean {
        // Is it a null or undefined type?
        if (!value) {
            return true;
        }

        // Check against common built-in types
        const builtInTypes = [Object, Array, Boolean, Date, RegExp, Map, Number, Set, String, Promise, Function];
        return builtInTypes.some((type) => value === type);
    }

    /**
     * Creates a new SchemaObject given the specified class prototype.
     *
     * @param clazz The class prototype to build a schema object from.
     * @returns The schema object with all information derived from the given class prototype.
     */
    public createSchemaClass(clazz: any): oa.SchemaObject {
        const baseClass: any = Object.getPrototypeOf(clazz);
        const cache: any = Reflect.getMetadata("rrst:cacheTTL", clazz);
        const datastore: any = Reflect.getMetadata("rrst:datastore", clazz);
        const defaults: any = new clazz();
        const shardConfig: any = Reflect.getMetadata("rrst:shardConfig", clazz);
        const trackChanges: any = Reflect.getMetadata("rrst:trackChanges", clazz);

        const result: oa.SchemaObject = {};
        const docs: any = Reflect.getMetadata("rrst:docs", clazz) || {};
        const { description } = docs;
        result.description = description;
        result.type = "object";
        result.properties = {};
        result.required = [];

        if (baseClass) {
            result["x-baseClass"] = baseClass.fqn || baseClass.name;
        }
        if (cache) {
            result["x-cache"] = cache;
        }
        if (datastore) {
            result["x-datastore"] = datastore;
        }
        if (shardConfig) {
            result["x-shard"] = shardConfig;
        }
        if (trackChanges) {
            result["x-versioned"] = trackChanges;
        }

        const propertyNames: string[] = Object.getOwnPropertyNames(defaults);
        for (const member of propertyNames) {
            const docs: any = Reflect.getMetadata("rrst:docs", defaults, member) || {};
            const { description, example, format } = docs;
            const identifier: boolean = Reflect.getMetadata("rrst:isIdentifier", defaults, member);
            let typesInfo: any = Reflect.getMetadata("design:type", defaults, member);

            // Make sure type info is always expressed as an array
            if (!Array.isArray(typesInfo)) {
                typesInfo = [typesInfo];
            }

            const schemas: (oa.SchemaObject | oa.ReferenceObject)[] = [];
            for (const typeInfo of typesInfo) {
                if (typeInfo) {
                    schemas.push(
                        this.createSchemaObject(
                            typeInfo,
                            docs.default || defaults[member],
                            description,
                            example,
                            format,
                            identifier
                        )
                    );
                }
            }

            if (schemas.length > 1) {
                result.properties[member] = {
                    default: docs.default || defaults[member],
                    description,
                    example,
                    oneOf: schemas,
                };
            } else if (schemas.length === 1) {
                result.properties[member] = {
                    default: docs.default || defaults[member],
                    description,
                    example,
                    ...schemas[0],
                };
            }

            if (schemas.length > 0 && defaults[member] !== undefined) {
                result.required.push(member);
            }
        }

        return result;
    }

    /**
     * Creates a schema object for the given type.
     *
     * @param typeInfo
     * @param defaultValue
     * @param description
     * @param example
     * @param format
     * @param identifier
     * @returns
     */
    public createSchemaObject(
        typeInfo: any,
        defaultValue?: any,
        description?: string,
        example?: any,
        format?: string,
        identifier?: boolean
    ): oa.SchemaObject | oa.ReferenceObject {
        let result: oa.SchemaObject | oa.ReferenceObject = {
            default: defaultValue,
            description,
            example,
            format,
            type: typeInfo?.name,
        };

        if (identifier) {
            result["x-identifier"] = identifier;
        }

        // Generics (e.g. containers) are expressed as an array of types.
        if (Array.isArray(typeInfo)) {
            const contType: any = typeInfo[0];
            const subTypeInfo: any = typeInfo[1];

            // Set the container type as the primary schema type
            if (contType.name.toLowerCase() === "map") {
                result.type = "object";
            } else {
                result.type = contType.name.toLowerCase();
            }

            // Enums have a main type of `string`, whereas containers will be an `array`,
            if (contType.name.toLowerCase() === "string") {
                result.enum = Object.getOwnPropertyNames(subTypeInfo).map((key: string) => subTypeInfo[key]);
            } else if (contType.name.toLowerCase() === "array") {
                result.items = this.getSchemaReference(subTypeInfo.name) || this.createSchemaObject(subTypeInfo);
            } else if (contType.name.toLowerCase() === "map") {
                if (subTypeInfo.name.toLowerCase() !== "string") {
                    throw new Error("Maps in OpenAPI must have a key type of string.");
                }

                const valType: any = typeInfo[2];
                if (!valType) {
                    throw new Error("Map types require three arguments. e.g. `[Map, string, string]`");
                }

                // Maps are encoded as an `object` with additional properties whose type is the value type. In OpenAPI,
                // map keys must always be strings.
                result.type = "object";

                if (this.isBuiltInType(valType)) {
                    result.additionalProperties = {
                        type: valType.name.toLowerCase(),
                    };
                } else {
                    result.additionalProperties = this.getSchemaReference(valType.name);
                }
            } else {
                result["$ref"] = this.getSchemaReference(subTypeInfo.name)?.$ref;
            }
        } else if (this.isBuiltInType(typeInfo)) {
            // Convert the name to lowercase as that is compliant with OpenAPI
            if (typeInfo) {
                // Buffers need to be encoded as 'byte'
                if (typeInfo.name.toLowerCase() === "buffer") {
                    result.type = "string";
                    result.format = "byte";
                    // Date is a special case as it is represented as a string in OpenAPI with format "date"
                } else if (typeInfo.name.toLowerCase() === "date") {
                    result.type = "string";
                    result.format = "date";
                } else {
                    result.type = typeInfo.name.toLowerCase();
                }
            }
        } else {
            // Unfortunately the TypeInfo information obtained from reflection here is not the same as the one
            // that you get from the import itself, it's just a constructor, with all other metadata and
            // inheritance information gone. So we're going to do something uncooth and assume we can link
            // to a schema even if one doesn't exist at this very moment (the schema for this type may not have
            // been created yet).
            result = {
                $ref: `#/components/schemas/${typeInfo.fqn || typeInfo.name}`,
            };
        }

        return result;
    }

    /**
     * Returns a reference to an existing parameter defined in the OpenAPI specification for the given name.
     *
     * @param name The name of the parameter to find a reference for.
     * @returns The reference to the parameter with the given name, otherwise `undefined`.
     */
    public getParameterReference(name: string): oa.ReferenceObject | undefined {
        const components: oa.ComponentsObject | undefined = this.components;
        if (components && components.parameters && components.parameters[name]) {
            return {
                $ref: `#/components/parameters/${name}`,
            };
        }
        return undefined;
    }

    /**
     * Returns a reference to an existing schema defined in the OpenAPI specification for the given name.
     *
     * @param name The name of the schema to find a reference for.
     * @returns The reference to the schema with the given name, otherwise `undefined`.
     */
    public getSchemaReference(name: string): oa.ReferenceObject | undefined {
        const components: oa.ComponentsObject | undefined = this.components;
        if (components && components.schemas && components.schemas[name]) {
            return {
                $ref: `#/components/schemas/${name}`,
            };
        }
        return undefined;
    }

    /**
     * Merges a provided OpenAPI specification with this specification.
     * @param other The other OpenAPI spec object to merge.
     */
    public merge(other: any): void {
        if (!other) {
            return;
        }
        const options = {
            arrayMerge: (target, source, options) => {
                const destination = target.slice();
                source.forEach((item, index) => {
                    if (typeof destination[index] === "undefined") {
                        destination[index] = options.cloneUnlessOtherwiseSpecified(item, options);
                    } else if (options.isMergeableObject(item)) {
                        if (!_.find(destination, item)) {
                            destination.push(item);
                        }
                    }
                });
                return destination;
            },
        };
        const otherSpec: oa.OpenApiBuilder = oa.OpenApiBuilder.create(other);
        const merged: any = merge(this.getSpec(), otherSpec.getSpec(), options);
        this._builder = oa.OpenApiBuilder.create(merged);
    }
}
