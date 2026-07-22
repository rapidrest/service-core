///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2020-2026 Jean-Philippe Steinmetz. All rights reserved.
///////////////////////////////////////////////////////////////////////////////
import { Route, Model } from "../../../src/decorators/RouteDecorators";
import VersionedItem from "../models/VersionedItem";
import { Description } from "../../../src/decorators/DocDecorators";
import { CRUDRoute } from "../../../src/routes/CRUDRoute";

@Model(VersionedItem)
@Route("/versioneditems")
@Description("Handles processing of all HTTP requests for the path `/versioneditems`")
export default class VersionedItemRoute extends CRUDRoute<VersionedItem> {}
