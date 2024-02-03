import { Socket } from "../lib/Socket";
import { Config } from "./Config";
import { Codec } from "./Codec";
import { Route } from "./Route";

const DEFAULT_CONFIG = {
	ackDeadline: 5000,
	channelSilentDeadline: 30000,
	connectSilentDeadline: 30000,
};

const DEFAULT_CODEC = {
	encode(data: unknown) {
		return new TextEncoder().encode(JSON.stringify(data)).buffer;
	},
	decode(data: ArrayBuffer) {
		try {
			return JSON.parse(new TextDecoder().decode(data));
		} catch (e) {
			console.error(e);
			return null;
		}
	},
};

export class Router<
	ServerApp = null,
	ClientApp = null,
	ServerConnection = null,
	ClientConnection = null,
> {
	private readonly context: {
		codec: Codec;
		config: Config;
	};

	constructor(context?: { codec?: Partial<Codec>; config?: Partial<Config> }) {
		this.context = {
			codec: { ...DEFAULT_CODEC, ...context?.codec },
			config: { ...DEFAULT_CONFIG, ...context?.config },
		};
	}

	/**
	 * Holds all the routes that have been registered.
	 *
	 * Allows us to index the routes with stable keys.
	 */
	private readonly routes: Array<{
		server: Route<
			ServerApp,
			ServerConnection,
			// biome-ignore lint/suspicious/noExplicitAny: The stored value here is never actually used
			any,
			// biome-ignore lint/suspicious/noExplicitAny: The stored value here is never actually used
			any
		>;
		client: Route<
			ClientApp,
			ClientConnection,
			// biome-ignore lint/suspicious/noExplicitAny: The stored value here is never actually used
			any,
			// biome-ignore lint/suspicious/noExplicitAny: The stored value here is never actually used
			any
		>;
	}> = [];

	private finalized = false;

	/**
	 * Registers a new route, allowing for methods to be bound to the routes.
	 *
	 * Route types are as follows:
	 * - "send": A single request and response.
	 * - "send stream": Repeated requests and response pairs.
	 * - "stream": A continuous stream of data in one direction only.
	 * - "duplex": A continuous stream of data in both directions.
	 *
	 * @param type Route type. One of "query", "query stream", "stream", "duplex".
	 * @param config Route configuration.
	 */
	public route<
		Source extends "server" | "client",
		Type extends "send" | "send stream" | "stream" | "duplex",
		ServerRecv,
		ClientRecv,
	>(config?: Config) {
		if (this.finalized) {
			throw new Error("Router has been finalized");
		}

		const server = new Route<
			ServerApp,
			ServerConnection,
			ClientRecv,
			ServerRecv
		>({
			codec: this.context.codec,
			config: { ...this.context.config, ...config },
			key: this.routes.length,
		});

		const client = new Route<
			ClientApp,
			ClientConnection,
			ClientRecv,
			ServerRecv
		>({
			codec: this.context.codec,
			config: { ...this.context.config, ...config },
			key: this.routes.length,
		});

		this.routes.push({ server, client });

		return {
			server: server as Pick<
				typeof server,
				Source extends "server"
					? Type extends "send"
						? "asSend"
						: Type extends "send stream"
						  ? "asSendStream"
						  : Type extends "stream"
							  ? "asSendStreamOnly"
							  : Type extends "duplex"
								  ? "asSendDuplex"
								  : never
					: Type extends "send"
					  ? "asRecv"
					  : Type extends "send stream"
						  ? "asRecvStream"
						  : Type extends "stream"
							  ? "asRecvStreamOnly"
							  : Type extends "duplex"
								  ? "asRecvDuplex"
								  : never
			>,
			client: client as Pick<
				typeof client,
				Source extends "client"
					? Type extends "send"
						? "asSend"
						: Type extends "send stream"
						  ? "asSendStream"
						  : Type extends "stream"
							  ? "asSendStreamOnly"
							  : Type extends "duplex"
								  ? "asSendDuplex"
								  : never
					: Type extends "send"
					  ? "asRecv"
					  : Type extends "send stream"
						  ? "asRecvStream"
						  : Type extends "stream"
							  ? "asRecvStreamOnly"
							  : Type extends "duplex"
								  ? "asRecvDuplex"
								  : never
			>,
		};
	}

	/**
	 * Create client and server context bindings.
	 *
	 * You should only need to call this once.
	 *
	 * Never make any more routes after calling this method.
	 */
	public finalize() {
		this.finalized = true;

		return {
			bindClient(
				app: ClientApp,
				connect: () => Promise<{
					socket: Socket;
					connection: ClientConnection;
				}>,
			) {
				return () =>
					connect().then(({ socket, connection }) => ({
						app,
						connection,
						socket,
					}));
			},

			bindServer(
				app: ServerApp,
				connect: () => Promise<{
					socket: Socket;
					connection: ServerConnection;
				}>,
			) {
				return () =>
					connect().then(({ socket, connection }) => ({
						app,
						connection,
						socket,
					}));
			},
		};
	}
}
