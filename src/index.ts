/**
 * evm-chain-monitor
 *
 * 轻量级 EVM 区块链事件监控库，支持双模式：
 * - racing: 竞速型，追求极致速度
 * - sequential: 业务型，保证事件顺序
 */

// 核心类
export { ChainMonitor } from './ChainMonitor.js'

// 默认实现
export { MemoryStateStorage } from './MemoryStateStorage.js'
export { PrismaStateStorage, type PrismaClientLike } from './PrismaStateStorage.js'
export { ConsoleLogger } from './ConsoleLogger.js'

// 辅助函数
export {
  eventTopic,
  eventTopics,
  createLogSelector,
  createParsedEvent,
} from './helpers.js'

// 类型
export type {
  // 模式和基础类型
  MonitorMode,
  BlockRange,
  LogSelector,
  LogProcessor,

  // 简化 API
  SimpleMonitorConfig,
  ParsedEvent,
  EventHandler,

  // 完整 API
  ChainMonitorConfig,
  TransactionWrapper,
  StateStorage,
  Logger,
} from './types.js'
