/**
 * chain-monitor
 *
 * 区块链事件监控库，支持双模式：
 * - racing: 竞速型，追求极致速度
 * - sequential: 业务型，保证事件顺序
 */

export { ChainMonitor } from './ChainMonitor.js'

export type {
  MonitorMode,
  BlockRange,
  LogSelector,
  LogProcessor,
  TransactionWrapper,
  StateStorage,
  ChainMonitorConfig,
} from './types.js'
