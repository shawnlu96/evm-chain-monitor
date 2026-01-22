import type { StateStorage } from './types.js'

/**
 * Prisma 客户端接口约束
 * 用户的 PrismaClient 需要有 monitorStatus 模型
 */
export interface PrismaClientLike {
  monitorStatus: {
    findUnique(args: {
      where: { chainId: number }
    }): Promise<{ syncBlockNumber: number } | null>

    upsert(args: {
      where: { chainId: number }
      update: { syncBlockNumber: number }
      create: { chainId: number; syncBlockNumber: number }
    }): Promise<unknown>
  }
}

/**
 * Prisma 状态存储实现
 *
 * 需要在 Prisma schema 中定义 MonitorStatus 模型：
 *
 * ```prisma
 * model MonitorStatus {
 *   chainId         Int @id
 *   syncBlockNumber Int
 *   updatedAt       DateTime @updatedAt
 * }
 * ```
 *
 * @example
 * ```typescript
 * import { PrismaClient } from '@prisma/client'
 * import { PrismaStateStorage } from 'evm-chain-monitor'
 *
 * const prisma = new PrismaClient()
 * const storage = new PrismaStateStorage(prisma)
 *
 * const monitor = ChainMonitor.create({
 *   storage,
 *   transaction: (fn, opts) => prisma.$transaction(fn, opts),
 *   // ...
 * })
 * ```
 */
export class PrismaStateStorage implements StateStorage {
  constructor(private prisma: PrismaClientLike) {}

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
    const client = (tx as PrismaClientLike) ?? this.prisma
    await client.monitorStatus.upsert({
      where: { chainId },
      update: { syncBlockNumber: blockNumber },
      create: { chainId, syncBlockNumber: blockNumber },
    })
  }
}
