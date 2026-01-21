import type { Log, JsonRpcProvider, TransactionResponse, Block, Interface } from 'ethers'

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
 * 解析后的事件（简化 API 使用）
 */
export interface ParsedEvent {
  /** 原始日志对象 */
  log: Log
  /** 链 ID */
  chainId: number
  /** 区块号 */
  blockNumber: number
  /** 区块时间戳（秒） */
  blockTimestamp: number
  /** 交易哈希 */
  transactionHash: string
  /** 日志索引 */
  logIndex: number
  /** 合约地址 */
  address: string
  /** 事件 topics */
  topics: readonly string[]
  /** 事件数据 */
  data: string

  /** 获取交易详情（懒加载） */
  getTransaction(): Promise<TransactionResponse | null>
  /** 获取区块详情（懒加载） */
  getBlock(): Promise<Block | null>
  /** 使用 ABI 解码事件数据 */
  decode(iface: Interface, eventName?: string): unknown
}

/**
 * 简化的事件处理器
 */
export type EventHandler = (
  event: ParsedEvent,
  tx?: unknown
) => Promise<void>

/**
 * 日志处理器：处理单个日志（完整 API）
 * @param log - 日志对象
 * @param tx - 数据库事务上下文（可为 null）
 * @param chainId - 链 ID
 * @param blockTimestamp - 区块时间戳
 */
export type LogProcessor = (
  log: Log,
  tx: unknown,
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

// ============ 简化配置（推荐） ============

/**
 * 简化的监控配置
 * 使用 ChainMonitor.create() 工厂方法
 */
export interface SimpleMonitorConfig {
  /**
   * 监控模式
   * @default 'sequential'
   */
  mode?: MonitorMode

  /**
   * HTTP RPC 地址
   */
  rpcUrl: string

  /**
   * WebSocket RPC 地址（可选，启用实时监听）
   */
  wsUrl?: string

  /**
   * 链 ID
   */
  chainId: number

  /**
   * 要监控的合约地址
   */
  contracts: string[]

  /**
   * 要监控的事件
   * 支持两种格式：
   * - 事件签名: 'Transfer(address,address,uint256)'
   * - Topic hash: '0xddf252ad...'
   */
  events: string[]

  /**
   * 事件处理器
   */
  onEvent: EventHandler

  /**
   * 轮询间隔（秒）
   * @default 10
   */
  pollInterval?: number

  /**
   * 状态存储（可选）
   * @default MemoryStateStorage
   */
  storage?: StateStorage

  /**
   * 日志记录器（可选）
   * @default ConsoleLogger
   */
  logger?: Logger

  /**
   * 事务包装器（可选）
   */
  transaction?: TransactionWrapper

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
   * 严格模式：事件处理失败是否抛出错误
   * @default false
   */
  strictMode?: boolean
}

// ============ 完整配置（高级） ============

/**
 * 完整的监控配置
 * 使用 new ChainMonitor() 构造函数
 */
export interface ChainMonitorConfig {
  /**
   * 监控模式
   */
  mode: MonitorMode

  /**
   * HTTP RPC 地址
   */
  rpcUrl: string

  /**
   * WebSocket RPC 地址（可选）
   */
  wsUrl?: string

  /**
   * 链 ID
   */
  chainId: number

  /**
   * 要监控的合约地址（用于 WS 订阅）
   */
  contractAddresses: string[]

  /**
   * 要监控的事件 topic（用于 WS 订阅）
   */
  eventTopics: string[]

  /**
   * 日志选择器（可选）
   * 如不提供，将基于 contractAddresses 和 eventTopics 自动生成
   */
  logSelector?: LogSelector

  /**
   * 日志处理器
   */
  logProcessor: LogProcessor

  /**
   * 状态存储
   * @default MemoryStateStorage
   */
  stateStorage?: StateStorage

  /**
   * 事务包装器（可选）
   */
  transactionWrapper?: TransactionWrapper

  /**
   * 日志记录器（可选）
   * @default ConsoleLogger
   */
  logger?: Logger

  /**
   * 轮询间隔（秒）
   * @default 10
   */
  pollInterval?: number

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
