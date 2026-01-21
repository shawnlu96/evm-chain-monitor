import { ethers, WebSocketProvider } from 'ethers';
import { CronJob } from 'cron';
/**
 * 简单的内存去重缓存（用于 racing 模式）
 */
class DedupeCache {
    cache = new Map();
    expiry;
    constructor(expiryMs = 5 * 60 * 1000) {
        this.expiry = expiryMs;
    }
    has(key) {
        const expireAt = this.cache.get(key);
        if (expireAt === undefined)
            return false;
        if (Date.now() > expireAt) {
            this.cache.delete(key);
            return false;
        }
        return true;
    }
    add(key) {
        this.cache.set(key, Date.now() + this.expiry);
        // 定期清理过期项
        if (this.cache.size > 10000) {
            this.cleanup();
        }
    }
    cleanup() {
        const now = Date.now();
        for (const [key, expireAt] of this.cache) {
            if (now > expireAt) {
                this.cache.delete(key);
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
 */
export class ChainMonitor {
    config;
    httpProvider;
    wsProvider = null;
    cronJob = null;
    // 状态
    isRunning = false;
    pendingTrigger = false;
    isStopped = false;
    wsReconnectTimer = null;
    // 缓存
    dedupeCache;
    blockTimestampCache = new Map();
    MAX_TIMESTAMP_CACHE = 1000;
    constructor(config) {
        // 默认值
        this.config = {
            ...config,
            batchSize: config.batchSize ?? 1000,
            strictMode: config.strictMode ?? false,
            wsReconnectDelay: config.wsReconnectDelay ?? 3000,
            cronExpression: config.cronExpression ?? '*/10 * * * * *',
            runOnInit: config.runOnInit ?? true,
            dedupeExpiry: config.dedupeExpiry ?? 5 * 60 * 1000,
        };
        // 验证 sequential 模式必须有 stateStorage
        if (config.mode === 'sequential' && !config.stateStorage) {
            throw new Error('stateStorage is required for sequential mode');
        }
        this.httpProvider = new ethers.JsonRpcProvider(config.rpcUrl);
        this.dedupeCache = new DedupeCache(this.config.dedupeExpiry);
    }
    /**
     * 启动监控
     */
    async start() {
        if (this.isStopped) {
            throw new Error('Monitor has been stopped, create a new instance to restart');
        }
        console.log(`[ChainMonitor] Starting in ${this.config.mode} mode...`);
        // 验证连接
        const network = await this.httpProvider.getNetwork();
        if (Number(network.chainId) !== this.config.chainId) {
            throw new Error(`Chain ID mismatch: connected to ${network.chainId}, expected ${this.config.chainId}`);
        }
        // 初始化状态（sequential 模式）
        if (this.config.mode === 'sequential' && this.config.stateStorage) {
            const syncBlock = await this.config.stateStorage.getSyncBlockNumber(this.config.chainId);
            if (syncBlock === null) {
                const currentBlock = await this.httpProvider.getBlockNumber();
                await this.config.stateStorage.setSyncBlockNumber(this.config.chainId, currentBlock);
                console.log(`[ChainMonitor] Initialized syncBlockNumber to ${currentBlock}`);
            }
        }
        // 启动 Cron
        this.startCron();
        // 启动 WebSocket（如果配置了）
        if (this.config.wsUrl) {
            await this.connectWebSocket();
        }
        console.log(`[ChainMonitor] Started successfully`);
    }
    /**
     * 停止监控
     */
    stop() {
        this.isStopped = true;
        if (this.cronJob) {
            this.cronJob.stop();
            this.cronJob = null;
        }
        if (this.wsReconnectTimer) {
            clearTimeout(this.wsReconnectTimer);
            this.wsReconnectTimer = null;
        }
        if (this.wsProvider) {
            this.wsProvider.destroy();
            this.wsProvider = null;
        }
        console.log('[ChainMonitor] Stopped');
    }
    /**
     * 手动触发一次扫描
     */
    triggerNow() {
        if (this.config.mode === 'racing') {
            // racing 模式：直接执行
            this.doRacingScan().catch(err => {
                console.error('[ChainMonitor] Racing scan error:', err);
            });
        }
        else {
            // sequential 模式：带锁执行
            if (this.isRunning) {
                this.pendingTrigger = true;
                return;
            }
            this.runSequentialOnce().catch(err => {
                console.error('[ChainMonitor] Sequential scan error:', err);
            });
        }
    }
    // ============ 私有方法 ============
    startCron() {
        this.cronJob = CronJob.from({
            cronTime: this.config.cronExpression,
            onTick: () => this.triggerNow(),
            start: true,
            runOnInit: this.config.runOnInit,
            timeZone: 'UTC',
        });
    }
    async connectWebSocket() {
        if (this.isStopped || !this.config.wsUrl)
            return;
        try {
            console.log('[ChainMonitor] Connecting WebSocket...');
            this.wsProvider = new WebSocketProvider(this.config.wsUrl);
            await this.wsProvider.ready;
            console.log('[ChainMonitor] WebSocket connected');
            // 监听事件
            for (const address of this.config.contractAddresses) {
                const filter = {
                    address,
                    topics: [this.config.eventTopics],
                };
                this.wsProvider.on(filter, (log) => {
                    this.handleWebSocketEvent(log);
                });
            }
            // 监听断连
            const ws = this.wsProvider.websocket;
            if (ws) {
                ws.onclose = () => {
                    console.warn('[ChainMonitor] WebSocket closed');
                    this.scheduleWsReconnect();
                };
                ws.onerror = (err) => {
                    console.error('[ChainMonitor] WebSocket error:', err.message || err);
                };
            }
        }
        catch (error) {
            console.error('[ChainMonitor] WebSocket connection failed:', error);
            this.scheduleWsReconnect();
        }
    }
    scheduleWsReconnect() {
        if (this.isStopped)
            return;
        if (this.wsReconnectTimer)
            return;
        console.log(`[ChainMonitor] Reconnecting in ${this.config.wsReconnectDelay}ms...`);
        this.wsReconnectTimer = setTimeout(async () => {
            this.wsReconnectTimer = null;
            if (this.wsProvider) {
                try {
                    this.wsProvider.destroy();
                }
                catch { /* ignore */ }
                this.wsProvider = null;
            }
            await this.connectWebSocket();
        }, this.config.wsReconnectDelay);
    }
    handleWebSocketEvent(log) {
        if (this.config.mode === 'racing') {
            // racing 模式：直接处理
            this.processLogRacing(log).catch(err => {
                console.error('[ChainMonitor] Racing process error:', err);
            });
        }
        else {
            // sequential 模式：触发轮询
            console.log(`[ChainMonitor] WS event received, triggering scan`);
            this.triggerNow();
        }
    }
    // ============ Racing 模式 ============
    async processLogRacing(log) {
        const cacheKey = `${this.config.chainId}:${log.transactionHash}:${log.index}`;
        // 去重检查
        if (this.dedupeCache.has(cacheKey)) {
            return;
        }
        // 标记为已处理
        this.dedupeCache.add(cacheKey);
        // 获取区块时间戳
        const blockTimestamp = await this.getBlockTimestamp(log.blockNumber);
        // 处理日志
        try {
            await this.config.logProcessor(log, null, this.config.chainId, blockTimestamp);
        }
        catch (error) {
            console.error(`[ChainMonitor] Error processing log ${log.transactionHash}:`, error);
        }
    }
    async doRacingScan() {
        try {
            const currentBlock = await this.httpProvider.getBlockNumber();
            const fromBlock = currentBlock - (this.config.batchSize ?? 100);
            const logs = await this.config.logSelector({ fromBlock, toBlock: currentBlock }, this.httpProvider);
            for (const log of logs) {
                await this.processLogRacing(log);
            }
        }
        catch (error) {
            console.error('[ChainMonitor] Racing scan error:', error);
        }
    }
    // ============ Sequential 模式 ============
    async runSequentialOnce() {
        if (this.isRunning)
            return;
        this.isRunning = true;
        try {
            await this.doSequentialScan();
        }
        finally {
            this.isRunning = false;
            if (this.pendingTrigger) {
                this.pendingTrigger = false;
                setImmediate(() => {
                    this.runSequentialOnce().catch(err => {
                        console.error('[ChainMonitor] Pending run error:', err);
                    });
                });
            }
        }
    }
    async doSequentialScan() {
        const storage = this.config.stateStorage;
        const wrapper = this.config.transactionWrapper;
        try {
            const targetBlock = await this.httpProvider.getBlockNumber();
            let syncBlock = await storage.getSyncBlockNumber(this.config.chainId);
            if (syncBlock === null) {
                syncBlock = targetBlock;
                await storage.setSyncBlockNumber(this.config.chainId, syncBlock);
            }
            while (syncBlock < targetBlock) {
                const fromBlock = syncBlock + 1;
                const toBlock = Math.min(syncBlock + this.config.batchSize, targetBlock);
                const logs = await this.config.logSelector({ fromBlock, toBlock }, this.httpProvider);
                if (logs.length > 0) {
                    console.log(`[ChainMonitor] Processing blocks ${fromBlock}-${toBlock}, ${logs.length} events`);
                }
                // 按区块分组
                const groupedLogs = this.groupLogsByBlock(logs);
                for (const [blockNumber, logsInBlock] of groupedLogs) {
                    const blockTimestamp = await this.getBlockTimestamp(blockNumber);
                    const processBlock = async (tx) => {
                        for (const log of logsInBlock) {
                            try {
                                await this.config.logProcessor(log, tx, this.config.chainId, blockTimestamp);
                            }
                            catch (error) {
                                console.error(`[ChainMonitor] Error processing log:`, error);
                                if (this.config.strictMode)
                                    throw error;
                            }
                        }
                        await storage.setSyncBlockNumber(this.config.chainId, blockNumber, tx);
                    };
                    if (wrapper) {
                        await wrapper(processBlock, { timeout: 300000, maxWait: 30000 });
                    }
                    else {
                        await processBlock();
                    }
                }
                // 更新到 toBlock（处理没有日志的区块）
                if (toBlock > syncBlock) {
                    await storage.setSyncBlockNumber(this.config.chainId, toBlock);
                }
                syncBlock = toBlock;
            }
        }
        catch (error) {
            console.error('[ChainMonitor] Sequential scan error:', error);
            throw error;
        }
    }
    groupLogsByBlock(logs) {
        const grouped = new Map();
        // 先排序
        logs.sort((a, b) => {
            if (a.blockNumber !== b.blockNumber) {
                return a.blockNumber - b.blockNumber;
            }
            return a.index - b.index;
        });
        for (const log of logs) {
            const arr = grouped.get(log.blockNumber) || [];
            arr.push(log);
            grouped.set(log.blockNumber, arr);
        }
        return grouped;
    }
    async getBlockTimestamp(blockNumber) {
        let timestamp = this.blockTimestampCache.get(blockNumber);
        if (timestamp !== undefined)
            return timestamp;
        const block = await this.httpProvider.getBlock(blockNumber);
        timestamp = block?.timestamp ?? Math.floor(Date.now() / 1000);
        this.blockTimestampCache.set(blockNumber, timestamp);
        // 限制缓存大小
        if (this.blockTimestampCache.size > this.MAX_TIMESTAMP_CACHE) {
            const oldest = this.blockTimestampCache.keys().next().value;
            if (oldest !== undefined) {
                this.blockTimestampCache.delete(oldest);
            }
        }
        return timestamp;
    }
}
//# sourceMappingURL=ChainMonitor.js.map