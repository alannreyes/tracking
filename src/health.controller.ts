import { Controller, Get, Query } from '@nestjs/common';
import { MssqlService } from './database/mssql.service';

@Controller()
export class HealthController {
  constructor(private readonly mssqlService: MssqlService) {}

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
        'estado-pedido': 'POST /estado-pedido'
      }
    };
  }

  @Get('debug-dates')
  async debugEstimatedDates(@Query('order') orderNumber: string = '112697') {
    try {
      // Buscar fecha solicitada por el cliente en las tablas principales
      const orderDates = await this.mssqlService.query(`
        SELECT 
            c.pe1_numord AS OrdenCliente,
            c.pe1_fecped AS FechaPedido,
            c.pe1_fecent AS FechaEntrega,
            c.pe1_fecreq AS FechaRequerida,
            c.pe1_fecpro AS FechaPromesa,
            b.pe2_fecent AS FechaEntregaItem,
            b.pe2_fecreq AS FechaRequeridaItem,
            b.pe2_numitm AS NumItem
        FROM desarrollo.dbo.pe1000 c 
        LEFT JOIN desarrollo.dbo.pe2000 b 
            ON b.pe2_tipdoc = c.pe1_tipdoc 
           AND b.pe2_numped = c.pe1_numped
        WHERE LTRIM(RTRIM(c.pe1_numord)) = '${orderNumber.replace(/'/g, "''")}'
        ORDER BY b.pe2_numitm
      `);

      // Ver TODOS los checkpoints para entender qué patrones existen
      const allCheckpoints = await this.mssqlService.query(`
        SELECT 
            a.pedido_checkpoint_valor AS Fecha,
            a.nombre_usuario AS [checkpoint],
            a.Estacion,
            a.Actividad,
            a.Pedido_Estado_Item AS Estado
        FROM EFC_DB_PROD.[IP].[Detalle_Estacion_Agrupada] a
        JOIN desarrollo.dbo.pe2000 b 
            ON a.Pedido_Unico = b.pe2_unique
        JOIN desarrollo.dbo.pe1000 c 
            ON b.pe2_tipdoc = c.pe1_tipdoc 
           AND b.pe2_numped = c.pe1_numped
        WHERE LTRIM(RTRIM(c.pe1_numord)) = '${orderNumber.replace(/'/g, "''")}'
        ORDER BY a.pedido_checkpoint_valor DESC
      `);

      return {
        orderNumber,
        orderDates: {
          description: 'Fechas del pedido en tablas principales',
          data: orderDates.recordset,
          count: orderDates.recordset?.length || 0
        },
        trackingCheckpoints: {
          description: 'Checkpoints de seguimiento',
          data: allCheckpoints.recordset,
          count: allCheckpoints.recordset?.length || 0
        },
        possibleDateFields: [
          'pe1_fecped - Fecha del pedido',
          'pe1_fecent - Fecha de entrega (cabecera)',
          'pe1_fecreq - Fecha requerida (cabecera)',
          'pe1_fecpro - Fecha promesa (cabecera)',
          'pe2_fecent - Fecha de entrega (ítem)',
          'pe2_fecreq - Fecha requerida (ítem)'
        ],
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      return {
        orderNumber,
        error: (error as Error).message,
        timestamp: new Date().toISOString()
      };
    }
  }
} 