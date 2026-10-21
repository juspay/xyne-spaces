module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  plugins: ['@typescript-eslint'],
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
  },
  env: {
    browser: true,
    es2022: true,
    node: true,
  },
  rules: {
    'no-console': 'error',
    'no-restricted-globals': [
      'error',
      {
        name: 'fetch',
        message:
          "Use net.fetch from 'electron'. Node's fetch cannot present the device mTLS client certificate, so requests to mTLS hosts fail with ERR_SSL_CLIENT_AUTH_CERT_NEEDED.",
      },
    ],
    'no-restricted-properties': [
      'error',
      {
        object: 'globalThis',
        property: 'fetch',
        message: "Use net.fetch from 'electron' (see no-restricted-globals: fetch).",
      },
      {
        object: 'window',
        property: 'fetch',
        message: "Use net.fetch from 'electron' (see no-restricted-globals: fetch).",
      },
    ],
  },
};
