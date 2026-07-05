///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2020-2026 Jean-Philippe Steinmetz. All rights reserved.
///////////////////////////////////////////////////////////////////////////////
import UserModel from "../models/ProtectedUser";
import { RouteDecorators } from "../../../src/decorators";
import { ModelRoute } from "../../../src/routes/ModelRoute";
const { Route, Model } = RouteDecorators;

@Model(UserModel)
@Route("/userswithacl")
export default class UserWithACLRoute extends ModelRoute<UserModel> {}
