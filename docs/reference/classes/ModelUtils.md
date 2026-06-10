[@rapidrest/service-core](../README.md) / [Exports](../modules.md) / ModelUtils

# Class: ModelUtils

Utility class for working with data model classes.

**`Author`**

Jean-Philippe Steinmetz

## Table of contents

### Constructors

- [constructor](ModelUtils.md#constructor)

### Methods

- [buildIdSearchQuery](ModelUtils.md#buildidsearchquery)
- [buildIdSearchQueryMongo](ModelUtils.md#buildidsearchquerymongo)
- [buildIdSearchQuerySQL](ModelUtils.md#buildidsearchquerysql)
- [buildSearchQuery](ModelUtils.md#buildsearchquery)
- [buildSearchQueryMongo](ModelUtils.md#buildsearchquerymongo)
- [buildSearchQuerySQL](ModelUtils.md#buildsearchquerysql)
- [getIdPropertyNames](ModelUtils.md#getidpropertynames)
- [getQueryParamValue](ModelUtils.md#getqueryparamvalue)
- [getQueryParamValueMongo](ModelUtils.md#getqueryparamvaluemongo)
- [loadModels](ModelUtils.md#loadmodels)

## Constructors

### constructor

• **new ModelUtils**(): [`ModelUtils`](ModelUtils.md)

#### Returns

[`ModelUtils`](ModelUtils.md)

## Methods

### buildIdSearchQuery

▸ **buildIdSearchQuery**\<`T`\>(`repo`, `modelClass`, `id`, `version?`, `productUid?`): `any`

Builds a query object for use with `find` functions of the given repository for retrieving objects matching the
specified unique identifier.

#### Type parameters

| Name |
| :--- |
| `T`  |

#### Parameters

| Name          | Type                                                           | Description                                                                             |
| :------------ | :------------------------------------------------------------- | :-------------------------------------------------------------------------------------- |
| `repo`        | `undefined` \| `Repository`\<`T`\> \| `MongoRepository`\<`T`\> | The repository to build the query for.                                                  |
| `modelClass`  | `any`                                                          | The class definition of the data model to build a search query for.                     |
| `id`          | `any`                                                          | The unique identifier to search for.                                                    |
| `version?`    | `number`                                                       | The version number of the document to search for.                                       |
| `productUid?` | `string`                                                       | The optional product uid that is associated with the uid (when a compound key is used). |

#### Returns

`any`

An object that can be passed to a TypeORM `find` function.

#### Defined in

composer-service-core/src/models/ModelUtils.ts:75

---

### buildIdSearchQueryMongo

▸ **buildIdSearchQueryMongo**(`modelClass`, `id`, `version?`, `productUid?`): `any`

Builds a MongoDB compatible query object for use in `find` functions for retrieving objects matching the
specified unique identifier.

#### Parameters

| Name          | Type     | Description                                                                             |
| :------------ | :------- | :-------------------------------------------------------------------------------------- |
| `modelClass`  | `any`    | The class definition of the data model to build a search query for.                     |
| `id`          | `any`    | The unique identifier to search for.                                                    |
| `version?`    | `number` | The version number of the document to search for.                                       |
| `productUid?` | `string` | The optional product uid that is associated with the uid (when a compound key is used). |

#### Returns

`any`

An object that can be passed to a MongoDB `find` function.

#### Defined in

composer-service-core/src/models/ModelUtils.ts:132

---

### buildIdSearchQuerySQL

▸ **buildIdSearchQuerySQL**(`modelClass`, `id`, `version?`, `productUid?`): `any`

Builds a TypeORM compatible query object for use in `find` functions for retrieving objects matching the
specified unique identifier.

#### Parameters

| Name          | Type     | Description                                                                             |
| :------------ | :------- | :-------------------------------------------------------------------------------------- |
| `modelClass`  | `any`    | The class definition of the data model to build a search query for.                     |
| `id`          | `any`    | The unique identifier to search for.                                                    |
| `version?`    | `number` | The version number of the document to search for.                                       |
| `productUid?` | `string` | The optional product uid that is associated with the uid (when a compound key is used). |

#### Returns

`any`

An object that can be passed to a TypeORM `find` function.

#### Defined in

composer-service-core/src/models/ModelUtils.ts:99

---

### buildSearchQuery

▸ **buildSearchQuery**\<`T`\>(`modelClass`, `repo`, `params?`, `queryParams?`, `exactMatch?`, `user?`): `any`

Builds a query object for the given criteria and repository. Query params can have a value containing a
conditional operator to apply for the search. The operator is encoded with the format `op(value)`. The following
operators are supported:

- `eq` - Returns matches whose parameter exactly matches of the given value. e.g. `param = value`
- `gt` - Returns matches whose parameter is greater than the given value. e.g. `param > value`
- `gte` - Returns matches whose parameter is greater than or equal to the given value. e.g. `param >= value`
- `in` - Returns matches whose parameter includes one of the given values. e.g. `param in ('value1', 'value2', 'value3', ...)`
- `like` - Returns matches whose parameter is lexographically similar to the given value. `param like value`
- `lt` - Returns matches whose parameter is less than the given value. e.g. `param < value`
- `lte` - Returns matches whose parameter is less than or equal to than the given value. e.g. `param < value`
- `not` - Returns matches whose parameter is not equal to the given value. e.g. `param not value`
- `range` - Returns matches whose parameter is greater than or equal to first given value and less than or equal to the second. e.g. `param between(1,100)`

When no operator is provided the comparison will always be evaluated as `eq`.

NOTE: The result of this function is only compatible with the `aggregate()` function when MongoDB is used.

#### Type parameters

| Name |
| :--- |
| `T`  |

#### Parameters

| Name           | Type                                                           | Default value | Description                                                                                                                  |
| :------------- | :------------------------------------------------------------- | :------------ | :--------------------------------------------------------------------------------------------------------------------------- |
| `modelClass`   | `any`                                                          | `undefined`   | The class definition of the data model to build a search query for.                                                          |
| `repo`         | `undefined` \| `Repository`\<`T`\> \| `MongoRepository`\<`T`\> | `undefined`   | The repository to build a search query for.                                                                                  |
| `params?`      | `any`                                                          | `undefined`   | The URI parameters for the endpoint that was requested.                                                                      |
| `queryParams?` | `any`                                                          | `undefined`   | The URI query parameters that were included in the request.                                                                  |
| `exactMatch`   | `boolean`                                                      | `false`       | Set to true to create a query where parameters are to be matched exactly, otherwise set to false to use a 'contains' search. |
| `user?`        | `any`                                                          | `undefined`   | The user that is performing the request.                                                                                     |

#### Returns

`any`

The TypeORM compatible query object.

#### Defined in

composer-service-core/src/models/ModelUtils.ts:354

---

### buildSearchQueryMongo

▸ **buildSearchQueryMongo**(`modelClass`, `params?`, `queryParams?`, `exactMatch?`, `user?`): `any`

Builds a MongoDB compatible query object for the given criteria. Query params can have a value containing a
conditional operator to apply for the search. The operator is encoded with the format `op(value)`. The following
operators are supported:

- `eq` - Returns matches whose parameter exactly matches of the given value. e.g. `param = value`
- `gt` - Returns matches whose parameter is greater than the given value. e.g. `param > value`
- `gte` - Returns matches whose parameter is greater than or equal to the given value. e.g. `param >= value`
- `in` - Returns matches whose parameter includes one of the given values. e.g. `param in ('value1', 'value2', 'value3', ...)`
- `like` - Returns matches whose parameter is lexographically similar to the given value. `param like value`
- `lt` - Returns matches whose parameter is less than the given value. e.g. `param < value`
- `lte` - Returns matches whose parameter is less than or equal to than the given value. e.g. `param < value`
- `not` - Returns matches whose parameter is not equal to the given value. e.g. `param not value`
- `range` - Returns matches whose parameter is greater than or equal to first given value and less than or equal to the second. e.g. `param between(1,100)`

When no operator is provided the comparison will always be evaluated as `eq`.

NOTE: The result of this function is only compatible with the `aggregate()` function.

#### Parameters

| Name           | Type      | Default value | Description                                                                                                                  |
| :------------- | :-------- | :------------ | :--------------------------------------------------------------------------------------------------------------------------- |
| `modelClass`   | `any`     | `undefined`   | The class definition of the data model to build a search query for.                                                          |
| `params?`      | `any`     | `undefined`   | The URI parameters for the endpoint that was requested.                                                                      |
| `queryParams?` | `any`     | `undefined`   | The URI query parameters that were included in the request.                                                                  |
| `exactMatch`   | `boolean` | `false`       | Set to true to create a query where parameters are to be matched exactly, otherwise set to false to use a 'contains' search. |
| `user?`        | `any`     | `undefined`   | The user that is performing the request.                                                                                     |

#### Returns

`any`

The TypeORM compatible query object.

#### Defined in

composer-service-core/src/models/ModelUtils.ts:540

---

### buildSearchQuerySQL

▸ **buildSearchQuerySQL**(`modelClass`, `params?`, `queryParams?`, `exactMatch?`, `user?`): `any`

Builds a TypeORM compatible query object for the given criteria. Query params can have a value containing a
conditional operator to apply for the search. The operator is encoded with the format `op(value)`. The following
operators are supported:

- `eq` - Returns matches whose parameter exactly matches of the given value. e.g. `param = value`
- `gt` - Returns matches whose parameter is greater than the given value. e.g. `param > value`
- `gte` - Returns matches whose parameter is greater than or equal to the given value. e.g. `param >= value`
- `in` - Returns matches whose parameter includes one of the given values. e.g. `param in ('value1', 'value2', 'value3', ...)`
- `like` - Returns matches whose parameter is lexographically similar to the given value. `param like value`
- `lt` - Returns matches whose parameter is less than the given value. e.g. `param < value`
- `lte` - Returns matches whose parameter is less than or equal to than the given value. e.g. `param < value`
- `not` - Returns matches whose parameter is not equal to the given value. e.g. `param not value`
- `range` - Returns matches whose parameter is greater than or equal to first given value and less than or equal to the second. e.g. `param between(1,100)`

When no operator is provided the comparison will always be evaluated as `eq`.

#### Parameters

| Name           | Type      | Default value | Description                                                                                                                  |
| :------------- | :-------- | :------------ | :--------------------------------------------------------------------------------------------------------------------------- |
| `modelClass`   | `any`     | `undefined`   | The class definition of the data model to build a search query for.                                                          |
| `params?`      | `any`     | `undefined`   | The URI parameters for the endpoint that was requested.                                                                      |
| `queryParams?` | `any`     | `undefined`   | The URI query parameters that were included in the request.                                                                  |
| `exactMatch`   | `boolean` | `false`       | Set to true to create a query where parameters are to be matched exactly, otherwise set to false to use a 'contains' search. |
| `user?`        | `any`     | `undefined`   | The user that is performing the request.                                                                                     |

#### Returns

`any`

The TypeORM compatible query object.

#### Defined in

composer-service-core/src/models/ModelUtils.ts:400

---

### getIdPropertyNames

▸ **getIdPropertyNames**(`modelClass`): `string`[]

Retrieves a list of all of the specified class's properties that have the

#### Parameters

| Name         | Type  | Description                                          |
| :----------- | :---- | :--------------------------------------------------- |
| `modelClass` | `any` | The class definition to search for identifiers from. |

#### Returns

`string`[]

The list of all property names that have the

**`Identifier`**

decorator applied.

**`Identifier`**

decorator applied.

#### Defined in

composer-service-core/src/models/ModelUtils.ts:43

---

### getQueryParamValue

▸ **getQueryParamValue**(`param`): `any`

Given a string containing a parameter value and/or a comparison operation return a TypeORM compatible find value.
e.g.
Given the string "myvalue" will return an Eq("myvalue") object.
Given the string "Like(myvalue)" will return an Like("myvalue") object.

#### Parameters

| Name    | Type  |
| :------ | :---- |
| `param` | `any` |

#### Returns

`any`

#### Defined in

composer-service-core/src/models/ModelUtils.ts:174

---

### getQueryParamValueMongo

▸ **getQueryParamValueMongo**(`param`): `any`

Given a string containing a parameter value and/or a comparison operation return a MongoDB compatible find value.
e.g.
Given the string "myvalue" will return an `"myvalue"` object.
Given the string "not(myvalue)" will return an `{ $not: "myvalue" }` object.

#### Parameters

| Name    | Type  |
| :------ | :---- |
| `param` | `any` |

#### Returns

`any`

#### Defined in

composer-service-core/src/models/ModelUtils.ts:253

---

### loadModels

▸ **loadModels**(`src`, `result?`): `Promise`\<`Map`\<`string`, `any`\>\>

Loads all model schema files from the specified path and returns a map containing all the definitions.

#### Parameters

| Name     | Type                     | Description                          |
| :------- | :----------------------- | :----------------------------------- |
| `src`    | `string`                 | The path to the model files to load. |
| `result` | `Map`\<`string`, `any`\> | -                                    |

#### Returns

`Promise`\<`Map`\<`string`, `any`\>\>

A map containing of all loaded model names to their class definitions.

#### Defined in

composer-service-core/src/models/ModelUtils.ts:674
