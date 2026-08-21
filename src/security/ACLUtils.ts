///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2020-2026 Jean-Philippe Steinmetz. All rights reserved.
///////////////////////////////////////////////////////////////////////////////
import { ObjectDecorators, UserUtils, sleep, type JWTUser } from "@rapidrest/core";
import { AccessControlListSQL } from "./AccessControlListSQL.js";
import { AccessControlListMongo } from "./AccessControlListMongo.js";
import type { Repository } from "typeorm";
import type { HttpRequest } from "../http/index.js";
import { ACLAction, type AccessControlList, type ACLRecord } from "./AccessControlList.js";
import { ConnectionManager } from "../database/ConnectionManager.js";
import { isSqlDataSource } from "../database/ConnectionKinds.js";
import { MongoConnection } from "../database/MongoConnection.js";
import { MongoRepository } from "../database/MongoRepository.js";
import { RedisCache } from "../database/RedisCache.js";
import { ObjectFactory } from "../ObjectFactory.js";
import { registerRollbackHook, Transactional, transactionContext } from "../decorators/DatabaseDecorators.js";
const { Config, Init, Inject, Logger } = ObjectDecorators;

/**
 * Common utility functions for working with `AccessControlList` objects and validating user permissions.
 *
 * @author Jean-Philippe Steinmetz
 */
export class ACLUtils {
    // Automatically injected by ObjectFactory on instantiation
    private _objectFactory?: ObjectFactory;

    @Config("rbac:enabled", true)
    public enabled: boolean = true;

    private cache?: RedisCache<AccessControlList>;

    @Inject(ConnectionManager)
    private connMgr?: ConnectionManager;

    @Logger
    private logger?: any;

    @Config("trusted_roles", ["admin"])
    private trustedRoles: string[] = ["admin"];

    private get repo(): MongoRepository<any> | Repository<any> | undefined {
        const conn: any = this.connMgr?.connections.get("acl");
        if (conn instanceof MongoConnection) {
            return conn.getRepository(AccessControlListMongo);
        } else if (isSqlDataSource(conn)) {
            return conn.getRepository(AccessControlListSQL.name);
        }
        return undefined;
    }

    @Init
    private async init() {
        if (this.enabled) {
            if (!this.repo) {
                throw new Error("Failed to initialize ACLUtils. Did you forget to configure the `acl` datasource?");
            }

            // Create the cache store if caching is enabled for this entity type
            if (!this.cache) {
                const conn: any = this.connMgr?.connections.get("acl");
                let modelClass: any = conn instanceof MongoConnection ? AccessControlListMongo : AccessControlListSQL;
                this.cache = await this._objectFactory?.newInstance(RedisCache, {
                    name: modelClass.fqn ?? modelClass.name,
                    args: [modelClass],
                });
            }

            this.logger?.info("RBAC system is enabled and ready.");
        } else {
            this.logger?.warn("RBAC system is disabled.");
        }
    }

    /**
     * Classifies how specifically the given user matches the provided ACL record id. Used by `getRecord()` to
     * prefer the most specific match among a record's siblings, rather than the first one in array order.
     * @param user The user to check.
     * @param userOrRoleId The ACL record id to check against.
     * @returns `"exact"` for a direct uid/anonymous match, `"role"` for a role match, `"wildcard"` for a `.*`/`*`
     * match, or `"none"` if the user doesn't match this id at all.
     */
    private matchSpecificity(user: JWTUser | undefined, userOrRoleId: string): "exact" | "role" | "wildcard" | "none" {
        if (!user?.uid) {
            // Wildcards only ever match an *authenticated* user (see the check below) — an anonymous caller
            // can only match a record explicitly keyed "anonymous".
            return userOrRoleId === "anonymous" ? "exact" : "none";
        }
        if (user.uid === userOrRoleId) return "exact";
        if (user.roles?.includes(userOrRoleId)) return "role";
        // Explicit wildcards — match any authenticated user; no regex engine involved
        if (userOrRoleId === ".*" || userOrRoleId === "*") return "wildcard";
        return "none";
    }

    /**
     * Validates that the user has permission to perform the request operation against the URL path for the
     * provided request. If ACLUtils has not been initialized or the `acl` datasource has not been configured
     * then always returns `true`.
     *
     * @param uid The uid of the access control list to verify against.
     * @param user The user to validate.
     * @param req The HTTP request to check permissions for.
     */
    public async checkRequestPerms(uid: string, user: JWTUser | undefined, req: HttpRequest): Promise<boolean> {
        // If RBAC is disabled just return
        if (!this.enabled) {
            return true;
        }

        if (!req) {
            throw new Error("options.request must be set to call this function.");
        }

        // Deny by default — if the ACL record can't be found (e.g. it failed to persist at
        // registration time) a `@Protect`-ed route must not silently become open to everyone.
        let result: boolean = false;

        let acl: AccessControlList | undefined = await this.findACL(uid, []);
        if (acl) {
            // Make sure all parents are populated
            if (!acl.parent) {
                await this.populateParent(acl);
            }

            // First check if the user is trusted. Trusted users always have permission. We pass in the ACL uid as
            // it may be an organization id in which case we want to also check for organizational trusted users.
            if (UserUtils.hasRoles(user, this.trustedRoles, acl.uid)) {
                result = true;
            } else {
                // Map the request method to an ACLAction and test for permission. `hasPermission` already
                // treats `ACLAction.FULL` as a wildcard that supersedes any specific action requested.
                const methodToAction: Record<string, string> = {
                    delete: ACLAction.DELETE,
                    get: ACLAction.READ,
                    head: ACLAction.COUNT,
                    patch: ACLAction.UPDATE,
                    post: ACLAction.CREATE,
                    put: ACLAction.UPDATE,
                };
                const action: string | undefined = methodToAction[req.method.toLowerCase()];
                result = action ? await this.hasPermission(user, acl, action) : false;
            }
        }

        return result;
    }

    /**
     * Validates that the user has permission to perform the provided action using the given access control list.
     *
     * @param user The user to validate permissions of.
     * @param acl The ACL or uid of an ACL to validate permissions against.
     * @param action The action that the user desires permission for.
     * @returns `true` if the user has at least one of the permissions granted for the given entity, otherwise `false`.
     */
    public async hasPermission(
        user: JWTUser | undefined,
        acl: AccessControlList | string,
        action: string,
    ): Promise<boolean> {
        // If the repo isn't available, no acl was provided or the ACL string is empty just return, assume always true
        if (!this.enabled || !this.repo || !acl || acl === "") {
            return true;
        }

        // First check if the user is trusted. Trusted users always have permission. We pass in the ACL uid as
        // it may be an organization id in which case we want to also check for organizational trusted users.
        if (UserUtils.hasRoles(user, this.trustedRoles, typeof acl === "string" ? acl : acl.uid)) {
            return true;
        }

        // If a uid has been given look up the ACL associated with it and then process
        if (typeof acl === "string") {
            const entry: AccessControlList | undefined = await this.findACL(acl, []);
            return entry ? await this.hasPermission(user, entry, action) : false;
        }

        // Look for the first available record for the given user
        const record: ACLRecord | null = this.getRecord(acl, user);

        // A `FULL` ("*") grant supersedes any specific action requested.
        return record ? record.actions.includes(ACLAction.FULL) || record.actions.includes(action) : false;
    }

    /**
     * Retrieves the access control list with the associated identifier and populates the parent(s).
     *
     * Deliberately not `@Transactional` and never participates in a caller's transaction: it's on the hot path
     * for every permission check (`hasPermission`/`checkRequestPerms`), not just writes, so wrapping it would
     * add a session open/close to every authorization check. It also has no way to safely reuse a *caller's*
     * transaction context.
     *
     * @param entityId The unique identifier of the ACL to retrieve.
     * @param parentUids The list of already found parent UIDs. This is used to break circular dependencies.
     */
    public async findACL(entityId: string, parentUids: string[] = []): Promise<AccessControlList | undefined> {
        if (!this.enabled || !this.repo) {
            return undefined;
        }

        // Retrieve the ACL from the cache if present. A cache hit must still fall through to the parent-chain
        // population below (not return early) — a cached ACL was stored via its own plain, unpopulated `.parent`
        // (see the cache write below), so skipping that step here would silently return an ACL with no parent
        // chain, which `hasPermission()` needs to find inherited records.
        let acl: AccessControlList | undefined = await this.cache?.load(entityId);

        // If the acl wasn't found in the cache look in the database
        if (!acl) {
            if (this.repo instanceof MongoRepository) {
                acl = await this.repo.findOne({ uid: entityId });
                acl = acl ? new AccessControlListMongo(acl) : undefined;
            } else {
                acl = await this.repo.findOne({ where: { uid: entityId } });
                acl = acl ? new AccessControlListSQL(acl) : undefined;
            }
        }

        // Store a copy in the cache for faster retrieval next time.
        if (acl && this.cache) {
            this.cache.save(entityId, acl).catch((err) => {
                this.logger?.warn(`ACLUtils: Cache save failed for ACL ${entityId}.`);
                this.logger?.debug(err);
            });
        }

        // Retrieve the parent ACL and assign it if available. Don't populate parents we've
        // already found to prevent a circular dependency.
        if (acl && acl.parentUid && !parentUids.includes(acl.parentUid)) {
            parentUids.push(acl.parentUid);
            acl.parent = await this.findACL(acl.parentUid, parentUids);
        }

        return acl;
    }

    /**
     * Deletes the ACL with the given identifier from the database.
     *
     * Runs in its own transaction scoped to the `acl` connection (see `Transactional`) rather than trying to
     * join whatever transaction the caller is itself in — `acl` is frequently configured as its own, separate
     * datastore (a documented, supported deployment shape), so a caller's session/entityManager almost never
     * actually belongs to the same physical connection this repo does. Reusing it directly used to throw
     * (Mongo) or silently target the wrong connection (SQL). Callers that need the entity-side write and this
     * ACL removal to stay consistent should register a compensating action via `registerRollbackHook()`.
     *
     * @param uid The unique identifier of the ACL to remove.
     */
    @Transactional("acl")
    public async removeACL(uid: string): Promise<void> {
        if (this.enabled) {
            if (!this.repo) {
                throw new Error("repo is not set.");
            }

            const ctx = transactionContext.getStore();

            try {
                if (this.repo instanceof MongoRepository) {
                    await this.repo.deleteOne({ uid }, { session: ctx?.session });
                } else {
                    const repo = ctx?.entityManager ? ctx.entityManager.getRepository(AccessControlListSQL) : this.repo;
                    await repo.delete({ uid });
                }
            } catch (err) {
                // It's okay if this fails because no document exists
            }

            // Without this, a deleted ACL stays readable from the cache for up to `cacheTTL` seconds,
            // so permissions the deletion was meant to revoke would continue to apply during that window.
            if (this.cache) {
                await this.cache.delete(uid);
            }
        }
    }

    /**
     * Compares two ACLs to see if they have been modified and returns the total number of changes between them.
     *
     * @param aclA The source ACL to compare against.
     * @param aclB The new ACL to compare with.
     * @returns The total number of changes between the two ACLs.
     */
    private diffACL(aclA: AccessControlList, aclB: AccessControlList): number {
        let result: number = 0;

        // Did the parent change?
        if (aclA.parentUid !== aclB.parentUid) {
            result++;
        }

        // Did any of the records change from A to B?
        for (const recordA of aclA.records) {
            let foundRecord: ACLRecord | undefined = undefined;

            // Look for the same record in aclA
            for (const recordB of aclB.records) {
                if (recordA.userOrRoleId === recordB.userOrRoleId) {
                    foundRecord = recordB;
                    break;
                }
            }

            if (foundRecord) {
                // Check to see if the granted actions changed for this record
                result += this.actionsChanged(foundRecord.actions, recordA.actions) ? 1 : 0;
            } else {
                result++;
            }
        }

        // Did any of the records change from B to A?
        for (const recordB of aclB.records) {
            let foundRecord: ACLRecord | undefined = undefined;

            // Look for the same record in aclA
            for (const recordA of aclA.records) {
                if (recordA.userOrRoleId === recordB.userOrRoleId) {
                    foundRecord = recordA;
                    break;
                }
            }

            if (foundRecord) {
                // Check to see if the granted actions changed for this record
                result += this.actionsChanged(foundRecord.actions, recordB.actions) ? 1 : 0;
            } else {
                result++;
            }
        }

        return result;
    }

    /**
     * Compares two lists of granted actions, ignoring order, to see if they differ.
     */
    private actionsChanged(a: string[], b: string[]): boolean {
        if (a.length !== b.length) {
            return true;
        }
        const sortedA: string[] = [...a].sort();
        const sortedB: string[] = [...b].sort();
        return sortedA.some((action, i) => action !== sortedB[i]);
    }

    /**
     * Stores the given access control list into the ACL database.
     *
     * Runs in its own transaction scoped to the `acl` connection (see `Transactional`) rather than trying to
     * join whatever transaction the caller is itself in — see `removeACL`'s doc comment for why. Callers that
     * need the entity-side write and this ACL save to stay consistent should register a compensating action
     * via `registerRollbackHook()`.
     *
     * @param acl The ACL to store.
     * @return Returns the ACL that was stored in the database.
     */
    @Transactional("acl")
    public async saveACL(acl: AccessControlList): Promise<AccessControlList | null> {
        let result: AccessControlList | null = null;
        if (!this.enabled || !acl) {
            return result;
        }

        if (!this.repo) {
            throw new Error("repo is not set.");
        }

        const ctx = transactionContext.getStore();

        if (this.repo instanceof MongoRepository) {
            const mACL: AccessControlListMongo = new AccessControlListMongo(acl);
            const existing: AccessControlListMongo | null = await this.repo.findOne({ uid: acl.uid } as any, {
                session: ctx?.session,
            });
            // If no changes have been made between versions ignore this request
            if (existing && this.diffACL(existing, acl) === 0) {
                return existing;
            }
            // Make sure that the versions match before we proceed
            if (existing && existing.version !== mACL.version) {
                throw new Error(
                    `The acl to save must be of the same version. ACL=${acl.uid}, Expected=${existing.version}, Actual=${mACL.version}`,
                );
            }
            const aclMongo: AccessControlListMongo = new AccessControlListMongo({
                ...acl,
                dateModifed: new Date(),
                version: existing ? mACL.version + 1 : 0,
            });
            result = await this.repo.save(aclMongo, { session: ctx?.session });
        } else {
            const repo = ctx?.entityManager ? ctx.entityManager.getRepository(AccessControlListSQL) : this.repo;
            const sACL: AccessControlListSQL = new AccessControlListSQL(acl);
            const existing: AccessControlListSQL | null = await repo.findOne({ where: { uid: acl.uid } });
            // If no changes have been made between versions ignore this request
            if (existing && this.diffACL(existing, acl) === 0) {
                return existing;
            }
            // Make sure that the versions match before we proceed
            if (existing && existing.version !== sACL.version) {
                throw new Error(
                    `The acl to save must be of the same version. ACL=${acl.uid}, Expected=${existing.version}, Actual=${sACL.version}`,
                );
            }
            const aclSQL: AccessControlListSQL = new AccessControlListSQL({
                ...acl,
                dateModifed: new Date(),
                version: existing ? sACL.version + 1 : 0,
            });
            result = await repo.save(aclSQL);
        }

        // Store a copy in the cache for faster retrieval next time.
        if (this.cache && result) {
            this.cache.save(result.uid, result).catch((err) => {
                this.logger?.warn(`ACLUtils: Cache save failed for ACL ${result?.uid}.`);
                this.logger?.debug(err);
            });
        }

        return result;
    }

    /**
     * Stores the given default access control list into the ACL database. A default ACL is a special type of ACL
     * that is primarily defined and maintained within the code but allows for user-specific overrides. To accomplish
     * this, the provided ACL is split in two. A new record is automatically created with the `uid` of the form
     * `default_<uid>` that stores the exact record as provided by code. Then a second ACL record is created
     * with the `uid` being that of what is passed as the argument. This second ACL is used to store user-defined
     * overrides. As the `default_<uid>` record is always overwritten with the lastest version of the code, any
     * user-defined changes made to it are lost on service restart.
     *
     * @param defaultAcl
     * @returns
     */
    public async saveDefaultACL(acl: AccessControlList): Promise<AccessControlList | null> {
        let result: AccessControlList | null = null;
        if (!this.enabled || !acl) {
            return result;
        }

        // Make a copy of `acl` with a new name for our default_ record
        let defaultAcl: AccessControlList = {
            ...acl,
            uid: `default_${acl.uid}`,
        };

        // Attempt to update the default ACL record. If a version mismatch occurs we will try again.
        const maxAttempts: number = 3;
        let attempts: number = 0;
        while (attempts++ < maxAttempts) {
            try {
                // Two documents are stored for each default ACL. A record named `default_<NAME>`
                // and another named `<NAME>`. The `<NAME>` record stores the user-defined
                // overrides that overlay the `default_<NAME>` document. The `default_<NAME>` is
                // therefore always updated with whatever is provided as the `defaultAcl` argument.
                const existing: AccessControlList | undefined = await this.findACL(defaultAcl.uid);

                if (existing) {
                    // Copy over the new records from code
                    existing.records = defaultAcl.records;
                    defaultAcl = existing;

                    // The user-defined override record was already created on a previous run. Look it
                    // up so callers still receive a valid ACL to register routes against instead of `null`.
                    result = (await this.findACL(acl.uid)) ?? null;
                } else {
                    // Create the user-defined override record
                    result = await this.saveACL({
                        uid: acl.uid,
                        parentUid: defaultAcl.uid,
                        records: [],
                    });
                }

                // Always save the ACL into the datasource
                await this.saveACL(defaultAcl);
                attempts = maxAttempts;
            } catch (err) {
                if (attempts < maxAttempts) {
                    // Wait a brief moment before we try again. Stagger the time to avoid race conditions.
                    await sleep(Math.floor(Math.random() * 1000));
                } else {
                    // Rethrow if we're out of retries
                    throw err;
                }
            }
        }

        return result;
    }

    /**
     * Atomic removal of multiple ACLs in a single `acl`-scoped transaction (see `@Transactional`).
     *
     * Deliberately sequential, not batched-concurrent: every `removeACL()` call below resolves to this same
     * `acl` datasource, so `@Transactional`'s merge logic joins all of them onto the one MongoDB
     * `ClientSession`/SQL `EntityManager` this method opened. Running these with `Promise.all`
     * would issue overlapping commands against one session, which drivers reject or misorder.
     *
     * @param uids The unique identifiers of the ACLs to remove.
     */
    @Transactional("acl")
    public async removeACLs(uids: string[]): Promise<void> {
        for (const uid of uids) {
            await this.removeACL(uid);
        }
    }

    /**
     * Atomic save of multiple ACLs in a single `acl`-scoped transaction (see `Transactional`). Used to restore
     * a batch of ACL snapshots — e.g. by a `registerRollbackHook()` compensating action — if the entity-side
     * transaction they were removed alongside subsequently fails.
     *
     * Deliberately sequential. See `removeACLs()`'s doc comment for why.
     *
     * @param acls The ACLs to store.
     */
    @Transactional("acl")
    public async saveACLs(acls: AccessControlList[]): Promise<void> {
        for (const acl of acls) {
            await this.saveACL(acl);
        }
    }

    /**
     * Retrieves the most specific record in the provided ACL associated with the provided user: an exact
     * uid/anonymous match beats a role match, which beats a wildcard (`.*`/`*`) match — regardless of where
     * each record sits in `acl.records`. Without this, a wildcard grant authored before a specific record
     * (a natural authoring order) would silently shadow that more specific record. Only falls back to the
     * parent ACL when nothing in this ACL's own records matches at all.
     *
     * @param acl The access control list that will be searched.
     * @param user The user to find a record for.
     * @returns The ACL record associated with the given user if found, otherwise `undefined`.
     */
    public getRecord(acl: AccessControlList, user: JWTUser | undefined): ACLRecord | null {
        if (!acl) {
            return null;
        }

        let roleMatch: ACLRecord | null = null;
        let wildcardMatch: ACLRecord | null = null;
        for (const record of acl.records) {
            const specificity = this.matchSpecificity(user, record.userOrRoleId);
            if (specificity === "exact") {
                return record;
            } else if (specificity === "role") {
                roleMatch = roleMatch ?? record;
            } else if (specificity === "wildcard") {
                wildcardMatch = wildcardMatch ?? record;
            }
        }
        if (roleMatch) {
            return roleMatch;
        }
        if (wildcardMatch) {
            return wildcardMatch;
        }

        return acl.parent ? this.getRecord(acl.parent, user) : null;
    }

    /**
     * Attempts to retrieve the parent access control list for the given ACL object.
     *
     * @param acl The access control list whose parents will be populated.
     * @param parentUids The list of already found parent UIDs. This is used to break circular dependencies.
     */
    public async populateParent(acl: AccessControlList, parentUids: string[] = []): Promise<void> {
        if (acl && acl.parentUid) {
            parentUids.push(acl.parentUid);
            acl.parent = await this.findACL(acl.parentUid, parentUids);
        }
    }
}
