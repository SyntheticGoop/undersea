import { Service } from "../Service";

/**
 * Wrap a connection that will only allow one send and one receive.
 */
export function once<InternalKnown, ExternalRaw>(
	schema?: (data: unknown) => data is ExternalRaw,
) {
	let external: (value: ExternalRaw) => void;

	const takeExternal: Promise<ExternalRaw> = new Promise<ExternalRaw>(
		(resolve) => {
			external = resolve;
		},
	);

	let loadInternal: ((payload: InternalKnown | null) => void) | null = null;

	let internal: Promise<InternalKnown | null> | null =
		new Promise<InternalKnown | null>((resolve) => {
			loadInternal = resolve;
		});

	const service: Service<InternalKnown, ExternalRaw> = {
		internal: () => {
			if (!internal) return takeExternal.then(() => null);

			const next = internal;
			internal = null;

			return next;
		},
		external(data) {
			if (!external) return false;
			external(data);
			return true;
		},
		validate(data: unknown): data is ExternalRaw {
			return schema?.(data) ?? true;
		},

		takeExternal: () => takeExternal,

		loadInternal(data) {
			if (!loadInternal) return false;
			loadInternal(data);
			return true;
		},
	};
	return service;
}
