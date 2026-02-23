import { ENV } from '../config/env';

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const currentLevel = (ENV.LOG_LEVEL as LogLevel) || 'info';

function shouldLog(level: LogLevel): boolean {
  return LEVEL_PRIORITY[level] >= LEVEL_PRIORITY[currentLevel];
}

function timestamp(): string {
  return new Date().toISOString().slice(11, 19);
}

export const logger = {
  debug(msg: string, ...args: any[]) {
    if (shouldLog('debug')) console.log(`[${timestamp()}] [DEBUG] ${msg}`, ...args);
  },
  info(msg: string, ...args: any[]) {
    if (shouldLog('info')) console.log(`[${timestamp()}] [INFO]  ${msg}`, ...args);
  },
  warn(msg: string, ...args: any[]) {
    if (shouldLog('warn')) console.warn(`[${timestamp()}] [WARN]  ${msg}`, ...args);
  },
  error(msg: string, ...args: any[]) {
    if (shouldLog('error')) console.error(`[${timestamp()}] [ERROR] ${msg}`, ...args);
  },
};
