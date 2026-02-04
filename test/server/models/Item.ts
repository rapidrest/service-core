///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2020-2026 Jean-Philippe Steinmetz
///////////////////////////////////////////////////////////////////////////////
import { BaseEntity } from "../../../src/models/BaseEntity.js";
import { Entity, Column, Index } from "typeorm";
import { Identifier, DataStore } from "../../../src/decorators/ModelDecorators.js";
import { Description } from "../../../src/decorators/DocDecorators.js";

@DataStore("sqlite")
@Entity()
@Description("An Item describes a resource within the system that is used by a player.")
export default class Item extends BaseEntity {
    @Identifier
    @Index()
    @Column()
    @Description("The unique name of the item.")
    public name: string = "";

    @Column()
    @Description("The amount of the item that exists.")
    public quantity: number = 0;

    @Column()
    @Description("The cost that must be paid by the user to acquire the item.")
    public cost: number = 0;

    constructor(other?: Partial<Item>) {
        super(other);

        if (other) {
            this.name = other.name || this.name;
            this.quantity = other.quantity || this.quantity;
            this.cost = other.cost || this.cost;
        }
    }
}
