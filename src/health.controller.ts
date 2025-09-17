import { Controller, Get, Query } from '@nestjs/common';
import { MssqlService } from './database/mssql.service';
import { PostgresService } from './database/postgres.service';

@Controller()
export class HealthController {
  constructor(
    private readonly mssqlService: MssqlService,
    private readonly postgresService: PostgresService
  ) {}

  @Get('health')
  getHealth() {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      service: 'tracking-api',
      version: '1.0.0'
    };
  }

  @Get()
  getRoot() {
    return {
      message: 'EstadoPedido API is running',
      endpoints: {
        health: '/health',
        'estado-pedido': 'POST /estado-pedido',
        'test-db': '/test-db',
        'test-order': '/test-order?order=12345'
      }
    };
  }

  @Get('test-db')
  async testDatabases() {
    const results: any = {
      mssql: null,
      postgres: null,
      timestamp: new Date().toISOString()
    };

    // Test MSSQL
    try {
      const mssqlResult = await this.mssqlService.query('SELECT 1 as test, @@VERSION as version');
      results.mssql = {
        status: 'connected',
        test: mssqlResult.recordset?.[0],
        rowCount: mssqlResult.recordset?.length || 0
      };
    } catch (error) {
      results.mssql = {
        status: 'error',
        error: (error as Error).message
      };
    }

    // Test PostgreSQL
    try {
      const pgResult = await this.postgresService.query('SELECT 1 as test, version() as version');
      results.postgres = {
        status: 'connected',
        test: pgResult.rows?.[0],
        rowCount: pgResult.rows?.length || 0
      };
    } catch (error) {
      results.postgres = {
        status: 'error',
        error: (error as Error).message
      };
    }

    return results;
  }

  @Get('test-order')
  async testOrderQuery(@Query('order') orderNumber: string = '12345') {
    if (!orderNumber) {
      return { error: 'Provide order parameter: /test-order?order=12345' };
    }

    try {
      // Test simple order lookup
      const result = await this.mssqlService.query(`
        SELECT TOP 5
          c.PE1_NUMORD as OrdenCliente,
          d.CLI_RZNSOC as RazonSocial
        FROM desarrollo.dbo.pe1000 c 
        LEFT JOIN desarrollo.dbo.cl0000 d ON c.PE1_CODCLI = d.CLI_CODIGO
        WHERE LTRIM(RTRIM(c.pe1_numord)) LIKE '%' + @orderNumber + '%'
      `, [
        { name: 'orderNumber', type: require('mssql').VarChar(32), value: orderNumber }
      ]);

      return {
        searchedOrder: orderNumber,
        foundOrders: result.recordset,
        count: result.recordset?.length || 0,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      return {
        searchedOrder: orderNumber,
        error: (error as Error).message,
        timestamp: new Date().toISOString()
      };
    }
  }
} 