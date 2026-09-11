const nodeGlobals = {
  Buffer: 'readonly',
  __dirname: 'readonly',
  __filename: 'readonly',
  clearInterval: 'readonly',
  clearTimeout: 'readonly',
  console: 'readonly',
  fetch: 'readonly',
  module: 'readonly',
  process: 'readonly',
  require: 'readonly',
  setInterval: 'readonly',
  setTimeout: 'readonly',
};

const browserGlobals = {
  alert: 'readonly',
  $: 'readonly',
  bootstrap: 'readonly',
  Chart: 'readonly',
  confirm: 'readonly',
  document: 'readonly',
  fetch: 'readonly',
  FormData: 'readonly',
  google: 'readonly',
  Headers: 'readonly',
  localStorage: 'readonly',
  location: 'readonly',
  prompt: 'readonly',
  URL: 'readonly',
  window: 'readonly',
};

module.exports = [
  {
    ignores: [
      'node_modules/**',
      'public/javascripts/jquery-*.js',
      'public/javascripts/bootstrap*.js',
      'public/javascripts/popper*.js',
      'uploads/**',
      'data/**',
      'coverage/**',
    ],
  },
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: nodeGlobals,
    },
    rules: {
      'no-constant-condition': ['error', { checkLoops: false }],
      'no-undef': 'error',
      'no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          caughtErrors: 'all',
          caughtErrorsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
        },
      ],
      'no-unreachable': 'error',
      'no-useless-catch': 'error',
      eqeqeq: ['error', 'always'],
    },
  },
  {
    files: ['public/javascripts/**/*.js'],
    languageOptions: {
      sourceType: 'script',
      globals: browserGlobals,
    },
  },
];
