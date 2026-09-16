/** @type {import('jest').Config} */
module.exports = {
  rootDir: ".",
  roots: ["<rootDir>/lib"],
  testEnvironment: "node",
  transform: { "^.+\\.tsx?$": ["ts-jest", { tsconfig: "tsconfig.json" }] },
  testRegex: ".*\\.spec\\.ts$",
  moduleFileExtensions: ["js", "json", "ts", "tsx"],
};
