///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2020-2026 Jean-Philippe Steinmetz. All rights reserved.
///////////////////////////////////////////////////////////////////////////////
import "reflect-metadata";
import {
    Default,
    Description,
    Document,
    Example,
    Format,
    getTypeInfo,
    Returns,
    Summary,
    Tags,
    TypeInfo,
} from "../src/decorators/DocDecorators";

describe("DocDecorators Tests", () => {
    describe("Document and its shorthands", () => {
        it("stores class-level doc metadata when applied to a class", () => {
            @Document({ description: "a class" })
            class Foo {}
            expect(Reflect.getMetadata("rrst:docs", Foo)).toEqual({ description: "a class" });
        });

        it("merges repeated @Document calls on the same target instead of overwriting", () => {
            @Document({ description: "first" })
            @Document({ summary: "second" })
            class Foo {}
            expect(Reflect.getMetadata("rrst:docs", Foo)).toEqual({ description: "first", summary: "second" });
        });

        it("@Default stores a default value under property-level doc metadata", () => {
            class Foo {
                @Default("randomUUID()")
                public uid: string = "";
            }
            expect(Reflect.getMetadata("rrst:docs", Foo.prototype, "uid")).toEqual({ default: "randomUUID()" });
        });

        it("@Description stores a description", () => {
            class Foo {
                @Description("the description")
                public name: string = "";
            }
            expect(Reflect.getMetadata("rrst:docs", Foo.prototype, "name")).toEqual({ description: "the description" });
        });

        it("@Example stores an example value", () => {
            class Foo {
                @Example("jsmith")
                public name: string = "";
            }
            expect(Reflect.getMetadata("rrst:docs", Foo.prototype, "name")).toEqual({ example: "jsmith" });
        });

        it("@Format stores a format string", () => {
            class Foo {
                @Format("date-time")
                public createdAt: string = "";
            }
            expect(Reflect.getMetadata("rrst:docs", Foo.prototype, "createdAt")).toEqual({ format: "date-time" });
        });

        it("@Summary stores a summary", () => {
            class Foo {
                @Summary("a summary")
                public doThing(): void {
                    // no-op fixture method
                }
            }
            expect(Reflect.getMetadata("rrst:docs", Foo.prototype, "doThing")).toEqual({ summary: "a summary" });
        });

        it("@Tags stores a list of searchable tags", () => {
            class Foo {
                @Tags(["a", "b"])
                public name: string = "";
            }
            expect(Reflect.getMetadata("rrst:docs", Foo.prototype, "name")).toEqual({ tags: ["a", "b"] });
        });

        it("combines multiple doc decorators stacked on the same property", () => {
            class Foo {
                @Description("desc")
                @Example("ex")
                @Format("password")
                @Tags(["secret"])
                public secret: string = "";
            }
            expect(Reflect.getMetadata("rrst:docs", Foo.prototype, "secret")).toEqual({
                description: "desc",
                example: "ex",
                format: "password",
                tags: ["secret"],
            });
        });
    });

    describe("@Returns", () => {
        it("defaults to the reflected design:type when called with no argument", () => {
            class Foo {
                public getName(): string {
                    return "";
                }
            }
            Returns()(Foo.prototype, "getName");
            // No explicit design:type metadata exists outside a real TS decorator pass, so the
            // fallback array wraps whatever design:type resolves to (undefined here) -- the point
            // being the `types !== undefined` false branch (using the design-type fallback) runs.
            expect(Reflect.getMetadata("design:returntype", Foo.prototype, "getName")).toEqual([undefined]);
        });

        it("wraps a single non-array type argument in an array", () => {
            class Bar {}
            class Foo {
                public getBar(): Bar {
                    return new Bar();
                }
            }
            Returns(Bar)(Foo.prototype, "getBar");
            expect(Reflect.getMetadata("design:returntype", Foo.prototype, "getBar")).toEqual([Bar]);
        });

        it("leaves an already-array type argument as-is", () => {
            class Foo {
                public getNames(): string[] {
                    return [];
                }
            }
            Returns([[Array, String]])(Foo.prototype, "getNames");
            expect(Reflect.getMetadata("design:returntype", Foo.prototype, "getNames")).toEqual([[Array, String]]);
        });
    });

    describe("@TypeInfo / getTypeInfo", () => {
        it("stores a single non-array type wrapped in an array", () => {
            class Foo {
                @TypeInfo(String)
                public name: string = "";
            }
            expect(getTypeInfo(Foo.prototype, "name")).toEqual([String]);
        });

        it("falls back to design:type when called with no argument", () => {
            class Foo {
                public name: string = "";
            }
            TypeInfo()(Foo.prototype, "name");
            // Same no-real-decorator-pass caveat as the @Returns fallback test above.
            expect(Reflect.getMetadata("rrst:typeInfo", Foo.prototype, "name")).toEqual([undefined]);
        });

        it("getTypeInfo falls back to design:type when @TypeInfo was never applied", () => {
            class Foo {
                public name: string = "";
            }
            expect(getTypeInfo(Foo.prototype, "name")).toBeUndefined();
        });
    });
});
