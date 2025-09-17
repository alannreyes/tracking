import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Pool, QueryResult } from 'pg';
import { ConfigService } from '../config/config.service';

@Injectable()
export class PostgresService implements OnModuleDestroy {
  private readonly logger = new Logger(PostgresService.name);
  private pool?: Pool;

  constructor(private readonly configService: ConfigService) {}

  async query<T = unknown>(queryText: string, params: unknown[] = []): Promise<QueryResult<T>> {
    const pool = this.getPool();

    try {
      return await pool.query<T>(queryText, params);
    } catch (error) {
      this.logger.error('Error executing PostgreSQL query', error as Error);
      throw error;
    }
  }

  async onModuleDestroy() {
    if (this.pool) {
      await this.pool.end();
      this.pool = undefined;
    }
  }

  private getPool(): Pool {
    if (!this.pool) {
      this.pool = new Pool(this.configService.postgresConfig);
    }
    return this.pool;
  }
}
