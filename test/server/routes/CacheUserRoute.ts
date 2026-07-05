///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2020-2026 Jean-Philippe Steinmetz. All rights reserved.
///////////////////////////////////////////////////////////////////////////////
import { Route, Model } from "../../../src/decorators/RouteDecorators";
import { ModelRoute } from "../../../src/routes/ModelRoute";
import UserModel from "../models/CacheUser";
import { Description } from "../../../src/decorators/DocDecorators";

@Model(UserModel)
@Route("/cachedusers")
@Description("Handles processing of all HTTP requests for the path `/cachedusers`.")
export default class UserRoute extends ModelRoute<UserModel> {}
