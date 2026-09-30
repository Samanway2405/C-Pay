export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
  NONE = 4,
}

// In production, only log ERRORs. In development, log everything.
const CURRENT_LOG_LEVEL = __DEV__ ? LogLevel.DEBUG : LogLevel.ERROR;

export const Logger = {
  debug: (...args: any[]) => {
    if (CURRENT_LOG_LEVEL <= LogLevel.DEBUG) {
      console.debug(...args);
    }
  },
  info: (...args: any[]) => {
    if (CURRENT_LOG_LEVEL <= LogLevel.INFO) {
      console.info(...args);
    }
  },
  warn: (...args: any[]) => {
    if (CURRENT_LOG_LEVEL <= LogLevel.WARN) {
      console.warn(...args);
    }
  },
  error: (...args: any[]) => {
    if (CURRENT_LOG_LEVEL <= LogLevel.ERROR) {
      console.error(...args);
    }
  },
};
