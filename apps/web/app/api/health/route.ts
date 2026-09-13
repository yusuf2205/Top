import { NextResponse } from "next/server";
import type { HealthStatus } from "@top/types";

// Used by the Docker healthcheck for the `web` service (docker-compose.yml).
export function GET() {
  const body: HealthStatus = {
    status: "ok",
    service: "web",
    timestamp: new Date().toISOString(),
  };
  return NextResponse.json(body);
}
