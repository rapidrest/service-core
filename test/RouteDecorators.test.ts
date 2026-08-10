///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2020-2026 Jean-Philippe Steinmetz. All rights reserved.
///////////////////////////////////////////////////////////////////////////////
import "reflect-metadata";
import {
    After,
    ApiRoute,
    Before,
    Method,
    Options,
    Patch,
    RequiresElevation,
    RequiresRole,
    RequiresScope,
    RequiresTrustedRole,
} from "../src/decorators/RouteDecorators";

describe("RouteDecorators Tests", () => {
    describe("@Options", () => {
        it("registers an OPTIONS route at the given sub-path", () => {
            class Foo {
                @Options("/bar")
                public handler(): void {
                    return;
                }
            }
            const route: any = Reflect.getMetadata("rrst:route", Foo.prototype, "handler");
            expect(route.methods.get("options")).toBe("/bar");
        });

        it("defaults to an empty sub-path when none is given", () => {
            class Foo {
                @Options()
                public handler(): void {
                    return;
                }
            }
            const route: any = Reflect.getMetadata("rrst:route", Foo.prototype, "handler");
            expect(route.methods.get("options")).toBe("");
        });
    });

    describe("@Patch", () => {
        it("registers a PATCH route at the given sub-path", () => {
            class Foo {
                @Patch("/bar")
                public handler(): void {
                    return;
                }
            }
            const route: any = Reflect.getMetadata("rrst:route", Foo.prototype, "handler");
            expect(route.methods.get("patch")).toBe("/bar");
        });

        it("defaults to an empty sub-path when none is given", () => {
            class Foo {
                @Patch()
                public handler(): void {
                    return;
                }
            }
            const route: any = Reflect.getMetadata("rrst:route", Foo.prototype, "handler");
            expect(route.methods.get("patch")).toBe("");
        });
    });

    describe("@Method", () => {
        it("registers the same sub-path for every HTTP method in a provided list", () => {
            class Foo {
                @Method(["get", "post"], "/multi")
                public handler(): void {
                    return;
                }
            }
            const route: any = Reflect.getMetadata("rrst:route", Foo.prototype, "handler");
            expect(route.methods.get("get")).toBe("/multi");
            expect(route.methods.get("post")).toBe("/multi");
        });
    });

    describe("@ApiRoute", () => {
        it("prepends /api/v{version} to every path in a provided list", () => {
            @ApiRoute(["foo", "bar"], 2)
            class Foo {}
            const routePaths: string[] = Reflect.getMetadata("rrst:routePaths", Foo.prototype);
            expect(routePaths).toEqual(["/api/v2/foo", "/api/v2/bar"]);
        });

        it("prepends /api to a single path with no version", () => {
            @ApiRoute("foo")
            class Foo {}
            const routePaths: string[] = Reflect.getMetadata("rrst:routePaths", Foo.prototype);
            expect(routePaths).toEqual(["/api/foo"]);
        });
    });

    describe("@After", () => {
        it("accepts an array of functions and appends to any functions from a previously applied @After", () => {
            function fnA() {
                return;
            }
            function fnB() {
                return;
            }
            function fnC() {
                return;
            }
            class Foo {
                // Decorators apply bottom-up: [fnB, fnC] is set first (exercising the array-of-functions
                // path with no prior value), then fnA is appended on top of the existing list (exercising
                // the "concat onto existing route.after" path).
                @After(fnA)
                @After([fnB, fnC])
                public handler(): void {
                    return;
                }
            }
            const route: any = Reflect.getMetadata("rrst:route", Foo.prototype, "handler");
            expect(route.after).toEqual([fnB, fnC, fnA]);
        });
    });

    describe("@Before", () => {
        it("appends to any functions from a previously applied @Before", () => {
            function fnA() {
                return;
            }
            function fnB() {
                return;
            }
            class Foo {
                @Before(fnA)
                @Before(fnB)
                public handler(): void {
                    return;
                }
            }
            const route: any = Reflect.getMetadata("rrst:route", Foo.prototype, "handler");
            expect(route.before).toEqual([fnB, fnA]);
        });
    });

    describe("@RequiresElevation", () => {
        it("set requiresElevation to true", () => {
            class Foo {
                @RequiresElevation()
                public handler(): void {
                    return;
                }
            }
            const route: any = Reflect.getMetadata("rrst:route", Foo.prototype, "handler");
            expect(route.requiresElevation).toBe(-1);
        });
    });

    describe("@RequiresRole", () => {
        it("accepts an array of roles", () => {
            class Foo {
                @RequiresRole(["admin", "editor"])
                public handler(): void {
                    return;
                }
            }
            const route: any = Reflect.getMetadata("rrst:route", Foo.prototype, "handler");
            expect(route.requiredRoles).toEqual(["admin", "editor"]);
        });
    });

    describe("@RequiresScope", () => {
        it("accepts an array of scopes", () => {
            class Foo {
                @RequiresScope(["read", "write"])
                public handler(): void {
                    return;
                }
            }
            const route: any = Reflect.getMetadata("rrst:route", Foo.prototype, "handler");
            expect(route.requiredScopes).toEqual(["read", "write"]);
        });
    });

    describe("@RequiresTrustedRole", () => {
        it("set requiresTrustedRole to true", () => {
            class Foo {
                @RequiresTrustedRole()
                public handler(): void {
                    return;
                }
            }
            const route: any = Reflect.getMetadata("rrst:route", Foo.prototype, "handler");
            expect(route.requiresTrustedRole).toBeTruthy();
        });
    });
});
