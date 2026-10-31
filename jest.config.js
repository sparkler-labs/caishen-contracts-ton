/** 测试命令（add-ton-chain-support 3.1）：@ton/sandbox 链上模拟，jest 单进程跑 */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['<rootDir>/tests/**/*.spec.ts'],
};
