[@rapidrest/service-core](../README.md) / [Exports](../modules.md) / OpenAPIRoute

# Class: OpenAPIRoute

The `OpenAPIController` provides a default route to `/openapi.json` that exposes a provided OpenAPI
specification to requesting clients.

**`Author`**

Jean-Philippe Steinmetz

## Table of contents

### Constructors

- [constructor](OpenAPIRoute.md#constructor)

### Properties

- [apiSpec](OpenAPIRoute.md#apispec)

### Methods

- [getHTML](OpenAPIRoute.md#gethtml)
- [getJSON](OpenAPIRoute.md#getjson)
- [getYAML](OpenAPIRoute.md#getyaml)

## Constructors

### constructor

• **new OpenAPIRoute**(): [`OpenAPIRoute`](OpenAPIRoute.md)

#### Returns

[`OpenAPIRoute`](OpenAPIRoute.md)

## Properties

### apiSpec

• `Private` **apiSpec**: [`OpenApiSpec`](OpenApiSpec.md)

The underlying OpenAPI specification.

#### Defined in

composer-service-core/src/routes/OpenAPIRoute.ts:20

## Methods

### getHTML

▸ **getHTML**(): `string`

#### Returns

`string`

#### Defined in

composer-service-core/src/routes/OpenAPIRoute.ts:26

---

### getJSON

▸ **getJSON**(): `string`

#### Returns

`string`

#### Defined in

composer-service-core/src/routes/OpenAPIRoute.ts:33

---

### getYAML

▸ **getYAML**(): `string`

#### Returns

`string`

#### Defined in

composer-service-core/src/routes/OpenAPIRoute.ts:41
