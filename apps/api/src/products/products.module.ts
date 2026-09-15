import { Module } from "@nestjs/common";
import { MaterialSpecificationsController } from "./material-specifications.controller";
import { MaterialSpecificationsService } from "./material-specifications.service";
import { ProductCategoriesController } from "./product-categories.controller";
import { ProductCategoriesService } from "./product-categories.service";
import { ProductConvertController } from "./product-convert.controller";
import { ProductsController } from "./products.controller";
import { ProductsService } from "./products.service";
import { UomConversionsController } from "./uom-conversions.controller";
import { UomConversionsService } from "./uom-conversions.service";

@Module({
  controllers: [
    ProductsController,
    ProductCategoriesController,
    UomConversionsController,
    ProductConvertController,
    MaterialSpecificationsController,
  ],
  providers: [ProductsService, ProductCategoriesService, UomConversionsService, MaterialSpecificationsService],
})
export class ProductsModule {}
