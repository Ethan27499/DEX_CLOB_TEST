import winston from 'winston';
import path from 'path';

export class Logger {
  private logger: winston.Logger;

  constructor(component: string) {
    this.logger = winston.createLogger({
      level: process.env.LOG_LEVEL || 'info',
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.errors({ stack: true }),
        winston.format.json(),
        winston.format.prettyPrint()
      ),
      defaultMeta: { component },
      transports: [
        // Console transport
        new winston.transports.Console({
          format: winston.format.combine(
            winston.format.colorize(),
            winston.format.simple()
          )
        }),
        
        // File transport
        new winston.transports.File({
          filename: path.join(process.cwd(), 'logs', 'error.log'),
          level: 'error'
        }),
        
        new winston.transports.File({
          filename: path.join(process.cwd(), 'logs', 'combined.log')
        })
      ]
    });
  }

  public info(message: string, meta?: any): void {
    this.logger.info(message, meta);
  }

  public error(message: string, error?: any): void {
    this.logger.error(message, { error });
  }

  public warn(message: string, meta?: any): void {
    this.logger.warn(message, meta);
  }

  public debug(message: string, meta?: any): void {
    this.logger.debug(message, meta);
  }

  public getLogger(): winston.Logger {
    return this.logger;
  }
}
