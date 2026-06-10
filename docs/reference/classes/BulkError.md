[@rapidrest/service-core](../README.md) / [Exports](../modules.md) / BulkError

# Class: BulkError

An error take that takes an array of other errors.

## Hierarchy

- `ApiError`

    ↳ **`BulkError`**

## Table of contents

### Constructors

- [constructor](BulkError.md#constructor)

### Properties

- [code](BulkError.md#code)
- [errors](BulkError.md#errors)
- [message](BulkError.md#message)
- [name](BulkError.md#name)
- [stack](BulkError.md#stack)
- [status](BulkError.md#status)
- [prepareStackTrace](BulkError.md#preparestacktrace)
- [stackTraceLimit](BulkError.md#stacktracelimit)

### Methods

- [captureStackTrace](BulkError.md#capturestacktrace)

## Constructors

### constructor

• **new BulkError**(`errs`, `code`, `status`, `message?`): [`BulkError`](BulkError.md)

#### Parameters

| Name       | Type                  |
| :--------- | :-------------------- |
| `errs`     | (`null` \| `Error`)[] |
| `code`     | `string`              |
| `status`   | `number`              |
| `message?` | `string`              |

#### Returns

[`BulkError`](BulkError.md)

#### Overrides

ApiError.constructor

#### Defined in

composer-service-core/src/BulkError.ts:17

## Properties

### code

• **code**: `string`

The unique code of the error.

#### Inherited from

ApiError.code

#### Defined in

composer-core/dist/types/ApiError.d.ts:8

---

### errors

• `Readonly` **errors**: (`null` \| `Error`)[] = `[]`

The list of errors that have been thrown.

#### Defined in

composer-service-core/src/BulkError.ts:10

---

### message

• **message**: `string`

#### Inherited from

ApiError.message

#### Defined in

composer-service-core/node_modules/typescript/lib/lib.es5.d.ts:1029

---

### name

• **name**: `string`

#### Inherited from

ApiError.name

#### Defined in

composer-service-core/node_modules/typescript/lib/lib.es5.d.ts:1028

---

### stack

• `Optional` **stack**: `string`

#### Inherited from

ApiError.stack

#### Defined in

composer-service-core/node_modules/typescript/lib/lib.es5.d.ts:1030

---

### status

• `Readonly` **status**: `number` = `0`

The response status of the error.

#### Overrides

ApiError.status

#### Defined in

composer-service-core/src/BulkError.ts:15

---

### prepareStackTrace

▪ `Static` `Optional` **prepareStackTrace**: (`err`: `Error`, `stackTraces`: `CallSite`[]) => `any`

Optional override for formatting stack traces

**`See`**

https://v8.dev/docs/stack-trace-api#customizing-stack-traces

#### Type declaration

▸ (`err`, `stackTraces`): `any`

##### Parameters

| Name          | Type         |
| :------------ | :----------- |
| `err`         | `Error`      |
| `stackTraces` | `CallSite`[] |

##### Returns

`any`

#### Inherited from

ApiError.prepareStackTrace

#### Defined in

composer-service-core/node_modules/@types/node/globals.d.ts:28

---

### stackTraceLimit

▪ `Static` **stackTraceLimit**: `number`

#### Inherited from

ApiError.stackTraceLimit

#### Defined in

composer-service-core/node_modules/@types/node/globals.d.ts:30

## Methods

### captureStackTrace

▸ **captureStackTrace**(`targetObject`, `constructorOpt?`): `void`

Create .stack property on a target object

#### Parameters

| Name              | Type       |
| :---------------- | :--------- |
| `targetObject`    | `object`   |
| `constructorOpt?` | `Function` |

#### Returns

`void`

#### Inherited from

ApiError.captureStackTrace

#### Defined in

composer-service-core/node_modules/@types/node/globals.d.ts:21
