import { Module } from "@nestjs/common";
import { WarehousesModule } from "../warehouses/warehouses.module";
import { StockBalancesController } from "./stock-balances.controller";
import { StockBalancesService } from "./stock-balances.service";
import { StockLotPlacementsController } from "./stock-lot-placements.controller";
import { StockLotPlacementsService } from "./stock-lot-placements.service";
import { StockLotsController } from "./stock-lots.controller";
import { StockLotsService } from "./stock-lots.service";
import { StockPiecesController } from "./stock-pieces.controller";
import { StockPiecesService } from "./stock-pieces.service";

@Module({
  imports: [WarehousesModule],
  controllers: [StockBalancesController, StockLotsController, StockLotPlacementsController, StockPiecesController],
  providers: [StockBalancesService, StockLotsService, StockLotPlacementsService, StockPiecesService],
})
export class StockModule {}
