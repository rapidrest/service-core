///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2020-2026 Jean-Philippe Steinmetz. All rights reserved.
///////////////////////////////////////////////////////////////////////////////
import "reflect-metadata";
import * as typeorm from "typeorm";
import { registerFrameworkMetadata } from "../../src/database/TypeOrmSupport";
import { ChildEntity } from "../../src/decorators/ModelDecorators";
import { Column, Entity, Index } from "../../src/decorators/PersistenceDecorators";

describe("TypeOrmSupport Tests (unit)", () => {
    it("bridges a pending TypeORM column queued by @ChildEntity", () => {
        // @ChildEntity() returns a *new* wrapper class extending the original, so the pending column's
        // `target` is the wrapped class's prototype parent, not the decorated class binding itself.
        @ChildEntity()
        @Entity({ name: "child_entity_test_class" })
        class ChildEntityTestClass {
            @Column()
            public name: string = "";
        }
        const originalTarget = Object.getPrototypeOf(ChildEntityTestClass);

        registerFrameworkMetadata([]);

        const storage = typeorm.getMetadataArgsStorage();
        const bridged = storage.columns.find((c) => c.target === originalTarget && c.propertyName === "_type");
        expect(bridged).toBeDefined();
    });

    it("does not duplicate a pending column that's already been bridged", () => {
        @ChildEntity()
        @Entity({ name: "child_entity_test_class_2" })
        class ChildEntityTestClass2 {
            @Column()
            public name: string = "";
        }
        const originalTarget = Object.getPrototypeOf(ChildEntityTestClass2);

        registerFrameworkMetadata([]);
        const storage = typeorm.getMetadataArgsStorage();
        const before = storage.columns.filter(
            (c) => c.target === originalTarget && c.propertyName === "_type",
        ).length;
        expect(before).toBe(1);

        // Nothing new queued this time (pendingTypeOrmColumns already drained above), so a second pass must
        // not push a duplicate entry for the same target/propertyName.
        registerFrameworkMetadata([]);
        const after = storage.columns.filter(
            (c) => c.target === originalTarget && c.propertyName === "_type",
        ).length;
        expect(after).toBe(1);
    });

    it("registers a class-level compound index", () => {
        @Index(["a", "b"])
        @Entity({ name: "compound_index_test_class" })
        class CompoundIndexTestClass {
            @Column()
            public a: string = "";
            @Column()
            public b: string = "";
        }

        registerFrameworkMetadata([CompoundIndexTestClass]);

        const storage = typeorm.getMetadataArgsStorage();
        const index = storage.indices.find(
            (i: any) => i.target === CompoundIndexTestClass && JSON.stringify(i.columns) === JSON.stringify(["a", "b"]),
        );
        expect(index).toBeDefined();
    });

    it("skips bridging a MongoDB-only ObjectId column into TypeORM", () => {
        @Entity({ name: "object_id_test_class" })
        class ObjectIdTestClass {
            @Column({ isObjectId: true })
            public _id: any;
            @Column()
            public name: string = "";
        }

        registerFrameworkMetadata([ObjectIdTestClass]);

        const storage = typeorm.getMetadataArgsStorage();
        const idColumn = storage.columns.find(
            (c) => c.target === ObjectIdTestClass && c.propertyName === "_id",
        );
        expect(idColumn).toBeUndefined();
        const nameColumn = storage.columns.find(
            (c) => c.target === ObjectIdTestClass && c.propertyName === "name",
        );
        expect(nameColumn).toBeDefined();
    });
});
