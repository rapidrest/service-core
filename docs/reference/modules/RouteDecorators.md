[@rapidrest/service-core](../README.md) / [Exports](../modules.md) / RouteDecorators

# Namespace: RouteDecorators

## Table of contents

### Functions

- [After](RouteDecorators.md#after)
- [Auth](RouteDecorators.md#auth)
- [AuthPayload](RouteDecorators.md#authpayload)
- [AuthToken](RouteDecorators.md#authtoken)
- [Before](RouteDecorators.md#before)
- [ContentType](RouteDecorators.md#contenttype)
- [Delete](RouteDecorators.md#delete)
- [Get](RouteDecorators.md#get)
- [Head](RouteDecorators.md#head)
- [Header](RouteDecorators.md#header)
- [Method](RouteDecorators.md#method)
- [Model](RouteDecorators.md#model)
- [Options](RouteDecorators.md#options)
- [Param](RouteDecorators.md#param)
- [Patch](RouteDecorators.md#patch)
- [Post](RouteDecorators.md#post)
- [Put](RouteDecorators.md#put)
- [Query](RouteDecorators.md#query)
- [Request](RouteDecorators.md#request)
- [RequiresRole](RouteDecorators.md#requiresrole)
- [Response](RouteDecorators.md#response)
- [Route](RouteDecorators.md#route)
- [Socket](RouteDecorators.md#socket)
- [User](RouteDecorators.md#user)
- [Validate](RouteDecorators.md#validate)
- [WebSocket](RouteDecorators.md#websocket)

## Functions

### After

▸ **After**(`func`): (`target`: `any`, `propertyKey`: `string`, `descriptor`: `PropertyDescriptor`) => `void`

Indicates a provided function or list of functions to execute _after_ the decorated function and before the response
is sent to a client. Note that the function must call `next()` in order for this decorator to work.

#### Parameters

| Name   | Type                                                 | Description                                                                  |
| :----- | :--------------------------------------------------- | :--------------------------------------------------------------------------- |
| `func` | `string` \| `Function` \| (`string` \| `Function`)[] | The function or list of functions to execute _after_ the decorated function. |

#### Returns

`fn`

▸ (`target`, `propertyKey`, `descriptor`): `void`

##### Parameters

| Name          | Type                 |
| :------------ | :------------------- |
| `target`      | `any`                |
| `propertyKey` | `string`             |
| `descriptor`  | `PropertyDescriptor` |

##### Returns

`void`

#### Defined in

composer-service-core/src/decorators/RouteDecorators.ts:12

---

### Auth

▸ **Auth**(`strategies`, `require?`): (`target`: `any`, `propertyKey`: `string`, `descriptor`: `PropertyDescriptor`) => `void`

Applies PassportJS authentication to the decorated route or method for the provided strategy or list of strategies
should be attempted before processing the route.

#### Parameters

| Name         | Type                   | Default value | Description                                                                                                                                               |
| :----------- | :--------------------- | :------------ | :-------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `strategies` | `string` \| `string`[] | `undefined`   | The PassportJS strategies that will be applied when incoming requests are processed.                                                                      |
| `require`    | `boolean`              | `true`        | Set to `true` to indicate that at least one of the specified authentication strategies must pass to proceed, otherwise set to `false`. Default is `true`. |

#### Returns

`fn`

▸ (`target`, `propertyKey`, `descriptor`): `void`

##### Parameters

| Name          | Type                 |
| :------------ | :------------------- |
| `target`      | `any`                |
| `propertyKey` | `string`             |
| `descriptor`  | `PropertyDescriptor` |

##### Returns

`void`

#### Defined in

composer-service-core/src/decorators/RouteDecorators.ts:32

---

### AuthPayload

▸ **AuthPayload**(`target`, `propertyKey`, `index`): `void`

Injects the authenticated JWT token payload as the value of the decorated argument.

#### Parameters

| Name          | Type     |
| :------------ | :------- |
| `target`      | `any`    |
| `propertyKey` | `string` |
| `index`       | `number` |

#### Returns

`void`

#### Defined in

composer-service-core/src/decorators/RouteDecorators.ts:44

---

### AuthToken

▸ **AuthToken**(`target`, `propertyKey`, `index`): `void`

Injects the authenticated JWT token as the value of the decorated argument.

#### Parameters

| Name          | Type     |
| :------------ | :------- |
| `target`      | `any`    |
| `propertyKey` | `string` |
| `index`       | `number` |

#### Returns

`void`

#### Defined in

composer-service-core/src/decorators/RouteDecorators.ts:53

---

### Before

▸ **Before**(`func`): (`target`: `any`, `propertyKey`: `string`, `descriptor`: `PropertyDescriptor`) => `void`

Indicates a provided function or list of functions to execute _before_ the decorated function.

#### Parameters

| Name   | Type                                                 | Description                                                                   |
| :----- | :--------------------------------------------------- | :---------------------------------------------------------------------------- |
| `func` | `string` \| `Function` \| (`string` \| `Function`)[] | The function or list of functions to execute _before_ the decorated function. |

#### Returns

`fn`

▸ (`target`, `propertyKey`, `descriptor`): `void`

##### Parameters

| Name          | Type                 |
| :------------ | :------------------- |
| `target`      | `any`                |
| `propertyKey` | `string`             |
| `descriptor`  | `PropertyDescriptor` |

##### Returns

`void`

#### Defined in

composer-service-core/src/decorators/RouteDecorators.ts:64

---

### ContentType

▸ **ContentType**(`type`): (`target`: `any`, `propertyKey`: `string`, `descriptor`: `PropertyDescriptor`) => `void`

Indicates that the decorated function will return content encoded with the specified content type.

#### Parameters

| Name   | Type     | Description                                     |
| :----- | :------- | :---------------------------------------------- |
| `type` | `string` | The content type that the function will return. |

#### Returns

`fn`

▸ (`target`, `propertyKey`, `descriptor`): `void`

##### Parameters

| Name          | Type                 |
| :------------ | :------------------- |
| `target`      | `any`                |
| `propertyKey` | `string`             |
| `descriptor`  | `PropertyDescriptor` |

##### Returns

`void`

#### Defined in

composer-service-core/src/decorators/RouteDecorators.ts:81

---

### Delete

▸ **Delete**(`path?`): (`target`: `any`, `propertyKey`: `string`, `descriptor`: `PropertyDescriptor`) => `void`

Indicates that the decorated function handles incoming `DELETE` requests at the given sub-path.

#### Parameters

| Name    | Type     | Description                                           |
| :------ | :------- | :---------------------------------------------------- |
| `path?` | `string` | The sub-path that the route will handle requests for. |

#### Returns

`fn`

▸ (`target`, `propertyKey`, `descriptor`): `void`

##### Parameters

| Name          | Type                 |
| :------------ | :------------------- |
| `target`      | `any`                |
| `propertyKey` | `string`             |
| `descriptor`  | `PropertyDescriptor` |

##### Returns

`void`

#### Defined in

composer-service-core/src/decorators/RouteDecorators.ts:94

---

### Get

▸ **Get**(`path?`): (`target`: `any`, `propertyKey`: `string`, `descriptor`: `PropertyDescriptor`) => `void`

Indicates that the decorated function handles incoming `GET` requests at the given sub-path.

#### Parameters

| Name    | Type     | Description                                           |
| :------ | :------- | :---------------------------------------------------- |
| `path?` | `string` | The sub-path that the route will handle requests for. |

#### Returns

`fn`

▸ (`target`, `propertyKey`, `descriptor`): `void`

##### Parameters

| Name          | Type                 |
| :------------ | :------------------- |
| `target`      | `any`                |
| `propertyKey` | `string`             |
| `descriptor`  | `PropertyDescriptor` |

##### Returns

`void`

#### Defined in

composer-service-core/src/decorators/RouteDecorators.ts:103

---

### Head

▸ **Head**(`path?`): (`target`: `any`, `propertyKey`: `string`, `descriptor`: `PropertyDescriptor`) => `void`

Indicates that the decorated function handles incoming `HEAD` requests at the given sub-path.

#### Parameters

| Name    | Type     | Description                                           |
| :------ | :------- | :---------------------------------------------------- |
| `path?` | `string` | The sub-path that the route will handle requests for. |

#### Returns

`fn`

▸ (`target`, `propertyKey`, `descriptor`): `void`

##### Parameters

| Name          | Type                 |
| :------------ | :------------------- |
| `target`      | `any`                |
| `propertyKey` | `string`             |
| `descriptor`  | `PropertyDescriptor` |

##### Returns

`void`

#### Defined in

composer-service-core/src/decorators/RouteDecorators.ts:112

---

### Header

▸ **Header**(`name`): (`target`: `any`, `propertyKey`: `string`, `index`: `number`) => `void`

Injects the value of the specified request header with the given name as the value of the decorated argument.

#### Parameters

| Name   | Type     | Description                                          |
| :----- | :------- | :--------------------------------------------------- |
| `name` | `string` | The name of the header whose value will be injected. |

#### Returns

`fn`

▸ (`target`, `propertyKey`, `index`): `void`

##### Parameters

| Name          | Type     |
| :------------ | :------- |
| `target`      | `any`    |
| `propertyKey` | `string` |
| `index`       | `number` |

##### Returns

`void`

#### Defined in

composer-service-core/src/decorators/RouteDecorators.ts:121

---

### Method

▸ **Method**(`method`, `path?`): (`target`: `any`, `propertyKey`: `string`, `descriptor`: `PropertyDescriptor`) => `void`

Indicates that the decorated function handles incoming HTTP requests for the specified HTTP method(s) at the given sub-path.

#### Parameters

| Name     | Type                   | Description                                       |
| :------- | :--------------------- | :------------------------------------------------ |
| `method` | `string` \| `string`[] | The HTTP method(s) to handle requests for.        |
| `path?`  | `string`               | The sub-path that the route handles requests for. |

#### Returns

`fn`

▸ (`target`, `propertyKey`, `descriptor`): `void`

##### Parameters

| Name          | Type                 |
| :------------ | :------------------- |
| `target`      | `any`                |
| `propertyKey` | `string`             |
| `descriptor`  | `PropertyDescriptor` |

##### Returns

`void`

#### Defined in

composer-service-core/src/decorators/RouteDecorators.ts:135

---

### Model

▸ **Model**(`type`): \<T\>(`constructor`: `T`) => (...`args`: `any`[]) => `__class`\<`T`\> & `T`

Indicates that the class utilizes is a manager for the specified class type.

#### Parameters

| Name   | Type  | Description                                            |
| :----- | :---- | :----------------------------------------------------- |
| `type` | `any` | The data model class type to associate the class with. |

#### Returns

`fn`

▸ \<`T`\>(`constructor`): (...`args`: `any`[]) => `__class`\<`T`\> & `T`

##### Type parameters

| Name | Type                               |
| :--- | :--------------------------------- |
| `T`  | extends (...`args`: `any`[]) => {} |

##### Parameters

| Name          | Type |
| :------------ | :--- |
| `constructor` | `T`  |

##### Returns

(...`args`: `any`[]) => `__class`\<`T`\> & `T`

#### Defined in

composer-service-core/src/decorators/RouteDecorators.ts:158

---

### Options

▸ **Options**(`path?`): (`target`: `any`, `propertyKey`: `string`, `descriptor`: `PropertyDescriptor`) => `void`

Indicates that the decorated function handles incoming `OPTIONS` requests at the given sub-path.

#### Parameters

| Name    | Type     | Description                                           |
| :------ | :------- | :---------------------------------------------------- |
| `path?` | `string` | The sub-path that the route will handle requests for. |

#### Returns

`fn`

▸ (`target`, `propertyKey`, `descriptor`): `void`

##### Parameters

| Name          | Type                 |
| :------------ | :------------------- |
| `target`      | `any`                |
| `propertyKey` | `string`             |
| `descriptor`  | `PropertyDescriptor` |

##### Returns

`void`

#### Defined in

composer-service-core/src/decorators/RouteDecorators.ts:172

---

### Param

▸ **Param**(`name?`): (`target`: `any`, `propertyKey`: `string`, `index`: `number`) => `void`

Injects the value of the specified URI parameter with the given name as the value of the decorated argument. If no
name is specified the entire request parameter will be injected.

#### Parameters

| Name   | Type                    | Default value | Description                                                 |
| :----- | :---------------------- | :------------ | :---------------------------------------------------------- |
| `name` | `undefined` \| `string` | `undefined`   | The name of the URI parameter whose value will be injected. |

#### Returns

`fn`

▸ (`target`, `propertyKey`, `index`): `void`

##### Parameters

| Name          | Type     |
| :------------ | :------- |
| `target`      | `any`    |
| `propertyKey` | `string` |
| `index`       | `number` |

##### Returns

`void`

#### Defined in

composer-service-core/src/decorators/RouteDecorators.ts:182

---

### Patch

▸ **Patch**(`path?`): (`target`: `any`, `propertyKey`: `string`, `descriptor`: `PropertyDescriptor`) => `void`

Indicates that the decorated function handles incoming `PATCH` requests at the given sub-path.

#### Parameters

| Name    | Type     | Description                                           |
| :------ | :------- | :---------------------------------------------------- |
| `path?` | `string` | The sub-path that the route will handle requests for. |

#### Returns

`fn`

▸ (`target`, `propertyKey`, `descriptor`): `void`

##### Parameters

| Name          | Type                 |
| :------------ | :------------------- |
| `target`      | `any`                |
| `propertyKey` | `string`             |
| `descriptor`  | `PropertyDescriptor` |

##### Returns

`void`

#### Defined in

composer-service-core/src/decorators/RouteDecorators.ts:195

---

### Post

▸ **Post**(`path?`): (`target`: `any`, `propertyKey`: `string`, `descriptor`: `PropertyDescriptor`) => `void`

Indicates that the decorated function handles incoming `POST` requests at the given sub-path.

#### Parameters

| Name    | Type     | Description                                           |
| :------ | :------- | :---------------------------------------------------- |
| `path?` | `string` | The sub-path that the route will handle requests for. |

#### Returns

`fn`

▸ (`target`, `propertyKey`, `descriptor`): `void`

##### Parameters

| Name          | Type                 |
| :------------ | :------------------- |
| `target`      | `any`                |
| `propertyKey` | `string`             |
| `descriptor`  | `PropertyDescriptor` |

##### Returns

`void`

#### Defined in

composer-service-core/src/decorators/RouteDecorators.ts:204

---

### Put

▸ **Put**(`path?`): (`target`: `any`, `propertyKey`: `string`, `descriptor`: `PropertyDescriptor`) => `void`

Indicates that the decorated function handles incoming `PUT` requests at the given sub-path.

#### Parameters

| Name    | Type     | Description                                           |
| :------ | :------- | :---------------------------------------------------- |
| `path?` | `string` | The sub-path that the route will handle requests for. |

#### Returns

`fn`

▸ (`target`, `propertyKey`, `descriptor`): `void`

##### Parameters

| Name          | Type                 |
| :------------ | :------------------- |
| `target`      | `any`                |
| `propertyKey` | `string`             |
| `descriptor`  | `PropertyDescriptor` |

##### Returns

`void`

#### Defined in

composer-service-core/src/decorators/RouteDecorators.ts:213

---

### Query

▸ **Query**(`name?`): (`target`: `any`, `propertyKey`: `string`, `index`: `number`) => `void`

Injects the value of the specified query parameter with the given name as the value of the decorated argument. If
no name is specified the entire request query will be injected.

#### Parameters

| Name   | Type                    | Default value | Description                                                   |
| :----- | :---------------------- | :------------ | :------------------------------------------------------------ |
| `name` | `undefined` \| `string` | `undefined`   | THe name of the query parameter whose value will be injected. |

#### Returns

`fn`

▸ (`target`, `propertyKey`, `index`): `void`

##### Parameters

| Name          | Type     |
| :------------ | :------- |
| `target`      | `any`    |
| `propertyKey` | `string` |
| `index`       | `number` |

##### Returns

`void`

#### Defined in

composer-service-core/src/decorators/RouteDecorators.ts:223

---

### Request

▸ **Request**(`target`, `propertyKey`, `index`): `void`

Injects the Express request object as the value of the decorated argument.

#### Parameters

| Name          | Type     |
| :------------ | :------- |
| `target`      | `any`    |
| `propertyKey` | `string` |
| `index`       | `number` |

#### Returns

`void`

#### Defined in

composer-service-core/src/decorators/RouteDecorators.ts:234

---

### RequiresRole

▸ **RequiresRole**(`roles`): (`target`: `any`, `propertyKey`: `string`, `descriptor`: `PropertyDescriptor`) => `void`

Indicates that the client must be an authenticated user with at least one of the specified role(s) to process the
request.

#### Parameters

| Name    | Type                   | Description                                                           |
| :------ | :--------------------- | :-------------------------------------------------------------------- |
| `roles` | `string` \| `string`[] | The role(s) that an authenticated user must have to make the request. |

#### Returns

`fn`

▸ (`target`, `propertyKey`, `descriptor`): `void`

##### Parameters

| Name          | Type                 |
| :------------ | :------------------- |
| `target`      | `any`                |
| `propertyKey` | `string`             |
| `descriptor`  | `PropertyDescriptor` |

##### Returns

`void`

#### Defined in

composer-service-core/src/decorators/RouteDecorators.ts:255

---

### Response

▸ **Response**(`target`, `propertyKey`, `index`): `void`

Injects the Express response object as the value of the decorated argument.

#### Parameters

| Name          | Type     |
| :------------ | :------- |
| `target`      | `any`    |
| `propertyKey` | `string` |
| `index`       | `number` |

#### Returns

`void`

#### Defined in

composer-service-core/src/decorators/RouteDecorators.ts:243

---

### Route

▸ **Route**(`paths`): (`target`: `Function`) => `void`

Indicates that the decorated class contains Express route definitions.

#### Parameters

| Name    | Type                   | Description                                           |
| :------ | :--------------------- | :---------------------------------------------------- |
| `paths` | `string` \| `string`[] | The base path(s) that all route definitions will use. |

#### Returns

`fn`

▸ (`target`): `void`

##### Parameters

| Name     | Type       |
| :------- | :--------- |
| `target` | `Function` |

##### Returns

`void`

#### Defined in

composer-service-core/src/decorators/RouteDecorators.ts:268

---

### Socket

▸ **Socket**(`target`, `propertyKey`, `index`): `void`

Injects the underlying Socket object associated with the request as the value of the decorated argument.
When the handler function is for a WebSocket request, the returned socket will be the newly established
WebSocket connection.

#### Parameters

| Name          | Type     |
| :------------ | :------- |
| `target`      | `any`    |
| `propertyKey` | `string` |
| `index`       | `number` |

#### Returns

`void`

#### Defined in

composer-service-core/src/decorators/RouteDecorators.ts:281

---

### User

▸ **User**(`target`, `propertyKey`, `index`): `void`

Injects the authenticated user object as the value of the decorated argument.

#### Parameters

| Name          | Type     |
| :------------ | :------- |
| `target`      | `any`    |
| `propertyKey` | `string` |
| `index`       | `number` |

#### Returns

`void`

#### Defined in

composer-service-core/src/decorators/RouteDecorators.ts:290

---

### Validate

▸ **Validate**(`func`): (`target`: `any`, `propertyKey`: `string`, `descriptor`: `PropertyDescriptor`) => `void`

Indicates a validation function to execute in order to verify an incoming requests payload.

#### Parameters

| Name   | Type                   | Description                                                              |
| :----- | :--------------------- | :----------------------------------------------------------------------- |
| `func` | `string` \| `Function` | The validation function to execute that will verify the request payload. |

#### Returns

`fn`

▸ (`target`, `propertyKey`, `descriptor`): `void`

##### Parameters

| Name          | Type                 |
| :------------ | :------------------- |
| `target`      | `any`                |
| `propertyKey` | `string`             |
| `descriptor`  | `PropertyDescriptor` |

##### Returns

`void`

#### Defined in

composer-service-core/src/decorators/RouteDecorators.ts:301

---

### WebSocket

▸ **WebSocket**(`path?`): (`target`: `any`, `propertyKey`: `string`, `descriptor`: `PropertyDescriptor`) => `void`

Indicates that the decorated function handles incoming `WebSocket` upgrade requests at the given sub-path.

#### Parameters

| Name    | Type     | Description                                           |
| :------ | :------- | :---------------------------------------------------- |
| `path?` | `string` | The sub-path that the route will handle requests for. |

#### Returns

`fn`

▸ (`target`, `propertyKey`, `descriptor`): `void`

##### Parameters

| Name          | Type                 |
| :------------ | :------------------- |
| `target`      | `any`                |
| `propertyKey` | `string`             |
| `descriptor`  | `PropertyDescriptor` |

##### Returns

`void`

#### Defined in

composer-service-core/src/decorators/RouteDecorators.ts:314
