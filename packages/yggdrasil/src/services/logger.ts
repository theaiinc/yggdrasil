import winston from 'winston';
import { LoggerConfig, LogLevel } from '../types/index.js';

/**
 * Centralized logging service for Yggdrasil orchestration system
 * Uses Winston for stable, well-documented logging
 */
export class Logger {
  private logger: winston.Logger;
  private static instance: Logger;

  private constructor(config: LoggerConfig) {
    const transports: winston.transport[] = [
      new winston.transports.Console({
        format: winston.format.combine(
          winston.format.timestamp(),
          winston.format.errors({ stack: true }),
          config.format === 'json'
            ? winston.format.json()
            : winston.format.combine(
                winston.format.colorize(),
                winston.format.simple()
              )
        ),
      }),
    ];

    // Add file transport for production
    if (config.transports.includes('file')) {
      transports.push(
        new winston.transports.File({
          filename: 'logs/error.log',
          level: 'error',
          format: winston.format.combine(
            winston.format.timestamp(),
            winston.format.json()
          ),
        }),
        new winston.transports.File({
          filename: 'logs/combined.log',
          format: winston.format.combine(
            winston.format.timestamp(),
            winston.format.json()
          ),
        })
      );
    }

    this.logger = winston.createLogger({
      level: config.level,
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.errors({ stack: true }),
        winston.format.json()
      ),
      defaultMeta: { service: 'yggdrasil' },
      transports,
    });
  }

  public static getInstance(config?: LoggerConfig): Logger {
    if (!Logger.instance) {
      const defaultConfig: LoggerConfig = {
        level: 'info',
        format: 'json',
        transports: ['console'],
      };
      Logger.instance = new Logger(config || defaultConfig);
    }
    return Logger.instance;
  }

  public log(
    level: LogLevel,
    message: string,
    meta?: Record<string, unknown>
  ): void {
    this.logger.log(level, message, meta);
  }

  public error(message: string, meta?: Record<string, unknown>): void {
    this.logger.error(message, meta);
  }

  public warn(message: string, meta?: Record<string, unknown>): void {
    this.logger.warn(message, meta);
  }

  public info(message: string, meta?: Record<string, unknown>): void {
    this.logger.info(message, meta);
  }

  public debug(message: string, meta?: Record<string, unknown>): void {
    this.logger.debug(message, meta);
  }

  public child(meta: Record<string, unknown>): winston.Logger {
    return this.logger.child(meta);
  }
}

/**
 * Convenience function to get logger instance
 */
export const getLogger = (config?: LoggerConfig): Logger => {
  return Logger.getInstance(config);
};
