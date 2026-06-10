[@rapidrest/service-core](../README.md) / [Exports](../modules.md) / RepoUtils

# Class: RepoUtils

**`Author`**

Jean-Philippe Steinmetz

## Table of contents

### Constructors

- [constructor](RepoUtils.md#constructor)

### Methods

- [preprocessBeforeSave](RepoUtils.md#preprocessbeforesave)
- [preprocessBeforeUpdate](RepoUtils.md#preprocessbeforeupdate)

## Constructors

### constructor

• **new RepoUtils**(): [`RepoUtils`](RepoUtils.md)

#### Returns

[`RepoUtils`](RepoUtils.md)

## Methods

### preprocessBeforeSave

▸ **preprocessBeforeSave**\<`T`\>(`repo`, `obj`, `tracked`): `Promise`\<`T`\>

Verify object does not exist and update required fields for BaseEntity

#### Type parameters

| Name | Type                                                                       |
| :--- | :------------------------------------------------------------------------- |
| `T`  | extends [`BaseEntity`](BaseEntity.md) \| [`SimpleEntity`](SimpleEntity.md) |

#### Parameters

| Name      | Type                                            | Description                                                |
| :-------- | :---------------------------------------------- | :--------------------------------------------------------- |
| `repo`    | `Repository`\<`T`\> \| `MongoRepository`\<`T`\> | Repository used to verify no existing object               |
| `obj`     | `T`                                             | Object that exentds BaseEntity or SimpleEntity             |
| `tracked` | `boolean`                                       | Indicates if the object type uses version tracking or not. |

#### Returns

`Promise`\<`T`\>

#### Defined in

composer-service-core/src/models/RepoUtils.ts:22

---

### preprocessBeforeUpdate

▸ **preprocessBeforeUpdate**\<`T`\>(`repo`, `modelClass`, `obj`, `old?`): `Promise`\<`T`\>

Verify object does exist and update required fields

#### Type parameters

| Name | Type                                                                       |
| :--- | :------------------------------------------------------------------------- |
| `T`  | extends [`BaseEntity`](BaseEntity.md) \| [`SimpleEntity`](SimpleEntity.md) |

#### Parameters

| Name         | Type                                            | Description                                    |
| :----------- | :---------------------------------------------- | :--------------------------------------------- |
| `repo`       | `Repository`\<`T`\> \| `MongoRepository`\<`T`\> | Repository used to verify no existing object   |
| `modelClass` | `any`                                           | -                                              |
| `obj`        | `T`                                             | Object that exentds BaseEntity or SimpleEntity |
| `old?`       | `null` \| `T`                                   | The original object to validate against        |

#### Returns

`Promise`\<`T`\>

#### Defined in

composer-service-core/src/models/RepoUtils.ts:63
