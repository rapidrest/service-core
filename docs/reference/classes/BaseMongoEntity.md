[@rapidrest/service-core](../README.md) / [Exports](../modules.md) / BaseMongoEntity

# Class: BaseMongoEntity

Provides a common base class for all entity's that will be persisted with TypeORM in a MongoDB database.

**`Author`**

Jean-Philippe Steinmetz <rapidrests@gmail.com>

## Hierarchy

- [`BaseEntity`](BaseEntity.md)

    ↳ **`BaseMongoEntity`**

## Table of contents

### Constructors

- [constructor](BaseMongoEntity.md#constructor)

### Properties

- [\_id](BaseMongoEntity.md#_id)
- [dateCreated](BaseMongoEntity.md#datecreated)
- [dateModified](BaseMongoEntity.md#datemodified)
- [uid](BaseMongoEntity.md#uid)
- [version](BaseMongoEntity.md#version)

## Constructors

### constructor

• **new BaseMongoEntity**(`other?`): [`BaseMongoEntity`](BaseMongoEntity.md)

#### Parameters

| Name     | Type  |
| :------- | :---- |
| `other?` | `any` |

#### Returns

[`BaseMongoEntity`](BaseMongoEntity.md)

#### Overrides

[BaseEntity](BaseEntity.md).[constructor](BaseEntity.md#constructor)

#### Defined in

composer-service-core/src/models/BaseMongoEntity.ts:20

## Properties

### \_id

• `Optional` **\_id**: `any`

The internal unique identifier used by MongoDB.

#### Defined in

composer-service-core/src/models/BaseMongoEntity.ts:18

---

### dateCreated

• **dateCreated**: `Date`

The date and time that the entity was created.

#### Inherited from

[BaseEntity](BaseEntity.md).[dateCreated](BaseEntity.md#datecreated)

#### Defined in

composer-service-core/src/models/BaseEntity.ts:35

---

### dateModified

• **dateModified**: `Date`

The date and time that the entity was last modified.

#### Inherited from

[BaseEntity](BaseEntity.md).[dateModified](BaseEntity.md#datemodified)

#### Defined in

composer-service-core/src/models/BaseEntity.ts:43

---

### uid

• **uid**: `string`

The universally unique identifier of the entity.

#### Inherited from

[BaseEntity](BaseEntity.md).[uid](BaseEntity.md#uid)

#### Defined in

composer-service-core/src/models/BaseEntity.ts:27

---

### version

• **version**: `number` = `0`

The optimistic lock version.

#### Inherited from

[BaseEntity](BaseEntity.md).[version](BaseEntity.md#version)

#### Defined in

composer-service-core/src/models/BaseEntity.ts:50
