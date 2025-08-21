import winston from 'winston';
export declare class Logger {
    private logger;
    constructor(component: string);
    info(message: string, meta?: any): void;
    error(message: string, error?: any): void;
    warn(message: string, meta?: any): void;
    debug(message: string, meta?: any): void;
    getLogger(): winston.Logger;
}
//# sourceMappingURL=logger.d.ts.map