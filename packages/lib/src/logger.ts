import { AsyncLocalStorage } from "async_hooks";

export type LogLevel = "info" | "warn" | "error" | "verbose";

export interface LogEntry {
  level: LogLevel;
  message: string;
  timestamp: Date;
}

/** Pipeline stage a structured event belongs to. */
export type StageName = "ocr" | "vision" | "llm" | "plan" | "html";

/**
 * A structured progress/metrics event emitted during a conversion. This is the
 * machine-readable channel the CLI serializes as NDJSON (`--json-events`) for the
 * GUI server to parse. Plain `logger.info/warn/...` calls are also surfaced here as
 * `kind: "log"` events so a single subscriber sees everything in order.
 */
export interface ConversionEvent {
  kind: "stage-start" | "stage-end" | "progress" | "tokens" | "log" | "error" | "done";
  /** set automatically when emitted inside a withRunContext(...) scope */
  runId?: string;
  stage?: StageName;
  phase?: string;
  page?: number;
  pageCount?: number;
  tokensIn?: number;
  tokensOut?: number;
  /** Actual USD cost for this stage, when the provider reports it. */
  costUsd?: number;
  /** OpenRouter generation ids (for a later $-cost lookup pass). */
  generationIds?: string[];
  durationMs?: number;
  level?: LogLevel;
  message?: string;
  timestamp: string; // ISO-8601
}

/**
 * Per-run context. When code runs inside `withRunContext(...)`, every log and
 * structured event is also delivered to that run's `onEvent` sink (tagged with
 * `runId`). This lets the in-process GUI engine run multiple conversions
 * concurrently and still route each one's events to its own SSE stream, despite
 * the logger being a process-wide singleton.
 */
interface RunContext {
  runId: string;
  onEvent: (event: ConversionEvent) => void;
}

const runContextStore = new AsyncLocalStorage<RunContext>();

/** Run `fn` so its logs/events are routed to `onEvent`, tagged with `runId`. */
export function withRunContext<T>(
  runId: string,
  onEvent: (event: ConversionEvent) => void,
  fn: () => Promise<T>,
): Promise<T> {
  return runContextStore.run({ runId, onEvent }, fn);
}

/**
 * Logger singleton class that captures log messages and notifies subscribers
 */
class Logger {
  private static instance: Logger;
  private subscribers: Set<(log: LogEntry) => void> = new Set();
  private subscriptionCounts: Map<(log: LogEntry) => void, number> = new Map();
  private eventSubscribers: Set<(event: ConversionEvent) => void> = new Set();

  private constructor() {}

  /**
   * Get the singleton logger instance
   */
  public static getInstance(): Logger {
    if (!Logger.instance) {
      Logger.instance = new Logger();
    }
    return Logger.instance;
  }
  /**
   * Subscribe to log messages
   */
  public subscribe(callback: (log: LogEntry) => void): void {
    this.subscribers.add(callback);
    // Increment the subscription count for this callback
    const currentCount = this.subscriptionCounts.get(callback) || 0;
    this.subscriptionCounts.set(callback, currentCount + 1);
  }

  /**
   * Unsubscribe from log messages
   */
  public unsubscribe(callback: (log: LogEntry) => void): void {
    const currentCount = this.subscriptionCounts.get(callback) || 0;
    if (currentCount <= 1) {
      // Only actually unsubscribe when count reaches zero
      this.subscribers.delete(callback);
      this.subscriptionCounts.delete(callback);
    } else {
      // Decrement the count but keep the subscription active
      this.subscriptionCounts.set(callback, currentCount - 1);
    }
  }

  /**
   * Subscribe to structured conversion events (progress, timing, tokens, logs).
   */
  public subscribeEvents(callback: (event: ConversionEvent) => void): void {
    this.eventSubscribers.add(callback);
  }

  public unsubscribeEvents(callback: (event: ConversionEvent) => void): void {
    this.eventSubscribers.delete(callback);
  }

  /**
   * Emit a structured event to event subscribers. `timestamp` is stamped here.
   */
  public event(event: Omit<ConversionEvent, "timestamp">): void {
    const full: ConversionEvent = { ...event, timestamp: new Date().toISOString() };
    this.eventSubscribers.forEach((cb) => cb(full));
    const ctx = runContextStore.getStore();
    if (ctx) ctx.onEvent({ ...full, runId: ctx.runId });
  }

  /**
   * Log an info message
   */
  public info(message: string): LogEntry {
    return this.addLog("info", message);
  }

  public warn(message: string): LogEntry {
    return this.addLog("warn", message);
  }

  /**
   * Log an error message
   */
  public error(message: string): LogEntry {
    return this.addLog("error", message);
  }

  /**
   * Log a verbose message
   */
  public verbose(message: string): LogEntry {
    return this.addLog("verbose", message);
  }
  /**
   * Add a log entry to the internal collection
   */ private addLog(level: LogLevel, message: string): LogEntry {
    const entry: LogEntry = {
      level,
      message,
      timestamp: new Date(),
    };

    // Notify all subscribers
    this.subscribers.forEach((callback) => callback(entry));

    // Mirror into the structured-event channel so a single event subscriber sees
    // human logs and structured events together, in order.
    const iso = entry.timestamp.toISOString();
    this.eventSubscribers.forEach((cb) => cb({ kind: "log", level, message, timestamp: iso }));
    const ctx = runContextStore.getStore();
    if (ctx) ctx.onEvent({ kind: "log", level, message, timestamp: iso, runId: ctx.runId });

    return entry;
  }
}

// Export the singleton instance
export const logger = Logger.getInstance();
