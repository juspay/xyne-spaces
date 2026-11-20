import tseslint from "typescript-eslint";

const SSRF_SAFE_FETCH_MESSAGE =
  "Raw fetch: check user-influenced URLs with assertSafeOutboundUrl (xyne-claw-mcp-common/outbound-url).";

export default [
  { ignores: ["**/*.test.ts", "**/__fixtures__/**"] },
  {
    files: ["src/**/*.ts"],
    languageOptions: { parser: tseslint.parser, parserOptions: { ecmaVersion: "latest", sourceType: "module" } },
    plugins: { "@typescript-eslint": tseslint.plugin },
    rules: {
      "no-restricted-globals": ["error", { name: "fetch", message: SSRF_SAFE_FETCH_MESSAGE }],
      "no-restricted-properties": ["error", { object: "globalThis", property: "fetch", message: SSRF_SAFE_FETCH_MESSAGE }],
    },
  },
];
