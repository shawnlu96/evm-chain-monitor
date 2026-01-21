import type { ChainMonitorConfig } from './types.js';
/**
 * 链上事件监控器
 *
 * 支持两种模式：
 * - racing: 竞速型，WS 和 HTTP 并行处理，先到先得
 * - sequential: 业务型，WS 触发轮询，按区块顺序处理
 */
export declare class ChainMonitor {
    private readonly config;
    private httpProvider;
    private wsProvider;
    private cronJob;
    private isRunning;
    private pendingTrigger;
    private isStopped;
    private wsReconnectTimer;
    private dedupeCache;
    private blockTimestampCache;
    private readonly MAX_TIMESTAMP_CACHE;
    constructor(config: ChainMonitorConfig);
    /**
     * 启动监控
     */
    start(): Promise<void>;
    /**
     * 停止监控
     */
    stop(): void;
    /**
     * 手动触发一次扫描
     */
    triggerNow(): void;
    private startCron;
    private connectWebSocket;
    private scheduleWsReconnect;
    private handleWebSocketEvent;
    private processLogRacing;
    private doRacingScan;
    private runSequentialOnce;
    private doSequentialScan;
    private groupLogsByBlock;
    private getBlockTimestamp;
}
//# sourceMappingURL=ChainMonitor.d.ts.map