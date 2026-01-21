import type { StateStorage } from './types.js'

/**
 * 内存状态存储
 * 默认实现，适用于开发测试或不需要持久化的场景
 * 注意：进程重启后状态会丢失
 */
export class MemoryStateStorage implements StateStorage {
  private storage = new Map<number, number>()

  async getSyncBlockNumber(chainId: number): Promise<number | null> {
    return this.storage.get(chainId) ?? null
  }

  async setSyncBlockNumber(chainId: number, blockNumber: number): Promise<void> {
    this.storage.set(chainId, blockNumber)
  }

  /**
   * 清除所有状态（用于测试）
   */
  clear(): void {
    this.storage.clear()
  }
}
