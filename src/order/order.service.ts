import { Injectable, Logger } from '@nestjs/common';
import * as sql from 'mssql';
import { MssqlService } from '../database/mssql.service';
import { PostgresService } from '../database/postgres.service';
import { OrderStatusRequestDto } from './dto/order-status-request.dto';
import { OrderStatusResponse } from './interfaces/order-status-response.interface';

type OrderCheckpointRow = {
  OrdenCliente: string;
  NumItem: number | null;
  Fecha: Date | string | null;
  checkpoint: string | null;
  Estacion: string | null;
  Actividad: string | null;
  RazonSocial: string | null;
  Estado: string | null;
};

type EstimatedDateRow = {
  FechaEstimadaEntrega: Date | string | null;
};

type ItemInput = {
  original: string | null;
};

@Injectable()
export class OrderService {
  private readonly logger = new Logger(OrderService.name);

  constructor(
    private readonly mssqlService: MssqlService,
    private readonly postgresService: PostgresService
  ) {}

  async getOrderStatus(dto: OrderStatusRequestDto): Promise<OrderStatusResponse> {
    const orderNumber = dto.orderNumber.trim();
    const itemInfo = this.normalizeItemInput(dto.itemNumber);
    const defaultResponse = this.buildNotFoundResponse(orderNumber);

    this.logger.log(`Processing order: ${orderNumber}, item: ${itemInfo.original}`);

    try {
      // Test de conectividad básico
      await this.testMssqlConnection();
      
      const checkpointRow = await this.fetchCheckpointRow(orderNumber, itemInfo.original);

      if (!checkpointRow) {
        this.logger.warn(`No checkpoint data found for order: ${orderNumber}`);
        return defaultResponse;
      }

      this.logger.log(`Found checkpoint data for order ${orderNumber}: checkpoint=${checkpointRow.checkpoint}, estacion=${checkpointRow.Estacion}`);

      const statusCliente2 = await this.resolveStatusCliente2(
        checkpointRow.checkpoint,
        checkpointRow.Estacion,
        checkpointRow.Actividad
      );

      const fechaEstimadaEntrega = await this.fetchEstimatedDate(orderNumber, itemInfo.original);

      const razonSocial = this.normalizeString(checkpointRow.RazonSocial);
      const estado = this.normalizeString(checkpointRow.Estado) ?? 'NO ENCONTRADO';

      const response = {
        OrdenCliente: orderNumber,
        RazonSocial: razonSocial,
        Estado: estado,
        StatusCliente2: statusCliente2,
        FechaEstimadaEntrega: fechaEstimadaEntrega
      };

      this.logger.log(`Returning response for order ${orderNumber}:`, JSON.stringify(response));
      return response;
    } catch (error) {
      this.logger.error(`Error processing order status for ${orderNumber}:`, error);
      return defaultResponse;
    }
  }

  private async testMssqlConnection(): Promise<void> {
    try {
      this.logger.log('Testing MSSQL connection...');
      const result = await this.mssqlService.query('SELECT 1 as test');
      this.logger.log(`MSSQL connection test successful: ${JSON.stringify(result.recordset)}`);
    } catch (error) {
      this.logger.error('MSSQL connection test failed:', error);
      throw error;
    }
  }

  private buildNotFoundResponse(orderNumber: string): OrderStatusResponse {
    return {
      OrdenCliente: orderNumber,
      RazonSocial: null,
      Estado: 'NO ENCONTRADO',
      StatusCliente2: 'NO ENCONTRADO',
      FechaEstimadaEntrega: null
    };
  }

  private normalizeItemInput(item: string | null): ItemInput {
    if (item === null || item === undefined) {
      return { original: null };
    }

    const trimmed = item.trim();
    if (!trimmed || trimmed.toLowerCase() === 'null') {
      return { original: null };
    }

    const numeric = Number(trimmed);
    if (!Number.isInteger(numeric)) {
      return { original: null };
    }

    return { original: trimmed };
  }

  private async fetchCheckpointRow(orderNumber: string, item: string | null): Promise<OrderCheckpointRow | null> {
    this.logger.log(`Executing checkpoint query for order: ${orderNumber}, item: ${item}`);

    try {
      // Simplificar la consulta usando template literals
      const itemValue = item ? parseInt(item, 10) : null;
      const query = `
        SELECT TOP (1)
            c.PE1_NUMORD AS OrdenCliente,
            ${itemValue ? 'b.PE2_NUMITM' : 'NULL'} AS NumItem,
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
          ${itemValue ? `AND b.pe2_numitm = ${itemValue}` : ''}
        ORDER BY a.pedido_checkpoint_valor DESC;
      `;

      this.logger.log(`Executing query: ${query}`);

      const result = await this.mssqlService.query<OrderCheckpointRow>(query);

      this.logger.log(`Checkpoint query returned ${result.recordset?.length || 0} rows`);
      
      if (result.recordset && result.recordset.length > 0) {
        this.logger.log(`First row data:`, JSON.stringify(result.recordset[0]));
        return result.recordset[0];
      }

      return null;
    } catch (error) {
      this.logger.error(`Error in checkpoint query for order ${orderNumber}:`, error);
      throw error;
    }
  }

  private async fetchEstimatedDate(orderNumber: string, item: string | null): Promise<string | null> {
    this.logger.log(`Executing estimated date query for order: ${orderNumber}, item: ${item}`);

    try {
      const itemValue = item ? parseInt(item, 10) : null;
      const query = `
        SELECT TOP (1)
            a.pedido_checkpoint_valor AS FechaEstimadaEntrega
        FROM EFC_DB_PROD.[IP].[Detalle_Estacion_Agrupada] a
        JOIN desarrollo.dbo.pe2000 b 
          ON a.Pedido_Unico = b.pe2_unique
        JOIN desarrollo.dbo.pe1000 c 
          ON b.pe2_tipdoc = c.pe1_tipdoc 
        AND b.pe2_numped = c.pe1_numped
        WHERE LTRIM(RTRIM(c.pe1_numord)) = '${orderNumber.replace(/'/g, "''")}'
          ${itemValue ? `AND b.pe2_numitm = ${itemValue}` : ''}
          AND (
                a.nombre_usuario LIKE '%Fecha%Estimad%Entrega%' OR
                a.Actividad      LIKE '%Estimad%Entrega%' OR
                a.Estacion       LIKE '%Entrega Estimada%'
              )
        ORDER BY a.pedido_checkpoint_valor DESC;
      `;

      this.logger.log(`Executing estimated date query: ${query}`);

      const result = await this.mssqlService.query<EstimatedDateRow>(query);

      if (!result.recordset || result.recordset.length === 0) {
        this.logger.log(`No estimated date found for order: ${orderNumber}`);
        return null;
      }

      const rawDate = result.recordset[0].FechaEstimadaEntrega;
      const isoDate = this.toIsoString(rawDate);
      this.logger.log(`Found estimated date for order ${orderNumber}: ${isoDate}`);
      return isoDate;
    } catch (error) {
      this.logger.error(`Error in estimated date query for order ${orderNumber}:`, error);
      throw error;
    }
  }

  private async resolveStatusCliente2(
    checkpoint: string | null,
    estacion: string | null,
    actividad: string | null
  ): Promise<string> {
    const defaultStatus = 'EN PROCESO';
    const normalized = {
      checkpoint: this.normalizeForMatch(checkpoint),
      estacion: this.normalizeForMatch(estacion),
      actividad: this.normalizeForMatch(actividad)
    };

    this.logger.log(`Resolving StatusCliente2 with: checkpoint=${normalized.checkpoint}, estacion=${normalized.estacion}, actividad=${normalized.actividad}`);

    const queries: Array<{
      fields: Array<keyof typeof normalized>;
      text: string;
    }> = [
      {
        fields: ['checkpoint', 'estacion', 'actividad'],
        text: `SELECT status_cliente_2
FROM public.diccionario_estaciones
WHERE UPPER(TRIM(checkpoint)) = UPPER(TRIM($1))
  AND UPPER(TRIM(estacion))   = UPPER(TRIM($2))
  AND UPPER(TRIM(actividad))  = UPPER(TRIM($3))
LIMIT 1;`
      },
      {
        fields: ['estacion', 'actividad'],
        text: `SELECT status_cliente_2
FROM public.diccionario_estaciones
WHERE UPPER(TRIM(estacion))   = UPPER(TRIM($1))
  AND UPPER(TRIM(actividad))  = UPPER(TRIM($2))
LIMIT 1;`
      },
      {
        fields: ['checkpoint', 'estacion'],
        text: `SELECT status_cliente_2
FROM public.diccionario_estaciones
WHERE UPPER(TRIM(checkpoint)) = UPPER(TRIM($1))
  AND UPPER(TRIM(estacion))   = UPPER(TRIM($2))
LIMIT 1;`
      },
      {
        fields: ['estacion'],
        text: `SELECT status_cliente_2
FROM public.diccionario_estaciones
WHERE UPPER(TRIM(estacion))   = UPPER(TRIM($1))
LIMIT 1;`
      }
    ];

    for (const query of queries) {
      const values = query.fields.map((field) => normalized[field]);
      if (values.some((value) => value === null)) {
        continue;
      }

      const params = values as string[];

      try {
        this.logger.log(`Trying PostgreSQL query with params: ${JSON.stringify(params)}`);
        const result = await this.postgresService.query<{ status_cliente_2: string }>(
          query.text,
          params
        );

        if (result.rows.length > 0) {
          const status = this.normalizeString(result.rows[0].status_cliente_2);
          if (status) {
            this.logger.log(`Found status: ${status}`);
            return status;
          }
        }
      } catch (error) {
        this.logger.error('Error resolving StatusCliente2', error as Error);
        throw error;
      }
    }

    this.logger.log(`No status found, returning default: ${defaultStatus}`);
    return defaultStatus;
  }

  private normalizeForMatch(value: string | null): string | null {
    if (!value) {
      return null;
    }
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
  }

  private normalizeString(value: string | null): string | null {
    if (!value) {
      return null;
    }
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  private toIsoString(value: Date | string | null): string | null {
    if (!value) {
      return null;
    }

    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) {
      return null;
    }

    return date.toISOString();
  }
}
