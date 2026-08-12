///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2020-2026 Jean-Philippe Steinmetz
///////////////////////////////////////////////////////////////////////////////
import "reflect-metadata";

import { ModelUtils } from "../src";
import { Identifier } from "../src/decorators/ModelDecorators";
import { RecoverableBaseEntity } from "../src/models/RecoverableBaseEntity";
import { RecoverableBaseMongoEntity } from "../src/models/RecoverableBaseMongoEntity";
import * as typeorm from "typeorm";
import {
    Not,
    ILike,
    Equal,
    Between,
    MoreThan,
    MoreThanOrEqual,
    LessThan,
    LessThanOrEqual,
    In,
    Entity,
    PrimaryColumn,
    Column,
} from "typeorm";

@Entity()
class SingleIdentifierClass {
    @Identifier
    @PrimaryColumn()
    public id: string = "";
}

@Entity()
class DoubleIdentifierClass {
    @Identifier
    @PrimaryColumn()
    public id: string = "";

    @Identifier
    @Column()
    public id2: number = 0;
}

class RecoverableMongoTestClass extends RecoverableBaseMongoEntity {}

@Entity()
class RecoverableSQLTestClass extends RecoverableBaseEntity {}

describe("ModelUtils Tests", () => {
    describe("MongoDB Tests", () => {
        it("Can build id search query with single identifier.", () => {
            const query: any = ModelUtils.buildIdSearchQueryMongo(SingleIdentifierClass, "MyID");
            expect(query).toEqual({
                $or: [{ id: "MyID" }],
            });
        });

        it("Can build id search query with single identifier and version.", () => {
            const query: any = ModelUtils.buildIdSearchQueryMongo(SingleIdentifierClass, "MyID", 2);
            expect(query).toEqual({
                $or: [{ id: "MyID", version: 2 }],
            });
        });

        it("Can build id search query with single identifier and version 0.", () => {
            const query: any = ModelUtils.buildIdSearchQueryMongo(SingleIdentifierClass, "MyID", 0);
            expect(query).toEqual({
                $or: [{ id: "MyID", version: 0 }],
            });
        });

        it("Can build id search query with multiple identifiers.", () => {
            const query: any = ModelUtils.buildIdSearchQueryMongo(DoubleIdentifierClass, "MyID");
            expect(query).toEqual({
                $or: [{ id: "MyID" }, { id2: "MyID" }],
            });
        });

        it("Can build id search query with multiple identifiers and version.", () => {
            const query: any = ModelUtils.buildIdSearchQueryMongo(DoubleIdentifierClass, "MyID", 3);
            expect(query).toEqual({
                $or: [
                    { id: "MyID", version: 3 },
                    { id2: "MyID", version: 3 },
                ],
            });
        });

        it("Can build id search query with multiple identifiers and values.", () => {
            const query: any = ModelUtils.buildIdSearchQueryMongo(DoubleIdentifierClass, ["MyID", "MyID2"]);
            expect(query).toEqual({
                $or: [{ id: { $in: ["MyID", "MyID2"] } }, { id2: { $in: ["MyID", "MyID2"] } }],
            });
        });

        it("Can build id search query with multiple identifiers and values and version.", () => {
            const query: any = ModelUtils.buildIdSearchQueryMongo(DoubleIdentifierClass, ["MyID", "MyID2"], 3);
            expect(query).toEqual({
                $or: [
                    { id: { $in: ["MyID", "MyID2"] }, version: 3 },
                    { id2: { $in: ["MyID", "MyID2"] }, version: 3 },
                ],
            });
        });

        it("Includes soft-deleted records in an id search query by default.", () => {
            // Defaults to true (match regardless of deleted state) so existing lookup/validation callers keep
            // their current behavior; callers exposing a record by id to an API client (RepoUtils.findOne/exists)
            // explicitly opt out by passing includeDeleted: false.
            const query: any = ModelUtils.buildIdSearchQueryMongo(RecoverableMongoTestClass, "MyID");
            expect(query).toEqual({
                $or: [{ uid: "MyID" }],
            });
        });

        it("Excludes soft-deleted records from an id search query when includeDeleted is false.", () => {
            const query: any = ModelUtils.buildIdSearchQueryMongo(RecoverableMongoTestClass, "MyID", undefined, false);
            expect(query).toEqual({
                $or: [{ uid: "MyID", deleted: false }],
            });
        });

        it("Does not filter by `deleted` for a non-recoverable model.", () => {
            const query: any = ModelUtils.buildIdSearchQueryMongo(SingleIdentifierClass, "MyID");
            expect(query).toEqual({
                $or: [{ id: "MyID" }],
            });
        });

        it("Can build search query with sort (default).", () => {
            const request: any = {};
            request.query = {
                sort: "paramName",
            };

            const query = ModelUtils.buildSearchQueryMongo(undefined, request.query, true, request.user);
            expect(query).toEqual({ $match: {}, $sort: { paramName: 1 } });
        });

        it("Can build search query with sort (desc).", () => {
            const request: any = {};
            request.query = {
                sort: JSON.stringify({ paramName: "DESC" }),
            };

            const query = ModelUtils.buildSearchQueryMongo(undefined, request.query, true, request.user);
            expect(query).toEqual({ $match: {}, $sort: { paramName: -1 } });
        });

        it("Can build search query with sort (desc as object).", () => {
            const request: any = {};
            request.query = {
                sort: { paramName: "DESC" },
            };

            const query = ModelUtils.buildSearchQueryMongo(undefined, request.query, true, request.user);
            expect(query).toEqual({ $match: {}, $sort: { paramName: -1 } });
        });

        it("Skips (rather than throws for) a sort value that is neither a number nor a string.", () => {
            const request: any = {};
            request.query = {
                sort: { paramName: { nested: 1 } },
            };

            const query = ModelUtils.buildSearchQueryMongo(undefined, request.query, true, request.user);
            expect(query).toEqual({ $match: {} });
        });

        it("Resolves the 'me' keyword to the requesting user's uid.", () => {
            const request: any = { user: { uid: "019eaa26-b4ec-4870-88b6-2d3755a8a05c" } };
            request.query = {
                myParam: "me",
            };

            const query = ModelUtils.buildSearchQueryMongo(undefined, request.query, true, request.user);
            expect(query).toEqual({
                $match: {
                    myParam: "019eaa26-b4ec-4870-88b6-2d3755a8a05c",
                },
            });
        });

        it("Rejects the 'me' keyword when there is no authenticated user to resolve it against.", () => {
            const request: any = {};
            request.query = {
                myParam: "me",
            };

            expect(() => ModelUtils.buildSearchQueryMongo(undefined, request.query, true, request.user)).toThrow();
        });

        it("Can build search query with single param (default)", () => {
            const request: any = {};
            request.query = {
                myParam: "myValue",
            };

            const query = ModelUtils.buildSearchQueryMongo(undefined, request.query, true, request.user);
            expect(query).toEqual({
                $match: {
                    myParam: "myValue",
                },
            });
        });

        it("Can build search query with single param of int type default", () => {
            const request: any = {};
            request.query = {
                myParam: "100.00",
            };

            const query = ModelUtils.buildSearchQueryMongo(undefined, request.query, true, request.user);
            expect(query).toEqual({
                $match: {
                    myParam: 100,
                },
            });
        });

        it("Can build search query with single param of boolean type (default)", () => {
            const request: any = {};
            request.query = {
                myParam: "true",
            };

            const query = ModelUtils.buildSearchQueryMongo(undefined, request.query, true, request.user);
            expect(query).toEqual({
                $match: {
                    myParam: true,
                },
            });
        });

        it("Can build search query with single param of date type (default)", () => {
            const request: any = {};
            request.query = {
                myParam: "2019-09-05T03:27:13.258Z",
            };

            const query = ModelUtils.buildSearchQueryMongo(undefined, request.query, true, request.user);
            expect(query).toEqual({
                $match: {
                    myParam: new Date("2019-09-05T03:27:13.258Z"),
                },
            });
        });

        it("Can build search query with single param (eq)", () => {
            const request: any = {};
            request.query = {
                myParam: "eq(myValue)",
            };

            const query = ModelUtils.buildSearchQueryMongo(undefined, request.query, true, request.user);
            expect(query).toEqual({
                $match: {
                    myParam: "myValue",
                },
            });
        });

        it("Can build search query with single param of boolean type (eq)", () => {
            const request: any = {};
            request.query = {
                myParam: "eq(true)",
            };

            const query = ModelUtils.buildSearchQueryMongo(undefined, request.query, true, request.user);
            expect(query).toEqual({
                $match: {
                    myParam: true,
                },
            });
        });

        it("Can build search query with single param of number type (eq)", () => {
            const request: any = {};
            request.query = {
                myParam: "eq(105.56)",
            };

            const query = ModelUtils.buildSearchQueryMongo(undefined, request.query, true, request.user);
            expect(query).toEqual({
                $match: {
                    myParam: 105.56,
                },
            });
        });

        it("Can build search query with single param (gt)", () => {
            const request: any = {};
            request.query = {
                myParam: "gt(myValue)",
            };

            const query = ModelUtils.buildSearchQueryMongo(undefined, request.query, true, request.user);
            expect(query).toEqual({
                $match: {
                    myParam: { $gt: "myValue" },
                },
            });
        });

        it("Can build search query with single param of date type (gt)", () => {
            const request: any = {};
            request.query = {
                myParam: "gt(2019-09-05T03:27:13.258Z)",
            };

            const query = ModelUtils.buildSearchQueryMongo(undefined, request.query, true, request.user);
            expect(query).toEqual({
                $match: {
                    myParam: { $gt: new Date("2019-09-05T03:27:13.258Z") },
                },
            });
        });

        it("Can build search query with single param (gte)", () => {
            const request: any = {};
            request.query = {
                myParam: "gte(myValue)",
            };

            const query = ModelUtils.buildSearchQueryMongo(undefined, request.query, true, request.user);
            expect(query).toEqual({
                $match: {
                    myParam: { $gte: "myValue" },
                },
            });
        });

        it("Can build search query with single param (in)", () => {
            const request: any = {};
            request.query = {
                myParam: "in(myValue,myValue2,myValue3,myValue4)",
            };

            const query = ModelUtils.buildSearchQueryMongo(undefined, request.query, true, request.user);
            expect(query).toEqual({
                $match: {
                    myParam: { $in: ["myValue", "myValue2", "myValue3", "myValue4"] },
                },
            });
        });

        it("Can build search query with single param (ILike)", () => {
            const request: any = {};
            request.query = {
                myParam: "like(myValue)",
            };

            const query = ModelUtils.buildSearchQueryMongo(undefined, request.query, true, request.user);
            expect(query).toEqual({
                $match: {
                    myParam: { $options: "i", $regex: "myValue" },
                },
            });
        });

        it("Rejects a $-prefixed query parameter key.", () => {
            const request: any = {};
            request.query = {
                $where: "function() { return true; }",
            };

            expect(() => ModelUtils.buildSearchQueryMongo(undefined, request.query, true, request.user)).toThrow();
        });

        it("Rejects a dot-notation query parameter key.", () => {
            const request: any = {};
            request.query = {
                "profile.password": "eq(x)",
            };

            expect(() => ModelUtils.buildSearchQueryMongo(undefined, request.query, true, request.user)).toThrow();
        });

        it("Rejects a Mongo operator hidden inside an eq() value.", () => {
            const request: any = {};
            request.query = {
                myParam: 'eq({"$ne":null})',
            };

            expect(() => ModelUtils.buildSearchQueryMongo(undefined, request.query, true, request.user)).toThrow();
        });

        it("Rejects a Mongo operator hidden inside a bare JSON value.", () => {
            const request: any = {};
            request.query = {
                myParam: '{"$gt":0}',
            };

            expect(() => ModelUtils.buildSearchQueryMongo(undefined, request.query, true, request.user)).toThrow();
        });

        it("Rejects a Mongo operator supplied as an already-parsed object value, not an op(value) string.", () => {
            // This is the shape RouteUtils.wrapMiddleware's `q` query parameter produces: it base64-decodes
            // and JSON.parses the raw client payload, so a query value can arrive as a real object rather
            // than the `op(value)`-encoded string every other test in this suite exercises. The string-only
            // checks above must not be the only line of defense.
            const request: any = {};
            request.query = {
                myParam: { $ne: null },
            };

            expect(() => ModelUtils.buildSearchQueryMongo(undefined, request.query, true, request.user)).toThrow();
        });

        it("Rejects a Mongo operator nested inside an already-parsed array value.", () => {
            const request: any = {};
            request.query = {
                myParam: ["safe", { $gt: 0 }],
            };

            expect(() => ModelUtils.buildSearchQueryMongo(undefined, request.query, true, request.user)).toThrow();
        });

        it("Still allows an already-parsed plain object/array value with no hidden operator.", () => {
            const request: any = {};
            request.query = {
                myParam: { nested: "value" },
            };

            const query = ModelUtils.buildSearchQueryMongo(undefined, request.query, true, request.user);
            expect(query).toEqual({
                $match: {
                    myParam: { nested: "value" },
                },
            });
        });

        it("Rejects a Mongo operator hidden inside a range() value.", () => {
            const request: any = {};
            request.query = {
                myParam: 'range({"$gt":0},5)',
            };

            expect(() => ModelUtils.buildSearchQueryMongo(undefined, request.query, true, request.user)).toThrow();
        });

        it("Still allows the framework's own $gt/$lt/$in/etc. operators built from op(value) syntax.", () => {
            const request: any = {};
            request.query = {
                myParam: "gt(myValue)",
            };

            const query = ModelUtils.buildSearchQueryMongo(undefined, request.query, true, request.user);
            expect(query).toEqual({
                $match: {
                    myParam: { $gt: "myValue" },
                },
            });
        });

        it("Rejects a ReDoS-shaped like() pattern (nested quantifiers).", () => {
            const request: any = {};
            request.query = {
                myParam: "like((a+)+$)",
            };

            expect(() => ModelUtils.buildSearchQueryMongo(undefined, request.query, true, request.user)).toThrow();
        });

        it("Rejects an overly long like() pattern.", () => {
            const request: any = {};
            request.query = {
                myParam: `like(${"a".repeat(200)})`,
            };

            expect(() => ModelUtils.buildSearchQueryMongo(undefined, request.query, true, request.user)).toThrow();
        });

        it("Can build search query with single param (lt)", () => {
            const request: any = {};
            request.query = {
                myParam: "lt(myValue)",
            };

            const query = ModelUtils.buildSearchQueryMongo(undefined, request.query, true, request.user);
            expect(query).toEqual({
                $match: {
                    myParam: { $lt: "myValue" },
                },
            });
        });

        it("Can build search query with single param (lte)", () => {
            const request: any = {};
            request.query = {
                myParam: "lte(myValue)",
            };

            const query = ModelUtils.buildSearchQueryMongo(undefined, request.query, true, request.user);
            expect(query).toEqual({
                $match: {
                    myParam: { $lte: "myValue" },
                },
            });
        });

        it("Can build search query with single param (not)", () => {
            const request: any = {};
            request.query = {
                myParam: "not(myValue)",
            };

            const query = ModelUtils.buildSearchQueryMongo(undefined, request.query, true, request.user);
            expect(query).toEqual({
                $match: {
                    myParam: { $not: "myValue" },
                },
            });
        });

        it("Can build search query with single param (range)", () => {
            const request: any = {};
            request.query = {
                myParam: "range(1,100)",
            };

            const query = ModelUtils.buildSearchQueryMongo(undefined, request.query, true, request.user);
            expect(query).toEqual({
                $match: {
                    myParam: { $gte: 1, $lte: 100 },
                },
            });
        });

        it("Rejects a range() value with anything other than exactly two arguments.", () => {
            const request: any = {};
            request.query = {
                myParam: "range(1,2,3)",
            };

            expect(() => ModelUtils.buildSearchQueryMongo(undefined, request.query, true, request.user)).toThrow();
        });

        it("Falls back to raw strings for a range() whose bounds aren't valid JSON.", () => {
            const request: any = {};
            request.query = {
                myParam: "range(a,b)",
            };

            const query = ModelUtils.buildSearchQueryMongo(undefined, request.query, true, request.user);
            expect(query).toEqual({
                $match: {
                    myParam: { $gte: "a", $lte: "b" },
                },
            });
        });

        it("Passes through the raw value for an unrecognized operator name.", () => {
            const request: any = {};
            request.query = {
                myParam: "foo(bar)",
            };

            const query = ModelUtils.buildSearchQueryMongo(undefined, request.query, true, request.user);
            expect(query).toEqual({
                $match: {
                    myParam: "bar",
                },
            });
        });

        it("Rejects a Mongo operator hidden inside an array-valued query param.", () => {
            const request: any = {};
            request.query = {
                myParam: '[{"$gt":0}]',
            };

            expect(() => ModelUtils.buildSearchQueryMongo(undefined, request.query, true, request.user)).toThrow();
        });

        it("Can build search query with multiple params.", () => {
            const request: any = {};
            request.query = {
                equals: "myValue",
                not: "not(myValue2)",
                range: "range(1,100)",
            };

            const query = ModelUtils.buildSearchQueryMongo(undefined, request.query, true, request.user);
            expect(query).toEqual({
                $match: {
                    equals: "myValue",
                    not: { $not: "myValue2" },
                    range: { $gte: 1, $lte: 100 },
                },
            });
        });

        it("Can build search query with multiple params with same name.", () => {
            const request: any = {};
            request.query = {
                param: ["Eq(myValue)", "Not(myValue2)", "like(myValue3)"],
            };

            const query = ModelUtils.buildSearchQueryMongo(undefined, request.query, true, request.user);
            expect(query).toEqual({
                $match: {
                    $or: [
                        { param: "myValue" },
                        { param: { $not: "myValue2" } },
                        { param: { $regex: "myValue3", $options: "i" } },
                    ],
                },
            });
        });

        it("Can build search query with multiple params and with same name.", () => {
            const request: any = {};
            request.query = {
                param: ["eq(myValue)", "not(myValue2)", "like(myValue3)"],
                param2: "range(0,100)",
                param3: "hello",
            };

            const query = ModelUtils.buildSearchQueryMongo(undefined, request.query, true, request.user);
            expect(query).toEqual({
                $match: {
                    $or: [
                        { param: "myValue", param2: { $gte: 0, $lte: 100 }, param3: "hello" },
                        { param: { $not: "myValue2" }, param2: { $gte: 0, $lte: 100 }, param3: "hello" },
                        {
                            param: { $regex: "myValue3", $options: "i" },
                            param2: { $gte: 0, $lte: 100 },
                            param3: "hello",
                        },
                    ],
                },
            });
        });

        it("Can build search query and filter reserved words.", () => {
            const request: any = {};
            request.query = {
                auth_token: "df0afawfa09uf093joihff3983ufq3olifhj329f8uh.f23908uf2ofj32fo2u.f208f09qf2",
                oauth_token: "df0afawfa09uf093joihff3983ufq3olifhj329f8uh.f23908uf2ofj32fo2u.f208f09qf2",
            };

            const query = ModelUtils.buildSearchQueryMongo(undefined, request.query, true, request.user);
            expect(query).toEqual({ $match: {} });
        });

        it("Pads a shorter multi-valued param with its own last value instead of dropping it from extra OR branches.", () => {
            const request: any = {};
            request.query = {
                a: ["one", "two", "three"],
                b: ["ex", "why"],
            };

            const query = ModelUtils.buildSearchQueryMongo(undefined, request.query, true, request.user);
            expect(query).toEqual({
                $match: {
                    $or: [
                        { a: "one", b: "ex" },
                        { a: "two", b: "why" },
                        { a: "three", b: "why" },
                    ],
                },
            });
        });

        it("Pads a shorter multi-valued param regardless of key order.", () => {
            const request: any = {};
            request.query = {
                b: ["ex", "why"],
                a: ["one", "two", "three"],
            };

            const query = ModelUtils.buildSearchQueryMongo(undefined, request.query, true, request.user);
            expect(query).toEqual({
                $match: {
                    $or: [
                        { b: "ex", a: "one" },
                        { b: "why", a: "two" },
                        { b: "why", a: "three" },
                    ],
                },
            });
        });
    });

    describe("SQL Tests", () => {
        beforeAll(() => {
            ModelUtils.setTypeOrm(typeorm);
        });

        it("Resolves the 'me' keyword to the requesting user's uid.", () => {
            const request: any = { user: { uid: "019eaa26-b4ec-4870-88b6-2d3755a8a05c" } };
            request.query = {
                myParam: "me",
            };

            const query = ModelUtils.buildSearchQuerySQL(undefined, request.query, true, request.user);
            expect(query).toEqual({
                where: [
                    {
                        myParam: Equal("019eaa26-b4ec-4870-88b6-2d3755a8a05c"),
                    },
                ],
                page: 0,
                take: 100,
            });
        });

        it("Rejects the 'me' keyword when there is no authenticated user to resolve it against.", () => {
            const request: any = {};
            request.query = {
                myParam: "me",
            };

            expect(() => ModelUtils.buildSearchQuerySQL(undefined, request.query, true, request.user)).toThrow();
        });

        it("Throws when the `typeorm` peer dependency hasn't been provided via setTypeOrm().", () => {
            (ModelUtils as any).typeOrm = undefined;
            try {
                expect(() => ModelUtils.orm).toThrow(
                    "SQL query construction requires the optional peer dependency 'typeorm' but no SQL datastore has been initialized.",
                );
            } finally {
                // Restore so every other SQL test in this file keeps working.
                ModelUtils.setTypeOrm(typeorm);
            }
        });

        it("Can build id search query with single identifier.", () => {
            const query: any = ModelUtils.buildIdSearchQuerySQL(SingleIdentifierClass, "MyID");
            expect(query).toEqual({ where: [{ id: "MyID" }] });
        });

        it("Can build id search query with single identifier and version.", () => {
            const query: any = ModelUtils.buildIdSearchQuerySQL(SingleIdentifierClass, "MyID", 2);
            expect(query).toEqual({ where: [{ id: "MyID", version: 2 }] });
        });

        it("Can build id search query with multiple identifiers and values.", () => {
            const query: any = ModelUtils.buildIdSearchQuerySQL(DoubleIdentifierClass, ["MyID", "MyID2"]);
            expect(query).toEqual({
                where: [
                    { id: In(["MyID", "MyID2"]) },
                    { id2: In(["MyID", "MyID2"]) },
                ],
            });
        });

        it("Includes soft-deleted records in an id search query by default.", () => {
            const query: any = ModelUtils.buildIdSearchQuerySQL(RecoverableSQLTestClass, "MyID");
            expect(query).toEqual({ where: [{ uid: "MyID" }] });
        });

        it("Excludes soft-deleted records from an id search query when includeDeleted is false.", () => {
            const query: any = ModelUtils.buildIdSearchQuerySQL(RecoverableSQLTestClass, "MyID", undefined, false);
            expect(query).toEqual({ where: [{ uid: "MyID", deleted: false }] });
        });

        it("buildIdSearchQuery() dispatches to the SQL builder for a non-Mongo repo.", () => {
            const query: any = ModelUtils.buildIdSearchQuery(undefined, SingleIdentifierClass, "MyID");
            expect(query).toEqual({ where: [{ id: "MyID" }] });
        });

        it("Can build search query with limit.", () => {
            const request: any = {};
            request.query = {
                limit: 100,
            };

            const query = ModelUtils.buildSearchQuerySQL(undefined, request.query, true, request.user);
            expect(query).toEqual({
                take: 100,
                page: 0,
            });
        });

        it("Can build search query with capped limit.", () => {
            const request: any = {};
            request.query = {
                limit: 99999,
            };

            const query = ModelUtils.buildSearchQuerySQL(undefined, request.query, true, request.user);
            expect(query).toEqual({
                take: 1000,
                page: 0,
            });
        });

        it("Can build search query with page.", () => {
            const request: any = {};
            request.query = {
                page: 10,
            };

            const query = ModelUtils.buildSearchQuerySQL(undefined, request.query, true, request.user);
            expect(query).toEqual({
                page: 10,
                take: 100,
            });
        });

        it("Can build search query with sort (default).", () => {
            const request: any = {};
            request.query = {
                sort: "paramName",
            };

            const query = ModelUtils.buildSearchQuerySQL(undefined, request.query, true, request.user);
            expect(query).toEqual({
                order: {
                    paramName: "ASC",
                },
                page: 0,
                take: 100,
            });
        });

        it("Can build search query with sort (desc).", () => {
            const request: any = {};
            request.query = {
                sort: JSON.stringify({ paramName: "DESC" }),
            };

            const query = ModelUtils.buildSearchQuerySQL(undefined, request.query, true, request.user);
            expect(query).toEqual({
                order: {
                    paramName: "DESC",
                },
                page: 0,
                take: 100,
            });
        });

        it("Can build search query with sort (desc as object).", () => {
            const request: any = {};
            request.query = {
                sort: { paramName: "DESC" },
            };

            const query = ModelUtils.buildSearchQuerySQL(undefined, request.query, true, request.user);
            expect(query).toEqual({
                order: {
                    paramName: "DESC",
                },
                page: 0,
                take: 100,
            });
        });

        it("Can build search query with single param (default)", () => {
            const request: any = {};
            request.query = {
                myParam: "myValue",
            };

            const query = ModelUtils.buildSearchQuerySQL(undefined, request.query, true, request.user);
            expect(query).toEqual({
                where: [
                    {
                        myParam: Equal("myValue"),
                    },
                ],
                page: 0,
                take: 100,
            });
        });

        it("Can build search query with single param of type boolean (default)", () => {
            const request: any = {};
            request.query = {
                myParam: "true",
            };

            const query = ModelUtils.buildSearchQuerySQL(undefined, request.query, true, request.user);
            expect(query).toEqual({
                where: [
                    {
                        myParam: Equal(true),
                    },
                ],
                page: 0,
                take: 100,
            });
        });

        it("Can build search query with single param of date type (default)", () => {
            const request: any = {};
            request.query = {
                myParam: "2019-09-05T03:27:13.258Z",
            };

            const query = ModelUtils.buildSearchQuerySQL(undefined, request.query, true, request.user);
            expect(query).toEqual({
                page: 0,
                take: 100,
                where: [
                    {
                        myParam: Equal(new Date("2019-09-05T03:27:13.258Z")),
                    },
                ],
            });
        });

        it("Can build search query with single param of type number (default)", () => {
            const request: any = {};
            request.query = {
                myParam: "105.56",
            };

            const query = ModelUtils.buildSearchQuerySQL(undefined, request.query, true, request.user);
            expect(query).toEqual({
                where: [
                    {
                        myParam: Equal(105.56),
                    },
                ],
                page: 0,
                take: 100,
            });
        });

        it("Passes an already-non-string query value through as-is (e.g. a programmatically-built query).", () => {
            // Unlike an HTTP query string (always strings), a query object built directly by application code
            // can already contain a typed value -- getQueryParamValue() returns it unwrapped rather than
            // attempting to JSON.parse() a non-string.
            const request: any = {};
            request.query = {
                myParam: 5,
            };

            const query = ModelUtils.buildSearchQuerySQL(undefined, request.query, true, request.user);
            expect(query).toEqual({
                where: [
                    {
                        myParam: 5,
                    },
                ],
                page: 0,
                take: 100,
            });
        });

        it("Can build search query with single param (eq)", () => {
            const request: any = {};
            request.query = {
                myParam: "eq(myValue)",
            };

            const query = ModelUtils.buildSearchQuerySQL(undefined, request.query, true, request.user);
            expect(query).toEqual({
                where: [
                    {
                        myParam: Equal("myValue"),
                    },
                ],
                page: 0,
                take: 100,
            });
        });

        it("Can build search query with single param of type boolean (eq)", () => {
            const request: any = {};
            request.query = {
                myParam: "eq(false)",
            };

            const query = ModelUtils.buildSearchQuerySQL(undefined, request.query, true, request.user);
            expect(query).toEqual({
                where: [
                    {
                        myParam: Equal(false),
                    },
                ],
                page: 0,
                take: 100,
            });
        });

        it("Can build search query with single param of type number (eq)", () => {
            const request: any = {};
            request.query = {
                myParam: "eq(105.56)",
            };

            const query = ModelUtils.buildSearchQuerySQL(undefined, request.query, true, request.user);
            expect(query).toEqual({
                where: [
                    {
                        myParam: Equal(105.56),
                    },
                ],
                page: 0,
                take: 100,
            });
        });

        it("Can build search query with single param (gt)", () => {
            const request: any = {};
            request.query = {
                myParam: "gt(myValue)",
            };

            const query = ModelUtils.buildSearchQuerySQL(undefined, request.query, true, request.user);
            expect(query).toEqual({
                where: [
                    {
                        myParam: MoreThan("myValue"),
                    },
                ],
                page: 0,
                take: 100,
            });
        });

        it("Can build search query with single param of date type (gt)", () => {
            const request: any = {};
            request.query = {
                myParam: "gt(2019-09-05T03:27:13.258Z)",
            };

            const query = ModelUtils.buildSearchQuerySQL(undefined, request.query, true, request.user);
            expect(query).toEqual({
                page: 0,
                take: 100,
                where: [
                    {
                        myParam: MoreThan(new Date("2019-09-05T03:27:13.258Z")),
                    },
                ],
            });
        });

        it("Can build search query with single param (gte)", () => {
            const request: any = {};
            request.query = {
                myParam: "gte(myValue)",
            };

            const query = ModelUtils.buildSearchQuerySQL(undefined, request.query, true, request.user);
            expect(query).toEqual({
                where: [
                    {
                        myParam: MoreThanOrEqual("myValue"),
                    },
                ],
                page: 0,
                take: 100,
            });
        });

        it("Can build search query with single param (in)", () => {
            const request: any = {};
            request.query = {
                myParam: "in(myValue,myValue2,myValue3,myValue4)",
            };

            const query = ModelUtils.buildSearchQuerySQL(undefined, request.query, true, request.user);
            expect(query).toEqual({
                where: [
                    {
                        myParam: In(["myValue", "myValue2", "myValue3", "myValue4"]),
                    },
                ],
                page: 0,
                take: 100,
            });
        });

        it("Can build search query with single param (ILike)", () => {
            const request: any = {};
            request.query = {
                myParam: "like(myValue)",
            };

            const query = ModelUtils.buildSearchQuerySQL(undefined, request.query, true, request.user);
            expect(query).toEqual({
                where: [
                    {
                        myParam: ILike("myValue"),
                    },
                ],
                page: 0,
                take: 100,
            });
        });

        it("Can build search query with single param (lt)", () => {
            const request: any = {};
            request.query = {
                myParam: "lt(myValue)",
            };

            const query = ModelUtils.buildSearchQuerySQL(undefined, request.query, true, request.user);
            expect(query).toEqual({
                where: [
                    {
                        myParam: LessThan("myValue"),
                    },
                ],
                page: 0,
                take: 100,
            });
        });

        it("Can build search query with single param (lte)", () => {
            const request: any = {};
            request.query = {
                myParam: "lte(myValue)",
            };

            const query = ModelUtils.buildSearchQuerySQL(undefined, request.query, true, request.user);
            expect(query).toEqual({
                where: [
                    {
                        myParam: LessThanOrEqual("myValue"),
                    },
                ],
                page: 0,
                take: 100,
            });
        });

        it("Can build search query with single param (not)", () => {
            const request: any = {};
            request.query = {
                myParam: "not(myValue)",
            };

            const query = ModelUtils.buildSearchQuerySQL(undefined, request.query, true, request.user);
            expect(query).toEqual({
                where: [
                    {
                        myParam: Not("myValue"),
                    },
                ],
                page: 0,
                take: 100,
            });
        });

        it("Can build search query with single param (range)", () => {
            const request: any = {};
            request.query = {
                myParam: "range(1,100)",
            };

            const query = ModelUtils.buildSearchQuerySQL(undefined, request.query, true, request.user);
            expect(query).toEqual({
                where: [
                    {
                        myParam: Between(1, 100),
                    },
                ],
                page: 0,
                take: 100,
            });
        });
        it("Rejects a range() value with anything other than exactly two arguments.", () => {
            const request: any = {};
            request.query = {
                myParam: "range(1,2,3)",
            };

            expect(() => ModelUtils.buildSearchQuerySQL(undefined, request.query, true, request.user)).toThrow();
        });

        it("Falls back to raw strings for a range() whose bounds aren't valid JSON.", () => {
            const request: any = {};
            request.query = {
                myParam: "range(a,b)",
            };

            const query = ModelUtils.buildSearchQuerySQL(undefined, request.query, true, request.user);
            expect(query).toEqual({
                where: [
                    {
                        myParam: Between("a", "b"),
                    },
                ],
                page: 0,
                take: 100,
            });
        });

        it("Treats an unrecognized operator name as an equality comparison.", () => {
            const request: any = {};
            request.query = {
                myParam: "foo(bar)",
            };

            const query = ModelUtils.buildSearchQuerySQL(undefined, request.query, true, request.user);
            expect(query).toEqual({
                where: [
                    {
                        myParam: Equal("bar"),
                    },
                ],
                page: 0,
                take: 100,
            });
        });

        it("Can build search query with multiple params.", () => {
            const request: any = {};
            request.query = {
                equals: "myValue",
                not: "not(myValue2)",
                range: "range(1,100)",
            };

            const query = ModelUtils.buildSearchQuerySQL(undefined, request.query, true, request.user);
            expect(query).toEqual({
                where: [
                    {
                        equals: Equal("myValue"),
                        not: Not("myValue2"),
                        range: Between(1, 100),
                    },
                ],
                page: 0,
                take: 100,
            });
        });

        it("Can build search query with multiple params with same name.", () => {
            const request: any = {};
            request.query = {
                param: ["Eq(myValue)", "Not(myValue2)", "like(myValue3)"],
            };

            const query = ModelUtils.buildSearchQuerySQL(undefined, request.query, true, request.user);
            expect(query).toEqual({
                where: [
                    {
                        param: Equal("myValue"),
                    },
                    {
                        param: Not("myValue2"),
                    },
                    {
                        param: ILike("myValue3"),
                    },
                ],
                page: 0,
                take: 100,
            });
        });

        it("Can build search query with multiple params and with same name.", () => {
            const request: any = {};
            request.query = {
                param: ["Eq(myValue)", "Not(myValue2)", "Like(myValue3)"],
                param2: "range(0,100)",
                param3: "hello",
            };

            const query = ModelUtils.buildSearchQuerySQL(undefined, request.query, true, request.user);
            expect(query).toEqual({
                where: [
                    {
                        param: Equal("myValue"),
                        param2: Between(0, 100),
                        param3: Equal("hello"),
                    },
                    {
                        param: Not("myValue2"),
                        param2: Between(0, 100),
                        param3: Equal("hello"),
                    },
                    {
                        param: ILike("myValue3"),
                        param2: Between(0, 100),
                        param3: Equal("hello"),
                    },
                ],
                page: 0,
                take: 100,
            });
        });

        it("Pads a shorter multi-valued param with its own last value instead of dropping it from extra OR branches.", () => {
            const request: any = {};
            request.query = {
                a: ["one", "two", "three"],
                b: ["ex", "why"],
            };

            const query = ModelUtils.buildSearchQuerySQL(undefined, request.query, true, request.user);
            expect(query).toEqual({
                where: [
                    { a: Equal("one"), b: Equal("ex") },
                    { a: Equal("two"), b: Equal("why") },
                    { a: Equal("three"), b: Equal("why") },
                ],
                page: 0,
                take: 100,
            });
        });

        it("Can build search query and filter reserved words.", () => {
            const request: any = {};
            request.query = {
                auth_token: "df0afawfa09uf093joihff3983ufq3olifhj329f8uh.f23908uf2ofj32fo2u.f208f09qf2",
                oauth_token: "df0afawfa09uf093joihff3983ufq3olifhj329f8uh.f23908uf2ofj32fo2u.f208f09qf2",
            };

            const query = ModelUtils.buildSearchQuerySQL(undefined, request.query, true, request.user);
            expect(query).toEqual({
                page: 0,
                take: 100,
            });
        });

        it("Can build search query with global composite OR criteria", () => {
            const request: any = {};
            request.query = {
                $or: [
                    { param: "eq(myValue)", param2: "range(0,100)" },
                    { param: "not(myValue2)", param2: "range(100,200)" },
                ],
            };

            const query = ModelUtils.buildSearchQueryMongo(undefined, request.query, true, request.user);
            expect(query).toEqual({
                $match: {
                    $or: [
                        {
                            param: "myValue",
                            param2: {
                                $gte: 0,
                                $lte: 100,
                            },
                        },
                        {
                            param: {
                                $not: "myValue2",
                            },
                            param2: {
                                $gte: 100,
                                $lte: 200,
                            },
                        },
                    ],
                },
            });
        });

        it("Can build search query with global composite OR criteria and sort", () => {
            const request: any = {};
            request.query = {
                $or: [
                    { param: "eq(myValue)", param2: "range(0,100)" },
                    { param: "not(myValue2)", param2: "range(100,200)" },
                ],
                sort: {
                    paramName: "DESC",
                    secondParamName: "ASC",
                    undefinedParamName: undefined,
                    nullParamName: null,
                },
            };

            const query = ModelUtils.buildSearchQueryMongo(undefined, request.query, true, request.user);
            expect(query).toEqual({
                $match: {
                    $or: [
                        {
                            param: "myValue",
                            param2: {
                                $gte: 0,
                                $lte: 100,
                            },
                        },
                        {
                            param: {
                                $not: "myValue2",
                            },
                            param2: {
                                $gte: 100,
                                $lte: 200,
                            },
                        },
                    ],
                },
                $sort: {
                    paramName: -1,
                    secondParamName: 1,
                },
            });
        });
    });

    it("Can load models.", async () => {
        const results: Map<string, any> = await ModelUtils.loadModels("./test/server/models");
        expect(results).toBeDefined();
        expect(results.has("Item")).toBeTruthy();
        expect(results.has("User")).toBeTruthy();
    });

    it("Rejects when the given models path cannot be loaded.", async () => {
        await expect(ModelUtils.loadModels("./this/path/does/not/exist")).rejects.toBeDefined();
    });
});
