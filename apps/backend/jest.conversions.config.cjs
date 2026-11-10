module.exports = {
  ...require('./jest.config.cjs'),
  testMatch: ['<rootDir>/test/conversions.live.ts', '<rootDir>/test/concurrent-admission.live.ts'],
};
