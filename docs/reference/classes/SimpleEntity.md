[@rapidrest/service-core](../README.md) / [Exports](../modules.md) / SimpleEntity

# Class: SimpleEntity

Provides a simple base class for all entity's that will be persisted with TypeORM. Unlike `BaseEntity` this class
does not provide optimistic locking or date created and modified tracking.

**`Author`**

Jean-Philippe Steinmetz <rapidrests@gmail.com>

## Hierarchy

- **`SimpleEntity`**

    ↳ [`SimpleMongoEntity`](SimpleMongoEntity.md)

## Table of contents

### Constructors

- [constructor](SimpleEntity.md#constructor)

### Properties

- [uid](SimpleEntity.md#uid)

## Constructors

### constructor

• **new SimpleEntity**(`other?`): [`SimpleEntity`](SimpleEntity.md)

#### Parameters

| Name     | Type  |
| :------- | :---- |
| `other?` | `any` |

#### Returns

[`SimpleEntity`](SimpleEntity.md)

#### Defined in

composer-service-core/src/models/SimpleEntity.ts:26

## Properties

### uid

• **uid**: `string`

The universally unique identifier of the entity.

#### Defined in

composer-service-core/src/models/SimpleEntity.ts:24
