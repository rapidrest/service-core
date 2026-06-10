[@rapidrest/service-core](../README.md) / [Exports](../modules.md) / RequestOptions

# Interface: RequestOptions

The set of options required by all request handlers.

## Hierarchy

- **`RequestOptions`**

    ↳ [`CreateRequestOptions`](CreateRequestOptions.md)

    ↳ [`DeleteRequestOptions`](DeleteRequestOptions.md)

    ↳ [`FindRequestOptions`](FindRequestOptions.md)

    ↳ [`UpdateRequestOptions`](UpdateRequestOptions.md)

## Table of contents

### Properties

- [req](RequestOptions.md#req)
- [res](RequestOptions.md#res)
- [user](RequestOptions.md#user)

## Properties

### req

• `Optional` **req**: `Request`\<`ParamsDictionary`, `any`, `any`, `ParsedQs`, `Record`\<`string`, `any`\>\>

The originating client request.

#### Defined in

composer-service-core/src/routes/ModelRoute.ts:25

---

### res

• `Optional` **res**: `Response`\<`any`, `Record`\<`string`, `any`\>\>

The outgoing client response.

#### Defined in

composer-service-core/src/routes/ModelRoute.ts:27

---

### user

• `Optional` **user**: `any`

The authenticated user making the request.

#### Defined in

composer-service-core/src/routes/ModelRoute.ts:29
