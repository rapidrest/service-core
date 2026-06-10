[@rapidrest/service-core](../README.md) / [Exports](../modules.md) / UpdateRequestOptions

# Interface: UpdateRequestOptions

The set of options required by update request handlers.

## Hierarchy

- [`RequestOptions`](RequestOptions.md)

    ↳ **`UpdateRequestOptions`**

## Table of contents

### Properties

- [productUid](UpdateRequestOptions.md#productuid)
- [req](UpdateRequestOptions.md#req)
- [res](UpdateRequestOptions.md#res)
- [user](UpdateRequestOptions.md#user)
- [version](UpdateRequestOptions.md#version)

## Properties

### productUid

• `Optional` **productUid**: `string`

The desired product uid of the resource to update.

#### Defined in

composer-service-core/src/routes/ModelRoute.ts:75

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

The desired version number of the resource to update.

#### Defined in

composer-service-core/src/routes/ModelRoute.ts:77
