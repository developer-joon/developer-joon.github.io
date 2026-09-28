import { CommentComposer, type CommentSubmitIntent } from './CommentComposer'

export function ReplyComposer({ onSubmit, onCancel, disabled }: { onSubmit(intent: CommentSubmitIntent): Promise<boolean>; onCancel(): void; disabled?: boolean }) {
  return <div className="reply-composer"><CommentComposer label="답글 내용" submitLabel="답글 작성" onSubmit={onSubmit} onCancel={onCancel} disabled={disabled} /></div>
}
