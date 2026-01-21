import { JsonRpcProvider, Log, WebSocketProvider } from 'ethers'
import { CronJob } from 'cron'

import type {
  ChainMonitorConfig,
  SimpleMonitorConfig,
  Logger,
  StateStorage,
  LogSelector,
} from './types.js'
import { MemoryStateStorage } from './MemoryStateStorage.js'
import { ConsoleLogger } from './ConsoleLogger.js'
import {
  eventTopics,
  createLogSelector,
  createParsedEvent,
  secondsToCron,
} from './helpers.js'

/**
 * 简单的内存去重缓存（用于 racing 模式）
 */
class DedupeCache {
  private cache = new Map<string, number>()
  private readonly expiry: number

  constructor(expiryMs: number = 5 * 60 * 1000) {
    this.expiry = expiryMs
  }

  has(key: string): boolean {
    const expireAt = this.cache.get(key)
    if (expireAt === undefined) return false
    if (Date.now() > expireAt) {
      this.cache.delete(key)
      return false
    }
    return true
  }

  add(key: string): void {
    this.cache.set(key, Date.now() + this.expiry)
    if (this.cache.size > 10000) {
      this.cleanup()
    }
  }

  private cleanup(): void {
    const now = Date.now()
    for (const [key, expireAt] of this.cache) {
      if (now > expireAt) {
        this.cache.delete(key)
      }
    }
  }
}

/**
 * 链上事件监控器
 *
 * 支持两种模式：
 * - racing: 竞速型，WS 和 HTTP 并行处理，先到先得
 * - sequential: 业务型，WS 触发轮询，按区块顺序处理
 *
 * @example 简化用法（推荐）
 * ```typescript
 * const monitor = ChainMonitor.create({
 *   rpcUrl: 'https://...',
 *   chainId: 1,
 *   contracts: ['0x...'],
 *   events: ['Transfer(address,address,uint256)'],
 *   onEvent: async (event) => {
 *     console.log('Transfer:', event.transactionHash)
 *   },
 * })
 * await monitor.start()
 * ```
 *
 * @example 完整用法（高级）
 * ```typescript
 * const monitor = new ChainMonitor({
 *   mode: 'sequential',
 *   rpcUrl: 'https://...',
 *   chainId: 1,
 *   contractAddresses: ['0x...'],
 *   eventTopics: ['0x...'],
 *   logProcessor: async (log, tx, chainId, blockTimestamp) => {
 *     // 自定义处理逻辑
 *   },
 * })
 * ```
 */
export class ChainMonitor {
  private readonly config: ChainMonitorConfig
  private readonly logger: Logger
  private readonly stateStorage: StateStorage
  private readonly logSelector: LogSelector

  private httpProvider: JsonRpcProvider
  private wsProvider: WebSocketProvider | null = null
  private cronJob: CronJob | null = null

  // 状态
  private isRunning = false
  private pendingTrigger = false
  private isStopped = false
  private wsReconnectTimer: NodeJS.Timeout | null = null

  // 缓存
  private dedupeCache: DedupeCache
  private blockTimestampCache = new Map<number, number>()
  private readonly MAX_TIMESTAMP_CACHE = 1000

  // 配置值
  private readonly batchSize: number
  private readonly strictMode: boolean
  private readonly wsReconnectDelay: number
  private readonly cronExpression: string
  private readonly runOnInit: boolean

  /**
   * 简化的工厂方法（推荐）
   *
   * @example
   * ```typescript
   * const monitor = ChainMonitor.create({
   *   rpcUrl: 'https://eth-mainnet.alchemyapi.io/v2/xxx',
   *   chainId: 1,
   *   contracts: ['0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'],
   *   events: ['Transfer(address,address,uint256)'],
   *   onEvent: async (event) => {
   *     console.log('USDC Transfer:', event.transactionHash)
   *     // 需要时获取交易详情
   *     const tx = await event.getTransaction()
   *   },
   * })
   * ```
   */
  static create(config: SimpleMonitorConfig): ChainMonitor {
    const topics = eventTopics(config.events)

    // 转换为完整配置
    const fullConfig: ChainMonitorConfig = {
      mode: config.mode ?? 'sequential',
      rpcUrl: config.rpcUrl,
      wsUrl: config.wsUrl,
      chainId: config.chainId,
      contractAddresses: config.contracts,
      eventTopics: topics,
      // logSelector 会在构造函数中自动生成
      logProcessor: async (log, tx, chainId, blockTimestamp) => {
        // 创建 ParsedEvent 并调用用户的 onEvent
        const provider = new JsonRpcProvider(config.rpcUrl)
        const event = createParsedEvent(log, chainId, blockTimestamp, provider)
        await config.onEvent(event, tx)
      },
      stateStorage: config.storage,
      transactionWrapper: config.transaction,
      logger: config.logger,
      pollInterval: config.pollInterval,
      batchSize: config.batchSize,
      runOnInit: config.runOnInit,
      strictMode: config.strictMode,
    }

    return new ChainMonitor(fullConfig)
  }

  constructor(config: ChainMonitorConfig) {
    this.config = config

    // 默认值
    this.batchSize = config.batchSize ?? 1000
    this.strictMode = config.strictMode ?? false
    this.wsReconnectDelay = config.wsReconnectDelay ?? 3000
    this.runOnInit = config.runOnInit ?? true

    // 将 pollInterval（秒）转换为 cron 表达式
    const pollInterval = config.pollInterval ?? 10
    this.cronExpression = secondsToCron(pollInterval)

    // 默认实现
    this.logger = config.logger ?? new ConsoleLogger()
    this.stateStorage = config.stateStorage ?? new MemoryStateStorage()

    // logSelector：如果未提供，自动生成
    this.logSelector =
      config.logSelector ??
      createLogSelector(config.contractAddresses, config.eventTopics)

    this.httpProvider = new JsonRpcProvider(config.rpcUrl)
    this.dedupeCache = new DedupeCache(config.dedupeExpiry ?? 5 * 60 * 1000)
  }

  /**
   * 启动监控
   */
  async start(): Promise<void> {
    if (this.isStopped) {
      throw new Error('Monitor has been stopped, create a new instance to restart')
    }

    this.logger.info(`Starting in ${this.config.mode} mode...`)

    // 验证连接
    const network = await this.httpProvider.getNetwork()
    if (Number(network.chainId) !== this.config.chainId) {
      throw new Error(
        `Chain ID mismatch: connected to ${network.chainId}, expected ${this.config.chainId}`
      )
    }

    // 初始化状态（sequential 模式）
    if (this.config.mode === 'sequential') {
      const syncBlock = await this.stateStorage.getSyncBlockNumber(this.config.chainId)
      if (syncBlock === null) {
        const currentBlock = await this.httpProvider.getBlockNumber()
        await this.stateStorage.setSyncBlockNumber(this.config.chainId, currentBlock)
        this.logger.info(`Initialized syncBlockNumber to ${currentBlock}`)
      }
    }

    // 启动 Cron
    this.startCron()

    // 启动 WebSocket（如果配置了）
    if (this.config.wsUrl) {
      await this.connectWebSocket()
    }

    this.logger.info('Started successfully')
  }

  /**
   * 停止监控
   */
  stop(): void {
    this.isStopped = true

    if (this.cronJob) {
      this.cronJob.stop()
      this.cronJob = null
    }

    if (this.wsReconnectTimer) {
      clearTimeout(this.wsReconnectTimer)
      this.wsReconnectTimer = null
    }

    if (this.wsProvider) {
      this.wsProvider.destroy()
      this.wsProvider = null
    }

    this.logger.info('Stopped')
  }

  /**
   * 手动触发一次扫描
   */
  triggerNow(): void {
    if (this.config.mode === 'racing') {
      this.doRacingScan().catch((err) => {
        this.logger.error('Racing scan error:', err)
      })
    } else {
      if (this.isRunning) {
        this.pendingTrigger = true
        return
      }
      this.runSequentialOnce().catch((err) => {
        this.logger.error('Sequential scan error:', err)
      })
    }
  }

  // ============ 私有方法 ============

  private startCron(): void {
    this.cronJob = CronJob.from({
      cronTime: this.cronExpression,
      onTick: () => this.triggerNow(),
      start: true,
      runOnInit: this.runOnInit,
      timeZone: 'UTC',
    })
  }

  private async connectWebSocket(): Promise<void> {
    if (this.isStopped || !this.config.wsUrl) return

    try {
      this.logger.info('Connecting WebSocket...')
      this.wsProvider = new WebSocketProvider(this.config.wsUrl)
      await this.wsProvider.ready
      this.logger.info('WebSocket connected')

      // 监听事件
      for (const address of this.config.contractAddresses) {
        const filter = {
          address,
          topics: [this.config.eventTopics],
        }

        this.wsProvider.on(filter, (log: Log) => {
          this.handleWebSocketEvent(log)
        })
      }

      // 监听断连
      const ws = (this.wsProvider as unknown as { websocket: WebSocket }).websocket
      if (ws) {
        ws.onclose = () => {
          this.logger.warn('WebSocket closed')
          this.scheduleWsReconnect()
        }
        ws.onerror = (err: Event) => {
          this.logger.error('WebSocket error:', err)
        }
      }
    } catch (error) {
      this.logger.error('WebSocket connection failed:', error)
      this.scheduleWsReconnect()
    }
  }

  private scheduleWsReconnect(): void {
    if (this.isStopped) return
    if (this.wsReconnectTimer) return

    this.logger.info(`Reconnecting in ${this.wsReconnectDelay}ms...`)
    this.wsReconnectTimer = setTimeout(async () => {
      this.wsReconnectTimer = null
      if (this.wsProvider) {
        try {
          this.wsProvider.destroy()
        } catch {
          /* ignore */
        }
        this.wsProvider = null
      }
      await this.connectWebSocket()
    }, this.wsReconnectDelay)
  }

  private handleWebSocketEvent(log: Log): void {
    if (this.config.mode === 'racing') {
      this.processLogRacing(log).catch((err) => {
        this.logger.error('Racing process error:', err)
      })
    } else {
      this.logger.debug?.(`WS event received at block ${log.blockNumber}, triggering scan`)
      this.triggerNow()
    }
  }

  // ============ Racing 模式 ============

  private async processLogRacing(log: Log): Promise<void> {
    const cacheKey = `${this.config.chainId}:${log.transactionHash}:${log.index}`

    if (this.dedupeCache.has(cacheKey)) {
      return
    }

    this.dedupeCache.add(cacheKey)

    const blockTimestamp = await this.getBlockTimestamp(log.blockNumber)

    try {
      await this.config.logProcessor(log, null, this.config.chainId, blockTimestamp)
    } catch (error) {
      this.logger.error(`Error processing log ${log.transactionHash}:`, error)
    }
  }

  private async doRacingScan(): Promise<void> {
    try {
      const currentBlock = await this.httpProvider.getBlockNumber()
      const fromBlock = currentBlock - Math.min(this.batchSize, 100)

      const logs = await this.logSelector({ fromBlock, toBlock: currentBlock }, this.httpProvider)

      for (const log of logs) {
        await this.processLogRacing(log)
      }
    } catch (error) {
      this.logger.error('Racing scan error:', error)
    }
  }

  // ============ Sequential 模式 ============

  private async runSequentialOnce(): Promise<void> {
    if (this.isRunning) return

    this.isRunning = true
    try {
      await this.doSequentialScan()
    } finally {
      this.isRunning = false

      if (this.pendingTrigger) {
        this.pendingTrigger = false
        setImmediate(() => {
          this.runSequentialOnce().catch((err) => {
            this.logger.error('Pending run error:', err)
          })
        })
      }
    }
  }

  private async doSequentialScan(): Promise<void> {
    const wrapper = this.config.transactionWrapper

    try {
      const targetBlock = await this.httpProvider.getBlockNumber()
      let syncBlock = await this.stateStorage.getSyncBlockNumber(this.config.chainId)

      if (syncBlock === null) {
        syncBlock = targetBlock
        await this.stateStorage.setSyncBlockNumber(this.config.chainId, syncBlock)
      }

      while (syncBlock < targetBlock) {
        const fromBlock = syncBlock + 1
        const toBlock = Math.min(syncBlock + this.batchSize, targetBlock)

        const logs = await this.logSelector({ fromBlock, toBlock }, this.httpProvider)

        if (logs.length > 0) {
          this.logger.info(`Processing blocks ${fromBlock}-${toBlock}, ${logs.length} events`)
        }

        const groupedLogs = this.groupLogsByBlock(logs)

        for (const [blockNumber, logsInBlock] of groupedLogs) {
          const blockTimestamp = await this.getBlockTimestamp(blockNumber)

          const processBlock = async (tx?: unknown) => {
            for (const log of logsInBlock) {
              try {
                await this.config.logProcessor(log, tx, this.config.chainId, blockTimestamp)
              } catch (error) {
                this.logger.error('Error processing log:', error)
                if (this.strictMode) throw error
              }
            }
            await this.stateStorage.setSyncBlockNumber(this.config.chainId, blockNumber, tx)
          }

          if (wrapper) {
            await wrapper(processBlock, { timeout: 300000, maxWait: 30000 })
          } else {
            await processBlock()
          }
        }

        if (toBlock > syncBlock) {
          await this.stateStorage.setSyncBlockNumber(this.config.chainId, toBlock)
        }

        syncBlock = toBlock
      }
    } catch (error) {
      this.logger.error('Sequential scan error:', error)
      throw error
    }
  }

  private groupLogsByBlock(logs: Log[]): Map<number, Log[]> {
    const grouped = new Map<number, Log[]>()

    logs.sort((a, b) => {
      if (a.blockNumber !== b.blockNumber) {
        return a.blockNumber - b.blockNumber
      }
      return a.index - b.index
    })

    for (const log of logs) {
      const arr = grouped.get(log.blockNumber) || []
      arr.push(log)
      grouped.set(log.blockNumber, arr)
    }

    return grouped
  }

  private async getBlockTimestamp(blockNumber: number): Promise<number> {
    let timestamp = this.blockTimestampCache.get(blockNumber)
    if (timestamp !== undefined) return timestamp

    const block = await this.httpProvider.getBlock(blockNumber)
    timestamp = block?.timestamp ?? Math.floor(Date.now() / 1000)

    this.blockTimestampCache.set(blockNumber, timestamp)

    if (this.blockTimestampCache.size > this.MAX_TIMESTAMP_CACHE) {
      const oldest = this.blockTimestampCache.keys().next().value
      if (oldest !== undefined) {
        this.blockTimestampCache.delete(oldest)
      }
    }

    return timestamp
  }
}
