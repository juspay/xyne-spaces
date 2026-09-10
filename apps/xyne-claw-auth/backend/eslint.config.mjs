import tseslint from "typescript-eslint";

const slackFiles = ["src/surfaces/slack/**/*.ts"];
const standardHttpFiles = ["src/routes/**/*.ts", "src/middleware/**/*.ts"];
const protocolResponseFiles = ["src/routes/cli-auth.ts", "src/routes/flow-action.ts"];

export default [
  {
    files: standardHttpFiles,
    ignores: protocolResponseFiles,
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
      },
    },
    plugins: {
      "@typescript-eslint": tseslint.plugin,
    },
    rules: {
      // Standard API routes must use sendApiError()/HttpError instead of
      // hand-assembling response bodies. Warning-only during the legacy route
      // migration; protocol adapters are explicitly excluded below.
      "no-restricted-syntax": [
        "warn",
        {
          selector:
            "CallExpression[callee.property.name='json'] > ObjectExpression:has(Property[key.name='success'][value.value=false])",
          message: "Use sendApiError() or throw HttpError instead of a handwritten { success: false } envelope",
        },
        {
          selector:
            "CallExpression[callee.property.name='json'] > ObjectExpression:has(Property[key.name='type'][value.value='error'])",
          message: "Standard API routes must use sendApiError(); typed error actions belong only in protocol adapters",
        },
        {
          selector:
            "CallExpression[callee.property.name='json'] > ObjectExpression:has(Property[key.name='error']):not(:has(Property[key.name='success'])):not(:has(Property[key.name='type']))",
          message: "Use sendApiError() instead of a bare { error } response",
        },
      ],
    },
  },
  {
    files: slackFiles,
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
      },
    },
    plugins: {
      "@typescript-eslint": tseslint.plugin,
    },
    rules: {
      // ONE-DOOR HTTP: centralizing Slack Web API traffic in slackApi() keeps
      // authentication, timeouts, envelope checks, and typed failures consistent.
      "no-restricted-globals": [
        "error",
        {
          name: "fetch",
          message:
            "fetch() is only allowed in api.ts/client.ts — every Slack Web API call goes through slackApi()",
        },
      ],

      // NO ENV OUTSIDE CONFIG: one accessor owns the legacy environment fallback
      // so its retirement is explicit and request handlers cannot grow new env reads.
      "no-restricted-properties": [
        "error",
        {
          object: "process",
          property: "env",
          message:
            "NO ENV OUTSIDE CONFIG: read Slack environment values through const.ts accessors",
        },
      ],

      // NO MAGIC TENANT SENTINEL and NO ERROR-STRING MATCHING: named domain
      // values and typed SlackApiError codes keep branches refactor-safe.
      "no-restricted-syntax": [
        "error",
        {
          selector: "Property[key.name='surfaceTenantId'][value.value='']",
          message:
            "NO MAGIC TENANT SENTINEL: use ORG_LEVEL_TENANT_ID instead of an empty string",
        },
        {
          selector:
            "CallExpression[callee.property.name=/includes|startsWith/][callee.object.property.name='message']",
          message: "branch on SlackApiError.code, not error message text",
        },
      ],

      // STANDARD HYGIENE — no-console: the module logger preserves structured
      // context and production routing that direct console output would bypass.
      "no-console": "error",

      // STANDARD HYGIENE — eqeqeq: strict equality avoids coercion-dependent
      // authorization and tenant-routing behavior.
      eqeqeq: ["error", "always"],

      // STANDARD HYGIENE — no-unused-vars: dead bindings hide stale logic, while
      // leading underscores explicitly document intentionally unused parameters.
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],

      // STANDARD HYGIENE — prefer-const: immutable bindings make state changes
      // within asynchronous Slack request flows easier to audit.
      "prefer-const": "error",
    },
  },
  {
    files: ["src/surfaces/slack/api.ts"],
    rules: {
      // ONE-DOOR HTTP: api.ts is the implementation boundary that owns the
      // global transport after every caller has entered through slackApi().
      "no-restricted-globals": "off",
    },
  },
];
