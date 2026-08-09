///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2020-2026 Jean-Philippe Steinmetz. All rights reserved.
///////////////////////////////////////////////////////////////////////////////
import { ACLRecordMongo } from "../../src/security/AccessControlListMongo";
import { ACLRecordSQL } from "../../src/security/AccessControlListSQL";

describe("ACLRecordMongo Tests", () => {
    it("throws when constructed without an argument", () => {
        expect(() => new ACLRecordMongo()).toThrow("Argument other cannot be null.");
    });

    it("defaults actions to an empty array when not provided", () => {
        const record = new ACLRecordMongo({ userOrRoleId: "u1" });
        expect(record.userOrRoleId).toBe("u1");
        expect(record.actions).toEqual([]);
    });
});

describe("ACLRecordSQL Tests", () => {
    it("throws when constructed without an argument", () => {
        expect(() => new ACLRecordSQL()).toThrow("Argument other cannot be null.");
    });

    it("defaults actions to an empty array when not provided", () => {
        const record = new ACLRecordSQL({ userOrRoleId: "u1" });
        expect(record.userOrRoleId).toBe("u1");
        expect(record.actions).toEqual([]);
    });
});
