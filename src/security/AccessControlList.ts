///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2020-2026 Jean-Philippe Steinmetz
///////////////////////////////////////////////////////////////////////////////

/**
 * Describes the various permission actions that can be performed against an entity.
 *
 * @author Jean-Philippe Steinmetz <rapidrests@gmail.com>
 */
export enum ACLAction {
    CREATE = "CREATE",
    DELETE = "DELETE",
    FULL = "FULL",
    READ = "READ",
    SPECIAL = "SPECIAL",
    UPDATE = "UPDATE",
}

/**
 * The `ACLRecord` interface describes a single permissions entry in an `AccessControlList` that grants or denies
 * a set of permissions to a single user or role.
 *
 * Each permission can be one of the following actions:
 * - `Create` - The user or role can create a new record or object.
 * - `Read` - The user or role can read the record or object.
 * - `Update` - The user or role can modify existing records or objects.
 * - `Delete` - The user or role can delete existing records or objects.
 * - `Special` - The user or role has special prilieges to edit the ACL permissions.
 * - `Full` - The user or role has total control over the record or object and supersedes any of the above.
 *
 * @author Jean-Philippe Steinmetz <rapidrests@gmail.com>
 */
export interface ACLRecord {
    /**
     * The unique identifier of the user or role that the record belongs to.
     */
    userOrRoleId: string;

    /**
     * Indicates that the user or role has permission to create new records of the entity.
     */
    create: boolean | null;

    /**
     * Indicates that the user or role has permission to read records of the entity.
     */
    read: boolean | null;

    /**
     * Indicates that the user or role has permission to modify existing records of the entity.
     */
    update: boolean | null;

    /**
     * Indicates that the user or role has permission to delete existing records of the entity.
     */
    delete: boolean | null;

    /**
     * Indicates that the user or role has special permission over records of the entity. The exact meaning of this
     * may vary by service.
     */
    special: boolean | null;

    /**
     * Indicates that the user or role has total control over records of the entity. This supersedes all of the above
     * permissions.
     */
    full: boolean | null;
}

/**
 * The access control list provides a generic interface for the storage of user and roles permissions. Each ACL object
 * represents the permission set for a single entity within the system. The entity is identified generically by its
 * universally unique identifier (`uuid`). Each entry in the ACL records the permissions available to a particular user
 * or role.
 *
 * Each permission can be one of the following actions:
 * - `Create` - The user or role can create a new record or object.
 * - `Read` - The user or role can read the record or object.
 * - `Update` - The user or role can modify existing records or objects.
 * - `Delete` - The user or role can delete existing records or objects.
 * - `Special` - The user or role has special prilieges to edit the ACL permissions.
 * - `Full` - The user or role has total control over the record or object and supersedes any of the above.
 *
 * For each of the above actions the user or role will be granted either an `allow` permission or a `deny` permission.
 * If an `allow` is granted, the user or role has permission to perform that action. If a `deny` is set, then the user
 * or role is denied that action. If no explicit `allow` or `deny` is set then the user or role will inherit the
 * permission from a parent role or ACL.
 *
 * ACLs can be chained via single inheritance through the specification of the `parentUid`. This allows the ability to
 * create complex trees of permissions that can easily inherit control schemes to make the definition of permissions
 * easier.
 *
 * @author Jean-Philippe Steinmetz <rapidrests@gmail.com>
 */
export interface AccessControlList {
    /**
     * The universally unique identifier (`uuid`) of the entity that the access control list belongs to.
     */
    uid: string;

    /**
     * The parent access control list that this instance inherits permissions from.
     */
    parent?: AccessControlList | null;

    /**
     * The universally unique identifier of the parent `AccessControlList` that this object will inherit permissions
     * from.
     */
    parentUid?: string;

    /**
     * The list of all permission records associated with this access control list.
     */
    records: ACLRecord[];
}
