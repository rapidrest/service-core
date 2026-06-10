[@rapidrest/service-core](../README.md) / [Exports](../modules.md) / JWTStrategyOptions

# Class: JWTStrategyOptions

Describes the configuration options that can be used to initialize JWTStrategy.

**`Author`**

Jean-Philippe Steinmetz

## Table of contents

### Constructors

- [constructor](JWTStrategyOptions.md#constructor)

### Properties

- [allowFailure](JWTStrategyOptions.md#allowfailure)
- [config](JWTStrategyOptions.md#config)
- [cookieName](JWTStrategyOptions.md#cookiename)
- [cookieSecure](JWTStrategyOptions.md#cookiesecure)
- [headerKey](JWTStrategyOptions.md#headerkey)
- [headerScheme](JWTStrategyOptions.md#headerscheme)
- [queryKey](JWTStrategyOptions.md#querykey)

## Constructors

### constructor

• **new JWTStrategyOptions**(): [`JWTStrategyOptions`](JWTStrategyOptions.md)

#### Returns

[`JWTStrategyOptions`](JWTStrategyOptions.md)

## Properties

### allowFailure

• **allowFailure**: `boolean` = `false`

Set to true to allow a failure to be processed as a success, otherwise set to false. Default value is `false`.

#### Defined in

composer-service-core/src/passportjs/JWTStrategy.ts:19

---

### config

• **config**: `JWTUtilsConfig`

The configuration options to pass to the JWTUtils library during token verification.

#### Defined in

composer-service-core/src/passportjs/JWTStrategy.ts:21

---

### cookieName

• **cookieName**: `string` = `"jwt"`

The name of the cookie to retrieve the token from when using cookie based authentication. Default value is `jwt`.

#### Defined in

composer-service-core/src/passportjs/JWTStrategy.ts:27

---

### cookieSecure

• **cookieSecure**: `boolean` = `false`

The name of the secured cookie to retreive the token from when using cookie based authentication.

#### Defined in

composer-service-core/src/passportjs/JWTStrategy.ts:29

---

### headerKey

• **headerKey**: `string` = `"authorization"`

The name of the header to look for when performing header based authentication. Default value is `Authorization`.

#### Defined in

composer-service-core/src/passportjs/JWTStrategy.ts:23

---

### headerScheme

• **headerScheme**: `string` = `"(jwt|bearer)"`

The authorization scheme type when using header based authentication. Default value is `jwt`.

#### Defined in

composer-service-core/src/passportjs/JWTStrategy.ts:25

---

### queryKey

• **queryKey**: `string` = `"jwt_token"`

The name of the requesty query parameter to retreive the token from when using query based authentication. Default value is `jwt_token`.

#### Defined in

composer-service-core/src/passportjs/JWTStrategy.ts:31
