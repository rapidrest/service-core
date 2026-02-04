///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2020-2026 Jean-Philippe Steinmetz
///////////////////////////////////////////////////////////////////////////////
import "reflect-metadata";
import { describe, it, expect } from "vitest";

import { ModelUtils } from "../src/index.js";
import { Identifier } from "../src/decorators/ModelDecorators.js";
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
import { v4 as uuidV4 } from "uuid";

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

@Entity()
class ProductIdentifierClass {
    @Identifier
    @PrimaryColumn()
    public id: string = "";

    @Identifier
    @Column()
    public id2: number = 0;

    @Identifier
    @Column()
    public productUid: string | undefined = undefined;
}

describe("ModelUtils Tests", () => {
    describe("MongoDB Tests", () => {
        it("Can build id search query with single identifier.", () => {
            const query: any = ModelUtils.buildIdSearchQueryMongo(SingleIdentifierClass, "MyID");
            expect(query).toEqual({
                $or: [{ id: new RegExp(/^MyID$/, "i") }]
            });
        });

        it("Can build id search query with single identifier and version.", () => {
            const query: any = ModelUtils.buildIdSearchQueryMongo(SingleIdentifierClass, "MyID", 2);
            expect(query).toEqual({
                $or: [{ id: new RegExp(/^MyID$/, "i"), version: 2 }]
            });
        });

        it("Can build id search query with single identifier and version 0.", () => {
            const query: any = ModelUtils.buildIdSearchQueryMongo(SingleIdentifierClass, "MyID", 0);
            expect(query).toEqual({
                $or: [{ id: new RegExp(/^MyID$/, "i"), version: 0 }]
            });
        });

        it("Can build id search query with multiple identifiers.", () => {
            const query: any = ModelUtils.buildIdSearchQueryMongo(DoubleIdentifierClass, "MyID");
            expect(query).toEqual({
                $or: [{ id: new RegExp(/^MyID$/, "i") }, { id2: new RegExp(/^MyID$/, "i") }],
            });
        });

        it("Can build id search query with multiple identifiers and version.", () => {
            const query: any = ModelUtils.buildIdSearchQueryMongo(DoubleIdentifierClass, "MyID", 3);
            expect(query).toEqual({
                $or: [{ id: new RegExp(/^MyID$/, "i"), version: 3 }, { id2: new RegExp(/^MyID$/, "i"), version: 3 }]
            });
        });

        it("Can build id search query with multiple identifiers and values.", () => {
            const query: any = ModelUtils.buildIdSearchQueryMongo(DoubleIdentifierClass, ["MyID", "MyID2"]);
            expect(query).toEqual({
                $or: [{ id: { $in: [new RegExp(/^MyID$/, "i"), new RegExp(/^MyID2$/, "i")] } }, { id2: { $in: [new RegExp(/^MyID$/, "i"), new RegExp(/^MyID2$/, "i")] } }],
            });
        });

        it("Can build id search query with multiple identifiers and values and version.", () => {
            const query: any = ModelUtils.buildIdSearchQueryMongo(DoubleIdentifierClass, ["MyID", "MyID2"], 3);
            expect(query).toEqual({
                $or: [{ id: { $in: [new RegExp(/^MyID$/, "i"), new RegExp(/^MyID2$/, "i")] }, version: 3 }, { id2: { $in: [new RegExp(/^MyID$/, "i"), new RegExp(/^MyID2$/, "i")] }, version: 3 }]
            });
        });

        it("Can build id search query with product identifier.", () => {
            const query: any = ModelUtils.buildIdSearchQueryMongo(ProductIdentifierClass, "MyID");
            expect(query).toEqual({
                $or: [{ id: new RegExp(/^MyID$/, "i"), productUid: undefined }, { id2: new RegExp(/^MyID$/, "i"), productUid: undefined }],
            });

            const productUid: string = uuidV4();
            const query2: any = ModelUtils.buildIdSearchQueryMongo(ProductIdentifierClass, "MyID", undefined, productUid);
            expect(query2).toEqual({
                $or: [{ id: new RegExp(/^MyID$/, "i"), productUid }, { id2: new RegExp(/^MyID$/, "i"), productUid }],
            });
        });

        it("Can build id search query with product identifier and multiple values.", () => {
            const query: any = ModelUtils.buildIdSearchQueryMongo(ProductIdentifierClass, ["MyID", "MyID2"]);
            expect(query).toEqual({
                $or: [{ id: { $in: [new RegExp(/^MyID$/, "i"), new RegExp(/^MyID2$/, "i")] } }, { id2: { $in: [new RegExp(/^MyID$/, "i"), new RegExp(/^MyID2$/, "i")] } }],
            });

            const productUid: string = uuidV4();
            const query2: any = ModelUtils.buildIdSearchQueryMongo(ProductIdentifierClass, ["MyID", "MyID2"], undefined, productUid);
            expect(query2).toEqual({
                $or: [{ id: { $in: [new RegExp(/^MyID$/, "i"), new RegExp(/^MyID2$/, "i")] }, productUid }, { id2: { $in: [new RegExp(/^MyID$/, "i"), new RegExp(/^MyID2$/, "i")] }, productUid }],
            });
        });

        it("Can build search query with sort (default).", () => {
            const request: any = {};
            request.query = {
                sort: "paramName",
            };

            const query = ModelUtils.buildSearchQueryMongo(undefined, request.params, request.query, true, request.user);
            expect(query).toEqual([{ $match: {} }, { $sort: { paramName: "ASC" } }]);
        });

        it("Can build search query with sort (desc).", () => {
            const request: any = {};
            request.query = {
                sort: JSON.stringify({ paramName: "DESC" }),
            };

            const query = ModelUtils.buildSearchQueryMongo(undefined, request.params, request.query, true, request.user);
            expect(query).toEqual([{ $match: {} }, { $sort: { paramName: "DESC" } }]);
        });

        it("Can build search query with sort (desc as object).", () => {
            const request: any = {};
            request.query = {
                sort: { paramName: "DESC" },
            };

            const query = ModelUtils.buildSearchQueryMongo(undefined, request.params, request.query, true, request.user);
            expect(query).toEqual([{ $match: {} }, { $sort: { paramName: "DESC" } }]);
        });

        it("Can build search query with single param (default)", () => {
            const request: any = {};
            request.query = {
                myParam: "myValue",
            };

            const query = ModelUtils.buildSearchQueryMongo(undefined, request.params, request.query, true, request.user);
            expect(query).toEqual([{
                $match: {
                    myParam: "myValue",
                }
            }]);
        });

        it("Can build search query with single param of int type default", () => {
            const request: any = {};
            request.query = {
                myParam: "100.00",
            };

            const query = ModelUtils.buildSearchQueryMongo(undefined, request.params, request.query, true, request.user);
            expect(query).toEqual([{
                $match: {
                    myParam: 100,
                }
            }]);
        });

        it("Can build search query with single param of boolean type (default)", () => {
            const request: any = {};
            request.query = {
                myParam: "true",
            };

            const query = ModelUtils.buildSearchQueryMongo(undefined, request.params, request.query, true, request.user);
            expect(query).toEqual([{
                $match: {
                    myParam: true,
                }
            }]);
        });

        it("Can build search query with single param of date type (default)", () => {
            const request: any = {};
            request.query = {
                myParam: "2019-09-05T03:27:13.258Z",
            };

            const query = ModelUtils.buildSearchQueryMongo(undefined, request.params, request.query, true, request.user);
            expect(query).toEqual([{
                $match: {
                    myParam: new Date("2019-09-05T03:27:13.258Z"),
                }
            }]);
        });

        it("Can build search query with single param (eq)", () => {
            const request: any = {};
            request.query = {
                myParam: "eq(myValue)",
            };

            const query = ModelUtils.buildSearchQueryMongo(undefined, request.params, request.query, true, request.user);
            expect(query).toEqual([{
                $match: {
                    myParam: "myValue",
                }
            }]);
        });

        it("Can build search query with single param of boolean type (eq)", () => {
            const request: any = {};
            request.query = {
                myParam: "eq(true)",
            };

            const query = ModelUtils.buildSearchQueryMongo(undefined, request.params, request.query, true, request.user);
            expect(query).toEqual([{
                $match: {
                    myParam: true,
                }
            }]);
        });

        it("Can build search query with single param of number type (eq)", () => {
            const request: any = {};
            request.query = {
                myParam: "eq(105.56)",
            };

            const query = ModelUtils.buildSearchQueryMongo(undefined, request.params, request.query, true, request.user);
            expect(query).toEqual([{
                $match: {
                    myParam: 105.56,
                }
            }]);
        });

        it("Can build search query with single param (gt)", () => {
            const request: any = {};
            request.query = {
                myParam: "gt(myValue)",
            };

            const query = ModelUtils.buildSearchQueryMongo(undefined, request.params, request.query, true, request.user);
            expect(query).toEqual([{
                $match: {
                    myParam: { $gt: "myValue" },
                }
            }]);
        });

        it("Can build search query with single param of date type (gt)", () => {
            const request: any = {};
            request.query = {
                myParam: "gt(2019-09-05T03:27:13.258Z)",
            };

            const query = ModelUtils.buildSearchQueryMongo(undefined, request.params, request.query, true, request.user);
            expect(query).toEqual([{
                $match: {
                    myParam: { $gt: new Date("2019-09-05T03:27:13.258Z") },
                }
            }]);
        });

        it("Can build search query with single param (gte)", () => {
            const request: any = {};
            request.query = {
                myParam: "gte(myValue)",
            };

            const query = ModelUtils.buildSearchQueryMongo(undefined, request.params, request.query, true, request.user);
            expect(query).toEqual([{
                $match: {
                    myParam: { $gte: "myValue" },
                }
            }]);
        });

        it("Can build search query with single param (in)", () => {
            const request: any = {};
            request.query = {
                myParam: "in(myValue,myValue2,myValue3,myValue4)",
            };

            const query = ModelUtils.buildSearchQueryMongo(undefined, request.params, request.query, true, request.user);
            expect(query).toEqual([{
                $match: {
                    myParam: { $in: ["myValue", "myValue2", "myValue3", "myValue4"] },
                }
            }]);
        });

        it("Can build search query with single param (ILike)", () => {
            const request: any = {};
            request.query = {
                myParam: "like(myValue)",
            };

            const query = ModelUtils.buildSearchQueryMongo(undefined, request.params, request.query, true, request.user);
            expect(query).toEqual([{
                $match: {
                    myParam: { $options: "i", $regex: "myValue" },
                }
            }]);
        });

        it("Can build search query with single param (lt)", () => {
            const request: any = {};
            request.query = {
                myParam: "lt(myValue)",
            };

            const query = ModelUtils.buildSearchQueryMongo(undefined, request.params, request.query, true, request.user);
            expect(query).toEqual([{
                $match: {
                    myParam: { $lt: "myValue" },
                }
            }]);
        });

        it("Can build search query with single param (lte)", () => {
            const request: any = {};
            request.query = {
                myParam: "lte(myValue)",
            };

            const query = ModelUtils.buildSearchQueryMongo(undefined, request.params, request.query, true, request.user);
            expect(query).toEqual([{
                $match: {
                    myParam: { $lte: "myValue" },
                }
            }]);
        });

        it("Can build search query with single param (not)", () => {
            const request: any = {};
            request.query = {
                myParam: "not(myValue)",
            };

            const query = ModelUtils.buildSearchQueryMongo(undefined, request.params, request.query, true, request.user);
            expect(query).toEqual([{
                $match: {
                    myParam: { $not: "myValue" },
                }
            }]);
        });

        it("Can build search query with single param (range)", () => {
            const request: any = {};
            request.query = {
                myParam: "range(1,100)",
            };

            const query = ModelUtils.buildSearchQueryMongo(undefined, request.params, request.query, true, request.user);
            expect(query).toEqual([{
                $match: {
                    myParam: { $gte: 1, $lte: 100 },
                }
            }]);
        });

        it("Can build search query with multiple params.", () => {
            const request: any = {};
            request.query = {
                equals: "myValue",
                not: "not(myValue2)",
                range: "range(1,100)",
            };

            const query = ModelUtils.buildSearchQueryMongo(undefined, request.params, request.query, true, request.user);
            expect(query).toEqual([{
                $match: {
                    equals: "myValue",
                    not: { $not: "myValue2" },
                    range: { $gte: 1, $lte: 100 },
                }
            }]);
        });

        it("Can build search query with multiple params with same name.", () => {
            const request: any = {};
            request.query = {
                param: ["Eq(myValue)", "Not(myValue2)", "like(myValue3)"],
            };

            const query = ModelUtils.buildSearchQueryMongo(undefined, request.params, request.query, true, request.user);
            expect(query).toEqual([{
                $match: {
                    $or: [
                        { param: "myValue" },
                        { param: { $not: "myValue2" } },
                        { param: { $regex: "myValue3", $options: "i" } }
                    ]
                }
            }]);
        });

        it("Can build search query with multiple params and with same name.", () => {
            const request: any = {};
            request.query = {
                param: ["eq(myValue)", "not(myValue2)", "like(myValue3)"],
                param2: "range(0,100)",
                param3: "hello",
            };

            const query = ModelUtils.buildSearchQueryMongo(undefined, request.params, request.query, true, request.user);
            expect(query).toEqual([
                {
                    $match: {
                        $or: [
                            { param: "myValue", param2: { $gte: 0, $lte: 100 }, param3: "hello" },
                            { param: { $not: "myValue2" }, param2: { $gte: 0, $lte: 100 }, param3: "hello" },
                            { param: { $regex: "myValue3", $options: "i" }, param2: { $gte: 0, $lte: 100 }, param3: "hello" }
                        ]
                    }
                }
            ]);
        });

        it("Can build search query and filter reserved words.", () => {
            const request: any = {};
            request.query = {
                jwt_token: "df0afawfa09uf093joihff3983ufq3olifhj329f8uh.f23908uf2ofj32fo2u.f208f09qf2",
                oauth_token: "df0afawfa09uf093joihff3983ufq3olifhj329f8uh.f23908uf2ofj32fo2u.f208f09qf2",
            };

            const query = ModelUtils.buildSearchQueryMongo(undefined, request.params, request.query, true, request.user);
            expect(query).toEqual([{ $match: {} }]);
        });
    });

    describe("SQL Tests", () => {
        it("Can build search query with limit.", () => {
            const request: any = {};
            request.query = {
                limit: 100,
            };

            const query = ModelUtils.buildSearchQuerySQL(undefined, request.params, request.query, true, request.user);
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

            const query = ModelUtils.buildSearchQuerySQL(undefined, request.params, request.query, true, request.user);
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

            const query = ModelUtils.buildSearchQuerySQL(undefined, request.params, request.query, true, request.user);
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

            const query = ModelUtils.buildSearchQuerySQL(undefined, request.params, request.query, true, request.user);
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

            const query = ModelUtils.buildSearchQuerySQL(undefined, request.params, request.query, true, request.user);
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

            const query = ModelUtils.buildSearchQuerySQL(undefined, request.params, request.query, true, request.user);
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

            const query = ModelUtils.buildSearchQuerySQL(undefined, request.params, request.query, true, request.user);
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

            const query = ModelUtils.buildSearchQuerySQL(undefined, request.params, request.query, true, request.user);
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

            const query = ModelUtils.buildSearchQuerySQL(undefined, request.params, request.query, true, request.user);
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

            const query = ModelUtils.buildSearchQuerySQL(undefined, request.params, request.query, true, request.user);
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

        it("Can build search query with single param (eq)", () => {
            const request: any = {};
            request.query = {
                myParam: "eq(myValue)",
            };

            const query = ModelUtils.buildSearchQuerySQL(undefined, request.params, request.query, true, request.user);
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

            const query = ModelUtils.buildSearchQuerySQL(undefined, request.params, request.query, true, request.user);
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

            const query = ModelUtils.buildSearchQuerySQL(undefined, request.params, request.query, true, request.user);
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

            const query = ModelUtils.buildSearchQuerySQL(undefined, request.params, request.query, true, request.user);
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

            const query = ModelUtils.buildSearchQuerySQL(undefined, request.params, request.query, true, request.user);
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

            const query = ModelUtils.buildSearchQuerySQL(undefined, request.params, request.query, true, request.user);
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

            const query = ModelUtils.buildSearchQuerySQL(undefined, request.params, request.query, true, request.user);
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

            const query = ModelUtils.buildSearchQuerySQL(undefined, request.params, request.query, true, request.user);
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

            const query = ModelUtils.buildSearchQuerySQL(undefined, request.params, request.query, true, request.user);
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

            const query = ModelUtils.buildSearchQuerySQL(undefined, request.params, request.query, true, request.user);
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

            const query = ModelUtils.buildSearchQuerySQL(undefined, request.params, request.query, true, request.user);
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

            const query = ModelUtils.buildSearchQuerySQL(undefined, request.params, request.query, true, request.user);
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
        it("Can build search query with multiple params.", () => {
            const request: any = {};
            request.query = {
                equals: "myValue",
                not: "not(myValue2)",
                range: "range(1,100)",
            };

            const query = ModelUtils.buildSearchQuerySQL(undefined, request.params, request.query, true, request.user);
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

            const query = ModelUtils.buildSearchQuerySQL(undefined, request.params, request.query, true, request.user);
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

            const query = ModelUtils.buildSearchQuerySQL(undefined, request.params, request.query, true, request.user);
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

        it("Can build search query and filter reserved words.", () => {
            const request: any = {};
            request.query = {
                jwt_token: "df0afawfa09uf093joihff3983ufq3olifhj329f8uh.f23908uf2ofj32fo2u.f208f09qf2",
                oauth_token: "df0afawfa09uf093joihff3983ufq3olifhj329f8uh.f23908uf2ofj32fo2u.f208f09qf2",
            };

            const query = ModelUtils.buildSearchQuerySQL(undefined, request.params, request.query, true, request.user);
            expect(query).toEqual({
                page: 0,
                take: 100,
            });
        });

        it("Can build search query with global composite OR criteria", () => {
            const request: any = {};
            request.query = {
                $or:
                    [
                        { param: "eq(myValue)", param2: "range(0,100)" },
                        { param: "not(myValue2)", param2: "range(100,200)" },
                    ]
            };

            const query = ModelUtils.buildSearchQueryMongo(undefined, request.params, request.query, true, request.user);
            expect(query).toEqual([
                {
                    "$match": {
                        "$or": [
                            {

                                "param": "myValue",
                                "param2": {
                                    "$gte": 0,
                                    "$lte": 100
                                }

                            },
                            {

                                "param": {
                                    "$not": "myValue2"
                                },
                                "param2": {
                                    "$gte": 100,
                                    "$lte": 200
                                }
                            }
                        ]
                    }
                }
            ]);
        });

        it.only("Can build search query with global composite OR criteria and sort", () => {
            const request: any = {};
            request.query = {
                $or:
                    [
                        { param: "eq(myValue)", param2: "range(0,100)" },
                        { param: "not(myValue2)", param2: "range(100,200)" },
                    ],
                sort: {
                    paramName: "DESC",
                    secondParamName: "ASC",
                    undefinedParamName: undefined,
                    nullParamName: null
                }
            };

            const query = ModelUtils.buildSearchQueryMongo(undefined, request.params, request.query, true, request.user);
            expect(query).toEqual([
                {
                    "$match": {
                        "$or": [
                            {
                                "param": "myValue",
                                "param2": {
                                    "$gte": 0,
                                    "$lte": 100
                                }

                            },
                            {

                                "param": {
                                    "$not": "myValue2"
                                },
                                "param2": {
                                    "$gte": 100,
                                    "$lte": 200
                                }
                            }
                        ]
                    }
                },
                {
                    $sort: {
                        paramName: -1,
                        secondParamName: 1,
                    }
                }
            ]);
        });
    });

    it("Can load models.", async () => {
        const results: Map<string, any> = await ModelUtils.loadModels("./test/models");
        expect(results).toBeDefined();
        expect(results.has("Item")).toBeTruthy();
        expect(results.has("User")).toBeTruthy();
    });
});
