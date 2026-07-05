///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2020-2026 Jean-Philippe Steinmetz. All rights reserved.
///////////////////////////////////////////////////////////////////////////////
import { Route, Model } from "../../../src/decorators/RouteDecorators";
import { ModelRoute } from "../../../src/routes/ModelRoute";
import Item from "../models/Item";
import { Description } from "../../../src/decorators/DocDecorators";

@Model(Item)
@Route("/items")
@Description("Handles processing of all HTTP requests for the path `/items`")
export default class ItemRoute extends ModelRoute<Item> {}
