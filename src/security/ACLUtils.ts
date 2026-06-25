///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2020-2026 Jean-Philippe Steinmetz. All rights reserved.
///////////////////////////////////////////////////////////////////////////////
import { JWTUser, ObjectDecorators, UserUtils, sleep } from "@rapidrest/core";
import { AccessControlListSQL } from "./AccessControlListSQL.js";
import { AccessControlListMongo } from "./AccessControlListMongo.js";
import type { Repository } from "typeorm";
import type { HttpRequest as Request } from "../http/index.js";
import { AccessControlList, ACLAction, ACLRecord } from "./AccessControlList.js";
import { Redis } from "ioredis";
import { ConnectionManager } from "../database/ConnectionManager.js";
import { isSqlDataSource } from "../database/ConnectionKinds.js";
import { MongoConnection } from "../database/MongoConnection.js";
import { MongoRepository } from "../database/MongoRepository.js";
const { Config, Init, Inject, Logger } = ObjectDecorators;

const CACHE_BASE_KEY: string = "db.cache.AccessControlList";

/**
 * Common utility functions for working with `AccessControlList` objects and validating user permissions.
 */
export class ACLUtils {
    @Config("rbac:enabled", true)
    public enabled: boolean = true;

    private cacheTTL: number = 30;
    @Inject(ConnectionManager)
    private connMgr?: ConnectionManager;
    @Logger
    private logger?: any;
    @Config("trusted_roles", ["admin"])
    private trustedRoles: string[] = ["admin"];

    private get cacheClient(): Redis | undefined {
        return this.connMgr?.connections.get("cache") as Redis | undefined;
    }

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
    private init() {
        if (this.enabled) {
            if (!this.repo) {
                throw new Error("Failed to initialize ACLUtils. Did you forget to configure the `acl` datastore?");
            }
            this.logger?.info("RBAC system is enabled and ready.");
        } else {
            this.logger?.warn("RBAC system is disabled.");
        }
    }

    /**
     * Checks to see if the provided user matches the providedUserOrRoleId.
     * @param user The user to check.
     * @param userOrRoleId The ACL record id to check against.
     * @returns `true` if the user contains a `uid` or `role` that matches the `userOrRoleId`, otherwise `false`.
     */
    private userMatchesId(user: JWTUser | undefined, userOrRoleId: string): boolean {
        if (!user?.uid) {
            return userOrRoleId === "anonymous";
        }
        // Explicit wildcards — match any authenticated user; no regex engine involved
        if (userOrRoleId === ".*" || userOrRoleId === "*") return true;
        if (user.uid === userOrRoleId) return true;
        if (user.roles) {
            for (const role of user.roles) {
                if (role === userOrRoleId) return true;
            }
        }
        return false;
    }

    /**
     * Validates that the user has permission to perform the request operation against the URL path for the
     * provided request. If ACLUtils has not been initialized or the `acl` datastore has not been configured
     * then always returns `true`.
     *
     * @param uid The uid of the access control list to verify against.
     * @param user The user to validate.
     * @param req The request whose URL path and method will be verified.
     */
    public async checkRequestPerms(uid: string, user: JWTUser | undefined, req: Request): Promise<boolean> {
        let result: boolean = true;

        // If RBAC is disabled just return
        if (!this.enabled) {
            return result;
        }

        // Request-scoped cache avoids duplicate Redis/DB fetches when the same ACL uid is
        // checked more than once within a single request (e.g. class + method @Protect).
        if (!(req as any)._aclCache) {
            (req as any)._aclCache = new Map<string, AccessControlList | null>();
        }
        const reqCache: Map<string, AccessControlList | null> = (req as any)._aclCache;

        let acl: AccessControlList | null = await this.findACL(uid, [], reqCache);
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
                // Check for the FULL permission. If granted it will supersede any others. Otherwise, we'll
                // check individually based on the request method.
                result = await this.hasPermission(user, acl, ACLAction.FULL);
                if (!result) {
                    // Map the request method to an ACLAction and test for permission
                    switch (req.method.toLowerCase()) {
                        case "delete":
                            result = await this.hasPermission(user, acl, ACLAction.DELETE);
                            break;
                        case "get":
                            result = await this.hasPermission(user, acl, ACLAction.READ);
                            break;
                        case "post":
                            result = await this.hasPermission(user, acl, ACLAction.CREATE);
                            break;
                        case "put":
                            result = await this.hasPermission(user, acl, ACLAction.UPDATE);
                            break;
                    }
                }
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
        action: ACLAction,
    ): Promise<boolean> {
        let result: boolean | null = null;

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
            const entry: AccessControlList | null = await this.findACL(acl);
            return entry ? await this.hasPermission(user, entry, action) : false;
        }

        // Look for the first available record for the given user
        const record: ACLRecord | null = this.getRecord(acl, user);

        // Validate the requested action against the record.
        if (record) {
            // A `FULL` permission grant overrides everything else
            result = record.full;

            if (!result) {
                switch (action) {
                    case ACLAction.CREATE:
                        result = record.create;
                        break;
                    case ACLAction.DELETE:
                        result = record.delete;
                        break;
                    case ACLAction.FULL:
                        result =
                            record.full ||
                            (record.create && record.delete && record.read && record.special && record.update);
                        break;
                    case ACLAction.READ:
                        result = record.read;
                        break;
                    case ACLAction.SPECIAL:
                        result = record.special;
                        break;
                    case ACLAction.UPDATE:
                        result = record.update;
                        break;
                }
            }
        }

        // No matching record found — deny by default
        return result !== null && result !== undefined ? result : false;
    }

    /**
     * Retrieves the access control list with the associated identifier and populates the parent(s).
     *
     * @param entityId The unique identifier of the ACL to retrieve.
     * @param parentUids The list of already found parent UIDs. This is used to break circular dependencies.
     */
    public async findACL(
        entityId: string,
        parentUids: string[] = [],
        reqCache?: Map<string, AccessControlList | null>,
    ): Promise<AccessControlList | null> {
        if (!this.enabled || !this.repo) {
            return null;
        }

        // Check request-scoped cache first — eliminates redundant Redis/DB round trips
        // when the same ACL uid is visited more than once within one request.
        if (reqCache?.has(entityId)) {
            return reqCache.get(entityId) ?? null;
        }

        let acl: AccessControlList | null = null;

        // Retrieve the ACL from the cache if present
        if (this.cacheClient) {
            const json: string | null = await this.cacheClient.get(`${CACHE_BASE_KEY}.${entityId}`);
            if (json) {
                try {
                    acl = JSON.parse(json);
                } catch (err) {
                    // We don't care if this fails
                }
            }
        }

        // If the acl wasn't found in the cache look in the database
        if (!acl) {
            if (this.repo instanceof MongoRepository) {
                acl = await this.repo.findOne({ uid: entityId });
                acl = acl ? new AccessControlListMongo(acl) : null;
            } else {
                acl = await this.repo.findOne({ uid: entityId } as any);
                acl = acl ? new AccessControlListSQL(acl) : null;
            }

            // Store a copy in the cache for faster retrieval next time
            if (acl && this.cacheClient) {
                void this.cacheClient.setex(`${CACHE_BASE_KEY}.${entityId}`, this.cacheTTL, JSON.stringify(acl));
            }
        }

        // Populate request-scoped cache before fetching the parent chain so recursive
        // calls for the same uid are served from memory.
        if (reqCache) {
            reqCache.set(entityId, acl);
        }

        // Retrieve the parent ACL and assign it if available. Don't populate parents we've
        // already found to prevent a circular dependency.
        if (acl && acl.parentUid && !parentUids.includes(acl.parentUid)) {
            parentUids.push(acl.parentUid);
            acl.parent = await this.findACL(acl.parentUid, parentUids, reqCache);
        }

        return acl;
    }

    /**
     * Deletes the ACL with the given identifier from the database.
     * @param uid The unique identifier of the ACL to remove.
     */
    public async removeACL(uid: string): Promise<void> {
        if (this.enabled) {
            try {
                if (this.repo instanceof MongoRepository) {
                    await this.repo.deleteOne({ uid });
                } else if (this.repo) {
                    await this.repo.delete({ uid });
                }
            } catch (err) {
                // It's okay if this fails because no document exists
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
                // Check to see if any of the permissions changed for this record
                result += foundRecord.create !== recordA.create ? 1 : 0;
                result += foundRecord.delete !== recordA.delete ? 1 : 0;
                result += foundRecord.full !== recordA.full ? 1 : 0;
                result += foundRecord.read !== recordA.read ? 1 : 0;
                result += foundRecord.special !== recordA.special ? 1 : 0;
                result += foundRecord.update !== recordA.update ? 1 : 0;
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
                // Check to see if any of the permissions changed for this record
                result += foundRecord.create !== recordB.create ? 1 : 0;
                result += foundRecord.delete !== recordB.delete ? 1 : 0;
                result += foundRecord.full !== recordB.full ? 1 : 0;
                result += foundRecord.read !== recordB.read ? 1 : 0;
                result += foundRecord.special !== recordB.special ? 1 : 0;
                result += foundRecord.update !== recordB.update ? 1 : 0;
            } else {
                result++;
            }
        }

        return result;
    }

    /**
     * Stores the given access control list into the ACL database.
     *
     * @param acl The ACL to store.
     * @return Returns the ACL that was stored in the database.
     */
    public async saveACL(acl: AccessControlList): Promise<AccessControlList | null> {
        let result: AccessControlList | null = null;
        if (!this.enabled || !acl) {
            return result;
        }

        if (this.repo instanceof MongoRepository) {
            const mACL: AccessControlListMongo = new AccessControlListMongo(acl);
            const existing: AccessControlListMongo | null = await this.repo.findOne({ uid: acl.uid } as any);
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
            result = await this.repo.save(aclMongo);
        } else if (this.repo) {
            const sACL: AccessControlListSQL = new AccessControlListSQL(acl);
            const existing: AccessControlListSQL | null = await this.repo.findOne({ uid: acl.uid } as any);
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
            result = await this.repo.save(aclSQL);
        }

        // Store a copy in the cache for faster retrieval next time
        if (this.cacheClient && result) {
            void this.cacheClient.setex(`${CACHE_BASE_KEY}.${result.uid}`, this.cacheTTL, JSON.stringify(result));
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
                const existing: AccessControlList | null = await this.findACL(defaultAcl.uid);

                if (existing) {
                    // Copy over the new records from code
                    existing.records = defaultAcl.records;
                    defaultAcl = existing;
                } else {
                    // Create the user-defined override record
                    result = await this.saveACL({
                        uid: acl.uid,
                        parentUid: defaultAcl.uid,
                        records: [],
                    });
                }

                // Always save the ACL into the datastore
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
     * Retrieves the first available record in the provided ACL associated with the provided user.
     *
     * @param acl The access control list that will be searched.
     * @param user The user to find a record for.
     * @returns The ACL record associated with the given user if found, otherwise `undefined`.
     */
    public getRecord(acl: AccessControlList, user: JWTUser | undefined): ACLRecord | null {
        if (!acl) {
            return null;
        }

        for (const record of acl.records) {
            if (this.userMatchesId(user, record.userOrRoleId)) {
                return record;
            }
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
