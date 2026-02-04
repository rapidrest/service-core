///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2020-2026 Jean-Philippe Steinmetz
///////////////////////////////////////////////////////////////////////////////
import { Default, Description } from "../decorators/DocDecorators.js";
import { Identifier } from "../decorators/ModelDecorators.js";
import { Index, PrimaryColumn } from "typeorm";
import { v4 as uuidV4 } from "uuid";

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
    @Index()
    @PrimaryColumn()
    public uid: string = uuidV4();

    constructor(other?: Partial<SimpleEntity>) {
        if (other) {
            this.uid = other.uid || this.uid;
        }
    }
}

export type PartialSimpleEntity<T extends SimpleEntity> = Partial<T> & Pick<T, "uid">;
