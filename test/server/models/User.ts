///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2020-2026 Jean-Philippe Steinmetz. All rights reserved.
///////////////////////////////////////////////////////////////////////////////
import { BaseMongoEntity } from "../../../src/models/BaseMongoEntity";
import { Index, Entity, Column } from "typeorm";
import { Identifier, DataStore } from "../../../src/decorators/ModelDecorators";
import { Description, TypeInfo } from "../../../src/decorators/DocDecorators";
import { ObjectDecorators, ValidationUtils } from "@rapidrest/core";
const { Nullable, Validator } = ObjectDecorators;

@DataStore("mongodb")
@Entity()
@Description("The User class describes a user within the system.")
export default class User extends BaseMongoEntity {
    @Identifier
    @Index()
    @Column()
    @Description("The unique identifier of the user.")
    @Validator(ValidationUtils.checkName)
    public name: string = "";

    @Column()
    @Description("The first name of the user.")
    public firstName: string = "";

    @Column()
    @Description("The surname of the user.")
    public lastName: string = "";

    @Column()
    @Description("The age of the user. Must be 13 or older.")
    // TODO  @Validator(ValidationUtils.check((val) => val >= 13))
    public age: number = 0;

    @Identifier
    @Index()
    @Column()
    @Description("The uuid of the product that is associated with this user.")
    @Nullable
    public productUid: string | undefined = undefined;

    @Column()
    @TypeInfo([String, Number, undefined])
    @Nullable
    public uType: string | number | undefined = undefined;

    @Column()
    @Description("The password to use for authentication.")
    public password: string = "";

    @Column()
    @Description("The list of permission roles the user has.")
    public roles: string[] = [];

    constructor(other?: Partial<User>) {
        super(other);

        if (other) {
            this.name = "name" in other ? other.name : this.name;
            this.firstName = "firstName" in other ? other.firstName : this.firstName;
            this.lastName = "lastName" in other ? other.lastName : this.lastName;
            this.age = "age" in other ? other.age : this.age;
            this.productUid = "productUid" in other ? other.productUid : this.productUid;
            this.password = "password" in other ? other.password : this.password;
            this.roles = "roles" in other ? other.roles : this.roles;
        }
    }
}
