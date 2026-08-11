declare module "fluent-logger" {
	interface FluentTransportOptions {
		host?: string;
		port?: number;
		timeout?: number;
		reconnectInterval?: number;
		messageQueueSizeLimit?: number;
		highWaterMark?: number;
		level?: string;
		format?: unknown;
	}

	interface FluentTransportConstructor {
		// Returned instance is a winston-compatible Transport (winston.transport);
		// kept as `object` here since winston-transport isn't a direct dependency
		// of this package and so isn't resolvable as a type import.
		new (tag: string, options?: FluentTransportOptions): object;
	}

	const fluentLogger: {
		support: {
			winstonTransport(): FluentTransportConstructor;
		};
	};

	export default fluentLogger;
}
