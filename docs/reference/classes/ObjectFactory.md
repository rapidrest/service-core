[@rapidrest/service-core](../README.md) / [Exports](../modules.md) / ObjectFactory

# Class: ObjectFactory

The `ObjectFactory` is a manager for creating objects based on registered
class types. This allows for the tracking of multiple instances of objects
so that references can be referenced by unique name.

**`Author`**

Jean-Philippe Steinmetz

## Table of contents

### Constructors

- [constructor](ObjectFactory.md#constructor)

### Properties

- [classes](ObjectFactory.md#classes)
- [config](ObjectFactory.md#config)
- [instances](ObjectFactory.md#instances)
- [logger](ObjectFactory.md#logger)

### Methods

- [clear](ObjectFactory.md#clear)
- [clearAll](ObjectFactory.md#clearall)
- [destroy](ObjectFactory.md#destroy)
- [getInitMethods](ObjectFactory.md#getinitmethods)
- [getInstance](ObjectFactory.md#getinstance)
- [initialize](ObjectFactory.md#initialize)
- [newInstance](ObjectFactory.md#newinstance)
- [register](ObjectFactory.md#register)

## Constructors

### constructor

• **new ObjectFactory**(`config?`, `logger?`): [`ObjectFactory`](ObjectFactory.md)

#### Parameters

| Name      | Type  |
| :-------- | :---- |
| `config?` | `any` |
| `logger?` | `any` |

#### Returns

[`ObjectFactory`](ObjectFactory.md)

#### Defined in

composer-service-core/src/ObjectFactory.ts:35

## Properties

### classes

• `Readonly` **classes**: `Map`\<`string`, `any`\>

A map for string fully qualified class names to their class types.

#### Defined in

composer-service-core/src/ObjectFactory.ts:24

---

### config

• `Private` **config**: `any`

The global application configuration object.

#### Defined in

composer-service-core/src/ObjectFactory.ts:27

---

### instances

• `Readonly` **instances**: `Map`\<`string`, `any`\>

A map for the unique name to the intance of a particular class type.

#### Defined in

composer-service-core/src/ObjectFactory.ts:30

---

### logger

• `Private` **logger**: `any`

The application logging utility.

#### Defined in

composer-service-core/src/ObjectFactory.ts:33

## Methods

### clear

▸ **clear**(): `void`

Deletes all instantiated objects.

#### Returns

`void`

#### Defined in

composer-service-core/src/ObjectFactory.ts:96

---

### clearAll

▸ **clearAll**(): `void`

Deletes all instantiated objects and registered class types.

#### Returns

`void`

#### Defined in

composer-service-core/src/ObjectFactory.ts:103

---

### destroy

▸ **destroy**(`objs?`): `Promise`\<`void`\>

Destroys the specified objects. If `undefined` is passed in, all objects managed by the factory are destroyed.

#### Parameters

| Name    | Type  |
| :------ | :---- |
| `objs?` | `any` |

#### Returns

`Promise`\<`void`\>

#### Defined in

composer-service-core/src/ObjectFactory.ts:45

---

### getInitMethods

▸ **getInitMethods**(`obj`): `Function`[]

Searches an object for one or more functions that implement a `@Init` decorator.

#### Parameters

| Name  | Type  | Description           |
| :---- | :---- | :-------------------- |
| `obj` | `any` | The object to search. |

#### Returns

`Function`[]

The list of functions that implements the `@Init` decorator if found, otherwise undefined.

#### Defined in

composer-service-core/src/ObjectFactory.ts:231

---

### getInstance

▸ **getInstance**\<`T`\>(`nameOrType`): `undefined` \| `T`

Returns the object instance with the given unique name. Unique names take the form `<ClassName>:<InstanceName>`.
It is possible to only specifiy the `<ClassName>`, doing so will automatically look for the `<ClassName>:default`
instance. It is also possible to pass the class type directly, in which case the instance will be searched by
`<ClassName>:default`.

#### Type parameters

| Name |
| :--- |
| `T`  |

#### Parameters

| Name         | Type  | Description                                              |
| :----------- | :---- | :------------------------------------------------------- |
| `nameOrType` | `any` | The unique name or class type of the object to retrieve. |

#### Returns

`undefined` \| `T`

The object instance associated with the given name if found, otherwise `undefined`.

#### Defined in

composer-service-core/src/ObjectFactory.ts:266

---

### initialize

▸ **initialize**(`obj`): `Promise`\<`void`\>

Scans the given object for any properties with the

#### Parameters

| Name  | Type  | Description                                     |
| :---- | :---- | :---------------------------------------------- |
| `obj` | `any` | The object to initialize with injected defaults |

#### Returns

`Promise`\<`void`\>

**`Inject`**

decorator and assigns the correct values.

#### Defined in

composer-service-core/src/ObjectFactory.ts:112

---

### newInstance

▸ **newInstance**\<`T`\>(`type`, `name?`, `...args`): `Promise`\<`T`\>

Creates a new instance of the class specified with the provided unique name or type and constructor arguments. If an existing
object has already been created with the given name, that instance is returned, otherwise a new instance is created
using the provided arguments.

#### Type parameters

| Name |
| :--- |
| `T`  |

#### Parameters

| Name      | Type     | Description                                                                                                                                 |
| :-------- | :------- | :------------------------------------------------------------------------------------------------------------------------------------------ |
| `type`    | `any`    | The fully qualified name or type of the class to instantiate. If a type is given it's class name will be inferred via the constructor name. |
| `name?`   | `string` | The unique name to give the class instance. Set to `undefined` if you wish to force a new object is created.                                |
| `...args` | `any`    | The set of constructor arguments to use during construction                                                                                 |

#### Returns

`Promise`\<`T`\>

#### Defined in

composer-service-core/src/ObjectFactory.ts:295

---

### register

▸ **register**(`clazz`, `fqn?`): `void`

Registers the given class type for the provided fully qualified name.

#### Parameters

| Name    | Type     | Description                                                                                       |
| :------ | :------- | :------------------------------------------------------------------------------------------------ |
| `clazz` | `any`    | The class type to register.                                                                       |
| `fqn?`  | `string` | The fully qualified name of the class to register. If not specified, the class name will be used. |

#### Returns

`void`

#### Defined in

composer-service-core/src/ObjectFactory.ts:367
