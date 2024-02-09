import { Router } from "./framework/Router";
import { WebSocketServer } from "ws";
import { NodeWsWebsocketSocket } from "./clients/NodeWsWebsocketSocket";
import { BrowserWebsocketSocket } from "./clients/BrowserWebsocketSocket";

async function example() {
	// Create router
	const router = new Router(
		// Optional configuration overrides for the router.
		{
			// Override the default codec.
			//
			// The default codec converts the object to JSON and then represents it as a UTF-8 ArrayBuffer.
			codec: {
				// Encode the data into an ArrayBuffer.
				//
				// You must return an ArrayBuffer.
				encode: (data) => new TextEncoder().encode(JSON.stringify(data)).buffer,
				// Decode the data from an ArrayBuffer.
				//
				// It is acceptable to throw an error if the data is invalid.
				decode: (data) => JSON.parse(new TextDecoder().decode(data)),
			},
			// Override the default config.
			//
			// Times in milliseconds.
			config: {
				// The maximum time to wait for an ack before disconnecting.
				ackDeadline: 5001,
				// The maximum time to wait for a response on the server before disconnecting.
				clientSilentDeadline: 30000,
				// The maximum time to wait for a message on the client before disconnecting.
				serverSilentDeadline: 30000,
			},
		},
	);

	// Declare unique routes.
	//
	// This is unwieldy, but it has to be done so that we can efficiently
	// and stably bind routes to the router.
	//
	// As this is a side effect, you must ensure that the declarations are
	// never removed or reordered unless you are prepared for route with older clients.
	//
	// Always append new routes to the end of the list.
	//
	// You are recommended to use not give your routes names that have any significance
	// in order to reduce the meaningfulness of these route declarations.
	//
	// To narrow down the generated route type we first specify who is initiating the connection. ("client" or "server")
	// Followed by the kind of route we are defining. ("send", "send stream", "stream", or "duplex")
	const route0001 = router.routeClientSend();
	const route0002 = router.routeClientSendChannel();
	// The connection does not need to be initiated by the client.
	const route0003 = router.routeServerSendStream();
	const route0004 = router.routeClientSendDuplex();

	// Define routes
	type MultiplySend = { a: number; b: number };
	type MultiplyRecv = { result: number };
	const multiplyRoute = route0001.define<
		// The data that is sent to the server.
		MultiplySend,
		// The data that is received from the server.
		MultiplyRecv
	>();

	type ToStringSend = { value: number };
	type ToStringRecv = { result: string };
	const toStringRoute = route0002.define<ToStringSend, ToStringRecv>();

	type TailLogsRecv = { logs: string[] };
	const tailLogsRoute = route0003.define<
		// The order of what is sent and what is received changes depending on who initiates the connection.
		TailLogsRecv,
		// In a non send stream one side does not send data.
		null
	>({
		serverSilentDeadline: Number.POSITIVE_INFINITY,
	});

	type EventStreamSend = { value: string[] };
	type EventStreamRecv = { value: string[] };
	const eventStreamRoute = route0004.define<EventStreamSend, EventStreamRecv>();

	// Extract the router.
	const { serverRouter, clientRouter } = router;

	// Set up server routes.
	// Type guard for the multiply route.
	function validateMultiplySend(data: unknown): data is MultiplySend {
		return (
			typeof data === "object" &&
			data !== null &&
			"a" in data &&
			"b" in data &&
			typeof data.a === "number" &&
			typeof data.b === "number"
		);
	}

	const serverMultiplyRoute = multiplyRoute.server.asRecv(
		// The action to take when the route is called.
		async (data) => ({ result: data.a * data.b }),
		// Validate the data sent to the server.
		//
		// This is optional, but you probably want to do this if your route is on the server.
		// It's probably fine to omit this on the client.
		validateMultiplySend,
	);

	const serverToStringRoute = toStringRoute.server.asRecvChannel(
		// The action to take when the route is called.
		//
		// Stream routes are intended to be spawned repeatedly, therefore you must
		// return a factory function to create a new handler for each time the route
		// is called.
		//
		// It is completely valid for a connection to make multiple connection attempts.
		//
		// The handlers can have closures over the state generated inside the factory function.
		// This is useful for when managing state of long lived streams.
		() => {
			let accumulator = 0;
			return async (data, context) => {
				if (accumulator > 0xffff) {
					context.task.cancel("overflow");
				}
				accumulator += data.value;
				return { result: accumulator.toString() };
			};
		},
		// In all streams, you must provide a buffer size.
		//
		// The size of the buffer in send-recv streams will determine the maximum number
		// of tasks that can be queued before deferring to the main buffer.
		//
		// The order of replies is guaranteed. The buffered tasks will be processed in series.
		//
		// If the buffer is full, buffering will be deferred to the main buffer.
		// If that is full, messages will be lost and the connection will be terminated.
		10,
	);

	// For this route, the client will act as the receiver and the server will act as the sender.
	const serverTailLogsRoute = tailLogsRoute.server.asSendStream(10);

	// Duplex routes are by far the most complex to implement.
	//
	// This is because they have bidirectional streams that aren't dependent on each other.
	//
	// In the context of a server you will have to implement both the send and recv streams
	// as handlers within a factory function.
	const serverEventStreamRoute = eventStreamRoute.server
		// You can require that a route be bound with a specific app state.
		//
		// This app state must be injected later when the route is bound to the router.
		.withApp<{ db: { logs: Map<number, [number, string]> } }>()

		// You can require that a route be bound with a specific connection state.
		//
		// This connection state must be injected later when the route is bound to the router.
		.withConnection<{ sessionId: number }>()
		.asRecvDuplex(
			() => {
				let latestLogId = 0;
				const clientLogs = new Set<number>();

				return {
					async send(context, send) {
						while (true && typeof context.task.isCancelled() !== "string") {
							const logs: string[] = [];
							for (const [id, [clientId, log]] of context.app.db.logs) {
								if (id <= latestLogId || clientLogs.has(clientId)) {
									continue;
								}
								logs.push(log);
							}

							if (send({ value: logs })) {
								latestLogId = context.app.db.logs.size;
							}

							await new Promise((resolve) => setTimeout(resolve, 1000));
						}
					},

					recv(data, context) {
						const key = context.app.db.logs.size;

						for (const log of data.value) {
							context.app.db.logs.set(key, [context.connection.sessionId, log]);

							clientLogs.add(key);
						}
					},
				};
			},
			// Unlike send-recv streams, both the send and recv actions advance in parallel with each other.
			//
			// The `send` and `recv` queues are guaranteed to be processed independently in order.
			{
				send: 100,
				recv: 10,
			},
		);

	// Set up client routes.
	const clientMultiplyRoute = multiplyRoute.client.asSend();
	const clientToStringRoute = toStringRoute.client.asSendChannel(1);
	// When you invert the sending direction, the role of client and server inverts.
	//
	// That means you must register event handlers as if the client were a server.
	//
	// This is because, while unlikely, it is completely valid for the server to
	// initiate multiple streams to the client.
	const clientTailLogsRoute = tailLogsRoute.client
		.withApp<{ db: { logs: string[] } }>()
		.asRecvStream(
			() => (data, context) => context.app.db.logs.push(...data.logs),
			1,
		);
	const clientEventStreamRoute = eventStreamRoute.client
		.withApp<{ db: { logs: string[] } }>()
		.asSendDuplex({
			send: 1,
			recv: 10,
		});

	// Create and start the server.

	// Create a function that will keep the server running.
	async function createServerWebsocketConnection() {
		while (true) {
			const server = new WebSocketServer({ port: 54321 });

			await new Promise((up) => {
				server.on("listening", up);
			});

			// When a new client connects, you must spawn an entire new socket and api
			// for that connection.
			//
			// This is because the api is stateful.
			server.on("connection", async (ws) => {
				// Create a new socket for the connection.
				const socket = new NodeWsWebsocketSocket(
					ws,
					// You must set up how many messages the api is allowed to buffer.
					// Be judicious with this limit. You do not need nearly as many buffered
					// messages as you think you do.
					{ in: 100, out: 100 },
				);

				// Create bindings for the server.
				//
				// When creating bindings, what we're doing is essentially
				// providing the various runtime contexts to the api that
				// we could not otherwise statically provide.
				const server = serverRouter()
					// If our route requires a specific app state, we must provide it here
					// or typescript will complain.
					//
					// If no app state is required, you can skip this.
					.withApp({ db: { logs: new Map<number, [number, string]>() } })
					.withConnection(async () => ({
						// We need to always provide the connection socket.
						socket,
						// If our route requires a specific connection state, we must provide it here
						// or typescript will complain.
						connection: { sessionId: Math.floor(Math.random() * 0xffff) },
					}))
					// Finally you can bind your recv routes.
					//
					// While it might seem unwieldy to have to manually bind each route,
					// this library is intended to work without any special compiler macro magic.
					//
					// If you're adventurous, you can write your own compiler to do this,
					// but shipping that as a core feature is not something this library is concerned with.
					//
					// The routes provided are dynamically checked at runtime to ensure that all
					// created routes are bound without duplicates.
					.withRoutes(
						serverMultiplyRoute,
						serverToStringRoute,
						serverEventStreamRoute,
					)
					// Start the server.
					.start();

				// Send routes are handled differently.
				// You need to first provide the create server client from the server router
				// to the send route.
				//
				// The actions you call on the send routes will then be sent down that client.
				if (
					!serverTailLogsRoute
						.connect(server)
						.send({ logs: ["log 1", "log 2"] })
				) {
					console.error("Failed to send logs");
				}
			});

			await new Promise((ok) => {
				server.on("close", ok);
			});
		}
	}

	// Start the server.
	createServerWebsocketConnection();

	// Create and start the client.
	// We now do the same thing for the client.
	let socket: BrowserWebsocketSocket;

	// Create a function that will keep the a websocket socket alive.
	async function persistentWebsocketConnection() {
		while (true) {
			const websocket = new WebSocket("wss://your.websocket");

			// Create a new socket for the connection.
			socket = new BrowserWebsocketSocket(
				websocket,
				// You must set up how many messages the api is allowed to buffer.
				// Be judicious with this limit. You do not need nearly as many buffered
				// messages as you think you do.
				{ in: 100, out: 100 },
			);

			await new Promise((close) => websocket.addEventListener("close", close));
		}
	}

	persistentWebsocketConnection();

	// Unlike the on the server, we aren't managing multiple connections.
	// A client only (usually) has one connection.
	//
	// You need to instead, we create a client object that we pass around to
	// dynamically bind routes to.
	const client = clientRouter()
		// Again you must provide the app state if a route requires it.
		//
		// You will get a type error if you miss this when required.
		.withApp({ db: { logs: [] } })
		.withConnection(() => Promise.resolve({ socket }))
		.withRoutes(
			// Here we need to bind the client tail logs route.
			//
			// This is because the client is acting as the server for this route.
			clientTailLogsRoute,
		)
		// Start the router in dynamic mode,
		// allowing late binding of routes.
		.start();

	// Send routes may fail to send if the buffer is full or the connection is closed.
	try {
		const { result } = await clientMultiplyRoute.connect(client).send({
			a: 10,
			b: 100,
		});
		console.log(result);
	} catch {
		console.log("Failed to send");
	}

	// Send stream routes create a server side context, so you cannot immediately
	// bind and invoke them in a loop.
	const toStringRouteInstance = clientToStringRoute.connect(client);
	// Send stream routes may fail to send if the buffer is full or the connection is closed.
	for (let value = 0; value < 10; value++) {
		try {
			const { result } = await toStringRouteInstance.send({ value });
			console.log(result);
		} catch {
			console.log("Failed to send");
		}
	}

	// Duplex routes provide send methods and recv callbacks.
	const eventStream = clientEventStreamRoute.connect(client);
	const logs: string[] = [];

	// Recv callbacks must be bound before the send method is called.
	eventStream.recv((data, context) => {
		context.app.db.logs.push(...data.value);
		logs.push(...data.value);
	});

	// Like other routes, sends may fail if the buffer is full or the connection is closed.
	//
	// Unlike other routes, duplex connections don't provide a response.
	if (!eventStream.send({ value: ["log 1", "log 2"] })) {
		console.log("Failed to send");
	}

	// Once you are done with a connection, you must dispose of it.
	//
	// This is not automatically done for you.
	eventStream.drop();
}
