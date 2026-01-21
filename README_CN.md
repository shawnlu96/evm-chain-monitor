# evm-chain-monitor

轻量级 EVM 区块链事件监控库，支持双模式运行。

## 安装

```bash
npm install evm-chain-monitor ethers
# 或
yarn add evm-chain-monitor ethers
```

## 快速开始

```typescript
import { ChainMonitor } from 'evm-chain-monitor'

const monitor = ChainMonitor.create({
  rpcUrl: 'https://eth-mainnet.g.alchemy.com/v2/YOUR_KEY',
  chainId: 1,
  contracts: ['0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'], // USDC
  events: ['Transfer(address,address,uint256)'],

  onEvent: async (event) => {
    console.log('Transfer:', event.transactionHash)

    // 需要时才获取交易数据（懒加载）
    const tx = await event.getTransaction()
    console.log('From:', tx?.from)
  },
})

await monitor.start()
```

就这么简单！无需手动计算 topic hash 或实现 logSelector。

## 模式说明

### Racing 模式（竞速型）

适用于抢跑、流动性监控等需要极致速度的场景：

```typescript
const monitor = ChainMonitor.create({
  mode: 'racing',
  // ...
})
```

- WebSocket 和 HTTP 并行处理，先到先得
- 使用内存去重缓存防止重复处理
- 不保证事件顺序

### Sequential 模式（业务型，默认）

适用于需要严格顺序的业务场景：

```typescript
const monitor = ChainMonitor.create({
  mode: 'sequential', // 默认
  // ...
})
```

- 保证事件按区块顺序处理
- 支持数据库事务，确保数据一致性
- 使用锁机制防止并发执行

## 配置项

### 简化 API（推荐）

| 选项 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `mode` | `'racing' \| 'sequential'` | `'sequential'` | 监控模式 |
| `rpcUrl` | `string` | 必填 | HTTP RPC 地址 |
| `wsUrl` | `string` | - | WebSocket 地址（可选） |
| `chainId` | `number` | 必填 | 链 ID |
| `contracts` | `string[]` | 必填 | 合约地址 |
| `events` | `string[]` | 必填 | 事件签名或 topic hash |
| `onEvent` | `EventHandler` | 必填 | 事件处理器 |
| `pollInterval` | `number` | `10` | 轮询间隔（秒） |
| `storage` | `StateStorage` | `MemoryStateStorage` | 状态存储 |
| `logger` | `Logger` | `ConsoleLogger` | 日志记录器 |
| `transaction` | `TransactionWrapper` | - | 数据库事务包装器 |
| `batchSize` | `number` | `1000` | 每批最大区块数 |
| `strictMode` | `boolean` | `false` | 严格模式 |

### 事件处理器

`onEvent` 接收 `ParsedEvent` 对象，提供便捷方法：

```typescript
interface ParsedEvent {
  // 属性
  log: Log                    // 原始 ethers Log
  chainId: number
  blockNumber: number
  blockTimestamp: number
  transactionHash: string
  logIndex: number
  address: string
  topics: readonly string[]
  data: string

  // 方法（懒加载）
  getTransaction(): Promise<TransactionResponse | null>
  getBlock(): Promise<Block | null>
  decode(iface: Interface, eventName?: string): unknown
}
```

### 解码事件数据

```typescript
import { Interface } from 'ethers'

const erc20Abi = ['event Transfer(address indexed from, address indexed to, uint256 value)']
const iface = new Interface(erc20Abi)

const monitor = ChainMonitor.create({
  // ...
  onEvent: async (event) => {
    const decoded = event.decode(iface)
    console.log('From:', decoded.from)
    console.log('To:', decoded.to)
    console.log('Value:', decoded.value)
  },
})
```

## 高级用法

### 自定义日志选择器

用于高级过滤（如 indexed 参数）：

```typescript
import { ChainMonitor, eventTopic } from 'evm-chain-monitor'
import { zeroPadValue } from 'ethers'

const monitor = new ChainMonitor({
  mode: 'sequential',
  rpcUrl: 'https://...',
  chainId: 1,
  contractAddresses: ['0x...'],
  eventTopics: [eventTopic('Transfer(address,address,uint256)')],

  // 自定义：只监控转账到特定地址
  logSelector: async ({ fromBlock, toBlock }, provider) => {
    return provider.getLogs({
      address: '0x...',
      topics: [
        eventTopic('Transfer(address,address,uint256)'),
        null, // from: 任意
        zeroPadValue('0xMyAddress', 32), // to: 特定地址
      ],
      fromBlock,
      toBlock,
    })
  },

  logProcessor: async (log, tx, chainId, blockTimestamp) => {
    // 处理日志
  },
})
```

### 数据库持久化

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

const monitor = ChainMonitor.create({
  // ...
  storage: new PrismaStateStorage(prisma),
  transaction: (fn, opts) => prisma.$transaction(fn, opts),
})
```

## 辅助函数

```typescript
import { eventTopic, eventTopics } from 'evm-chain-monitor'

// 事件签名转 topic hash
const topic = eventTopic('Transfer(address,address,uint256)')
// => '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'

// 批量转换
const topics = eventTopics([
  'Transfer(address,address,uint256)',
  'Approval(address,address,uint256)',
])
```

## License

MIT
