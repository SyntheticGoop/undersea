import { PositionControl } from "./PositionControl";

export function Paddle(props: {
	onControl: (update: PositionControl) => void;
}) {
	return (
		<div
			ref={(ref) => props.onControl(new PositionControl(ref))}
			class="bg-gray-700 w-[6px] h-[100px] rounded-sm absolute"
		/>
	);
}
