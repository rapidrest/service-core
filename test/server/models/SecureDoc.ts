///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2020-2026 Jean-Philippe Steinmetz. All rights reserved.
///////////////////////////////////////////////////////////////////////////////
import { Column, Entity, Index } from "../../../src/decorators/PersistenceDecorators";
import { ModelDecorators } from "../../../src/decorators";
import { BaseMongoEntity } from "../../../src/models/BaseMongoEntity";
import { ACLAction } from "../../../src/security/AccessControlList";
const { DataStore, Identifier, Protect, ReadOnly, TrackChanges } = ModelDecorators;

@DataStore("mongodb")
@Entity()
@TrackChanges()
@Protect(
    {
        uid: "SecureDoc",
        records: [
            {
                userOrRoleId: "anonymous",
                actions: [],
            },
            {
                userOrRoleId: ".*",
                actions: [ACLAction.CREATE, ACLAction.READ],
            },
        ],
    },
    true,
)
export default class SecureDoc extends BaseMongoEntity {
    @Identifier
    @Index()
    @Column()
    public name: string = "";

    @Column()
    public content: string = "";

    /** Never settable by a client — used to verify mass-assignment protection. */
    @ReadOnly
    @Column()
    public locked: boolean = false;

    constructor(other?: Partial<SecureDoc>) {
        super(other);

        if (other) {
            this.name = "name" in other ? other.name : this.name;
            this.content = "content" in other ? other.content : this.content;
            this.locked = "locked" in other ? (other.locked as boolean) : this.locked;
        }
    }
}
