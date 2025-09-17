import { Controller, Get } from '@nestjs/common';

@Controller()
export class HealthController {
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
} 