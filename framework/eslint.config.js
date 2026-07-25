import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import importPlugin from 'eslint-plugin-import'; // Import the plugin
import eslintConfigPrettier from "eslint-config-prettier"; // Import prettier config
// import cspellConfigs from '@cspell/eslint-plugin/configs';

export default tseslint.config(
  // Global ignores
  {
    ignores: [
      "node_modules/",
      "dist/",
      "coverage/"
      // Add any other directories or files to ignore
    ],
  },

  // Base JavaScript recommended rules
  js.configs.recommended,

  // TypeScript recommended type-checked rules
  ...tseslint.configs.recommendedTypeChecked,

  // Configuration for TypeScript files, including parser options and specific rules
  {
    files: ["**/*.ts", "**/*.tsx"], // Target TypeScript files
    languageOptions: {
      parser: tseslint.parser, // Use the TypeScript parser
      parserOptions: {
        project: true,
        tsconfigRootDir: import.meta.dirname,
      }
    },
    rules: {
      // Enforce explicit return types on functions and class methods
      "@typescript-eslint/explicit-function-return-type": "warn",
      // Disallow the use of 'any' type
      "@typescript-eslint/no-explicit-any": "warn",
      // Warn about unused variables, allowing those prefixed with _
      "@typescript-eslint/no-unused-vars": ["warn", { "argsIgnorePattern": "^_", "varsIgnorePattern": "^_" }],
      // Disallow unused expressions
      "@typescript-eslint/no-unused-expressions": "error",
      // Prefer const over let for variables that are never reassigned
      "prefer-const": "error",

      // --- START: Naming Convention Rules ---
      "@typescript-eslint/naming-convention": [
        "warn", // Use "error" to enforce strictly, "warn" for guidance
        // Default format for variables, functions, and parameters: camelCase
        // Allow leading underscore for parameters/variables that are intentionally unused
        {
          selector: "default",
          format: ["PascalCase", "camelCase", "UPPER_CASE"],
          leadingUnderscore: "allow",
          trailingUnderscore: "forbid",
        },
        // Variables: camelCase, allow PascalCase (for components/classes), allow UPPER_CASE (for constants)
        {
          selector: "variable",
          format: ["camelCase", "PascalCase", "UPPER_CASE"],
          leadingUnderscore: "allow", // Allow _myVar for unused or private module-level variables
        },
        // Functions: camelCase, allow PascalCase (for React components)
        {
          selector: "function",
          format: ["camelCase", "PascalCase"],
        },
        // Parameters: camelCase, allow leading underscore if unused (covered by no-unused-vars config too)
        {
          selector: "parameter",
          format: ["camelCase"],
          leadingUnderscore: "allow",
        },
        // Properties: camelCase, allow leading underscore (for private/protected convention)
        // Allow UPPER_CASE for static readonly properties (constants)
        {
          selector: "property",
          format: ["PascalCase","camelCase", "UPPER_CASE"], // Add PascalCase if you assign components/classes to properties
          leadingUnderscore: "allow", // Allow _prop convention
        },
        // Allow colon notation for event type property names (e.g., 'pipeline:started', 'tool:completed')
        {
          selector: "property",
          format: null,
          filter: {
            regex: "^[a-z]+:[a-z_]+$",
            match: true
          }
        },
        // Type-like elements (classes, interfaces, type aliases, enums): PascalCase
        {
          selector: "typeLike", // Catches class, interface, typeAlias, enum
          format: ["PascalCase"],
          leadingUnderscore: "allow", // Allow _ClassName for unused classes
        },
        // Enum members: PascalCase (modern standard)
        {
          selector: "enumMember",
          format: ["UPPER_CASE"], // Or change to UPPER_CASE if that's your team's standard
        },
        // Type parameters (generics): PascalCase, often prefixed with T, K, V, U
        {
          selector: "typeParameter",
          format: ["PascalCase"],
          // Optionally add prefix: prefix: ["T", "K", "V", "U"], (can be restrictive)
        },
        // Private/Protected members: Allow leading underscore (enforce camelCase)
        // Note: This overlaps slightly with the general 'property' rule but makes the intent clearer.
        // You could enforce the underscore using "leadingUnderscore": "require" if desired.
        {
          selector: "memberLike",
          modifiers: ["private", "protected"],
          format: ["camelCase"],
          leadingUnderscore: "allow", // Change to "require" to enforce starting with _
        },
      ],
      // --- END: Naming Convention Rules ---

      // Add other TS-specific rules here
    }
  },

  // Tests are excluded from tsconfig.json, so type-aware linting can't resolve
  // them. Turn off type-checked rules for test files (also silences the
  // unbound-method false positives on Jest mocks).
  {
    files: ["**/*.test.ts", "**/*.test.tsx", "**/__tests__/**/*.ts", "**/__tests__/**/*.tsx"],
    ...tseslint.configs.disableTypeChecked,
  },


  // General rules for all JS/TS files
  {
    files: ["**/*.{js,mjs,cjs,ts}"],
    rules: {
      // Enforce strict equality (=== and !==)
      "eqeqeq": ["error", "always"],
      // Disallow the use of console.log in production (warn for now)
      "no-console": "warn",
      // Enforce curly braces for all control statements
      "curly": ["error", "all"],
      // Disallow variable declarations from shadowing variables declared in the outer scope
      // Use the TypeScript version for better compatibility (already configured above for TS files)
      // "@typescript-eslint/no-shadow": "error", // Moved to TS specific section
      // Prefer early returns over else blocks when possible
      "no-else-return": "warn",
      // Add other general rules here
    }
  },

  // Node.js environment globals
  {
    files: ["**/*.{js,mjs,cjs,ts}"], // Apply to all relevant files
    languageOptions: {
      globals: {
        ...globals.node, // Enable Node.js global variables
      },
    },
  },
  // {
  //   plugins: {import: cspell},
  //   rules: {
  //     '@cspell/spellchecker': [
  //       'warn',
  //       {
  //         // Configuration options for the spellchecker
  //         'checkComments': true,
  //         'checkStrings': true,
  //         'checkIdentifiers': true,
  //         'autoFix': false,
  //         'numSuggestions': 3,
  //         'cspell': {
  //           // Path to your cspell configuration file (optional)
  //           'configFile': './cspell.config.js',
  //         },
  //         'skipWords': ['eslint', 'javascript', 'typescript', 'camelcase'], // Words to ignore
  //       },
  //     ],
  //   },
  // },
  // eslint-plugin-import configuration
  {
    files: ["**/*.{js,mjs,cjs,ts,tsx}"], // Apply to all relevant script files
    plugins: { import: importPlugin },
    settings: {
      // Tell eslint-plugin-import how to resolve modules
      'import/resolver': {
        node: true,
        typescript: {
          project: './tsconfig.json',
          alwaysTryTypes: true
        },
        extensions: ['.js', '.jsx', '.ts', '.tsx', '.d.ts']
      },
    },
    rules: {
      // Import ordering
      // 'import/order': [
      //   'warn',
      //   {
      //     groups: ['builtin', 'external', 'internal', ['parent', 'sibling', 'index'], 'object', 'type'],
      //     'newlines-between': 'always',
      //     alphabetize: { order: 'asc', caseInsensitive: true },
      //   },
      // ],
      // Prevent duplicate imports
      'import/no-duplicates': [
        'error'
      ],
      // Ensure all imports appear before other statements
      // 'import/first': 'error',

      // Add other import rules as needed
    },
  },

  // Prettier configuration - MUST BE LAST
  // Disables ESLint rules that conflict with Prettier.
  eslintConfigPrettier,
  // cspellConfigs.recommended, // The base recommended configuration
  // {
  //   // Add your customizations here
  //   rules: {
  //     '@cspell/spellchecker': [
  //       'warn', // You can change the severity (e.g., 'error')
  //       {
  //         checkComments: false, // Disable spell checking for comments
  //         autoFix: true, // Enable autofix for preferred suggestions
  //         // Add other customization options as needed
  //       },
  //     ],
  //   },
  // },
);