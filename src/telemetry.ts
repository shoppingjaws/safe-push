import { trace, type Span, SpanStatusCode, type Attributes } from "@opentelemetry/api";

const TRACER_NAME = "safe-push";

let shutdownFn: (() => Promise<void>) | null = null;

/**
 * OpenTelemetry トレーシングを初期化する。
 * SDK は動的 import で読み込み、--trace 未使用時はゼロオーバーヘッドとする。
 */
export async function initTelemetry(exporter: "otlp" | "console"): Promise<void> {
  const { BasicTracerProvider, SimpleSpanProcessor } = await import(
    "@opentelemetry/sdk-trace-base"
  );
  const { resourceFromAttributes } = await import("@opentelemetry/resources");
  const { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } = await import(
    "@opentelemetry/semantic-conventions"
  );

  let spanExporter;
  if (exporter === "otlp") {
    const { OTLPTraceExporter } = await import(
      "@opentelemetry/exporter-trace-otlp-http"
    );
    spanExporter = new OTLPTraceExporter();
  } else {
    const { ConsoleSpanExporter } = await import(
      "@opentelemetry/sdk-trace-base"
    );
    spanExporter = new ConsoleSpanExporter();
  }

  const resource = resourceFromAttributes({
    [ATTR_SERVICE_NAME]: "safe-push",
    [ATTR_SERVICE_VERSION]: "0.3.0",
  });

  const provider = new BasicTracerProvider({
    resource,
    spanProcessors: [new SimpleSpanProcessor(spanExporter)],
  });
  trace.setGlobalTracerProvider(provider);

  shutdownFn = async () => {
    await provider.forceFlush();
    await provider.shutdown();
  };
}

/**
 * トレーシングをシャットダウンし、バッファ内のスパンをフラッシュする。
 */
export async function shutdownTelemetry(): Promise<void> {
  if (shutdownFn) {
    await shutdownFn();
    shutdownFn = null;
  }
}

/**
 * トレーサーを取得する。
 * initTelemetry() 未呼び出し時は no-op tracer が返る。
 */
export function getTracer() {
  return trace.getTracer(TRACER_NAME);
}

/**
 * スパンを作成し、関数を実行する。エラー時はスパンにエラーを記録して再 throw する。
 */
export async function withSpan<T>(
  name: string,
  fn: (span: Span) => Promise<T>,
  attributes?: Attributes,
): Promise<T> {
  const tracer = getTracer();
  return tracer.startActiveSpan(name, { attributes }, async (span) => {
    try {
      const result = await fn(span);
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (error) {
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: error instanceof Error ? error.message : String(error),
      });
      span.recordException(
        error instanceof Error ? error : new Error(String(error)),
      );
      throw error;
    } finally {
      span.end();
    }
  });
}
