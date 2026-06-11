///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2020-2026 Jean-Philippe Steinmetz. All rights reserved.
///////////////////////////////////////////////////////////////////////////////
import { Column } from "../decorators/PersistenceDecorators.js";
import { BaseEntity } from "./BaseEntity.js";
import { ObjectId } from "mongodb";
import { ObjectDecorators } from "@rapidrest/core";
const { Nullable } = ObjectDecorators;

/**
 * Provides a common base class for all entity's that will be persisted in a MongoDB database.
 *
 * @author Jean-Philippe Steinmetz <rapidrests@gmail.com>
 */
export abstract class BaseMongoEntity extends BaseEntity {
    /**
     * The internal unique identifier used by MongoDB.
     */
    @Column({ isObjectId: true })
    @Nullable
    public _id?: any;

    constructor(other?: Partial<BaseMongoEntity>) {
        super(other);

        if (other) {
            this._id = other._id
                ? typeof other._id === "string" || typeof other._id === "number"
                    ? new ObjectId(String(other._id))
                    : other._id
                : this._id;
        }
    }
}
