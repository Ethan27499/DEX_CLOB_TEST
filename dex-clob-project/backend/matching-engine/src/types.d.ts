declare module 'pg' {
  export interface PoolConfig {
    host?: string;
    port?: number;
    database?: string;
    user?: string;
    password?: string;
    max?: number;
    idleTimeoutMillis?: number;
    connectionTimeoutMillis?: number;
  }

  export interface QueryResult<T = any> {
    rows: T[];
    rowCount: number;
    command: string;
  }

  export interface PoolClient {
    query<T = any>(text: string, params?: any[]): Promise<QueryResult<T>>;
    release(): void;
  }

  export class Pool {
    constructor(config: PoolConfig);
    connect(): Promise<PoolClient>;
    query<T = any>(text: string, params?: any[]): Promise<QueryResult<T>>;
    end(): Promise<void>;
  }
}

declare module 'logger' {
  export default any;
}

declare module 'websocket' {
  export default any;
}

declare module 'routes' {
  export default any;
}
