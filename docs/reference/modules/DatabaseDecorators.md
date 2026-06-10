[@rapidrest/service-core](../README.md) / [Exports](../modules.md) / DatabaseDecorators

# Namespace: DatabaseDecorators

## Table of contents

### Functions

- [MongoRepository](DatabaseDecorators.md#mongorepository)
- [RedisConnection](DatabaseDecorators.md#redisconnection)
- [Repository](DatabaseDecorators.md#repository)

## Functions

### MongoRepository

▸ **MongoRepository**(`type`): (`target`: `any`, `propertyKey`: `string` \| `symbol`) => `void`

Apply this to a property to have the TypeORM `MongoRepository` for the given entity type injected at instantiation.

#### Parameters

| Name   | Type  | Description                                        |
| :----- | :---- | :------------------------------------------------- |
| `type` | `any` | The entity type whose repository will be injected. |

#### Returns

`fn`

▸ (`target`, `propertyKey`): `void`

##### Parameters

| Name          | Type                 |
| :------------ | :------------------- |
| `target`      | `any`                |
| `propertyKey` | `string` \| `symbol` |

##### Returns

`void`

#### Defined in

composer-service-core/src/decorators/DatabaseDecorators.ts:10

---

### RedisConnection

▸ **RedisConnection**(`name`): (`target`: `any`, `propertyKey`: `string` \| `symbol`) => `void`

Apply this to a property to have the `Redis` connection injected at instantiation.

#### Parameters

| Name   | Type     | Description                                    |
| :----- | :------- | :--------------------------------------------- |
| `name` | `string` | The name of the database connection to inject. |

#### Returns

`fn`

▸ (`target`, `propertyKey`): `void`

##### Parameters

| Name          | Type                 |
| :------------ | :------------------- |
| `target`      | `any`                |
| `propertyKey` | `string` \| `symbol` |

##### Returns

`void`

#### Defined in

composer-service-core/src/decorators/DatabaseDecorators.ts:44

---

### Repository

▸ **Repository**(`type`): (`target`: `any`, `propertyKey`: `string` \| `symbol`) => `void`

Apply this to a property to have the TypeORM `Repository` for the given entity type injected at instantiation.

#### Parameters

| Name   | Type  | Description                                        |
| :----- | :---- | :------------------------------------------------- |
| `type` | `any` | The entity type whose repository will be injected. |

#### Returns

`fn`

▸ (`target`, `propertyKey`): `void`

##### Parameters

| Name          | Type                 |
| :------------ | :------------------- |
| `target`      | `any`                |
| `propertyKey` | `string` \| `symbol` |

##### Returns

`void`

#### Defined in

composer-service-core/src/decorators/DatabaseDecorators.ts:27
