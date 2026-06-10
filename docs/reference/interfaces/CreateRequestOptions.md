[@rapidrest/service-core](../README.md) / [Exports](../modules.md) / CreateRequestOptions

# Interface: CreateRequestOptions

The set of options required by create request handlers.

## Hierarchy

- [`RequestOptions`](RequestOptions.md)

    ↳ **`CreateRequestOptions`**

## Table of contents

### Properties

- [req](CreateRequestOptions.md#req)
- [res](CreateRequestOptions.md#res)
- [user](CreateRequestOptions.md#user)

## Properties

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
