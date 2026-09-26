///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2020-2026 Jean-Philippe Steinmetz. All rights reserved.
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
import "reflect-metadata";
import {
    After,
    ApiRoute,
    Before,
    BodyStream,
    Method,
    Options,
    Patch,
    Protect,
    RequiresElevation,
    RequiresRole,
    RequiresScope,
    RequiresTrustedRole,
    StreamingBody,
    WebSocket,
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
        it("set requiresElevation to -1 for decorated method", () => {
            class Foo {
                @RequiresElevation()
                public handler(): void {
                    return;
                }
            }
            const route: any = Reflect.getMetadata("rrst:route", Foo.prototype, "handler");
            expect(route.requiresElevation).toBe(-1);
        });

        it("set requiresElevation to 60 for decorated method", () => {
            class Foo {
                @RequiresElevation(60)
                public handler(): void {
                    return;
                }
            }
            const route: any = Reflect.getMetadata("rrst:route", Foo.prototype, "handler");
            expect(route.requiresElevation).toBe(60);
        });

        it("set requiresElevation to -1 for decorated class", () => {
            @RequiresElevation()
            class Foo {
                public handler(): void {
                    return;
                }
            }
            const requiresElevation: any = Reflect.getMetadata("rrst:requiresElevation", Foo.prototype);
            expect(requiresElevation).toBe(-1);
        });

        it("set requiresElevation to 60 for decorated class", () => {
            @RequiresElevation(60)
            class Foo {
                public handler(): void {
                    return;
                }
            }
            const requiresElevation: any = Reflect.getMetadata("rrst:requiresElevation", Foo.prototype);
            expect(requiresElevation).toBe(60);
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

    describe("@Protect", () => {
        it("does not mutate a shared ACL template's uid when applied to more than one class", () => {
            const sharedAcl = { records: [{ userOrRoleId: ".*", actions: [] }] };

            @Protect(sharedAcl as any)
            class SharedFirstRoute {}
            @Protect(sharedAcl as any)
            class SharedSecondRoute {}

            const aclFirst: any = Reflect.getMetadata("rrst:acl", SharedFirstRoute.prototype);
            const aclSecond: any = Reflect.getMetadata("rrst:acl", SharedSecondRoute.prototype);
            expect(aclFirst.uid).toBe("SharedFirstRoute");
            expect(aclSecond.uid).toBe("SharedSecondRoute");
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

    describe("@StreamingBody", () => {
        it("sets streamingBody to true on the method's route metadata", () => {
            class Foo {
                @StreamingBody()
                public handler(): void {
                    return;
                }
            }
            const route: any = Reflect.getMetadata("rrst:route", Foo.prototype, "handler");
            expect(route.streamingBody).toBe(true);
        });

        it("does not set streamingBody on a method that isn't decorated", () => {
            class Foo {
                @Options("/bar")
                public handler(): void {
                    return;
                }
            }
            const route: any = Reflect.getMetadata("rrst:route", Foo.prototype, "handler");
            expect(route.streamingBody).toBeUndefined();
        });

        it("applied at the class level stores the flag separately from method-level route metadata", () => {
            @StreamingBody()
            class Foo {
                public handler(): void {
                    return;
                }
            }
            expect(Reflect.getMetadata("rrst:streamingBody", Foo.prototype)).toBe(true);
        });
    });

    describe("@BodyStream", () => {
        it("stores a 'bodyStream' argument marker in the args metadata", () => {
            class Foo {
                public handler(@BodyStream stream: any): void {
                    return;
                }
            }
            const args: any = Reflect.getMetadata("rrst:args", Foo.prototype, "handler");
            expect(args[0]).toEqual(["bodyStream"]);
        });
    });

    describe("@WebSocket", () => {
        it("registers a ws route at the given sub-path with no options by default", () => {
            class Foo {
                @WebSocket("/bar")
                public handler(): void {
                    return;
                }
            }
            const route: any = Reflect.getMetadata("rrst:route", Foo.prototype, "handler");
            expect(route.methods.get("ws")).toBe("/bar");
            expect(route.wsOptions).toBeUndefined();
        });

        it("defaults to an empty sub-path when none is given", () => {
            class Foo {
                @WebSocket()
                public handler(): void {
                    return;
                }
            }
            const route: any = Reflect.getMetadata("rrst:route", Foo.prototype, "handler");
            expect(route.methods.get("ws")).toBe("");
        });

        it("stores the options in the route metadata", () => {
            class Foo {
                @WebSocket("/stream", { maxPayloadLength: 1024 * 1024, maxBackpressure: 8 * 1024 * 1024, idleTimeout: 30 })
                public handler(): void {
                    return;
                }
            }
            const route: any = Reflect.getMetadata("rrst:route", Foo.prototype, "handler");
            expect(route.methods.get("ws")).toBe("/stream");
            expect(route.wsOptions).toEqual({
                maxPayloadLength: 1024 * 1024,
                maxBackpressure: 8 * 1024 * 1024,
                idleTimeout: 30,
            });
        });

        it("stores a copy, so mutating the caller's object afterwards does not change the route", () => {
            const options = { maxPayloadLength: 2048 };
            class Foo {
                @WebSocket("/copy", options)
                public handler(): void {
                    return;
                }
            }
            options.maxPayloadLength = 999999;
            const route: any = Reflect.getMetadata("rrst:route", Foo.prototype, "handler");
            expect(route.wsOptions).toEqual({ maxPayloadLength: 2048 });
        });

        it("keeps the options when combined with other route decorators, in either order", () => {
            class Foo {
                @RequiresRole("admin")
                @WebSocket("/a", { idleTimeout: 0 })
                public a(): void {
                    return;
                }

                @WebSocket("/b", { idleTimeout: 0 })
                @RequiresRole("admin")
                public b(): void {
                    return;
                }
            }
            for (const name of ["a", "b"]) {
                const route: any = Reflect.getMetadata("rrst:route", Foo.prototype, name);
                expect(route.wsOptions).toEqual({ idleTimeout: 0 });
                expect(route.requiredRoles).toEqual(["admin"]);
            }
        });

        it("a subclass re-declaring @WebSocket without options gets the defaults, not the base class's options", () => {
            class Base {
                @WebSocket("/x", { maxPayloadLength: 4096 })
                public handler(): void {
                    return;
                }
            }
            class Child extends Base {
                @WebSocket("/x")
                public override handler(): void {
                    return;
                }
            }
            expect(Reflect.getMetadata("rrst:route", Base.prototype, "handler").wsOptions).toEqual({
                maxPayloadLength: 4096,
            });
            expect(Reflect.getMetadata("rrst:route", Child.prototype, "handler").wsOptions).toBeUndefined();
        });
    });
});
