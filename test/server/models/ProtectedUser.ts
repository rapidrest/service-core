///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2020-2026 Jean-Philippe Steinmetz
///////////////////////////////////////////////////////////////////////////////
import { Entity, Column, Index } from "typeorm";
import { ModelDecorators } from "../../../src/decorators/index.js";
import { BaseMongoEntity } from "../../../src/models/BaseMongoEntity.js";
const { DataStore, Identifier, Protect } = ModelDecorators;

@DataStore("mongodb")
@Entity()
@Protect(
    {
        uid: "ProtectedUser",
        records: [
            {
                userOrRoleId: "anonymous",
                create: true,
                read: false,
                update: false,
                delete: false,
                special: false,
                full: false,
            },
            {
                userOrRoleId: ".*",
                create: false,
                read: true,
                update: false,
                delete: false,
                special: false,
                full: false,
            },
        ],
    },
    true
)
export default class ProtectedUser extends BaseMongoEntity {
    @Identifier
    @Index()
    @Column()
    public name: string = "";

    @Column()
    public firstName: string = "";

    @Column()
    public lastName: string = "";

    @Column()
    public age: number = 0;

    constructor(other?: Partial<ProtectedUser>) {
        super(other);

        if (other) {
            this.name = other.name || this.name;
            this.firstName = other.firstName || this.firstName;
            this.lastName = other.lastName || this.lastName;
            this.age = other.age || this.age;
        }
    }
}
