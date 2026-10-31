import { ActionForm } from '@/components/action-form';
import { DropZone } from '@/components/drop-zone';
import { AttachmentList } from '@/app/(app)/she/fields';
import { attachDoc } from '@/app/(app)/logistik/actions';

// Foto/pindai formulir fisik yang sudah ditandatangani. Berkas yang terunggah tidak bisa dihapus (jejak audit).
export function DocScans({ table, id, path, canUpload }: { table: string; id: string; path: string; canUpload: boolean }) {
  return (
    <div className="grid gap-3">
      <AttachmentList table={table} ids={[id]} />
      {canUpload && (
        <ActionForm action={attachDoc} label="Unggah" hidden={{ table, id, path }}>
          <DropZone label="Formulir fisik (foto / PDF)" accept="image/*,application/pdf" required hint="Ketuk untuk memotret / memilih, atau seret berkas ke sini" />
        </ActionForm>
      )}
    </div>
  );
}
