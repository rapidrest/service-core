[@rapidrest/service-core](../README.md) / [Exports](../modules.md) / BackgroundService

# Class: BackgroundService

The `BackgroundService` is an abstract base class for defining scheduled background services. A background service
executes in the background once on startup or on a set schedule (like a cron job) and performs additional processing.

**`Author`**

Jean-Philippe Steinmetz <rapidrests@gmail.com>

## Table of contents

### Constructors

- [constructor](BackgroundService.md#constructor)

### Properties

- [config](BackgroundService.md#config)
- [logger](BackgroundService.md#logger)

### Accessors

- [schedule](BackgroundService.md#schedule)

### Methods

- [run](BackgroundService.md#run)
- [start](BackgroundService.md#start)
- [stop](BackgroundService.md#stop)

## Constructors

### constructor

• **new BackgroundService**(`config`, `logger`): [`BackgroundService`](BackgroundService.md)

#### Parameters

| Name     | Type  |
| :------- | :---- |
| `config` | `any` |
| `logger` | `any` |

#### Returns

[`BackgroundService`](BackgroundService.md)

#### Defined in

composer-service-core/src/BackgroundService.ts:16

## Properties

### config

• `Protected` **config**: `any`

The global application configuration that the service can reference.

#### Defined in

composer-service-core/src/BackgroundService.ts:12

---

### logger

• `Protected` **logger**: `any`

The logging utility to use.

#### Defined in

composer-service-core/src/BackgroundService.ts:14

## Accessors

### schedule

• `get` **schedule**(): `undefined` \| `string`

Returns the desired execution interval that this service should be scheduled with. If `undefined` is returned
the service is executed only once.

#### Returns

`undefined` \| `string`

#### Defined in

composer-service-core/src/BackgroundService.ts:25

## Methods

### run

▸ **run**(): `void` \| `Promise`\<`void`\>

The processing function to execute at each scheduled interval.

#### Returns

`void` \| `Promise`\<`void`\>

#### Defined in

composer-service-core/src/BackgroundService.ts:30

---

### start

▸ **start**(): `void` \| `Promise`\<`void`\>

Initializes the background service with any defaults.

#### Returns

`void` \| `Promise`\<`void`\>

#### Defined in

composer-service-core/src/BackgroundService.ts:35

---

### stop

▸ **stop**(): `void` \| `Promise`\<`void`\>

Shuts down the background allowing the service to complete any outstanding tasks.

#### Returns

`void` \| `Promise`\<`void`\>

#### Defined in

composer-service-core/src/BackgroundService.ts:40
