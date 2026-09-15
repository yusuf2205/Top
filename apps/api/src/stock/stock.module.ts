import { Module } from "@nestjs/common";
import { WarehousesModule } from "../warehouses/warehouses.module";
import { StockBalancesController } from "./stock-balances.controller";
import { StockBalancesService } from "./stock-balances.service";

@Module({
  imports: [WarehousesModule],
  controllers: [StockBalancesController],
  providers: [StockBalancesService],
})
export class StockModule {}
