///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2020-2026 Jean-Philippe Steinmetz
///////////////////////////////////////////////////////////////////////////////
import { DocDecorators, ModelDecorators } from "../decorators/index.js";
import { BaseMongoEntity } from "../models/index.js";
import { AccessControlList, ACLRecord } from "./AccessControlList.js";
import { Column, Entity, Index } from "typeorm";
const { Description, TypeInfo } = DocDecorators;
const { Cache, DataStore } = ModelDecorators;

/**
 * Implementation of the `ACLRecord` interface for use with MongoDB databases.
 */
@Entity()
@Description(`
The \`ACLRecord\` interface describes a single permissions entry in an \`AccessControlList\` that grants or denies a set of permissions to a single user or role.

Each permission can be one of the following actions:
 - \`Create\` - The user or role can create a new record or object.
 - \`Read\` - The user or role can read the record or object.
 - \`Update\` - The user or role can modify existing records or objects.
 - \`Delete\` - The user or role can delete existing records or objects.
 - \`Special\` - The user or role has special prilieges to edit the ACL permissions.
 - \`Full\` - The user or role has total control over the record or object and supersedes any of the above.`)
export class ACLRecordMongo implements ACLRecord {
    @Description(
        "The unique identiifer of the user or role that the record will apply to. This can also be a regular expression to match multiple users or roles."
    )
    @Column()
    @Index("userOrRoleId")
    public userOrRoleId: string;

    @Description("The user or role can create a new record or object.")
    @Column()
    @TypeInfo([Boolean])
    public create: boolean | null;

    @Description("The user or role can read the record or object.")
    @Column()
    @TypeInfo([Boolean])
    public read: boolean | null;

    @Description("The user or role can modify existing records or objects.")
    @Column()
    @TypeInfo([Boolean])
    public update: boolean | null;

    @Description("The user or role can delete existing records or objects.")
    @Column()
    @TypeInfo([Boolean])
    public delete: boolean | null;

    @Description("The user or role has special prilieges to edit the ACL permissions.")
    @Column()
    @TypeInfo([Boolean])
    public special: boolean | null;

    @Description("The user or role has total control over the record or object and supersedes any of the above.")
    @Column()
    @TypeInfo([Boolean])
    public full: boolean | null;

    constructor(other?: any) {
        if (other) {
            this.userOrRoleId = other.userOrRoleId;
            this.create = "create" in other ? other.create : null;
            this.read = "read" in other ? other.read : null;
            this.update = "update" in other ? other.update : null;
            this.delete = "delete" in other ? other.delete : null;
            this.special = "special" in other ? other.special : null;
            this.full = "full" in other ? other.full : null;
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
 universally unique identifier (\`uuid\`). Each entry in the ACL records the permissions available to a particular user
 or role.

 Each permission can be one of the following actions:
 - \`Create\` - The user or role can create a new record or object.
 - \`Read\` - The user or role can read the record or object.
 - \`Update\` - The user or role can modify existing records or objects.
 - \`Delete\` - The user or role can delete existing records or objects.
 - \`Special\` - The user or role has special prilieges to edit the ACL permissions.
 - \`Full\` - The user or role has total control over the record or object and supersedes any of the above.

 For each of the above actions the user or role will be granted either an \`allow\` permission or a \`deny\` permission.
 If an \`allow\` is granted, the user or role has permission to perform that action. If a \`deny\` is set, then the user
 or role is denied that action. If no explicit \`allow\` or \`deny\` is set then the user or role will inherit the
 permission from a parent role or ACL.

 ACLs can be chained via single inheritance through the specification of the \`parentUid\`. This allows the ability to
 create complex trees of permissions that can easily inherit control schemes to make the definition of permissions
 easier.`)
export class AccessControlListMongo extends BaseMongoEntity implements AccessControlList {
    public parent?: AccessControlList;

    @Description(
        "The universally unique identifier of the parent `AccessControlList` that this object will inherit permissions from."
    )
    @Column()
    @Index("parentUid")
    @TypeInfo([String])
    public parentUid?: string | undefined;

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
