module.exports = {
  extends: ['@commitlint/config-conventional'],
  ignores: [commit => commit.includes('[skip ci]')],
  rules: {
    'scope-enum': [
      2,
      'always',
      [
        '2d',
        'core',
        'e2e',
        'host',
        'legacy',
        'player',
        'studio',
        'template',
        'ui',
        'vite-plugin',
      ],
    ],
  },
};
