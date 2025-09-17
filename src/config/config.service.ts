import { Injectable } from '@nestjs/common';

@Injectable()
export class ConfigService {
  get mssqlConfig() {
    const port = this.parseNumber(process.env.MSSQL_PORT, 1433);
    return {
      server: process.env.MSSQL_HOST ?? 'localhost',
      database: process.env.MSSQL_DB ?? '',
      user: process.env.MSSQL_USER ?? '',
      password: process.env.MSSQL_PASS ?? '',
      port,
      options: {
        encrypt: false,
        trustServerCertificate: true
      },
      pool: {
        max: 10,
        min: 0,
        idleTimeoutMillis: 30000
      }
    };
  }

  get postgresConfig() {
    const port = this.parseNumber(process.env.PG_PORT, 5432);
    return {
      host: process.env.PG_HOST ?? 'localhost',
      database: process.env.PG_DB ?? '',
      user: process.env.PG_USER ?? '',
      password: process.env.PG_PASS ?? '',
      port,
      max: 10,
      idleTimeoutMillis: 30000,
      ssl: false
    };
  }

  private parseNumber(value: string | undefined, defaultValue: number): number {
    if (!value) {
      return defaultValue;
    }
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : defaultValue;
  }
}
