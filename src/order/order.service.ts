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
    const inputs = [
      { name: 'p_orderNumber', type: sql.VarChar(32), value: orderNumber },
      { name: 'p_itemNumber', type: sql.NVarChar(50), value: item }
    ];

    this.logger.log(`Executing checkpoint query for order: ${orderNumber}, item: ${item}`);

    try {
      const result = await this.mssqlService.query<OrderCheckpointRow>(
        `DECLARE @order  varchar(32) = @p_orderNumber;
DECLARE @itemS  nvarchar(50) = @p_itemNumber;
DECLARE @item   int = TRY_CONVERT(int, NULLIF(NULLIF(@itemS, ''), 'null'));
 
SELECT 
    x.PE1_NUMORD            AS OrdenCliente,
    CASE WHEN @item IS NULL THEN NULL ELSE x.PE2_NUMITM END AS NumItem,
    x.pedido_checkpoint_valor                 AS Fecha,
    x.nombre_usuario                          AS [checkpoint],
    x.Estacion,
    x.Actividad,
    x.CLI_RZNSOC                              AS RazonSocial,
    x.Pedido_Estado_Item                      AS Estado
FROM (VALUES (1)) v(dummy)
OUTER APPLY (
    SELECT TOP (1)
        c.PE1_NUMORD, 
        b.PE2_NUMITM,
        d.CLI_RZNSOC,
        a.pedido_checkpoint_valor,
        a.nombre_usuario,
        a.Estacion,
        a.Actividad,
        a.Pedido_Estado_Item
    FROM EFC_DB_PROD.[IP].[Detalle_Estacion_Agrupada] a
    JOIN desarrollo.dbo.pe2000 b 
        ON a.Pedido_Unico = b.pe2_unique
    JOIN desarrollo.dbo.pe1000 c 
        ON b.pe2_tipdoc = c.pe1_tipdoc 
       AND b.pe2_numped = c.pe1_numped
    JOIN desarrollo.dbo.cl0000 d 
        ON c.PE1_CODCLI = d.CLI_CODIGO
    WHERE LTRIM(RTRIM(c.pe1_numord)) = LTRIM(RTRIM(@order))
      AND ( @item IS NULL OR b.pe2_numitm = @item )
    ORDER BY a.pedido_checkpoint_valor DESC
) x;`,
        inputs
      );

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
    const inputs = [
      { name: 'p_orderNumber', type: sql.VarChar(32), value: orderNumber },
      { name: 'p_itemNumber', type: sql.NVarChar(50), value: item }
    ];

    const result = await this.mssqlService.query<EstimatedDateRow>(
      `DECLARE @order  varchar(32) = @p_orderNumber;
DECLARE @itemS  nvarchar(50) = @p_itemNumber;
DECLARE @item   int = TRY_CONVERT(int, NULLIF(NULLIF(@itemS, ''), 'null'));
 
SELECT TOP (1)
    a.pedido_checkpoint_valor AS FechaEstimadaEntrega
FROM EFC_DB_PROD.[IP].[Detalle_Estacion_Agrupada] a
JOIN desarrollo.dbo.pe2000 b 
  ON a.Pedido_Unico = b.pe2_unique
JOIN desarrollo.dbo.pe1000 c 
  ON b.pe2_tipdoc = c.pe1_tipdoc 
AND b.pe2_numped = c.pe1_numped
WHERE LTRIM(RTRIM(c.pe1_numord)) = LTRIM(RTRIM(@order))
  AND ( @item IS NULL OR b.pe2_numitm = @item )
  AND (
        a.nombre_usuario LIKE '%Fecha%Estimad%Entrega%' OR
        a.Actividad      LIKE '%Estimad%Entrega%' OR
        a.Estacion       LIKE '%Entrega Estimada%'
      )
ORDER BY a.pedido_checkpoint_valor DESC;`,
      inputs
    );

    if (!result.recordset || result.recordset.length === 0) {
      return null;
    }

    const rawDate = result.recordset[0].FechaEstimadaEntrega;
    return this.toIsoString(rawDate);
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
