import { Module } from '@nestjs/common';
import { ConfigModule } from './config/config.module';
import { DatabaseModule } from './database/database.module';
import { OrderModule } from './order/order.module';
import { HealthController } from './health.controller';

@Module({
  imports: [ConfigModule, DatabaseModule, OrderModule],
  controllers: [HealthController]
})
export class AppModule {}
