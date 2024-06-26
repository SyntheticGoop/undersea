import type { Socket } from "../lib/Socket";
import { channel } from "../protocol/channel";
import { Task } from "../lib/Task";
import type { Config } from "./Config";
import type { Codec } from "./Codec";
import { mapServiceHandler } from "./mapService";
import type { Service } from "./Service";

export class Endpoint<
	App,
	Connection,
	Pull,
	Push,
	ServiceHandler extends Service<Push, Pull>,
> {
	constructor(
		private readonly context: {
			codec: Codec;
			config: Pick<Config, "ackDeadline" | "clientSilentDeadline">;
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
	 * Binds the endpoint to the socket, allowing for the endpoint to be used.
	 *
	 * @param context A context factory that returns the current context.
	 */
	public async start(
		context: () => Promise<{
			socket: Socket;
			app: App;
			connection: Connection;
		}>,
	) {
		return context().then(({ socket, app, connection }) => {
			const task = new Task();
			socket.closed.then(() => task.cancel("socket closed"));

			return channel(
				socket,
				{
					key: this.context.key,
				},
				task,
				this.context.config.ackDeadline,
				this.context.config.clientSilentDeadline,
				() => {
					const serviceHandler = mapServiceHandler(
						this.context.codec,
						this.context.createService({ app, connection, task }),
					);

					return {
						pull: serviceHandler.internal,
						push: serviceHandler.external,
					};
				},
			);
		});
	}
}
