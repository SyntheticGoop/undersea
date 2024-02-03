import { CancellableResult } from "../lib/Task";
import { Codec } from "./Codec";
import { Service } from "./Service";

/**
 * Maps a service handler into a service to be hooked into the connection.
 */
export function mapServiceHandler<
	InternalKnown,
	ExternalRaw,
	ServiceHandler extends Service<InternalKnown, ExternalRaw>,
>(codec: Codec, service: ServiceHandler) {
	return {
		internal: () =>
			service
				.internal()
				?.then((data) => (data === null ? null : codec.encode(data))) ?? null,
		external: (rawData: CancellableResult<ArrayBuffer>) => {
			if (typeof rawData.reason === "string") {
				// TODO: gracefully handle error

				// throw new Error(rawData.reason);

				return;
			}
			const data = codec.decode(rawData.value);
			if (!service.validate(data)) {
				// TODO: gracefully handle error

				// throw new Error("Invalid data received");
				return;
			}
			service.external(data as ExternalRaw);
		},
	};
}
