/**
 * chain-monitor
 *
 * 区块链事件监控库，支持双模式：
 * - racing: 竞速型，追求极致速度
 * - sequential: 业务型，保证事件顺序
 */

// 核心类
export { ChainMonitor } from './ChainMonitor.js'

// 默认实现
export { MemoryStateStorage } from './MemoryStateStorage.js'
export { ConsoleLogger } from './ConsoleLogger.js'

// 类型
export type {
  MonitorMode,
  BlockRange,
  LogSelector,
  LogProcessor,
  TransactionWrapper,
  StateStorage,
  Logger,
  ChainMonitorConfig,
} from './types.js'
