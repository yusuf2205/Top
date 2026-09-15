import { Module } from "@nestjs/common";
import { ProductCategoriesController } from "./product-categories.controller";
import { ProductCategoriesService } from "./product-categories.service";
import { ProductConvertController } from "./product-convert.controller";
import { ProductsController } from "./products.controller";
import { ProductsService } from "./products.service";
import { UomConversionsController } from "./uom-conversions.controller";
import { UomConversionsService } from "./uom-conversions.service";

@Module({
  controllers: [ProductsController, ProductCategoriesController, UomConversionsController, ProductConvertController],
  providers: [ProductsService, ProductCategoriesService, UomConversionsService],
})
export class ProductsModule {}
