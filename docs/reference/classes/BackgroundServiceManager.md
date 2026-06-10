[@rapidrest/service-core](../README.md) / [Exports](../modules.md) / BackgroundServiceManager

# Class: BackgroundServiceManager

The `BackgroundServiceManager` manages all configured background services in the application. It is responsible for
initializing the jobs, scheduling them and performing any related shutdown tasks. See the `BackgroundService`
class for details on how to create a background service class to be used by this manager.

## Usage

To use the manager instantiate a new object and provide the required constructor arguments. Then simply call the
`startAll` function. When shutting your application down you should call the `stopAll` function.

```
import { BackgroundServiceManager } from "@rapidrest/service-core";

const manager: BackgroundServiceManager = new BackgroundServiceManager(objectFactory, serviceClasses, config, logger);
await manager.startAll();
...
await manager.stopAll();
```

You may optionally start and stop individual services using the `start` and `stop` functions respectively.

```
await manager.start("MyService");
...
await manger.stop("MyService");
```

**`Author`**

Jean-Philippe Steinmetz <rapidrests@gmail.com>

## Table of contents

### Constructors

- [constructor](BackgroundServiceManager.md#constructor)

### Properties

- [classes](BackgroundServiceManager.md#classes)
- [config](BackgroundServiceManager.md#config)
- [jobs](BackgroundServiceManager.md#jobs)
- [logger](BackgroundServiceManager.md#logger)
- [objectFactory](BackgroundServiceManager.md#objectfactory)
- [services](BackgroundServiceManager.md#services)

### Methods

- [getService](BackgroundServiceManager.md#getservice)
- [start](BackgroundServiceManager.md#start)
- [startAll](BackgroundServiceManager.md#startall)
- [stop](BackgroundServiceManager.md#stop)
- [stopAll](BackgroundServiceManager.md#stopall)

## Constructors

### constructor

• **new BackgroundServiceManager**(`objectFactory`, `classes`, `config`, `logger`): [`BackgroundServiceManager`](BackgroundServiceManager.md)

#### Parameters

| Name            | Type                                |
| :-------------- | :---------------------------------- |
| `objectFactory` | [`ObjectFactory`](ObjectFactory.md) |
| `classes`       | `Object`                            |
| `config`        | `any`                               |
| `logger`        | `any`                               |

#### Returns

[`BackgroundServiceManager`](BackgroundServiceManager.md)

#### Defined in

composer-service-core/src/BackgroundServiceManager.ts:43

## Properties

### classes

• `Private` **classes**: `Object`

#### Defined in

composer-service-core/src/BackgroundServiceManager.ts:37

---

### config

• `Private` `Readonly` **config**: `any`

#### Defined in

composer-service-core/src/BackgroundServiceManager.ts:36

---

### jobs

• `Private` **jobs**: `any` = `{}`

#### Defined in

composer-service-core/src/BackgroundServiceManager.ts:38

---

### logger

• `Private` `Readonly` **logger**: `any`

#### Defined in

composer-service-core/src/BackgroundServiceManager.ts:39

---

### objectFactory

• `Private` **objectFactory**: [`ObjectFactory`](ObjectFactory.md)

#### Defined in

composer-service-core/src/BackgroundServiceManager.ts:40

---

### services

• `Private` **services**: `any` = `{}`

#### Defined in

composer-service-core/src/BackgroundServiceManager.ts:41

## Methods

### getService

▸ **getService**(`name`): `undefined` \| [`BackgroundService`](BackgroundService.md)

Returns the service instance with the given name.

#### Parameters

| Name   | Type     | Description                                     |
| :----- | :------- | :---------------------------------------------- |
| `name` | `string` | The name of the background service to retrieve. |

#### Returns

`undefined` \| [`BackgroundService`](BackgroundService.md)

#### Defined in

composer-service-core/src/BackgroundServiceManager.ts:55

---

### start

▸ **start**(`serviceName`, `clazz?`, `...args`): `Promise`\<`void`\>

Starts the background service with the given name.

#### Parameters

| Name          | Type     | Description                                                                                         |
| :------------ | :------- | :-------------------------------------------------------------------------------------------------- |
| `serviceName` | `string` | The name of the background service to start.                                                        |
| `clazz?`      | `any`    | The class type of the service to start. If not specified the name is used to lookup the class type. |
| `...args`     | `any`    | The list of arguments to pass into the service constructor                                          |

#### Returns

`Promise`\<`void`\>

#### Defined in

composer-service-core/src/BackgroundServiceManager.ts:81

---

### startAll

▸ **startAll**(): `Promise`\<`void`\>

Starts all configured background services.

#### Returns

`Promise`\<`void`\>

#### Defined in

composer-service-core/src/BackgroundServiceManager.ts:62

---

### stop

▸ **stop**(`serviceName`): `Promise`\<`void`\>

Stops the background service with the given name.

#### Parameters

| Name          | Type     | Description                                 |
| :------------ | :------- | :------------------------------------------ |
| `serviceName` | `string` | The name of the background service to stop. |

#### Returns

`Promise`\<`void`\>

#### Defined in

composer-service-core/src/BackgroundServiceManager.ts:135

---

### stopAll

▸ **stopAll**(): `Promise`\<`void`\>

Stops all currently active background services that are owned by the manager.

#### Returns

`Promise`\<`void`\>

#### Defined in

composer-service-core/src/BackgroundServiceManager.ts:120
