import { id, Log, JsonRpcProvider, Interface } from 'ethers'
import type { ParsedEvent, LogSelector } from './types.js'

/**
 * 将事件签名转换为 topic hash
 * 如果已经是 0x 开头的 hash，直接返回
 *
 * @example
 * eventTopic('Transfer(address,address,uint256)')
 * // => '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'
 *
 * eventTopic('0xddf252ad...')
 * // => '0xddf252ad...' (unchanged)
 */
export function eventTopic(signature: string): string {
  if (signature.startsWith('0x')) {
    return signature
  }
  return id(signature)
}

/**
 * 批量转换事件签名为 topic hash
 */
export function eventTopics(signatures: string[]): string[] {
  return signatures.map(eventTopic)
}

/**
 * 创建默认的 logSelector
 * 基于合约地址和事件 topics 过滤日志
 */
export function createLogSelector(
  contractAddresses: string[],
  topics: string[]
): LogSelector {
  return async ({ fromBlock, toBlock }, provider) => {
    // 如果只有一个合约地址，直接使用
    // 如果有多个，需要分别查询后合并（ethers 不支持多地址查询）
    if (contractAddresses.length === 1) {
      return provider.getLogs({
        address: contractAddresses[0],
        topics: [topics],
        fromBlock,
        toBlock,
      })
    }

    // 多个合约地址：并行查询
    const logsArrays = await Promise.all(
      contractAddresses.map((address) =>
        provider.getLogs({
          address,
          topics: [topics],
          fromBlock,
          toBlock,
        })
      )
    )

    // 合并并按区块号和日志索引排序
    return logsArrays
      .flat()
      .sort((a, b) => {
        if (a.blockNumber !== b.blockNumber) {
          return a.blockNumber - b.blockNumber
        }
        return a.index - b.index
      })
  }
}

/**
 * 创建 ParsedEvent 对象
 * 包装原始 Log，提供便捷方法
 */
export function createParsedEvent(
  log: Log,
  chainId: number,
  blockTimestamp: number,
  provider: JsonRpcProvider
): ParsedEvent {
  // 缓存懒加载的数据
  let cachedTx: Awaited<ReturnType<JsonRpcProvider['getTransaction']>> | undefined
  let cachedBlock: Awaited<ReturnType<JsonRpcProvider['getBlock']>> | undefined

  return {
    log,
    chainId,
    blockNumber: log.blockNumber,
    blockTimestamp,
    transactionHash: log.transactionHash,
    logIndex: log.index,
    address: log.address,
    topics: log.topics,
    data: log.data,

    async getTransaction() {
      if (cachedTx === undefined) {
        cachedTx = await provider.getTransaction(log.transactionHash)
      }
      return cachedTx
    },

    async getBlock() {
      if (cachedBlock === undefined) {
        cachedBlock = await provider.getBlock(log.blockNumber)
      }
      return cachedBlock
    },

    decode(iface: Interface, eventName?: string) {
      if (eventName) {
        return iface.decodeEventLog(eventName, log.data, log.topics)
      }
      // 尝试根据 topic 自动匹配事件
      const eventFragment = iface.getEvent(log.topics[0])
      if (!eventFragment) {
        throw new Error(`Unknown event topic: ${log.topics[0]}`)
      }
      return iface.decodeEventLog(eventFragment, log.data, log.topics)
    },
  }
}

/**
 * 将秒数转换为 cron 表达式
 * 内部使用，对外隐藏 cron 细节
 */
export function secondsToCron(seconds: number): string {
  if (seconds < 1) {
    throw new Error('Poll interval must be at least 1 second')
  }

  if (seconds < 60) {
    // 每 N 秒
    return `*/${seconds} * * * * *`
  }

  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) {
    // 每 N 分钟
    return `0 */${minutes} * * * *`
  }

  const hours = Math.floor(minutes / 60)
  // 每 N 小时
  return `0 0 */${hours} * * *`
}
