[@rapidrest/service-core](../README.md) / [Exports](../modules.md) / NetUtils

# Class: NetUtils

Provides common utilities and functions for working with networking related problems.

**`Author`**

Jean-Philippe Steinmetz <rapidrests@gmail.com>

## Table of contents

### Constructors

- [constructor](NetUtils.md#constructor)

### Methods

- [getIPAddress](NetUtils.md#getipaddress)
- [lookupIPAddress](NetUtils.md#lookupipaddress)

## Constructors

### constructor

• **new NetUtils**(): [`NetUtils`](NetUtils.md)

#### Returns

[`NetUtils`](NetUtils.md)

## Methods

### getIPAddress

▸ **getIPAddress**(`urlOrRequest`): `undefined` \| `string`

Extracts the IP address from a given url or HTTP request.

#### Parameters

| Name           | Type                                                                                               | Description                                     |
| :------------- | :------------------------------------------------------------------------------------------------- | :---------------------------------------------- |
| `urlOrRequest` | `string` \| `Request`\<`ParamsDictionary`, `any`, `any`, `ParsedQs`, `Record`\<`string`, `any`\>\> | The url or HTTP request to extract the IP from. |

#### Returns

`undefined` \| `string`

A `string` containing the IP address if found, otherwise `undefined`.

#### Defined in

composer-service-core/src/NetUtils.ts:51

---

### lookupIPAddress

▸ **lookupIPAddress**(`url`, `family?`): `Promise`\<`undefined` \| `string`\>

Performs DNS lookup of the IP address from a given url.

#### Parameters

| Name     | Type     | Default value | Description                    |
| :------- | :------- | :------------ | :----------------------------- |
| `url`    | `string` | `undefined`   | The url to lookup the IP from. |
| `family` | `number` | `4`           | ip family used for dns lookup  |

#### Returns

`Promise`\<`undefined` \| `string`\>

A `string` containing the IP address if found, otherwise `undefined`.

#### Defined in

composer-service-core/src/NetUtils.ts:20
