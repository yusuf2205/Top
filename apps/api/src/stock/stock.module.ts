import { Module } from "@nestjs/common";
import { WarehousesModule } from "../warehouses/warehouses.module";
import { StockBalancesController } from "./stock-balances.controller";
import { StockBalancesService } from "./stock-balances.service";
import { StockLotPlacementsController } from "./stock-lot-placements.controller";
import { StockLotPlacementsService } from "./stock-lot-placements.service";
import { StockLotsController } from "./stock-lots.controller";
import { StockLotsService } from "./stock-lots.service";

@Module({
  imports: [WarehousesModule],
  controllers: [StockBalancesController, StockLotsController, StockLotPlacementsController],
  providers: [StockBalancesService, StockLotsService, StockLotPlacementsService],
})
export class StockModule {}
