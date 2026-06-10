[@rapidrest/service-core](../README.md) / [Exports](../modules.md) / JWTStrategy

# Class: JWTStrategy

Passport strategy for handling JSON Web Token authentication. This strategy performs JWT verification and will
search for a token by one of the following methods (in order of precedence).

- Cookie
- Query Parameter
- Header

**`Author`**

Jean-Philippe Steinmetz

## Hierarchy

- `Strategy`

    ↳ **`JWTStrategy`**

## Table of contents

### Constructors

- [constructor](JWTStrategy.md#constructor)

### Properties

- [options](JWTStrategy.md#options)

### Methods

- [authenticate](JWTStrategy.md#authenticate)
- [error](JWTStrategy.md#error)
- [fail](JWTStrategy.md#fail)
- [pass](JWTStrategy.md#pass)
- [redirect](JWTStrategy.md#redirect)
- [success](JWTStrategy.md#success)

## Constructors

### constructor

• **new JWTStrategy**(`options`): [`JWTStrategy`](JWTStrategy.md)

#### Parameters

| Name      | Type                                          |
| :-------- | :-------------------------------------------- |
| `options` | [`JWTStrategyOptions`](JWTStrategyOptions.md) |

#### Returns

[`JWTStrategy`](JWTStrategy.md)

#### Overrides

Strategy.constructor

#### Defined in

composer-service-core/src/passportjs/JWTStrategy.ts:46

## Properties

### options

• `Private` **options**: [`JWTStrategyOptions`](JWTStrategyOptions.md)

#### Defined in

composer-service-core/src/passportjs/JWTStrategy.ts:44

## Methods

### authenticate

▸ **authenticate**(`req`, `options?`): `void`

#### Parameters

| Name       | Type                                                                                   |
| :--------- | :------------------------------------------------------------------------------------- |
| `req`      | `Request`\<`ParamsDictionary`, `any`, `any`, `ParsedQs`, `Record`\<`string`, `any`\>\> |
| `options?` | `any`                                                                                  |

#### Returns

`void`

#### Overrides

Strategy.authenticate

#### Defined in

composer-service-core/src/passportjs/JWTStrategy.ts:52

---

### error

▸ **error**(`err`): `void`

Internal error while performing authentication.

Strategies should call this function when an internal error occurs
during the process of performing authentication; for example, if the
user directory is not available.

#### Parameters

| Name  | Type    |
| :---- | :------ |
| `err` | `Error` |

#### Returns

`void`

**`Api`**

public

#### Inherited from

Strategy.error

#### Defined in

composer-service-core/node_modules/@types/passport-strategy/index.d.ts:90

---

### fail

▸ **fail**(`challenge`, `status`): `void`

Fail authentication, with optional `challenge` and `status`, defaulting
to 401.

Strategies should call this function to fail an authentication attempt.

#### Parameters

| Name        | Type     | Description                                               |
| :---------- | :------- | :-------------------------------------------------------- |
| `challenge` | `any`    | (Can also be an object with 'message' and 'type' fields). |
| `status`    | `number` |                                                           |

#### Returns

`void`

**`Api`**

public

#### Inherited from

Strategy.fail

#### Defined in

composer-service-core/node_modules/@types/passport-strategy/index.d.ts:54

▸ **fail**(`status`): `void`

#### Parameters

| Name     | Type     |
| :------- | :------- |
| `status` | `number` |

#### Returns

`void`

#### Inherited from

Strategy.fail

#### Defined in

composer-service-core/node_modules/@types/passport-strategy/index.d.ts:55

---

### pass

▸ **pass**(): `void`

Pass without making a success or fail decision.

Under most circumstances, Strategies should not need to call this
function. It exists primarily to allow previous authentication state
to be restored, for example from an HTTP session.

#### Returns

`void`

**`Api`**

public

#### Inherited from

Strategy.pass

#### Defined in

composer-service-core/node_modules/@types/passport-strategy/index.d.ts:78

---

### redirect

▸ **redirect**(`url`, `status?`): `void`

Redirect to `url` with optional `status`, defaulting to 302.

Strategies should call this function to redirect the user (via their
user agent) to a third-party website for authentication.

#### Parameters

| Name      | Type     |
| :-------- | :------- |
| `url`     | `string` |
| `status?` | `number` |

#### Returns

`void`

**`Api`**

public

#### Inherited from

Strategy.redirect

#### Defined in

composer-service-core/node_modules/@types/passport-strategy/index.d.ts:67

---

### success

▸ **success**(`user`, `info?`): `void`

Authenticate `user`, with optional `info`.

Strategies should call this function to successfully authenticate a
user. `user` should be an object supplied by the application after it
has been given an opportunity to verify credentials. `info` is an
optional argument containing additional user information. This is
useful for third-party authentication strategies to pass profile
details.

#### Parameters

| Name    | Type  |
| :------ | :---- |
| `user`  | `any` |
| `info?` | `any` |

#### Returns

`void`

**`Api`**

public

#### Inherited from

Strategy.success

#### Defined in

composer-service-core/node_modules/@types/passport-strategy/index.d.ts:42
