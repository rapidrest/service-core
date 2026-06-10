[@rapidrest/service-core](../README.md) / [Exports](../modules.md) / ModelDecorators

# Namespace: ModelDecorators

## Table of contents

### Functions

- [Cache](ModelDecorators.md#cache)
- [Identifier](ModelDecorators.md#identifier)
- [Model](ModelDecorators.md#model)
- [Shard](ModelDecorators.md#shard)
- [TrackChanges](ModelDecorators.md#trackchanges)

## Functions

### Cache

▸ **Cache**(`ttl?`): (`target`: `any`) => `void`

Indicates that the class is cacheable with the specified TTL.

#### Parameters

| Name  | Type     | Default value | Description                                                                   |
| :---- | :------- | :------------ | :---------------------------------------------------------------------------- |
| `ttl` | `number` | `30`          | The time, in seconds, that an object will be cached before being invalidated. |

#### Returns

`fn`

▸ (`target`): `void`

##### Parameters

| Name     | Type  |
| :------- | :---- |
| `target` | `any` |

##### Returns

`void`

#### Defined in

composer-service-core/src/decorators/ModelDecorators.ts:11

---

### Identifier

▸ **Identifier**(`target`, `propertyKey`): `void`

Apply this to a property that is considered a unique identifier.

#### Parameters

| Name          | Type                 |
| :------------ | :------------------- |
| `target`      | `any`                |
| `propertyKey` | `string` \| `symbol` |

#### Returns

`void`

#### Defined in

composer-service-core/src/decorators/ModelDecorators.ts:25

---

### Model

▸ **Model**(`datastore`): (`target`: `any`) => `void`

Indicates that the class describes an entity that will be persisted in the datastore with the given name.

#### Parameters

| Name        | Type     | Description                                                        |
| :---------- | :------- | :----------------------------------------------------------------- |
| `datastore` | `string` | The name of the datastore to store records of the decorated class. |

#### Returns

`fn`

▸ (`target`): `void`

##### Parameters

| Name     | Type  |
| :------- | :---- |
| `target` | `any` |

##### Returns

`void`

#### Defined in

composer-service-core/src/decorators/ModelDecorators.ts:40

---

### Shard

▸ **Shard**(`config?`): (`target`: `any`) => `void`

Indicates that the class describes an entity that will be persisted in a sharded database collection.

Note: Only supported by MongoDB.

#### Parameters

| Name     | Type  | Description                                                                                                                    |
| :------- | :---- | :----------------------------------------------------------------------------------------------------------------------------- |
| `config` | `any` | The sharding configuration to pass to the database server. Default value is `{ key: { uid: 1 }, unique: false, options: {} }`. |

#### Returns

`fn`

▸ (`target`): `void`

##### Parameters

| Name     | Type  |
| :------- | :---- |
| `target` | `any` |

##### Returns

`void`

#### Defined in

composer-service-core/src/decorators/ModelDecorators.ts:58

---

### TrackChanges

▸ **TrackChanges**(`versions?`): (`target`: `any`) => `void`

Indicates that the class will track changes for each document update limited to the specified number of versions.

#### Parameters

| Name       | Type     | Default value | Description                                                                                                                     |
| :--------- | :------- | :------------ | :------------------------------------------------------------------------------------------------------------------------------ |
| `versions` | `number` | `-1`          | The number of versions that will be tracked for each document change. Set to `-1` to store all versions. Default value is `-1`. |

#### Returns

`fn`

▸ (`target`): `void`

##### Parameters

| Name     | Type  |
| :------- | :---- |
| `target` | `any` |

##### Returns

`void`

#### Defined in

composer-service-core/src/decorators/ModelDecorators.ts:75
