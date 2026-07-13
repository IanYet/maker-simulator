/** @type {import('lint-staged').Configuration} */
export default {
  '*.{js,cjs,mjs,jsx,ts,tsx,css,scss,json,jsonc}': 'prettier --write --ignore-unknown',
}
