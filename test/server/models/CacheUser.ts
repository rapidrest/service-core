///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2020-2026 Jean-Philippe Steinmetz. All rights reserved.
///////////////////////////////////////////////////////////////////////////////
import { BaseMongoEntity } from "../../../src/models/BaseMongoEntity";
import { Entity, Column } from "typeorm";
import { Cache, DataStore } from "../../../src/decorators/ModelDecorators";
import { Description } from "../../../src/decorators/DocDecorators";

@DataStore("mongodb")
@Entity()
@Cache()
@Description("The CacheUser class describes a user within the system that utilizes the second-level caching system.")
export default class CacheUser extends BaseMongoEntity {
    @Column()
    @Description("The first name of the user.")
    public firstName: string = "";

    @Column()
    @Description("The surname of the user.")
    public lastName: string = "";

    @Column()
    @Description("The age of the user.")
    public age: number = 0;

    constructor(other?: Partial<CacheUser>) {
        super(other);

        if (other) {
            this.firstName = other.firstName || this.firstName;
            this.lastName = other.lastName || this.lastName;
            this.age = other.age || this.age;
        }
    }
}
