import type { CancellableResult } from "../lib/Task";
import type { Codec } from "./Codec";
import type { Service } from "./Service";

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
			let data: unknown;
			// Try to decode the data, if it fails, we should ignore it.
			try {
				data = codec.decode(rawData.value);
			} catch (error) {
				console.error(error);
				return;
			}
			if (!service.validate(data)) {
				// TODO: gracefully handle error

				// throw new Error("Invalid data received");
				return;
			}
			service.external(data as ExternalRaw);
		},
	};
}
