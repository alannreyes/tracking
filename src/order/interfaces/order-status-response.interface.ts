export interface OrderStatusResponse {
  OrdenCliente: string;
  NumItem: number | null;
  Fecha: Date | string | null;
  checkpoint: string | null;
  Estacion: string | null;
  Actividad: string | null;
  RazonSocial: string | null;
  Estado: string;
  StatusCliente2: string;
  FechaEstimadaEntrega: Date | string | null;
}
