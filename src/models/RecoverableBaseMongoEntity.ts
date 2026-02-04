///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2020-2026 Jean-Philippe Steinmetz
///////////////////////////////////////////////////////////////////////////////
import { ObjectId, ObjectIdColumn } from "typeorm";
import { RecoverableBaseEntity } from "./RecoverableBaseEntity.js";

/**
 * The `RecoverableBaseMongoEntity` provides an entity base class for those classes wishing to implement
 * soft delete capability. A soft delete means that a delete operation does not remove the entity
 * from the database but instead simply marks it as deleted. To completely remove the entity from
 * the database the user must explicitly specify the entity to be purged.
 *
 * @author Jean-Philippe Steinmetz <rapidrests@gmail.com>
 */
export abstract class RecoverableBaseMongoEntity extends RecoverableBaseEntity {
    /**
     * The internal unique identifier used by MongoDB.
     */
    @ObjectIdColumn()
    public _id?: any;

    constructor(other?: Partial<RecoverableBaseMongoEntity>) {
        super(other);

        if (other) {
            this._id = other._id
                ? typeof other._id === "string" || typeof other._id === "number"
                    ? new ObjectId(other._id)
                    : other._id
                : this._id;
        }
    }
}
