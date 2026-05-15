module.exports = {
  root: true,
  env: { browser: true, es2022: true },
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:react-hooks/recommended',
  ],
  ignorePatterns: ['dist', '.eslintrc.cjs', 'node_modules'],
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
    ecmaFeatures: { jsx: true },
  },
  plugins: ['react-refresh'],
  rules: {
    'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
    // Accept underscore-prefixed args/vars as intentionally unused. Lets us
    // keep parameter shape for API/typing reasons (e.g. mutation hooks that
    // no longer use their folderId arg but call sites still pass it).
    '@typescript-eslint/no-unused-vars': [
      'error',
      {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
      },
    ],
  },
  overrides: [
    {
      // shadcn/ui copy-paste pattern: Component + cva *Variants helper
      // co-export'u standart (Button + buttonVariants, Label + labelVariants).
      // react-refresh/only-export-components bu pattern'de Fast Refresh
      // uyarısı verir; UI primitives klasöründe kapatıyoruz.
      files: ['src/components/ui/**/*.{ts,tsx}'],
      rules: {
        'react-refresh/only-export-components': 'off',
      },
    },
  ],
};
