/** @type {import('jest').Config} */
module.exports = {
  rootDir: ".",
  roots: ["<rootDir>/src", "<rootDir>/test"],
  testEnvironment: "node",
  transform: { "^.+\\.ts$": ["ts-jest", { tsconfig: "tsconfig.json" }] },
  testRegex: ".*\\.spec\\.ts$",
  moduleFileExtensions: ["js", "json", "ts"],
  // Integration/security specs need a real Postgres (docker compose's `postgres`
  // service) — see test/setup-integration.ts. Unit specs (password/token
  // services) have no such dependency and run anywhere.
  testTimeout: 15000,
};
