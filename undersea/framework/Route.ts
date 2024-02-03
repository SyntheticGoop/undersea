import { Socket } from "../lib/Socket";
import { Task } from "../lib/Task";
import { Config } from "./Config";
import { Codec } from "./Codec";
import { Initiate } from "./Initiate";
import { Endpoint } from "./Endpoint";
import { once } from "./recipies/once";
import { many } from "./recipies/many";

export class Route<App, Connection, ClientRecv, ServerRecv> {
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
			key: number;
		},
	) {}

	/**
	 * Marks the route as created, preventing overwriting of created routes.
	 */
	private once() {
		if (this.used) throw new Error("Route already bound");

		this.used = true;
	}

	/**
	 * Sends input and receives output.
	 *
	 * @param schema Validates data received on the wire.
	 */
	public asSend(schema?: (data: unknown) => data is ClientRecv) {
		this.once();

		const initiate = new Initiate({
			...this.context,
			createService: () => once<ServerRecv, ClientRecv>(schema),
		});

		function start(
			context: () => Promise<{
				socket: Socket;
				app: App;
				connection: Connection;
			}>,
		) {
			const route = initiate.start(context);
			/**
			 * Sends input and receives output.
			 *
			 * @param payload Input to send.
			 * @returns Output received.
			 */
			function send(payload: ServerRecv): Promise<ClientRecv> {
				return route.then((service) => {
					const response = service.takeExternal();
					service.loadInternal(payload);
					return response;
				});
			}
			return send;
		}

		return start;
	}

	/**
	 * Accept input and generate an output.
	 *
	 * @param handler Handles the data and generates a response.
	 * @param schema Validates data received on the wire.
	 */
	public asRecv(
		handler: (
			data: ServerRecv,
			context: { app: App; connection: Connection; task: Task },
		) => Promise<ClientRecv>,
		schema?: (data: unknown) => data is ServerRecv,
	) {
		this.once();

		const endpoint = new Endpoint({
			...this.context,
			createService(context: { app: App; connection: Connection; task: Task }) {
				const service = once<ClientRecv, ServerRecv>(schema);

				// Binds the handler to the service.
				service
					.takeExternal()
					.then((payload) => handler(payload, context))
					.then(service.loadInternal);

				return service;
			},
		});

		return endpoint.start;
	}

	/**
	 * Sends input and receives output repeatedly. Every input produces an output. This happens in series.
	 *
	 * @param schema Validates data received on the wire.
	 */
	public asSendStream(
		buffer: number,
		schema?: (data: unknown) => data is ClientRecv,
	) {
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

		return {
			/**
			 * Begin a connection.
			 */
			start(
				context: () => Promise<{
					socket: Socket;
					app: App;
					connection: Connection;
				}>,
			) {
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
					return function query(data: ServerRecv): Promise<ClientRecv> | false {
						const result = service.takeExternal();

						if (!service.loadInternal(data)) {
							return false;
						}

						return result;
					};
				});

				/**
				 * Sends input and receives output.
				 *
				 * @param payload Input to send.
				 * @returns Output received.
				 */
				async function send(payload: ServerRecv) {
					const loadedQuery = await query;
					return loadedQuery(payload);
				}

				return send;
			},
		};
	}

	/**
	 * Accept input and generate an output repeatedly. Every output requires an input. This happens in series.
	 *
	 * @param createHandler Create a handler to handle the data and generates a response. The created handler is shared for the lifetime of the route.
	 * @param schema Validates data received on the wire.
	 */
	public asRecvStream(
		createHandler: () => (
			data: ServerRecv,
			context: { app: App; connection: Connection; task: Task },
		) => Promise<ClientRecv>,
		buffer: number,
		schema?: (data: unknown) => data is ServerRecv,
	) {
		this.once();

		const endpoint = new Endpoint({
			...this.context,
			createService(context: { app: App; connection: Connection; task: Task }) {
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

		return endpoint.start;
	}

	/**
	 * Send many inputs without expecting a response.
	 */
	public asSendStreamOnly(buffer: number) {
		this.once();

		const initiate = new Initiate({
			...this.context,
			createService: () =>
				many<ServerRecv, ClientRecv>({
					internal: buffer,
					external: 0,
				}),
		});

		return {
			/**
			 * Begin a connection.
			 */
			start(
				context: () => Promise<{
					socket: Socket;
					app: App;
					connection: Connection;
				}>,
			) {
				const connection = initiate.start(context);

				/**
				 * Sends input and receives output.
				 *
				 * @param payload Input to send.
				 *
				 * @returns `true` if the input was sent.
				 * @returns `false` if the input cannot be sent.
				 */
				async function send(payload: ServerRecv): Promise<boolean> {
					const service = await connection;

					return service.loadInternal(payload);
				}

				return send;
			},
		};
	}

	/**
	 * Accept many inputs without producing a response.
	 *
	 * @param createHandler Create a handler to handle the data. The created handler is shared for the lifetime of the route.
	 * @param schema Validates data received on the wire.
	 */
	public asRecvStreamOnly(
		createHandler: () => (
			data: ServerRecv,
			context: { app: App; connection: Connection; task: Task },
		) => void,
		buffer: number,
		schema?: (data: unknown) => data is ServerRecv,
	) {
		this.once();

		const endpoint = new Endpoint({
			...this.context,
			createService(context: { app: App; connection: Connection; task: Task }) {
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

		return endpoint.start;
	}

	/**
	 * Sends input and receives output in parallel. Neither input nor output are dependent on each other.
	 *
	 * @param createHandler Create a handler to handle the data. The created handler is shared for the lifetime of the route.
	 * @param schema Validates data received on the wire.
	 */
	public asSendDuplex(
		createHandler: () => (
			data: ClientRecv,
			context: { app: App; connection: Connection; task: Task },
		) => void,
		buffer: { recv: number; send: number },
		schema?: (data: unknown) => data is ClientRecv,
	) {
		this.once();

		const initiate = new Initiate({
			...this.context,
			createService(context: { app: App; connection: Connection; task: Task }) {
				// Binds the handler to the service.
				const handler = createHandler();

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

		return {
			/**
			 * Begin a connection.
			 */
			async start(
				context: () => Promise<{
					socket: Socket;
					app: App;
					connection: Connection;
				}>,
			) {
				const connection = await initiate.start(context);
				const service = connection;

				/**
				 * Sends input and receives output.
				 *
				 * @param payload Input to send.
				 * @returns `true` if the input was sent.
				 * @returns `false` if the input cannot be sent.
				 */
				function send(payload: ServerRecv): boolean {
					return service.loadInternal(payload);
				}

				return {
					send,
					recv: service.takeExternal,
				};
			},
		};
	}

	/**
	 * Accept input and generate an output in parallel. Neither input nor output are dependent on each other.
	 *
	 * @param createHandler Create a handler to handle the data and another to generate a response. The created handlers are shared for the lifetime of the route.
	 * @param schema Validates data received on the wire.
	 */
	public asRecvDuplex(
		createHandler: () => {
			send: (
				context: { app: App; connection: Connection; task: Task },
				send: (data: ClientRecv) => void,
			) => void;
			recv: (
				data: ServerRecv,
				context: { app: App; connection: Connection; task: Task },
			) => void;
		},
		buffer: { recv: number; send: number },
		schema?: (data: unknown) => data is ServerRecv,
	) {
		this.once();

		const initiate = new Endpoint({
			...this.context,
			createService(context: { app: App; connection: Connection; task: Task }) {
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

		return initiate.start;
	}
}
