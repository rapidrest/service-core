///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2020-2026 Jean-Philippe Steinmetz. All rights reserved.
///////////////////////////////////////////////////////////////////////////////
import { StatusExtraData } from "../src/models/StatusExtraData";

describe("StatusExtraData Tests", () => {
    it("defaults data to an empty object", () => {
        const extra = new StatusExtraData({});
        expect(extra.data).toEqual({});
    });

    it("uses the provided data from other", () => {
        const extra = new StatusExtraData({ data: { a: 1 } });
        expect(extra.data).toEqual({ a: 1 });
    });

    it("keeps the default when other is falsy", () => {
        const extra = new StatusExtraData(undefined as any);
        expect(extra.data).toEqual({});
    });

    it("supports the data setter", () => {
        const extra = new StatusExtraData({});
        extra.data = { b: 2 };
        expect(extra.data).toEqual({ b: 2 });
    });
});
