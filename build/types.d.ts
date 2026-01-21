import { ethers, Log } from 'ethers';
/**
 * 监控模式
 * - racing: 竞速型，WS 和 HTTP 并行处理，先到先得
 * - sequential: 业务型，WS 触发轮询，按区块顺序处理
 */
export type MonitorMode = 'racing' | 'sequential';
/**
 * 区块范围
 */
export interface BlockRange {
    fromBlock: number;
    toBlock: number;
}
/**
 * 日志选择器：根据区块范围获取日志
 */
export type LogSelector = (blockRange: BlockRange, provider: ethers.JsonRpcProvider) => Promise<Log[]>;
/**
 * 日志处理器：处理单个日志
 * @param log - 日志对象
 * @param context - 上下文（可选，如数据库事务）
 * @param chainId - 链 ID
 * @param blockTimestamp - 区块时间戳
 */
export type LogProcessor = (log: Log, context: any, chainId: number, blockTimestamp: number) => Promise<void>;
/**
 * 事务包装器：用于业务型模式的事务处理
 */
export type TransactionWrapper = <T>(fn: (tx: any) => Promise<T>, options?: {
    timeout?: number;
    maxWait?: number;
}) => Promise<T>;
/**
 * 状态存储接口
 */
export interface StateStorage {
    /**
     * 获取已同步的区块号
     */
    getSyncBlockNumber(chainId: number): Promise<number | null>;
    /**
     * 设置已同步的区块号
     */
    setSyncBlockNumber(chainId: number, blockNumber: number, tx?: any): Promise<void>;
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
    mode: MonitorMode;
    /**
     * HTTP RPC 地址
     */
    rpcUrl: string;
    /**
     * WebSocket RPC 地址（可选）
     */
    wsUrl?: string;
    /**
     * 链 ID
     */
    chainId: number;
    /**
     * 要监控的合约地址
     */
    contractAddresses: string[];
    /**
     * 要监控的事件 topic
     */
    eventTopics: string[];
    /**
     * 日志选择器
     */
    logSelector: LogSelector;
    /**
     * 日志处理器
     */
    logProcessor: LogProcessor;
    /**
     * 状态存储（sequential 模式必需）
     */
    stateStorage?: StateStorage;
    /**
     * 事务包装器（sequential 模式可选）
     */
    transactionWrapper?: TransactionWrapper;
    /**
     * Cron 表达式（默认每 10 秒）
     */
    cronExpression?: string;
    /**
     * 每批处理的最大区块数（默认 1000）
     */
    batchSize?: number;
    /**
     * 启动时是否立即执行一次（默认 true）
     */
    runOnInit?: boolean;
    /**
     * 严格模式：处理失败是否回滚（默认 false）
     */
    strictMode?: boolean;
    /**
     * WS 重连延迟（毫秒，默认 3000）
     */
    wsReconnectDelay?: number;
    /**
     * 去重缓存过期时间（毫秒，默认 5 分钟）
     * 仅用于 racing 模式
     */
    dedupeExpiry?: number;
}
//# sourceMappingURL=types.d.ts.map