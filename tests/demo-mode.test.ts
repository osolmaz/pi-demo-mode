import { beforeAll, describe, expect, it } from "vitest";

// The extension reads its env gate and prompts at module load / send time, so
// the env must be in place before the dynamic import below.
process.env["PI_DEMO_MODE"] = "1";
process.env["PI_DEMO_INITIAL_PROMPT"] = "Begin.";
process.env["PI_DEMO_FOLLOWUP_PROMPT"] = "Continue.";

type DemoExtension = (pi: DemoPiHarness) => void;

let extension: DemoExtension;

beforeAll(async () => {
  const module = (await import("../extensions/demo-mode.js")) as unknown as {
    readonly default: DemoExtension;
  };
  extension = module.default;
});

describe("pi-demo-mode", () => {
  it("sends the initial prompt on TUI startup and follows up after each turn", async () => {
    const pi = new DemoPiHarness();
    extension(pi);

    pi.emitSessionStart({ mode: "tui", percent: 0 });
    await flushMicrotasks();
    expect(pi.sentMessages).toEqual([{ content: "Begin.", options: undefined }]);

    pi.emitTurnEnd({ mode: "tui", percent: 20, stopReason: "stop" });
    await flushMicrotasks();
    expect(pi.sentMessages).toHaveLength(2);
    expect(pi.sentMessages[1]).toEqual({
      content: "Continue.",
      options: { deliverAs: "followUp" }
    });
  });

  it("does nothing outside the TUI", async () => {
    const pi = new DemoPiHarness();
    extension(pi);

    pi.emitSessionStart({ mode: "print", percent: 0 });
    await flushMicrotasks();
    expect(pi.sentMessages).toEqual([]);
  });

  it("stops on aborted or errored turns and ignores tool-use stops", async () => {
    const pi = new DemoPiHarness();
    extension(pi);

    pi.emitSessionStart({ mode: "tui", percent: 0 });
    await flushMicrotasks();

    pi.emitTurnEnd({ mode: "tui", percent: 10, stopReason: "toolUse" });
    await flushMicrotasks();
    expect(pi.sentMessages).toHaveLength(1);

    pi.emitTurnEnd({ mode: "tui", percent: 10, stopReason: "aborted" });
    await flushMicrotasks();
    expect(pi.sentMessages).toHaveLength(1);

    pi.emitTurnEnd({ mode: "tui", percent: 10, stopReason: "stop" });
    await flushMicrotasks();
    expect(pi.sentMessages).toHaveLength(1);
  });

  it("replaces the footer with a status+model line and hides the editor", async () => {
    const pi = new DemoPiHarness();
    extension(pi);

    pi.emitSessionStart({ mode: "tui", percent: 0 });
    await flushMicrotasks();

    expect(pi.footerFactory).toBeDefined();
    const component = pi.footerFactory?.(
      undefined,
      { fg: (_color: string, text: string) => text },
      {
        getExtensionStatuses: () => new Map([["perf", "gen 42.0 tok/s | out 100"]])
      }
    );
    expect(component).toBeDefined();

    // Wide enough: one line with the model right-aligned.
    const wide = component?.render(80) ?? [];
    expect(wide).toHaveLength(1);
    expect(wide[0]).toContain("gen 42.0 tok/s | out 100");
    expect(wide[0]?.trimEnd().endsWith("demo-model")).toBe(true);
    expect(wide[0]).not.toContain("~/");

    // Too narrow for both: statuses first, model on its own line.
    const narrow = component?.render(30) ?? [];
    expect(narrow).toHaveLength(2);
    expect(narrow[0]).toBe("gen 42.0 tok/s | out 100");
    expect(narrow[1]?.trimStart()).toBe("demo-model");
  });

  it("leaves the footer alone when the UI does not support it", async () => {
    const pi = new DemoPiHarness({ supportsChrome: false });
    extension(pi);

    pi.emitSessionStart({ mode: "tui", percent: 0 });
    await flushMicrotasks();
    expect(pi.footerFactory).toBeUndefined();
    expect(pi.sentMessages).toEqual([{ content: "Begin.", options: undefined }]);
  });

  it("compacts before sending the next followup under context pressure", async () => {
    const pi = new DemoPiHarness();
    extension(pi);

    pi.emitSessionStart({ mode: "tui", percent: 0 });
    await flushMicrotasks();
    expect(pi.sentMessages).toHaveLength(1);

    pi.emitTurnEnd({ mode: "tui", percent: 72, stopReason: "length" });
    await flushMicrotasks();
    expect(pi.compactions).toHaveLength(1);
    expect(pi.sentMessages).toHaveLength(1);

    pi.completeCompaction();
    await flushMicrotasks();
    expect(pi.sentMessages).toHaveLength(2);
    expect(pi.sentMessages[1]).toEqual({
      content: "Continue.",
      options: { deliverAs: "followUp" }
    });
  });

  it("stops followups when compaction fails", async () => {
    const pi = new DemoPiHarness();
    extension(pi);

    pi.emitSessionStart({ mode: "tui", percent: 0 });
    await flushMicrotasks();

    pi.emitTurnEnd({ mode: "tui", percent: 90, stopReason: "length" });
    await flushMicrotasks();
    expect(pi.compactions).toHaveLength(1);

    pi.failCompaction(new Error("summary model failed"));
    await flushMicrotasks();
    expect(pi.sentMessages).toHaveLength(1);
    expect(pi.notifications).toEqual([
      { message: "Demo compaction failed: summary model failed", type: "error" }
    ]);

    pi.emitTurnEnd({ mode: "tui", percent: 10, stopReason: "stop" });
    await flushMicrotasks();
    expect(pi.sentMessages).toHaveLength(1);
  });
});

type SentMessage = {
  readonly content: string;
  readonly options: { readonly deliverAs: "followUp" } | undefined;
};

type Notification = {
  readonly message: string;
  readonly type: "error";
};

type DemoContextOptions = {
  readonly mode: "tui" | "print";
  readonly percent: number | null;
};

type DemoTurnOptions = DemoContextOptions & {
  readonly stopReason: "stop" | "length" | "toolUse" | "error" | "aborted";
};

type DemoFooterFactory = (
  tui: unknown,
  theme: { fg(color: string, text: string): string },
  footerData: { getExtensionStatuses(): ReadonlyMap<string, string> }
) => { render(width: number): string[] };

type DemoContext = {
  readonly mode: "tui" | "print";
  readonly model: { readonly id: string; readonly contextWindow: number };
  readonly ui: {
    notify(message: string, type: "error"): void;
    setFooter?(factory: DemoFooterFactory | undefined): void;
    setEditorComponent?(factory: unknown): void;
  };
  getContextUsage(): {
    readonly tokens: number | null;
    readonly contextWindow: number;
    readonly percent: number | null;
  };
  compact(options: {
    readonly customInstructions?: string;
    readonly onComplete?: (result: unknown) => void;
    readonly onError?: (error: Error) => void;
  }): void;
};

type SessionStartEvent = {
  readonly reason: "startup";
};

type TurnEndEvent = {
  readonly message: {
    readonly role: "assistant";
    readonly usage: {
      readonly input: number;
      readonly output: number;
      readonly cacheRead: number;
      readonly cacheWrite: number;
      readonly totalTokens: number;
      readonly cost: {
        readonly input: number;
        readonly output: number;
        readonly cacheRead: number;
        readonly cacheWrite: number;
        readonly total: number;
      };
    };
    readonly stopReason: DemoTurnOptions["stopReason"];
  };
};

type SessionStartHandler = (event: SessionStartEvent, ctx: DemoContext) => void;
type TurnEndHandler = (event: TurnEndEvent, ctx: DemoContext) => void;
type ShutdownHandler = () => void;

class DemoPiHarness {
  readonly sentMessages: SentMessage[] = [];
  readonly compactions: {
    readonly customInstructions?: string;
    readonly onComplete?: (result: unknown) => void;
    readonly onError?: (error: Error) => void;
  }[] = [];
  readonly notifications: Notification[] = [];
  footerFactory: DemoFooterFactory | undefined;

  private readonly supportsChrome: boolean;
  private readonly sessionStartHandlers: SessionStartHandler[] = [];
  private readonly turnEndHandlers: TurnEndHandler[] = [];
  private readonly shutdownHandlers: ShutdownHandler[] = [];

  constructor(options: { readonly supportsChrome?: boolean } = {}) {
    this.supportsChrome = options.supportsChrome ?? true;
  }

  on(event: "session_start", handler: SessionStartHandler): void;
  on(event: "turn_end", handler: TurnEndHandler): void;
  on(event: "session_shutdown", handler: ShutdownHandler): void;
  on(
    event: "session_start" | "turn_end" | "session_shutdown",
    handler: SessionStartHandler | TurnEndHandler | ShutdownHandler
  ): void {
    switch (event) {
      case "session_start":
        this.sessionStartHandlers.push(handler as SessionStartHandler);
        return;
      case "turn_end":
        this.turnEndHandlers.push(handler as TurnEndHandler);
        return;
      case "session_shutdown":
        this.shutdownHandlers.push(handler as ShutdownHandler);
        return;
    }
  }

  sendUserMessage(content: string, options?: { readonly deliverAs: "followUp" }): void {
    this.sentMessages.push({ content, options });
  }

  emitSessionStart(options: DemoContextOptions): void {
    const ctx = this.createContext(options);
    for (const handler of this.sessionStartHandlers) {
      handler({ reason: "startup" }, ctx);
    }
  }

  emitTurnEnd(options: DemoTurnOptions): void {
    const ctx = this.createContext(options);
    const totalTokens =
      options.percent === null ? 0 : Math.round((options.percent / 100) * 100_000);
    for (const handler of this.turnEndHandlers) {
      handler(
        {
          message: {
            role: "assistant",
            usage: {
              input: totalTokens,
              output: 0,
              cacheRead: 0,
              cacheWrite: 0,
              totalTokens,
              cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
            },
            stopReason: options.stopReason
          }
        },
        ctx
      );
    }
  }

  completeCompaction(): void {
    const compaction = this.compactions.at(-1);
    expect(compaction).toBeDefined();
    compaction?.onComplete?.({ summary: "done" });
  }

  failCompaction(error: Error): void {
    const compaction = this.compactions.at(-1);
    expect(compaction).toBeDefined();
    compaction?.onError?.(error);
  }

  private createContext(options: DemoContextOptions): DemoContext {
    const chrome = this.supportsChrome
      ? {
          setFooter: (factory: DemoFooterFactory | undefined) => {
            this.footerFactory = factory;
          },
          setEditorComponent: () => undefined
        }
      : {};
    return {
      mode: options.mode,
      model: { id: "demo-model", contextWindow: 100_000 },
      ui: {
        notify: (message, type) => {
          this.notifications.push({ message, type });
        },
        ...chrome
      },
      getContextUsage: () => ({
        tokens: options.percent === null ? null : Math.round((options.percent / 100) * 100_000),
        contextWindow: 100_000,
        percent: options.percent
      }),
      compact: (compactionOptions) => {
        this.compactions.push(compactionOptions);
      }
    };
  }
}

async function flushMicrotasks(): Promise<void> {
  await new Promise<void>((resolve) => {
    setImmediate(resolve);
  });
}
