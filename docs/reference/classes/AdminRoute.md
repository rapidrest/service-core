[@rapidrest/service-core](../README.md) / [Exports](../modules.md) / AdminRoute

# Class: AdminRoute

The `AdminRoute` provides a default `/admin` endpoint that gives trusted users the following abilities:

- Clear cache via `GET /admin/clear-cache`
- Live tail the service logs via `GET /admin/logs`
- Retrieve service dependencies via `GET /admin/dependencies`
- Retrieve service release notes via `GET /admin/release-notes`
- Restart the service via `GET /admin/restart`

**`Author`**

Jean-Philippe Steinmetz

## Table of contents

### Constructors

- [constructor](AdminRoute.md#constructor)

### Properties

- [activeSockets](AdminRoute.md#activesockets)
- [cacheClient](AdminRoute.md#cacheclient)
- [cacheConnConfig](AdminRoute.md#cacheconnconfig)
- [logger](AdminRoute.md#logger)
- [logsConnConfig](AdminRoute.md#logsconnconfig)
- [redisClient](AdminRoute.md#redisclient)
- [releaseNotes](AdminRoute.md#releasenotes)
- [serviceName](AdminRoute.md#servicename)
- [trustedRoles](AdminRoute.md#trustedroles)

### Methods

- [clearCache](AdminRoute.md#clearcache)
- [get](AdminRoute.md#get)
- [init](AdminRoute.md#init)
- [inspect](AdminRoute.md#inspect)
- [logs](AdminRoute.md#logs)
- [restart](AdminRoute.md#restart)

## Constructors

### constructor

• **new AdminRoute**(`releaseNotes`): [`AdminRoute`](AdminRoute.md)

Constructs a new `ReleaseNotesRoute` object with the specified defaults.

#### Parameters

| Name           | Type     | Description                                     |
| :------------- | :------- | :---------------------------------------------- |
| `releaseNotes` | `string` | The ReleaseNotes specification object to serve. |

#### Returns

[`AdminRoute`](AdminRoute.md)

#### Defined in

composer-service-core/src/routes/AdminRoute.ts:81

## Properties

### activeSockets

• `Private` **activeSockets**: `Map`\<`string`, `any`[]\>

A map of user uid's to active sockets.

#### Defined in

composer-service-core/src/routes/AdminRoute.ts:51

---

### cacheClient

• `Protected` `Optional` **cacheClient**: `Redis`

#### Defined in

composer-service-core/src/routes/AdminRoute.ts:54

---

### cacheConnConfig

• `Private` **cacheConnConfig**: `any`

#### Defined in

composer-service-core/src/routes/AdminRoute.ts:57

---

### logger

• `Private` **logger**: `any`

#### Defined in

composer-service-core/src/routes/AdminRoute.ts:60

---

### logsConnConfig

• `Private` **logsConnConfig**: `any`

#### Defined in

composer-service-core/src/routes/AdminRoute.ts:63

---

### redisClient

• `Private` `Optional` **redisClient**: `Redis`

#### Defined in

composer-service-core/src/routes/AdminRoute.ts:65

---

### releaseNotes

• `Private` **releaseNotes**: `string`

The underlying ReleaseNotes specification.

#### Defined in

composer-service-core/src/routes/AdminRoute.ts:68

---

### serviceName

• `Private` `Optional` **serviceName**: `string`

#### Defined in

composer-service-core/src/routes/AdminRoute.ts:71

---

### trustedRoles

• `Private` **trustedRoles**: `string`[] = `[]`

#### Defined in

composer-service-core/src/routes/AdminRoute.ts:74

## Methods

### clearCache

▸ **clearCache**(`user?`): `Promise`\<`void`\>

#### Parameters

| Name    | Type      |
| :------ | :-------- |
| `user?` | `JWTUser` |

#### Returns

`Promise`\<`void`\>

#### Defined in

composer-service-core/src/routes/AdminRoute.ts:116

---

### get

▸ **get**(`user?`): `string`

#### Parameters

| Name    | Type      |
| :------ | :-------- |
| `user?` | `JWTUser` |

#### Returns

`string`

#### Defined in

composer-service-core/src/routes/AdminRoute.ts:241

---

### init

▸ **init**(): `Promise`\<`void`\>

#### Returns

`Promise`\<`void`\>

#### Defined in

composer-service-core/src/routes/AdminRoute.ts:86

---

### inspect

▸ **inspect**(`socket`, `user`): `Promise`\<`void`\>

#### Parameters

| Name     | Type        |
| :------- | :---------- |
| `socket` | `WebSocket` |
| `user`   | `JWTUser`   |

#### Returns

`Promise`\<`void`\>

#### Defined in

composer-service-core/src/routes/AdminRoute.ts:141

---

### logs

▸ **logs**(`socket`, `user`): `Promise`\<`void`\>

#### Parameters

| Name     | Type        |
| :------- | :---------- |
| `socket` | `WebSocket` |
| `user`   | `JWTUser`   |

#### Returns

`Promise`\<`void`\>

#### Defined in

composer-service-core/src/routes/AdminRoute.ts:174

---

### restart

▸ **restart**(`user?`): `void`

#### Parameters

| Name    | Type      |
| :------ | :-------- |
| `user?` | `JWTUser` |

#### Returns

`void`

#### Defined in

composer-service-core/src/routes/AdminRoute.ts:253
