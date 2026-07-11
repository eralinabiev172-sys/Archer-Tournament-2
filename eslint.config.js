import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist', 'backup-before-tournament-fixes', '.tmp-five-check']),
  {
    files: ['src/**/*.{js,jsx}', 'admin/**/*.{js,jsx}', 'user-site/**/*.{js,jsx}', 'shared/**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
  },
  {
    files: ['api/**/*.{js,mjs}', 'backend/**/*.{js,mjs}', 'lib/**/*.{js,mjs}', '*.config.js', 'vite.config.js'],
    extends: [js.configs.recommended],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },
])
