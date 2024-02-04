import { Socket } from "../lib/Socket";
import { Task } from "../lib/Task";
import { Config } from "./Config";
import { Codec } from "./Codec";
import { Initiate } from "./Initiate";
import { Endpoint } from "./Endpoint";
import { once } from "./recipies/once";
import { many } from "./recipies/many";
import {
	Context,
	brandConnectRoute,
	ServerConnectRoute,
	ClientConnectRoute,
	ClientConnectorBrand,
	KeyIdentity,
} from "./ConnectRouter";

type RouteContext<App, Connection> = Pick<
	// biome-ignore lint/suspicious/noExplicitAny: <explanation>
	Context<App, Connection, any>,
	"app" | "connection"
> & {
	/**
	 * The current task that the route is running on.
	 */
	task: Task;
};

export class Route<
	App,
	Connection,
	ClientRecv,
	ServerRecv,
	Narrow extends string = never,
> {
	private used = false;

	/**
	 * Creates a new route.
	 *
	 * @param context Route context to bubble down to the endpoints.
	 */
	constructor(
		private readonly context: {
			codec: Codec;
			config: Config;
			identity: symbol;
			key: number;
		},
	) {}

	/**
	 * Create a {@link Router} that is set up for late binding.
	 */
	public static factory<ClientRecv, ServerRecv, Type extends string>(context: {
		codec: Codec;
		config: Config;
		identity: symbol;
		key: number;
	}) {
		type AllActions =
			| "asSend"
			| "asRecv"
			| "asSendStream"
			| "asRecvStream"
			| "asSendStreamOnly"
			| "asRecvStreamOnly"
			| "asSendDuplex"
			| "asRecvDuplex";

		type Keys = Exclude<AllActions, Type>;

		const client = new Route<null, null, ClientRecv, ServerRecv, Keys>(context);

		return client as Omit<typeof client, Keys>;
	}

	/**
	 * Marks the route as created, preventing overwriting of created routes.
	 */
	private once() {
		if (this.used) throw new Error("Route already bound");

		this.used = true;
	}

	/**
	 * Require certain app data to be provided.
	 *
	 * # Example
	 *
	 * ```ts
	 * route.withApp<{ db: Database }>()
	 * ```
	 */
	withApp<App>() {
		return this as unknown as Omit<
			Route<App, Connection, ClientRecv, ServerRecv, Narrow | "withApp">,
			Narrow | "withApp"
		>;
	}

	/**
	 * Require certain connection data to be provided.
	 *
	 * # Example
	 *
	 * ```ts
	 * route.withConnection<{ userSession: Session }>()
	 * ```
	 */
	withConnection<Connection>() {
		return this as unknown as Omit<
			Route<App, Connection, ClientRecv, ServerRecv, Narrow | "withConnection">,
			Narrow | "withConnection"
		>;
	}

	/**
	 * Sends input and receives output.
	 *
	 * # Example
	 *
	 * ```ts
	 * const sendRoute = route.asSend(
	 *  (data): data is boolean => typeof data === "boolean"
	 * )
	 *
	 * sendRoute(client).send("hello") // We don't validate output, only input.
	 * ```
	 *
	 * @param schema Validates data received on the wire.
	 */
	public asSend(
		schema?: (data: unknown) => data is ClientRecv,
	): ClientConnectRoute<
		App,
		Connection,
		Socket,
		{
			/**
			 * Sends input and receives output.
			 *
			 * @param data Input to send.
			 * @returns Output received.
			 *
			 * @throws Error if the input cannot be sent or the connection is closed.
			 */
			send: (data: ServerRecv) => Promise<ClientRecv>;
		}
	> {
		this.once();

		const initiate = new Initiate({
			...this.context,
			createService: (_: RouteContext<App, Connection>) =>
				once<ServerRecv, ClientRecv>(schema),
		});

		return brandConnectRoute({
			connect(
				context: (() => Promise<Context<App, Connection, Socket>>) &
					ClientConnectorBrand &
					KeyIdentity,
			) {
				// @ts-expect-error: We know the identity exists.
				if (this.identity !== context.identity)
					throw Error(
						"Route was not created on the same router as the client.",
					);

				const route = initiate.start(context);
				/**
				 * Sends input and receives output.
				 *
				 * @param payload Input to send.
				 * @returns Output received.
				 *
				 * @throws Error if the input cannot be sent or the connection is closed.
				 */
				async function send(payload: ServerRecv): Promise<ClientRecv> {
					const service = await route;
					const response = service.takeExternal();
					if (!service.loadInternal(payload)) throw Error("Failed to send");
					return response;
				}
				return { send };
			},
			key: this.context.key,
			identity: this.context.identity,
		});
	}

	/**
	 * Accept input and generate an output.
	 *
	 * # Example
	 *
	 * ```ts
	 * const recvRoute = route.asRecv(
	 *  (data) => Promise.resolve(data * 2),
	 *  (data): data is number => typeof data === "number"
	 * )
	 *
	 * serverRouter()
	 *   ...
	 *   .withRoute(recvRoute)
	 *   .start()
	 * ```
	 *
	 * @param handler Handles the data and generates a response.
	 * @param schema Validates data received on the wire.
	 */
	public asRecv(
		handler: (
			/**
			 * Input received.
			 */
			data: ServerRecv,
			/**
			 * Context of the connection.
			 */
			context: RouteContext<App, Connection>,
		) => Promise<ClientRecv>,
		schema?: (data: unknown) => data is ServerRecv,
	): ServerConnectRoute<App, Connection> {
		this.once();

		const endpoint = new Endpoint({
			...this.context,
			createService(context: RouteContext<App, Connection>) {
				const service = once<ClientRecv, ServerRecv>(schema);

				// Binds the handler to the service.
				service
					.takeExternal()
					.then((payload) => handler(payload, context))
					.then(service.loadInternal);

				return service;
			},
		});

		return brandConnectRoute({
			connect: endpoint.start,
			key: this.context.key,
			identity: this.context.identity,
		});
	}

	/**
	 * Sends input and receives output repeatedly. Every input produces an output. This happens in series.
	 *
	 * # Example
	 *
	 * ```ts
	 * const sendStreamRoute = route.asSendStream(
	 *  1, // Number of queued requests.
	 *  (data): data is boolean => typeof data === "boolean"
	 * )
	 *
	 * const instance = sendStreamRoute.connect(client)
	 *
	 * instance.send("hello")
	 * instance.send("world")
	 * ```
	 *
	 * @param buffer The number of requests that can be queued.
	 * @param schema Validates data received on the wire.
	 */
	public asSendStream(
		buffer: number,
		schema?: (data: unknown) => data is ClientRecv,
	): ClientConnectRoute<
		App,
		Connection,
		Socket,
		{
			/**
			 * Sends input and receives output.
			 *
			 * @param data Input to send.
			 * @returns Output received.
			 *
			 * @throws Error if the input cannot be sent or the connection is closed.
			 */
			send: (data: ServerRecv) => Promise<ClientRecv>;
		}
	> {
		this.once();

		const initiate = new Initiate({
			...this.context,
			createService: () =>
				many<ServerRecv, ClientRecv>(
					{
						external: buffer,
						internal: buffer,
					},
					schema,
				),
		});

		return brandConnectRoute({
			connect(
				context: (() => Promise<Context<App, Connection, Socket>>) &
					ClientConnectorBrand &
					KeyIdentity,
			) {
				// @ts-expect-error: We know the identity exists.
				if (this.identity !== context.identity)
					throw Error(
						"Route was not created on the same router as the client.",
					);
				const connection = initiate.start(context);

				const query = connection.then((service) => {
					/**
					 * Sends input and receives output.
					 *
					 * You must wait for the promise to resolve before sending another input,
					 * otherwise the input will be dropped.
					 *
					 * This may be buffered by the buffer size provided.
					 *
					 * @returns Output received as a promise.
					 * @returns `false` if the input cannot be sent.
					 */
					return function query(data: ServerRecv): Promise<ClientRecv> {
						const result = service.takeExternal();

						if (!service.loadInternal(data)) {
							throw Error("Failed to send");
						}

						return result;
					};
				});

				/**
				 * Sends input and receives output.
				 *
				 * @param data Input to send.
				 * @returns Output received.
				 *
				 * @throws Error if the input cannot be sent or the connection is closed.
				 */
				async function send(data: ServerRecv) {
					const loadedQuery = await query;
					return loadedQuery(data);
				}

				return { send };
			},
			key: this.context.key,
			identity: this.context.identity,
		});
	}

	/**
	 * Accept input and generate an output repeatedly. Every output requires an input. This happens in series.
	 *
	 * # Example
	 *
	 * ```ts
	 * const recvStreamRoute = route.asRecvStream(
	 *  (data) => Promise.resolve(data * 2),
	 *  1, // Number of queued requests.
	 *  (data): data is number => typeof data === "number"
	 * )
	 *
	 * serverRouter()
	 *   ...
	 *   .withRoute(recvStreamRoute)
	 *   .start()
	 * ```
	 *
	 * @param createHandler Create a handler to handle the data and generates a response. The created handler is shared for the lifetime of the route.
	 * @param buffer The number of requests that can be queued.
	 * @param schema Validates data received on the wire.
	 */
	public asRecvStream(
		createHandler: () => (
			/**
			 * Input received.
			 */
			data: ServerRecv,
			/**
			 * Context of the connection.
			 */
			context: RouteContext<App, Connection>,
		) => Promise<ClientRecv | null>,
		buffer: number,
		schema?: (data: unknown) => data is ServerRecv,
	): ServerConnectRoute<App, Connection> {
		this.once();

		const endpoint = new Endpoint({
			...this.context,
			createService(context: RouteContext<App, Connection>) {
				const service = many<ClientRecv, ServerRecv>(
					{ external: buffer, internal: buffer },
					schema,
				);

				// Binds the handler to the service.
				const handler = createHandler();

				// Listens for incoming data and handles it.
				context.task.poll((task) =>
					task.subtask().wrap((isCancelled, resolve) => {
						service.takeExternal().then((payload) => {
							if (typeof isCancelled() === "string") return null;

							return handler(payload, context)
								.then(service.loadInternal)
								.finally(() => resolve(null));
						});

						return undefined;
					}),
				);

				return service;
			},
		});

		return brandConnectRoute({
			connect: endpoint.start,
			key: this.context.key,
			identity: this.context.identity,
		});
	}

	/**
	 * Send many inputs without expecting a response.
	 *
	 * No schema is required as we don't recv anything.
	 *
	 * # Example
	 *
	 * ```ts
	 * const sendStreamOnlyRoute = route.asSendStreamOnly(
	 *  1, // Number of queued requests.
	 * )
	 *
	 * const instance = sendStreamOnlyRoute.connect(client)
	 * instance.send("hello")
	 * instance.send("world")
	 * ```
	 *
	 * @param buffer The number of requests that can be queued.
	 */
	public asSendStreamOnly(buffer: number): ClientConnectRoute<
		App,
		Connection,
		Socket,
		{
			/**
			 * Sends input and receives output.
			 *
			 * @param data Input to send.
			 *
			 * @returns `true` if the input was sent.
			 * @returns `false` if the input cannot be sent.
			 */
			send(data: ServerRecv): Promise<boolean>;
		}
	> {
		this.once();

		const initiate = new Initiate({
			...this.context,
			createService: () =>
				many<ServerRecv, ClientRecv>({
					internal: buffer,
					external: 0,
				}),
		});

		return brandConnectRoute({
			/**
			 * Begin a connection.
			 */
			connect(
				context: (() => Promise<Context<App, Connection, Socket>>) &
					ClientConnectorBrand &
					KeyIdentity,
			) {
				// @ts-expect-error: We know the identity exists.
				if (this.identity !== context.identity)
					throw Error(
						"Route was not created on the same router as the client.",
					);
				const connection = initiate.start(context);

				/**
				 * Sends input and receives output.
				 *
				 * @param data Input to send.
				 *
				 * @returns `true` if the input was sent.
				 * @returns `false` if the input cannot be sent.
				 */
				async function send(data: ServerRecv): Promise<boolean> {
					const service = await connection;

					return service.loadInternal(data);
				}

				return { send };
			},
			key: this.context.key,
			identity: this.context.identity,
		});
	}

	/**
	 * Accept many inputs without producing a response.
	 *
	 * # Example
	 *
	 * ```ts
	 * const recvStreamOnlyRoute = route.asRecvStreamOnly(
	 *  (data) => console.log(data),
	 *  1, // Number of queued requests.
	 *  (data): data is string => typeof data === "string"
	 * )
	 *
	 * serverRouter()
	 *   ...
	 *   .withRoute(recvStreamOnlyRoute)
	 *   .start()
	 * ```
	 *
	 * @param createHandler Create a handler to handle the data. The created handler is shared for the lifetime of the route.
	 * @param buffer The number of requests that can be queued.
	 * @param schema Validates data received on the wire.
	 */
	public asRecvStreamOnly(
		createHandler: () => (
			/**
			 * Input received.
			 */
			data: ServerRecv,
			/**
			 * Context of the connection.
			 */
			context: RouteContext<App, Connection>,
		) => void,
		buffer: number,
		schema?: (data: unknown) => data is ServerRecv,
	): ServerConnectRoute<App, Connection> {
		this.once();

		const endpoint = new Endpoint({
			...this.context,
			createService(context: RouteContext<App, Connection>) {
				const service = many<ClientRecv, ServerRecv>(
					{
						internal: 0,
						external: buffer,
					},
					schema,
				);

				// Binds the handler to the service.
				const handler = createHandler();

				// Listens for incoming data and handles it.
				context.task.poll((task) =>
					service
						.takeExternal()
						.then((payload) => {
							if (typeof task.isCancelled() === "string") return null;

							handler(payload, context);
						})
						.then(() => ({ value: undefined })),
				);

				return service;
			},
		});

		return brandConnectRoute({
			connect: endpoint.start,
			key: this.context.key,
			identity: this.context.identity,
		});
	}

	/**
	 * Sends input and receives output in parallel. Neither input nor output are dependent on each other.
	 *
	 * # Example
	 *
	 * ```ts
	 * const sendDuplexRoute = route.asSendDuplex(
	 *  1, // Number of queued requests.
	 *  (data): data is string => typeof data === "string"
	 * )
	 *
	 * const instance = sendDuplexRoute.connect(client)
	 *
	 * instance.send("hello")
	 * instance.send("world")
	 *
	 * instance.recv((data) => console.log(data))
	 * ```
	 *
	 * @param buffer The number of requests that can be queued.
	 * @param schema Validates data received on the wire.
	 */
	public asSendDuplex(
		buffer: { recv: number; send: number },
		schema?: (data: unknown) => data is ClientRecv,
	): ClientConnectRoute<
		App,
		Connection,
		Socket,
		{
			/**
			 * Register a callback to receive data from the server.
			 *
			 * @param handler The callback which will be called when data is received from the server.
			 */
			recv(
				handler: (
					data: ClientRecv,
					context: RouteContext<App, Connection>,
				) => void,
			): void;
			/**
			 * Send data to the server.
			 *
			 * @returns `true` if the input was queued to be send
			 * @returns `false` if the input buffer is full.
			 */
			send(data: ServerRecv): boolean;
		}
	> {
		this.once();

		const appContext = this.context;

		return brandConnectRoute({
			connect(
				context: (() => Promise<Context<App, Connection, Socket>>) &
					ClientConnectorBrand &
					KeyIdentity,
			) {
				// @ts-expect-error: We know the identity exists.
				if (this.identity !== context.identity)
					throw Error(
						"Route was not created on the same router as the client.",
					);
				let loadInternal: (payload: ServerRecv) => boolean = () => false;

				async function recv(
					handler: (
						data: ClientRecv,
						context: RouteContext<App, Connection>,
					) => void,
				) {
					const initiate = new Initiate({
						...appContext,
						createService(context: RouteContext<App, Connection>) {
							// Binds the handler to the service.
							// const handler = createHandler();

							const service = many<ServerRecv, ClientRecv>(
								{
									internal: buffer.send,
									external: buffer.recv,
								},
								schema,
							);

							// Listens for incoming data and handles it.
							context.task.poll((task) =>
								service
									.takeExternal()
									.then((payload) => {
										if (typeof task.isCancelled() === "string") return null;

										handler(payload, context);
									})
									.then(() => ({ value: undefined })),
							);

							return service;
						},
					});

					const connection = await initiate.start(context);
					const service = connection;

					loadInternal = service.loadInternal;
				}

				/**
				 * Sends input and receives output.
				 *
				 * @param payload Input to send.
				 * @returns `true` if the input was sent.
				 * @returns `false` if the input cannot be sent.
				 */
				function send(payload: ServerRecv): boolean {
					return loadInternal(payload);
				}

				return {
					send,
					recv,
				};
			},
			key: this.context.key,
			identity: this.context.identity,
		});
	}

	/**
	 * Accept input and generate an output in parallel. Neither input nor output are dependent on each other.
	 *
	 * # Example
	 *
	 * ```ts
	 * const recvDuplexRoute = route.asRecvDuplex(
	 *  () => ({
	 *    send(context, send) {
	 *      while (true) {
	 *        send("hello")
	 *      }
	 *    },
	 *    recv: (data) => console.log(data),
	 *  })
	 *  1, // Number of queued requests.
	 *  (data): data is string => typeof data === "string"
	 * )
	 *
	 * serverRouter()
	 *   ...
	 *   .withRoute(recvDuplexRoute)
	 *   .start()
	 * ```
	 *
	 * @param createHandler Create a handler to handle the data and another to generate a response. The created handlers are shared for the lifetime of the route.
	 * @param buffer The number of requests that can be queued.
	 * @param schema Validates data received on the wire.
	 */
	public asRecvDuplex(
		createHandler: () => {
			/**
			 * Callback to which the sending handler will be registered.
			 *
			 * @param context The context of the connection.
			 * @param send The function that can be called repeatedly to send data to the client. This function will return `false` if the send buffer is full.
			 */
			send: (
				context: RouteContext<App, Connection>,
				send: (data: ClientRecv) => boolean,
			) => void;
			/**
			 * The callback which will be called when data is received from the client.
			 *
			 * @param data The data received from the client.
			 * @param context The context of the connection.
			 */
			recv: (data: ServerRecv, context: RouteContext<App, Connection>) => void;
		},
		buffer: {
			/**|
			 * The number of receiving tasks that can be queued before deferring to the main buffer.
			 *
			 * The order of replies is guaranteed. The buffered tasks will be processed in series.
			 */
			recv: number;
			/**
			 * The number of sending tasks that can be queued before deferring to the main buffer.
			 *
			 * The order of replies is guaranteed. The buffered tasks will be processed in series.
			 */
			send: number;
		},
		schema?: (data: unknown) => data is ServerRecv,
	): ServerConnectRoute<App, Connection> {
		this.once();

		const initiate = new Endpoint({
			...this.context,
			createService(context: RouteContext<App, Connection>) {
				// Binds the handler to the service.
				const { recv, send } = createHandler();

				const service = many<ClientRecv, ServerRecv>(
					{
						internal: buffer.send,
						external: buffer.recv,
					},
					schema,
				);

				// Listens for incoming data and handles it.
				context.task.poll((task) =>
					service
						.takeExternal()
						.then((payload) => {
							if (typeof task.isCancelled() === "string") return null;

							recv(payload, context);
						})
						.then(() => ({ value: undefined })),
				);

				send(context, (data) => service.loadInternal(data));

				return service;
			},
		});

		return brandConnectRoute({
			connect: initiate.start,
			key: this.context.key,
			identity: this.context.identity,
		});
	}
}
