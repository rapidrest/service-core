///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2020-2026 Jean-Philippe Steinmetz. All rights reserved.
///////////////////////////////////////////////////////////////////////////////
import "reflect-metadata";
import { Shard } from "../src/decorators/ModelDecorators";

describe("ModelDecorators Tests", () => {
    describe("@Shard", () => {
        it("stores the default shard config as both class metadata and a static property when applied with no arguments", () => {
            @Shard()
            class Foo {}

            const expected = { key: { uid: 1 }, unique: false, options: {} };
            expect(Reflect.getMetadata("rrst:shardConfig", Foo)).toEqual(expected);
            expect((Foo as any).shardConfig).toEqual(expected);
        });

        it("stores a caller-supplied shard config", () => {
            const config = { key: { region: 1 }, unique: true, options: { numInitialChunks: 4 } };

            @Shard(config)
            class Foo {}

            expect(Reflect.getMetadata("rrst:shardConfig", Foo)).toEqual(config);
            expect((Foo as any).shardConfig).toEqual(config);
        });
    });
});
