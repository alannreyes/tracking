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
      // Ver TODOS los checkpoints para entender qué patrones existen
      const allCheckpoints = await this.mssqlService.query(`
        SELECT 
            a.pedido_checkpoint_valor AS Fecha,
            a.nombre_usuario AS checkpoint,
            a.Estacion,
            a.Actividad,
            a.Pedido_Estado_Item AS Estado,
            CASE 
              WHEN a.nombre_usuario LIKE '%Fecha%Estimad%Entrega%' THEN 'MATCH nombre_usuario'
              WHEN a.Actividad LIKE '%Estimad%Entrega%' THEN 'MATCH Actividad'  
              WHEN a.Estacion LIKE '%Entrega Estimada%' THEN 'MATCH Estacion'
              WHEN a.nombre_usuario LIKE '%estimad%' THEN 'PARTIAL nombre_usuario estimad'
              WHEN a.nombre_usuario LIKE '%entrega%' THEN 'PARTIAL nombre_usuario entrega'
              WHEN a.nombre_usuario LIKE '%fecha%' THEN 'PARTIAL nombre_usuario fecha'
              WHEN a.Actividad LIKE '%estimad%' THEN 'PARTIAL Actividad estimad'
              WHEN a.Actividad LIKE '%entrega%' THEN 'PARTIAL Actividad entrega'
              WHEN a.Estacion LIKE '%estimad%' THEN 'PARTIAL Estacion estimad'
              WHEN a.Estacion LIKE '%entrega%' THEN 'PARTIAL Estacion entrega'
              ELSE 'NO MATCH'
            END AS PatternMatch
        FROM EFC_DB_PROD.[IP].[Detalle_Estacion_Agrupada] a
        JOIN desarrollo.dbo.pe2000 b 
            ON a.Pedido_Unico = b.pe2_unique
        JOIN desarrollo.dbo.pe1000 c 
            ON b.pe2_tipdoc = c.pe1_tipdoc 
           AND b.pe2_numped = c.pe1_numped
        WHERE LTRIM(RTRIM(c.pe1_numord)) = '${orderNumber.replace(/'/g, "''")}'
        ORDER BY a.pedido_checkpoint_valor DESC
      `);

      // Buscar específicamente registros que podrían ser fechas estimadas
      const potentialDates = await this.mssqlService.query(`
        SELECT 
            a.pedido_checkpoint_valor AS Fecha,
            a.nombre_usuario AS checkpoint,
            a.Estacion,
            a.Actividad
        FROM EFC_DB_PROD.[IP].[Detalle_Estacion_Agrupada] a
        JOIN desarrollo.dbo.pe2000 b 
            ON a.Pedido_Unico = b.pe2_unique
        JOIN desarrollo.dbo.pe1000 c 
            ON b.pe2_tipdoc = c.pe1_tipdoc 
           AND b.pe2_numped = c.pe1_numped
        WHERE LTRIM(RTRIM(c.pe1_numord)) = '${orderNumber.replace(/'/g, "''")}'
          AND (
            a.nombre_usuario LIKE '%estimad%' OR
            a.nombre_usuario LIKE '%entrega%' OR
            a.nombre_usuario LIKE '%fecha%' OR
            a.Actividad LIKE '%estimad%' OR
            a.Actividad LIKE '%entrega%' OR
            a.Estacion LIKE '%estimad%' OR
            a.Estacion LIKE '%entrega%'
          )
        ORDER BY a.pedido_checkpoint_valor DESC
      `);

      return {
        orderNumber,
        totalCheckpoints: allCheckpoints.recordset?.length || 0,
        allCheckpoints: allCheckpoints.recordset,
        potentialEstimatedDates: potentialDates.recordset,
        potentialCount: potentialDates.recordset?.length || 0,
        currentQuery: `
          AND (
            a.nombre_usuario LIKE '%Fecha%Estimad%Entrega%' OR
            a.Actividad      LIKE '%Estimad%Entrega%' OR
            a.Estacion       LIKE '%Entrega Estimada%'
          )`,
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