///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2020-2026 Jean-Philippe Steinmetz
///////////////////////////////////////////////////////////////////////////////
import { ObjectIdColumn } from "typeorm";
import { BaseEntity } from "./BaseEntity.js";
import { ObjectId } from "mongodb";
import { ObjectDecorators } from "@rapidrest/core";
const { Nullable } = ObjectDecorators;

/**
 * Provides a common base class for all entity's that will be persisted with TypeORM in a MongoDB database.
 *
 * @author Jean-Philippe Steinmetz <rapidrests@gmail.com>
 */
export abstract class BaseMongoEntity extends BaseEntity {
    /**
     * The internal unique identifier used by MongoDB.
     */
    @ObjectIdColumn()
    @Nullable
    public _id?: string | ObjectId | Uint8Array;

    constructor(other?: Partial<BaseMongoEntity>) {
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
