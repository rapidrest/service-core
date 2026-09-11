///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2020-2026 Jean-Philippe Steinmetz
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
import "reflect-metadata";

import { ModelUtils, GroupNode, PredicateNode, QueryNode } from "../src";
import { Identifier } from "../src/decorators/ModelDecorators";
import { RecoverableBaseEntity } from "../src/models/RecoverableBaseEntity";
import { RecoverableBaseMongoEntity } from "../src/models/RecoverableBaseMongoEntity";
import { Column as RrstColumn } from "../src/decorators/PersistenceDecorators";
import { MongoRepository } from "../src/database/MongoRepository";
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
    IsNull,
    Entity,
    PrimaryColumn,
    Column,
} from "typeorm";

// Declared with the framework's own `@Column` (from PersistenceDecorators, the same decorator production model
// classes like Item/User use) rather than raw TypeORM decorators, so `getColumnMetadata()` - and therefore
// `ModelUtils`'s declared-type coercion and sort-field validation - can see it. The SQL fixtures elsewhere in
// this file (`SingleIdentifierClass` etc.) deliberately use raw TypeORM decorators instead, so they carry no
// such metadata and exercise the heuristic fallback path.
class TypedTestClass {
    @RrstColumn({ primary: true })
    public uid: string = "";

    @RrstColumn()
    public name: string = "";

    @RrstColumn()
    public age: number = 0;

    @RrstColumn()
    public active: boolean = false;

    @RrstColumn()
    public createdAt: Date = new Date();
}

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

// A fake `MongoRepository` for exercising `buildQueryFromNode`'s Mongo branch, which only checks
// `repo instanceof MongoRepository` - `Object.create` gives it the right prototype chain without needing a
// real database connection or any of MongoRepository's own functionality.
const FAKE_MONGO_REPO: any = Object.create(MongoRepository.prototype);

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

        it("Can build search query with single param (like as glob)", () => {
            const request: any = {};
            request.query = {
                myParam: "like(myValue)",
            };

            const query = ModelUtils.buildSearchQueryMongo(undefined, request.query, true, request.user);
            expect(query).toEqual({
                $match: {
                    myParam: { $options: "i", $regex: "^myValue$" },
                },
            });
        });

        it("Translates glob wildcards in like() to an anchored regex.", () => {
            const request: any = {};
            request.query = {
                myParam: "like(*.txt)",
            };

            const query = ModelUtils.buildSearchQueryMongo(undefined, request.query, true, request.user);
            expect(query).toEqual({
                $match: {
                    myParam: { $options: "i", $regex: "^.*\\.txt$" },
                },
            });
        });

        it("Translates the glob `?` (single-char) wildcard too.", () => {
            const request: any = { query: { myParam: "like(a?c)" } };
            const query = ModelUtils.buildSearchQueryMongo(undefined, request.query, true, request.user);
            expect(query).toEqual({ $match: { myParam: { $options: "i", $regex: "^a.c$" } } });
        });

        it("Can build search query with single param (regex)", () => {
            const request: any = {};
            request.query = {
                myParam: "regex(^my.alue$)",
            };

            const query = ModelUtils.buildSearchQueryMongo(undefined, request.query, true, request.user);
            expect(query).toEqual({
                $match: {
                    myParam: { $options: "i", $regex: "^my.alue$" },
                },
            });
        });

        it("Can build search query with single param (exists true)", () => {
            const request: any = {};
            request.query = {
                myParam: "exists(true)",
            };

            const query = ModelUtils.buildSearchQueryMongo(undefined, request.query, true, request.user);
            expect(query).toEqual({
                $match: {
                    myParam: { $exists: true },
                },
            });
        });

        it("Can build search query with single param (exists false)", () => {
            const request: any = {};
            request.query = {
                myParam: "exists(false)",
            };

            const query = ModelUtils.buildSearchQueryMongo(undefined, request.query, true, request.user);
            expect(query).toEqual({
                $match: {
                    myParam: { $exists: false },
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

        it("Can build search query with a dot-notation sub-document field.", () => {
            const request: any = {};
            request.query = {
                "category.name": "eq(bunny)",
            };

            const query = ModelUtils.buildSearchQueryMongo(undefined, request.query, true, request.user);
            expect(query).toEqual({
                $match: {
                    "category.name": "bunny",
                },
            });
        });

        it("Rejects a $-prefixed segment within a dot-notation query parameter key.", () => {
            const request: any = {};
            request.query = {
                "category.$where": "eq(x)",
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

        it("Rejects a ReDoS-shaped regex() pattern (nested quantifiers).", () => {
            const request: any = {};
            request.query = {
                myParam: "regex((a+)+$)",
            };

            expect(() => ModelUtils.buildSearchQueryMongo(undefined, request.query, true, request.user)).toThrow();
        });

        it("Rejects a ReDoS-shaped regex() pattern (quantified alternation).", () => {
            const request: any = {};
            request.query = {
                myParam: "regex((a|ab)*$)",
            };

            expect(() => ModelUtils.buildSearchQueryMongo(undefined, request.query, true, request.user)).toThrow();
        });

        it("Rejects an overly long regex() pattern.", () => {
            const request: any = {};
            request.query = {
                myParam: `regex(${"a".repeat(200)})`,
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
            // A bare scalar operand under Mongo's `$not` is rejected by the server ($not requires an operator
            // expression or a regex) - `not()` compiles to `$ne` for a scalar operand instead.
            const request: any = {};
            request.query = {
                myParam: "not(myValue)",
            };

            const query = ModelUtils.buildSearchQueryMongo(undefined, request.query, true, request.user);
            expect(query).toEqual({
                $match: {
                    myParam: { $ne: "myValue" },
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

        it("Rejects an unrecognized operator name rather than silently treating it as equality.", () => {
            const request: any = {};
            request.query = {
                myParam: "foo(bar)",
            };

            expect(() => ModelUtils.buildSearchQueryMongo(undefined, request.query, true, request.user)).toThrow();
        });

        it("Still allows a literal field value shaped like an operator call via the eq() escape hatch.", () => {
            const request: any = {};
            request.query = {
                myParam: "eq(foo(bar))",
            };

            const query = ModelUtils.buildSearchQueryMongo(undefined, request.query, true, request.user);
            expect(query).toEqual({
                $match: {
                    myParam: "foo(bar)",
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
                    not: { $ne: "myValue2" },
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
                        { param: { $ne: "myValue2" } },
                        { param: { $regex: "^myValue3$", $options: "i" } },
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
                        { param: { $ne: "myValue2" }, param2: { $gte: 0, $lte: 100 }, param3: "hello" },
                        {
                            param: { $regex: "^myValue3$", $options: "i" },
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
                    "SQL query construction requires the optional peer dependency 'typeorm' but no SQL datasource has been initialized.",
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
                where: [{ id: In(["MyID", "MyID2"]) }, { id2: In(["MyID", "MyID2"]) }],
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

        it("Translates glob wildcards in like() to a SQL LIKE pattern.", () => {
            const request: any = { query: { a: "like(Item*)", b: "like(a?c)" } };
            const query = ModelUtils.buildSearchQuerySQL(undefined, request.query, true, request.user);
            expect(query.where[0].a).toEqual(ILike("Item%"));
            expect(query.where[0].b).toEqual(ILike("a_c"));
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

        it("Builds not(null)/ne(null) as Not(IsNull()), not Not(null) - the latter compiles to `!= NULL`, which SQL NULL semantics always evaluate to unknown/false, silently matching zero rows regardless of the column's actual value.", () => {
            const request: any = {};
            request.query = {
                notParam: "not(null)",
                neParam: "ne(null)",
            };

            const query = ModelUtils.buildSearchQuerySQL(undefined, request.query, true, request.user);
            expect(query).toEqual({
                where: [
                    {
                        notParam: Not(IsNull()),
                        neParam: Not(IsNull()),
                    },
                ],
                page: 0,
                take: 100,
            });
        });

        it("Builds eq(null) as IsNull(), not Equal(null) - same NULL-semantics gap as not(null)/ne(null).", () => {
            const request: any = {};
            request.query = {
                myParam: "eq(null)",
            };

            const query = ModelUtils.buildSearchQuerySQL(undefined, request.query, true, request.user);
            expect(query).toEqual({
                where: [
                    {
                        myParam: IsNull(),
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

        it("Rejects an unrecognized operator name rather than silently treating it as equality.", () => {
            const request: any = {};
            request.query = {
                myParam: "foo(bar)",
            };

            expect(() => ModelUtils.buildSearchQuerySQL(undefined, request.query, true, request.user)).toThrow();
        });

        it("Still allows a literal field value shaped like an operator call via the eq() escape hatch.", () => {
            const request: any = {};
            request.query = {
                myParam: "eq(foo(bar))",
            };

            const query = ModelUtils.buildSearchQuerySQL(undefined, request.query, true, request.user);
            expect(query).toEqual({
                where: [
                    {
                        myParam: Equal("foo(bar)"),
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
                                $ne: "myValue2",
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
                                $ne: "myValue2",
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

    describe("exactMatch (contains search) Tests", () => {
        it("Matches a bare string value as a case-insensitive substring when exactMatch is false (Mongo).", () => {
            const request: any = { query: { myParam: "ell" } };
            const query = ModelUtils.buildSearchQueryMongo(undefined, request.query, false, request.user);
            expect(query).toEqual({ $match: { myParam: { $regex: "ell", $options: "i" } } });
        });

        it("Matches exactly when exactMatch is true (Mongo), even for the same bare value.", () => {
            const request: any = { query: { myParam: "ell" } };
            const query = ModelUtils.buildSearchQueryMongo(undefined, request.query, true, request.user);
            expect(query).toEqual({ $match: { myParam: "ell" } });
        });

        it("Does not apply contains-search to an explicit eq() operator, even when exactMatch is false (Mongo).", () => {
            const request: any = { query: { myParam: "eq(ell)" } };
            const query = ModelUtils.buildSearchQueryMongo(undefined, request.query, false, request.user);
            expect(query).toEqual({ $match: { myParam: "ell" } });
        });

        it("Matches a bare string value as a case-insensitive substring when exactMatch is false (SQL).", () => {
            const request: any = { query: { myParam: "ell" } };
            const query = ModelUtils.buildSearchQuerySQL(undefined, request.query, false, request.user);
            expect(query).toEqual({ where: [{ myParam: ILike("%ell%") }], page: 0, take: 100 });
        });

        it("Matches exactly when exactMatch is true (SQL), even for the same bare value.", () => {
            const request: any = { query: { myParam: "ell" } };
            const query = ModelUtils.buildSearchQuerySQL(undefined, request.query, true, request.user);
            expect(query).toEqual({ where: [{ myParam: Equal("ell") }], page: 0, take: 100 });
        });

        it("Does not apply contains-search to a non-string (e.g. number) bare value.", () => {
            const request: any = { query: { myParam: "5" } };
            const query = ModelUtils.buildSearchQuerySQL(undefined, request.query, false, request.user);
            expect(query).toEqual({ where: [{ myParam: Equal(5) }], page: 0, take: 100 });
        });
    });

    describe("exists() operator Tests", () => {
        it("Compiles exists(true) to $exists:true (Mongo).", () => {
            const request: any = { query: { myParam: "exists(true)" } };
            const query = ModelUtils.buildSearchQueryMongo(undefined, request.query, true, request.user);
            expect(query).toEqual({ $match: { myParam: { $exists: true } } });
        });

        it("Compiles exists(false) to $exists:false (Mongo).", () => {
            const request: any = { query: { myParam: "exists(false)" } };
            const query = ModelUtils.buildSearchQueryMongo(undefined, request.query, true, request.user);
            expect(query).toEqual({ $match: { myParam: { $exists: false } } });
        });

        it("Compiles exists(true) to Not(IsNull()) (SQL).", () => {
            const request: any = { query: { myParam: "exists(true)" } };
            const query = ModelUtils.buildSearchQuerySQL(undefined, request.query, true, request.user);
            expect(query).toEqual({ where: [{ myParam: Not(IsNull()) }], page: 0, take: 100 });
        });

        it("Compiles exists(false) to IsNull() (SQL).", () => {
            const request: any = { query: { myParam: "exists(false)" } };
            const query = ModelUtils.buildSearchQuerySQL(undefined, request.query, true, request.user);
            expect(query).toEqual({ where: [{ myParam: IsNull() }], page: 0, take: 100 });
        });
    });

    describe("regex() operator SQL driver dispatch Tests", () => {
        it("Compiles regex() to a `~*` Raw expression for a postgres driver.", () => {
            const request: any = { query: { myParam: "regex(^abc$)" } };
            const query = ModelUtils.buildSearchQuerySQL(undefined, request.query, true, request.user, "postgres");
            const operator = query.where[0].myParam;
            expect(operator.getSql("myParam")).toBe("myParam ~* :pattern");
            expect(operator.objectLiteralParameters).toEqual({ pattern: "^abc$" });
        });

        it("Compiles regex() to a `REGEXP` Raw expression for a mysql driver.", () => {
            const request: any = { query: { myParam: "regex(^abc$)" } };
            const query = ModelUtils.buildSearchQuerySQL(undefined, request.query, true, request.user, "mysql");
            const operator = query.where[0].myParam;
            expect(operator.getSql("myParam")).toBe("myParam REGEXP :pattern");
        });

        it("Compiles regex() to a `REGEXP` Raw expression for a better-sqlite3 driver.", () => {
            const request: any = { query: { myParam: "regex(^abc$)" } };
            const query = ModelUtils.buildSearchQuerySQL(
                undefined,
                request.query,
                true,
                request.user,
                "better-sqlite3",
            );
            const operator = query.where[0].myParam;
            expect(operator.getSql("myParam")).toBe("myParam REGEXP :pattern");
        });

        it("Rejects regex() outright for an unsupported/unknown driver rather than guessing.", () => {
            const request: any = { query: { myParam: "regex(^abc$)" } };
            expect(() =>
                ModelUtils.buildSearchQuerySQL(undefined, request.query, true, request.user, "mssql"),
            ).toThrow();
        });

        it("Rejects a ReDoS-shaped regex() pattern before it ever reaches driver dispatch (SQL).", () => {
            const request: any = { query: { myParam: "regex((a+)+$)" } };
            expect(() =>
                ModelUtils.buildSearchQuerySQL(undefined, request.query, true, request.user, "postgres"),
            ).toThrow();
        });
    });

    describe("Declared-type operand coercion Tests (coerceOperand)", () => {
        it("Coerces a numeric operand for a Number-typed column and rejects a non-numeric one.", () => {
            const okQuery = ModelUtils.buildSearchQuerySQL(TypedTestClass, { age: "eq(42)" }, true);
            expect(okQuery.where[0].age).toEqual(Equal(42));

            expect(() => ModelUtils.buildSearchQuerySQL(TypedTestClass, { age: "eq(notanumber)" }, true)).toThrow();
        });

        it("Coerces a boolean operand for a Boolean-typed column and rejects an invalid one.", () => {
            const okQuery = ModelUtils.buildSearchQuerySQL(TypedTestClass, { active: "eq(true)" }, true);
            expect(okQuery.where[0].active).toEqual(Equal(true));

            expect(() => ModelUtils.buildSearchQuerySQL(TypedTestClass, { active: "eq(maybe)" }, true)).toThrow();
        });

        it("Coerces a date operand for a Date-typed column and rejects an unparseable one.", () => {
            const okQuery = ModelUtils.buildSearchQuerySQL(
                TypedTestClass,
                { createdAt: "eq(2020-01-01T00:00:00.000Z)" },
                true,
            );
            expect(okQuery.where[0].createdAt).toEqual(Equal(new Date("2020-01-01T00:00:00.000Z")));

            expect(() =>
                ModelUtils.buildSearchQuerySQL(TypedTestClass, { createdAt: "eq(not-a-date)" }, true),
            ).toThrow();
        });

        it("Fixes the 'Mar 5' bug: a String-typed column never attempts Date parsing.", () => {
            const query = ModelUtils.buildSearchQuerySQL(TypedTestClass, { name: "Mar 5" }, true);
            expect(query.where[0].name).toEqual(Equal("Mar 5"));
        });

        it("Coerces each element of in()/nin() according to the column's declared type.", () => {
            const query = ModelUtils.buildSearchQuerySQL(TypedTestClass, { age: "in(1,2,3)" }, true);
            expect(query.where[0].age).toEqual(In([1, 2, 3]));

            expect(() => ModelUtils.buildSearchQuerySQL(TypedTestClass, { age: "in(1,notanumber)" }, true)).toThrow();
        });

        it("Falls back to the JSON/Date/string heuristic when no column metadata is available (modelClass undefined).", () => {
            const query = ModelUtils.buildSearchQuerySQL(undefined, { age: "Mar 5" }, true);
            expect(query.where[0].age).toEqual(Equal(new Date("Mar 5")));
        });

        it("Falls back to the heuristic for a modelClass that declares no framework column metadata.", () => {
            // SingleIdentifierClass is declared with raw TypeORM decorators (not the framework's own @Column
            // from PersistenceDecorators), so getColumnMetadata() sees no columns for it at all.
            const query = ModelUtils.buildSearchQuerySQL(SingleIdentifierClass, { id: "Mar 5" }, true);
            expect(query.where[0].id).toEqual(Equal(new Date("Mar 5")));
        });

        it("Coerces the null literal to IsNull() for a typed column.", () => {
            const query = ModelUtils.buildSearchQuerySQL(TypedTestClass, { name: "eq(null)" }, true);
            expect(query.where[0].name).toEqual(IsNull());
        });

        it("Coerces the literal `false` for a Boolean-typed column.", () => {
            const query = ModelUtils.buildSearchQuerySQL(TypedTestClass, { active: "eq(false)" }, true);
            expect(query.where[0].active).toEqual(Equal(false));
        });
    });

    describe("`me` substitution inside operator syntax Tests", () => {
        it("Resolves `me` inside eq() (SQL), not just as a bare value.", () => {
            const user = { uid: "019eaa26-b4ec-4870-88b6-2d3755a8a05c" };
            const query = ModelUtils.buildSearchQuerySQL(undefined, { ownerUid: "eq(me)" }, true, user);
            expect(query.where[0].ownerUid).toEqual(Equal(user.uid));
        });

        it("Resolves `me` as one element of in() (Mongo).", () => {
            const user = { uid: "019eaa26-b4ec-4870-88b6-2d3755a8a05c" };
            const query = ModelUtils.buildSearchQueryMongo(undefined, { ownerUid: "in(me,other)" }, true, user);
            expect(query).toEqual({ $match: { ownerUid: { $in: [user.uid, "other"] } } });
        });

        it("Does not mutate the caller's query object when resolving `me`.", () => {
            const user = { uid: "019eaa26-b4ec-4870-88b6-2d3755a8a05c" };
            const query: any = { ownerUid: "me" };
            ModelUtils.buildSearchQueryMongo(undefined, query, true, user);
            expect(query.ownerUid).toBe("me");
        });
    });

    describe("Sort field validation Tests", () => {
        it("Rejects an unknown sort field when the model declares column metadata (SQL).", () => {
            expect(() => ModelUtils.buildSearchQuerySQL(TypedTestClass, { sort: "notAField" }, true)).toThrow();
        });

        it("Accepts a known sort field (SQL) and supports the `-field` descending shorthand.", () => {
            const query = ModelUtils.buildSearchQuerySQL(TypedTestClass, { sort: "-age" }, true);
            expect(query.order).toEqual({ age: "DESC" });
        });

        it("Rejects an unknown sort field when the model declares column metadata (Mongo).", () => {
            expect(() => ModelUtils.buildSearchQueryMongo(TypedTestClass, { sort: "notAField" }, true)).toThrow();
        });

        it("Accepts a known sort field (Mongo) and supports the `-field` descending shorthand.", () => {
            const query = ModelUtils.buildSearchQueryMongo(TypedTestClass, { sort: "-age" }, true);
            expect(query).toEqual({ $match: {}, $sort: { age: -1 } });
        });

        it("Does not validate sort fields when the model declares no column metadata at all.", () => {
            const query = ModelUtils.buildSearchQuerySQL(undefined, { sort: "anything" }, true);
            expect(query.order).toEqual({ anything: "ASC" });
        });

        it("Does not validate sort fields for a modelClass that declares no framework column metadata.", () => {
            // SingleIdentifierClass uses raw TypeORM decorators, not the framework's own @Column, so it has no
            // rrst:columns metadata at all - getSortablePropertyNames() falls back to permissive (undefined).
            const query = ModelUtils.buildSearchQuerySQL(SingleIdentifierClass, { sort: "anything" }, true);
            expect(query.order).toEqual({ anything: "ASC" });
        });
    });

    describe("$or nesting on the SQL backend Tests", () => {
        it("Expands a single $or into top-level OR branches via cross-product.", () => {
            const query = ModelUtils.buildSearchQuerySQL(
                undefined,
                { a: "alpha", $or: [{ b: "bravo" }, { c: "charlie" }] },
                true,
            );
            expect(query.where).toEqual([
                { a: Equal("alpha"), b: Equal("bravo") },
                { a: Equal("alpha"), c: Equal("charlie") },
            ]);
        });

        it("Rejects a $or query that expands beyond the complexity bound.", () => {
            const branches = Array.from({ length: 300 }, (_, i) => ({ x: String(i) }));
            expect(() => ModelUtils.buildSearchQuerySQL(undefined, { $or: branches }, true)).toThrow();
        });

        it("Rejects $or nesting deeper than the depth bound.", () => {
            let query: any = { a: "1" };
            for (let i = 0; i < 12; i++) {
                query = { $or: [query] };
            }
            expect(() => ModelUtils.buildSearchQuerySQL(undefined, query, true)).toThrow();
        });
    });

    describe("$or with a trackChanges model (Mongo) Tests", () => {
        class TrackedClass {
            public static trackChanges = true;
        }

        it("Extracts $match from a nested $or sub-query that itself compiles to a pipeline array.", () => {
            // A trackChanges model's own pipeline always has >= 3 stages ($match/$sort/$group/$replaceRoot), so
            // the recursive buildSearchQueryMongo() call for each $or sub-query returns the array form here -
            // exercising extractMatch()'s Array.isArray() branch rather than its plain-object branch.
            const query = ModelUtils.buildSearchQueryMongo(TrackedClass, { $or: [{ a: "1" }, { b: "2" }] }, true);
            expect(Array.isArray(query)).toBe(true);
            const matchStage = (query as any[]).find((stage) => stage.$match);
            expect(matchStage.$match).toEqual({ $or: [{ a: 1 }, { b: 2 }] });
        });
    });

    describe("QueryNode AST Tests (buildQueryFromNode)", () => {
        // Non-numeric-looking string values throughout, so the default (no column metadata) coercion heuristic
        // leaves them as plain strings rather than JSON-parsing them to numbers - keeps these trees focused on
        // AND/OR compilation shape rather than coercion, which has its own dedicated test group above.
        const node: GroupNode = {
            kind: "group",
            op: "and",
            children: [
                { kind: "predicate", field: "a", op: "eq", value: "alpha" },
                {
                    kind: "group",
                    op: "or",
                    children: [
                        { kind: "predicate", field: "b", op: "eq", value: "bravo" },
                        { kind: "predicate", field: "c", op: "eq", value: "charlie" },
                    ],
                },
            ],
        };

        it("Compiles a nested AND/OR tree to a MongoDB $and/$or filter.", () => {
            const query = ModelUtils.buildQueryFromNode(undefined, FAKE_MONGO_REPO, node);
            expect(query).toEqual({
                $match: {
                    $and: [{ a: "alpha" }, { $or: [{ b: "bravo" }, { c: "charlie" }] }],
                },
            });
        });

        it("Compiles the same tree to SQL where-branches via DNF cross-product.", () => {
            const query = ModelUtils.buildQueryFromNode(undefined, {} as any, node);
            expect(query.where).toEqual([
                { a: Equal("alpha"), b: Equal("bravo") },
                { a: Equal("alpha"), c: Equal("charlie") },
            ]);
        });

        it("Compiles a negated group to $nor on MongoDB.", () => {
            const negated: GroupNode = { kind: "group", op: "or", negated: true, children: node.children };
            const query = ModelUtils.buildQueryFromNode(undefined, FAKE_MONGO_REPO, negated);
            expect(query).toEqual({
                $match: { $nor: [{ $or: [{ a: "alpha" }, { $or: [{ b: "bravo" }, { c: "charlie" }] }] }] },
            });
        });

        it("Rejects a negated group against the SQL backend rather than guessing at De Morgan's law.", () => {
            const negated: GroupNode = { kind: "group", op: "or", negated: true, children: node.children };
            expect(() => ModelUtils.buildQueryFromNode(undefined, {} as any, negated)).toThrow();
        });

        it("Resolves `me` and applies declared-type coercion for a string-valued predicate node.", () => {
            const user = { uid: "019eaa26-b4ec-4870-88b6-2d3755a8a05c" };
            const predicate: PredicateNode = { kind: "predicate", field: "age", op: "eq", value: "42" };
            const query = ModelUtils.buildQueryFromNode(TypedTestClass, {} as any, predicate, user);
            expect(query.where).toEqual([{ age: Equal(42) }]);
        });

        it("Passes an already-typed (non-string) predicate value through as-is.", () => {
            const predicate: PredicateNode = { kind: "predicate", field: "age", op: "gt", value: 10 };
            const query = ModelUtils.buildQueryFromNode(undefined, FAKE_MONGO_REPO, predicate);
            expect(query).toEqual({ $match: { age: { $gt: 10 } } });
        });

        it("Rejects a hidden Mongo operator smuggled in as an already-typed predicate value.", () => {
            const predicate: PredicateNode = { kind: "predicate", field: "age", op: "eq", value: { $gt: 0 } };
            expect(() => ModelUtils.buildQueryFromNode(undefined, FAKE_MONGO_REPO, predicate)).toThrow();
        });

        it("Compiles an in()/range()-equivalent predicate node.", () => {
            const inNode: PredicateNode = { kind: "predicate", field: "age", op: "in", value: [1, 2, 3] };
            expect(ModelUtils.buildQueryFromNode(undefined, FAKE_MONGO_REPO, inNode)).toEqual({
                $match: { age: { $in: [1, 2, 3] } },
            });

            const rangeNode: PredicateNode = { kind: "predicate", field: "age", op: "range", value: [1, 10] };
            expect(ModelUtils.buildQueryFromNode(undefined, FAKE_MONGO_REPO, rangeNode)).toEqual({
                $match: { age: { $gte: 1, $lte: 10 } },
            });
        });

        it("Compiles every remaining predicate operator on both backends.", () => {
            const cases: Array<{ node: PredicateNode; mongo: any; sqlValueCheck: (v: any) => void }> = [
                {
                    node: { kind: "predicate", field: "age", op: "ne", value: 5 },
                    mongo: { age: { $ne: 5 } },
                    sqlValueCheck: (v) => expect(v).toEqual(Not(5)),
                },
                {
                    node: { kind: "predicate", field: "age", op: "lt", value: 5 },
                    mongo: { age: { $lt: 5 } },
                    sqlValueCheck: (v) => expect(v).toEqual(LessThan(5)),
                },
                {
                    node: { kind: "predicate", field: "age", op: "lte", value: 5 },
                    mongo: { age: { $lte: 5 } },
                    sqlValueCheck: (v) => expect(v).toEqual(LessThanOrEqual(5)),
                },
                {
                    node: { kind: "predicate", field: "age", op: "nin", value: [1, 2] },
                    mongo: { age: { $nin: [1, 2] } },
                    sqlValueCheck: (v) => expect(v).toEqual(Not(In([1, 2]))),
                },
                {
                    node: { kind: "predicate", field: "name", op: "like", value: "a*" },
                    mongo: { name: { $regex: "^a.*$", $options: "i" } },
                    sqlValueCheck: (v) => expect(v).toEqual(ILike("a%")),
                },
                {
                    node: { kind: "predicate", field: "name", op: "exists", value: true },
                    mongo: { name: { $exists: true } },
                    sqlValueCheck: (v) => expect(v).toEqual(Not(IsNull())),
                },
                {
                    node: { kind: "predicate", field: "name", op: "exists", value: false },
                    mongo: { name: { $exists: false } },
                    sqlValueCheck: (v) => expect(v).toEqual(IsNull()),
                },
            ];

            for (const { node, mongo, sqlValueCheck } of cases) {
                expect(ModelUtils.buildQueryFromNode(undefined, FAKE_MONGO_REPO, node)).toEqual({ $match: mongo });
                const sqlQuery = ModelUtils.buildQueryFromNode(undefined, {} as any, node);
                sqlValueCheck(sqlQuery.where[0][node.field]);
            }
        });

        it("Compiles regex() and rejects a ReDoS-shaped pattern, on both backends.", () => {
            const sqliteRepo: any = { manager: { connection: { options: { type: "better-sqlite3" } } } };
            const node: PredicateNode = { kind: "predicate", field: "name", op: "regex", value: "^abc$" };
            expect(ModelUtils.buildQueryFromNode(undefined, FAKE_MONGO_REPO, node)).toEqual({
                $match: { name: { $regex: "^abc$", $options: "i" } },
            });
            const sqlQuery = ModelUtils.buildQueryFromNode(undefined, sqliteRepo, node);
            expect(sqlQuery.where[0].name.getSql("name")).toBe("name REGEXP :pattern");

            const unsafe: PredicateNode = { kind: "predicate", field: "name", op: "regex", value: "(a+)+$" };
            expect(() => ModelUtils.buildQueryFromNode(undefined, FAKE_MONGO_REPO, unsafe)).toThrow();
            expect(() => ModelUtils.buildQueryFromNode(undefined, sqliteRepo, unsafe)).toThrow();
        });

        it("Rejects an invalid (non-2-element) range() node on both backends.", () => {
            const node: PredicateNode = { kind: "predicate", field: "age", op: "range", value: [1, 2, 3] };
            expect(() => ModelUtils.buildQueryFromNode(undefined, FAKE_MONGO_REPO, node)).toThrow();
            expect(() => ModelUtils.buildQueryFromNode(undefined, {} as any, node)).toThrow();
        });

        it("Rejects an unrecognized predicate operator on both backends.", () => {
            const node = { kind: "predicate", field: "age", op: "bogus", value: 1 } as unknown as PredicateNode;
            expect(() => ModelUtils.buildQueryFromNode(undefined, FAKE_MONGO_REPO, node)).toThrow();
            expect(() => ModelUtils.buildQueryFromNode(undefined, {} as any, node)).toThrow();
        });

        it("Rejects a group tree nested deeper than the depth bound, on both backends.", () => {
            let node: QueryNode = { kind: "predicate", field: "a", op: "eq", value: "1" };
            for (let i = 0; i < 12; i++) {
                node = { kind: "group", op: "and", children: [node] };
            }
            expect(() => ModelUtils.buildQueryFromNode(undefined, FAKE_MONGO_REPO, node)).toThrow();
            expect(() => ModelUtils.buildQueryFromNode(undefined, {} as any, node)).toThrow();
        });

        it("Rejects a group with more children than the node-count bound, on both backends.", () => {
            const children: QueryNode[] = Array.from({ length: 300 }, (_, i) => ({
                kind: "predicate",
                field: "a",
                op: "eq",
                value: String(i),
            }));
            const node: GroupNode = { kind: "group", op: "or", children };
            expect(() => ModelUtils.buildQueryFromNode(undefined, FAKE_MONGO_REPO, node)).toThrow();
            expect(() => ModelUtils.buildQueryFromNode(undefined, {} as any, node)).toThrow();
        });

        it("Rejects a SQL AND-cross-product that expands beyond the node-count bound.", () => {
            const makeOrGroup = (): GroupNode => ({
                kind: "group",
                op: "or",
                children: Array.from({ length: 20 }, (_, i) => ({
                    kind: "predicate",
                    field: `f${i}`,
                    op: "eq",
                    value: String(i),
                })),
            });
            const node: GroupNode = { kind: "group", op: "and", children: [makeOrGroup(), makeOrGroup()] };
            expect(() => ModelUtils.buildQueryFromNode(undefined, {} as any, node)).toThrow();
        });
    });

    describe("toTsQuery Tests", () => {
        it("Converts a single predicate to a quoted tsquery term.", () => {
            const node: PredicateNode = { kind: "predicate", field: "body", op: "eq", value: "budget" };
            expect(ModelUtils.toTsQuery(node)).toBe("'budget'");
        });

        it("Joins AND-grouped predicates with `&`.", () => {
            const node: GroupNode = {
                kind: "group",
                op: "and",
                children: [
                    { kind: "predicate", field: "body", op: "eq", value: "budget" },
                    { kind: "predicate", field: "body", op: "eq", value: "report" },
                ],
            };
            expect(ModelUtils.toTsQuery(node)).toBe("('budget' & 'report')");
        });

        it("Joins OR-grouped predicates with `|` and negates with `!`.", () => {
            const node: GroupNode = {
                kind: "group",
                op: "or",
                negated: true,
                children: [
                    { kind: "predicate", field: "body", op: "eq", value: "spam" },
                    { kind: "predicate", field: "body", op: "eq", value: "junk" },
                ],
            };
            expect(ModelUtils.toTsQuery(node)).toBe("!('spam' | 'junk')");
        });

        it("Escapes an embedded single quote in a term.", () => {
            const node: PredicateNode = { kind: "predicate", field: "body", op: "eq", value: "it's" };
            expect(ModelUtils.toTsQuery(node)).toBe("'it''s'");
        });
    });

    describe("resolvePagination Tests", () => {
        it("Applies the default page size when no limit is given.", () => {
            expect(ModelUtils.resolvePagination({})).toEqual({ take: 100, page: 0, skip: 0 });
        });

        it("Caps an excessive limit at the maximum page size.", () => {
            expect(ModelUtils.resolvePagination({ limit: 99999 })).toEqual({ take: 1000, page: 0, skip: 0 });
        });

        it("Computes skip from page * take.", () => {
            expect(ModelUtils.resolvePagination({ limit: 50, page: 2 })).toEqual({ take: 50, page: 2, skip: 100 });
        });
    });

    describe("toFindQuery Tests", () => {
        it("Passes an existing pipeline array through unchanged.", () => {
            const pipeline = [{ $match: { a: 1 } }, { $sort: { a: 1 } }, { $limit: 10 }];
            expect(ModelUtils.toFindQuery(pipeline)).toBe(pipeline);
        });

        it("Normalizes a flattened {$match,$sort} object to a pipeline array.", () => {
            expect(ModelUtils.toFindQuery({ $match: { a: 1 }, $sort: { a: 1 } })).toEqual([
                { $match: { a: 1 } },
                { $sort: { a: 1 } },
            ]);
        });

        it("Normalizes a $match-only object to a single-stage pipeline.", () => {
            expect(ModelUtils.toFindQuery({ $match: { a: 1 } })).toEqual([{ $match: { a: 1 } }]);
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
