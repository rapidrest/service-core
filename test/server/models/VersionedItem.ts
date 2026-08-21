///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2020-2026 Jean-Philippe Steinmetz. All rights reserved.
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
import { BaseEntity } from "../../../src/models/BaseEntity";
import { Column, Entity, Index } from "../../../src/decorators/PersistenceDecorators";
import { Identifier, DataStore, TrackChanges } from "../../../src/decorators/ModelDecorators";
import { Description } from "../../../src/decorators/DocDecorators";

@DataStore("sqlite")
@Entity()
@TrackChanges()
@Description("A trackChanges-enabled Item used to test the SQL/TypeORM version-history path.")
export default class VersionedItem extends BaseEntity {
    @Identifier
    @Index()
    @Column()
    @Description("The unique name of the item.")
    public name: string = "";

    @Column()
    @Description("The cost that must be paid by the user to acquire the item.")
    public cost: number = 0;

    constructor(other?: Partial<VersionedItem>) {
        super(other);

        if (other) {
            this.name = "name" in other ? other.name : this.name;
            this.cost = "cost" in other ? other.cost : this.cost;
        }
    }
}
