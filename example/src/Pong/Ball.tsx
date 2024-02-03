import { PositionControl } from "./PositionControl";

export function Ball(props: {
	onControl: (update: PositionControl) => void;
}) {
	return (
		<div
			ref={(ref) => props.onControl(new PositionControl(ref))}
			class="bg-gray-700 w-[12px] h-[12px] rounded-full absolute"
		/>
	);
}
