///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2020-2026 Jean-Philippe Steinmetz. All rights reserved.
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
import { Route, Model } from "../../../src/decorators/RouteDecorators";
import Item from "../models/Item";
import { Description } from "../../../src/decorators/DocDecorators";
import { CRUDRoute } from "../../../src/routes/CRUDRoute";

@Model(Item)
@Route("/items")
@Description("Handles processing of all HTTP requests for the path `/items`")
export default class ItemRoute extends CRUDRoute<Item> {}
