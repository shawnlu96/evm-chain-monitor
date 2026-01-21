import type { Log, JsonRpcProvider } from 'ethers'

/**
 * 监控模式
 * - racing: 竞速型，WS 和 HTTP 并行处理，先到先得
 * - sequential: 业务型，WS 触发轮询，按区块顺序处理
 */
export type MonitorMode = 'racing' | 'sequential'

/**
 * 区块范围
 */
export interface BlockRange {
  fromBlock: number
  toBlock: number
}

/**
 * 日志选择器：根据区块范围获取日志
 */
export type LogSelector = (
  blockRange: BlockRange,
  provider: JsonRpcProvider
) => Promise<Log[]>

/**
 * 日志处理器：处理单个日志
 * @param log - 日志对象
 * @param context - 上下文（如数据库事务，可为 null）
 * @param chainId - 链 ID
 * @param blockTimestamp - 区块时间戳
 */
export type LogProcessor = (
  log: Log,
  context: unknown,
  chainId: number,
  blockTimestamp: number
) => Promise<void>

/**
 * 事务包装器接口
 * 用于在事务中执行操作（如 Prisma.$transaction）
 */
export interface TransactionWrapper {
  <T>(
    fn: (tx: unknown) => Promise<T>,
    options?: { timeout?: number; maxWait?: number }
  ): Promise<T>
}

/**
 * 状态存储接口
 * 用于持久化 syncBlockNumber
 * 可实现为：内存、数据库、Redis 等
 */
export interface StateStorage {
  /**
   * 获取已同步的区块号
   * @returns 区块号，如果不存在返回 null
   */
  getSyncBlockNumber(chainId: number): Promise<number | null>

  /**
   * 设置已同步的区块号
   * @param tx - 可选的事务上下文
   */
  setSyncBlockNumber(chainId: number, blockNumber: number, tx?: unknown): Promise<void>
}

/**
 * 日志接口
 * 可自定义实现（如 tslog、winston、pino）
 */
export interface Logger {
  info(message: string, ...args: unknown[]): void
  warn(message: string, ...args: unknown[]): void
  error(message: string, ...args: unknown[]): void
  debug?(message: string, ...args: unknown[]): void
}

/**
 * 监控配置
 */
export interface ChainMonitorConfig {
  /**
   * 监控模式
   * - racing: 竞速型，追求速度
   * - sequential: 业务型，保证顺序
   */
  mode: MonitorMode

  /**
   * HTTP RPC 地址
   */
  rpcUrl: string

  /**
   * WebSocket RPC 地址（可选，启用双通道模式）
   */
  wsUrl?: string

  /**
   * 链 ID
   */
  chainId: number

  /**
   * 要监控的合约地址
   */
  contractAddresses: string[]

  /**
   * 要监控的事件 topic
   */
  eventTopics: string[]

  /**
   * 日志选择器
   */
  logSelector: LogSelector

  /**
   * 日志处理器
   */
  logProcessor: LogProcessor

  /**
   * 状态存储
   * sequential 模式必需，racing 模式可选
   * 默认使用 MemoryStateStorage
   */
  stateStorage?: StateStorage

  /**
   * 事务包装器（可选）
   * 用于在事务中处理日志和更新状态
   */
  transactionWrapper?: TransactionWrapper

  /**
   * 日志记录器（可选）
   * 默认使用 console
   */
  logger?: Logger

  /**
   * Cron 表达式
   * 默认：每 10 秒执行一次
   */
  cronExpression?: string

  /**
   * 每批处理的最大区块数
   * @default 1000
   */
  batchSize?: number

  /**
   * 启动时是否立即执行一次
   * @default true
   */
  runOnInit?: boolean

  /**
   * 严格模式：日志处理失败是否抛出错误
   * @default false
   */
  strictMode?: boolean

  /**
   * WS 重连延迟（毫秒）
   * @default 3000
   */
  wsReconnectDelay?: number

  /**
   * 去重缓存过期时间（毫秒）
   * 仅用于 racing 模式
   * @default 300000 (5 分钟)
   */
  dedupeExpiry?: number
}
