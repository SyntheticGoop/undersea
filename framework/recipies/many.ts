import { CircularBuffer } from "../../lib/CircularBuffer";
import { Service } from "../Service";

/**
 * Wrap a connection that will allow many synchronous sends and receives.
 *
 * Each send must be followed by a receive before another send can be made.
 *
 * @param bufferSize The size of the internal and external buffers.
 * @param schema A schema to validate the data.
 */
export function many<InternalKnown, ExternalRaw>(
	bufferSize: { internal: number; external: number },
	schema?: (data: unknown) => data is ExternalRaw,
) {
	const internal = new CircularBuffer<InternalKnown | null>(
		bufferSize.internal,
	);
	const external = new CircularBuffer<ExternalRaw>(bufferSize.external);

	const service: Service<InternalKnown, ExternalRaw> = {
		internal() {
			return internal.take();
		},
		external(data) {
			return external.push(data);
		},
		validate(data) {
			return schema?.(data) ?? true;
		},
		takeExternal() {
			return external.take();
		},
		loadInternal(payload) {
			return internal.push(payload);
		},
	};

	return service;
}
