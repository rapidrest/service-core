///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2020-2026 Jean-Philippe Steinmetz. All rights reserved.
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
import type { Repository } from "typeorm";
import { MongoRepository } from "../database/MongoRepository.js";
import { ApiError, ClassLoader, Logger, StringUtils } from "@rapidrest/core";
import "reflect-metadata";
import { isEmpty } from "lodash-es";
import { RecoverableBaseEntity } from "./RecoverableBaseEntity.js";
import { ApiErrorMessages, ApiErrors } from "../ApiErrors.js";
import { ColumnInfo, getColumnMetadata } from "../decorators/PersistenceDecorators.js";

const logger = Logger();
const REGEX_QUERY_PARAM_VALUE: RegExp = new RegExp(/^([a-zA-Z]+)\((.*)\)$/, "i");
// Anchored at the start so these only match the intended reserved parameter names/prefixes and not any
// field that merely contains one as a substring (e.g. "sortOrder", "rateLimit", "packageId", "homepage").
const REGEX_RESERVED_QUERY_PARAMS: RegExp = new RegExp("^(jwt_|oauth_|auth_|cache).*", "i");
const REGEX_QUERY_LIMITS: RegExp = new RegExp("^(limit|page|sort)$", "i");
const REGEX_QUERY_SORT_STRING: RegExp = new RegExp(/^\{.*\}$/, "i");

/** Default number of records returned by a search query when no `limit` is specified. Shared by both backends. */
export const DEFAULT_PAGE_SIZE = 100;
/** Maximum number of records a search query may request via `limit`, regardless of provider. Shared by both backends. */
export const MAX_PAGE_SIZE = 1000;

/** The operator names recognized by the `op(value)` query syntax. Anything else is rejected with a 400. */
const KNOWN_OPERATORS: ReadonlySet<string> = new Set([
    "eq",
    "ne",
    "not",
    "gt",
    "gte",
    "lt",
    "lte",
    "in",
    "nin",
    "like",
    "regex",
    "range",
    "exists",
]);

/** Maximum nesting depth accepted for a `$or` array or a `QueryNode` tree, to bound recursion. */
const MAX_QUERY_DEPTH = 8;
/** Maximum number of OR branches / predicate nodes a single query may expand to, to bound total work. */
const MAX_QUERY_NODES = 256;

/**
 * A single field comparison leaf in a search query AST (see `QueryNode`). `value` may be a raw string (in which
 * case it is coerced the same way an `op(value)` query-parameter operand is - including `me` substitution and
 * declared-type validation) or an already-typed JS value (used as-is, after an operator-injection check).
 */
export interface PredicateNode {
    kind: "predicate";
    field: string;
    op: "eq" | "ne" | "gt" | "gte" | "lt" | "lte" | "in" | "nin" | "range" | "like" | "regex" | "exists";
    value: unknown;
}

/**
 * A boolean grouping node in a search query AST: combines child nodes with `and`/`or`, optionally negated.
 * Negation is supported when compiling to MongoDB (via `$nor`) but not against the SQL `find()`-based `where`
 * (see `buildQueryFromNode`).
 */
export interface GroupNode {
    kind: "group";
    op: "and" | "or";
    negated?: boolean;
    children: QueryNode[];
}

/**
 * A tree-shaped search query, for boolean nesting the flat `op(value)` query-parameter form cannot express (e.g.
 * `(a AND b) OR (c AND d)`). See `ModelUtils.buildQueryFromNode`.
 */
export type QueryNode = GroupNode | PredicateNode;

/**
 * Utility class for working with data model classes.
 *
 * @author Jean-Philippe Steinmetz
 */
export class ModelUtils {
    /** The `typeorm` module containing the query operators used to build SQL queries. */
    private static typeOrm: any | undefined;
    private static idPropertyCache: Map<any, string[]> = new Map();
    private static readOnlyPropertyCache: Map<any, string[]> = new Map();
    private static columnTypeCache: Map<any, Map<string, any>> = new Map();

    /**
     * Provides the `typeorm` module to use when building SQL queries. This is called automatically when a SQL
     * datasource connection is established.
     *
     * @param module The `typeorm` module.
     */
    public static setTypeOrm(module: any): void {
        ModelUtils.typeOrm = module;
    }

    /**
     * Returns the `typeorm` module, throwing an error if it has not been provided.
     */
    public static get orm(): any {
        if (!ModelUtils.typeOrm) {
            throw new Error(
                "SQL query construction requires the optional peer dependency 'typeorm' but no SQL datasource has been initialized.",
            );
        }
        return ModelUtils.typeOrm;
    }

    /**
     * Retrieves a list of all of the specified class's properties that have the @Identifier decorator applied.
     *
     * @param modelClass The class definition to search for identifiers from.
     * @returns The list of all property names that have the @Identifier decorator applied.
     */
    public static getIdPropertyNames(modelClass: any): string[] {
        const results: string[] = [];

        if (ModelUtils.idPropertyCache.has(modelClass)) {
            return ModelUtils.idPropertyCache.get(modelClass) as string[];
        }

        // The props don't show up correctly on the class def. So instantiate a dummy object that we can read the props
        // from and look for identifiers.
        let proto: any = Object.getPrototypeOf(new modelClass());
        while (proto) {
            const props: string[] = Object.getOwnPropertyNames(proto);
            for (const prop of props) {
                const isIdentifier: boolean = Reflect.getMetadata("rrst:isIdentifier", proto, prop);
                if (isIdentifier) {
                    results.push(prop);
                }
            }

            proto = Object.getPrototypeOf(proto);
        }

        // Cache the results so we're not always having to walk the class structure
        ModelUtils.idPropertyCache.set(modelClass, results);

        return results;
    }

    /**
     * Retrieves a list of all of the specified class's properties that have the @ReadOnly decorator applied.
     *
     * @param modelClass The class definition to search for read-only properties from.
     * @returns The list of all property names that have the @ReadOnly decorator applied.
     */
    public static getReadOnlyPropertyNames(modelClass: any): string[] {
        const results: string[] = [];

        if (ModelUtils.readOnlyPropertyCache.has(modelClass)) {
            return ModelUtils.readOnlyPropertyCache.get(modelClass) as string[];
        }

        // The props don't show up correctly on the class def. So instantiate a dummy object that we can read the props
        // from and look for read-only fields.
        let proto: any = Object.getPrototypeOf(new modelClass());
        while (proto) {
            const props: string[] = Object.getOwnPropertyNames(proto);
            for (const prop of props) {
                const isReadOnly: boolean = Reflect.getMetadata("rrst:readOnly", proto, prop);
                if (isReadOnly) {
                    results.push(prop);
                }
            }

            proto = Object.getPrototypeOf(proto);
        }

        // Cache the results so we're not always having to walk the class structure
        ModelUtils.readOnlyPropertyCache.set(modelClass, results);

        return results;
    }

    /**
     * Resolves the declared type of a model property, from an explicit `type` override on `@Column` or (falling
     * back) the TypeScript design-time type reflected at decoration time. Returns `undefined` when `modelClass`
     * is not provided or declares no column metadata for `property` - callers must fall back to a heuristic in
     * that case, the same way `coerceOperand` does.
     */
    private static resolvePropertyType(modelClass: any, property: string | undefined): any {
        if (!modelClass || !property) {
            return undefined;
        }

        let byProperty: Map<string, any> | undefined = ModelUtils.columnTypeCache.get(modelClass);
        if (!byProperty) {
            byProperty = new Map();
            for (const column of getColumnMetadata(modelClass)) {
                byProperty.set(column.propertyName, column.options.type ?? column.designType);
            }
            ModelUtils.columnTypeCache.set(modelClass, byProperty);
        }

        return byProperty.get(property);
    }

    /**
     * Returns the set of property names a `sort` query parameter may reference for `modelClass`, or `undefined`
     * if `modelClass` declares no column metadata at all - in which case sort keys are accepted unvalidated
     * (the same permissive fallback `coerceOperand` uses when no type metadata is available).
     */
    private static getSortablePropertyNames(modelClass: any): Set<string> | undefined {
        if (!modelClass) {
            return undefined;
        }
        const columns: ColumnInfo[] = getColumnMetadata(modelClass);
        if (columns.length === 0) {
            return undefined;
        }
        return new Set(columns.map((c) => c.propertyName));
    }

    /**
     * Builds a query object for use with `find` functions of the given repository for retrieving objects matching the
     * specified unique identifier.
     *
     * @param repo The repository to build the query for.
     * @param modelClass The class definition of the data model to build a search query for.
     * @param id The unique identifier to search for.
     * @param version The version number of the document to search for.
     * @param includeDeleted Set to false to exclude soft-deleted `RecoverableBaseEntity` records from matching.
     * Defaults to true (matches regardless of deleted state) to preserve existing lookup/validation behavior;
     * callers that expose a record by id to an API client (e.g. `findOne`, `exists`) should pass false so a
     * soft-deleted record doesn't remain fully readable/resurrectable, the same way `buildSearchQuery` already
     * excludes deleted records by default for list-style queries.
     * @returns An object that can be passed to a TypeORM `find` function.
     */
    public static buildIdSearchQuery<T extends {}>(
        repo: Repository<T> | MongoRepository<T> | undefined,
        modelClass: any,
        id: any | any[],
        version?: number,
        includeDeleted: boolean = true,
    ): any {
        if (repo instanceof MongoRepository) {
            return ModelUtils.buildIdSearchQueryMongo(modelClass, id, version, includeDeleted);
        } else {
            return ModelUtils.buildIdSearchQuerySQL(modelClass, id, version, includeDeleted);
        }
    }

    /**
     * Builds a TypeORM compatible query object for use in `find` functions for retrieving objects matching the
     * specified unique identifier.
     *
     * @param modelClass The class definition of the data model to build a search query for.
     * @param id The unique identifier to search for.
     * @param version The version number of the document to search for.
     * @returns An object that can be passed to a TypeORM `find` function.
     */
    public static buildIdSearchQuerySQL(
        modelClass: any,
        id: any | any[],
        version?: number,
        includeDeleted: boolean = true,
    ): any {
        const props: string[] = ModelUtils.getIdPropertyNames(modelClass);
        const isRecoverable: boolean = new modelClass() instanceof RecoverableBaseEntity;

        // Create the where in SQL syntax. We only care about one of the identifier field's matching.
        // e.g. WHERE idField1 = :idField1 OR idField2 = :idField2 ...
        const where: any = [];
        for (const prop of props) {
            const q: any = { [prop]: Array.isArray(id) ? ModelUtils.orm.In(id) : id };
            if (version !== undefined) {
                q.version = version;
            }
            // By default we don't want an id-based lookup to match a soft-deleted recoverable object,
            // matching the same default `buildSearchQuery` applies to list-style queries.
            if (isRecoverable && !includeDeleted) {
                q.deleted = false;
            }
            where.push(q);
        }

        return { where };
    }

    /**
     * Builds a MongoDB compatible query object for use in `find` functions for retrieving objects matching the
     * specified unique identifier.
     *
     * @param modelClass The class definition of the data model to build a search query for.
     * @param id The unique identifier to search for.
     * @param version The version number of the document to search for.
     * @param includeDeleted Set to true to also match soft-deleted `RecoverableBaseEntity` records.
     * @returns An object that can be passed to a MongoDB `find` function.
     */
    public static buildIdSearchQueryMongo(
        modelClass: any,
        id: any | any[],
        version?: number,
        includeDeleted: boolean = true,
    ): any {
        const props: string[] = ModelUtils.getIdPropertyNames(modelClass);
        const isRecoverable: boolean = new modelClass() instanceof RecoverableBaseEntity;

        // We want to performa case-insensitive search. We used to convert strings to RegEx but this is _very_
        // slow. Instead, we use case-insenstive indexes that are configured using the `collation` option. Now
        // we only need to pass in the raw string. So we skip this section but we retain the code for historical
        // reasons.
        // See: https://www.mongodb.com/docs/v7.0/core/index-case-insensitive/
        // if (Array.isArray(id)) {
        //     for (let i = 0; i < id.length; i++) {
        //         if (typeof id[i] === "string") {
        //             id[i] = new RegExp("^" + id[i].replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "$", "i");
        //         }
        //     }
        // } else if (typeof id === "string") {
        //     id = new RegExp("^" + id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "$", "i");
        // }

        // Create the where in Mongo filter syntax. We only care about one of the identifier field's matching.
        const query: any[] = [];
        for (const prop of props) {
            const q: any = { [prop]: Array.isArray(id) ? { $in: id } : id };
            if (version !== undefined) {
                q.version = version;
            }
            // By default we don't want an id-based lookup to match a soft-deleted recoverable object,
            // matching the same default `buildSearchQuery` applies to list-style queries.
            if (isRecoverable && !includeDeleted) {
                q.deleted = false;
            }
            query.push(q);
        }

        return { $or: query };
    }

    /**
     * Resolves a raw, single-value operand (already unwrapped from any `op(...)` syntax) to a properly-typed
     * native value: `me` is substituted for the requesting user's uid, and the result is otherwise coerced
     * according to `property`'s declared type on `modelClass` (falling back to a JSON/Date/string heuristic when
     * no column metadata is available for it). Used for every scalar operand on both backends - including each
     * element of `in()`/`nin()`/`range()` - so type coercion, `me` substitution and operator-injection rejection
     * are applied uniformly everywhere a client-supplied value enters a query, on both backends.
     *
     * @throws {ApiError} If `raw` is `me` with no authenticated user, if a typed column rejects an unparseable
     * operand, or if the coerced value contains a hidden MongoDB operator/dotted key.
     */
    private static coerceOperand(raw: string, modelClass: any, property: string | undefined, user: any): any {
        if (raw === "me") {
            if (!user) {
                throw new ApiError(
                    ApiErrors.SEARCH_INVALID_ME_REFERENCE,
                    403,
                    ApiErrorMessages.SEARCH_INVALID_ME_REFERENCE,
                );
            }
            return user.uid;
        }

        const type: any = ModelUtils.resolvePropertyType(modelClass, property);
        let result: any;

        if (type !== undefined) {
            result = ModelUtils.coerceToType(raw, type, property as string);
        } else {
            // No column metadata available for this property - fall back to the legacy heuristic: try JSON
            // (covers numbers/booleans/null/objects/arrays), then a date, then leave it as a plain string. This
            // is the one path that still risks the "Mar 5" ambiguity (a text value that happens to look like a
            // date gets silently reinterpreted as one) - kept only for callers that don't supply column
            // metadata (e.g. `modelClass` is undefined, or the property isn't declared via `@Column`). A
            // string-typed column skips the Date attempt entirely once metadata IS available - see
            // `coerceToType`.
            try {
                result = JSON.parse(raw);
            } catch (err) {
                const asDate: Date = new Date(raw);
                result = isNaN(asDate.valueOf()) ? raw : asDate;
            }
        }

        ModelUtils.assertNoOperatorInjection(result);
        return result;
    }

    /**
     * Coerces a raw operand string to `type` (an explicit `@Column({type})` override or a reflected TypeScript
     * design type), rejecting operands that don't parse as that type rather than silently guessing.
     */
    private static coerceToType(raw: string, type: any, property: string): any {
        if (raw === "null") {
            // The JSON `null` literal is valid for any declared type (e.g. `eq(null)`); the eq/ne callers
            // special-case the resulting `null` via IsNull()/$eq:null rather than this function.
            return null;
        }

        if (type === Date || type === "date" || type === "datetime" || type === "timestamp") {
            const value: Date = new Date(raw);
            if (isNaN(value.valueOf())) {
                throw ModelUtils.invalidOperandError(raw, property, "date");
            }
            return value;
        }

        if (
            type === Number ||
            ["int", "integer", "float", "double", "decimal", "numeric", "bigint", "smallint", "tinyint"].includes(
                type,
            )
        ) {
            const value: number = Number(raw);
            if (raw.trim() === "" || isNaN(value)) {
                throw ModelUtils.invalidOperandError(raw, property, "number");
            }
            return value;
        }

        if (type === Boolean || type === "boolean" || type === "bool") {
            const lower: string = raw.toLowerCase();
            if (lower === "true") return true;
            if (lower === "false") return false;
            throw ModelUtils.invalidOperandError(raw, property, "boolean");
        }

        // String (and any other/unrecognized declared type): never attempt Date/number parsing - this is what
        // fixes the "Mar 5" bug, where a text search value that happened to look like a date was silently
        // reinterpreted as one.
        return raw;
    }

    private static invalidOperandError(raw: string, property: string, type: string): ApiError {
        return new ApiError(
            ApiErrors.SEARCH_INVALID_OPERAND_TYPE,
            400,
            StringUtils.findAndReplace(ApiErrorMessages.SEARCH_INVALID_OPERAND_TYPE, { value: raw, field: property, type }),
        );
    }

    /**
     * Coerces an already-typed AST predicate value (see `QueryNode`): a string operand is routed through
     * `coerceOperand` (type coercion, `me` substitution, injection guard) exactly like the flat `op(value)`
     * form; any other value is assumed to already be correctly typed by the caller and is only checked for a
     * hidden operator/dotted key.
     */
    private static coerceNodeValue(value: unknown, modelClass: any, property: string, user: any): any {
        if (typeof value === "string") {
            return ModelUtils.coerceOperand(value, modelClass, property, user);
        }
        ModelUtils.assertNoOperatorInjection(value);
        return value;
    }

    /**
     * Recursively verifies that no key in the given value (at any depth, including keys of objects nested inside
     * arrays) is a MongoDB operator (starts with `$`) or uses dot-notation field addressing (contains `.`). Client
     * input is only ever meant to supply plain field values/comparison operands — never raw Mongo query operators —
     * so any such key indicates an attempt to inject arbitrary query behavior (e.g. `$where`, `$expr`, or reaching
     * into a field the API doesn't expose via dot-notation). Applied to every coerced operand on both backends -
     * `Equal(JSON.parse(param))`-style SQL operators are constructed by TypeORM rather than interpreted from the
     * operand directly, but a client-supplied object operand should still be rejected consistently on both
     * backends rather than left to whatever TypeORM happens to do with it.
     *
     * @param value The value to check, typically a parsed query parameter.
     * @throws {ApiError} If an operator-like or dotted key is found anywhere in `value`.
     */
    private static assertNoOperatorInjection(value: any): void {
        if (Array.isArray(value)) {
            for (const item of value) {
                ModelUtils.assertNoOperatorInjection(item);
            }
        } else if (value && typeof value === "object") {
            for (const key of Object.keys(value)) {
                if (key.startsWith("$") || key.includes(".")) {
                    throw new ApiError(ApiErrors.INVALID_REQUEST, 400, ApiErrorMessages.INVALID_REQUEST);
                }
                ModelUtils.assertNoOperatorInjection(value[key]);
            }
        }
    }

    /** Maximum accepted length of a client-supplied `like()`/`regex()` search pattern. */
    private static readonly MAX_PATTERN_LENGTH = 100;

    /**
     * Best-effort check for regex patterns vulnerable to catastrophic backtracking (ReDoS): patterns that are
     * unreasonably long, that contain a quantified group whose contents are themselves quantified (e.g. `(a+)+`,
     * `(a*)*`), or a quantified group containing alternation (e.g. `(a|a)*`, `(a|ab)*`) - both classic shapes
     * that cause exponential backtracking in JS's (and SQLite's, since the `regex()` SQL operator is backed by a
     * JS `RegExp` - see `registerRegexpFunction` in `TypeOrmSupport.ts`) regex engine. This is not an exhaustive
     * defense; it catches the common cases a client would realistically send. `like()` no longer accepts raw
     * regex (it compiles glob syntax instead - see `globToRegExpSource`), so this now guards only the explicit
     * `regex()` operator.
     *
     * Public so the SQLite `REGEXP` custom function (registered per-connection in `TypeOrmSupport.ts`) can apply
     * the same guard at query-execution time, since a pattern reaching that function didn't necessarily pass
     * through this class's own query builders (e.g. a raw `Raw()`/QueryBuilder use elsewhere).
     */
    public static isUnsafeRegexPattern(pattern: string): boolean {
        if (pattern.length > ModelUtils.MAX_PATTERN_LENGTH) {
            return true;
        }
        return /\([^()]*[+*]\)[+*{]/.test(pattern) || /\([^()]*\|[^()]*\)[+*{]/.test(pattern);
    }

    /**
     * Translates a client-supplied glob pattern (`*` = any sequence, `?` = any single character) to a SQL
     * `LIKE` pattern. Any `%`/`_` already present in the glob source is passed through unescaped (matching this
     * operator's pre-existing behavior before glob support was added) - a client wanting to match a literal `%`
     * or `_` cannot fully escape it, a narrow, documented limitation rather than a regression.
     */
    private static globToLike(glob: string): string {
        let result = "";
        for (const ch of glob) {
            if (ch === "*") result += "%";
            else if (ch === "?") result += "_";
            else result += ch;
        }
        return result;
    }

    /**
     * Translates a client-supplied glob pattern into a fully-escaped, anchored regular expression source string
     * for use with MongoDB's `$regex`, so glob syntax behaves identically on both backends.
     */
    private static globToRegExpSource(glob: string): string {
        let result = "";
        for (const ch of glob) {
            if (ch === "*") result += ".*";
            else if (ch === "?") result += ".";
            else result += StringUtils.escapeRegExp(ch);
        }
        return `^${result}$`;
    }

    /**
     * Compiles a validated `regex()` pattern to a driver-appropriate case-insensitive match expression. Only
     * PostgreSQL (`~*`), MySQL/MariaDB (`REGEXP`) and the `better-sqlite3` driver (via a `REGEXP` function
     * registered per-connection - see `registerRegexpFunction` in `TypeOrmSupport.ts`) are supported; any other
     * driver rejects the operator outright rather than silently falling back to something incorrect.
     */
    private static compileSqlRegex(pattern: string, driverType?: string): any {
        const { Raw } = ModelUtils.orm;
        switch (driverType) {
            case "postgres":
            case "cockroachdb":
                return Raw((alias: string) => `${alias} ~* :pattern`, { pattern });
            case "mysql":
            case "mariadb":
                return Raw((alias: string) => `${alias} REGEXP :pattern`, { pattern });
            case "better-sqlite3":
            case "sqlite":
                return Raw((alias: string) => `${alias} REGEXP :pattern`, { pattern });
            default:
                throw new ApiError(
                    ApiErrors.SEARCH_OPERATOR_NOT_SUPPORTED,
                    400,
                    StringUtils.findAndReplace(ApiErrorMessages.SEARCH_OPERATOR_NOT_SUPPORTED, { operator: "regex" }),
                );
        }
    }

    /**
     * Given a string containing a parameter value and/or a comparison operation return a TypeORM compatible find value.
     * e.g.
     * Given the string "myvalue" will return an Eq("myvalue") object.
     * Given the string "Like(myvalue)" will return an Like("myvalue") object.
     *
     * @param param
     */
    private static getQueryParamValue(
        param: any,
        modelClass: any,
        property: string,
        user: any,
        exactMatch: boolean,
        driverType?: string,
    ): any {
        if (typeof param === "string") {
            const { Equal, MoreThan, MoreThanOrEqual, In, ILike, LessThan, LessThanOrEqual, Not, Between, IsNull } =
                ModelUtils.orm;
            // The value of each param can optionally have the operation included. If no operator is included Eq is
            // always assumed.
            // e.g. ?param1=eq(value)&param2=not(value)&param3=gt(value)
            const matches: RegExpMatchArray | null = param.match(REGEX_QUERY_PARAM_VALUE);
            if (matches) {
                const opName: string = matches[1].toLowerCase();
                const operand: string = matches[2];

                if (!KNOWN_OPERATORS.has(opName)) {
                    // The literal-value escape hatch is `eq(...)`: `?title=eq(Report(final))` still parses
                    // correctly here since REGEX_QUERY_PARAM_VALUE is greedy, so a field value that happens to
                    // look like `name(args)` remains searchable.
                    throw new ApiError(
                        ApiErrors.SEARCH_UNKNOWN_OPERATOR,
                        400,
                        StringUtils.findAndReplace(ApiErrorMessages.SEARCH_UNKNOWN_OPERATOR, { operator: matches[1] }),
                    );
                }

                switch (opName) {
                    case "eq": {
                        const value: any = ModelUtils.coerceOperand(operand, modelClass, property, user);
                        // `Equal(null)` compiles to `column = NULL`, which standard SQL NULL semantics always
                        // evaluate to unknown/false (never true), regardless of the column's actual value -
                        // TypeORM requires the dedicated `IsNull()` operator to produce `column IS NULL`.
                        return value === null ? IsNull() : Equal(value);
                    }
                    case "gt":
                        return MoreThan(ModelUtils.coerceOperand(operand, modelClass, property, user));
                    case "gte":
                        return MoreThanOrEqual(ModelUtils.coerceOperand(operand, modelClass, property, user));
                    case "in": {
                        const args: any[] = operand
                            .split(",")
                            .map((raw) => ModelUtils.coerceOperand(raw, modelClass, property, user));
                        return In(args);
                    }
                    case "like":
                        return ILike(ModelUtils.globToLike(operand));
                    case "regex": {
                        if (ModelUtils.isUnsafeRegexPattern(operand)) {
                            throw new ApiError(ApiErrors.INVALID_REQUEST, 400, ApiErrorMessages.INVALID_REQUEST);
                        }
                        return ModelUtils.compileSqlRegex(operand, driverType);
                    }
                    case "lt":
                        return LessThan(ModelUtils.coerceOperand(operand, modelClass, property, user));
                    case "lte":
                        return LessThanOrEqual(ModelUtils.coerceOperand(operand, modelClass, property, user));
                    case "ne":
                    case "not": {
                        // Same NULL-semantics gap as "eq" above, mirrored: `Not(null)` compiles to
                        // `column != NULL`, which SQL also always evaluates to unknown/false - the correct
                        // "has a value" query is `Not(IsNull())`, producing `column IS NOT NULL`.
                        const value: any = ModelUtils.coerceOperand(operand, modelClass, property, user);
                        return value === null ? Not(IsNull()) : Not(value);
                    }
                    case "nin": {
                        const args: any[] = operand
                            .split(",")
                            .map((raw) => ModelUtils.coerceOperand(raw, modelClass, property, user));
                        return Not(In(args));
                    }
                    case "range": {
                        const args: string[] = operand.split(",");
                        if (args.length !== 2) {
                            const msg: string = StringUtils.findAndReplace(ApiErrorMessages.SEARCH_INVALID_RANGE, {
                                value: operand,
                                length: args.length,
                            });
                            throw new ApiError(ApiErrors.SEARCH_INVALID_RANGE, 400, msg);
                        }
                        const lower: any = ModelUtils.coerceOperand(args[0], modelClass, property, user);
                        const upper: any = ModelUtils.coerceOperand(args[1], modelClass, property, user);
                        return Between(lower, upper);
                    }
                    case "exists": {
                        const wantsExists: boolean = operand.trim().toLowerCase() === "true";
                        return wantsExists ? Not(IsNull()) : IsNull();
                    }
                    default:
                        // Unreachable: opName was already validated against KNOWN_OPERATORS above.
                        throw new Error(`Unhandled search operator: ${opName}`);
                }
            } else {
                const coerced: any = ModelUtils.coerceOperand(param, modelClass, property, user);
                if (!exactMatch && typeof coerced === "string") {
                    return ILike(`%${coerced}%`);
                }
                return coerced === null ? IsNull() : Equal(coerced);
            }
        } else {
            // A non-string value only reaches here when the caller already parsed the raw query into native
            // types itself (mirrors the equivalent Mongo case below) - still validated for a hidden operator.
            ModelUtils.assertNoOperatorInjection(param);
            return param;
        }
    }

    /**
     * Given a string containing a parameter value and/or a comparison operation return a MongoDB compatible find value.
     * e.g.
     * Given the string "myvalue" will return an `"myvalue"` object.
     * Given the string "not(myvalue)" will return an `{ $ne: "myvalue" }` object.
     *
     * @param param
     */
    private static getQueryParamValueMongo(
        param: any,
        modelClass: any,
        property: string,
        user: any,
        exactMatch: boolean,
    ): any {
        if (typeof param === "string") {
            // The value of each param can optionally have the operation included. If no operator is included Eq is
            // always assumed.
            // e.g. ?param1=eq(value)&param2=not(value)&param3=gt(value)
            const matches: RegExpMatchArray | null = param.match(REGEX_QUERY_PARAM_VALUE);
            if (matches) {
                const opName: string = matches[1].toLowerCase();
                const operand: string = matches[2];

                if (!KNOWN_OPERATORS.has(opName)) {
                    throw new ApiError(
                        ApiErrors.SEARCH_UNKNOWN_OPERATOR,
                        400,
                        StringUtils.findAndReplace(ApiErrorMessages.SEARCH_UNKNOWN_OPERATOR, { operator: matches[1] }),
                    );
                }

                switch (opName) {
                    case "eq":
                        return ModelUtils.coerceOperand(operand, modelClass, property, user);
                    case "gt":
                        return { $gt: ModelUtils.coerceOperand(operand, modelClass, property, user) };
                    case "gte":
                        return { $gte: ModelUtils.coerceOperand(operand, modelClass, property, user) };
                    case "in": {
                        const args: any[] = operand
                            .split(",")
                            .map((raw) => ModelUtils.coerceOperand(raw, modelClass, property, user));
                        return { $in: args };
                    }
                    case "nin": {
                        const args: any[] = operand
                            .split(",")
                            .map((raw) => ModelUtils.coerceOperand(raw, modelClass, property, user));
                        return { $nin: args };
                    }
                    case "like": {
                        const pattern: string = ModelUtils.globToRegExpSource(operand);
                        return { $regex: pattern, $options: "i" };
                    }
                    case "regex": {
                        if (ModelUtils.isUnsafeRegexPattern(operand)) {
                            throw new ApiError(ApiErrors.INVALID_REQUEST, 400, ApiErrorMessages.INVALID_REQUEST);
                        }
                        return { $regex: operand, $options: "i" };
                    }
                    case "lt":
                        return { $lt: ModelUtils.coerceOperand(operand, modelClass, property, user) };
                    case "lte":
                        return { $lte: ModelUtils.coerceOperand(operand, modelClass, property, user) };
                    case "ne":
                        return { $ne: ModelUtils.coerceOperand(operand, modelClass, property, user) };
                    case "not": {
                        // MongoDB's `$not` accepts only an operator expression or a regex - a bare scalar (e.g.
                        // `{ $not: "somestring" }`) is rejected by the server rather than matching zero rows.
                        // Compile scalar negation to `$ne` instead, reserving `$not` for an actual `RegExp`
                        // operand (kept for defensiveness; `like()`/`regex()` above compile to `$regex` objects,
                        // not live `RegExp` instances, so this branch is not normally reached in practice).
                        const value: any = ModelUtils.coerceOperand(operand, modelClass, property, user);
                        return value instanceof RegExp ? { $not: value } : { $ne: value };
                    }
                    case "range": {
                        const args: string[] = operand.split(",");
                        if (args.length !== 2) {
                            const msg: string = StringUtils.findAndReplace(ApiErrorMessages.SEARCH_INVALID_RANGE, {
                                value: operand,
                                length: args.length,
                            });
                            throw new ApiError(ApiErrors.SEARCH_INVALID_RANGE, 400, msg);
                        }
                        const gte: any = ModelUtils.coerceOperand(args[0], modelClass, property, user);
                        const lte: any = ModelUtils.coerceOperand(args[1], modelClass, property, user);
                        return { $gte: gte, $lte: lte };
                    }
                    case "exists": {
                        const wantsExists: boolean = operand.trim().toLowerCase() === "true";
                        return { $exists: wantsExists };
                    }
                    default:
                        // Unreachable: opName was already validated against KNOWN_OPERATORS above.
                        throw new Error(`Unhandled search operator: ${opName}`);
                }
            } else {
                const coerced: any = ModelUtils.coerceOperand(param, modelClass, property, user);
                if (!exactMatch && typeof coerced === "string") {
                    return { $regex: StringUtils.escapeRegExp(coerced), $options: "i" };
                }
                return coerced;
            }
        } else {
            // A non-string value only reaches here when the caller already parsed the raw query into native
            // types itself (e.g. the `q` base64-encoded JSON query parameter in RouteUtils.wrapMiddleware) —
            // it never passed through the string-only checks above, so it must be validated here instead.
            // Without this, a client could smuggle a raw Mongo operator (e.g. `{"$ne": null}`) straight into
            // the query by supplying it as a JSON object rather than an `op(value)`-encoded string.
            ModelUtils.assertNoOperatorInjection(param);
            return param;
        }
    }

    /**
     * Extracts the `$match` stage from either shape `buildSearchQueryMongo` can return (a pipeline array or a
     * flattened `{$match, $sort}` object).
     */
    private static extractMatch(pipelineOrObject: any): any {
        if (Array.isArray(pipelineOrObject)) {
            return pipelineOrObject.length > 0 ? pipelineOrObject[0]["$match"] : undefined;
        }
        return pipelineOrObject ? pipelineOrObject["$match"] : undefined;
    }

    /**
     * Normalizes the return value of `buildSearchQueryMongo` to a single shape: a full aggregation pipeline.
     * `buildSearchQueryMongo` itself still returns either a pipeline array or a flattened `{$match, $sort}`
     * object depending on how many stages it produced (existing callers, e.g. `RepoUtils`, already branch on
     * `Array.isArray()` to handle both) - use this instead at any new call site that wants one consistent shape.
     */
    public static toFindQuery(pipelineOrObject: any): any[] {
        if (Array.isArray(pipelineOrObject)) {
            return pipelineOrObject;
        }
        const stages: any[] = [];
        if (pipelineOrObject?.$match !== undefined) {
            stages.push({ $match: pipelineOrObject.$match });
        }
        if (pipelineOrObject?.$sort !== undefined) {
            stages.push({ $sort: pipelineOrObject.$sort });
        }
        return stages;
    }

    /**
     * Resolves the `limit`/`page` reserved query parameters to a bounded `take`/`skip` pair, applying the same
     * default (`DEFAULT_PAGE_SIZE`) and ceiling (`MAX_PAGE_SIZE`) that `buildSearchQuerySQL` already bakes into
     * its own return value (as `take`/`page`). `buildSearchQueryMongo` does NOT bake pagination into its own
     * pipeline - doing so would execute as `$skip`/`$limit` aggregation stages, which would double up with (and
     * corrupt) any cursor-level `.skip()/.limit()` a caller applies on top, as `RepoUtils` already does for its
     * own route-level pagination. A caller building a Mongo query directly - rather than going through
     * `RepoUtils` - should call this explicitly to get the same bounded pagination the SQL path enforces
     * automatically, rather than an unbounded result set.
     */
    public static resolvePagination(query: any = {}): { take: number; page: number; skip: number } {
        const take: number = query?.limit ? Math.min(Number(query.limit), MAX_PAGE_SIZE) : DEFAULT_PAGE_SIZE;
        const page: number = query?.page ? Number(query.page) : 0;
        return { take, page, skip: page * take };
    }

    /**
     * Builds a query object for the given criteria and repository. Query params can have a value containing a
     * conditional operator to apply for the search. The operator is encoded with the format `op(value)`. The following
     * operators are supported:
     * * `eq` - Returns matches whose parameter exactly matches of the given value. e.g. `param = value`
     * * `gt` - Returns matches whose parameter is greater than the given value. e.g. `param > value`
     * * `gte` - Returns matches whose parameter is greater than or equal to the given value. e.g. `param >= value`
     * * `in` - Returns matches whose parameter includes one of the given values. e.g. `param in ('value1', 'value2', 'value3', ...)`
     * * `like` - Returns matches whose parameter matches the given glob pattern (`*` = any sequence, `?` = any single character), case-insensitively. e.g. `like(*.txt)`
     * * `regex` - Returns matches whose parameter matches the given regular expression, case-insensitively.
     * * `lt` -  Returns matches whose parameter is less than the given value. e.g. `param < value`
     * * `lte` - Returns matches whose parameter is less than or equal to than the given value. e.g. `param < value`
     * * `not` / `ne` - Returns matches whose parameter is not equal to the given value. e.g. `param != value`
     * * `range` - Returns matches whose parameter is greater than or equal to first given value and less than or equal to the second. e.g. `param between(1,100)`
     * * `exists` - Returns matches whose parameter is (`exists(true)`) or is not (`exists(false)`) set.
     *
     * When no operator is provided the comparison is evaluated as `eq`, unless `exactMatch` is `false`, in which
     * case a string-valued parameter is instead matched as a case-insensitive "contains" search.
     *
     * A repeated query parameter name (e.g. `?a=1&a=2`) OR-combines its values, "zipped" positionally against
     * every other repeated parameter rather than as a cartesian product: `?a=1&a=2&b=3&b=4` compiles to
     * `(a=1 AND b=3) OR (a=2 AND b=4)`, not `a IN (1,2)` and not all four combinations. A shorter array is padded
     * by repeating its own last value against the longer one(s), rather than leaving the key unset for the extra
     * branches (which would match ANY value there, silently dropping that filter).
     *
     * NOTE: The result of this function is only compatible with the `aggregate()` function when MongoDB is used.
     *
     * @param modelClass The class definition of the data model to build a search query for.
     * @param repo The repository to build a search query for.
     * @param {any} query The search query parameters to include.
     * @param {bool} exactMatch Set to true to create a query where parameters are to be matched exactly, otherwise set to false to use a 'contains' search.
     * @param {any} user The user that is performing the request.
     * @returns {object} The TypeORM compatible query object.
     */
    public static buildSearchQuery<T extends {}>(
        modelClass: any,
        repo: Repository<T> | MongoRepository<T> | undefined,
        query: any = {},
        exactMatch: boolean = false,
        user?: any,
    ): any {
        // By default we don't want to return deleted recoverable objects unless explicitly requested
        if (new modelClass() instanceof RecoverableBaseEntity) {
            query = {
                ...query,
                deleted: query && "deleted" in query ? query.deleted : false,
            };
        }

        if (repo instanceof MongoRepository) {
            return ModelUtils.buildSearchQueryMongo(modelClass, query, exactMatch, user);
        } else {
            const driverType: string | undefined = (repo as any)?.manager?.connection?.options?.type;
            return ModelUtils.buildSearchQuerySQL(modelClass, query, exactMatch, user, driverType);
        }
    }

    /**
     * Builds a TypeORM compatible query object for the given criteria. See `buildSearchQuery` for the supported
     * `op(value)` operators and multi-value "zip" semantics.
     *
     * Unlike `buildSearchQuery` (which always injects a `deleted: false` filter for a `RecoverableBaseEntity`
     * before delegating here), this function applies no soft-delete filtering of its own - a caller invoking it
     * directly, bypassing `buildSearchQuery`, will not get that default exclusion.
     *
     * @param modelClass The class definition of the data model to build a search query for.
     * @param {any} query The search query parameters to include.
     * @param {bool} exactMatch Set to true to create a query where parameters are to be matched exactly, otherwise set to false to use a 'contains' search.
     * @param {any} user The user that is performing the request.
     * @param {string} driverType The TypeORM driver type (`connection.options.type`) of the target datasource, used
     * to select a compatible SQL translation for the `regex()` operator. Only needed when `regex()` may appear in
     * `query`.
     * @param {number} depth Internal recursion-depth counter for nested `$or` groups - do not pass explicitly.
     * @returns {object} The TypeORM compatible query object.
     */
    public static buildSearchQuerySQL(
        modelClass: any,
        query: any = {},
        exactMatch: boolean = false,
        user?: any,
        driverType?: string,
        depth: number = 0,
    ): any {
        if (depth > MAX_QUERY_DEPTH) {
            throw new ApiError(ApiErrors.SEARCH_QUERY_TOO_COMPLEX, 400, ApiErrorMessages.SEARCH_QUERY_TOO_COMPLEX);
        }

        const result: any = {};
        result.where = [];
        const sortableFields: Set<string> | undefined = ModelUtils.getSortablePropertyNames(modelClass);

        // Query parameters can be a single value or multiple. In the case of multiple we want to perform an OR
        // operation for each value. But to do that we need to build a separate object for each value containing all
        // the parameters as well.

        // So first let's find out how many queries in total we are going to need.
        let numQueries = 1;
        for (const key in query) {
            if (key === "$or" || key.match(REGEX_RESERVED_QUERY_PARAMS) || key.match(REGEX_QUERY_LIMITS)) {
                continue;
            }
            const value: string | string[] = query[key];
            if (Array.isArray(value)) {
                if (value.length > numQueries) {
                    numQueries = value.length;
                }
            }
        }

        // logger?.debug(`Query params: ${JSON.stringify(queryParams)}`);

        // Now go through each query paramater. If the parameter is a single value, add it to each query object. If it's an array,
        // add only one value to each query object.
        for (let key in query) {
            // `$or` is composed after the main loop, cross-producted against everything else built here.
            if (key === "$or") {
                continue;
            }

            // Ignore reserved query parameters
            if (key.match(REGEX_RESERVED_QUERY_PARAMS)) {
                continue;
            }

            // Limit, page and sort are reserved for specifying query limits
            if (key.match(REGEX_QUERY_LIMITS)) {
                let value: any = query[key];

                if (key === "limit") {
                    key = "take";
                    result[key] = Number(value);
                } else if (key === "page") {
                    result[key] = Number(value);
                } else if (key === "sort") {
                    key = "order";

                    if (typeof value === "string") {
                        if (value.match(REGEX_QUERY_SORT_STRING)) {
                            value = JSON.parse(value);
                        } else {
                            // Supports the conventional `sort=-fieldName` shorthand for descending order.
                            const descending: boolean = value.startsWith("-");
                            const field: string = descending ? value.slice(1) : value;
                            value = { [field]: descending ? "DESC" : "ASC" };
                        }
                    }

                    if (sortableFields) {
                        for (const sortKey of Object.keys(value)) {
                            if (!sortableFields.has(sortKey)) {
                                throw new ApiError(
                                    ApiErrors.SEARCH_INVALID_SORT_FIELD,
                                    400,
                                    StringUtils.findAndReplace(ApiErrorMessages.SEARCH_INVALID_SORT_FIELD, {
                                        field: sortKey,
                                    }),
                                );
                            }
                        }
                    }

                    result[key] = value;
                }

                continue;
            }

            if (Array.isArray(query[key])) {
                // Add each value in the array to each corresponding query. Multi-valued keys are "zipped"
                // together via `numQueries` above; if this key's array is shorter than another key's, pad the
                // remaining branches by repeating this key's own last value rather than leaving the key unset —
                // an unset key would match ANY value, silently dropping this filter from those branches.
                const values: string[] = query[key];
                for (let i = 0; i < numQueries; i++) {
                    if (!result.where[i]) {
                        result.where[i] = {};
                    }

                    const value: string = i < values.length ? values[i] : values[values.length - 1];
                    result.where[i][key] = ModelUtils.getQueryParamValue(
                        value,
                        modelClass,
                        key,
                        user,
                        exactMatch,
                        driverType,
                    );
                }
            } else {
                // Add the parameter to every query
                for (let i = 0; i < numQueries; i++) {
                    if (!result.where[i]) {
                        result.where[i] = {};
                    }

                    result.where[i][key] = ModelUtils.getQueryParamValue(
                        query[key],
                        modelClass,
                        key,
                        user,
                        exactMatch,
                        driverType,
                    );
                }
            }
        }

        // A `$or` key is composed via a distinct pass, after every other key: since a TypeORM `find()`-based
        // `where` only supports OR as a top-level array (no nested-OR expressible within one branch), each
        // sub-query's own OR-branches are cross-producted (distributed) against the branches already built above
        // - (A) AND ($or: [X,Y]) is equivalent to (A AND X) OR (A AND Y), which composes correctly with the
        // existing "zip" array regardless of processing order.
        if (query.$or && Array.isArray(query.$or)) {
            const branchesPerChild: any[][] = [];
            for (const sub of query.$or as any[]) {
                const compiled: any = ModelUtils.buildSearchQuerySQL(modelClass, sub, exactMatch, user, driverType, depth + 1);
                branchesPerChild.push(compiled.where && compiled.where.length > 0 ? compiled.where : [{}]);
            }
            const orBranches: any[] = ([] as any[]).concat(...branchesPerChild);
            const base: any[] = result.where.length > 0 ? result.where : [{}];
            const combined: any[] = [];
            for (const existing of base) {
                for (const orClause of orBranches) {
                    combined.push({ ...existing, ...orClause });
                }
            }
            if (combined.length > MAX_QUERY_NODES) {
                throw new ApiError(ApiErrors.SEARCH_QUERY_TOO_COMPLEX, 400, ApiErrorMessages.SEARCH_QUERY_TOO_COMPLEX);
            }
            result.where = combined;
        }

        if (result.where.length === 0) {
            delete result.where;
        }

        if (result.take) {
            result.take = Math.min(result.take, MAX_PAGE_SIZE);
        } else {
            result.take = DEFAULT_PAGE_SIZE;
        }
        result.page = result.page ? result.page : 0;

        return result;
    }

    /**
     * Builds a MongoDB compatible query object for the given criteria. See `buildSearchQuery` for the supported
     * `op(value)` operators and multi-value "zip" semantics.
     *
     * Unlike `buildSearchQuery` (which always injects a `deleted: false` filter for a `RecoverableBaseEntity`
     * before delegating here), this function applies no soft-delete filtering of its own - a caller invoking it
     * directly, bypassing `buildSearchQuery`, will not get that default exclusion.
     *
     * Does NOT bound `limit`/`page` into the returned pipeline (see `resolvePagination`) and returns either an
     * aggregation pipeline array or a flattened `{$match, $sort}` object depending on how many stages it
     * produced (see `toFindQuery` to normalize to one shape).
     *
     * NOTE: The result of this function is only compatible with the `aggregate()` function.
     *
     * @param modelClass The class definition of the data model to build a search query for.
     * @param {any} query The search query parameters to include.
     * @param {bool} exactMatch Set to true to create a query where parameters are to be matched exactly, otherwise set to false to use a 'contains' search.
     * @param {any} user The user that is performing the request.
     * @param {number} depth Internal recursion-depth counter for nested `$or` groups - do not pass explicitly.
     * @returns {object} The MongoDB compatible query object.
     */
    public static buildSearchQueryMongo(
        modelClass: any,
        query: any = {},
        exactMatch: boolean = false,
        user?: any,
        depth: number = 0,
    ): any {
        if (depth > MAX_QUERY_DEPTH) {
            throw new ApiError(ApiErrors.SEARCH_QUERY_TOO_COMPLEX, 400, ApiErrorMessages.SEARCH_QUERY_TOO_COMPLEX);
        }

        const queries: any[] = [{}];
        let sort: any = undefined;
        const sortableFields: Set<string> | undefined = ModelUtils.getSortablePropertyNames(modelClass);

        // logger?.debug(`Query params: ${JSON.stringify(queryParams)}`);

        // Query parameters can be a single value or multiple. In the case of multiple we want to perform an OR
        // operation for each value, "zipped" together with any other multi-valued parameters (see the equivalent
        // two-pass logic in buildSearchQuerySQL) — so first determine how many OR branches we need in total and
        // pre-allocate them, before any key gets applied to a subset of branches.
        let numQueries = 1;
        for (const key in query) {
            if (key === "$or" || key.match(REGEX_RESERVED_QUERY_PARAMS) || key.match(REGEX_QUERY_LIMITS)) {
                continue;
            }
            const value: any = query[key];
            if (Array.isArray(value) && value.length > numQueries) {
                numQueries = value.length;
            }
        }
        for (let i = 1; i < numQueries; i++) {
            queries[i] = {};
        }

        for (const key in query) {
            // Ignore reserved query parameters
            if (key.match(REGEX_RESERVED_QUERY_PARAMS)) {
                continue;
            }

            // Limit, page and sort are reserved for specifying query limits
            if (key.match(REGEX_QUERY_LIMITS)) {
                let value: any = query[key];

                if (key === "sort") {
                    if (typeof value === "string") {
                        if (value.match(REGEX_QUERY_SORT_STRING)) {
                            value = JSON.parse(value);
                        } else {
                            // Supports the conventional `sort=-fieldName` shorthand for descending order.
                            const descending: boolean = value.startsWith("-");
                            const field: string = descending ? value.slice(1) : value;
                            value = { [field]: descending ? -1 : 1 };
                        }
                    }

                    if (sortableFields) {
                        for (const sortKey of Object.keys(value)) {
                            if (!sortableFields.has(sortKey)) {
                                throw new ApiError(
                                    ApiErrors.SEARCH_INVALID_SORT_FIELD,
                                    400,
                                    StringUtils.findAndReplace(ApiErrorMessages.SEARCH_INVALID_SORT_FIELD, {
                                        field: sortKey,
                                    }),
                                );
                            }
                        }
                    }

                    let resolvedSort = {
                        ...sort,
                        ...value,
                    };

                    sort = sort || {};

                    // Format sort for mongo: https://www.mongodb.com/docs/manual/reference/operator/aggregation/sort/#mongodb-pipeline-pipe.-sort
                    Object.keys(resolvedSort).forEach((key) => {
                        let value = resolvedSort[key];

                        if (!value) return;

                        if (typeof value === "number") {
                            sort[key] = value;
                        } else if (typeof value !== "string") {
                            return;
                        } else if (value.toUpperCase() === "ASC") {
                            sort[key] = 1;
                        } else if (value.toUpperCase() === "DESC") {
                            sort[key] = -1;
                        }
                    });
                }

                continue;
            }

            // Dot-notation field paths (e.g. `category.name`) are allowed so clients can query into sub-document
            // fields — MongoDB treats a dotted string key purely as a nested field path, never as an operator, so
            // this doesn't reopen operator injection. What must still be rejected is any *segment* of the path
            // starting with `$`, since that's how a client would smuggle a raw Mongo operator key (e.g. `$where`,
            // or `category.$where`) in as a top-level filter (`$or` is the one deliberate legitimate exception,
            // handled just below; its sub-queries are validated recursively when they're built). Operator
            // injection hidden inside a *value* (e.g. `eq({"$ne":null})`) is separately guarded by
            // `assertNoOperatorInjection` wherever values are parsed.
            if (key !== "$or" && key.split(".").some((segment) => segment.startsWith("$"))) {
                throw new ApiError(ApiErrors.INVALID_REQUEST, 400, ApiErrorMessages.INVALID_REQUEST);
            }

            if (key === "$or") {
                // Array of OR queries
                let orResults: any[] = [];
                for (const q of query[key] as Array<any>) {
                    const subQueryOrResult = this.buildSearchQueryMongo(modelClass, q, exactMatch, user, depth + 1);
                    const validSubQueryResult = ModelUtils.extractMatch(subQueryOrResult);
                    validSubQueryResult && orResults.push(validSubQueryResult);
                }

                if (orResults.length > MAX_QUERY_NODES) {
                    throw new ApiError(
                        ApiErrors.SEARCH_QUERY_TOO_COMPLEX,
                        400,
                        ApiErrorMessages.SEARCH_QUERY_TOO_COMPLEX,
                    );
                }

                // Merge into whatever conditions earlier keys (including the injected soft-delete filter)
                // already placed on each branch — replacing outright would silently discard them, and merging
                // only into queries[0] would silently drop the $or constraint from any other zipped branch.
                for (let i = 0; i < numQueries; i++) {
                    queries[i] = { ...queries[i], $or: orResults };
                }

                continue;
            }

            if (Array.isArray(query[key])) {
                // Add each value in the array to each corresponding query, zipped per `numQueries` above. If
                // this key's array is shorter than another key's, pad the remaining branches by repeating this
                // key's own last value rather than leaving the key unset — an unset key would match ANY value,
                // silently dropping this filter from those branches. Injection safety is already enforced
                // inside getQueryParamValueMongo() itself, at the point the client-supplied value is parsed.
                const values: any[] = query[key];
                for (let i = 0; i < numQueries; i++) {
                    const raw: any = i < values.length ? values[i] : values[values.length - 1];
                    queries[i][key] = ModelUtils.getQueryParamValueMongo(raw, modelClass, key, user, exactMatch);
                }
            } else {
                const value: any = ModelUtils.getQueryParamValueMongo(query[key], modelClass, key, user, exactMatch);
                for (let i = 0; i < numQueries; i++) {
                    queries[i][key] = value;
                }
            }
        }

        let result: any[] = [];
        if (queries.length > 0) {
            result.push({ $match: queries.length === 1 ? queries[0] : { $or: queries } });
        }

        // Determine if the model class is versioned or not. We provide a different
        // aggregation query if it is.
        if (modelClass && modelClass.trackChanges !== undefined) {
            result.push({ $sort: { version: -1 } });
            result.push({ $group: { _id: "$uid", doc: { $first: "$$ROOT" } } });
            result.push({ $replaceRoot: { newRoot: "$doc" } });
        }

        // Add the sort if specified
        if (sort && !isEmpty(sort)) {
            result.push({ $sort: sort });
        }

        // If this is a simple query (e.g. only $match and $sort) then we want to extract this query so that
        // we don't run it as an aggregate pipeline.
        if (result.length < 3) {
            return {
                ...result[0],
                ...result[1],
            };
        }

        return result;
    }

    /**
     * Compiles a single `PredicateNode` leaf to a MongoDB filter fragment (`{field: ...}`).
     */
    private static compilePredicateMongo(node: PredicateNode, modelClass: any, user: any): any {
        const { field, op } = node;
        switch (op) {
            case "eq":
                return { [field]: ModelUtils.coerceNodeValue(node.value, modelClass, field, user) };
            case "ne":
                return { [field]: { $ne: ModelUtils.coerceNodeValue(node.value, modelClass, field, user) } };
            case "gt":
                return { [field]: { $gt: ModelUtils.coerceNodeValue(node.value, modelClass, field, user) } };
            case "gte":
                return { [field]: { $gte: ModelUtils.coerceNodeValue(node.value, modelClass, field, user) } };
            case "lt":
                return { [field]: { $lt: ModelUtils.coerceNodeValue(node.value, modelClass, field, user) } };
            case "lte":
                return { [field]: { $lte: ModelUtils.coerceNodeValue(node.value, modelClass, field, user) } };
            case "in": {
                const values: any[] = (Array.isArray(node.value) ? node.value : [node.value]).map((v) =>
                    ModelUtils.coerceNodeValue(v, modelClass, field, user),
                );
                return { [field]: { $in: values } };
            }
            case "nin": {
                const values: any[] = (Array.isArray(node.value) ? node.value : [node.value]).map((v) =>
                    ModelUtils.coerceNodeValue(v, modelClass, field, user),
                );
                return { [field]: { $nin: values } };
            }
            case "range": {
                if (!Array.isArray(node.value) || node.value.length !== 2) {
                    throw new ApiError(
                        ApiErrors.SEARCH_INVALID_RANGE,
                        400,
                        StringUtils.findAndReplace(ApiErrorMessages.SEARCH_INVALID_RANGE, {
                            value: JSON.stringify(node.value),
                            length: Array.isArray(node.value) ? node.value.length : 1,
                        }),
                    );
                }
                const [lo, hi] = node.value as [unknown, unknown];
                return {
                    [field]: {
                        $gte: ModelUtils.coerceNodeValue(lo, modelClass, field, user),
                        $lte: ModelUtils.coerceNodeValue(hi, modelClass, field, user),
                    },
                };
            }
            case "like": {
                const pattern: string = ModelUtils.globToRegExpSource(String(node.value));
                return { [field]: { $regex: pattern, $options: "i" } };
            }
            case "regex": {
                const pattern: string = String(node.value);
                if (ModelUtils.isUnsafeRegexPattern(pattern)) {
                    throw new ApiError(ApiErrors.INVALID_REQUEST, 400, ApiErrorMessages.INVALID_REQUEST);
                }
                return { [field]: { $regex: pattern, $options: "i" } };
            }
            case "exists":
                return { [field]: { $exists: !!node.value } };
            default:
                throw new ApiError(
                    ApiErrors.SEARCH_UNKNOWN_OPERATOR,
                    400,
                    StringUtils.findAndReplace(ApiErrorMessages.SEARCH_UNKNOWN_OPERATOR, {
                        operator: String((node as any).op),
                    }),
                );
        }
    }

    private static compileGroupMongo(node: GroupNode, modelClass: any, user: any, depth: number): any {
        if (depth > MAX_QUERY_DEPTH) {
            throw new ApiError(ApiErrors.SEARCH_QUERY_TOO_COMPLEX, 400, ApiErrorMessages.SEARCH_QUERY_TOO_COMPLEX);
        }
        if (node.children.length > MAX_QUERY_NODES) {
            throw new ApiError(ApiErrors.SEARCH_QUERY_TOO_COMPLEX, 400, ApiErrorMessages.SEARCH_QUERY_TOO_COMPLEX);
        }
        const compiledChildren: any[] = node.children.map((child) =>
            ModelUtils.compileNodeMongo(child, modelClass, user, depth + 1),
        );
        const clause: any = node.op === "and" ? { $and: compiledChildren } : { $or: compiledChildren };
        return node.negated ? { $nor: [clause] } : clause;
    }

    private static compileNodeMongo(node: QueryNode, modelClass: any, user: any, depth: number = 0): any {
        return node.kind === "group"
            ? ModelUtils.compileGroupMongo(node, modelClass, user, depth)
            : ModelUtils.compilePredicateMongo(node, modelClass, user);
    }

    private static compilePredicateSQLOperator(
        op: PredicateNode["op"],
        value: unknown,
        modelClass: any,
        field: string,
        user: any,
        driverType?: string,
    ): any {
        const { Equal, MoreThan, MoreThanOrEqual, In, ILike, LessThan, LessThanOrEqual, Not, Between, IsNull } =
            ModelUtils.orm;
        switch (op) {
            case "eq": {
                const v: any = ModelUtils.coerceNodeValue(value, modelClass, field, user);
                return v === null ? IsNull() : Equal(v);
            }
            case "ne": {
                const v: any = ModelUtils.coerceNodeValue(value, modelClass, field, user);
                return v === null ? Not(IsNull()) : Not(v);
            }
            case "gt":
                return MoreThan(ModelUtils.coerceNodeValue(value, modelClass, field, user));
            case "gte":
                return MoreThanOrEqual(ModelUtils.coerceNodeValue(value, modelClass, field, user));
            case "lt":
                return LessThan(ModelUtils.coerceNodeValue(value, modelClass, field, user));
            case "lte":
                return LessThanOrEqual(ModelUtils.coerceNodeValue(value, modelClass, field, user));
            case "in": {
                const values: any[] = (Array.isArray(value) ? value : [value]).map((v) =>
                    ModelUtils.coerceNodeValue(v, modelClass, field, user),
                );
                return In(values);
            }
            case "nin": {
                const values: any[] = (Array.isArray(value) ? value : [value]).map((v) =>
                    ModelUtils.coerceNodeValue(v, modelClass, field, user),
                );
                return Not(In(values));
            }
            case "range": {
                if (!Array.isArray(value) || value.length !== 2) {
                    throw new ApiError(
                        ApiErrors.SEARCH_INVALID_RANGE,
                        400,
                        StringUtils.findAndReplace(ApiErrorMessages.SEARCH_INVALID_RANGE, {
                            value: JSON.stringify(value),
                            length: Array.isArray(value) ? value.length : 1,
                        }),
                    );
                }
                const [lo, hi] = value as [unknown, unknown];
                return Between(
                    ModelUtils.coerceNodeValue(lo, modelClass, field, user),
                    ModelUtils.coerceNodeValue(hi, modelClass, field, user),
                );
            }
            case "like":
                return ILike(ModelUtils.globToLike(String(value)));
            case "regex": {
                const pattern: string = String(value);
                if (ModelUtils.isUnsafeRegexPattern(pattern)) {
                    throw new ApiError(ApiErrors.INVALID_REQUEST, 400, ApiErrorMessages.INVALID_REQUEST);
                }
                return ModelUtils.compileSqlRegex(pattern, driverType);
            }
            case "exists":
                return value ? Not(IsNull()) : IsNull();
            default:
                throw new ApiError(
                    ApiErrors.SEARCH_UNKNOWN_OPERATOR,
                    400,
                    StringUtils.findAndReplace(ApiErrorMessages.SEARCH_UNKNOWN_OPERATOR, { operator: String(op) }),
                );
        }
    }

    private static compileNodeSQL(
        node: QueryNode,
        modelClass: any,
        user: any,
        driverType: string | undefined,
        depth: number,
    ): any[] {
        if (depth > MAX_QUERY_DEPTH) {
            throw new ApiError(ApiErrors.SEARCH_QUERY_TOO_COMPLEX, 400, ApiErrorMessages.SEARCH_QUERY_TOO_COMPLEX);
        }

        if (node.kind === "predicate") {
            return [
                {
                    [node.field]: ModelUtils.compilePredicateSQLOperator(
                        node.op,
                        node.value,
                        modelClass,
                        node.field,
                        user,
                        driverType,
                    ),
                },
            ];
        }

        if (node.negated) {
            // De Morgan expansion of an arbitrarily-nested negated group isn't attempted against TypeORM's
            // `find()`-based `where` (no general boolean-algebra rewrite is implemented here) - only the Mongo
            // compiler, which can express negation natively via `$nor`, supports it.
            throw new ApiError(
                ApiErrors.SEARCH_OPERATOR_NOT_SUPPORTED,
                400,
                StringUtils.findAndReplace(ApiErrorMessages.SEARCH_OPERATOR_NOT_SUPPORTED, {
                    operator: "negated group (SQL)",
                }),
            );
        }

        if (node.children.length > MAX_QUERY_NODES) {
            throw new ApiError(ApiErrors.SEARCH_QUERY_TOO_COMPLEX, 400, ApiErrorMessages.SEARCH_QUERY_TOO_COMPLEX);
        }

        const childBranches: any[][] = node.children.map((child) =>
            ModelUtils.compileNodeSQL(child, modelClass, user, driverType, depth + 1),
        );

        let branches: any[];
        if (node.op === "or") {
            branches = ([] as any[]).concat(...childBranches);
        } else {
            branches = childBranches.reduce<any[]>(
                (acc, branchesForChild) => {
                    const combined: any[] = [];
                    for (const existing of acc) {
                        for (const clause of branchesForChild) {
                            combined.push({ ...existing, ...clause });
                        }
                    }
                    return combined;
                },
                [{}],
            );
        }

        if (branches.length > MAX_QUERY_NODES) {
            throw new ApiError(ApiErrors.SEARCH_QUERY_TOO_COMPLEX, 400, ApiErrorMessages.SEARCH_QUERY_TOO_COMPLEX);
        }
        return branches;
    }

    /**
     * Compiles a `QueryNode` boolean tree into a query object for the given repository - the nested-condition
     * counterpart to `buildSearchQuery()`'s flat `op(value)` query-parameter form, for boolean shapes the flat
     * form can't express (e.g. `(a AND b) OR (c AND d)`, with no key forced into every branch). Reuses the same
     * operand coercion, `me` substitution and operator-injection guard as the flat form. Bounded by the same
     * `MAX_QUERY_DEPTH`/`MAX_QUERY_NODES` limits as `$or`. Negated groups are supported on MongoDB (via `$nor`)
     * but rejected against the SQL `find()`-based `where` (see `compileNodeSQL`).
     *
     * @param modelClass The class definition of the data model to build a search query for.
     * @param repo The repository to build a search query for.
     * @param node The root of the query tree.
     * @param user The user that is performing the request, resolved for any `field: "me"` predicate value.
     */
    public static buildQueryFromNode<T extends {}>(
        modelClass: any,
        repo: Repository<T> | MongoRepository<T> | undefined,
        node: QueryNode,
        user?: any,
    ): any {
        if (repo instanceof MongoRepository) {
            return { $match: ModelUtils.compileNodeMongo(node, modelClass, user, 0) };
        }
        const driverType: string | undefined = (repo as any)?.manager?.connection?.options?.type;
        return { where: ModelUtils.compileNodeSQL(node, modelClass, user, driverType, 0) };
    }

    /**
     * Converts a `QueryNode` boolean tree into a PostgreSQL `tsquery` expression string (`AND` -> `&`, `OR` -> `|`,
     * negation -> `!`), so client input can drive full-text search without passing untrusted text straight to
     * `to_tsquery` (which throws on malformed input) while still supporting the boolean grouping
     * `websearch_to_tsquery` cannot express. Every predicate leaf's `value` is treated as a search term
     * (lexeme/phrase) regardless of its `field`/`op` - this framework has no notion of a full-text-indexed column,
     * so the caller is expected to route the resulting expression to whichever `tsvector` column it's searching,
     * e.g. `to_tsquery(ModelUtils.toTsQuery(node))`.
     */
    public static toTsQuery(node: QueryNode): string {
        if (node.kind === "predicate") {
            const term: string = String(node.value).replace(/'/g, "''");
            return `'${term}'`;
        }

        const joiner: string = node.op === "and" ? " & " : " | ";
        const inner: string = node.children
            .map((child) => {
                const compiled: string = ModelUtils.toTsQuery(child);
                return child.kind === "group" ? `(${compiled})` : compiled;
            })
            .join(joiner);
        const grouped: string = node.children.length > 1 ? `(${inner})` : inner;
        return node.negated ? `!${grouped}` : grouped;
    }

    /**
     * Loads all model schema files from the specified path and returns a map containing all the definitions.
     *
     * @param src The path to the model files to load.
     * @returns A map containing of all loaded model names to their class definitions.
     */
    public static async loadModels(src: string, result: Map<string, any> = new Map()): Promise<Map<string, any>> {
        return await new Promise(async (resolve, reject) => {
            try {
                const classLoader: ClassLoader = new ClassLoader(src);
                await classLoader.load();

                // Go through each class and determine which ones implements the `@Model` decorator.
                classLoader.getClasses().forEach((clazz: any, name: string) => {
                    const isModel: any = Reflect.getMetadata("rrst:datasource", clazz) !== undefined;
                    if (isModel) {
                        result.set(name, clazz);
                    }
                });

                resolve(result);
            } catch (error) {
                reject(error);
            }
        });
    }
}
