import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { OrderStatusRequestDto } from './dto/order-status-request.dto';
import { OrderStatusResponse } from './interfaces/order-status-response.interface';
import { OrderService } from './order.service';

@Controller('estado-pedido')
export class OrderController {
  constructor(private readonly orderService: OrderService) {}

  @Post()
  @HttpCode(200)
  async getOrderStatus(@Body() body: OrderStatusRequestDto): Promise<OrderStatusResponse[]> {
    return this.orderService.getOrderStatus(body);
  }
}
