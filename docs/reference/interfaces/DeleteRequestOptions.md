[@rapidrest/service-core](../README.md) / [Exports](../modules.md) / DeleteRequestOptions

# Interface: DeleteRequestOptions

The set of options required by delete request handlers.

## Hierarchy

- [`RequestOptions`](RequestOptions.md)

    ↳ **`DeleteRequestOptions`**

    ↳↳ [`TruncateRequestOptions`](TruncateRequestOptions.md)

## Table of contents

### Properties

- [productUid](DeleteRequestOptions.md#productuid)
- [purge](DeleteRequestOptions.md#purge)
- [req](DeleteRequestOptions.md#req)
- [res](DeleteRequestOptions.md#res)
- [user](DeleteRequestOptions.md#user)
- [version](DeleteRequestOptions.md#version)

## Properties

### productUid

• `Optional` **productUid**: `string`

The desired product uid of the resource to delete.

#### Defined in

composer-service-core/src/routes/ModelRoute.ts:43

---

### purge

• `Optional` **purge**: `boolean`

Set to true to permanently remove the object from the database (if applicable).

#### Defined in

composer-service-core/src/routes/ModelRoute.ts:45

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

---

### version

• `Optional` **version**: `string` \| `number`

The desired version number of the resource to delete.

#### Defined in

composer-service-core/src/routes/ModelRoute.ts:47
