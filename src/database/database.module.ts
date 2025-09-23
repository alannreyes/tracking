import { Global, Module } from '@nestjs/common';
import { MssqlService } from './mssql.service';
import { PostgresService } from './postgres.service';

@Global()
@Module({
  providers: [MssqlService, PostgresService],
  exports: [MssqlService, PostgresService]
})
export class DatabaseModule {}
