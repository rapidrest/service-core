///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2020-2026 Jean-Philippe Steinmetz
///////////////////////////////////////////////////////////////////////////////
import { Column } from "typeorm";
import { BaseEntity } from "./BaseEntity.js";

/**
 * The `RecoverableBaseEntity` provides an entity base class for those classes wishing to implement
 * soft delete capability. A soft delete means that a delete operation does not remove the entity
 * from the database but instead simply marks it as deleted. To completely remove the entity from
 * the database the user must explicitly specify the entity to be purged.
 *
 * @author Jean-Philippe Steinmetz <rapidrests@gmail.com>
 */
export abstract class RecoverableBaseEntity extends BaseEntity {
    /**
     * Indicates if the document has been soft deleted.
     */
    @Column()
    public deleted: boolean = false;

    constructor(other?: Partial<RecoverableBaseEntity>) {
        super(other);

        if (other) {
            this.deleted = other.deleted || this.deleted;
        }
    }
}
