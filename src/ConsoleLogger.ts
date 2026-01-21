import type { Logger } from './types.js'

/**
 * Console 日志实现
 * 默认使用，可替换为 tslog、winston、pino 等
 */
export class ConsoleLogger implements Logger {
  private prefix: string

  constructor(prefix: string = '[ChainMonitor]') {
    this.prefix = prefix
  }

  info(message: string, ...args: unknown[]): void {
    console.log(`${this.prefix} ${message}`, ...args)
  }

  warn(message: string, ...args: unknown[]): void {
    console.warn(`${this.prefix} ${message}`, ...args)
  }

  error(message: string, ...args: unknown[]): void {
    console.error(`${this.prefix} ${message}`, ...args)
  }

  debug(message: string, ...args: unknown[]): void {
    console.debug(`${this.prefix} ${message}`, ...args)
  }
}
