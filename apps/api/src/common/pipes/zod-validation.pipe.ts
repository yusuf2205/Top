import { BadRequestException, PipeTransform } from "@nestjs/common";
import type { ZodSchema } from "zod";

/**
 * Validates req.body against a zod schema from @top/validation — the same
 * schema the frontend uses as its react-hook-form resolver, so shape can never
 * drift between client and server (see that package's own doc comment).
 * Use as `@Body(new ZodValidationPipe(registerSchema)) body: RegisterInput`.
 */
export class ZodValidationPipe implements PipeTransform {
  constructor(private readonly schema: ZodSchema) {}

  transform(value: unknown) {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      const message = result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
      throw new BadRequestException(message);
    }
    return result.data;
  }
}
