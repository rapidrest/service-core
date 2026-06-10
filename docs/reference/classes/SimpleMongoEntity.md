[@rapidrest/service-core](../README.md) / [Exports](../modules.md) / SimpleMongoEntity

# Class: SimpleMongoEntity

Provides a simple base class for all entity's that will be persisted with TypeORM in a MongoDB database. Unlike
`BaseMongoEntity` this class does not provide optimistic locking or date created and modified tracking.

**`Author`**

Jean-Philippe Steinmetz <rapidrests@gmail.com>

## Hierarchy

- [`SimpleEntity`](SimpleEntity.md)

    ↳ **`SimpleMongoEntity`**

## Table of contents

### Constructors

- [constructor](SimpleMongoEntity.md#constructor)

### Properties

- [\_id](SimpleMongoEntity.md#_id)
- [uid](SimpleMongoEntity.md#uid)

## Constructors

### constructor

• **new SimpleMongoEntity**(`other?`): [`SimpleMongoEntity`](SimpleMongoEntity.md)

#### Parameters

| Name     | Type  |
| :------- | :---- |
| `other?` | `any` |

#### Returns

[`SimpleMongoEntity`](SimpleMongoEntity.md)

#### Overrides

[SimpleEntity](SimpleEntity.md).[constructor](SimpleEntity.md#constructor)

#### Defined in

composer-service-core/src/models/SimpleMongoEntity.ts:21

## Properties

### \_id

• `Optional` **\_id**: `ObjectId`

The internal unique identifier used by MongoDB.

#### Defined in

composer-service-core/src/models/SimpleMongoEntity.ts:19

---

### uid

• **uid**: `string`

The universally unique identifier of the entity.

#### Inherited from

[SimpleEntity](SimpleEntity.md).[uid](SimpleEntity.md#uid)

#### Defined in

composer-service-core/src/models/SimpleEntity.ts:24
