///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2020-2026 Jean-Philippe Steinmetz. All rights reserved.
///////////////////////////////////////////////////////////////////////////////
import "reflect-metadata";
import { MongoRepository, RedisConnection, Repository } from "../src/decorators/DatabaseDecorators";

describe("DatabaseDecorators Tests", () => {
    it("@Repository stores the entity type as metadata and defines an undefined property", () => {
        class Foo {
            @Repository(String)
            public repo: any;
        }

        expect(Reflect.getMetadata("rrst:injectRepo", Foo.prototype, "repo")).toBe(String);
        expect(new Foo().repo).toBeUndefined();
    });

    it("@MongoRepository stores the entity type as metadata and defines an undefined property", () => {
        class Foo {
            @MongoRepository(Number)
            public repo: any;
        }

        expect(Reflect.getMetadata("rrst:injectMongoRepo", Foo.prototype, "repo")).toBe(Number);
        expect(new Foo().repo).toBeUndefined();
    });

    it("@RedisConnection stores the connection name as metadata and defines an undefined property", () => {
        class Foo {
            @RedisConnection("cache")
            public redis: any;
        }

        expect(Reflect.getMetadata("rrst:injectRedisRepo", Foo.prototype, "redis")).toBe("cache");
        expect(new Foo().redis).toBeUndefined();
    });
});
