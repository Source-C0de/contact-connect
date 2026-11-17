import { useEffect, useRef, useState } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { AvatarInitials } from '@/components/AvatarInitials';
import {
  prepareImageForUpload, formatBytes, MAX_PHOTO_BYTES, ACCEPTED_TYPES,
} from '@/lib/imageUpload';
import { Upload, Trash2 } from 'lucide-react';

interface PhotoUploadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Display name of the person whose picture is being set. */
  personName: string;
  /** Current picture URL (absolute), or null. */
  currentPhotoUrl?: string | null;
  /** Uploads the picture. Rejects with an Error carrying the server message. */
  onUpload: (file: File) => Promise<void>;
  /** Removes the current picture. */
  onRemove?: () => Promise<void>;
}

/**
 * Admin dialog for setting a person's profile picture.
 *
 * The picked file is never uploaded as-is: it is downsized and re-encoded in
 * the browser first so the payload always fits the server's 50 KB limit.
 */
export function PhotoUploadDialog({
  open, onOpenChange, personName, currentPhotoUrl, onUpload, onRemove,
}: PhotoUploadDialogProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [prepared, setPrepared] = useState<{ blob: Blob; type: string } | null>(null);
  const [size, setSize] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  // Reset the form each time the dialog opens so a stale preview from the
  // previous user never leaks into this one.
  useEffect(() => {
    if (!open) return;
    setPreviewUrl(null);
    setPrepared(null);
    setSize(null);
    setError('');
  }, [open, currentPhotoUrl]);

  // Release the object URL when it is replaced or the dialog closes.
  useEffect(() => () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  const handlePick = async (file: File | undefined) => {
    if (!file) return;
    setError('');
    setPrepared(null);
    setSize(null);
    try {
      const result = await prepareImageForUpload(file);
      setPrepared({ blob: result.blob, type: result.type });
      setSize(result.size);
      setPreviewUrl(URL.createObjectURL(result.blob));
    } catch (e) {
      setError((e as Error).message || 'Could not process this image.');
    }
  };

  const handleSave = async () => {
    if (!prepared) return;
    setBusy(true);
    setError('');
    try {
      const extension = prepared.type === 'image/webp' ? 'webp' : 'jpg';
      const file = new File([prepared.blob], `profile.${extension}`, { type: prepared.type });
      await onUpload(file);
      onOpenChange(false);
    } catch (e) {
      setError((e as Error).message || 'Failed to upload the picture.');
    } finally {
      setBusy(false);
    }
  };

  const handleRemove = async () => {
    if (!onRemove) return;
    setBusy(true);
    setError('');
    try {
      await onRemove();
      onOpenChange(false);
    } catch (e) {
      setError((e as Error).message || 'Failed to remove the picture.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Profile Picture</DialogTitle>
          <DialogDescription>
            Set a picture for {personName}. Images are resized and compressed to stay under 50 KB.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col items-center gap-4 py-2">
          {previewUrl ? (
            <img
              src={previewUrl}
              alt="Selected picture preview"
              className="h-32 w-32 rounded-full object-cover ring-2 ring-border"
            />
          ) : currentPhotoUrl ? (
            <img
              src={currentPhotoUrl}
              alt={`${personName}'s current picture`}
              className="h-32 w-32 rounded-full object-cover ring-2 ring-border"
            />
          ) : (
            <AvatarInitials name={personName} size="lg" />
          )}

          <input
            ref={inputRef}
            type="file"
            accept={ACCEPTED_TYPES.join(',')}
            className="hidden"
            onChange={e => {
              void handlePick(e.target.files?.[0]);
              // Reset so picking the same file twice still fires a change.
              e.target.value = '';
            }}
          />

          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => inputRef.current?.click()}
            disabled={busy}
          >
            <Upload className="mr-2 h-4 w-4" />
            {previewUrl || currentPhotoUrl ? 'Choose a different image' : 'Choose image'}
          </Button>

          {size !== null && (
            <p className="text-xs text-muted-foreground">
              Optimised: {formatBytes(size)} / {formatBytes(MAX_PHOTO_BYTES)} max
            </p>
          )}
        </div>

        {error && (
          <div className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
            {error}
          </div>
        )}

        <DialogFooter>
          {onRemove && currentPhotoUrl && (
            <Button
              type="button"
              variant="ghost"
              onClick={() => void handleRemove()}
              disabled={busy}
              className="text-destructive hover:bg-destructive/10 hover:text-destructive sm:mr-auto"
            >
              <Trash2 className="mr-2 h-4 w-4" />
              Remove
            </Button>
          )}
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button type="button" onClick={() => void handleSave()} disabled={busy || !prepared}>
            {busy ? 'Saving...' : 'Save picture'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
