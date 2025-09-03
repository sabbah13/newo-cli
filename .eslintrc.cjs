module.exports = {
  env: {
    browser: false,
    es2022: true,
    node: true,
    mocha: true
  },
  extends: [
    'eslint:recommended'
  ],
  parserOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module'
  },
  rules: {
    // Code style
    'indent': ['error', 2],
    'linebreak-style': ['error', 'unix'],
    'quotes': ['error', 'single'],
    'semi': ['error', 'always'],
    
    // Best practices
    'no-unused-vars': ['error', { 'argsIgnorePattern': '^_' }],
    'no-console': 'off', // CLI tool needs console output
    'prefer-const': 'error',
    'no-var': 'error',
    
    // ES6+
    'arrow-spacing': 'error',
    'prefer-arrow-callback': 'error',
    'prefer-template': 'error',
    
    // Security
    'no-eval': 'error',
    'no-implied-eval': 'error',
    'no-new-func': 'error'
  },
  globals: {
    // Test globals
    'describe': 'readonly',
    'it': 'readonly',
    'before': 'readonly',
    'after': 'readonly',
    'beforeEach': 'readonly',
    'afterEach': 'readonly'
  },
  overrides: [
    {
      files: ['test/**/*.js'],
      env: {
        mocha: true
      },
      rules: {
        'no-unused-expressions': 'off' // For chai assertions
      }
    }
  ]
};