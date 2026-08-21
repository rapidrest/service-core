///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2020-2026 Jean-Philippe Steinmetz
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
import "reflect-metadata";

export interface DocumentsData {
    default?: any;
    description?: string;
    example?: any;
    format?: "int32" | "int64" | "float" | "double" | "byte" | "binary" | "date" | "date-time" | "password" | string;
    summary?: string;
    tags?: string[];
}

/**
 * Provides a set of documentation data for a given class, property or function.
 *
 * @param value The default value.
 */
export function Document(value: DocumentsData) {
    return function (target: any, propertyKey?: string) {
        const docs: any = {
            ...(propertyKey
                ? Reflect.getMetadata("rrst:docs", target, propertyKey)
                : Reflect.getMetadata("rrst:docs", target)),
            ...value,
        };

        if (propertyKey) {
            Reflect.defineMetadata("rrst:docs", docs, target, propertyKey);
        } else {
            Reflect.defineMetadata("rrst:docs", docs, target);
        }
    };
}

/**
 * Provides a default value for property of a class.
 *
 * @param value The default value.
 */
export function Default(value: string) {
    return Document({
        default: value,
    });
}

/**
 * Provides a detailed describing the class, property or function.
 *
 * @param value The description of the class, property or function.
 */
export function Description(value: string) {
    return Document({
        description: value,
    });
}

/**
 * Provides a example representation of the property or function return value.
 *
 * @param value The example value.
 */
export function Example(value: any) {
    return Document({
        example: value,
    });
}

/**
 * Describes the underlying format of a class's property.
 *
 * @param value The format of the property's property.
 */
export function Format(
    value: "int32" | "int64" | "float" | "double" | "byte" | "binary" | "date" | "date-time" | "password" | string,
) {
    return Document({
        format: value,
    });
}

/**
 * Provides a brief summary about the class, property or function.
 *
 * @param value The summary of the class, property or function.
 */
export function Summary(value: string) {
    return Document({
        summary: value,
    });
}

/**
 * Provides a list of searchable tags associated with the property or function.
 *
 * @param value The list of searchable tags.
 */
export function Tags(value: string[]) {
    return Document({
        tags: value,
    });
}

/**
 * Stores runtime metadata about the typing information of a function's return value.
 *
 * @param types The optional return type(s) of the function. Can represent a single type (e.g. `MyClass`) or a union
 * of types (e.g. `string | number | null`). When describing a generic type such as a collection this
 * should be encoded as an array with the templated type as additional elements (e.g. `Array<MyClass>`
 * becomes `[[Array, MyClass]]`).
 */
export function Returns(types?: any | any[]) {
    return function (target: any, propertyKey: string) {
        const designInfo: any = Reflect.getMetadata("design:type", target, propertyKey);
        if (types) {
            // Make sure we always store an array
            types = Array.isArray(types) ? types : [types];
        }
        Reflect.defineMetadata("design:returntype", types !== undefined ? types : [designInfo], target, propertyKey);
    };
}

/**
 * The metadata key that `@TypeInfo` stores its type information under. Kept distinct from `design:type` (the
 * metadata TypeScript itself emits) so that other consumers of `design:type` — such as the `@Column` decorator's
 * SQL type inference — are never affected by the richer, API-facing type description `@TypeInfo` provides.
 */
const TYPE_INFO_KEY = "rrst:typeInfo";

/**
 * Stores runtime metadata about the typing information of a class property.
 *
 * @param types The optional primary type(s) of the property. Can represent a single type (e.g. `MyClass`) or a union
 * of types (e.g. `string | number | null`). When describing a generic type such as a collection this
 * should be encoded as an array with the templated type as additional elements (e.g. `Array<MyClass>`
 * becomes `[[Array, MyClass]]`).
 */
export function TypeInfo(types?: any | any[]) {
    return function (target: any, propertyKey: string) {
        const designInfo: any = Reflect.getMetadata("design:type", target, propertyKey);
        if (types) {
            // Make sure we always store an array
            types = Array.isArray(types) ? types : [types];
        }
        Reflect.defineMetadata(TYPE_INFO_KEY, types !== undefined ? types : [designInfo], target, propertyKey);
    };
}

/**
 * Retrieves the typing information of a class property or function, preferring the richer description provided by
 * `@TypeInfo` and falling back to TypeScript's own `design:type` reflection metadata when `@TypeInfo` was not
 * applied.
 *
 * @param target The class prototype (or class, for static members) to retrieve type information for.
 * @param propertyKey The name of the property or function to retrieve type information for.
 */
export function getTypeInfo(target: any, propertyKey: string): any {
    const typeInfo: any = Reflect.getMetadata(TYPE_INFO_KEY, target, propertyKey);
    return typeInfo !== undefined ? typeInfo : Reflect.getMetadata("design:type", target, propertyKey);
}
