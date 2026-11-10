module.exports = {
  ...require('./jest.config.cjs'),
  testMatch: [
    '<rootDir>/test/worker-failures.live.ts',
    '<rootDir>/test/dependency-failures.live.ts',
  ],
};
