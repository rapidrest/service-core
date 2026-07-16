///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2020-2026 Jean-Philippe Steinmetz. All rights reserved.
///////////////////////////////////////////////////////////////////////////////

/**
 * A set of conventional action strings recognized by the built-in CRUD routes and `RepoUtils`. `ACLRecord.actions`
 * is not limited to these values — any arbitrary string may be granted (e.g. `"publish"`, `"document:archive"`) to
 * express permissions beyond basic CRUD.
 *
 * @author Jean-Philippe Steinmetz <rapidrests@gmail.com>
 */
export const ACLAction = {
    /**
     * Grants every action, including any action string not otherwise listed on the record. Supersedes all others.
     */
    FULL: "*",
    COUNT: "count",
    CREATE: "create",
    DELETE: "delete",
    EXISTS: "exists",
    LIST: "list",
    READ: "read",
    TRUNCATE: "truncate",
    UPDATE: "update",
} as const;

/**
 * The `ACLRecord` interface describes a single permissions entry in an `AccessControlList` that grants a set of
 * actions to a single user or role.
 *
 * `actions` is an arbitrary list of action strings the user or role is granted for the entity. The conventional
 * CRUD actions are defined in `ACLAction`, but any string may be used to express custom, service-specific
 * permissions. The sentinel value `ACLAction.FULL` (`"*"`) grants every action and supersedes all others.
 *
 * If no record matches a given user or role, permission is looked up on the `parent` ACL (see `parentUid`)
 * instead. There is no per-action inheritance within a single matched record — if a record matches, only the
 * actions it explicitly lists are granted.
 *
 * ACLs can be chained via single inheritance through the specification of the `parentUid`. This allows the ability to
 * create complex trees of permissions that can easily inherit control schemes to make the definition of permissions
 * easier.
 *
 * @author Jean-Philippe Steinmetz <rapidrests@gmail.com>
 */
export interface ACLRecord {
    /**
     * The unique identifier of the user or role that the record belongs to.
     */
    userOrRoleId: string;

    /**
     * The list of actions this user or role is granted for the entity. `ACLAction.FULL` (`"*"`) grants everything.
     */
    actions: string[];
}

/**
 * The access control list provides a generic interface for the storage of user and roles permissions. Each ACL object
 * represents the permission set for a single entity within the system. The entity is identified generically by its
 * universally unique identifier (`uuid`). Each entry in the ACL records the set of actions granted to a particular
 * user or role (see `ACLRecord`).
 *
 * If no record in this ACL matches a given user or role, permission is looked up on the `parent` ACL instead. ACLs
 * can be chained via single inheritance through the specification of the `parentUid`. This allows the ability to
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
    parent?: AccessControlList;

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
