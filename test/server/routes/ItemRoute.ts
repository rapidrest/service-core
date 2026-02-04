///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2020-2026 Jean-Philippe Steinmetz
///////////////////////////////////////////////////////////////////////////////
import {
    Query,
    Param,
    Route,
    User,
    Get,
    Head,
    Post,
    Response,
    Validate,
    Delete,
    Put,
    Model,
} from "../../../src/decorators/RouteDecorators";
import { ModelRoute } from "../../../src/routes/ModelRoute.js";
import Item from "../models/Item.js";
import { Response as XResponse } from "express";
import { Description, Returns, TypeInfo, Summary } from "../../../src/decorators/DocDecorators.js";
import { RepoUtils } from "../../../src/index.js";

@Model(Item)
@Route("/items")
@Description("Handles processing of all HTTP requests for the path `/items`")
class ItemRoute extends ModelRoute<Item> {
    protected readonly repoUtilsClass: any = RepoUtils;

    /**
     * Initializes a new instance with the specified defaults.
     */
    constructor() {
        super();
    }

    private validate(obj: Item): void {
        if (!obj) {
            throw new Error("Did not receive object to validate");
        }
    }

    @Summary("Request")
    @Head()
    @Description("Returns the total number of items matching the given search criteria.")
    @Returns([null])
    protected count(
        @Param() params: any,
        @Query() query: any,
        @Response res: XResponse,
        @User user?: any
    ): Promise<any> {
        return super.doCount({ params, query, res, user });
    }

    @Summary("Request")
    @Post()
    @Validate("validate")
    @Description("Creates a new item.")
    @TypeInfo([Item, [Array, Item]])
    @Returns([Item, [Array, Item]])
    protected create(obj: Item | Item[], @User user?: any): Promise<Item | Item[]> {
        return super.doCreate(obj, { user });
    }

    @Summary("Request")
    @Delete(":id")
    @Description("Deletes an existing item.")
    @Returns([null])
    protected delete(@Param("id") id: string, @User user?: any): Promise<void> {
        return super.doDelete(id, { user });
    }

    @Summary("Request")
    @Get()
    @Description("Returns all items matching the given search criteria.")
    @Returns([[Array, Item]])
    protected async findAll(@Param() params: any, @Query() query: any, @User user?: any): Promise<Item[]> {
        return await super.doFindAll({ params, query, user });
    }

    @Summary("Request")
    @Get(":id")
    @Description("Returns the item with the given unique identifier.")
    @Returns([Item])
    protected async findById(@Param("id") id: string, @Query() query: any, @User user?: any): Promise<Item | null> {
        return await super.doFindById(id, { query, user });
    }

    @Summary("Request")
    @Delete()
    @Description("Deletes all existing items matching the given search criteria.")
    @Returns([null])
    protected truncate(@Param() params: any, @Query() query: any, @User user?: any): Promise<void> {
        return super.doTruncate({ params, query, user });
    }

    @Summary("Request")
    @Put(":id")
    @Validate("validate")
    @Description("Updates an existing item.")
    @TypeInfo([Item])
    @Returns([Item])
    protected async update(@Param("id") id: string, obj: Item, @User user?: any): Promise<Item> {
        const newObj: Item = new Item(obj);
        return await super.doUpdate(id, newObj, { user });
    }
}

export default ItemRoute;
