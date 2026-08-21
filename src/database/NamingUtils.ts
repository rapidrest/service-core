///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2020-2026 Jean-Philippe Steinmetz. All rights reserved.
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
import "reflect-metadata";
import type { EntityOptions } from "../decorators/PersistenceDecorators.js";

/**
 * Converts a string into snake_case.
 *
 * Note: This function is intentionally identical in behavior to TypeORM's `snakeCase` utility so that
 * collection/table names derived from class names remain stable for existing deployments.
 *
 * @param str The string to convert.
 */
export function snakeCase(str: string): string {
    return (
        str
            // ABc -> a_bc
            .replace(/([A-Z])([A-Z])([a-z])/g, "$1_$2$3")
            // aC -> a_c
            .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
            .toLowerCase()
    );
}

/**
 * Resolves the name of the database collection (or table) that records of the given model class are stored in.
 *
 * The name is resolved using the following rules:
 * 1. The nearest class in the inheritance chain (starting with `clazz` itself) that specifies an explicit
 * entity name via the `@Entity(options)` decorator.
 * 2. Otherwise, the most ancestral class in the inheritance chain that declares its own `@DataStore` binding.
 * This ensures that `@ChildEntity` subclasses are stored in the same collection as their parent entity
 * (single collection inheritance).
 * 3. Otherwise, the snake_case form of the class name.
 *
 * @param clazz The model class to resolve the collection name for.
 */
export function resolveCollectionName(clazz: any): string {
    // Rule 1: nearest explicit entity name
    for (let c = clazz; c && c !== Function.prototype; c = Object.getPrototypeOf(c)) {
        const options: EntityOptions | undefined = Reflect.getOwnMetadata("rrst:entityOptions", c);
        if (options && options.name) {
            return options.name;
        }
    }

    // Rule 2: most ancestral class owning a datasource binding
    let owner: any = undefined;
    for (let c = clazz; c && c !== Function.prototype; c = Object.getPrototypeOf(c)) {
        if (Reflect.getOwnMetadata("rrst:datasource", c)) {
            owner = c;
        }
    }

    // Rule 3: fall back to the class itself
    return snakeCase((owner ?? clazz).name);
}
