///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2020-2026 Jean-Philippe Steinmetz. All rights reserved.
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
import { Column, Entity, Index } from "../../../src/decorators/PersistenceDecorators";
import { ModelDecorators } from "../../../src/decorators";
import { BaseMongoEntity } from "../../../src/models/BaseMongoEntity";
import { ACLAction } from "../../../src/security/AccessControlList";
const { DataStore, Identifier, Protect } = ModelDecorators;

@DataStore("mongodb")
@Entity()
@Protect(
    {
        uid: "ProtectedUser",
        records: [
            {
                userOrRoleId: "anonymous",
                actions: [ACLAction.CREATE],
            },
            {
                userOrRoleId: ".*",
                actions: [ACLAction.READ, ACLAction.LIST, ACLAction.COUNT, ACLAction.EXISTS],
            },
        ],
    },
    true,
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
