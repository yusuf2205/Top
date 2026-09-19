import { Body, Controller, Get, HttpCode, Post, UseGuards } from "@nestjs/common";
import { ThrottlerGuard, Throttle } from "@nestjs/throttler";
import { submitQuoteSchema, type SubmitQuoteInput } from "@top/validation";
import { Public } from "../common/decorators/public.decorator";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import type { PortalContext } from "../common/types/authenticated-request";
import { PortalAuthGuard } from "./portal-auth.guard";
import { PortalCtx } from "./portal-context.decorator";
import { PortalService } from "./portal.service";

/**
 * M3.4 Supplier Portal Phase C (Architecture §3/§7-8). External, unauthenticated-
 * by-internal-JWT route surface — `@Public()` at the class level so the
 * internal JwtAuthGuard/TenantGuard/RolesGuard chain no-ops for every route
 * here; `PortalAuthGuard` is what actually authorizes each request, always
 * preceded by `ThrottlerGuard` in the SAME `@UseGuards()` array so a request
 * is rate-limited even when its bearer token is garbage/absent (an attacker
 * cannot bypass the throttle merely by sending invalid tokens — verified in
 * Phase B's portal-guard-order.spec.ts and re-verified for these real routes
 * in this phase's own security tests).
 *
 * Controller stays thin — all business rules live in PortalService.
 */
@Public()
@Controller("api/v1/portal/rfq")
export class PortalController {
  constructor(private readonly portal: PortalService) {}

  @UseGuards(ThrottlerGuard, PortalAuthGuard)
  @Throttle({ portal: { limit: 10, ttl: 60_000 } })
  @HttpCode(200)
  @Post("open")
  open(@PortalCtx() ctx: PortalContext) {
    return this.portal.open(ctx);
  }

  @UseGuards(ThrottlerGuard, PortalAuthGuard)
  @Throttle({ portal: { limit: 60, ttl: 60_000 } })
  @Get()
  get(@PortalCtx() ctx: PortalContext) {
    return this.portal.get(ctx);
  }

  @UseGuards(ThrottlerGuard, PortalAuthGuard)
  @Throttle({ portal: { limit: 10, ttl: 60_000 } })
  @HttpCode(200)
  @Post("quote")
  submitQuote(@PortalCtx() ctx: PortalContext, @Body(new ZodValidationPipe(submitQuoteSchema)) body: SubmitQuoteInput) {
    return this.portal.submitQuote(ctx, body);
  }

  @UseGuards(ThrottlerGuard, PortalAuthGuard)
  @Throttle({ portal: { limit: 10, ttl: 60_000 } })
  @HttpCode(200)
  @Post("decline")
  decline(@PortalCtx() ctx: PortalContext) {
    return this.portal.decline(ctx);
  }
}
