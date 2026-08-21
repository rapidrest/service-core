///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2020-2026 Jean-Philippe Steinmetz. All rights reserved.
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
import "reflect-metadata";
import { EventListener, OnEvent } from "../src/decorators/EventDecorators";

describe("EventDecorators Tests", () => {
    describe("@OnEvent", () => {
        it("stores the given type(s) as metadata on the method", () => {
            class Foo {
                @OnEvent("user.created")
                public onCreated() {
                    // no-op
                }

                @OnEvent(["user.updated", "user.deleted"])
                public onChanged() {
                    // no-op
                }

                @OnEvent()
                public onAny() {
                    // no-op
                }
            }

            expect(Reflect.getMetadata("rrst:events", Foo.prototype, "onCreated")).toBe("user.created");
            expect(Reflect.getMetadata("rrst:events", Foo.prototype, "onChanged")).toEqual([
                "user.updated",
                "user.deleted",
            ]);
            expect(Reflect.getMetadata("rrst:events", Foo.prototype, "onAny")).toBe(".*");
        });
    });

    describe("@EventListener", () => {
        it("marks the class as an auto-registered event listener", () => {
            @EventListener()
            class Bar {}

            class Baz {}

            expect(Reflect.getOwnMetadata("rrst:eventListeners", Bar)).toBe(true);
            expect(Reflect.getOwnMetadata("rrst:eventListeners", Baz)).toBeUndefined();
        });
    });
});
