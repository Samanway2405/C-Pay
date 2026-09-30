module.exports = {
  root: true,
  extends: ['universe/native'],
  rules: {
    'no-console': ['error', { allow: ['debug', 'info', 'warn', 'error'] }] // allow is for logger.ts but actually we want to ban everywhere except logger.ts
  },
  overrides: [
    {
      files: ['src/utils/logger.ts'],
      rules: {
        'no-console': 'off',
      },
    },
    {
      files: ['src/**/*.ts', 'src/**/*.tsx'],
      excludedFiles: ['src/utils/logger.ts'],
      rules: {
        'no-console': 'error',
      },
    },
  ],
};
