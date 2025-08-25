export class Logger {
  private context: string;

  constructor(context: string) {
    this.context = context;
  }

  public info(message: string, data?: any): void {
    const timestamp = new Date().toISOString();
    const logEntry = {
      timestamp,
      level: 'INFO',
      context: this.context,
      message,
      data
    };
    
    console.log(`[${timestamp}] [INFO] [${this.context}] ${message}`, data ? JSON.stringify(data, null, 2) : '');
  }

  public warn(message: string, data?: any): void {
    const timestamp = new Date().toISOString();
    const logEntry = {
      timestamp,
      level: 'WARN',
      context: this.context,
      message,
      data
    };
    
    console.warn(`[${timestamp}] [WARN] [${this.context}] ${message}`, data ? JSON.stringify(data, null, 2) : '');
  }

  public error(message: string, error?: any): void {
    const timestamp = new Date().toISOString();
    const logEntry = {
      timestamp,
      level: 'ERROR',
      context: this.context,
      message,
      error: error instanceof Error ? {
        name: error.name,
        message: error.message,
        stack: error.stack
      } : error
    };
    
    console.error(`[${timestamp}] [ERROR] [${this.context}] ${message}`, error);
  }

  public debug(message: string, data?: any): void {
    // Always log debug in development for now
    const timestamp = new Date().toISOString();
    const logEntry = {
      timestamp,
      level: 'DEBUG',
      context: this.context,
      message,
      data
    };
    
    console.debug(`[${timestamp}] [DEBUG] [${this.context}] ${message}`, data ? JSON.stringify(data, null, 2) : '');
  }
}
