///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2020-2026 Jean-Philippe Steinmetz
///////////////////////////////////////////////////////////////////////////////
import { Column } from "typeorm";
import { ChildEntity, Reference } from "../../../src/decorators/ModelDecorators.js";
import { Description } from "../../../src/decorators/DocDecorators.js";
import Item from "./Item.js";
import User from "./User.js";
import { ObjectDecorators } from "@rapidrest/core";
const { Nullable } = ObjectDecorators;

@ChildEntity()
@Description("The player of a game.")
export default class Player extends User {
    @Description("The skill ranking of the player.")
    @Column()
    public skillRating: number = 1500;

    @Description("The list of unique identifier of items associated with this player.")
    @Reference(Item)
    @Nullable
    items?: string[];

    @Description("The unique identifier of the parent associated with this player.")
    @Reference(User)
    @Nullable
    parentUid?: string;

    constructor(other?: Partial<Player>) {
        super(other);

        if (other) {
            this.skillRating = other.skillRating || this.skillRating;
            this.items = "items" in other ? other.items : this.items;
            this.parentUid = "parentUid" in other ? other.parentUid : this.parentUid;
        }
    }
}
