import { Logger } from "@nestjs/common";
import { OnGatewayConnection, OnGatewayDisconnect, OnGatewayInit, WebSocketGateway, WebSocketServer } from "@nestjs/websockets";
import type { Server, Socket } from "socket.io";
import { loadEnv } from "@top/config";
import { organizationRoom } from "@top/types";
import type { AccessTokenClaims } from "../common/types/authenticated-request";
import { SocketAuthService } from "./socket-auth.service";
import { DomainEventsService } from "./domain-events.service";

/**
 * Realtime Foundation. Server-push only in this phase — no
 * `@SubscribeMessage` handlers, no client-to-server business messages, no
 * arbitrary client-requested room joins. A connection authenticates once at
 * handshake time and is placed in exactly one room: its own organization's
 * (`org:<organizationId>`, from server-verified JWT claims — never a
 * client-supplied string). See SocketAuthService for the auth mechanics and
 * DomainEventsService for what actually gets published into that room.
 *
 * Auth runs as Socket.IO NAMESPACE MIDDLEWARE (`server.use(...)` in
 * `afterInit`), not inside `handleConnection`. This matters: by the time a
 * NestJS gateway's `handleConnection` fires, the client has ALREADY received
 * its `connect` event — rejecting there would mean "briefly connects, then
 * immediately gets disconnected," which is both a worse client experience
 * and awkward to test. Namespace middleware runs during the handshake
 * itself: `next(new Error(...))` refuses the connection outright, and the
 * client observes a single `connect_error` — it never sees `connect` at
 * all. `handleConnection` below then only ever runs for an
 * already-authenticated socket, so the room join is unconditional there.
 *
 * `cors.origin` is a function (not a precomputed array) so `loadEnv()` is
 * called lazily per-connection, matching this codebase's existing
 * lazy-loadEnv discipline (see TokenService) rather than reading env at
 * module-import time.
 */
@WebSocketGateway({
  cors: {
    origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
      const allowed = loadEnv()
        .ALLOWED_ORIGINS.split(",")
        .map((o) => o.trim());
      callback(null, !origin || allowed.includes(origin));
    },
    credentials: true,
  },
})
export class RealtimeGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() private readonly server!: Server;
  private readonly logger = new Logger(RealtimeGateway.name);

  constructor(
    private readonly socketAuth: SocketAuthService,
    private readonly events: DomainEventsService
  ) {}

  afterInit(server: Server): void {
    this.events.attachServer(server);

    server.use((socket: Socket, next: (err?: Error) => void) => {
      this.socketAuth
        .authenticate(socket)
        .then((claims) => {
          socket.data.user = claims;
          next();
        })
        .catch((err: unknown) => {
          // Diagnostic detail stays server-side only — the client gets a
          // single generic message via `next(new Error(...))`, never a
          // stack trace or any credential material (see the class doc
          // comment on the middleware-vs-handleConnection distinction).
          this.logger.warn(`Socket handshake rejected: ${err instanceof Error ? err.message : "unknown error"}`);
          next(new Error("Unauthorized"));
        });
    });
  }

  async handleConnection(client: Socket): Promise<void> {
    // The namespace middleware above already authenticated this socket —
    // a connection that failed auth never reaches here at all.
    const claims = client.data.user as AccessTokenClaims;
    await client.join(organizationRoom(claims.organizationId));
  }

  handleDisconnect(_client: Socket): void {
    // Socket.IO removes room membership automatically on disconnect. No
    // server-side per-socket state to reconcile in this foundation — missed
    // events are handled by REST reconciliation on the client, not replay.
  }
}
