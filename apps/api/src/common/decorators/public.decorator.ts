import { SetMetadata } from "@nestjs/common";

export const IS_PUBLIC_KEY = "isPublic";

/** Marks an endpoint as not requiring authentication (register, login, refresh, invitation lookup/accept). */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
