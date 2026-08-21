///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2020-2026 Jean-Philippe Steinmetz. All rights reserved.
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
import {
    Column,
    Entity,
    Index,
    PrimaryColumn,
    Unique,
    getColumnMetadata,
    getEntityName,
    getIndexMetadata,
} from "../src/decorators/PersistenceDecorators";
import { DataStore } from "../src/decorators/ModelDecorators";
import { resolveCollectionName, snakeCase } from "../src/database/NamingUtils";

describe("PersistenceDecorators Tests", () => {
    @DataStore("testdb")
    class Base {
        @Index("uid", { unique: true })
        @PrimaryColumn()
        public uid: string = "";

        @Column()
        public dateCreated: Date = new Date();

        @Column()
        public version: number = 0;
    }

    @Index(["firstName", "lastName"], { unique: true })
    class Person extends Base {
        @Index()
        @Column()
        public name: string = "";

        @Column({ nullable: true })
        public firstName?: string;

        @Column({ nullable: true })
        public lastName?: string;

        // Overrides the parent's version column definition
        @Column({ nullable: true })
        public version: number = 0;
    }

    @Entity({ name: "custom_people" })
    class CustomNamed extends Person {}

    class Employee extends Person {
        @Unique("email")
        @Column()
        public email: string = "";
    }

    describe("snakeCase", () => {
        it("matches TypeORM naming behavior", () => {
            expect(snakeCase("User")).toBe("user");
            expect(snakeCase("CacheUser")).toBe("cache_user");
            expect(snakeCase("AccessControlListMongo")).toBe("access_control_list_mongo");
            expect(snakeCase("ABCTest")).toBe("abc_test");
            expect(snakeCase("myURL2Parser")).toBe("my_url2_parser");
        });
    });

    describe("Column metadata", () => {
        it("collects columns with design types", () => {
            const columns = getColumnMetadata(Base);
            const uid = columns.find((c) => c.propertyName === "uid");
            expect(uid).toBeDefined();
            expect(uid?.options.primary).toBe(true);
            expect(uid?.designType).toBe(String);
            const dateCreated = columns.find((c) => c.propertyName === "dateCreated");
            expect(dateCreated?.designType).toBe(Date);
        });

        it("merges columns across the hierarchy with subclass override", () => {
            const columns = getColumnMetadata(Person);
            const names = columns.map((c) => c.propertyName).sort();
            expect(names).toEqual(["dateCreated", "firstName", "lastName", "name", "uid", "version"]);
            // Subclass declaration wins
            const version = columns.find((c) => c.propertyName === "version");
            expect(version?.options.nullable).toBe(true);
        });

        it("does not leak subclass columns into the parent", () => {
            const columns = getColumnMetadata(Base);
            expect(columns.find((c) => c.propertyName === "name")).toBeUndefined();
            const version = columns.find((c) => c.propertyName === "version");
            expect(version?.options.nullable).toBeUndefined();
        });

        it("falls back to the given value itself when passed a plain prototype object", () => {
            // getColumnMetadata normally expects a class (constructor function) and reads `clazz.prototype`.
            // Passing a prototype object directly (which has no `.prototype` of its own) exercises the `?? clazz`
            // fallback.
            const columns = getColumnMetadata(Employee.prototype);
            expect(columns.find((c) => c.propertyName === "email")).toBeDefined();
        });

        it("skips hierarchy levels that declare no columns of their own", () => {
            // A subclass that adds no new @Column properties has no own COLUMNS_KEY metadata at all, so
            // collectOwnMetadata must tolerate an undefined list at that level while still walking further up
            // to the ancestors that do declare columns.
            class Manager extends Employee {}
            const columns = getColumnMetadata(Manager);
            expect(columns.find((c) => c.propertyName === "email")).toBeDefined();
            expect(columns.find((c) => c.propertyName === "uid")).toBeDefined();
        });
    });

    describe("Index metadata", () => {
        it("accepts an options object as the sole argument for a property-level index", () => {
            class WithOptionsOnly {
                @Index({ unique: true })
                @Column()
                public code: string = "";
            }
            const indexes = getIndexMetadata(WithOptionsOnly);
            const code = indexes.find((i) => i.columns[0] === "code");
            expect(code).toBeDefined();
            expect(code?.name).toBeUndefined();
            expect(code?.options.unique).toBe(true);
        });

        it("throws when applied to a class with no property names", () => {
            expect(() => Index({ unique: true })(class NoFields {})).toThrow(/requires a list of property names/);
        });

        it("collects property and class indexes across the hierarchy", () => {
            const indexes = getIndexMetadata(Person);
            const uid = indexes.find((i) => i.name === "uid");
            expect(uid).toBeDefined();
            expect(uid?.columns).toEqual(["uid"]);
            expect(uid?.options.unique).toBe(true);

            const name = indexes.find((i) => i.columns.length === 1 && i.columns[0] === "name");
            expect(name).toBeDefined();
            expect(name?.name).toBeUndefined();

            const compound = indexes.find((i) => i.columns.length === 2);
            expect(compound).toBeDefined();
            expect(compound?.columns).toEqual(["firstName", "lastName"]);
            expect(compound?.options.unique).toBe(true);
        });

        it("does not leak subclass indexes into the parent", () => {
            const indexes = getIndexMetadata(Base);
            expect(indexes.length).toBe(1);
            expect(indexes[0].name).toBe("uid");
        });

        it("supports the @Unique shorthand", () => {
            const indexes = getIndexMetadata(Employee);
            const email = indexes.find((i) => i.name === "email");
            expect(email).toBeDefined();
            expect(email?.columns).toEqual(["email"]);
            expect(email?.options.unique).toBe(true);
        });

        it("supports the @Unique shorthand with an unnamed compound field list", () => {
            @Unique(["firstName", "lastName"])
            class UnnamedCompound {
                @Column({ nullable: true })
                public firstName?: string;
                @Column({ nullable: true })
                public lastName?: string;
            }
            const indexes = getIndexMetadata(UnnamedCompound);
            const compound = indexes.find((i) => i.columns.length === 2);
            expect(compound).toBeDefined();
            expect(compound?.name).toBeUndefined();
            expect(compound?.columns).toEqual(["firstName", "lastName"]);
            expect(compound?.options.unique).toBe(true);
        });

        it("supports the @Unique shorthand with a named compound field list", () => {
            @Unique("full_name_idx", ["firstName", "lastName"])
            class NamedCompound {
                @Column({ nullable: true })
                public firstName?: string;
                @Column({ nullable: true })
                public lastName?: string;
            }
            const indexes = getIndexMetadata(NamedCompound);
            const compound = indexes.find((i) => i.name === "full_name_idx");
            expect(compound).toBeDefined();
            expect(compound?.columns).toEqual(["firstName", "lastName"]);
            expect(compound?.options.unique).toBe(true);
        });

        it("supports the @Unique shorthand with no arguments on a property", () => {
            class NoArgUnique {
                @Unique()
                @Column()
                public code: string = "";
            }
            const indexes = getIndexMetadata(NoArgUnique);
            const code = indexes.find((i) => i.columns[0] === "code");
            expect(code).toBeDefined();
            expect(code?.name).toBeUndefined();
            expect(code?.options.unique).toBe(true);
        });

        it("falls back to the class prototype when a plain prototype object is passed to getIndexMetadata", () => {
            const indexes = getIndexMetadata(Employee.prototype);
            const email = indexes.find((i) => i.name === "email");
            expect(email).toBeDefined();
        });
    });

    describe("Entity naming", () => {
        it("resolves explicit entity names", () => {
            expect(getEntityName(CustomNamed)).toBe("custom_people");
            expect(resolveCollectionName(CustomNamed)).toBe("custom_people");
        });

        it("resolves names from the most ancestral datasource owner", () => {
            // Person/Employee inherit @DataStore from Base, so they share Base's collection
            expect(resolveCollectionName(Person)).toBe("base");
            expect(resolveCollectionName(Employee)).toBe("base");
        });

        it("falls back to the snake_case class name", () => {
            class Standalone {}
            expect(resolveCollectionName(Standalone)).toBe("standalone");
        });

        it("uses the snake_case class name when @Entity has no argument", () => {
            @Entity()
            class MyModelClass {}
            expect(getEntityName(MyModelClass)).toBe("my_model_class");
            expect(resolveCollectionName(MyModelClass)).toBe("my_model_class");
        });

        it("returns undefined when no class in the hierarchy declares @Entity", () => {
            class GrandParentNoEntity {}
            class ParentNoEntity extends GrandParentNoEntity {}
            class ChildNoEntity extends ParentNoEntity {}
            expect(getEntityName(ChildNoEntity)).toBeUndefined();
        });
    });
});
