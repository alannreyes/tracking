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
        'test-order': '/test-order?order=12345',
        'validate-sql': '/validate-sql?order=23027832&item=1'
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
        WHERE LTRIM(RTRIM(c.pe1_numord)) LIKE '%' + '${orderNumber.replace(/'/g, "''")}' + '%'
      `);

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

  @Get('validate-sql')
  async validateSqlStepByStep(@Query('order') orderNumber: string = '23027832', @Query('item') itemNumber: string = '1') {
    const results: any = {
      orderNumber,
      itemNumber,
      steps: {},
      timestamp: new Date().toISOString()
    };

    try {
      // Paso 1: Verificar que existe la orden en pe1000
      const step1 = await this.mssqlService.query(`
        SELECT pe1_numord, pe1_tipdoc, pe1_numped, PE1_CODCLI
        FROM desarrollo.dbo.pe1000 
        WHERE LTRIM(RTRIM(pe1_numord)) = '${orderNumber.replace(/'/g, "''")}'
      `);
      results.steps.step1_pe1000 = {
        description: 'Check order exists in pe1000',
        count: step1.recordset?.length || 0,
        data: step1.recordset
      };

      // Paso 2: Verificar pe2000 con la orden
      if (step1.recordset && step1.recordset.length > 0) {
        const orderData: any = step1.recordset[0];
        const step2 = await this.mssqlService.query(`
          SELECT pe2_unique, pe2_numitm, pe2_tipdoc, pe2_numped
          FROM desarrollo.dbo.pe2000 
          WHERE pe2_tipdoc = '${orderData.pe1_tipdoc}' 
            AND pe2_numped = '${orderData.pe1_numped}'
            ${itemNumber ? `AND pe2_numitm = ${parseInt(itemNumber, 10)}` : ''}
        `);
        results.steps.step2_pe2000 = {
          description: 'Check pe2000 items for this order',
          count: step2.recordset?.length || 0,
          data: step2.recordset
        };

        // Paso 3: Verificar Detalle_Estacion_Agrupada
        if (step2.recordset && step2.recordset.length > 0) {
          const itemData: any = step2.recordset[0];
          const step3 = await this.mssqlService.query(`
            SELECT TOP 5 Pedido_Unico, pedido_checkpoint_valor, nombre_usuario, Estacion, Actividad
            FROM EFC_DB_PROD.[IP].[Detalle_Estacion_Agrupada] 
            WHERE Pedido_Unico = '${itemData.pe2_unique}'
            ORDER BY pedido_checkpoint_valor DESC
          `);
          results.steps.step3_detalle_estacion = {
            description: 'Check Detalle_Estacion_Agrupada for this item',
            count: step3.recordset?.length || 0,
            data: step3.recordset
          };
        }
      }

      // Paso 4: Verificar cliente
      if (step1.recordset && step1.recordset.length > 0) {
        const orderData: any = step1.recordset[0];
        const step4 = await this.mssqlService.query(`
          SELECT CLI_CODIGO, CLI_RZNSOC
          FROM desarrollo.dbo.cl0000 
          WHERE CLI_CODIGO = '${orderData.PE1_CODCLI}'
        `);
        results.steps.step4_cliente = {
          description: 'Check client data',
          count: step4.recordset?.length || 0,
          data: step4.recordset
        };
      }

      // Paso 5: Consulta completa original
      const step5 = await this.mssqlService.query(`
        SELECT TOP (1)
            c.PE1_NUMORD AS OrdenCliente,
            b.PE2_NUMITM AS NumItem,
            a.pedido_checkpoint_valor AS Fecha,
            a.nombre_usuario AS [checkpoint],
            a.Estacion,
            a.Actividad,
            d.CLI_RZNSOC AS RazonSocial,
            a.Pedido_Estado_Item AS Estado
        FROM EFC_DB_PROD.[IP].[Detalle_Estacion_Agrupada] a
        JOIN desarrollo.dbo.pe2000 b 
            ON a.Pedido_Unico = b.pe2_unique
        JOIN desarrollo.dbo.pe1000 c 
            ON b.pe2_tipdoc = c.pe1_tipdoc 
           AND b.pe2_numped = c.pe1_numped
        JOIN desarrollo.dbo.cl0000 d 
            ON c.PE1_CODCLI = d.CLI_CODIGO
        WHERE LTRIM(RTRIM(c.pe1_numord)) = '${orderNumber.replace(/'/g, "''")}'
          ${itemNumber ? `AND b.pe2_numitm = ${parseInt(itemNumber, 10)}` : ''}
        ORDER BY a.pedido_checkpoint_valor DESC
      `);
      results.steps.step5_full_query = {
        description: 'Full original query',
        count: step5.recordset?.length || 0,
        data: step5.recordset
      };

    } catch (error) {
      results.error = (error as Error).message;
    }

    return results;
  }
} 