import { Config } from "./Config";
import { Codec } from "./Codec";
import { Route } from "./Route";
import { ConnectRouter } from "./ConnectRouter";

const DEFAULT_CONFIG: Config = {
	ackDeadline: 5000,
	clientSilentDeadline: 30000,
	serverSilentDeadline: 30000,
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

/**
 * The main router for undersea. Start here.
 *
 * # Example
 *
 * ```ts
 * const { route, finalize } = new Router();
 *
 * const isEvenRoute = route<"client send", { val: number }, { isEven: boolean }>();
 *
 * const { serverRouter, clientRouter } = finalize();
 *
 * const isEvenServer = isEvenRoute.server.asRecv(({ val }) => ({ isEven: val % 2 === 0 }));
 * const isEvenClient = isEvenRoute.client.asSend();
 *
 * serverRouter()
 *   .withConnection(
 *     async () => ({
 * 		  socket: { Socket interface },
 *     })
 *   )
 *   .withRoutes(
 *     isEvenServer
 *   )
 *   .start();
 *
 * const client = clientRouter()
 *   .withConnection(
 *     async () => ({
 * 		  socket: { Socket interface },
 *     })
 *   )
 *   .start()
 *
 * const instance = isEvenClient.connect(client);
 *
 * expect(instance.send({ val: 2 })).resolves.toEqual({ isEven: true });
 * ```
 */
export class Router {
	private readonly context: {
		codec: Codec;
		config: Config;
	};

	private readonly identity = Symbol("Router");

	/**
	 * Override default router options.
	 *
	 * @param override Override router options.
	 */
	constructor(override?: {
		/**
		 * Override the default codec.
		 *
		 * The default codec converts the object to JSON and then represents it as a UTF-8 ArrayBuffer.
		 */
		codec?: Partial<Codec>;
		/**
		 * Override the default config.
		 *
		 * Times in milliseconds.
		 *
		 * Default config:
		 * - `ackDeadline`: 5000
		 * - `clientSilentDeadline`: 30000
		 * - `serverSilentDeadline`: 30000
		 */
		config?: Partial<Config>;
	}) {
		this.context = {
			codec: { ...DEFAULT_CODEC, ...override?.codec },
			config: { ...DEFAULT_CONFIG, ...override?.config },
		};

		this.route = this.route.bind(this);
		this.finalize = this.finalize.bind(this);
	}

	private routeTypes: Array<
		Record<"client" | "server", "client" | "server" | "unknown">
	> = [];

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
	 * # Example
	 * ```ts
	 * const actionA = route<"client send", { val: number }, { isEven: boolean }>();
	 * const clientActionA = actionA.client.asSend();
	 * const serverActionA = actionA.server.asRecv(...);
	 *
	 * const actionB = route<"server send stream", { send: string }, { recv: string }>();
	 * const clientActionB = actionB.server.asSendStream(...);
	 * const serverActionB = actionB.client.asRecvStream(...);
	 * ```
	 *
	 * @param type Route type. One of "query", "query stream", "stream", "duplex".
	 * @param config Route configuration.
	 */
	public route<
		Kind extends `${"server" | "client"} ${
			| "send"
			| "send stream"
			| "stream"
			| "duplex"}`,
		ServerRecv,
		ClientRecv,
	>(config?: Partial<Config>) {
		if (this.finalized) {
			throw Error("Router has been finalized");
		}

		const types = {
			client: "unknown" as "client" | "server" | "unknown",
			server: "unknown" as "client" | "server" | "unknown",
		};

		this.routeTypes.push(types);

		const key = this.routeTypes.length;

		if (key > 0xff_ff) {
			throw Error("Too many routes");
		}

		const server = Route.factory<
			ClientRecv,
			ServerRecv,
			Kind extends `server ${infer Type}`
				? Type extends "send"
					? "asSend"
					: Type extends "send stream"
					  ? "asSendStream"
					  : Type extends "stream"
						  ? "asSendStreamOnly"
						  : Type extends "duplex"
							  ? "asSendDuplex"
							  : never
				: Kind extends `client ${infer Type}`
				  ? Type extends "send"
						? "asRecv"
						: Type extends "send stream"
						  ? "asRecvStream"
						  : Type extends "stream"
							  ? "asRecvStreamOnly"
							  : Type extends "duplex"
								  ? "asRecvDuplex"
								  : never
				  : never
		>(
			{
				codec: this.context.codec,
				config: { ...this.context.config, ...config },
				identity: this.identity,
				key,
			},
			(type) => {
				types.server = type;
			},
		);

		const client = Route.factory<
			ClientRecv,
			ServerRecv,
			Kind extends `client ${infer Type}`
				? Type extends "send"
					? "asSend"
					: Type extends "send stream"
					  ? "asSendStream"
					  : Type extends "stream"
						  ? "asSendStreamOnly"
						  : Type extends "duplex"
							  ? "asSendDuplex"
							  : never
				: Kind extends `server ${infer Type}`
				  ? Type extends "send"
						? "asRecv"
						: Type extends "send stream"
						  ? "asRecvStream"
						  : Type extends "stream"
							  ? "asRecvStreamOnly"
							  : Type extends "duplex"
								  ? "asRecvDuplex"
								  : never
				  : never
		>(
			{
				codec: this.context.codec,
				config: { ...this.context.config, ...config },
				identity: this.identity,
				key,
			},
			(type) => {
				types.server = type;
			},
		);

		return {
			/**
			 * The server route creator. Use this to define the server side of the route.
			 */
			server,
			/**
			 * The client route creator. Use this to define the client side of the route.
			 */
			client,
		};
	}

	/**
	 * Stop further route registration and return the router.
	 *
	 * The generated router may be used multiple times in different connections.
	 *
	 * # Example
	 *
	 * ```ts
	 * // ... Ensure you import all your routes before finalizing the router.
	 *
	 * const { serverRouter, clientRouter } = finalize();
	 *
	 * const server = serverRouter()
	 *   .withApp(...)
	 *   .withConnection(...)
	 *   .withRoutes(...)
	 *   .start();
	 *
	 * serverAction(server).send(...);
	 *
	 * const client = clientRouter()
	 *   .withApp(...)
	 *   .withConnection(...)
	 *   .withRoutes(...)
	 *   .start();
	 *
	 * clientAction(client).send(...);
	 * ```
	 *
	 * @returns A router that needs bindings to the application context and connections.
	 */
	public finalize() {
		this.finalized = true;

		return {
			/**
			 * A server router factory.
			 */
			serverRouter: () =>
				ConnectRouter.factory(
					this.routeTypes.filter((type) => type.server === "server").length,
					this.identity,
				),
			/**
			 * A client router factory.
			 */
			clientRouter: () =>
				ConnectRouter.factory(
					this.routeTypes.filter((type) => type.client === "server").length,
					this.identity,
				),
		};
	}
}
