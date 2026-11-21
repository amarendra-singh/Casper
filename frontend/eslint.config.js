import js from '@eslint/js'
import globals from 'globals'
import react from 'eslint-plugin-react'
import hooks from 'eslint-plugin-react-hooks'
import a11y from 'eslint-plugin-jsx-a11y'

export default [
  { ignores: ['dist/**', 'node_modules/**', 'audit/**'] },
  js.configs.recommended,
  {
    files: ['**/*.{js,jsx}'],
    languageOptions: { ecmaVersion: 'latest', sourceType: 'module', parserOptions: { ecmaFeatures: { jsx: true } }, globals: { ...globals.browser, ...globals.node } },
    plugins: { react, 'react-hooks': hooks, 'jsx-a11y': a11y },
    settings: { react: { version: 'detect' } },
    rules: {
      'react/jsx-uses-vars': 'error',
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      ...Object.fromEntries(Object.keys(a11y.configs.recommended.rules).map(rule => [rule, 'warn'])),
      // The deprecated rule duplicates label-has-associated-control and requires
      // both nesting and htmlFor. Keep the maintained association rule instead.
      'jsx-a11y/label-has-for': 'off',
      // Native table cells get names from their column headers; their child
      // buttons/inputs are checked separately by this rule.
      'jsx-a11y/control-has-associated-label': ['warn', { ignoreElements: ['td', 'th'], depth: 5 }],
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-console': ['warn', { allow: ['error', 'warn'] }],
      'eqeqeq': ['warn', 'always', { null: 'ignore' }],
      'curly': 'warn',
      'no-debugger': 'error',
      'no-var': 'error',
    },
  },
  { files: ['src/tests/**'], languageOptions: { globals: { ...globals.vitest } } },
  { files: ['**/*.cjs'], languageOptions: { sourceType: 'commonjs' } },
]
