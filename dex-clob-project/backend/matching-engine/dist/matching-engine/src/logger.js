"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.Logger = void 0;
const winston_1 = __importDefault(require("winston"));
const path_1 = __importDefault(require("path"));
class Logger {
    constructor(component) {
        this.logger = winston_1.default.createLogger({
            level: process.env.LOG_LEVEL || 'info',
            format: winston_1.default.format.combine(winston_1.default.format.timestamp(), winston_1.default.format.errors({ stack: true }), winston_1.default.format.json(), winston_1.default.format.prettyPrint()),
            defaultMeta: { component },
            transports: [
                new winston_1.default.transports.Console({
                    format: winston_1.default.format.combine(winston_1.default.format.colorize(), winston_1.default.format.simple())
                }),
                new winston_1.default.transports.File({
                    filename: path_1.default.join(process.cwd(), 'logs', 'error.log'),
                    level: 'error'
                }),
                new winston_1.default.transports.File({
                    filename: path_1.default.join(process.cwd(), 'logs', 'combined.log')
                })
            ]
        });
    }
    info(message, meta) {
        this.logger.info(message, meta);
    }
    error(message, error) {
        this.logger.error(message, { error });
    }
    warn(message, meta) {
        this.logger.warn(message, meta);
    }
    debug(message, meta) {
        this.logger.debug(message, meta);
    }
    getLogger() {
        return this.logger;
    }
}
exports.Logger = Logger;
//# sourceMappingURL=logger.js.map