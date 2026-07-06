///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2020-2026 Jean-Philippe Steinmetz. All rights reserved.
///////////////////////////////////////////////////////////////////////////////
import { Route, Model } from "../../../src/decorators/RouteDecorators";
import UserModel from "../models/VersionedUser";
import { Description } from "../../../src/decorators/DocDecorators";
import { CRUDRoute } from "../../../src/routes/CRUDRoute";

@Model(UserModel)
@Route("/versionedusers")
@Description("Handles processing of all HTTP requests for the path `/versionedusers`.")
export default class VersionedUserRoute extends CRUDRoute<UserModel> {}
