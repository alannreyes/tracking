import { Module } from '@nestjs/common';
import { ConfigModule } from './config/config.module';
import { DatabaseModule } from './database/database.module';
import { OrderModule } from './order/order.module';

@Module({
  imports: [ConfigModule, DatabaseModule, OrderModule]
})
export class AppModule {}
