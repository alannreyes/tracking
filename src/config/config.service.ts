import { Injectable } from '@nestjs/common';

@Injectable()
export class ConfigService {
  get mssqlConfig() {
    const port = this.parseNumber(process.env.MSSQL_PORT, 1433);
    return {
      server: process.env.MSSQL_HOST ?? 'localhost',
      database: process.env.MSSQL_DB ?? '',
      user: process.env.MSSQL_USER ?? '',
      password: process.env.MSSQL_PASS ?? process.env.SSQL_PASS ?? '',
      port,
      options: {
        encrypt: process.env.MSSQL_ENCRYPT === 'true' ? true : false,
        trustServerCertificate:
          process.env.MSSQL_TRUST_SERVER_CERT === 'true' ? true : true
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

    const { host, database, user, password } = this.parsePostgresEnv();

    return {
      host: host ?? process.env.PG_HOST ?? 'localhost',
      database: database ?? process.env.PG_DB ?? '',
      user: user ?? process.env.PG_USER ?? '',
      password: password ?? process.env.PG_PASS ?? '',
      port,
      max: 10,
      idleTimeoutMillis: 30000,
      ssl: process.env.PG_SSL === 'true' ? true : false
    };
  }

  private parsePostgresEnv(): {
    host?: string;
    database?: string;
    user?: string;
    password?: string;
  } {
    const raw = process.env.PG_DB;
    if (!raw) return {};

    try {
      // Permitir URL estilo postgres://user:pass@host:port/db?...
      const url = new URL(raw);
      if (url.protocol.startsWith('postgres')) {
        const user = decodeURIComponent(url.username);
        const password = decodeURIComponent(url.password);
        const host = url.hostname;
        const database = url.pathname.replace(/^\//, '') || undefined;
        return { host, database, user, password };
      }
    } catch {
      // Si no es URL válida, lo dejamos como nombre de DB simple
    }
    return {};
  }

  private parseNumber(value: string | undefined, defaultValue: number): number {
    if (!value) {
      return defaultValue;
    }
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : defaultValue;
  }
}
