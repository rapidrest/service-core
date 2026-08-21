///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2020-2026 Jean-Philippe Steinmetz. All rights reserved.
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
import SecureDoc from "../models/SecureDoc";
import { RouteDecorators } from "../../../src/decorators";
import { CRUDRoute } from "../../../src/routes/CRUDRoute";
const { ApiRoute, Model } = RouteDecorators;

@Model(SecureDoc)
@ApiRoute("/securedocs")
export default class SecureDocRoute extends CRUDRoute<SecureDoc> {}
