import { useCallback, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { supabase } from './supabase'

const MAX_FILE_SIZE = 5 * 1024 * 1024 // 5 MB pre-resize
const TARGET_SIZE = 512
const JPEG_QUALITY = 0.85
const STORAGE_BUCKET = 'avatars'

const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])

function resizeImage(file: File): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(img.src)

      const canvas = document.createElement('canvas')
      canvas.width = TARGET_SIZE
      canvas.height = TARGET_SIZE
      const ctx = canvas.getContext('2d')
      if (!ctx) return reject(new Error('Canvas not supported'))

      // Center-crop to square
      const srcSize = Math.min(img.width, img.height)
      const sx = (img.width - srcSize) / 2
      const sy = (img.height - srcSize) / 2
      ctx.drawImage(img, sx, sy, srcSize, srcSize, 0, 0, TARGET_SIZE, TARGET_SIZE)

      canvas.toBlob(
        (blob) => {
          if (blob) resolve(blob)
          else reject(new Error('Failed to process image'))
        },
        'image/jpeg',
        JPEG_QUALITY,
      )
    }
    img.onerror = () => reject(new Error('Failed to load image'))
    img.src = URL.createObjectURL(file)
  })
}

function storagePath(userId: string) {
  return `${userId}/avatar.jpg`
}

export function useAvatarUpload(userId: string) {
  const [isUploading, setIsUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const queryClient = useQueryClient()

  const upload = useCallback(
    async (file: File): Promise<string> => {
      setError(null)

      if (!ALLOWED_TYPES.has(file.type)) {
        const msg = 'Please upload a JPEG, PNG, or WebP image.'
        setError(msg)
        throw new Error(msg)
      }
      if (file.size > MAX_FILE_SIZE) {
        const msg = 'Image must be under 5 MB.'
        setError(msg)
        throw new Error(msg)
      }

      setIsUploading(true)

      try {
        const resized = await resizeImage(file)
        const path = storagePath(userId)

        const { error: uploadError } = await supabase.storage
          .from(STORAGE_BUCKET)
          .upload(path, resized, {
            contentType: 'image/jpeg',
            upsert: true,
          })

        if (uploadError) throw uploadError

        const {
          data: { publicUrl },
        } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(path)

        const { error: updateError } = await supabase
          .from('profiles')
          .update({ avatar_url: publicUrl })
          .eq('id', userId)

        if (updateError) throw updateError

        await queryClient.invalidateQueries({ queryKey: ['profile', userId] })

        return publicUrl
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Upload failed'
        setError(msg)
        throw err
      } finally {
        setIsUploading(false)
      }
    },
    [userId, queryClient],
  )

  const remove = useCallback(async () => {
    setError(null)
    setIsUploading(true)

    try {
      const path = storagePath(userId)
      const { error: deleteError } = await supabase.storage.from(STORAGE_BUCKET).remove([path])

      // Ignore "not found" errors — the file may already be gone.
      if (deleteError && deleteError.message !== 'The resource was not found') {
        throw deleteError
      }

      const { error: updateError } = await supabase
        .from('profiles')
        .update({ avatar_url: null })
        .eq('id', userId)

      if (updateError) throw updateError

      await queryClient.invalidateQueries({ queryKey: ['profile', userId] })
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Remove failed'
      setError(msg)
      throw err
    } finally {
      setIsUploading(false)
    }
  }, [userId, queryClient])

  return { upload, remove, isUploading, error }
}
