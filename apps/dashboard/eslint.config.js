import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import reactPlugin from "eslint-plugin-react";
import reactHooksPlugin from "eslint-plugin-react-hooks";
import jsxA11yPlugin from "eslint-plugin-jsx-a11y";
import eslintConfigPrettier from "eslint-config-prettier";
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

const localRules = {
  rules: {
    'no-fetch-use-axios': require('./eslint-rules/no-fetch-use-axios.cjs'),
    'no-rocicorp-define-query': require('../../packages/shared/eslint-rules/no-rocicorp-define-query.cjs'),
    'no-rocicorp-use-query': require('./eslint-rules/no-rocicorp-use-query.cjs'),
    'no-rocicorp-use-zero': require('./eslint-rules/no-rocicorp-use-zero.cjs'),
    'no-date-now-or-uuid-in-mutators': require('./eslint-rules/no-date-now-or-uuid-in-mutators.cjs'),
    'require-tracking-on-click': require('./eslint-rules/require-tracking-on-click.cjs'),
    'require-is-deleted-filter': require('../../packages/shared/eslint-rules/require-is-deleted-filter.cjs'),
    'require-initial-message-md-in-conversation-insert': require('./eslint-rules/require-initial-message-md-in-conversation-insert.cjs'),
    'no-direct-message-lookup-in-mutators': require('./eslint-rules/no-direct-message-lookup-in-mutators.cjs'),
  }
};

export default tseslint.config(
  // Global ignores
  {
    ignores: [
      "node_modules/",
      "dist/",
      "dist-electron/",
      "coverage/",
      "build/",
      ".vite/",
      "*.config.js",
      "*.config.ts",
      "src/object-graph/**/*",
      "*.cjs",
      "public/**/*",
      "src2/**/*",
      "eslint-rules/**/*",
      "electron/preload.ts",
      // Node-side build/eval scripts. Outside tsconfig.app.json, so the
      // type-checked rules cannot resolve them.
      "scripts/**/*"
    ],
  },

  // Base JavaScript recommended rules
  js.configs.recommended,

  // TypeScript recommended type-checked rules
  ...tseslint.configs.recommendedTypeChecked,

  // React configuration
  {
    files: ["**/*.{js,jsx,ts,tsx}"],
    plugins: {
      react: reactPlugin,
      "react-hooks": reactHooksPlugin,
      "jsx-a11y": jsxA11yPlugin,
      "local-rules": localRules,
    },
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.es2020,
      },
      parserOptions: {
        ecmaFeatures: {
          jsx: true,
        },
      },
    },
    settings: {
      react: {
        version: "detect",
      },
    },
    rules: {
      ...reactPlugin.configs.recommended.rules,
      ...reactHooksPlugin.configs.recommended.rules,
      ...jsxA11yPlugin.configs.recommended.rules,
      // Autofocus is intentional for modals, comboboxes, and editors (see Canvas, chat input).
      "jsx-a11y/no-autofocus": "off",
      "react/react-in-jsx-scope": "off",
      "react/prop-types": "off",
      "local-rules/no-fetch-use-axios": "error",
      "local-rules/no-rocicorp-define-query": "error",
      "local-rules/no-rocicorp-use-query": "error",
      "local-rules/no-rocicorp-use-zero": "error",
      "local-rules/no-date-now-or-uuid-in-mutators": "error",
      "local-rules/require-is-deleted-filter": "error",
      "local-rules/require-initial-message-md-in-conversation-insert": "error",
      "local-rules/no-direct-message-lookup-in-mutators": "error",
      "local-rules/require-tracking-on-click": ["error", {
        exemptComponents: [],
        exemptDataTestIds: [],
      }],
    },
  },

  // Disable tracking requirement for reusable UI components
  {
    files: ["src/components/ui/**/*.{ts,tsx}"],
    rules: {
      "local-rules/require-tracking-on-click": "off",
    },
  },

  // TypeScript specific configuration for src files
  {
    files: ["src/**/*.ts", "src/**/*.tsx"],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        project: "./tsconfig.app.json",
        tsconfigRootDir: import.meta.dirname,
      }
    },
    rules: {
      // Enforce explicit return types on functions and class methods
      "@typescript-eslint/explicit-function-return-type": "warn",
      // Disallow the use of 'any' type
      "@typescript-eslint/no-explicit-any": "error",
      // Warn about unused variables, allowing those prefixed with _
      "@typescript-eslint/no-unused-vars": ["error", { "argsIgnorePattern": "^_", "varsIgnorePattern": "^_" }],
      // Disallow unused expressions
      "@typescript-eslint/no-unused-expressions": "error",
      // Prefer const over let for variables that are never reassigned
      "prefer-const": "error",

      // Naming Convention Rules
      "@typescript-eslint/naming-convention": [
        "warn",
        {
          selector: "default",
          format: ["PascalCase", "camelCase", "UPPER_CASE"],
          leadingUnderscore: "allow",
          trailingUnderscore: "forbid",
        },
        {
          selector: "variable",
          format: ["camelCase", "PascalCase", "UPPER_CASE"],
          leadingUnderscore: "allow",
        },
        {
          selector: "function",
          format: ["camelCase", "PascalCase"],
        },
        {
          selector: "parameter",
          format: ["camelCase"],
          leadingUnderscore: "allow",
        },
        {
          selector: "property",
          format: ["PascalCase", "camelCase", "UPPER_CASE"],
          leadingUnderscore: "allow",
        },
        {
          selector: "typeLike",
          format: ["PascalCase"],
          leadingUnderscore: "allow",
        },
        {
          selector: "enumMember",
          format: ["UPPER_CASE"],
        },
        {
          selector: "typeParameter",
          format: ["PascalCase"],
        },
        {
          selector: "memberLike",
          modifiers: ["private", "protected"],
          format: ["camelCase"],
          leadingUnderscore: "allow",
        },
      ],
    }
  },

  // TypeScript specific configuration for electron files
  {
    files: ["electron/**/*.ts"],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        project: "./tsconfig.electron.json",
        tsconfigRootDir: import.meta.dirname,
      }
    },
    rules: {
      "@typescript-eslint/explicit-function-return-type": "warn",
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": ["error", { "argsIgnorePattern": "^_", "varsIgnorePattern": "^_" }],
      "@typescript-eslint/no-unused-expressions": "error",
      "prefer-const": "error",
    }
  },

  // General rules for all JS/TS files
  {
    files: ["**/*.{js,mjs,cjs,ts,tsx}"],
    rules: {
      // Enforce strict equality (=== and !==)
      "eqeqeq": ["error", "always"],
      // Disallow direct console use in production
      "no-console": "error",
      // Enforce curly braces for all control statements
      "curly": ["error", "all"],
      // Prefer early returns over else blocks when possible
      "no-else-return": "warn",
    }
  },

  // Prettier configuration - MUST BE LAST
  eslintConfigPrettier,
);
