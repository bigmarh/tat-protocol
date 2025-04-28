export class DebugLogger {
    private static instance: DebugLogger;
    private isEnabled: boolean = false;
    private prefix: string = '[DEBUG]';
    private enabledPrefixes: Set<string> = new Set();
    private logLevels: Map<string, number> = new Map(); // Prefix -> log level (0: none, 1: error, 2: warn, 3: info)
    private allEnabled: boolean = false;

    private constructor() { }

    static getInstance(): DebugLogger {
        if (!DebugLogger.instance) {
            DebugLogger.instance = new DebugLogger();
        }
        return DebugLogger.instance;
    }

    enable(prefix?: string | string[], level: number = 3) {
        if (prefix) {
            if (Array.isArray(prefix)) {
                prefix.forEach(p => this.enabledPrefixes.add(p));
                prefix.forEach(p => this.logLevels.set(p, level));
            } else {
                this.enabledPrefixes.add(prefix);
                this.logLevels.set(prefix, level);
            }
        } else {
            this.isEnabled = true;
        }
    }

    disable(prefix?: string | string[]) {
        if (prefix) {
            if (Array.isArray(prefix)) {
                prefix.forEach(p => this.enabledPrefixes.delete(p));
                prefix.forEach(p => this.logLevels.delete(p));
            } else {
                this.enabledPrefixes.delete(prefix);
                this.logLevels.delete(prefix);
            }
        } else {
            this.isEnabled = false;
        }
    }

    enableAll(level: number = 3) {
        this.allEnabled = true;
        this.isEnabled = true;
        this.logLevels.set(this.prefix, level);
    }

    disableAll() {
        this.allEnabled = false;
        this.isEnabled = false;
    }
    isPrefixEnabled(prefix: string): boolean {
        return this.enabledPrefixes.has(prefix);
    }

    getLogLevel(prefix: string): number {
        return this.logLevels.get(prefix) || 0;
    }

    log(message: string, prefix?: string, ...args: any[]) {
        const targetPrefix = prefix || this.prefix;
        const level = this.getLogLevel(targetPrefix);
        if ((this.isEnabled || this.enabledPrefixes.has(targetPrefix)) && level >= 3 || this.allEnabled) {
            console.log(`${targetPrefix} ${message}`, ...args);
        }
    }

    error(message: string, prefix?: string, ...args: any[]) {
        const targetPrefix = prefix || this.prefix;
        const level = this.getLogLevel(targetPrefix);
        if ((this.isEnabled || this.enabledPrefixes.has(targetPrefix)) && level >= 1) {
            console.error(`${targetPrefix} [ERROR] ${message}`, ...args);
        }
    }

    warn(message: string, prefix?: string, ...args: any[]) {
        const targetPrefix = prefix || this.prefix;
        const level = this.getLogLevel(targetPrefix);
        if ((this.isEnabled || this.enabledPrefixes.has(targetPrefix)) && level >= 2) {
            console.warn(`${targetPrefix} [WARN] ${message}`, ...args);
        }
    }

    // Utility method to enable multiple prefixes at once
    enableMultiple(prefixes: string[], level: number = 3) {
        prefixes.forEach(prefix => this.enable(prefix, level));
    }

    // Utility method to disable multiple prefixes at once
    disableMultiple(prefixes: string[]) {
        prefixes.forEach(prefix => this.disable(prefix));
    }

    // Get all currently enabled prefixes
    getEnabledPrefixes(): string[] {
        return Array.from(this.enabledPrefixes);
    }

    // Set log level for a specific prefix
    setLogLevel(prefix: string, level: number) {
        if (this.enabledPrefixes.has(prefix)) {
            this.logLevels.set(prefix, level);
        }
    }
} 