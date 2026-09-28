import nextCoreWebVitals from 'eslint-config-next/core-web-vitals';
import nextTypescript from 'eslint-config-next/typescript';

/** eslint-config-next ships flat configs, so they are spread in directly. */
const config = [
  {
    ignores: [
      '.next/**',
      'node_modules/**',
      'lib/db/migrations/**',
      'next-env.d.ts',
      'data/**',
    ],
  },
  ...nextCoreWebVitals,
  ...nextTypescript,
];

export default config;
