import { PasswordService } from "./password.service";

describe("PasswordService", () => {
  const service = new PasswordService();

  it("hashes a password and verifies the correct password against it", async () => {
    const hash = await service.hash("correct-horse-battery-staple");
    expect(hash).toMatch(/^scrypt\$/);
    await expect(service.verify(hash, "correct-horse-battery-staple")).resolves.toBe(true);
  });

  it("rejects an incorrect password", async () => {
    const hash = await service.hash("correct-horse-battery-staple");
    await expect(service.verify(hash, "wrong-password")).resolves.toBe(false);
  });

  it("never stores the password in plain text", async () => {
    const password = "correct-horse-battery-staple";
    const hash = await service.hash(password);
    expect(hash).not.toContain(password);
  });

  it("produces a different hash for the same password each time (random salt)", async () => {
    const a = await service.hash("same-password");
    const b = await service.hash("same-password");
    expect(a).not.toEqual(b);
    await expect(service.verify(a, "same-password")).resolves.toBe(true);
    await expect(service.verify(b, "same-password")).resolves.toBe(true);
  });

  it("rejects gracefully on a malformed stored hash instead of throwing", async () => {
    await expect(service.verify("not-a-real-hash", "anything")).resolves.toBe(false);
  });
});
