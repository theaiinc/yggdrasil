/**
 * Core types for the Yggdrasil orchestration system
 */

export type LogLevel = 'error' | 'warn' | 'info' | 'debug';

export interface LoggerConfig {
  level: LogLevel;
  format: 'json' | 'simple';
  transports: string[];
}
