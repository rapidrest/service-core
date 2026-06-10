[@rapidrest/service-core](../README.md) / [Exports](../modules.md) / ConnectionManager

# Class: ConnectionManager

Provides database connection management.

**`Author`**

Jean-Philippe Steinmetz

## Table of contents

### Constructors

- [constructor](ConnectionManager.md#constructor)

### Properties

- [connections](ConnectionManager.md#connections)
- [logger](ConnectionManager.md#logger)

### Methods

- [buildConnectionUri](ConnectionManager.md#buildconnectionuri)
- [connect](ConnectionManager.md#connect)
- [disconnect](ConnectionManager.md#disconnect)

## Constructors

### constructor

• **new ConnectionManager**(): [`ConnectionManager`](ConnectionManager.md)

#### Returns

[`ConnectionManager`](ConnectionManager.md)

## Properties

### connections

• **connections**: `Map`\<`string`, `Redis` \| `DataSource`\>

#### Defined in

composer-service-core/src/database/ConnectionManager.ts:14

---

### logger

• `Private` **logger**: `any`

#### Defined in

composer-service-core/src/database/ConnectionManager.ts:16

## Methods

### buildConnectionUri

▸ **buildConnectionUri**(`config`): `string`

Builds a compatible connection URI for the database by the provided configuration.

#### Parameters

| Name     | Type  |
| :------- | :---- |
| `config` | `any` |

#### Returns

`string`

#### Defined in

composer-service-core/src/database/ConnectionManager.ts:21

---

### connect

▸ **connect**(`datastores`, `models`): `Promise`\<`void`\>

Attempts to initiate all database connections as defined in the config.

#### Parameters

| Name         | Type                     | Description                                                                                  |
| :----------- | :----------------------- | :------------------------------------------------------------------------------------------- |
| `datastores` | `any`                    | A map of configured datastores to be passed to the underlying engine.                        |
| `models`     | `Map`\<`string`, `any`\> | A map of model names and associated class definitions to establish database connections for. |

#### Returns

`Promise`\<`void`\>

#### Defined in

composer-service-core/src/database/ConnectionManager.ts:39

---

### disconnect

▸ **disconnect**(): `Promise`\<`void`\>

Attempts to disconnect all active database connections.

#### Returns

`Promise`\<`void`\>

#### Defined in

composer-service-core/src/database/ConnectionManager.ts:111
