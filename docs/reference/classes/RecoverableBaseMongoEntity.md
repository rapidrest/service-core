[@rapidrest/service-core](../README.md) / [Exports](../modules.md) / RecoverableBaseMongoEntity

# Class: RecoverableBaseMongoEntity

The `RecoverableBaseMongoEntity` provides an entity base class for those classes wishing to implement
soft delete capability. A soft delete means that a delete operation does not remove the entity
from the database but instead simply marks it as deleted. To completely remove the entity from
the database the user must explicitly specify the entity to be purged.

**`Author`**

Jean-Philippe Steinmetz <rapidrests@gmail.com>

## Hierarchy

- [`RecoverableBaseEntity`](RecoverableBaseEntity.md)

    ↳ **`RecoverableBaseMongoEntity`**

## Table of contents

### Constructors

- [constructor](RecoverableBaseMongoEntity.md#constructor)

### Properties

- [\_id](RecoverableBaseMongoEntity.md#_id)
- [dateCreated](RecoverableBaseMongoEntity.md#datecreated)
- [dateModified](RecoverableBaseMongoEntity.md#datemodified)
- [deleted](RecoverableBaseMongoEntity.md#deleted)
- [uid](RecoverableBaseMongoEntity.md#uid)
- [version](RecoverableBaseMongoEntity.md#version)

## Constructors

### constructor

• **new RecoverableBaseMongoEntity**(`other?`): [`RecoverableBaseMongoEntity`](RecoverableBaseMongoEntity.md)

#### Parameters

| Name     | Type  |
| :------- | :---- |
| `other?` | `any` |

#### Returns

[`RecoverableBaseMongoEntity`](RecoverableBaseMongoEntity.md)

#### Overrides

[RecoverableBaseEntity](RecoverableBaseEntity.md).[constructor](RecoverableBaseEntity.md#constructor)

#### Defined in

composer-service-core/src/models/RecoverableBaseMongoEntity.ts:22

## Properties

### \_id

• `Optional` **\_id**: `any`

The internal unique identifier used by MongoDB.

#### Defined in

composer-service-core/src/models/RecoverableBaseMongoEntity.ts:20

---

### dateCreated

• **dateCreated**: `Date`

The date and time that the entity was created.

#### Inherited from

[RecoverableBaseEntity](RecoverableBaseEntity.md).[dateCreated](RecoverableBaseEntity.md#datecreated)

#### Defined in

composer-service-core/src/models/BaseEntity.ts:35

---

### dateModified

• **dateModified**: `Date`

The date and time that the entity was last modified.

#### Inherited from

[RecoverableBaseEntity](RecoverableBaseEntity.md).[dateModified](RecoverableBaseEntity.md#datemodified)

#### Defined in

composer-service-core/src/models/BaseEntity.ts:43

---

### deleted

• **deleted**: `boolean` = `false`

Indicates if the document has been soft deleted.

#### Inherited from

[RecoverableBaseEntity](RecoverableBaseEntity.md).[deleted](RecoverableBaseEntity.md#deleted)

#### Defined in

composer-service-core/src/models/RecoverableBaseEntity.ts:20

---

### uid

• **uid**: `string`

The universally unique identifier of the entity.

#### Inherited from

[RecoverableBaseEntity](RecoverableBaseEntity.md).[uid](RecoverableBaseEntity.md#uid)

#### Defined in

composer-service-core/src/models/BaseEntity.ts:27

---

### version

• **version**: `number` = `0`

The optimistic lock version.

#### Inherited from

[RecoverableBaseEntity](RecoverableBaseEntity.md).[version](RecoverableBaseEntity.md#version)

#### Defined in

composer-service-core/src/models/BaseEntity.ts:50
