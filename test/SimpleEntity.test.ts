///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2020-2026 Jean-Philippe Steinmetz. All rights reserved.
///////////////////////////////////////////////////////////////////////////////
import "reflect-metadata";
import { ObjectId } from "mongodb";
import { SimpleEntity } from "../src/models/SimpleEntity";
import { SimpleMongoEntity } from "../src/models/SimpleMongoEntity";

class TestEntity extends SimpleEntity {}
class TestMongoEntity extends SimpleMongoEntity {}

describe("SimpleEntity Tests", () => {
    it("generates a default uid when none is provided", () => {
        const entity = new TestEntity();
        expect(entity.uid).toBeDefined();
        expect(typeof entity.uid).toBe("string");
    });

    it("uses the provided uid from other", () => {
        const entity = new TestEntity({ uid: "abc-123" });
        expect(entity.uid).toBe("abc-123");
    });

    it("keeps the default uid when other does not define one", () => {
        const entity = new TestEntity({} as Partial<SimpleEntity>);
        expect(entity.uid).toBeDefined();
        expect(entity.uid.length).toBeGreaterThan(0);
    });

    it("keeps the default uid when other.uid is explicitly undefined", () => {
        const entity = new TestEntity({ uid: undefined });
        expect(entity.uid).toBeDefined();
        expect(entity.uid.length).toBeGreaterThan(0);
    });
});

describe("SimpleMongoEntity Tests", () => {
    it("leaves _id undefined when no other is provided", () => {
        const entity = new TestMongoEntity();
        expect(entity._id).toBeUndefined();
    });

    it("leaves _id undefined when other does not define one", () => {
        const entity = new TestMongoEntity({ uid: "abc" });
        expect(entity._id).toBeUndefined();
    });

    it("converts a string _id into an ObjectId", () => {
        const oid = new ObjectId();
        const entity = new TestMongoEntity({ _id: oid.toHexString() as any });
        expect(entity._id).toBeInstanceOf(ObjectId);
        expect(entity._id?.toHexString()).toBe(oid.toHexString());
    });

    it("attempts to convert a numeric _id into an ObjectId", () => {
        // The installed mongodb driver's ObjectId no longer accepts a bare number,
        // so this exercises the numeric branch but surfaces the driver's own validation error.
        expect(() => new TestMongoEntity({ _id: 1 as any })).toThrow();
    });

    it("keeps an existing ObjectId instance as-is", () => {
        const oid = new ObjectId();
        const entity = new TestMongoEntity({ _id: oid });
        expect(entity._id).toBe(oid);
    });

    it("inherits uid handling from SimpleEntity", () => {
        const entity = new TestMongoEntity({ uid: "xyz" });
        expect(entity.uid).toBe("xyz");
    });
});
