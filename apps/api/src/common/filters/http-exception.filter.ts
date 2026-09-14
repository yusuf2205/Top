import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from "@nestjs/common";
import type { Response } from "express";

/** Unified error shape for every 4xx/5xx response — see M1 implementation report §"API error format". */
interface ErrorResponseBody {
  statusCode: number;
  code: string;
  message: string;
}

const STATUS_CODES: Record<number, string> = {
  400: "BAD_REQUEST",
  401: "UNAUTHORIZED",
  403: "FORBIDDEN",
  404: "NOT_FOUND",
  409: "CONFLICT",
  422: "UNPROCESSABLE_ENTITY",
  429: "TOO_MANY_REQUESTS",
};

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger("ExceptionFilter");

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      const message =
        typeof body === "string" ? body : Array.isArray((body as any)?.message) ? (body as any).message.join("; ") : ((body as any)?.message ?? exception.message);

      const payload: ErrorResponseBody = {
        statusCode: status,
        code: STATUS_CODES[status] ?? "ERROR",
        message,
      };
      response.status(status).json(payload);
      return;
    }

    // Never leak internals (stack traces, DB errors) to the client — log server-side only.
    this.logger.error(exception instanceof Error ? exception.stack : exception);
    const payload: ErrorResponseBody = {
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      code: "INTERNAL_ERROR",
      message: "An unexpected error occurred",
    };
    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json(payload);
  }
}
