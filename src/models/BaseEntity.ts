///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2020-2026 Jean-Philippe Steinmetz. All rights reserved.
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
import { Default, Description } from "../decorators/DocDecorators.js";
import { Identifier } from "../decorators/ModelDecorators.js";
import { Column, Index, PrimaryColumn } from "../decorators/PersistenceDecorators.js";
import * as uuid from "uuid";

/**
 * Provides a common base class for all entity's that will be persisted to a datasource.
 *
 * Note that the `@CreateDateColumn`, `@UpdateDateColumn`, and `@VersionColumn` decorators from TypeORM are not supported
 * because they are not implemented in TypeORM's MongoDB support. They are instead implemented directly by this
 * library as part of `ModelRoute`.
 *
 * @author Jean-Philippe Steinmetz <rapidrests@gmail.com>
 */
export abstract class BaseEntity {
    /**
     * The universally unique identifier of the entity.
     */
    @Description("The universally unique identifier of the entity.")
    @Default("randomUUID()")
    @Identifier
    @Index("uid", { unique: true })
    @PrimaryColumn()
    public uid: string = uuid.v4();

    /**
     * The date and time that the entity was created.
     */
    @Description("The date and time that the entity was created.")
    @Default("new Date()")
    @Column()
    public dateCreated: Date = new Date();

    /**
     * The date and time that the entity was last modified.
     */
    @Description("The date and time that the entity was last modified.")
    @Default("new Date()")
    @Column()
    public dateModified: Date = new Date();

    /**
     * The optimistic lock version.
     */
    @Description("The optimistic lock version.")
    @Column()
    public version: number = 0;

    constructor(other?: Partial<BaseEntity>) {
        if (other) {
            this.uid = "uid" in other && other.uid !== undefined ? other.uid : this.uid;
            this.dateCreated =
                typeof other.dateCreated === "string"
                    ? new Date(other.dateCreated)
                    : other.dateCreated || this.dateCreated;
            this.dateModified =
                typeof other.dateModified === "string"
                    ? new Date(other.dateModified)
                    : other.dateModified || this.dateModified;
            this.version = "version" in other && other.version !== undefined ? other.version : this.version;
        }
    }
}

export type PartialBaseEntity<T extends BaseEntity> = Partial<T> & Pick<T, "uid"> & Pick<T, "version">;
