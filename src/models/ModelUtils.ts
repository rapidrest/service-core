///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2020-2026 Jean-Philippe Steinmetz
///////////////////////////////////////////////////////////////////////////////
import {
    Repository,
    ILike,
    LessThanOrEqual,
    MoreThanOrEqual,
    Not,
    Equal,
    In,
    MoreThan,
    LessThan,
    Between,
    MongoRepository,
} from "typeorm";
import { ApiError, ClassLoader, Logger, StringUtils } from "@rapidrest/core";
import "reflect-metadata";
import { isEmpty } from "lodash";
import { RecoverableBaseEntity } from "./RecoverableBaseEntity.js";
import { ApiErrorMessages, ApiErrors } from "../ApiErrors.js";
import _ from "lodash";

const logger = Logger();

// Apparently calling JSON.stringify on RegExp returns an empty set. So the recommended way to
// overcome this is by adding a `toJSON` method that uses the `toString` instead which will
// give us what we want.
(RegExp.prototype as any).toJSON = RegExp.prototype.toString;

/**
 * Utility class for working with data model classes.
 *
 * @author Jean-Philippe Steinmetz
 */
export class ModelUtils {
    /**
     * Retrieves a list of all of the specified class's properties that have the @Identifier decorator applied.
     *
     * @param modelClass The class definition to search for identifiers from.
     * @returns The list of all property names that have the @Identifier decorator applied.
     */
    public static getIdPropertyNames(modelClass: any): string[] {
        const results: string[] = [];

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

        return results;
    }

    /**
     * Builds a query object for use with `find` functions of the given repository for retrieving objects matching the
     * specified unique identifier.
     *
     * @param repo The repository to build the query for.
     * @param modelClass The class definition of the data model to build a search query for.
     * @param id The unique identifier to search for.
     * @param version The version number of the document to search for.
     * @param productUid The optional product uid that is associated with the uid (when a compound key is used).
     * @returns An object that can be passed to a TypeORM `find` function.
     */
    public static buildIdSearchQuery<T extends {}>(
        repo: Repository<T> | MongoRepository<T> | undefined,
        modelClass: any,
        id: any | any[],
        version?: number,
        productUid?: string
    ): any {
        if (repo instanceof MongoRepository) {
            return ModelUtils.buildIdSearchQueryMongo(modelClass, id, version, productUid);
        } else {
            return ModelUtils.buildIdSearchQuerySQL(modelClass, id, version, productUid);
        }
    }

    /**
     * Builds a TypeORM compatible query object for use in `find` functions for retrieving objects matching the
     * specified unique identifier.
     *
     * @param modelClass The class definition of the data model to build a search query for.
     * @param id The unique identifier to search for.
     * @param version The version number of the document to search for.
     * @param productUid The optional product uid that is associated with the uid (when a compound key is used).
     * @returns An object that can be passed to a TypeORM `find` function.
     */
    public static buildIdSearchQuerySQL(modelClass: any, id: any | any[], version?: number, productUid?: string): any {
        const props: string[] = ModelUtils.getIdPropertyNames(modelClass);

        // Create the where in SQL syntax. We only care about one of the identifier field's matching.
        // e.g. WHERE idField1 = :idField1 OR idField2 = :idField2 ...
        const where: any = [];
        for (const prop of props) {
            // If productUid is an id, skip it because it's used as a compound key
            if (prop === "productUid") continue;

            const q: any = { [prop]: Array.isArray(id) ? In(id) : id };
            if (props.includes("productUid")) {
                q.productUid = productUid;
            }
            if (version !== undefined) {
                q.version = version;
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
     * @param productUid The optional product uid that is associated with the uid (when a compound key is used).
     * @returns An object that can be passed to a MongoDB `find` function.
     */
    public static buildIdSearchQueryMongo(
        modelClass: any,
        id: any | any[],
        version?: number,
        productUid?: string
    ): any {
        const props: string[] = ModelUtils.getIdPropertyNames(modelClass);

        // We want to performa case-insensitive search. So convert all strings to regex.
        if (Array.isArray(id)) {
            for (let i = 0; i < id.length; i++) {
                if (typeof id[i] === "string") {
                    id[i] = new RegExp("^" + id[i].replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "$", "i");
                }
            }
        } else if (typeof id === "string") {
            id = new RegExp("^" + id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "$", "i");
        }

        // Create the where in SQL syntax. We only care about one of the identifier field's matching.
        // e.g. WHERE idField1 = :idField1 OR idField2 = :idField2 ...
        const query: any[] = [];
        for (const prop of props) {
            // If productUid is an id, skip it because it's used as a compound key
            if (prop === "productUid") continue;

            const q: any = { [prop]: Array.isArray(id) ? { $in: id } : id };
            if (productUid && props.includes("productUid")) {
                q.productUid = productUid;
            }
            if (version !== undefined) {
                q.version = version;
            }
            query.push(q);
        }

        return { $or: query };
    }

    /**
     * Given a string containing a parameter value and/or a comparison operation return a TypeORM compatible find value.
     * e.g.
     * Given the string "myvalue" will return an Eq("myvalue") object.
     * Given the string "Like(myvalue)" will return an Like("myvalue") object.
     *
     * @param param
     */
    private static getQueryParamValue(param: any): any {
        if (typeof param === "string") {
            // The value of each param can optionally have the operation included. If no operator is included Eq is
            // always assumed.
            // e.g. ?param1=eq(value)&param2=not(value)&param3=gt(value)
            const matches: RegExpMatchArray | null = param.match(new RegExp(/^([a-zA-Z]+)\((.*)\)$/, "i"));
            if (matches) {
                const opName: string = matches[1].toLowerCase();
                let value: any = matches[2];
                try {
                    // Attempt to parse the value to a native type
                    value = JSON.parse(matches[2]);
                } catch (err) {
                    // If an error occurred it's because the value is a string or date, not another type.
                    value = new Date(matches[2]);
                    if (isNaN(value)) {
                        value = matches[2];
                    }
                }

                switch (opName) {
                    case "eq":
                        return Equal(value);
                    case "gt":
                        return MoreThan(value);
                    case "gte":
                        return MoreThanOrEqual(value);
                    case "in": {
                        const args: string[] = value.split(",");
                        return In(args);
                    }
                    case "like":
                        return ILike(value);
                    case "lt":
                        return LessThan(value);
                    case "lte":
                        return LessThanOrEqual(value);
                    case "ne":
                    case "not":
                        return Not(value);
                    case "range": {
                        const args: string[] = value.split(",");
                        if (args.length !== 2) {
                            const msg: string = StringUtils.findAndReplace(ApiErrorMessages.SEARCH_INVALID_RANGE, {
                                value,
                                length: args.length,
                            });
                            throw new ApiError(ApiErrors.SEARCH_INVALID_RANGE, 400, msg);
                        }
                        try {
                            // Attempt to parse the range values to native types
                            return Between(JSON.parse(args[0]), JSON.parse(args[1]));
                        } catch (err) {
                            return Between(args[0], args[1]);
                        }
                    }
                    default:
                        return Equal(value);
                }
            } else {
                try {
                    // Attempt to parse the value to a native type
                    return Equal(JSON.parse(param));
                } catch (err) {
                    // If an error occurred it's because the value is a string, not another type.
                    const date: Date = new Date(param);
                    return Equal(!isNaN(date.valueOf()) ? date : param);
                }
            }
        } else {
            return param;
        }
    }

    /**
     * Given a string containing a parameter value and/or a comparison operation return a MongoDB compatible find value.
     * e.g.
     * Given the string "myvalue" will return an `"myvalue"` object.
     * Given the string "not(myvalue)" will return an `{ $not: "myvalue" }` object.
     *
     * @param param
     */
    private static getQueryParamValueMongo(param: any): any {
        if (typeof param === "string") {
            // The value of each param can optionally have the operation included. If no operator is included Eq is
            // always assumed.
            // e.g. ?param1=eq(value)&param2=not(value)&param3=gt(value)
            const matches: RegExpMatchArray | null = param.match(new RegExp(/^([a-zA-Z]+)\((.*)\)$/, "i"));
            if (matches) {
                const opName: string = matches[1].toLowerCase();
                let value: any = matches[2];
                try {
                    // Attempt to parse the value to a native type
                    value = JSON.parse(matches[2]);
                } catch (err) {
                    // If an error occurred it's because the value is a string or date, not another type.
                    value = new Date(matches[2]);
                    if (isNaN(value)) {
                        value = matches[2];
                    }
                }
                switch (opName) {
                    case "eq":
                        return value;
                    case "gt":
                        return { $gt: value };
                    case "gte":
                        return { $gte: value };
                    case "in": {
                        const args: string[] = value.split(",");
                        return { $in: args };
                    }
                    case "nin": {
                        const args: string[] = value.split(",");
                        return { $nin: args };
                    }
                    case "like":
                        return { $regex: value, $options: "i" };
                    case "lt":
                        return { $lt: value };
                    case "lte":
                        return { $lte: value };
                    case "ne":
                        return { $ne: value };
                    case "not":
                        return { $not: value };
                    case "range": {
                        const args: string[] = value.split(",");
                        if (args.length !== 2) {
                            const msg: string = StringUtils.findAndReplace(ApiErrorMessages.SEARCH_INVALID_RANGE, {
                                value,
                                length: args.length,
                            });
                            throw new ApiError(ApiErrors.SEARCH_INVALID_RANGE, 400, msg);
                        }
                        try {
                            // Attempt to parse the range values to native types
                            return { $gte: JSON.parse(args[0]), $lte: JSON.parse(args[1]) };
                        } catch (err) {
                            return { $gte: args[0], $lte: args[1] };
                        }
                    }
                    default:
                        return value;
                }
            } else {
                try {
                    // Attempt to parse the value to a native type
                    return JSON.parse(param);
                } catch (err) {
                    // If an error occurred it's because the value is a string or date, not another type.
                    const date: Date = new Date(param);
                    return !isNaN(date.valueOf()) ? date : param;
                }
            }
        } else {
            return param;
        }
    }

    /**
     * Builds a query object for the given criteria and repository. Query params can have a value containing a
     * conditional operator to apply for the search. The operator is encoded with the format `op(value)`. The following
     * operators are supported:
     * * `eq` - Returns matches whose parameter exactly matches of the given value. e.g. `param = value`
     * * `gt` - Returns matches whose parameter is greater than the given value. e.g. `param > value`
     * * `gte` - Returns matches whose parameter is greater than or equal to the given value. e.g. `param >= value`
     * * `in` - Returns matches whose parameter includes one of the given values. e.g. `param in ('value1', 'value2', 'value3', ...)`
     * * `like` - Returns matches whose parameter is lexographically similar to the given value. `param like value`
     * * `lt` -  Returns matches whose parameter is less than the given value. e.g. `param < value`
     * * `lte` - Returns matches whose parameter is less than or equal to than the given value. e.g. `param < value`
     * * `not` - Returns matches whose parameter is not equal to the given value. e.g. `param not value`
     * * `range` - Returns matches whose parameter is greater than or equal to first given value and less than or equal to the second. e.g. `param between(1,100)`
     *
     * When no operator is provided the comparison will always be evaluated as `eq`.
     *
     * NOTE: The result of this function is only compatible with the `aggregate()` function when MongoDB is used.
     *
     * @param modelClass The class definition of the data model to build a search query for.
     * @param repo The repository to build a search query for.
     * @param {any} params The URI parameters for the endpoint that was requested.
     * @param {any} queryParams The URI query parameters that were included in the request.
     * @param {bool} exactMatch Set to true to create a query where parameters are to be matched exactly, otherwise set to false to use a 'contains' search.
     * @param {any} user The user that is performing the request.
     * @returns {object} The TypeORM compatible query object.
     */
    public static buildSearchQuery<T extends {}>(
        modelClass: any,
        repo: Repository<T> | MongoRepository<T> | undefined,
        params?: any,
        queryParams?: any,
        exactMatch: boolean = false,
        user?: any
    ): any {
        // By default we don't want to return deleted recoverable objects unless explicitly requested
        if (new modelClass() instanceof RecoverableBaseEntity) {
            queryParams = {
                ...queryParams,
                deleted: queryParams && "deleted" in queryParams ? queryParams.deleted : false,
            };
        }

        if (repo instanceof MongoRepository) {
            return ModelUtils.buildSearchQueryMongo(modelClass, params, queryParams, exactMatch, user);
        } else {
            return ModelUtils.buildSearchQuerySQL(modelClass, params, queryParams, exactMatch, user);
        }
    }

    /**
     * Builds a TypeORM compatible query object for the given criteria. Query params can have a value containing a
     * conditional operator to apply for the search. The operator is encoded with the format `op(value)`. The following
     * operators are supported:
     * * `eq` - Returns matches whose parameter exactly matches of the given value. e.g. `param = value`
     * * `gt` - Returns matches whose parameter is greater than the given value. e.g. `param > value`
     * * `gte` - Returns matches whose parameter is greater than or equal to the given value. e.g. `param >= value`
     * * `in` - Returns matches whose parameter includes one of the given values. e.g. `param in ('value1', 'value2', 'value3', ...)`
     * * `like` - Returns matches whose parameter is lexographically similar to the given value. `param like value`
     * * `lt` -  Returns matches whose parameter is less than the given value. e.g. `param < value`
     * * `lte` - Returns matches whose parameter is less than or equal to than the given value. e.g. `param < value`
     * * `not` - Returns matches whose parameter is not equal to the given value. e.g. `param not value`
     * * `range` - Returns matches whose parameter is greater than or equal to first given value and less than or equal to the second. e.g. `param between(1,100)`
     *
     * When no operator is provided the comparison will always be evaluated as `eq`.
     *
     * @param modelClass The class definition of the data model to build a search query for.
     * @param {any} params The URI parameters for the endpoint that was requested.
     * @param {any} queryParams The URI query parameters that were included in the request.
     * @param {bool} exactMatch Set to true to create a query where parameters are to be matched exactly, otherwise set to false to use a 'contains' search.
     * @param {any} user The user that is performing the request.
     * @returns {object} The TypeORM compatible query object.
     */
    public static buildSearchQuerySQL(
        modelClass: any,
        params?: any,
        queryParams?: any,
        exactMatch: boolean = false,
        user?: any
    ): any {
        const query: any = {};
        query.where = [];

        // Add the URL parameters
        for (const key in params) {
            // If the value is 'me' that's a special keyword to reference the user ID.
            if (params[key] === "me") {
                if (!user) {
                    throw new ApiError(
                        ApiErrors.SEARCH_INVALID_ME_REFERENCE,
                        403,
                        ApiErrorMessages.SEARCH_INVALID_ME_REFERENCE
                    );
                }
                query.where[key] = user.uid;
            } else {
                query.where[key] = params[key];
            }
        }

        // Query parameters can be a single value or multiple. In the case of multiple we want to perform an OR
        // operation for each value. But to do that we need to build a separate object for each value containing all
        // the parameters as well.

        // So first let's find out how many queries in total we are going to need.
        let numQueries = 1;
        for (const key in queryParams) {
            const value: string | string[] = queryParams[key];
            if (Array.isArray(value)) {
                if (value.length > numQueries) {
                    numQueries = value.length;
                }
            }
        }

        // logger?.debug(`Query params: ${JSON.stringify(queryParams)}`);

        // Now go through each query paramater. If the parameter is a single value, add it to each query object. If it's an array,
        // add only one value to each query object.
        for (let key in queryParams) {
            // Ignore reserved query parameters
            if (key.match(new RegExp("(jwt_|oauth_|cache).*", "i"))) {
                continue;
            }

            // Limit, page and sort are reserved for specifying query limits
            if (key.match(new RegExp("(limit|page|sort).*", "i"))) {
                let value: any = queryParams[key];

                if (key === "limit") {
                    key = "take";
                    query[key] = Number(value);
                } else if (key === "page") {
                    query[key] = Number(value);
                } else if (key === "sort") {
                    key = "order";

                    if (typeof value === "string") {
                        if (value.match(new RegExp(/^\{.*\}$/, "i"))) {
                            value = JSON.parse(value);
                        } else {
                            let newValue: any = value;
                            newValue = {};
                            newValue[value] = "ASC";
                            value = newValue;
                        }
                    }

                    query[key] = value;
                }

                continue;
            }

            if (Array.isArray(queryParams[key])) {
                // Add each value in the array to each corresponding query
                let i = 0;
                for (const value of queryParams[key]) {
                    if (!query.where[i]) {
                        query.where[i] = {};
                    }

                    query.where[i][key] = ModelUtils.getQueryParamValue(value);

                    i++;
                }
            } else {
                // Add the parameter to every query
                for (let i = 0; i < numQueries; i++) {
                    if (!query.where[i]) {
                        query.where[i] = {};
                    }

                    query.where[i][key] = ModelUtils.getQueryParamValue(queryParams[key]);
                }
            }
        }

        if (query.where.length === 0) {
            delete query.where;
        }

        if (query.take) {
            query.take = Math.min(query.take, 1000);
        } else {
            query.take = 100;
        }
        query.page = query.page ? query.page : 0;

        return query;
    }

    /**
     * Builds a MongoDB compatible query object for the given criteria. Query params can have a value containing a
     * conditional operator to apply for the search. The operator is encoded with the format `op(value)`. The following
     * operators are supported:
     * * `eq` - Returns matches whose parameter exactly matches of the given value. e.g. `param = value`
     * * `gt` - Returns matches whose parameter is greater than the given value. e.g. `param > value`
     * * `gte` - Returns matches whose parameter is greater than or equal to the given value. e.g. `param >= value`
     * * `in` - Returns matches whose parameter includes one of the given values. e.g. `param in ('value1', 'value2', 'value3', ...)`
     * * `like` - Returns matches whose parameter is lexographically similar to the given value. `param like value`
     * * `lt` -  Returns matches whose parameter is less than the given value. e.g. `param < value`
     * * `lte` - Returns matches whose parameter is less than or equal to than the given value. e.g. `param < value`
     * * `not` - Returns matches whose parameter is not equal to the given value. e.g. `param not value`
     * * `range` - Returns matches whose parameter is greater than or equal to first given value and less than or equal to the second. e.g. `param between(1,100)`
     *
     * When no operator is provided the comparison will always be evaluated as `eq`.
     *
     * NOTE: The result of this function is only compatible with the `aggregate()` function.
     *
     * @param modelClass The class definition of the data model to build a search query for.
     * @param {any} params The URI parameters for the endpoint that was requested.
     * @param {any} queryParams The URI query parameters that were included in the request.
     * @param {bool} exactMatch Set to true to create a query where parameters are to be matched exactly, otherwise set to false to use a 'contains' search.
     * @param {any} user The user that is performing the request.
     * @returns {object} The TypeORM compatible query object.
     */
    public static buildSearchQueryMongo(
        modelClass: any,
        params?: any,
        queryParams?: any,
        exactMatch: boolean = false,
        user?: any
    ): any {
        const queries: any[] = [{}];
        let sort: any = undefined;

        // Add the URL parameters
        for (const key in params) {
            // If the value is 'me' that's a special keyword to reference the user ID.
            if (params[key] === "me") {
                if (!user) {
                    throw new ApiError(
                        ApiErrors.SEARCH_INVALID_ME_REFERENCE,
                        403,
                        ApiErrorMessages.SEARCH_INVALID_ME_REFERENCE
                    );
                }
                queries[0][key] = user.uid;
            } else {
                queries[0][key] = params[key];
            }
        }

        // logger?.debug(`Query params: ${JSON.stringify(queryParams)}`);

        for (const key in queryParams) {
            // Ignore reserved query parameters
            if (key.match(new RegExp("(jwt_|oauth_).*", "i"))) {
                continue;
            }

            // Limit, page and sort are reserved for specifying query limits
            if (key.match(new RegExp("(limit|page|sort).*", "i"))) {
                let value: any = queryParams[key];

                if (key === "sort") {
                    if (typeof value === "string") {
                        if (value.match(new RegExp(/^\{.*\}$/, "i"))) {
                            value = JSON.parse(value);
                        } else {
                            let newValue: any = value;
                            newValue = {};
                            newValue[value] = 1;
                            value = newValue;
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

                        if (value.toUpperCase() === "ASC") {
                            sort[key] = 1;
                        } else if (value.toUpperCase() === "DESC") {
                            sort[key] = -1;
                        }
                    });
                }

                continue;
            }

            if (key === "$or") {
                // Array of OR queries
                let orResults: any[] = [];
                for (const query of queryParams[key] as Array<any>) {
                    const subQueryOrResult = this.buildSearchQueryMongo(modelClass, undefined, query, exactMatch, user);
                    const validSubQueryResult =
                        subQueryOrResult && subQueryOrResult.length > 0 && subQueryOrResult[0]["$match"];
                    validSubQueryResult && orResults.push(validSubQueryResult);
                }

                queries[0] = { $or: orResults };

                continue;
            }

            if (Array.isArray(queryParams[key])) {
                // Add each value in the array to each corresponding query
                const conditions: any[] = [];
                for (let i = 0; i < queryParams[key].length; i++) {
                    const value: any = ModelUtils.getQueryParamValueMongo(queryParams[key][i]);

                    if (!queries[i]) {
                        queries[i] = {
                            ...queries[0],
                        };
                    }

                    queries[i][key] = value;
                }
            } else {
                const value: any = ModelUtils.getQueryParamValueMongo(queryParams[key]);
                for (let i = 0; i < queries.length; i++) {
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
        return result;
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
                    const isModel: any = Reflect.getMetadata("rrst:datastore", clazz) !== undefined;
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
