[@rapidrest/service-core](../README.md) / [Exports](../modules.md) / RouteUtils

# Class: RouteUtils

Provides a set of utilities for converting Route classes to ExpressJS middleware.

**`Author`**

Jean-Philippe Steinmetz <rapidrests@gmail.com>

## Table of contents

### Constructors

- [constructor](RouteUtils.md#constructor)

### Properties

- [apiSpec](RouteUtils.md#apispec)
- [authConfig](RouteUtils.md#authconfig)
- [authSocketTimeout](RouteUtils.md#authsockettimeout)
- [logger](RouteUtils.md#logger)

### Methods

- [authWebSocket](RouteUtils.md#authwebsocket)
- [checkRequiredRoles](RouteUtils.md#checkrequiredroles)
- [getFuncArray](RouteUtils.md#getfuncarray)
- [getRouteMethods](RouteUtils.md#getroutemethods)
- [registerRoute](RouteUtils.md#registerroute)
- [wrapMiddleware](RouteUtils.md#wrapmiddleware)

## Constructors

### constructor

• **new RouteUtils**(): [`RouteUtils`](RouteUtils.md)

#### Returns

[`RouteUtils`](RouteUtils.md)

## Properties

### apiSpec

• `Private` **apiSpec**: [`OpenApiSpec`](OpenApiSpec.md)

#### Defined in

composer-service-core/src/express/RouteUtils.ts:21

---

### authConfig

• `Private` **authConfig**: `any`

#### Defined in

composer-service-core/src/express/RouteUtils.ts:24

---

### authSocketTimeout

• `Private` **authSocketTimeout**: `number` = `2000`

#### Defined in

composer-service-core/src/express/RouteUtils.ts:27

---

### logger

• `Private` `Optional` **logger**: `any`

#### Defined in

composer-service-core/src/express/RouteUtils.ts:30

## Methods

### authWebSocket

▸ **authWebSocket**(`required`): `RequestHandler`\<`ParamsDictionary`, `any`, `any`, `ParsedQs`, `Record`\<`string`, `any`\>\>

Returns a request handler function that will perform authentication of a websocket connection. Authentication
can be handled in two ways:

1. Authorization header
2. Negotiation via handshake

This middleware function primarily provides the implementation for item 2 above.

#### Parameters

| Name       | Type      | Description                                                         |
| :--------- | :-------- | :------------------------------------------------------------------ |
| `required` | `boolean` | Set to `true` to indicate that auth is required, otherwise `false`. |

#### Returns

`RequestHandler`\<`ParamsDictionary`, `any`, `any`, `ParsedQs`, `Record`\<`string`, `any`\>\>

#### Defined in

composer-service-core/src/express/RouteUtils.ts:43

---

### checkRequiredRoles

▸ **checkRequiredRoles**(`requiredRoles`): `RequestHandler`\<`ParamsDictionary`, `any`, `any`, `ParsedQs`, `Record`\<`string`, `any`\>\>

Creates an Express middleware function that verifies the incoming request is from a valid user with at least
one of the specified roles.

#### Parameters

| Name            | Type       | Description                                              |
| :-------------- | :--------- | :------------------------------------------------------- |
| `requiredRoles` | `string`[] | The list of roles that the authenticated user must have. |

#### Returns

`RequestHandler`\<`ParamsDictionary`, `any`, `any`, `ParsedQs`, `Record`\<`string`, `any`\>\>

#### Defined in

composer-service-core/src/express/RouteUtils.ts:131

---

### getFuncArray

▸ **getFuncArray**(`route`, `funcs`, `send?`): `RequestHandler`\<`ParamsDictionary`, `any`, `any`, `ParsedQs`, `Record`\<`string`, `any`\>\>[]

Converts the given array of string or Function objects to functions bound to the given route object.

#### Parameters

| Name    | Type                       | Default value | Description                                                                   |
| :------ | :------------------------- | :------------ | :---------------------------------------------------------------------------- |
| `route` | `any`                      | `undefined`   | The route object that the list of functions is bound to.                      |
| `funcs` | (`string` \| `Function`)[] | `undefined`   | The array of functions (or function names) to return.                         |
| `send`  | `boolean`                  | `false`       | Set to true to have the last wrapped function send its payload to the client. |

#### Returns

`RequestHandler`\<`ParamsDictionary`, `any`, `any`, `ParsedQs`, `Record`\<`string`, `any`\>\>[]

An array of Function objects mapping to the route object.

#### Defined in

composer-service-core/src/express/RouteUtils.ts:152

---

### getRouteMethods

▸ **getRouteMethods**(`route`): `Map`\<`string`, `any`\>

Searches an route object for any functions that implement a `@Method` decorator.

#### Parameters

| Name    | Type  | Description                 |
| :------ | :---- | :-------------------------- |
| `route` | `any` | The route object to search. |

#### Returns

`Map`\<`string`, `any`\>

The list of `@Method` decorated functions that were found.

#### Defined in

composer-service-core/src/express/RouteUtils.ts:175

---

### registerRoute

▸ **registerRoute**(`app`, `route`): `Promise`\<`void`\>

Registers the provided route object containing a set of decorated endpoints to the server.

#### Parameters

| Name    | Type  | Description                                       |
| :------ | :---- | :------------------------------------------------ |
| `app`   | `any` | The Express application to register the route to. |
| `route` | `any` | The route object to register with Express.        |

#### Returns

`Promise`\<`void`\>

#### Defined in

composer-service-core/src/express/RouteUtils.ts:204

---

### wrapMiddleware

▸ **wrapMiddleware**(`obj`, `func`, `send?`): `RequestHandler`\<`ParamsDictionary`, `any`, `any`, `ParsedQs`, `Record`\<`string`, `any`\>\>

Wraps the provided function with Express handling based on the function's defined decorators.

#### Parameters

| Name   | Type       | Default value | Description                                                   |
| :----- | :--------- | :------------ | :------------------------------------------------------------ |
| `obj`  | `any`      | `undefined`   | The bound object whose middleware function will be wrapped.   |
| `func` | `Function` | `undefined`   | The decorated function to wrap for registration with Express. |
| `send` | `boolean`  | `false`       | Set to true to have `func`'s result sent to the client.       |

#### Returns

`RequestHandler`\<`ParamsDictionary`, `any`, `any`, `ParsedQs`, `Record`\<`string`, `any`\>\>

#### Defined in

composer-service-core/src/express/RouteUtils.ts:308
