import { Socket as ISocket } from "../lib/Socket";

declare const CONNECT_ROUTE: unique symbol;
declare class ConnectRouteBrand {
	private declare [CONNECT_ROUTE]: typeof CONNECT_ROUTE;
}

export type Context<App, Connection, Socket> = {
	/**
	 * The global application state.
	 */
	app: App;
	/**
	 * The connection specific state.
	 */
	connection: Connection;
	/**
	 * The connection socket.
	 */
	socket: Socket;
};

declare class KeyIdentity {
	private declare key: number;
	private declare identity: symbol;
}

export function brandConnectRoute<T>(route: T) {
	return route as Omit<T, keyof KeyIdentity> & KeyIdentity & ConnectRouteBrand;
}

export type ContextOverNull<App, Connection, Socket> = App extends null
	? Connection extends null
		? Context<null, null, Socket>
		: Context<null, Connection, Socket>
	: Connection extends null
	  ? Context<App, null, Socket>
	  : Context<App, Connection, Socket>;

declare const CLIENT_CONNECTOR: unique symbol;
export declare class ClientConnectorBrand {
	private declare [CLIENT_CONNECTOR]: typeof CLIENT_CONNECTOR;
}

/**
 * A route factory that uses the application and connection context to drive the route.
 */
export type ClientConnectRoute<
	App,
	Connection,
	Socket = ISocket,
	Return = void,
> = {
	/**
	 * Connect the route to the connection.
	 *
	 * @param context The connection context to drive the route.
	 */
	connect(
		context: (() => Promise<Context<App, Connection, Socket>>) &
			ClientConnectorBrand,
	): Return;
} & KeyIdentity &
	ConnectRouteBrand;

export function brandClientConnector<T>(route: T) {
	return route as T & ClientConnectorBrand;
}

declare const SERVER_CONNECTOR: unique symbol;
export declare class ServerConnectorBrand {
	private declare [SERVER_CONNECTOR]: typeof SERVER_CONNECTOR;
}

export function brandServerConnector<T>(route: T) {
	return route as T & ServerConnectorBrand;
}

/**
 * A route factory that uses the application and connection context to drive the route.
 */
export type ServerConnectRoute<
	App,
	Connection,
	Socket = ISocket,
	Return = void,
> = {
	/**
	 * Connect the route to the connection.
	 *
	 * @param context The connection context to drive the route.
	 */
	connect(
		context: (() => Promise<Context<App, Connection, Socket>>) &
			ServerConnectorBrand,
	): Return;
} & KeyIdentity &
	ConnectRouteBrand;

export class ConnectRouter<
	App = null,
	Connection = null,
	Socket = null,
	Narrow extends keyof ConnectRouter = "start",
> {
	constructor(
		private readonly serverRouteCount: number,
		private readonly serverIdentity: symbol,
	) {
		this.start = this.start.bind(this);
		this.withApp = this.withApp.bind(this);
		this.withConnection = this.withConnection.bind(this);
		this.withRoutes = this.withRoutes.bind(this);
	}

	private app!: App;

	/**
	 * Set the application state that the router provides.
	 *
	 * You need to set this if any of your routes require the application state.
	 *
	 * # Example
	 *
	 * ```ts
	 * import { db } from "./database"
	 * router
	 *   .withApp({ db })
	 * ```
	 *
	 * @param app The application state.
	 */
	withApp<App>(app: App) {
		const router = this as unknown as ConnectRouter<
			App,
			Connection,
			Socket,
			Narrow | "withApp"
		>;

		router.app = app;

		return router as Omit<typeof router, Narrow | "withApp">;
	}

	private connection: () => Promise<{
		connection: Connection;
		socket: Socket;
	}> = () => Promise.reject(new Error("No connection"));

	/**
	 * Set the connection that the router provides.
	 *
	 * As this provides the connection to the socket, you need to set this if any of your routes require the connection.
	 *
	 * You may omit the connection if your routes do not require it.
	 *
	 * # Example
	 *
	 * ```ts
	 * router
	 *   .withConnection(async () => {
	 *     const connection = await connect();
	 *     const socket = new Socket(connection)
	 *     const session = await connection.getSession()
	 *
	 *     return {
	 *       socket,
	 *       connection: session
	 *     }
	 *   })
	 * ```
	 *
	 * @param connection A function that returns the connection and socket.
	 */
	withConnection<Socket, Connection>(
		connection: () => Promise<{
			/**
			 * The connection specific state that is generated when the connection is established.
			 */
			connection: Connection;
			/**
			 * The connection socket.
			 */
			socket: Socket;
		}>,
	): Omit<
		ConnectRouter<
			App,
			Connection,
			Socket,
			Exclude<Narrow, "start" | "withRoutes" | "connect"> | "withConnection"
		>,
		Exclude<Narrow, "start" | "withRoutes" | "connect"> | "withConnection"
	>;
	/**
	 * Set the connection that the router provides.
	 *
	 * As this provides the connection to the socket, you need to set this if any of your routes require the connection.
	 *
	 * You may omit the connection if your routes do not require it.
	 *
	 * # Example
	 *
	 * ```ts
	 * router
	 *   .withConnection(async () => {
	 *     const connection = await connect();
	 *     const socket = new Socket(connection)
	 *
	 *     return { socket }
	 *   })
	 * ```
	 *
	 * @param connection A function that returns the connection and socket.
	 */
	withConnection<Socket>(
		connection: () => Promise<{
			/**
			 * The connection socket.
			 */
			socket: Socket;
		}>,
	): Omit<
		ConnectRouter<
			App,
			Connection,
			Socket,
			Exclude<Narrow, "start" | "withRoutes" | "connect"> | "withConnection"
		>,
		Exclude<Narrow, "start" | "withRoutes" | "connect"> | "withConnection"
	>;
	withConnection<Socket, Connection = null>(
		connection: () => Promise<{
			/**
			 * The connection specific state that is generated when the connection is established.
			 */
			connection?: Connection;
			/**
			 * The connection socket.
			 */
			socket: Socket;
		}>,
	) {
		const affixedConnection = () =>
			connection().then(({ connection, socket }) => ({
				socket,
				connection: connection ?? null,
			}));

		const router = this as unknown as ConnectRouter<
			App,
			Awaited<ReturnType<typeof affixedConnection>>["connection"],
			Socket,
			Exclude<Narrow, "start" | "withRoutes" | "connect"> | "withConnection"
		>;

		router.connection = affixedConnection;

		return router as Omit<
			typeof router,
			Exclude<Narrow, "start" | "withRoutes" | "connect"> | "withConnection"
		>;
	}

	private readonly routes = new Set<
		ServerConnectRoute<App | null, Connection | null, Socket>
	>();

	/**
	 * Add routes to the router. You may call this method multiple times to add multiple routes.
	 *
	 * Routes are checked and validated to prevent duplicate routes from being added.
	 *
	 * We also check to ensure that all server routes have been added before starting the router.
	 *
	 * # Example
	 *
	 * ```ts
	 * router
	 *   .withConnection(...)
	 *   .withRoutes(
	 *     route1,
	 *     route2,
	 *     route3,
	 *   )
	 *   .withRoutes(
	 *     route4,
	 *     route5,
	 *     route6,
	 *   )
	 *   .start()
	 * ```
	 *
	 * @param routes The routes to add to the router.
	 */
	withRoutes(
		...routes: Array<
			| ServerConnectRoute<App, Connection, Socket>
			| ServerConnectRoute<null, Connection, Socket>
			| ServerConnectRoute<App, null, Socket>
			| ServerConnectRoute<null, null, Socket>
		>
	) {
		for (const route of routes) {
			this.routes.add(route);
		}

		return this as unknown as Pick<
			ConnectRouter<
				App,
				Connection,
				Socket,
				Exclude<Narrow, "start" | "withRoutes">
			>,
			"start" | "withRoutes"
		>;
	}

	/**
	 * Starts the router, binding the routes to the connection.
	 *
	 * A runtime check is performed here to ensure that you have bound all the server routes.
	 *
	 * Be careful not to start the router multiple times as you will broadcast
	 * messages from the same socket to the same route multiple times.
	 * This will usually result in a flood of replicated messages and even
	 * invalid routing of messages.
	 *
	 * # Example
	 *
	 * ```ts
	 * const client = router
	 *   .withApp(...)
	 *   .withConnection(...)
	 *   .withRoutes(...)
	 *   .start()
	 *
	 * sendRoute.connect(client).send(...)
	 * ```
	 */
	start(): (() => Promise<
		Context<App, Connection, Socket> &
			Context<null, Connection, Socket> &
			Context<App, null, Socket> &
			Context<null, null, Socket>
	>) &
		ClientConnectorBrand {
		if (this.routes.size !== this.serverRouteCount)
			throw Error(
				`You forgot to bind ${
					this.serverRouteCount - this.routes.size
				} route(s)`,
			);

		const uniqueRoutes = new Set(
			[...this.routes].map(
				(route) =>
					// @ts-expect-error We're using private class properties to hide the key, but it's still available for access.
					route.key,
			),
		);
		if (uniqueRoutes.size !== this.routes.size)
			throw Error("You have duplicate routes registered");

		for (const route of this.routes) {
			// @ts-expect-error We're using private class properties to hide the identity, but it's still available for access.
			if (route.identity !== this.serverIdentity)
				throw Error("The provided route was created on a different router.");
		}

		const connect = this.connect;

		for (const route of this.routes) {
			route.connect(brandServerConnector(connect));
		}

		return brandClientConnector(connect);
	}

	/**
	 * Establish the connection and return the connection context.
	 *
	 * @returns The connection context.
	 */
	private get connect() {
		return () =>
			this.connection().then(
				(connection) =>
					({
						...connection,
						app: this.app,
					}) as Context<App, Connection, Socket> &
						Context<null, Connection, Socket> &
						Context<App, null, Socket> &
						Context<null, null, Socket>,
			);
	}

	/**
	 * Create a {@link ConnectRouter} that is set up for late binding.
	 */
	public static factory(serverRouteCount: number, serverIdentity: symbol) {
		const connectRouter = new ConnectRouter<
			null,
			null,
			null,
			"start" | "withRoutes"
		>(serverRouteCount, serverIdentity);
		return connectRouter as Omit<typeof connectRouter, "start" | "withRoutes">;
	}
}
