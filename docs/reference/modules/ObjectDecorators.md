[@rapidrest/service-core](../README.md) / [Exports](../modules.md) / ObjectDecorators

# Namespace: ObjectDecorators

## Table of contents

### Functions

- [Config](ObjectDecorators.md#config)
- [Destroy](ObjectDecorators.md#destroy)
- [Init](ObjectDecorators.md#init)
- [Inject](ObjectDecorators.md#inject)
- [Logger](ObjectDecorators.md#logger)

## Functions

### Config

▸ **Config**(`path?`, `defaultValue?`): (`target`: `any`, `propertyKey`: `string` \| `symbol`) => `void`

Apply this to a property to have a configuration variable be injected at instantiation. If no path is given, the
global configuration object is injected.

#### Parameters

| Name           | Type     | Default value | Description                                                                                                                             |
| :------------- | :------- | :------------ | :-------------------------------------------------------------------------------------------------------------------------------------- |
| `path?`        | `string` | `undefined`   | The path to the configuration variable to inject.                                                                                       |
| `defaultValue` | `any`    | `undefined`   | Set to the desired default value. If `undefined` is specified then an error is thrown if no config variable is found at the given path. |

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

composer-service-core/src/decorators/ObjectDecorators.ts:52

---

### Destroy

▸ **Destroy**(`target`, `propertyKey`): `void`

Apply this to a class function to mark it as a destructor to be called by the `ObjectFactory` during cleanup.

#### Parameters

| Name          | Type     |
| :------------ | :------- |
| `target`      | `any`    |
| `propertyKey` | `string` |

#### Returns

`void`

#### Defined in

composer-service-core/src/decorators/ObjectDecorators.ts:9

---

### Init

▸ **Init**(`target`, `propertyKey`, `descriptor`): `void`

Apply this to a function to be executed once a new object instance has been created and all dependencies injected.
Note: If the decorated function returns a Promise it is not gauranteed to finish execution before the object is
returned during the instantiation process.

#### Parameters

| Name          | Type                 |
| :------------ | :------------------- |
| `target`      | `any`                |
| `propertyKey` | `string`             |
| `descriptor`  | `PropertyDescriptor` |

#### Returns

`void`

#### Defined in

composer-service-core/src/decorators/ObjectDecorators.ts:40

---

### Inject

▸ **Inject**(`type`, `name?`, `...args`): (`target`: `any`, `propertyKey`: `string` \| `symbol`) => `void`

Injects an object instance to the decorated property of the given name and type using the provided arguments
if no object has been created yet.

#### Parameters

| Name      | Type                    | Default value | Description                                                                                                                    |
| :-------- | :---------------------- | :------------ | :----------------------------------------------------------------------------------------------------------------------------- |
| `type`    | `any`                   | `undefined`   | The name or type of the class instance to inject.                                                                              |
| `name`    | `undefined` \| `string` | `"default"`   | The unique name of the object to inject. Set to `undefined` to force a new instance to be created. Default value is `default`. |
| `...args` | `any`                   | `undefined`   | The constructor arguments to use if the object hasn't been created before.                                                     |

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

composer-service-core/src/decorators/ObjectDecorators.ts:20

---

### Logger

▸ **Logger**(`target`, `propertyKey`): `void`

Apply this to a property to have the logger utility injected at instantiation.

#### Parameters

| Name          | Type                 |
| :------------ | :------------------- |
| `target`      | `any`                |
| `propertyKey` | `string` \| `symbol` |

#### Returns

`void`

#### Defined in

composer-service-core/src/decorators/ObjectDecorators.ts:68
