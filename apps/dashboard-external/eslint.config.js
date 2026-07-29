import tseslint from 'typescript-eslint';
import reactHooksPlugin from 'eslint-plugin-react-hooks';
import importPlugin from 'eslint-plugin-import';
import globals from 'globals';

export default tseslint.config(
  {
    ignores: [
      'node_modules/',
      'dist/',
      '*.config.js',
      '*.config.ts',
    ],
  },
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.{ts,tsx}'],
    plugins: {
      'react-hooks': reactHooksPlugin,
      'import': importPlugin,
    },
    languageOptions: {
      parser: tseslint.parser,
      globals: {
        ...globals.browser,
        ...globals.es2020,
      },
    },
    rules: {
      ...reactHooksPlugin.configs.recommended.rules,
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',

      // Enforce that dashboard-external/src only directly imports the
      // approved entry points from dashboard/src. The full transitive graph is
      // validated by dependency-cruiser (npm run lint:deps).
      'import/no-restricted-paths': ['error', {
        zones: [{
          target: './src',
          from: '../dashboard/src',
          except: [
            '../dashboard/src/machines/roomMachine.ts',
            '../dashboard/src/components/Call/CallViews/FullCallView.tsx',
            '../dashboard/src/services/Call/callLobbyService.ts',
            '../dashboard/src/components/Call/hooks/useHandRaise.ts',
          ],
          message:
            'dashboard-external may only import the approved entry points from dashboard/src ' +
            '(roomMachine, FullCallView, callLobbyService, useHandRaise). ' +
            'To add a new one update .dependency-cruiser.cjs and get a review.',
        }],
      }],
    },
  },
);
