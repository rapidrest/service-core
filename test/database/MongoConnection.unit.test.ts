///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2020-2026 Jean-Philippe Steinmetz. All rights reserved.
///////////////////////////////////////////////////////////////////////////////
import { MongoConnection } from "../../src/database/MongoConnection";

class ModelA {}
class ModelB {}

describe("MongoConnection Tests (unit)", () => {
    it("delegates admin() to the underlying db's admin interface", () => {
        const fakeAdmin = { ping: vi.fn() };
        const fakeDb: any = { admin: vi.fn().mockReturnValue(fakeAdmin) };
        const conn = new MongoConnection("test", {} as any, fakeDb, [ModelA, ModelB]);

        expect(conn.admin()).toBe(fakeAdmin);
        expect(fakeDb.admin).toHaveBeenCalledTimes(1);
    });

    it("exposes all registered entity classes via entityClasses", () => {
        const fakeDb: any = { admin: vi.fn() };
        const conn = new MongoConnection("test", {} as any, fakeDb, [ModelA, ModelB]);

        expect(conn.entityClasses).toEqual([ModelA, ModelB]);
    });

    it("defaults entityClasses to empty when no entities are provided", () => {
        const fakeDb: any = { admin: vi.fn() };
        const conn = new MongoConnection("test", {} as any, fakeDb);

        expect(conn.entityClasses).toEqual([]);
    });
});
