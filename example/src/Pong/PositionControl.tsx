export class PositionControl {
	delta = { x: 0, y: 0 };
	constructor(private readonly bind: HTMLElement) {}

	public setDelta(x: number, y: number): void {
		this.delta.x = x;
		this.delta.y = y;
	}

	private get position(): DOMRect {
		return this.bind.getBoundingClientRect();
	}

	public get x(): number {
		return this.position.x + this.delta.x;
	}

	public get y(): number {
		return this.position.y + this.delta.y;
	}

	public get width(): number {
		return this.position.width;
	}

	public get height(): number {
		return this.position.height;
	}

	public set x(value: number) {
		this.bind.style.left = `${value}px`;
	}

	public set y(value: number) {
		this.bind.style.top = `${value}px`;
	}
}
