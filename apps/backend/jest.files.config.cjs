module.exports = {
  ...require('./jest.config.cjs'),
  testMatch: ['<rootDir>/test/files.live.ts', '<rootDir>/test/files-cursor.live.ts'],
};
