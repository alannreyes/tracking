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

  async getOrderStatus(dto: OrderStatusRequestDto): Promise<OrderStatusResponse[]> {
    const orderNumber = dto.orderNumber.trim();
    const itemInfo = this.normalizeItemInput(dto.itemNumber);

    try {
      const checkpointRows = await this.fetchCheckpointRows(orderNumber, itemInfo.original);

      if (!checkpointRows || checkpointRows.length === 0) {
        this.logger.warn(`No checkpoint data found for order: ${orderNumber}`);
        return [this.buildNotFoundResponse(orderNumber)];
      }

      const responses: OrderStatusResponse[] = [];

      for (const checkpointRow of checkpointRows) {
        const statusCliente2 = await this.resolveStatusCliente2(
          checkpointRow.checkpoint,
          checkpointRow.Estacion,
          checkpointRow.Actividad
        );

        let fechaEstimadaEntrega = await this.fetchEstimatedDate(orderNumber, itemInfo.original);

        // Si no hay fecha estimada específica, usar la fecha del checkpoint
        if (!fechaEstimadaEntrega && checkpointRow.Fecha) {
          fechaEstimadaEntrega = this.formatDateForDisplay(checkpointRow.Fecha);
        }

        const razonSocial = this.normalizeString(checkpointRow.RazonSocial);
        const estado = this.normalizeString(checkpointRow.Estado) ?? 'NO ENCONTRADO';

        const response = {
          OrdenCliente: orderNumber,
          NumItem: checkpointRow.NumItem,
          Fecha: this.formatDateForDisplay(checkpointRow.Fecha),
          checkpoint: this.normalizeString(checkpointRow.checkpoint),
          Estacion: this.normalizeString(checkpointRow.Estacion),
          Actividad: this.normalizeString(checkpointRow.Actividad),
          RazonSocial: razonSocial,
          Estado: estado,
          StatusCliente2: statusCliente2,
          FechaEstimadaEntrega: fechaEstimadaEntrega
        };

        responses.push(response);
      }

      return responses;
    } catch (error) {
      this.logger.error(`Error processing order status for ${orderNumber}:`, error);
      return [this.buildNotFoundResponse(orderNumber)];
    }
  }

  private async testMssqlConnection(): Promise<void> {
    try {
      await this.mssqlService.query('SELECT 1 as test');
    } catch (error) {
      this.logger.error('MSSQL connection test failed:', error);
      throw error;
    }
  }

  private buildNotFoundResponse(orderNumber: string): OrderStatusResponse {
    return {
      OrdenCliente: orderNumber,
      NumItem: null,
      Fecha: null,
      checkpoint: null,
      Estacion: null,
      Actividad: null,
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

  private async fetchCheckpointRows(orderNumber: string, item: string | null): Promise<OrderCheckpointRow[]> {
    try {
      // Usar el query optimizado del DBA con parámetros
      const query = `
        DECLARE @order  varchar(32) = @orderParam;
        DECLARE @itemS  nvarchar(50) = @itemParam;
        DECLARE @item   int = TRY_CONVERT(int, NULLIF(NULLIF(@itemS, ''), 'null'));

        SELECT
            c.PE1_NUMORD                              AS OrdenCliente,
            CASE WHEN @item IS NULL THEN NULL ELSE b.PE2_NUMITM END AS NumItem,
            a.pedido_checkpoint_valor                 AS Fecha,
            a.nombre_usuario                          AS [checkpoint],
            a.Estacion,
            a.Actividad,
            d.CLI_RZNSOC                              AS RazonSocial,
            a.Pedido_Estado_Item                      AS Estado
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
        ORDER BY a.pedido_checkpoint_valor DESC;
      `;

      const result = await this.mssqlService.query<OrderCheckpointRow>(query, [
        { name: 'orderParam', type: sql.VarChar(32), value: orderNumber },
        { name: 'itemParam', type: sql.NVarChar(50), value: item || 'null' }
      ]);

      return result.recordset || [];
    } catch (error) {
      this.logger.error(`Error in checkpoint query for order ${orderNumber}:`, error);
      throw error;
    }
  }

  private async fetchEstimatedDate(orderNumber: string, item: string | null): Promise<string | null> {
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

      const result = await this.mssqlService.query<EstimatedDateRow>(query);

      if (!result.recordset || result.recordset.length === 0) {
        return null;
      }

      const rawDate = result.recordset[0].FechaEstimadaEntrega;
      const formattedDate = this.formatDateForDisplay(rawDate);
      return formattedDate;
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

    // Log para debugging
    this.logger.debug(`Resolving StatusCliente2 for: checkpoint=${normalized.checkpoint}, estacion=${normalized.estacion}, actividad=${normalized.actividad}`);

    const queries: Array<{
      fields: Array<keyof typeof normalized>;
      text: string;
      description: string;
    }> = [
      {
        fields: ['checkpoint', 'estacion', 'actividad'],
        description: 'Exact match all fields',
        text: `SELECT status_cliente_2
FROM public.diccionario_estaciones
WHERE UPPER(TRIM(checkpoint)) = UPPER(TRIM($1))
  AND UPPER(TRIM(estacion))   = UPPER(TRIM($2))
  AND UPPER(TRIM(actividad))  = UPPER(TRIM($3))
LIMIT 1;`
      },
      {
        fields: ['estacion', 'actividad'],
        description: 'Exact match estacion + actividad',
        text: `SELECT status_cliente_2
FROM public.diccionario_estaciones
WHERE UPPER(TRIM(estacion))   = UPPER(TRIM($1))
  AND UPPER(TRIM(actividad))  = UPPER(TRIM($2))
LIMIT 1;`
      },
      {
        fields: ['checkpoint', 'estacion'],
        description: 'Exact match checkpoint + estacion',
        text: `SELECT status_cliente_2
FROM public.diccionario_estaciones
WHERE UPPER(TRIM(checkpoint)) = UPPER(TRIM($1))
  AND UPPER(TRIM(estacion))   = UPPER(TRIM($2))
LIMIT 1;`
      },
      {
        fields: ['estacion'],
        description: 'Exact match estacion only',
        text: `SELECT status_cliente_2
FROM public.diccionario_estaciones
WHERE UPPER(TRIM(estacion))   = UPPER(TRIM($1))
LIMIT 1;`
      },
      {
        fields: ['actividad'],
        description: 'Exact match actividad only',
        text: `SELECT status_cliente_2
FROM public.diccionario_estaciones
WHERE UPPER(TRIM(actividad))  = UPPER(TRIM($1))
LIMIT 1;`
      },
      {
        fields: ['checkpoint'],
        description: 'Exact match checkpoint only',
        text: `SELECT status_cliente_2
FROM public.diccionario_estaciones
WHERE UPPER(TRIM(checkpoint)) = UPPER(TRIM($1))
LIMIT 1;`
      },
      {
        fields: ['estacion'],
        description: 'LIKE match estacion',
        text: `SELECT status_cliente_2
FROM public.diccionario_estaciones
WHERE UPPER(TRIM(estacion)) LIKE '%' || UPPER(TRIM($1)) || '%'
   OR UPPER(TRIM($1)) LIKE '%' || UPPER(TRIM(estacion)) || '%'
LIMIT 1;`
      },
      {
        fields: ['actividad'],
        description: 'LIKE match actividad',
        text: `SELECT status_cliente_2
FROM public.diccionario_estaciones
WHERE UPPER(TRIM(actividad)) LIKE '%' || UPPER(TRIM($1)) || '%'
   OR UPPER(TRIM($1)) LIKE '%' || UPPER(TRIM(actividad)) || '%'
LIMIT 1;`
      },
      {
        fields: ['checkpoint'],
        description: 'LIKE match checkpoint',
        text: `SELECT status_cliente_2
FROM public.diccionario_estaciones
WHERE UPPER(TRIM(checkpoint)) LIKE '%' || UPPER(TRIM($1)) || '%'
   OR UPPER(TRIM($1)) LIKE '%' || UPPER(TRIM(checkpoint)) || '%'
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
        this.logger.debug(`Trying query: ${query.description} with params: ${JSON.stringify(params)}`);

        const result = await this.postgresService.query<{ status_cliente_2: string }>(
          query.text,
          params
        );

        if (result.rows.length > 0) {
          const status = this.normalizeString(result.rows[0].status_cliente_2);
          if (status) {
            this.logger.debug(`Found StatusCliente2: ${status} using ${query.description}`);
            return status;
          }
        }
      } catch (error) {
        this.logger.error(`Error in query ${query.description}:`, error as Error);
        // Continuar con la siguiente query en lugar de fallar
        continue;
      }
    }

    this.logger.warn(`No StatusCliente2 found, using default: ${defaultStatus}`);
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

  private formatDateForDisplay(value: Date | string | null): string | null {
    if (!value) {
      return null;
    }

    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) {
      return null;
    }

    // Formatear como DD/MM/YY
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = String(date.getFullYear()).slice(-2);

    return `${day}/${month}/${year}`;
  }

  async getDiccionarioEstaciones() {
    try {
      const result = await this.postgresService.query<{
        checkpoint: string;
        estacion: string;
        actividad: string;
        status_cliente_2: string;
      }>(`
        SELECT checkpoint, estacion, actividad, status_cliente_2
        FROM public.diccionario_estaciones
        ORDER BY status_cliente_2, checkpoint, estacion, actividad
      `);

      return {
        total: result.rows.length,
        registros: result.rows
      };
    } catch (error) {
      this.logger.error('Error fetching diccionario_estaciones:', error);
      throw error;
    }
  }
}
