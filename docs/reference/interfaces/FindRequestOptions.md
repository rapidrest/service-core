[@rapidrest/service-core](../README.md) / [Exports](../modules.md) / FindRequestOptions

# Interface: FindRequestOptions

The set of options required by search request handlers.

## Hierarchy

- [`RequestOptions`](RequestOptions.md)

    ↳ **`FindRequestOptions`**

## Table of contents

### Properties

- [params](FindRequestOptions.md#params)
- [query](FindRequestOptions.md#query)
- [req](FindRequestOptions.md#req)
- [res](FindRequestOptions.md#res)
- [user](FindRequestOptions.md#user)

## Properties

### params

• `Optional` **params**: `any`

The list of URL parameters to use in the search.

#### Defined in

composer-service-core/src/routes/ModelRoute.ts:55

---

### query

• **query**: `any`

The list of query parameters to use in the search.

#### Defined in

composer-service-core/src/routes/ModelRoute.ts:57

---

### req

• `Optional` **req**: `Request`\<`ParamsDictionary`, `any`, `any`, `ParsedQs`, `Record`\<`string`, `any`\>\>

The originating client request.

#### Inherited from

[RequestOptions](RequestOptions.md).[req](RequestOptions.md#req)

#### Defined in

composer-service-core/src/routes/ModelRoute.ts:25

---

### res

• `Optional` **res**: `Response`\<`any`, `Record`\<`string`, `any`\>\>

The outgoing client response.

#### Inherited from

[RequestOptions](RequestOptions.md).[res](RequestOptions.md#res)

#### Defined in

composer-service-core/src/routes/ModelRoute.ts:27

---

### user

• `Optional` **user**: `any`

The authenticated user making the request.

#### Inherited from

[RequestOptions](RequestOptions.md).[user](RequestOptions.md#user)

#### Defined in

composer-service-core/src/routes/ModelRoute.ts:29
