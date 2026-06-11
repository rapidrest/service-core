///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2020-2026 Jean-Philippe Steinmetz. All rights reserved.
///////////////////////////////////////////////////////////////////////////////
import type { Admin, Db, MongoClient } from "mongodb";
import { MongoRepository } from "./MongoRepository.js";
import { resolveCollectionName } from "./NamingUtils.js";

/**
 * Represents a single named connection to a MongoDB database using the native `mongodb` driver, including the
 * registry of all model classes assigned to the connection's datastore.
 *
 * Note that this class only references the `mongodb` package via type-only imports and is therefore safe to load
 * when the optional `mongodb` peer dependency is not installed.
 *
 * @author Jean-Philippe Steinmetz <rapidrests@gmail.com>
 */
export class MongoConnection {
    /** The underlying MongoDB client. */
    public readonly client: MongoClient;
    /** The database that this connection is bound to. */
    public readonly db: Db;
    /** The name of the datastore that this connection was created for. */
    public readonly name: string;

    private connected: boolean = true;
    private entities: Map<string, any> = new Map();
    private repos: Map<any, MongoRepository<any>> = new Map();

    constructor(name: string, client: MongoClient, db: Db, entities?: Iterable<any>) {
        this.name = name;
        this.client = client;
        this.db = db;

        if (entities) {
            for (const clazz of entities) {
                this.entities.set(clazz.name, clazz);
            }
        }
    }

    /** Indicates whether or not the connection is currently active. */
    public get isConnected(): boolean {
        return this.connected;
    }

    /** Returns the admin interface of the underlying database. */
    public admin(): Admin {
        return this.db.admin();
    }

    /**
     * Closes the connection to the database server.
     */
    public async close(): Promise<void> {
        this.connected = false;
        await this.client.close();
    }

    /**
     * Returns the name of the collection that records of the given model class are stored in.
     *
     * @param clazz The model class to resolve the collection name for.
     */
    public collectionNameFor(clazz: any): string {
        return resolveCollectionName(clazz);
    }

    /**
     * Returns the list of all model classes registered with this connection.
     */
    public get entityClasses(): any[] {
        return Array.from(this.entities.values());
    }

    /**
     * Returns a repository for performing operations against the collection associated with the given model class.
     *
     * @param classOrName The model class, or the name of a registered model class, to retrieve a repository for.
     */
    public getRepository<T extends object = any>(classOrName: any | string): MongoRepository<T> {
        let clazz: any = classOrName;
        if (typeof classOrName === "string") {
            clazz = this.entities.get(classOrName);
            if (!clazz) {
                throw new Error(`No entity named '${classOrName}' is registered with datastore '${this.name}'.`);
            }
        }

        let repo: MongoRepository<any> | undefined = this.repos.get(clazz);
        if (!repo) {
            const collectionName: string = this.collectionNameFor(clazz);
            repo = new MongoRepository<any>(this.db, this.db.collection(collectionName), clazz);
            this.repos.set(clazz, repo);
        }

        return repo as MongoRepository<T>;
    }

    /**
     * Returns a repository for performing operations against the collection associated with the given model class.
     * This is an alias of `getRepository` provided for compatibility with TypeORM's `DataSource` interface.
     *
     * @param classOrName The model class, or the name of a registered model class, to retrieve a repository for.
     */
    public getMongoRepository<T extends object = any>(classOrName: any | string): MongoRepository<T> {
        return this.getRepository<T>(classOrName);
    }
}
