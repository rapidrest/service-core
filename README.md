# RapidREST: service-core

[![CI](https://github.com/rapidrest/service-core/actions/workflows/build.yml/badge.svg?branch=main)](https://github.com/rapidrest/service-core/actions/workflows/build.yml)
[![Coverage Status](https://coveralls.io/repos/github/rapidrest/service-core/badge.svg?branch=main)](https://coveralls.io/github/rapidrest/service-core?branch=main)
[![npm version](https://img.shields.io/npm/v/@rapidrest/service-core)](https://www.npmjs.com/package/@rapidrest/service-core)

A library for implementing REST API services and backend applications using a decorator-driven, aspect oriented programming (AOP), architecture. It
combines a high-performance HTTP engine, built on [uWebSockets.js](https://github.com/uNetworking/uWebSockets.js/) or [Bun](https://bun.sh/), with
integrated database abstraction with native MongoDB and SQL (via (TypeORM)[https://typeorm.io/]) support, sessions, JWT-based authenticaiton, Roles Based Access Control, and more.

For complete documentation please visit [RapidREST.dev](https://rapidrest.dev).

## Features

- Ultrafast HTTP engine ([uWebSockets.js](https://github.com/uNetworking/uWebSockets.js/)/[Bun](https://bun.sh/))
- Simple decorator-driven HTTP routing
- OpenAPI spec generation
- Built-in JWT authentication
- Roles Based Access Control && Access Control Lists
- Database abstraction (native MongoDB, TypeORM)
- Caching system (Redis)
- Telemetry (via Prometheus)
- External messaging (email, sms, slack, etc.)

## Installation

### NPM

```
npm i @rapidrest/service-core
```

### Yarn

```
yarn add @rapidrest/service-core
```

## Requirements

This package targets Node.js `>=24.0.0` and is published as an ESM-only package.

It declares `@rapidrest/core` as required peer dependencies. The remaining peer
dependencies are optional and only need to be installed if you use the corresponding feature:

| Peer dependency    | Required for                 |
| ------------------ | ---------------------------- |
| `@rapidrest/core`  | Always                       |
| `ioredis`          | When caching is enabled      |
| `lodash-es`        | Always                       |
| `mongodb`          | When MongoDB is used         |
| `openapi3-ts`      | Always                       |
| `prom-client`      | Always                       |
| `reflect-metadata` | Always                       |
| `typeorm`          | When SQL is used             |
| `uWebSockets.js`   | When Node.js runtime is used |
| `winston`          | Always                       |

## License

MIT — see [LICENSE](./LICENSE).
