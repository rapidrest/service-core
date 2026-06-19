///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2020-2026 Jean-Philippe Steinmetz. All rights reserved.
///////////////////////////////////////////////////////////////////////////////
import { Column, Entity, Index } from "../../../src/decorators/PersistenceDecorators";
import { ModelDecorators } from "../../../src/decorators";
import { BaseMongoEntity } from "../../../src/models/BaseMongoEntity";
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
            this.name = "name" in other ? other.name : this.name;
            this.firstName = "firstName" in other ? other.firstName : this.firstName;
            this.lastName = "lastName" in other ? other.lastName : this.lastName;
            this.age = "age" in other ? other.age : this.age;
        }
    }
}
