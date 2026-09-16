import { Module } from "@nestjs/common";
import { RealtimeModule } from "../realtime/realtime.module";
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
  imports: [RealtimeModule],
  controllers: [
    ProductsController,
    ProductCategoriesController,
    UomConversionsController,
    ProductConvertController,
    MaterialSpecificationsController,
  ],
  providers: [ProductsService, ProductCategoriesService, UomConversionsService, MaterialSpecificationsService],
  exports: [UomConversionsService],
})
export class ProductsModule {}
