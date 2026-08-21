///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2020-2026 Jean-Philippe Steinmetz. All rights reserved.
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
import { ObjectDecorators } from "@rapidrest/core";
import { DocDecorators, ModelDecorators } from "../decorators/index.js";
import { BaseMongoEntity } from "../models/index.js";
import type { AccessControlList, ACLRecord } from "./AccessControlList.js";
import { Column, Entity, Index } from "../decorators/PersistenceDecorators.js";
const { Description, TypeInfo } = DocDecorators;
const { Cache, DataStore } = ModelDecorators;
const { Nullable } = ObjectDecorators;

/**
 * Implementation of the `ACLRecord` interface for use with MongoDB databases.
 */
@Entity()
@Description(`
The \`ACLRecord\` interface describes a single permissions entry in an \`AccessControlList\` that grants a set of actions to a single user or role.

\`actions\` is an arbitrary list of action strings (e.g. \`"create"\`, \`"read"\`, \`"publish"\`). The sentinel value \`"*"\` grants every action and supersedes all others.`)
export class ACLRecordMongo implements ACLRecord {
    @Description(
        'The unique identifier of the user or role that the record will apply to. The wildcard values "*" and ".*" match any authenticated user; no other regular expression matching is supported — any other value must match a user or role id exactly.',
    )
    @Column()
    @Index("userOrRoleId")
    public userOrRoleId: string;

    @Description('The list of actions this user or role is granted for the entity. "*" grants everything.')
    @Column()
    @TypeInfo([[Array, String]])
    public actions: string[];

    constructor(other?: any) {
        if (other) {
            this.userOrRoleId = other.userOrRoleId;
            this.actions = other.actions ?? [];
        } else {
            throw new Error("Argument other cannot be null.");
        }
    }
}

/**
 * Implementation of the `AccessControlList` interface for use with MongoDB databases.
 */
@DataStore("acl")
@Entity()
@Cache(3600)
@Description(`The access control list provides a generic interface for the storage of user and roles permissions. Each ACL object
 represents the permission set for a single entity within the system. The entity is identified generically by its
 universally unique identifier (\`uuid\`). Each entry in the ACL records the set of actions granted to a particular
 user or role (see \`ACLRecordMongo\`).

 If no record matches a given user or role, permission is looked up on the parent ACL instead. ACLs can be chained
 via single inheritance through the specification of the \`parentUid\`. This allows the ability to create complex
 trees of permissions that can easily inherit control schemes to make the definition of permissions easier.`)
export class AccessControlListMongo extends BaseMongoEntity implements AccessControlList {
    public parent?: AccessControlList;

    @Description(
        "The universally unique identifier of the parent `AccessControlList` that this object will inherit permissions from.",
    )
    @Column()
    @Index("parentUid")
    @TypeInfo([String])
    @Nullable
    public parentUid?: string = undefined;

    @Description("The list of all permission records associated with this access control list.")
    @Column()
    @TypeInfo([[Array, ACLRecordMongo]])
    public records: ACLRecordMongo[] = [];

    constructor(other?: any) {
        super(other);

        if (other) {
            this.parent = "parent" in other ? other.parent : this.parent;
            this.parentUid = "parentUid" in other ? other.parentUid : this.parentUid;

            if (other.records) {
                this.records = [];
                for (const record of other.records) {
                    const newRecord: ACLRecordMongo = new ACLRecordMongo(record);
                    this.records.push(newRecord);
                }
            }
        }
    }
}
