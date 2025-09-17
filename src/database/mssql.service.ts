import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import * as sql from 'mssql';
import { ConfigService } from '../config/config.service';

type SqlInput = {
  name: string;
  type: sql.ISqlTypeFactory | sql.ISqlType;
  value: unknown;
};

@Injectable()
export class MssqlService implements OnModuleDestroy {
  private readonly logger = new Logger(MssqlService.name);
  private pool?: sql.ConnectionPool;
  private poolPromise?: Promise<sql.ConnectionPool>;

  constructor(private readonly configService: ConfigService) {}

  async query<T = unknown>(queryText: string, inputs: SqlInput[] = []) {
    const pool = await this.getPool();
    const request = pool.request();

    for (const input of inputs) {
      request.input(input.name, input.type, input.value as never);
    }

    return request.query<T>(queryText);
  }

  async onModuleDestroy() {
    await this.closePool();
  }

  private async getPool(): Promise<sql.ConnectionPool> {
    if (this.pool && this.pool.connected) {
      return this.pool;
    }

    if (!this.poolPromise) {
      this.poolPromise = new sql.ConnectionPool(this.configService.mssqlConfig)
        .connect()
        .then((pool) => {
          this.pool = pool;
          return pool;
        })
        .catch((error) => {
          this.poolPromise = undefined;
          this.logger.error('Error connecting to MSSQL', error as Error);
          throw error;
        });
    }

    return this.poolPromise;
  }

  private async closePool() {
    if (this.pool) {
      await this.pool.close();
      this.pool = undefined;
      this.poolPromise = undefined;
    }
  }
}
