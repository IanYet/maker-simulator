/** @type {import('prettier').Config} */
export default {
  printWidth: 100,
  semi: false,
  singleQuote: true,
  trailingComma: 'all',
  useTabs: true,
  overrides: [
    {
      files: ['*.json', '*.jsonc', '*.config.{js,cjs,mjs,ts}'],
      options: {
        tabWidth: 2,
        useTabs: false,
      },
    },
  ],
}
