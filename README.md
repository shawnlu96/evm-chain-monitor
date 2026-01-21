# evm-chain-monitor

[![npm version](https://badge.fury.io/js/evm-chain-monitor.svg)](https://www.npmjs.com/package/evm-chain-monitor)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-blue.svg)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-18.12+-green.svg)](https://nodejs.org/)

A lightweight, dual-mode blockchain event monitoring library for EVM-compatible chains.

[中文文档](./README_CN.md)

## Features

- **Dual Mode Support**: Choose between `racing` (speed-first) and `sequential` (order-guaranteed) modes
- **WebSocket + HTTP**: Dual-channel monitoring with automatic reconnection
- **Pluggable Storage**: Bring your own state persistence (memory, database, Redis, etc.)
- **Pluggable Logger**: Use any logging library (console, tslog, winston, pino, etc.)
- **Transaction Support**: Optional transaction wrapper for atomic operations
- **Cron-based Polling**: Configurable polling interval with cron expressions
- **Minimal Dependencies**: Only `cron` as runtime dependency, `ethers` as peer dependency

## Installation

```bash
npm install evm-chain-monitor ethers
# or
yarn add evm-chain-monitor ethers
# or
pnpm add evm-chain-monitor ethers
```

## Quick Start

```typescript
import { ChainMonitor } from 'evm-chain-monitor'

const monitor = new ChainMonitor({
  mode: 'sequential',
  rpcUrl: 'https://eth-mainnet.g.alchemy.com/v2/YOUR_KEY',
  wsUrl: 'wss://eth-mainnet.g.alchemy.com/v2/YOUR_KEY', // optional
  chainId: 1,
  contractAddresses: ['0x...'],
  eventTopics: ['0x...'],

  logSelector: async ({ fromBlock, toBlock }, provider) => {
    return provider.getLogs({
      address: '0x...',
      topics: ['0x...'],
      fromBlock,
      toBlock,
    })
  },

  logProcessor: async (log, tx, chainId, blockTimestamp) => {
    console.log('Processing:', log.transactionHash)
    // Your business logic here
  },
})

await monitor.start()
```

## Modes

### Racing Mode

Best for speed-critical scenarios like sniping bots or liquidity monitoring:

- WebSocket and HTTP process events in parallel
- First-come-first-served with deduplication
- No ordering guarantee
- Uses in-memory cache for deduplication

```typescript
const monitor = new ChainMonitor({
  mode: 'racing',
  // ...
})
```

### Sequential Mode

Best for business applications requiring event ordering:

- WebSocket only triggers polling, doesn't process events directly
- Events processed in strict block order
- Supports database transactions for atomicity
- Uses lock mechanism to prevent concurrent execution

```typescript
const monitor = new ChainMonitor({
  mode: 'sequential',
  // ...
})
```

## Configuration

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `mode` | `'racing' \| 'sequential'` | required | Monitoring mode |
| `rpcUrl` | `string` | required | HTTP RPC endpoint |
| `wsUrl` | `string` | - | WebSocket RPC endpoint (optional) |
| `chainId` | `number` | required | Chain ID for validation |
| `contractAddresses` | `string[]` | required | Contracts to monitor |
| `eventTopics` | `string[]` | required | Event topics to filter |
| `logSelector` | `LogSelector` | required | Function to fetch logs |
| `logProcessor` | `LogProcessor` | required | Function to process each log |
| `stateStorage` | `StateStorage` | `MemoryStateStorage` | State persistence |
| `logger` | `Logger` | `ConsoleLogger` | Logging implementation |
| `transactionWrapper` | `TransactionWrapper` | - | Transaction wrapper |
| `cronExpression` | `string` | `'*/10 * * * * *'` | Polling interval |
| `batchSize` | `number` | `1000` | Max blocks per batch |
| `runOnInit` | `boolean` | `true` | Run immediately on start |
| `strictMode` | `boolean` | `false` | Throw on processing errors |
| `wsReconnectDelay` | `number` | `3000` | WS reconnect delay (ms) |
| `dedupeExpiry` | `number` | `300000` | Dedup cache expiry (ms) |

## Custom Storage

Implement the `StateStorage` interface for database persistence:

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

const monitor = new ChainMonitor({
  // ...
  stateStorage: new PrismaStateStorage(prisma),
})
```

## Custom Logger

Implement the `Logger` interface to use your preferred logging library:

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

## Transaction Support

For atomic operations in sequential mode:

```typescript
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

const monitor = new ChainMonitor({
  mode: 'sequential',
  // ...
  transactionWrapper: async (fn, options) => {
    return prisma.$transaction(fn, options)
  },
})
```

## API

### `ChainMonitor`

#### Methods

- `start(): Promise<void>` - Start the monitor
- `stop(): void` - Stop the monitor
- `triggerNow(): void` - Manually trigger a scan

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

[MIT](LICENSE)
