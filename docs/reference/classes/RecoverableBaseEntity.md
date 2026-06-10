[@rapidrest/service-core](../README.md) / [Exports](../modules.md) / RecoverableBaseEntity

# Class: RecoverableBaseEntity

The `RecoverableBaseEntity` provides an entity base class for those classes wishing to implement
soft delete capability. A soft delete means that a delete operation does not remove the entity
from the database but instead simply marks it as deleted. To completely remove the entity from
the database the user must explicitly specify the entity to be purged.

**`Author`**

Jean-Philippe Steinmetz <rapidrests@gmail.com>

## Hierarchy

- [`BaseEntity`](BaseEntity.md)

    ↳ **`RecoverableBaseEntity`**

    ↳↳ [`RecoverableBaseMongoEntity`](RecoverableBaseMongoEntity.md)

## Table of contents

### Constructors

- [constructor](RecoverableBaseEntity.md#constructor)

### Properties

- [dateCreated](RecoverableBaseEntity.md#datecreated)
- [dateModified](RecoverableBaseEntity.md#datemodified)
- [deleted](RecoverableBaseEntity.md#deleted)
- [uid](RecoverableBaseEntity.md#uid)
- [version](RecoverableBaseEntity.md#version)

## Constructors

### constructor

• **new RecoverableBaseEntity**(`other?`): [`RecoverableBaseEntity`](RecoverableBaseEntity.md)

#### Parameters

| Name     | Type  |
| :------- | :---- |
| `other?` | `any` |

#### Returns

[`RecoverableBaseEntity`](RecoverableBaseEntity.md)

#### Overrides

[BaseEntity](BaseEntity.md).[constructor](BaseEntity.md#constructor)

#### Defined in

composer-service-core/src/models/RecoverableBaseEntity.ts:22

## Properties

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

### deleted

• **deleted**: `boolean` = `false`

Indicates if the document has been soft deleted.

#### Defined in

composer-service-core/src/models/RecoverableBaseEntity.ts:20

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
