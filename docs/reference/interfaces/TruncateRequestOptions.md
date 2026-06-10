[@rapidrest/service-core](../README.md) / [Exports](../modules.md) / TruncateRequestOptions

# Interface: TruncateRequestOptions

The set of options required by truncate request handlers.

## Hierarchy

- [`DeleteRequestOptions`](DeleteRequestOptions.md)

    ↳ **`TruncateRequestOptions`**

## Table of contents

### Properties

- [params](TruncateRequestOptions.md#params)
- [productUid](TruncateRequestOptions.md#productuid)
- [purge](TruncateRequestOptions.md#purge)
- [query](TruncateRequestOptions.md#query)
- [req](TruncateRequestOptions.md#req)
- [res](TruncateRequestOptions.md#res)
- [user](TruncateRequestOptions.md#user)
- [version](TruncateRequestOptions.md#version)

## Properties

### params

• **params**: `any`

The list of URL parameters to use in the search.

#### Defined in

composer-service-core/src/routes/ModelRoute.ts:65

---

### productUid

• `Optional` **productUid**: `string`

The desired product uid of the resource to delete.

#### Inherited from

[DeleteRequestOptions](DeleteRequestOptions.md).[productUid](DeleteRequestOptions.md#productuid)

#### Defined in

composer-service-core/src/routes/ModelRoute.ts:43

---

### purge

• `Optional` **purge**: `boolean`

Set to true to permanently remove the object from the database (if applicable).

#### Inherited from

[DeleteRequestOptions](DeleteRequestOptions.md).[purge](DeleteRequestOptions.md#purge)

#### Defined in

composer-service-core/src/routes/ModelRoute.ts:45

---

### query

• **query**: `any`

The list of query parameters to use in the search.

#### Defined in

composer-service-core/src/routes/ModelRoute.ts:67

---

### req

• `Optional` **req**: `Request`\<`ParamsDictionary`, `any`, `any`, `ParsedQs`, `Record`\<`string`, `any`\>\>

The originating client request.

#### Inherited from

[DeleteRequestOptions](DeleteRequestOptions.md).[req](DeleteRequestOptions.md#req)

#### Defined in

composer-service-core/src/routes/ModelRoute.ts:25

---

### res

• `Optional` **res**: `Response`\<`any`, `Record`\<`string`, `any`\>\>

The outgoing client response.

#### Inherited from

[DeleteRequestOptions](DeleteRequestOptions.md).[res](DeleteRequestOptions.md#res)

#### Defined in

composer-service-core/src/routes/ModelRoute.ts:27

---

### user

• `Optional` **user**: `any`

The authenticated user making the request.

#### Inherited from

[DeleteRequestOptions](DeleteRequestOptions.md).[user](DeleteRequestOptions.md#user)

#### Defined in

composer-service-core/src/routes/ModelRoute.ts:29

---

### version

• `Optional` **version**: `string` \| `number`

The desired version number of the resource to delete.

#### Inherited from

[DeleteRequestOptions](DeleteRequestOptions.md).[version](DeleteRequestOptions.md#version)

#### Defined in

composer-service-core/src/routes/ModelRoute.ts:47
