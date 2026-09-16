import { Module } from "@nestjs/common";
import { WarehousesModule } from "../warehouses/warehouses.module";
import { ProductsModule } from "../products/products.module";
import { RealtimeModule } from "../realtime/realtime.module";
import { StockBalancesController } from "./stock-balances.controller";
import { StockBalancesService } from "./stock-balances.service";
import { StockLotPlacementsController } from "./stock-lot-placements.controller";
import { StockLotPlacementsService } from "./stock-lot-placements.service";
import { StockLotsController } from "./stock-lots.controller";
import { StockLotsService } from "./stock-lots.service";
import { StockPiecesController } from "./stock-pieces.controller";
import { StockPiecesService } from "./stock-pieces.service";
import { StockMovementsController } from "./stock-movements.controller";
import { StockMovementsService } from "./stock-movements.service";

@Module({
  imports: [WarehousesModule, ProductsModule, RealtimeModule],
  controllers: [
    StockBalancesController,
    StockLotsController,
    StockLotPlacementsController,
    StockPiecesController,
    StockMovementsController,
  ],
  providers: [StockBalancesService, StockLotsService, StockLotPlacementsService, StockPiecesService, StockMovementsService],
})
export class StockModule {}
