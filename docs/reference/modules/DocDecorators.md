[@rapidrest/service-core](../README.md) / [Exports](../modules.md) / DocDecorators

# Namespace: DocDecorators

## Table of contents

### Interfaces

- [DocumentsData](../interfaces/DocDecorators.DocumentsData.md)

### Functions

- [Default](DocDecorators.md#default)
- [Description](DocDecorators.md#description)
- [Document](DocDecorators.md#document)
- [Example](DocDecorators.md#example)
- [Format](DocDecorators.md#format)
- [Returns](DocDecorators.md#returns)
- [Summary](DocDecorators.md#summary)
- [Tags](DocDecorators.md#tags)
- [TypeInfo](DocDecorators.md#typeinfo)

## Functions

### Default

▸ **Default**(`value`): (`target`: `any`, `propertyKey?`: `string`) => `void`

Provides a default value for property of a class.

#### Parameters

| Name    | Type     | Description        |
| :------ | :------- | :----------------- |
| `value` | `string` | The default value. |

#### Returns

`fn`

▸ (`target`, `propertyKey?`): `void`

##### Parameters

| Name           | Type     |
| :------------- | :------- |
| `target`       | `any`    |
| `propertyKey?` | `string` |

##### Returns

`void`

#### Defined in

composer-service-core/src/decorators/DocDecorators.ts:40

---

### Description

▸ **Description**(`value`): (`target`: `any`, `propertyKey?`: `string`) => `void`

Provides a detailed describing the class, property or function.

#### Parameters

| Name    | Type     | Description                                         |
| :------ | :------- | :-------------------------------------------------- |
| `value` | `string` | The description of the class, property or function. |

#### Returns

`fn`

▸ (`target`, `propertyKey?`): `void`

##### Parameters

| Name           | Type     |
| :------------- | :------- |
| `target`       | `any`    |
| `propertyKey?` | `string` |

##### Returns

`void`

#### Defined in

composer-service-core/src/decorators/DocDecorators.ts:51

---

### Document

▸ **Document**(`value`): (`target`: `any`, `propertyKey?`: `string`) => `void`

Provides a set of documentation data for a given class, property or function.

#### Parameters

| Name    | Type                                                            | Description        |
| :------ | :-------------------------------------------------------------- | :----------------- |
| `value` | [`DocumentsData`](../interfaces/DocDecorators.DocumentsData.md) | The default value. |

#### Returns

`fn`

▸ (`target`, `propertyKey?`): `void`

##### Parameters

| Name           | Type     |
| :------------- | :------- |
| `target`       | `any`    |
| `propertyKey?` | `string` |

##### Returns

`void`

#### Defined in

composer-service-core/src/decorators/DocDecorators.ts:20

---

### Example

▸ **Example**(`value`): (`target`: `any`, `propertyKey?`: `string`) => `void`

Provides a example representation of the property or function return value.

#### Parameters

| Name    | Type  | Description        |
| :------ | :---- | :----------------- |
| `value` | `any` | The example value. |

#### Returns

`fn`

▸ (`target`, `propertyKey?`): `void`

##### Parameters

| Name           | Type     |
| :------------- | :------- |
| `target`       | `any`    |
| `propertyKey?` | `string` |

##### Returns

`void`

#### Defined in

composer-service-core/src/decorators/DocDecorators.ts:62

---

### Format

▸ **Format**(`value`): (`target`: `any`, `propertyKey?`: `string`) => `void`

Describes the underlying format of a class's property.

#### Parameters

| Name    | Type     | Description                            |
| :------ | :------- | :------------------------------------- |
| `value` | `string` | The format of the property's property. |

#### Returns

`fn`

▸ (`target`, `propertyKey?`): `void`

##### Parameters

| Name           | Type     |
| :------------- | :------- |
| `target`       | `any`    |
| `propertyKey?` | `string` |

##### Returns

`void`

#### Defined in

composer-service-core/src/decorators/DocDecorators.ts:73

---

### Returns

▸ **Returns**(`types?`): (`target`: `any`, `propertyKey`: `string`) => `void`

Stores runtime metadata about the typing information of a function's return value.

#### Parameters

| Name     | Type  | Description                                                                                                                                                                                                                                                                                                                                  |
| :------- | :---- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `types?` | `any` | The optional return type(s) of the function. Can represent a single type (e.g. `MyClass`) or a union of types (e.g. `string \| number \| null`). When describing a generic type such as a collection this should be encoded as an array with the templated type as additional elements (e.g. `Array<MyClass>` becomes `[[Array, MyClass]]`). |

#### Returns

`fn`

▸ (`target`, `propertyKey`): `void`

##### Parameters

| Name          | Type     |
| :------------ | :------- |
| `target`      | `any`    |
| `propertyKey` | `string` |

##### Returns

`void`

#### Defined in

composer-service-core/src/decorators/DocDecorators.ts:109

---

### Summary

▸ **Summary**(`value`): (`target`: `any`, `propertyKey?`: `string`) => `void`

Provides a brief summary about the class, property or function.

#### Parameters

| Name    | Type     | Description                                     |
| :------ | :------- | :---------------------------------------------- |
| `value` | `string` | The summary of the class, property or function. |

#### Returns

`fn`

▸ (`target`, `propertyKey?`): `void`

##### Parameters

| Name           | Type     |
| :------------- | :------- |
| `target`       | `any`    |
| `propertyKey?` | `string` |

##### Returns

`void`

#### Defined in

composer-service-core/src/decorators/DocDecorators.ts:84

---

### Tags

▸ **Tags**(`value`): (`target`: `any`, `propertyKey?`: `string`) => `void`

Provides a list of searchable tags associated with the property or function.

#### Parameters

| Name    | Type       | Description                  |
| :------ | :--------- | :--------------------------- |
| `value` | `string`[] | The list of searchable tags. |

#### Returns

`fn`

▸ (`target`, `propertyKey?`): `void`

##### Parameters

| Name           | Type     |
| :------------- | :------- |
| `target`       | `any`    |
| `propertyKey?` | `string` |

##### Returns

`void`

#### Defined in

composer-service-core/src/decorators/DocDecorators.ts:95

---

### TypeInfo

▸ **TypeInfo**(`types?`): (`target`: `any`, `propertyKey`: `string`) => `void`

Stores runtime metadata about the typing information of a class property.

#### Parameters

| Name     | Type  | Description                                                                                                                                                                                                                                                                                                                                   |
| :------- | :---- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `types?` | `any` | The optional primary type(s) of the property. Can represent a single type (e.g. `MyClass`) or a union of types (e.g. `string \| number \| null`). When describing a generic type such as a collection this should be encoded as an array with the templated type as additional elements (e.g. `Array<MyClass>` becomes `[[Array, MyClass]]`). |

#### Returns

`fn`

▸ (`target`, `propertyKey`): `void`

##### Parameters

| Name          | Type     |
| :------------ | :------- |
| `target`      | `any`    |
| `propertyKey` | `string` |

##### Returns

`void`

#### Defined in

composer-service-core/src/decorators/DocDecorators.ts:128
