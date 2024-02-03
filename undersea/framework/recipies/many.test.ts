import { describe, expect, it } from "vitest";
import { many } from "./many";

function wait(ms: number) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

describe(many, () => {
	it("should expect a receive before allowing another send", async () => {
		const service = many<string, string>({ internal: 1, external: 2 });
		service.external("hello");
		service.external("world");
		expect(service.takeExternal()).resolves.toBe("hello");
		expect(service.takeExternal()).resolves.toBe("world");
		expect(
			Promise.race([service.takeExternal(), wait(10).then(() => "timeout")]),
		).resolves.toBe("timeout");
	});

	it("should error on external buffer full", async () => {
		const service = many<string, string>({ internal: 1, external: 1 });
		expect(service.external("hello")).toBeTruthy();
		expect(service.external("world")).toBeFalsy();
	});

	it("should expect a send before allowing another receive", async () => {
		const service = many<string, string>({ internal: 2, external: 1 });
		service.loadInternal("hello");
		service.loadInternal("world");
		expect(service.internal()).resolves.toBe("hello");
		expect(service.internal()).resolves.toBe("world");
		expect(
			Promise.race([service.internal(), wait(11).then(() => "timeout")]),
		).resolves.toBe("timeout");
	});

	it("should error on internal buffer full", async () => {
		const service = many<string, string>({ internal: 1, external: 1 });
		expect(service.loadInternal("hello")).toBeTruthy();
		expect(service.loadInternal("world")).toBeFalsy();
	});
});
