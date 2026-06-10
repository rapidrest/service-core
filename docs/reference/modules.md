[@rapidrest/service-core](README.md) / Exports

# @rapidrest/service-core

## Table of contents

### Namespaces

- [DatabaseDecorators](modules/DatabaseDecorators.md)
- [DocDecorators](modules/DocDecorators.md)
- [ModelDecorators](modules/ModelDecorators.md)
- [ObjectDecorators](modules/ObjectDecorators.md)
- [RouteDecorators](modules/RouteDecorators.md)

### Enumerations

- [ApiErrorMessages](enums/ApiErrorMessages.md)
- [ApiErrors](enums/ApiErrors.md)

### Classes

- [AdminRoute](classes/AdminRoute.md)
- [BackgroundService](classes/BackgroundService.md)
- [BackgroundServiceManager](classes/BackgroundServiceManager.md)
- [BaseEntity](classes/BaseEntity.md)
- [BaseMongoEntity](classes/BaseMongoEntity.md)
- [BulkError](classes/BulkError.md)
- [ConnectionManager](classes/ConnectionManager.md)
- [JWTStrategy](classes/JWTStrategy.md)
- [JWTStrategyOptions](classes/JWTStrategyOptions.md)
- [MetricsRoute](classes/MetricsRoute.md)
- [ModelRoute](classes/ModelRoute.md)
- [ModelUtils](classes/ModelUtils.md)
- [NetUtils](classes/NetUtils.md)
- [ObjectFactory](classes/ObjectFactory.md)
- [OpenAPIRoute](classes/OpenAPIRoute.md)
- [OpenApiSpec](classes/OpenApiSpec.md)
- [RecoverableBaseEntity](classes/RecoverableBaseEntity.md)
- [RecoverableBaseMongoEntity](classes/RecoverableBaseMongoEntity.md)
- [RedisTransport](classes/RedisTransport.md)
- [RepoUtils](classes/RepoUtils.md)
- [RouteUtils](classes/RouteUtils.md)
- [Server](classes/Server.md)
- [SimpleEntity](classes/SimpleEntity.md)
- [SimpleMongoEntity](classes/SimpleMongoEntity.md)
- [StatusRoute](classes/StatusRoute.md)

### Interfaces

- [CreateRequestOptions](interfaces/CreateRequestOptions.md)
- [DeleteRequestOptions](interfaces/DeleteRequestOptions.md)
- [FindRequestOptions](interfaces/FindRequestOptions.md)
- [RequestOptions](interfaces/RequestOptions.md)
- [RequestWS](interfaces/RequestWS.md)
- [TruncateRequestOptions](interfaces/TruncateRequestOptions.md)
- [UpdateRequestOptions](interfaces/UpdateRequestOptions.md)

### Type Aliases

- [OneOrMany](modules.md#oneormany)
- [OneOrNull](modules.md#oneornull)

### Functions

- [addWebSocket](modules.md#addwebsocket)

## Type Aliases

### OneOrMany

Ƭ **OneOrMany**\<`T`\>: `T` \| `T`[]

Provides an explicit type declaration for `T | T[]`.

#### Type parameters

| Name |
| :--- |
| `T`  |

#### Defined in

composer-service-core/src/Types.ts:4

---

### OneOrNull

Ƭ **OneOrNull**\<`T`\>: `T` \| `null`

Provides an explicit type declaration for `T | null`.

#### Type parameters

| Name |
| :--- |
| `T`  |

#### Defined in

composer-service-core/src/Types.ts:9

## Functions

### addWebSocket

▸ **addWebSocket**(`app`, `wss`): `any`

Enables and registers WebSocket support to the given Expressjs application and WebSocket server.

#### Parameters

| Name  | Type                                                     | Description                                                     |
| :---- | :------------------------------------------------------- | :-------------------------------------------------------------- |
| `app` | `Application`                                            | The Expressjs application to add WebSocket support to.          |
| `wss` | `Server`\<typeof `WebSocket`, typeof `IncomingMessage`\> | The WebSocketServer server that will be configured for Express. |

#### Returns

`any`

#### Defined in

composer-service-core/src/express/WebSocket.ts:29
