[@rapidrest/service-core](../README.md) / [Exports](../modules.md) / BaseEntity

# Class: BaseEntity

Provides a common base class for all entity's that will be persisted with TypeORM.

Note that the `@CreateDateColumn`, `@UpdateDateColumn`, and `@VersionColumn` decorators from TypeORM are not supported
because they are not implemented in TypeORM's MongoDB support. They are instead implemented directly by this
library as part of `ModelRoute`.

**`Author`**

Jean-Philippe Steinmetz <rapidrests@gmail.com>

## Hierarchy

- **`BaseEntity`**

    ↳ [`BaseMongoEntity`](BaseMongoEntity.md)

    ↳ [`RecoverableBaseEntity`](RecoverableBaseEntity.md)

## Table of contents

### Constructors

- [constructor](BaseEntity.md#constructor)

### Properties

- [dateCreated](BaseEntity.md#datecreated)
- [dateModified](BaseEntity.md#datemodified)
- [uid](BaseEntity.md#uid)
- [version](BaseEntity.md#version)

## Constructors

### constructor

• **new BaseEntity**(`other?`): [`BaseEntity`](BaseEntity.md)

#### Parameters

| Name     | Type  |
| :------- | :---- |
| `other?` | `any` |

#### Returns

[`BaseEntity`](BaseEntity.md)

#### Defined in

composer-service-core/src/models/BaseEntity.ts:52

## Properties

### dateCreated

• **dateCreated**: `Date`

The date and time that the entity was created.

#### Defined in

composer-service-core/src/models/BaseEntity.ts:35

---

### dateModified

• **dateModified**: `Date`

The date and time that the entity was last modified.

#### Defined in

composer-service-core/src/models/BaseEntity.ts:43

---

### uid

• **uid**: `string`

The universally unique identifier of the entity.

#### Defined in

composer-service-core/src/models/BaseEntity.ts:27

---

### version

• **version**: `number` = `0`

The optimistic lock version.

#### Defined in

composer-service-core/src/models/BaseEntity.ts:50
