[@rapidrest/service-core](../README.md) / [Exports](../modules.md) / ModelRoute

# Class: ModelRoute\<T\>

The `ModelRoute` is an abstract base class that provides a set of built-in route behavior functions for handling
requests for a given data model that is managed by a persistent datastore.

Provided behaviors:

- `count` - Counts the number of objects matching the provided set of criteria in the request's query parameters.
- `create` - Adds a new object to the datastore.
- `delete` - Removes an existing object from the datastore.
- `find` - Finds all objects matching the provided set of criteria in the request's query parameters.
- `findById` - Finds a single object with a specified unique identifier.
- `truncate` - Removes all objects from the datastore.
- `update` - Modifies an existing object in the datastore.

**`Author`**

Jean-Philippe Steinmetz

## Type parameters

| Name | Type                                                                       |
| :--- | :------------------------------------------------------------------------- |
| `T`  | extends [`BaseEntity`](BaseEntity.md) \| [`SimpleEntity`](SimpleEntity.md) |

## Table of contents

### Constructors

- [constructor](ModelRoute.md#constructor)

### Properties

- [cacheClient](ModelRoute.md#cacheclient)
- [cacheTTL](ModelRoute.md#cachettl)
- [config](ModelRoute.md#config)
- [defaultACLUid](ModelRoute.md#defaultacluid)
- [logger](ModelRoute.md#logger)
- [repo](ModelRoute.md#repo)
- [trackChanges](ModelRoute.md#trackchanges)

### Accessors

- [baseCacheKey](ModelRoute.md#basecachekey)
- [modelClass](ModelRoute.md#modelclass)

### Methods

- [doBulkCreate](ModelRoute.md#dobulkcreate)
- [doBulkUpdate](ModelRoute.md#dobulkupdate)
- [doCount](ModelRoute.md#docount)
- [doCreate](ModelRoute.md#docreate)
- [doCreateObject](ModelRoute.md#docreateobject)
- [doDelete](ModelRoute.md#dodelete)
- [doExists](ModelRoute.md#doexists)
- [doFindAll](ModelRoute.md#dofindall)
- [doFindById](ModelRoute.md#dofindbyid)
- [doTruncate](ModelRoute.md#dotruncate)
- [doUpdate](ModelRoute.md#doupdate)
- [doUpdateProperty](ModelRoute.md#doupdateproperty)
- [getObj](ModelRoute.md#getobj)
- [hashQuery](ModelRoute.md#hashquery)
- [searchIdQuery](ModelRoute.md#searchidquery)
- [superInitialize](ModelRoute.md#superinitialize)

## Constructors

### constructor

• **new ModelRoute**\<`T`\>(): [`ModelRoute`](ModelRoute.md)\<`T`\>

Initializes a new instance using any defaults.

#### Type parameters

| Name | Type                                                                       |
| :--- | :------------------------------------------------------------------------- |
| `T`  | extends [`BaseEntity`](BaseEntity.md) \| [`SimpleEntity`](SimpleEntity.md) |

#### Returns

[`ModelRoute`](ModelRoute.md)\<`T`\>

#### Defined in

composer-service-core/src/routes/ModelRoute.ts:125

## Properties

### cacheClient

• `Protected` `Optional` **cacheClient**: `Redis`

The redis client that will be used as a 2nd level cache for all cacheable models.

#### Defined in

composer-service-core/src/routes/ModelRoute.ts:98

---

### cacheTTL

• `Protected` `Optional` **cacheTTL**: `number`

The time, in milliseconds, that objects will be cached before being invalidated.

#### Defined in

composer-service-core/src/routes/ModelRoute.ts:101

---

### config

• `Protected` `Optional` **config**: `any`

The global application configuration.

#### Defined in

composer-service-core/src/routes/ModelRoute.ts:105

---

### defaultACLUid

• `Protected` **defaultACLUid**: `string` = `""`

The unique identifier of the default ACL for the model type.

#### Defined in

composer-service-core/src/routes/ModelRoute.ts:108

---

### logger

• `Protected` **logger**: `any`

#### Defined in

composer-service-core/src/routes/ModelRoute.ts:111

---

### repo

• `Protected` `Optional` `Abstract` **repo**: `Repository`\<`T`\> \| `MongoRepository`\<`T`\>

The model class associated with the controller to perform operations against.

#### Defined in

composer-service-core/src/routes/ModelRoute.ts:114

---

### trackChanges

• `Protected` **trackChanges**: `number` = `0`

The number of previous document versions to store in the database. A negative value indicates storing all
versions, a value of `0` stores no versions.

#### Defined in

composer-service-core/src/routes/ModelRoute.ts:120

## Accessors

### baseCacheKey

• `get` **baseCacheKey**(): `string`

The base key used to get or set data in the cache.

#### Returns

`string`

#### Defined in

composer-service-core/src/routes/ModelRoute.ts:132

---

### modelClass

• `get` **modelClass**(): `any`

The class type of the model this route is associated with.

#### Returns

`any`

#### Defined in

composer-service-core/src/routes/ModelRoute.ts:140

## Methods

### doBulkCreate

▸ **doBulkCreate**(`objs`, `options`): `Promise`\<`T`[]\>

Attempts to store a collection of objects provided in `options.req.body` into the datastore. Upon success, sets the newly persisted
object(s) to the `result` property of the `options.res` argument, otherwise sends a `400 BAD REQUEST` response to the
client.

#### Parameters

| Name      | Type                                                            | Description                               |
| :-------- | :-------------------------------------------------------------- | :---------------------------------------- |
| `objs`    | `T`[]                                                           | The object(s) to store in the database.   |
| `options` | [`CreateRequestOptions`](../interfaces/CreateRequestOptions.md) | The options to process the request using. |

#### Returns

`Promise`\<`T`[]\>

#### Defined in

composer-service-core/src/routes/ModelRoute.ts:352

---

### doBulkUpdate

▸ **doBulkUpdate**(`objs`, `options`): `Promise`\<`T`[]\>

Attempts to modify a collection of existing data model objects.

#### Parameters

| Name      | Type                                                            | Description                                   |
| :-------- | :-------------------------------------------------------------- | :-------------------------------------------- |
| `objs`    | `T`[]                                                           | The object(s) to bulk update in the database. |
| `options` | [`UpdateRequestOptions`](../interfaces/UpdateRequestOptions.md) | The options to process the request using.     |

#### Returns

`Promise`\<`T`[]\>

#### Defined in

composer-service-core/src/routes/ModelRoute.ts:622

---

### doCount

▸ **doCount**(`options`): `Promise`\<`Response`\<`any`, `Record`\<`string`, `any`\>\>\>

Attempts to retrieve the number of data model objects matching the given set of criteria as specified in the
request `query`. Any results that have been found are set to the `content-length` header of the `res` argument.

#### Parameters

| Name      | Type                                                        | Description                               |
| :-------- | :---------------------------------------------------------- | :---------------------------------------- |
| `options` | [`FindRequestOptions`](../interfaces/FindRequestOptions.md) | The options to process the request using. |

#### Returns

`Promise`\<`Response`\<`any`, `Record`\<`string`, `any`\>\>\>

#### Defined in

composer-service-core/src/routes/ModelRoute.ts:285

---

### doCreate

▸ **doCreate**(`obj`, `options`): `Promise`\<`T` \| `T`[]\>

Attempts to store one or more objects provided in `options.req.body` into the datastore. Upon success, sets the newly persisted
object(s) to the `result` property of the `options.res` argument, otherwise sends a `400 BAD REQUEST` response to the
client.

#### Parameters

| Name      | Type                                                            | Description                               |
| :-------- | :-------------------------------------------------------------- | :---------------------------------------- |
| `obj`     | `T` \| `T`[]                                                    | The object(s) to store in the database.   |
| `options` | [`CreateRequestOptions`](../interfaces/CreateRequestOptions.md) | The options to process the request using. |

#### Returns

`Promise`\<`T` \| `T`[]\>

#### Defined in

composer-service-core/src/routes/ModelRoute.ts:382

---

### doCreateObject

▸ **doCreateObject**(`obj`, `options`): `Promise`\<`T`\>

Attempts to store an object provided in `options.req.body` into the datastore. Upon success, sets the newly persisted
object(s) to the `result` property of the `options.res` argument, otherwise sends a `400 BAD REQUEST` response to the
client.

#### Parameters

| Name      | Type                                                            | Description                               |
| :-------- | :-------------------------------------------------------------- | :---------------------------------------- |
| `obj`     | `T`                                                             | The object to store in the database.      |
| `options` | [`CreateRequestOptions`](../interfaces/CreateRequestOptions.md) | The options to process the request using. |

#### Returns

`Promise`\<`T`\>

#### Defined in

composer-service-core/src/routes/ModelRoute.ts:315

---

### doDelete

▸ **doDelete**(`id`, `options`): `Promise`\<`void`\>

Attempts to delete an existing data model object with a given unique identifier encoded by the URI parameter
`id`.

#### Parameters

| Name      | Type                                                            | Description                                    |
| :-------- | :-------------------------------------------------------------- | :--------------------------------------------- |
| `id`      | `string`                                                        | The unique identifier of the object to delete. |
| `options` | [`DeleteRequestOptions`](../interfaces/DeleteRequestOptions.md) | The options to process the request using.      |

#### Returns

`Promise`\<`void`\>

#### Defined in

composer-service-core/src/routes/ModelRoute.ts:397

---

### doExists

▸ **doExists**(`id`, `options`): `Promise`\<`any`\>

Attempts to determine if an existing object with the given unique identifier exists.

#### Parameters

| Name      | Type                                                        | Description                                           |
| :-------- | :---------------------------------------------------------- | :---------------------------------------------------- |
| `id`      | `string`                                                    | The unique identifier of the object to verify exists. |
| `options` | [`FindRequestOptions`](../interfaces/FindRequestOptions.md) | The options to process the request using.             |

#### Returns

`Promise`\<`any`\>

#### Defined in

composer-service-core/src/routes/ModelRoute.ts:450

---

### doFindAll

▸ **doFindAll**(`options`): `Promise`\<`T`[]\>

Attempts to retrieve all data model objects matching the given set of criteria as specified in the request
`query`. Any results that have been found are set to the `result` property of the `res` argument. `result` is
never null.

#### Parameters

| Name      | Type                                                        | Description                               |
| :-------- | :---------------------------------------------------------- | :---------------------------------------- |
| `options` | [`FindRequestOptions`](../interfaces/FindRequestOptions.md) | The options to process the request using. |

#### Returns

`Promise`\<`T`[]\>

#### Defined in

composer-service-core/src/routes/ModelRoute.ts:483

---

### doFindById

▸ **doFindById**(`id`, `options`): `Promise`\<`null` \| `T`\>

Attempts to retrieve a single data model object as identified by the `id` parameter in the URI.

#### Parameters

| Name      | Type                                                        | Description                               |
| :-------- | :---------------------------------------------------------- | :---------------------------------------- |
| `id`      | `string`                                                    | -                                         |
| `options` | [`FindRequestOptions`](../interfaces/FindRequestOptions.md) | The options to process the request using. |

#### Returns

`Promise`\<`null` \| `T`\>

#### Defined in

composer-service-core/src/routes/ModelRoute.ts:557

---

### doTruncate

▸ **doTruncate**(`options`): `Promise`\<`void`\>

Attempts to remove all entries of the data model type from the datastore matching the given
parameters and query.

#### Parameters

| Name      | Type                                                                | Description                               |
| :-------- | :------------------------------------------------------------------ | :---------------------------------------- |
| `options` | [`TruncateRequestOptions`](../interfaces/TruncateRequestOptions.md) | The options to process the request using. |

#### Returns

`Promise`\<`void`\>

#### Defined in

composer-service-core/src/routes/ModelRoute.ts:585

---

### doUpdate

▸ **doUpdate**(`id`, `obj`, `options`): `Promise`\<`T`\>

Attempts to modify an existing data model object as identified by the `id` parameter in the URI.

#### Parameters

| Name      | Type                                                            | Description                               |
| :-------- | :-------------------------------------------------------------- | :---------------------------------------- |
| `id`      | `string`                                                        | -                                         |
| `obj`     | `T`                                                             | The object to update in the database      |
| `options` | [`UpdateRequestOptions`](../interfaces/UpdateRequestOptions.md) | The options to process the request using. |

#### Returns

`Promise`\<`T`\>

#### Defined in

composer-service-core/src/routes/ModelRoute.ts:650

---

### doUpdateProperty

▸ **doUpdateProperty**(`id`, `propertyName`, `value`, `options`): `Promise`\<`T`\>

Attempts to modify a single property of an existing data model object as identified by the `id` parameter in the URI.

Note that this effectively bypasses optimistic locking and can cause unexpected data overwrites. Use with care.

#### Parameters

| Name           | Type                                                            | Description                                    |
| :------------- | :-------------------------------------------------------------- | :--------------------------------------------- |
| `id`           | `string`                                                        | The unique identifier of the object to update. |
| `propertyName` | `string`                                                        | The name of the property to update.            |
| `value`        | `any`                                                           | The value of the property to set.              |
| `options`      | [`UpdateRequestOptions`](../interfaces/UpdateRequestOptions.md) | The options to process the request using.      |

#### Returns

`Promise`\<`T`\>

#### Defined in

composer-service-core/src/routes/ModelRoute.ts:775

---

### getObj

▸ **getObj**(`id`, `version?`, `productUid?`): `Promise`\<`null` \| `T`\>

Retrieves the object with the given id from either the cache or the database. If retrieving from the database
the cache is populated to speed up subsequent requests.

#### Parameters

| Name          | Type                 | Description                                                                              |
| :------------ | :------------------- | :--------------------------------------------------------------------------------------- |
| `id`          | `string`             | The unique identifier of the object to retrieve.                                         |
| `version?`    | `string` \| `number` | The desired version number of the object to retrieve. If `undefined` returns the latest. |
| `productUid?` | `string`             | The optional productUid associated with the object.                                      |

#### Returns

`Promise`\<`null` \| `T`\>

#### Defined in

composer-service-core/src/routes/ModelRoute.ts:220

---

### hashQuery

▸ **hashQuery**(`query`): `string`

Hashes the given query object to a unique string.

#### Parameters

| Name    | Type  | Description               |
| :------ | :---- | :------------------------ |
| `query` | `any` | The query object to hash. |

#### Returns

`string`

#### Defined in

composer-service-core/src/routes/ModelRoute.ts:149

---

### searchIdQuery

▸ **searchIdQuery**(`id`, `version?`, `productUid?`): `any`

Search for existing object based on passed in id and version and product uid.

The result of this function is compatible with all `Repository.find()` functions.

#### Parameters

| Name          | Type                 |
| :------------ | :------------------- |
| `id`          | `string`             |
| `version?`    | `string` \| `number` |
| `productUid?` | `string`             |

#### Returns

`any`

#### Defined in

composer-service-core/src/routes/ModelRoute.ts:275

---

### superInitialize

▸ **superInitialize**(): `Promise`\<`void`\>

Called on server startup to initialize the route with any defaults.

#### Returns

`Promise`\<`void`\>

#### Defined in

composer-service-core/src/routes/ModelRoute.ts:161
