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
		this.serverRouter = this.serverRouter.bind(this);
		this.clientRouter = this.clientRouter.bind(this);
	}

	private routeTypes: Array<{
		client: "client" | "server";
		server: "client" | "server";
	}> = [];

	/**
	 * Registers a new send route that is initiated by the server.
	 *
	 * # Example
	 *
	 * ```ts
	 * const { server, client } = router
	 *   .routeServerSend()
	 *   .define<{ val: number }, { isEven: boolean }>();
	 *
	 * server.asSend(...);
	 * client.asRecv(...);
	 * ```
	 */
	public routeServerSend() {
		return this.route("server send");
	}

	/**
	 * Registers a new stream route that is initiated by the server.
	 *
	 * # Example
	 *
	 * ```ts
	 * const { server, client } = router
	 *   .routeServerSendChannel()
	 *   .define<{ val: number }, { isEven: boolean }>();
	 *
	 * server.asSendChannel(...);
	 * client.asRecvChannel(...);
	 * ```
	 */
	public routeServerSendChannel() {
		return this.route("server channel");
	}

	/**
	 * Registers a new simplex stream route that is initiated by the server.
	 *
	 * # Example
	 *
	 * ```ts
	 * const { server, client } = router
	 *   .routeServerSendStream()
	 *   .define<{ val: number }, { isEven: boolean }>();
	 *
	 * server.asSendStream(...);
	 * client.asRecvStream(...);
	 * ```
	 */
	public routeServerSendStream() {
		return this.route("server stream");
	}

	/**
	 * Registers a new duplex stream route that is initiated by the server.
	 *
	 * # Example
	 *
	 * ```ts
	 * const { server, client } = route
	 *   .routeServerSendDuplex()
	 *   .define<{ val: number }, { isEven: boolean }>();
	 *
	 * server.asSendDuplex(...);
	 * client.asRecvDuplex(...);
	 * ```
	 */
	public routeServerSendDuplex() {
		return this.route("server duplex");
	}

	/**
	 * Registers a new send route that is initiated by the client.
	 *
	 * # Example
	 *
	 * ```ts
	 * const { server, client } = router
	 *   .routeClientSend()
	 *   .define<{ val: number }, { isEven: boolean }>();
	 *
	 * client.asSend(...);
	 * server.asRecv(...);
	 * ```
	 */
	public routeClientSend() {
		return this.route("client send");
	}

	/**
	 * Registers a new stream route that is initiated by the client.
	 *
	 * # Example
	 *
	 * ```ts
	 * const { server, client } = router
	 *	 .routeClientSendChannel()
	 *   .define<{ val: number }, { isEven: boolean }>();
	 *
	 * client.asSendChannel(...);
	 * server.asRecvChannel(...);
	 * ```
	 */
	public routeClientSendChannel() {
		return this.route("client channel");
	}

	/**
	 * Registers a new simplex stream route that is initiated by the client.
	 *
	 * # Example
	 *
	 * ```ts
	 * const { server, client } = router
	 *   .routeClientSendStream()
	 *   .define<{ val: number }, { isEven: boolean }>();
	 *
	 * client.asSendStream(...);
	 * server.asRecvStream(...);
	 * ```
	 */
	public routeClientSendStream() {
		return this.route("client stream");
	}

	/**
	 * Registers a new duplex stream route that is initiated by the client.
	 *
	 * # Example
	 *
	 * ```ts
	 * const { server, client } = router
	 *   .routeClientSendDuplex()
	 *   .define<{ val: number }, { isEven: boolean }>();
	 *
	 * client.asSendDuplex(...);
	 * server.asRecvDuplex(...);
	 * ```
	 */
	public routeClientSendDuplex() {
		return this.route("client duplex");
	}

	/**
	 * Registers a new route, giving it a unique key.
	 *
	 * Route types are as follows:
	 * - "send": A single request and response.
	 * - "send stream": Repeated requests and response pairs.
	 * - "stream": A continuous stream of data in one direction only.
	 * - "duplex": A continuous stream of data in both directions.
	 *
	 * # Example
	 * ```ts
	 * const actionA = route("client send").define<{ val: number }, { isEven: boolean }>();
	 * const clientActionA = actionA.client.asSend();
	 * const serverActionA = actionA.server.asRecv(...);
	 *
	 * const actionB = route("server send stream").define<{ send: string }, { recv: string }>();
	 * const clientActionB = actionB.server.asSendChannel(...);
	 * const serverActionB = actionB.client.asRecvChannel(...);
	 * ```
	 */
	private route<
		Method extends
			| "server send"
			| "server channel"
			| "server stream"
			| "server duplex"
			| "client send"
			| "client channel"
			| "client stream"
			| "client duplex",
	>(method: Method) {
		const self = this;

		const types = {
			client: method.startsWith("client") ? "client" : "server",
			server: method.startsWith("server") ? "client" : "server",
		} as const;

		const key = self.routeTypes.length;
		self.routeTypes.push(types);

		/**
		 * Define the configuration and types of the route.
		 *
		 * @param config Route configuration.
		 */
		function define<ServerRecv, ClientRecv>(config?: Partial<Config>) {
			if (key > 0xff_ff) {
				throw Error("Too many routes");
			}

			const server = Route.factory<
				ClientRecv,
				ServerRecv,
				Method extends `server ${infer Type}`
					? Type extends "send"
						? "asSend"
						: Type extends "channel"
						  ? "asSendChannel"
						  : Type extends "stream"
							  ? "asSendStream"
							  : Type extends "duplex"
								  ? "asSendDuplex"
								  : never
					: Method extends `client ${infer Type}`
					  ? Type extends "send"
							? "asRecv"
							: Type extends "channel"
							  ? "asRecvChannel"
							  : Type extends "stream"
								  ? "asRecvStream"
								  : Type extends "duplex"
									  ? "asRecvDuplex"
									  : never
					  : never
			>({
				codec: self.context.codec,
				config: { ...self.context.config, ...config },
				identity: self.identity,
				key,
			});

			const client = Route.factory<
				ClientRecv,
				ServerRecv,
				Method extends `client ${infer Type}`
					? Type extends "send"
						? "asSend"
						: Type extends "channel"
						  ? "asSendChannel"
						  : Type extends "stream"
							  ? "asSendStream"
							  : Type extends "duplex"
								  ? "asSendDuplex"
								  : never
					: Method extends `server ${infer Type}`
					  ? Type extends "send"
							? "asRecv"
							: Type extends "channel"
							  ? "asRecvChannel"
							  : Type extends "stream"
								  ? "asRecvStream"
								  : Type extends "duplex"
									  ? "asRecvDuplex"
									  : never
					  : never
			>({
				codec: self.context.codec,
				config: { ...self.context.config, ...config },
				identity: self.identity,
				key,
			});

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
		return { define };
	}

	/**
	 * A server router factory.
	 *
	 * # Example
	 *
	 * ```ts
	 * const server = router.serverRouter()
	 *   .withApp(...)
	 *   .withConnection(...)
	 *   .withRoutes(...)
	 *   .start();
	 *
	 * serverAction(server).send(...);
	 * ```
	 */
	public serverRouter() {
		return ConnectRouter.factory(
			() => this.routeTypes.filter((type) => type.server === "server").length,
			this.identity,
		);
	}

	/**
	 * A client router factory.
	 *
	 * # Example
	 *
	 * ```ts
	 * const client = router.clientRouter()
	 *   .withApp(...)
	 *   .withConnection(...)
	 *   .withRoutes(...)
	 *   .start();
	 *
	 * clientAction(client).send(...);
	 */
	public clientRouter() {
		return ConnectRouter.factory(
			() => this.routeTypes.filter((type) => type.client === "server").length,
			this.identity,
		);
	}
}
