///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2020-2026 Jean-Philippe Steinmetz. All rights reserved.
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
import { BaseStaticRoute } from "../../../src/routes/BaseStaticRoute.js";
import { Route } from "../../../src/decorators/RouteDecorators.js";

/**
 * Mounted at `/static`, registering as `@Get("/*")` under that prefix (i.e. `/static/*`).
 * Exercises BunRouter's prefixed-wildcard matching — the exact pattern that was broken (routes
 * ending in `/*` under a non-root prefix never matched anything but the literal `/*` path).
 */
@Route("/static")
class StaticSmokeRoute extends BaseStaticRoute {}

export default StaticSmokeRoute;
