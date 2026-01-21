# evm-chain-monitor

轻量级 EVM 区块链事件监控库，支持双模式运行。

## 安装

```bash
npm install evm-chain-monitor ethers
# 或
yarn add evm-chain-monitor ethers
```

## 模式说明

### Racing 模式 (竞速型)

适用于抢跑、流动性监控等需要极致速度的场景：

- WebSocket 和 HTTP 并行处理，先到先得
- 使用内存去重缓存防止重复处理
- 不保证事件顺序

### Sequential 模式 (业务型)

适用于需要严格顺序的业务场景：

- WebSocket 仅用于触发轮询，不直接处理事件
- 保证事件按区块顺序处理
- 支持事务包装，确保数据一致性
- 使用锁机制防止并发执行

## 使用示例

```typescript
import { ChainMonitor, MemoryStateStorage, ConsoleLogger } from 'evm-chain-monitor'
import { Log, JsonRpcProvider } from 'ethers'

const monitor = new ChainMonitor({
  mode: 'sequential',  // 或 'racing'
  rpcUrl: 'https://your-rpc-url',
  wsUrl: 'wss://your-ws-url',  // 可选
  chainId: 1,
  contractAddresses: ['0x...'],
  eventTopics: ['0x...'],

  // 日志选择器：根据区块范围获取日志
  logSelector: async ({ fromBlock, toBlock }, provider) => {
    return provider.getLogs({
      address: '0x...',
      topics: ['0x...'],
      fromBlock,
      toBlock,
    })
  },

  // 日志处理器：处理单个事件
  logProcessor: async (log, tx, chainId, blockTimestamp) => {
    console.log('Processing log:', log.transactionHash)
    // 你的业务逻辑
  },

  // 可选配置
  stateStorage: new MemoryStateStorage(),  // 默认
  logger: new ConsoleLogger(),  // 默认
  cronExpression: '*/10 * * * * *',  // 每 10 秒
  batchSize: 1000,
})

await monitor.start()

// 手动触发一次扫描
monitor.triggerNow()

// 停止监控
monitor.stop()
```

## 自定义存储

实现 `StateStorage` 接口以使用数据库持久化：

```typescript
import { StateStorage } from 'evm-chain-monitor'
import { PrismaClient } from '@prisma/client'

class PrismaStateStorage implements StateStorage {
  constructor(private prisma: PrismaClient) {}

  async getSyncBlockNumber(chainId: number): Promise<number | null> {
    const status = await this.prisma.monitorStatus.findUnique({
      where: { chainId },
    })
    return status?.syncBlockNumber ?? null
  }

  async setSyncBlockNumber(
    chainId: number,
    blockNumber: number,
    tx?: unknown
  ): Promise<void> {
    const client = (tx as PrismaClient) ?? this.prisma
    await client.monitorStatus.upsert({
      where: { chainId },
      update: { syncBlockNumber: blockNumber },
      create: { chainId, syncBlockNumber: blockNumber },
    })
  }
}
```

## 自定义日志

实现 `Logger` 接口以使用自定义日志库：

```typescript
import { Logger } from 'evm-chain-monitor'
import { Logger as TsLogger } from 'tslog'

class TsLogLogger implements Logger {
  private logger = new TsLogger({ name: 'ChainMonitor' })

  info(message: string, ...args: unknown[]) {
    this.logger.info(message, ...args)
  }
  warn(message: string, ...args: unknown[]) {
    this.logger.warn(message, ...args)
  }
  error(message: string, ...args: unknown[]) {
    this.logger.error(message, ...args)
  }
  debug(message: string, ...args: unknown[]) {
    this.logger.debug(message, ...args)
  }
}
```

## 事务支持

Sequential 模式支持事务包装，确保日志处理和状态更新的原子性：

```typescript
const monitor = new ChainMonitor({
  // ...
  transactionWrapper: async (fn, options) => {
    return prisma.$transaction(fn, options)
  },
})
```

## License

MIT
