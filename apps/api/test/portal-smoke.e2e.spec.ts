import { createTestApp } from "./test-app";
import type { INestApplication } from "@nestjs/common";

describe("Phase C smoke — app boots with PortalModule wired", () => {
  it("initializes without DI errors", async () => {
    let app: INestApplication | undefined;
    try {
      app = await createTestApp();
      expect(app).toBeDefined();
    } finally {
      await app?.close();
    }
  });
});
