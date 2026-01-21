# evm-chain-monitor

[![npm version](https://badge.fury.io/js/evm-chain-monitor.svg)](https://www.npmjs.com/package/evm-chain-monitor)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-blue.svg)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-18.12+-green.svg)](https://nodejs.org/)

A lightweight, dual-mode blockchain event monitoring library for EVM-compatible chains.

[中文文档](./README_CN.md)

## Features

- **Dual Mode Support**: Choose between `racing` (speed-first) and `sequential` (order-guaranteed) modes
- **Simple API**: Monitor events with just a few lines of code
- **WebSocket + HTTP**: Dual-channel monitoring with automatic reconnection
- **Pluggable Storage**: Bring your own state persistence (memory, database, Redis, etc.)
- **Pluggable Logger**: Use any logging library (console, tslog, winston, pino, etc.)
- **Transaction Support**: Optional transaction wrapper for atomic operations
- **Lazy Loading**: Fetch transaction/block data only when needed
- **Minimal Dependencies**: Only `cron` as runtime dependency, `ethers` as peer dependency

## Installation

```bash
npm install evm-chain-monitor ethers
# or
yarn add evm-chain-monitor ethers
```

## Quick Start

```typescript
import { ChainMonitor } from 'evm-chain-monitor'

const monitor = ChainMonitor.create({
  rpcUrl: 'https://eth-mainnet.g.alchemy.com/v2/YOUR_KEY',
  chainId: 1,
  contracts: ['0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'], // USDC
  events: ['Transfer(address,address,uint256)'],

  onEvent: async (event) => {
    console.log('Transfer:', event.transactionHash)

    // Lazy load transaction data only when needed
    const tx = await event.getTransaction()
    console.log('From:', tx?.from)
  },
})

await monitor.start()
```

That's it! No need to manually create topic hashes or implement log selectors.

## Modes

### Racing Mode

Best for speed-critical scenarios like sniping bots or liquidity monitoring:

```typescript
const monitor = ChainMonitor.create({
  mode: 'racing',
  // ...
})
```

- WebSocket and HTTP process events in parallel
- First-come-first-served with deduplication
- No ordering guarantee

### Sequential Mode (Default)

Best for business applications requiring event ordering:

```typescript
const monitor = ChainMonitor.create({
  mode: 'sequential', // default
  // ...
})
```

- Events processed in strict block order
- Supports database transactions for atomicity
- Uses lock mechanism to prevent concurrent execution

## Configuration

### Simple API (Recommended)

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `mode` | `'racing' \| 'sequential'` | `'sequential'` | Monitoring mode |
| `rpcUrl` | `string` | required | HTTP RPC endpoint |
| `wsUrl` | `string` | - | WebSocket endpoint (optional) |
| `chainId` | `number` | required | Chain ID |
| `contracts` | `string[]` | required | Contract addresses |
| `events` | `string[]` | required | Event signatures or topic hashes |
| `onEvent` | `EventHandler` | required | Event handler |
| `pollInterval` | `number` | `10` | Polling interval in seconds |
| `storage` | `StateStorage` | `MemoryStateStorage` | State persistence |
| `logger` | `Logger` | `ConsoleLogger` | Logger |
| `transaction` | `TransactionWrapper` | - | DB transaction wrapper |
| `batchSize` | `number` | `1000` | Max blocks per batch |
| `strictMode` | `boolean` | `false` | Throw on errors |

### Event Handler

The `onEvent` handler receives a `ParsedEvent` with convenient methods:

```typescript
interface ParsedEvent {
  // Properties
  log: Log                    // Original ethers Log
  chainId: number
  blockNumber: number
  blockTimestamp: number
  transactionHash: string
  logIndex: number
  address: string
  topics: readonly string[]
  data: string

  // Methods (lazy loading)
  getTransaction(): Promise<TransactionResponse | null>
  getBlock(): Promise<Block | null>
  decode(iface: Interface, eventName?: string): unknown
}
```

### Decoding Events

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

## Advanced Usage

### Custom Log Selector

For advanced filtering (e.g., indexed parameters):

```typescript
import { ChainMonitor, eventTopic } from 'evm-chain-monitor'
import { zeroPadValue } from 'ethers'

const monitor = new ChainMonitor({
  mode: 'sequential',
  rpcUrl: 'https://...',
  chainId: 1,
  contractAddresses: ['0x...'],
  eventTopics: [eventTopic('Transfer(address,address,uint256)')],

  // Custom selector: only transfers TO a specific address
  logSelector: async ({ fromBlock, toBlock }, provider) => {
    return provider.getLogs({
      address: '0x...',
      topics: [
        eventTopic('Transfer(address,address,uint256)'),
        null, // from: any
        zeroPadValue('0xMyAddress', 32), // to: specific
      ],
      fromBlock,
      toBlock,
    })
  },

  logProcessor: async (log, tx, chainId, blockTimestamp) => {
    // Process log
  },
})
```

### Database Persistence with Transactions

For production use, you'll want to persist sync state to a database and use transactions to ensure atomicity.

**How transactions work:**
1. Each block's events are processed in a single transaction
2. After processing, `syncBlockNumber` is updated within the same transaction
3. If any step fails, the entire transaction rolls back
4. This ensures no events are missed or duplicated

```typescript
import { ChainMonitor, StateStorage } from 'evm-chain-monitor'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

// 1. Implement StateStorage with transaction support
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
    tx?: unknown  // <-- This receives the transaction client
  ): Promise<void> {
    const client = (tx as PrismaClient) ?? this.prisma
    await client.monitorStatus.upsert({
      where: { chainId },
      update: { syncBlockNumber: blockNumber },
      create: { chainId, syncBlockNumber: blockNumber },
    })
  }
}

// 2. Configure the monitor with transaction support
const monitor = ChainMonitor.create({
  rpcUrl: 'https://...',
  chainId: 1,
  contracts: ['0x...'],
  events: ['Transfer(address,address,uint256)'],

  storage: new PrismaStateStorage(prisma),

  // Wrap operations in Prisma transaction
  transaction: (fn, opts) => prisma.$transaction(fn, opts),

  // The second parameter is the transaction client
  onEvent: async (event, tx) => {
    const client = tx as PrismaClient

    // All database operations use the transaction client
    await client.transfer.create({
      data: {
        txHash: event.transactionHash,
        blockNumber: event.blockNumber,
        timestamp: new Date(event.blockTimestamp * 1000),
        // ... other fields
      },
    })

    // If this throws, the entire block's transaction rolls back
    // including the syncBlockNumber update
  },
})

await monitor.start()
```

**Transaction flow for each block:**
```
Block N events arrive
    ↓
prisma.$transaction() starts
    ↓
├── Process event 1 (onEvent with tx client)
├── Process event 2 (onEvent with tx client)
├── ...
└── Update syncBlockNumber to N (with tx client)
    ↓
Transaction commits (or rolls back on error)
```

### Custom Logger

```typescript
import { Logger } from 'evm-chain-monitor'
import pino from 'pino'

class PinoLogger implements Logger {
  private logger = pino({ name: 'ChainMonitor' })

  info(message: string, ...args: unknown[]) {
    this.logger.info({ args }, message)
  }
  warn(message: string, ...args: unknown[]) {
    this.logger.warn({ args }, message)
  }
  error(message: string, ...args: unknown[]) {
    this.logger.error({ args }, message)
  }
  debug(message: string, ...args: unknown[]) {
    this.logger.debug({ args }, message)
  }
}
```

## Helper Functions

```typescript
import { eventTopic, eventTopics } from 'evm-chain-monitor'

// Convert event signature to topic hash
const topic = eventTopic('Transfer(address,address,uint256)')
// => '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'

// Batch convert
const topics = eventTopics([
  'Transfer(address,address,uint256)',
  'Approval(address,address,uint256)',
])
```

## API

### `ChainMonitor`

#### Static Methods

- `ChainMonitor.create(config: SimpleMonitorConfig): ChainMonitor` - Create with simple config (recommended)

#### Instance Methods

- `start(): Promise<void>` - Start the monitor
- `stop(): void` - Stop the monitor
- `triggerNow(): void` - Manually trigger a scan

## License

[MIT](LICENSE)
