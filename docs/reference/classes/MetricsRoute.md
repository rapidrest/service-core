[@rapidrest/service-core](../README.md) / [Exports](../modules.md) / MetricsRoute

# Class: MetricsRoute

Handles all REST API requests for the endpoint `/metrics'. This route handler produces Prometheus compatible metrics
for use with a Prometheus based server.

Services that wish to provide metrics to be exposed via this route can register them using the global registry
from the provided `prom-client` dependency. See the `prom-client` documentation for more details.

## Table of contents

### Constructors

- [constructor](MetricsRoute.md#constructor)

### Properties

- [config](MetricsRoute.md#config)
- [registry](MetricsRoute.md#registry)

### Methods

- [getMetrics](MetricsRoute.md#getmetrics)
- [getSingleMetric](MetricsRoute.md#getsinglemetric)

## Constructors

### constructor

• **new MetricsRoute**(): [`MetricsRoute`](MetricsRoute.md)

#### Returns

[`MetricsRoute`](MetricsRoute.md)

#### Defined in

composer-service-core/src/routes/MetricsRoute.ts:22

## Properties

### config

• `Private` **config**: `any`

#### Defined in

composer-service-core/src/routes/MetricsRoute.ts:19

---

### registry

• `Private` **registry**: `Registry`\<`"text/plain; version=0.0.4; charset=utf-8"`\>

#### Defined in

composer-service-core/src/routes/MetricsRoute.ts:20

## Methods

### getMetrics

▸ **getMetrics**(): `Promise`\<`string`\>

#### Returns

`Promise`\<`string`\>

#### Defined in

composer-service-core/src/routes/MetricsRoute.ts:30

---

### getSingleMetric

▸ **getSingleMetric**(`metric`): `Promise`\<`string`\>

#### Parameters

| Name     | Type  |
| :------- | :---- |
| `metric` | `any` |

#### Returns

`Promise`\<`string`\>

#### Defined in

composer-service-core/src/routes/MetricsRoute.ts:38
