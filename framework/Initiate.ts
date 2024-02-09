import { Socket } from "../lib/Socket";
import { Task } from "../lib/Task";
import { connect } from "../protocol/connect";
import { Atomic } from "../lib/Atomic";
import { Config } from "./Config";
import { Codec } from "./Codec";
import { mapServiceHandler } from "./mapService";
import { Service } from "./Service";

/**
 * Initiates a connection.
 */
export class Initiate<
	App,
	Connection,
	Load,
	Recv,
	ServiceHandler extends Service<Load, Recv>,
> {
	private readonly nonce = new Atomic(0xff_ff);

	constructor(
		private readonly context: {
			codec: Codec;
			config: Pick<Config, "ackDeadline" | "serverSilentDeadline">;
			key: number;
			createService(context: {
				app: App;
				connection: Connection;
				task: Task;
			}): ServiceHandler;
		},
	) {
		this.start = this.start.bind(this);
	}

	/**
	 * Connects to the remote endpoint, allowing for the service to be used.
	 *
	 * @param context A context factory that returns the current context.
	 */
	public async start(
		task: Task,
		context: () => Promise<{
			socket: Socket;
			app: App;
			connection: Connection;
		}>,
	): Promise<Omit<ServiceHandler, "internal" | "external" | "validate">> {
		return context().then(({ socket, app, connection }) => {
			const serviceHandler = this.context.createService({
				app,
				connection,
				task,
			});
			const service = mapServiceHandler(this.context.codec, serviceHandler);

			connect(
				socket,
				{
					key: this.context.key,
					nonce: this.nonce.next,
				},
				task,
				this.context.config.ackDeadline,
				this.context.config.serverSilentDeadline,
				service.internal,
				service.external,
			);

			return serviceHandler;
		});
	}
}
