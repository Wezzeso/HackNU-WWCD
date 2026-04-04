import { StateNode } from 'tldraw'
import { createReactionStampShape, STAMP_TOOL_ID } from './stamps'

export class StampTool extends StateNode {
	static override id = STAMP_TOOL_ID
	static override isLockable = false

	override onPointerDown() {
		const point = this.editor.inputs.getCurrentPagePoint()
		const stamp = createReactionStampShape(this.editor, point)

		this.editor.run(() => {
			this.editor.createShape(stamp)
			this.editor.selectNone()
		})
	}

	override onCancel() {
		this.editor.setCurrentTool('select')
	}

	override onInterrupt() {
		this.editor.setCurrentTool('select')
	}
}
