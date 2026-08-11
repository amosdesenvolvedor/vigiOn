module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  plugins: ['@typescript-eslint'],
  extends: ['eslint:recommended', 'plugin:@typescript-eslint/recommended'],
  parserOptions: { project: './tsconfig.json', tsconfigRootDir: __dirname },
  env: { node: true, es2022: true },
  ignorePatterns: ['dist'],
};
