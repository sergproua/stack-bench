import { WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { Server } from 'socket.io';

@WebSocketGateway({ cors: { origin: '*' } })
export class SummaryGateway {
  @WebSocketServer()
  server!: Server;

  emitSummaryUpdate(payload: { data: unknown; meta: unknown }) {
    this.server.emit('summary:update', payload);
  }
}
