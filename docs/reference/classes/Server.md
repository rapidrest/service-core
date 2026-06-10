[@rapidrest/service-core](../README.md) / [Exports](../modules.md) / Server

# Class: Server

Provides an HTTP server utilizing ExpressJS and PassportJS. The server automatically registers all routes, and
establishes database connections for all configured data stores. Additionally provides automatic authentication
handling using JSON Web Token (JWT) via PassportJS. When provided an OpenAPI specificatiion object the server will
also automatically serve this specification via the `GET /openapi.json` route.

Routes are defined by creating any class definition using the various decorators found in `RouteDecorators` and
saving these files in the `routes` subfolder. Upon server start, the `routes` folder is scanned for any class
that has been decorated with `@Route` and is automatically loaded and registered with Express. Similarly, if the
class is decorated with the `@Model` decorator the resulting route object will have the associated data model
definition object injected into the constructor.

By default all registered endpoints that do not explicit have an `@Auth` decorator have the `JWT` authentication
strategy applied. This allows users to be implicitly authenticated without requiring additional configuration.
Once authenticated, the provided `request` argument will have the `user` property available containing information
about the authenticated user. If the `user` property is `undefined` then no user has been authenticated or the
authentication attempt failed.

The following is an example of a simple route class.

```javascript
import { DefaultBehaviors, RouteDecorators } from "@acceleratxr/service_core";
import { Get, Route } = RouteDecorators;

@Route("/hello")
class TestRoute extends ModelRoute {
   constructor(model: any) {
       super(model);
   }

   @Get()
   count(req: any, res: any, next: Function): any {
       return res.send("Hello World!");
   }
}

export default TestRoute;
```

The following is an example of a route class that is bound to a data model providing basic CRUDS operations.

```javascript
import { DefaultBehaviors, ModelDecorators, ModelRoute, RouteDecorators } from "@acceleratxr/service_core";
import { After, Before, Delete, Get, Post, Put, Route, Validate } = RouteDecorators;
import { Model } = ModelDecorators;
import { marshall } = DefaultBehaviors;

@Model("Item")
@Route("/items")
class ItemRoute extends ModelRoute {
    constructor(model: any) {
      super(model);
  }

  @Get()
  @Before(super.count)
  @After(marshall)
  count(req: any, res: any, next: Function): any {
      return next();
  }

  @Post()
  @Before([super.create])
  @After([this.prepare, marshall])
  create(req: any, res: any, next: Function): any {
      return next();
  }

  @Delete(":id")
  @Before([super.delete])
  delete(req: any, res: any, next: Function): any {
      return next();
  }

  @Get()
  @Before([super.findAll])
  @After(this.prepareAndSend)
  findAll(req: any, res: any, next: Function): any {
      return next();
  }

  @Get(":id")
  @Before([super.findById])
  @After([this.prepare, marshall])
  findById(req: any, res: any, next: Function): any {
      return next();
  }

  @Put(":id")
  @Before([super.update])
  @After([this.prepare, marshall])
  update(req: any, res: any, next: Function): any {
      return next();
  }
}

export default ItemRoute;
```

**`Author`**

Jean-Philippe Steinmetz

## Table of contents

### Constructors

- [constructor](Server.md#constructor)

### Properties

- [apiSpec](Server.md#apispec)
- [app](Server.md#app)
- [basePath](Server.md#basepath)
- [config](Server.md#config)
- [connectionManager](Server.md#connectionmanager)
- [logger](Server.md#logger)
- [metricCompletedRequests](Server.md#metriccompletedrequests)
- [metricFailedRequests](Server.md#metricfailedrequests)
- [metricRequestPath](Server.md#metricrequestpath)
- [metricRequestStatus](Server.md#metricrequeststatus)
- [metricRequestTime](Server.md#metricrequesttime)
- [metricTotalRequests](Server.md#metrictotalrequests)
- [objectFactory](Server.md#objectfactory)
- [port](Server.md#port)
- [routeUtils](Server.md#routeutils)
- [server](Server.md#server)
- [serviceManager](Server.md#servicemanager)
- [wss](Server.md#wss)

### Methods

- [getApplication](Server.md#getapplication)
- [getServer](Server.md#getserver)
- [isRunning](Server.md#isrunning)
- [restart](Server.md#restart)
- [start](Server.md#start)
- [stop](Server.md#stop)

## Constructors

### constructor

• **new Server**(`config`, `basePath?`, `logger?`, `objectFactory?`): [`Server`](Server.md)

Creates a new instance of Server with the specified defaults.

#### Parameters

| Name             | Type                                | Default value | Description                                                              |
| :--------------- | :---------------------------------- | :------------ | :----------------------------------------------------------------------- |
| `config`         | `any`                               | `undefined`   | The nconf-compatible configuration object to initialize the server with. |
| `basePath`       | `string`                            | `"."`         | The base file system path that models and routes will be searched from.  |
| `logger`         | `any`                               | `undefined`   | The logging utility to use for outputing to console/file.                |
| `objectFactory?` | [`ObjectFactory`](ObjectFactory.md) | `undefined`   | The object factory to use for automatic dependency injection (IOC).      |

#### Returns

[`Server`](Server.md)

#### Defined in

composer-service-core/src/Server.ts:206

## Properties

### apiSpec

• `Protected` `Optional` **apiSpec**: [`OpenApiSpec`](OpenApiSpec.md)

The OpenAPI specification object to use to construct the server with.

#### Defined in

composer-service-core/src/Server.ts:144

---

### app

• `Protected` **app**: `Application`

The underlying ExpressJS application that provides HTTP processing services.

#### Defined in

composer-service-core/src/Server.ts:146

---

### basePath

• `Protected` `Readonly` **basePath**: `string`

The base file system path that will be searched for models and routes.

#### Defined in

composer-service-core/src/Server.ts:148

---

### config

• `Protected` `Optional` `Readonly` **config**: `any`

The global object containing configuration information to use.

#### Defined in

composer-service-core/src/Server.ts:150

---

### connectionManager

• `Protected` `Optional` **connectionManager**: [`ConnectionManager`](ConnectionManager.md)

The manager for handling database connections.

#### Defined in

composer-service-core/src/Server.ts:152

---

### logger

• `Protected` `Readonly` **logger**: `any`

The logging utility to use when outputing to console/file.

#### Defined in

composer-service-core/src/Server.ts:154

---

### metricCompletedRequests

• `Protected` **metricCompletedRequests**: `Counter`\<`string`\>

#### Defined in

composer-service-core/src/Server.ts:185

---

### metricFailedRequests

• `Protected` **metricFailedRequests**: `Counter`\<`string`\>

#### Defined in

composer-service-core/src/Server.ts:189

---

### metricRequestPath

• `Protected` **metricRequestPath**: `Counter`\<`string`\>

#### Defined in

composer-service-core/src/Server.ts:169

---

### metricRequestStatus

• `Protected` **metricRequestStatus**: `Counter`\<`string`\>

#### Defined in

composer-service-core/src/Server.ts:174

---

### metricRequestTime

• `Protected` **metricRequestTime**: `Histogram`\<`string`\>

#### Defined in

composer-service-core/src/Server.ts:179

---

### metricTotalRequests

• `Protected` **metricTotalRequests**: `Counter`\<`string`\>

#### Defined in

composer-service-core/src/Server.ts:193

---

### objectFactory

• `Protected` `Readonly` **objectFactory**: [`ObjectFactory`](ObjectFactory.md)

The object factory to use when injecting dependencies.

#### Defined in

composer-service-core/src/Server.ts:156

---

### port

• `Readonly` **port**: `number`

The port that the server is listening on.

#### Defined in

composer-service-core/src/Server.ts:158

---

### routeUtils

• `Protected` `Optional` **routeUtils**: [`RouteUtils`](RouteUtils.md)

#### Defined in

composer-service-core/src/Server.ts:159

---

### server

• `Protected` `Optional` **server**: `Server`\<typeof `IncomingMessage`, typeof `ServerResponse`\>

The underlying HTTP server instance.

#### Defined in

composer-service-core/src/Server.ts:161

---

### serviceManager

• `Protected` `Optional` **serviceManager**: [`BackgroundServiceManager`](BackgroundServiceManager.md)

#### Defined in

composer-service-core/src/Server.ts:162

---

### wss

• `Protected` `Optional` **wss**: `Server`\<typeof `WebSocket`, typeof `IncomingMessage`\>

The underlying WebSocket server instance.

#### Defined in

composer-service-core/src/Server.ts:164

## Methods

### getApplication

▸ **getApplication**(): `Application`

Returns the express app.

#### Returns

`Application`

#### Defined in

composer-service-core/src/Server.ts:223

---

### getServer

▸ **getServer**(): `undefined` \| `Server`\<typeof `IncomingMessage`, typeof `ServerResponse`\>

Returns the http server.

#### Returns

`undefined` \| `Server`\<typeof `IncomingMessage`, typeof `ServerResponse`\>

#### Defined in

composer-service-core/src/Server.ts:230

---

### isRunning

▸ **isRunning**(): `boolean`

Returns `true` if the server is running, otherwise `false`.

#### Returns

`boolean`

#### Defined in

composer-service-core/src/Server.ts:237

---

### restart

▸ **restart**(): `Promise`\<`void`\>

Restarts the HTTP listen server using the provided configuration and OpenAPI specification.

#### Returns

`Promise`\<`void`\>

#### Defined in

composer-service-core/src/Server.ts:540

---

### start

▸ **start**(): `Promise`\<`void`\>

Starts an HTTP listen server based on the provided configuration and OpenAPI specification.

#### Returns

`Promise`\<`void`\>

#### Defined in

composer-service-core/src/Server.ts:244

---

### stop

▸ **stop**(): `Promise`\<`void`\>

Stops the HTTP listen server.

#### Returns

`Promise`\<`void`\>

#### Defined in

composer-service-core/src/Server.ts:501
