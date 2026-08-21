///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2020-2026 Jean-Philippe Steinmetz. All rights reserved.
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
import { Default, Description } from "../decorators/DocDecorators.js";
import { Identifier } from "../decorators/ModelDecorators.js";
import { Index, PrimaryColumn } from "../decorators/PersistenceDecorators.js";
import * as uuid from "uuid";

/**
 * Provides a simple base class for all entity's that will be persisted with TypeORM. Unlike `BaseEntity` this class
 * does not provide optimistic locking or date created and modified tracking.
 *
 * @author Jean-Philippe Steinmetz <rapidrests@gmail.com>
 */
export abstract class SimpleEntity {
    /**
     * The universally unique identifier of the entity.
     */
    @Description("The universally unique identifier of the entity.")
    @Default("randomUUID()")
    @Identifier
    @Index("uid", { unique: true })
    @PrimaryColumn()
    public uid: string = uuid.v4();

    constructor(other?: Partial<SimpleEntity>) {
        if (other) {
            this.uid = "uid" in other && other.uid !== undefined ? other.uid : this.uid;
        }
    }
}

export type PartialSimpleEntity<T extends SimpleEntity> = Partial<T> & Pick<T, "uid">;
