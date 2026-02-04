///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2020-2026 Jean-Philippe Steinmetz
///////////////////////////////////////////////////////////////////////////////
import { ObjectId } from "mongodb";
import { SimpleEntity } from "./SimpleEntity.js";
import { ObjectIdColumn } from "typeorm";

/**
 * Provides a simple base class for all entity's that will be persisted with TypeORM in a MongoDB database. Unlike
 * `BaseMongoEntity` this class does not provide optimistic locking or date created and modified tracking.
 *
 * @author Jean-Philippe Steinmetz <rapidrests@gmail.com>
 */
export abstract class SimpleMongoEntity extends SimpleEntity {
    /**
     * The internal unique identifier used by MongoDB.
     */
    @ObjectIdColumn()
    public _id?: ObjectId;

    constructor(other?: Partial<SimpleMongoEntity>) {
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
