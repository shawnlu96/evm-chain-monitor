# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build Commands

```bash
yarn build      # Compile TypeScript to ./build
yarn clean      # Remove build directory
```

No test framework is configured. No linting tools are set up.

## Architecture

This is `evm-chain-monitor`, a TypeScript library for monitoring EVM blockchain events with two operational modes:

### Core Concepts

**Dual Mode System:**
- **Racing mode**: WebSocket and HTTP process events in parallel with deduplication cache. First-come-first-served, no ordering guarantee. Use for speed-critical scenarios.
- **Sequential mode** (default): Events processed in strict block order with transaction support for atomicity. WebSocket triggers HTTP polling.

**Pluggable Interfaces:**
- `StateStorage`: Persist sync progress (implementations: `MemoryStateStorage`, `PrismaStateStorage`)
- `Logger`: Logging abstraction (implementation: `ConsoleLogger`)
- `TransactionWrapper`: Database transaction support (e.g., Prisma `$transaction`)
- `LogSelector`: Custom log filtering logic

### Source Structure

```
src/
├── ChainMonitor.ts      # Main class with create() factory and dual-mode logic
├── types.ts             # All TypeScript interfaces and types
├── helpers.ts           # eventTopic(), createLogSelector(), createParsedEvent()
├── MemoryStateStorage.ts
├── PrismaStateStorage.ts
└── ConsoleLogger.ts
```

### Key Patterns

- Factory pattern: `ChainMonitor.create(SimpleMonitorConfig)` for simple usage vs `new ChainMonitor(ChainMonitorConfig)` for advanced
- Lazy loading: `ParsedEvent.getTransaction()` and `getBlock()` fetch data only when called
- Cron-based polling with `CronJob` from the `cron` package
- Block timestamp caching to reduce RPC calls
- Deduplication cache (racing mode) with configurable expiry

### Dependencies

- Runtime: `cron` only
- Peer: `ethers` v6

## Prisma Integration

When using `PrismaStateStorage`, users need this model:

```prisma
model MonitorStatus {
  chainId         Int @id
  syncBlockNumber Int
  updatedAt       DateTime @updatedAt
}
```
