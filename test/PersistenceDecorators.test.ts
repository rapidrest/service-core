///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2020-2026 Jean-Philippe Steinmetz. All rights reserved.
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

    @Entity("custom_people")
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
    });

    describe("Index metadata", () => {
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
    });

    describe("Entity naming", () => {
        it("resolves explicit entity names", () => {
            expect(getEntityName(CustomNamed)).toBe("custom_people");
            expect(resolveCollectionName(CustomNamed)).toBe("custom_people");
        });

        it("resolves names from the most ancestral datastore owner", () => {
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
    });
});
