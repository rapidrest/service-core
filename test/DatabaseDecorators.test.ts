///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2020-2026 Jean-Philippe Steinmetz. All rights reserved.
///////////////////////////////////////////////////////////////////////////////
import "reflect-metadata";
import { DataSource, Redis, Repository } from "../src/decorators/DatabaseDecorators";

describe("DatabaseDecorators Tests", () => {
    it("@DataSource stores the connection name and default required flag as metadata and defines an undefined property", () => {
        class Foo {
            @DataSource("source")
            public source: any;
        }

        const metadata = Reflect.getMetadata("rrst:injectDataSource", Foo.prototype, "source");
        expect(metadata).toBeDefined();
        expect(metadata.name).toBe("source");
        expect(metadata.required).toBeTruthy();
        expect(new Foo().source).toBeUndefined();
    });
    it("@DataSource stores the connection name and required flag override as metadata and defines an undefined property", () => {
        class Foo {
            @DataSource("source", false)
            public source: any;
        }

        const metadata = Reflect.getMetadata("rrst:injectDataSource", Foo.prototype, "source");
        expect(metadata).toBeDefined();
        expect(metadata.name).toBe("source");
        expect(metadata.required).toBeFalsy();
        expect(new Foo().source).toBeUndefined();
    });

    it("@Repository stores the entity type and required flag as metadata and defines an undefined property", () => {
        class Foo {
            @Repository(String)
            public repo: any;
        }

        const metadata: any = Reflect.getMetadata("rrst:injectRepository", Foo.prototype, "repo");
        expect(metadata).toBeDefined();
        expect(metadata.required).toBeTruthy();
        expect(metadata.type).toBe(String);
        expect(new Foo().repo).toBeUndefined();
    });

    it("@Repository stores the entity type and required flag as metadata and defines an undefined property", () => {
        class Foo {
            @Repository(Number, false)
            public repo: any;
        }

        const metadata: any = Reflect.getMetadata("rrst:injectRepository", Foo.prototype, "repo");
        expect(metadata).toBeDefined();
        expect(metadata.required).toBeFalsy();
        expect(metadata.type).toBe(Number);
        expect(new Foo().repo).toBeUndefined();
    });

    it("@Redis stores the connection name and required flag as metadata and defines an undefined property", () => {
        class Foo {
            @Redis("cache")
            public redis: any;
        }

        const metadata = Reflect.getMetadata("rrst:injectDataSource", Foo.prototype, "redis");
        expect(metadata).toBeDefined();
        expect(metadata.name).toBe("cache");
        expect(metadata.required).toBeTruthy();
        expect(new Foo().redis).toBeUndefined();
    });

    it("@Redis stores the connection name and required flag override as metadata and defines an undefined property", () => {
        class Foo {
            @Redis("cache", false)
            public redis: any;
        }

        const metadata = Reflect.getMetadata("rrst:injectDataSource", Foo.prototype, "redis");
        expect(metadata).toBeDefined();
        expect(metadata.name).toBe("cache");
        expect(metadata.required).toBeFalsy();
        expect(new Foo().redis).toBeUndefined();
    });
});
